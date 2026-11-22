"use client";

import { useEffect, useRef, useState } from "react";
import { evaluate } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { methodLabel } from "@/lib/labels";
import type { components } from "@/lib/types";
import { hasSolution, ORIGIN_LABELS, usePlanner } from "@/components/planner/store";
import { isReal } from "@/components/planner/units";
import { useLatest } from "./useLatest";

type S = components["schemas"];

type Profile = { id: string; name: string; windows: S["TrafficWindow"][]; note: string };

/** Perfil sin franjas: es "no hay tráfico". */
const NONE = "plano";

const LLM_REASON_ID = "traffic-llm-reason";

/** Nombre y nota de cada perfil en inglés (el JSON de los perfiles solo trae el español). */
const PROFILE_EN: Record<string, { name: string; note: string }> = {
  plano: {
    name: "No traffic",
    note: "No time slots: travel time is the one in the matrix. Profile factors are illustrative, not measured.",
  },
  "horas-punta": {
    name: "Rush hours",
    note: "Illustrative factors, not measured. Slots: 07:30 to 09:30 and 17:00 to 19:30.",
  },
};

/**
 * Tráfico de los casos reales. Al cambiar el perfil, la instancia lleva ese
 * `traffic_profile` y las rutas ya mostradas se reevalúan con `/evaluate`, de
 * una en una; las reevaluadas quedan marcadas, y también las que no se pudieron
 * reevaluar. Las cifras son las del servicio. No se cambia mientras corre un
 * cálculo en vivo (clásico o IA), y mientras se reevalúa no se lanza ninguno.
 */
