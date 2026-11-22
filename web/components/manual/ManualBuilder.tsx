"use client";

import { useEffect, useRef, useState } from "react";
import { vehicleColor } from "@/components/map/geometry";
import { ServiceNotice, useService } from "@/components/planner/ServiceStatus";
import { makeRun, usePlanner } from "@/components/planner/store";
import { useLatest } from "@/components/solve/useLatest";
import { Button } from "@/components/ui/Button";
import { ApiError, evaluate } from "@/lib/api";
import { formatCost } from "@/lib/format";
import { useLang, useT, type Lang, type Pair } from "@/lib/i18n";
import { groupViolations } from "@/lib/labels";
import type { components } from "@/lib/types";
import { EMPTY_DRAFT, chooseVehicle, pendingOf, tap, type Draft } from "./draft";

type S = components["schemas"];

/** Tope de clientes del modo (supuesto propio): con más, armar las rutas a mano no es razonable. */
export const MAX_CUSTOMERS = 25;

/** Espera entre la última pulsación y la evaluación. */
export const DEBOUNCE_MS = 300;

const REASON_ID = "manual-reason";

/** Registro de la fila `manual`: solo las rutas y su evaluación; el resto son valores neutros. */
function manualRecord(instance: S["Instance"], routes: number[][], evaluation: S["Evaluation"]): S["RunRecord"] {
  return {
    date: new Date().toISOString(),
    git_sha: "",
    hardware: "navegador",
    instance_hash: "",
    instance_id: instance.id,
    method: "manual",
    params: {},
    parse_status: "ok",
    role: "classic",
    run_id: "manual",
    seed: 0,
    wall_time_s: 0,
    solution: { routes },
    evaluation,
  };
}

type Verdict = { state: "valid-best" | "valid-beats" | "valid-tie" | "valid-behind" | "valid" | "invalid"; text: string };

/** Qué le pasa al plan del visitante frente a los métodos de la comparativa (todas las cifras salen de `/evaluate`). */
function verdictOf(manual: S["Evaluation"], others: S["RunRecord"][], t: (pair: Pair) => string, lang: Lang): Verdict {
  if (!manual.feasible) {
    const why = groupViolations(manual.violations)
      .map((g) => `${t(g.label)} (${g.count})`)
      .join(", ");
    return { state: "invalid", text: t({ es: `Todavía no es un plan válido: ${why}.`, en: `Not a valid plan yet: ${why}.` }) };
  }
  const valid = others.filter((r) => r.evaluation?.feasible);
  const heuristic = valid.filter((r) => r.method === "heuristic").map((r) => r.evaluation!.score);
  if (heuristic.length === 0) {
    return { state: "valid", text: t({ es: "Plan válido. Compáralo con los métodos en la comparativa.", en: "Valid plan. Compare it with the methods in the comparison." }) };
  }
  const heur = Math.min(...heuristic);
  const best = Math.min(...valid.map((r) => r.evaluation!.score));
  const mine = manual.score;
  const nums = t({
    es: `Tu coste: ${formatCost(mine, 1, lang)}. Heurística: ${formatCost(heur, 1, lang)}.`,
    en: `Your cost: ${formatCost(mine, 1, lang)}. Heuristic: ${formatCost(heur, 1, lang)}.`,
  });
  if (mine < best - 1e-6) return { state: "valid-best", text: `${t({ es: "¡Mejor que todos los métodos!", en: "Better than all the methods!" })} ${nums}` };
  if (mine < heur - 1e-6) {
    return {
      state: "valid-beats",
      text: `${t({ es: "Le ganas a la heurística, aunque otro método va por delante.", en: "You beat the heuristic, although another method is ahead." })} ${nums}`,
    };
  }
  if (Math.abs(mine - heur) <= 1e-6) return { state: "valid-tie", text: `${t({ es: "Empatas con la heurística.", en: "You tie with the heuristic." })} ${nums}` };
  return { state: "valid-behind", text: `${t({ es: "La heurística sigue por delante.", en: "The heuristic is still ahead." })} ${nums}` };
}