export function TrafficPicker({
  disabled,
  reason,
}: {
  /** Mientras se resuelve o no hay servicio, el perfil no se puede cambiar. */
  disabled: boolean;
  /** Id del elemento que explica por qué está desactivado. */
  reason?: string;
}) {
  const { state, actions } = usePlanner();
  const t = useT();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failed, setFailed] = useState(0);
  const job = useRef<AbortController | null>(null);
  const runsNow = useLatest(state.runs);
  const metaNow = useLatest(state.meta);
  const metaRef = useRef(state.meta);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/data/traffic-profiles.json", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { profiles: Profile[] }) => setProfiles(d.profiles))
      .catch(() => {
        if (!ctrl.signal.aborted) setLoadFailed(true);
      });
    return () => ctrl.abort();
  }, []);

  // Otro caso: se abandona la reevaluación en curso (no al ocultarse el panel).
  useEffect(() => {
    if (metaRef.current === state.meta) return;
    metaRef.current = state.meta;
    job.current?.abort();
    setProgress(null);
    setFailed(0);
    actions.setBusy("traffic", false);
  }, [state.meta, actions]);

  const instance = state.instance;
  if (!instance) return null;

  if (!isReal(instance)) {
    return (
      <p data-testid="traffic-unavailable" className="m-0 text-base leading-snug text-fg-2">
        {t({ es: "El tráfico solo se aplica a los casos de Madrid.", en: "Traffic only applies to the Madrid cases." })}
      </p>
    );
  }

  async function choose(profile: Profile) {
    if (!instance) return;
    job.current?.abort();
    const ctrl = new AbortController();
    job.current = ctrl;
    const windows = profile.windows.length > 0 ? profile.windows : null;
    actions.setTraffic(profile.id === NONE ? null : profile.id, windows);
    const startMeta = state.meta;
    const withTraffic = { ...instance, traffic_profile: windows };

    // Foto de los planes: si una fila cambia mientras tanto, su reevaluación no la pisa (`replacing`).
    const targets = runsNow.current.filter(hasSolution);
    setFailed(0);
    setProgress({ done: 0, total: targets.length });
    actions.setBusy("traffic", true);
    let bad = 0;
    try {
      for (const [i, run] of targets.entries()) {
        try {
          const evaluation = await evaluate({ instance: withTraffic, routes: run.record.solution!.routes }, ctrl.signal);
          if (metaNow.current !== startMeta) ctrl.abort();
          if (ctrl.signal.aborted) return;
          const next = { ...run, record: { ...run.record, evaluation }, reevaluated: windows !== null, reevaluationFailed: false };
          actions.addRun(next, { replacing: run });
        } catch {
          if (ctrl.signal.aborted) return;
          bad++;
          actions.addRun({ ...run, reevaluated: false, reevaluationFailed: true }, { replacing: run });
        }
        setProgress({ done: i + 1, total: targets.length });
      }
      setFailed(bad);
    } finally {
      if (job.current === ctrl) {
        job.current = null;
        setProgress(null);
        actions.setBusy("traffic", false);
      }
    }
  }

  const current = state.traffic ?? NONE;
  const marked = state.runs.filter((r) => r.reevaluated);
  const currentProfile = profiles?.find((p) => p.id === current);
  const note = currentProfile && t({ es: currentProfile.note, en: PROFILE_EN[currentProfile.id]?.note ?? currentProfile.note });
  const busy = progress !== null;
  const llmRunning = state.busy.llm;
  const live = state.busy.classic || llmRunning;

  return (
    <fieldset data-testid="traffic" className="m-0 min-w-0 border-0 p-0" aria-busy={busy}>
      <legend className="kicker mb-2 p-0">{t({ es: "Tráfico", en: "Traffic" })}</legend>
      {loadFailed && <p className="m-0 text-base text-late">{t({ es: "No se pudieron leer los perfiles de tráfico.", en: "Could not read the traffic profiles." })}</p>}
      <div className="grid grid-cols-2 gap-2">
        {(profiles ?? []).map((p) => (
          <label
            key={p.id}
            className={`btn cursor-pointer gap-2 px-3 has-[:checked]:border-amber/70 has-[:checked]:bg-amber/[0.14] has-[:checked]:text-amber-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-amber`}
          >
            <input
              type="radio"
              name="traffic-profile"
              value={p.id}
              data-testid={`traffic-${p.id}`}
              checked={current === p.id}
              disabled={disabled || busy || live}
              aria-describedby={disabled ? reason : llmRunning ? LLM_REASON_ID : undefined}
              onChange={() => void choose(p)}
              className="sr-only"
            />
            {t({ es: p.name, en: PROFILE_EN[p.id]?.name ?? p.name })}
          </label>
        ))}
      </div>
      {note && <p className="mt-2 mb-0 text-base leading-snug text-fg-2">{note}</p>}
      {llmRunning && (
        <p id={LLM_REASON_ID} className="mt-2 mb-0 text-base leading-snug text-fg-2">
          {t({ es: "Se podrá cambiar cuando acabe la IA.", en: "You can change it when the AI finishes." })}
        </p>
      )}
      {progress && (
        <p role="status" data-testid="traffic-progress" className="mt-2 mb-0 text-base leading-snug text-fg">
          {t({ es: `Reevaluando ${progress.done} de ${progress.total}`, en: `Re-evaluating ${progress.done} of ${progress.total}` })}
        </p>
      )}
      {failed > 0 && (
        <p role="alert" className="mt-2 mb-0 text-base leading-snug text-late">
          {t({
            es: `No se pudo reevaluar ${failed === 1 ? "1 plan" : `${failed} planes`}: se ve con las cifras anteriores.`,
            en: `Could not re-evaluate ${failed === 1 ? "1 plan" : `${failed} plans`}: shown with the previous figures.`,
          })}
        </p>
      )}
      {marked.length > 0 && !busy && (
        <div className="mt-2">
          <span className="kicker text-fg-3">{t({ es: "Reevaluadas con tráfico", en: "Re-evaluated with traffic" })}</span>
          <ul data-testid="reevaluated" className="m-0 mt-1.5 flex list-none flex-wrap gap-1.5 p-0">
            {marked.map((r) => (
              <li key={r.key} className="rounded-full border border-line-2 px-2.5 py-0.5 text-base leading-snug text-fg-2">
                {t(methodLabel(r.record.method))} · {t(ORIGIN_LABELS[r.origin])}
                <span className="sr-only">{t({ es: ": reevaluada con tráfico", en: ": re-evaluated with traffic" })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </fieldset>
  );
}