const VERDICT_TONE: Record<Verdict["state"], string> = {
  invalid: "border-late/50 bg-late/10",
  "valid-behind": "border-line bg-black/20",
  "valid-tie": "border-ok/50 bg-ok/10",
  "valid-beats": "border-ok/50 bg-ok/10",
  "valid-best": "border-ok/60 bg-ok/15",
  valid: "border-line bg-black/20",
};

/**
 * Constructor manual de rutas, «Tu ruta». Con la pestaña a la vista registra el
 * manejador de pulsaciones del mapa (`setStopClickHandler`): pulsar una parada
 * la asigna a la furgoneta elegida en vez de abrir su ficha. Cada cambio se
 * evalúa con `/evaluate` tras 300 ms sin pulsar (una sola evaluación en vuelo) y
 * actualiza la fila `manual` de la comparativa, que queda seleccionada. Las
 * paradas sin asignar cuentan como no atendidas; con el borrador vacío la fila
 * se retira. El borrador se conserva al
 * cerrar el panel y se vacía al cambiar de caso.
 */
export function ManualBuilder() {
  const [lang] = useLang();
  const t = useT();
  const { state, actions, setStopClickHandler } = usePlanner();
  const { service } = useService();
  const instance = state.instance;

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [history, setHistory] = useState<Draft[]>([]);
  const [draftMeta, setDraftMeta] = useState(state.meta);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Pair | null>(null);

  // Otro caso: el borrador del anterior no vale.
  if (draftMeta !== state.meta) {
    setDraftMeta(state.meta);
    setDraft(EMPTY_DRAFT);
    setHistory([]);
    setBusy(false);
    setError(null);
  }

  const tooBig = !!instance && instance.customers.length > MAX_CUSTOMERS;
  const down = service === "down";
  const enabled = !!instance && !tooBig && service === "up";
  const vehicles = instance?.fleet.vehicles ?? 0;

  const metaNow = useLatest(state.meta);
  const instanceNow = useLatest(instance);
  const runsNow = useLatest(state.runs);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);

  /** Evalúa `routes` pasados `DEBOUNCE_MS`; una pulsación nueva anula la espera y la evaluación en vuelo. */
  const schedule = (routes: number[][]) => {
    const meta = metaNow.current;
    if (timer.current) clearTimeout(timer.current);
    inflight.current?.abort();
    setError(null);
    // Sin ninguna ruta no hay nada que evaluar: la fila se retira y la comparativa vuelve a ser la de los métodos.
    if (routes.length === 0) {
      timer.current = null;
      inflight.current = null;
      setBusy(false);
      if (runsNow.current.some((r) => r.key === "manual")) actions.replaceRuns(runsNow.current.filter((r) => r.key !== "manual"));
      return;
    }
    setBusy(true);
    timer.current = setTimeout(async () => {
      const inst = instanceNow.current;
      if (!inst || metaNow.current !== meta) return;
      const ctrl = new AbortController();
      inflight.current = ctrl;
      try {
        const evaluation = await evaluate({ instance: inst, routes }, ctrl.signal);
        if (ctrl.signal.aborted || metaNow.current !== meta) return;
        actions.addRun(makeRun("manual", manualRecord(inst, routes, evaluation)), { select: true });
        setBusy(false);
      } catch (e) {
        if (ctrl.signal.aborted || (e instanceof ApiError && e.kind === "aborted")) return;
        setBusy(false);
        if (e instanceof ApiError && e.kind === "network") {
          actions.setService("down");
          setError({ es: "No se pudo contactar con el servicio.", en: "Could not reach the service." });
        } else {
          setError({ es: "No se pudo evaluar tu ruta. Pulsa otra parada para reintentar.", en: "Could not evaluate your route. Tap another stop to retry." });
        }
      } finally {
        if (inflight.current === ctrl) inflight.current = null;
      }
    }, DEBOUNCE_MS);
  };

  const commit = (next: Draft, before: Draft) => {
    setHistory((h) => [...h, before]);
    setDraft(next);
    schedule(next.routes);
  };

  // El manejador del mapa lee siempre el borrador y el caso más recientes.
  const draftNow = useLatest(draft);
  const onStop = useRef<(customer: number) => void>(() => {});
  useEffect(() => {
    onStop.current = (customer) => {
      const inst = instanceNow.current;
      if (!inst || !inst.customers.some((c) => c.id === customer)) return;
      const before = draftNow.current;
      commit(tap(before, customer), before);
    };
  });

  // Solo con la pestaña a la vista (un panel oculto con `Activity` ejecuta la limpieza) y con servicio.
  useEffect(() => {
    if (!enabled) return;
    setStopClickHandler((customer) => onStop.current(customer));
    return () => setStopClickHandler(null);
  }, [enabled, setStopClickHandler]);

  function undo() {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory(history.slice(0, -1));
    setDraft(previous);
    schedule(previous.routes);
  }

  function clear() {
    if (draft.routes.length === 0) return;
    commit(EMPTY_DRAFT, draft);
  }

  const ids = instance?.customers.map((c) => c.id) ?? [];
  const pending = pendingOf(draft, ids);
  const manual = state.runs.find((r) => r.key === "manual");
  const evaluation = manual?.record.evaluation ?? null;
  const touched = !!manual || draft.routes.length > 0 || history.length > 0;
  const verdict =
    evaluation && !busy
      ? verdictOf(
          evaluation,
          state.runs.filter((r) => r.key !== "manual").map((r) => r.record),
          t,
          lang,
        )
      : null;
  const reason = tooBig
    ? t({ es: `Tu ruta está disponible en casos de hasta ${MAX_CUSTOMERS} clientes.`, en: `Your route is available for cases of up to ${MAX_CUSTOMERS} customers.` })
    : !down && service !== "up"
      ? t({ es: "Comprobando el servicio.", en: "Checking the service." })
      : null;
  const newSlot = draft.routes.length < vehicles ? draft.routes.length : -1;

  return (
    <div
      data-testid="manual-panel"
      data-active={enabled ? "true" : "false"}
      role="group"
      aria-label={t({ es: "Constructor de rutas a mano", en: "Manual route builder" })}
      className="flex flex-col gap-3 min-[1180px]:max-h-[calc(clamp(560px,100svh-236px,760px)-230px)] min-[1180px]:overflow-y-auto min-[1180px]:overscroll-contain min-[1180px]:pr-1 [scrollbar-width:thin]"
    >
      <ServiceNotice id={REASON_ID} />
      {reason && (
        <p id={REASON_ID} data-testid="manual-reason" className="m-0 rounded-hud border border-line bg-black/20 px-3 py-2 text-base leading-snug text-fg">
          {reason}
        </p>
      )}

      <div>
        <p className="m-0 text-lg leading-snug font-semibold text-amber-2">{t({ es: "¿Puedes ganar a la heurística?", en: "Can you beat the heuristic?" })}</p>
        <p className="mt-1 mb-0 text-base leading-snug text-fg-2">
          {t({ es: "Elige furgoneta y pulsa paradas en el mapa, en orden; repite la última para quitarla.", en: "Pick a van and tap stops on the map, in order; tap the last one again to remove it." })}
        </p>
      </div>

      <div role="radiogroup" aria-label={t({ es: "Furgoneta", en: "Van" })} className="flex flex-wrap gap-1.5">
        {draft.routes.map((route, i) => (
          <VehicleChip key={i} index={i} label={`${t({ es: "F", en: "V" })}${i + 1}`} count={route.length} active={draft.active === i} disabled={!enabled} onPick={() => setDraft(chooseVehicle(draft, i))} />
        ))}
        {newSlot >= 0 && (
          <VehicleChip index={newSlot} label={t({ es: "+ Nueva", en: "+ New" })} count={null} active={draft.active === newSlot} disabled={!enabled} onPick={() => setDraft(chooseVehicle(draft, newSlot))} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button data-testid="manual-undo" disabled={!enabled || history.length === 0} aria-describedby={reason || down ? REASON_ID : undefined} onClick={undo}>
          {t({ es: "Deshacer", en: "Undo" })}
        </Button>
        <Button data-testid="manual-clear" disabled={!enabled || draft.routes.length === 0} aria-describedby={reason || down ? REASON_ID : undefined} onClick={clear}>
          {t({ es: "Vaciar", en: "Clear" })}
        </Button>
        <span role="status" data-testid="manual-status" className="min-w-0 flex-1 text-base leading-snug text-fg-2">
          {busy ? t({ es: "Evaluando tu ruta…", en: "Evaluating your route…" }) : error ? <span className="text-late">{t(error)}</span> : touched ? "" : t({ es: "Aún no has asignado ninguna parada.", en: "You have not assigned any stop yet." })}
        </span>
      </div>

      {draft.routes.length > 0 && (
        <ol className="m-0 flex list-none flex-col gap-1 p-0" aria-label={t({ es: "Tus rutas", en: "Your routes" })}>
          {draft.routes.map((route, i) => (
            <li key={i} data-testid="manual-route" data-vehicle={i} className="text-base leading-snug text-fg">
              <span className="font-semibold">{t({ es: "F", en: "V" })}{i + 1}</span>
              <span className="text-fg-2">: </span>
              <span className="num">{route.join(" → ")}</span>
            </li>
          ))}
        </ol>
      )}

      <p data-testid="manual-pending" data-count={pending.length} className="m-0 text-base leading-snug text-fg-2">
        {pending.length === 0 ? (
          <span className="font-semibold text-ok">✓ {t({ es: "Todas las paradas asignadas", en: "All stops assigned" })}</span>
        ) : (
          <>
            <span className="font-semibold text-fg">
              {t({ es: `Pendientes ${pending.length} de ${ids.length}:`, en: `Pending ${pending.length} of ${ids.length}:` })}{" "}
            </span>
            <span className="num">{pending.join(", ")}</span>
          </>
        )}
      </p>

      {verdict && evaluation && (
        <p
          role="status"
          data-testid="manual-verdict"
          data-state={verdict.state}
          className={`m-0 rounded-hud border px-3 py-2 text-base leading-snug text-fg ${VERDICT_TONE[verdict.state]}`}
        >
          {verdict.text}
        </p>
      )}
    </div>
  );
}

function VehicleChip({
  index,
  label,
  count,
  active,
  disabled,
  onPick,
}: {
  index: number;
  label: string;
  count: number | null;
  active: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={
        count === null
          ? t({ es: "Furgoneta nueva", en: "New van" })
          : t({ es: `Furgoneta ${index + 1}, ${count} ${count === 1 ? "parada" : "paradas"}`, en: `Van ${index + 1}, ${count} ${count === 1 ? "stop" : "stops"}` })
      }
      data-testid="manual-vehicle"
      data-vehicle={index}
      data-new={count === null ? "true" : undefined}
      disabled={disabled}
      onClick={onPick}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border px-3 text-base font-semibold whitespace-nowrap disabled:opacity-50 ${
        active ? "border-amber/70 bg-amber/[0.14] text-amber-2" : "border-line text-fg-2 [@media(hover:hover)]:hover:bg-white/[0.06] [@media(hover:hover)]:hover:text-fg"
      }`}
    >
      {count !== null && <span aria-hidden="true" className="inline-block size-2.5 flex-none rounded-full" style={{ background: vehicleColor(index) }} />}
      <span aria-hidden="true">{label}</span>
      {count !== null && (
        <span aria-hidden="true" className="num font-normal">
          {count}
        </span>
      )}
    </button>
  );
}
