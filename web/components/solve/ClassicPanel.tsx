"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ServiceNotice, serviceOff, useService } from "@/components/planner/ServiceStatus";
import { bestRunKey, makeRun, usePlanner, type PlannerRun } from "@/components/planner/store";
import { Button } from "@/components/ui/Button";
import { ApiError } from "@/lib/api";
import { useFormat } from "@/lib/format";
import { useT, type Pair } from "@/lib/i18n";
import { methodHint } from "@/lib/glossary";
import { methodLabel } from "@/lib/labels";
import type { components } from "@/lib/types";
import { CLASSIC_METHODS, MAX_RETRIES, errorText, solveWithRetry, type ClassicMethod } from "./solve";
import { TrafficPicker } from "./TrafficPicker";
import { useLatest } from "./useLatest";

type S = components["schemas"];

type Status =
  | { kind: "idle" }
  | { kind: "queued" }
  | { kind: "running"; since: number }
  | { kind: "retry"; since: number; attempt: number }
  | { kind: "done"; record: S["RunRecord"] }
  | { kind: "error"; message: Pair };

const IDLE: Record<ClassicMethod, Status> = { heuristic: { kind: "idle" }, aco: { kind: "idle" }, ga: { kind: "idle" }, tabu: { kind: "idle" } };

const REASON_ID = "classic-reason";

/** `0:07`, `1:05`. */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function StatusText({ status, now }: { status: Status; now: number }) {
  const t = useT();
  const { formatCost } = useFormat();
  switch (status.kind) {
    case "idle":
      return null;
    case "queued":
      return <span className="text-fg-2">{t({ es: "En cola", en: "Queued" })}</span>;
    case "running":
      return (
        <span className="flex items-center gap-2 text-fg">
          <span aria-hidden="true" className="inline-block size-3.5 flex-none animate-spin rounded-full border-2 border-amber border-t-transparent" />
          {t({ es: "Calculando", en: "Calculating" })} <span className="num" data-testid="solve-timer">{clock(now - status.since)}</span>
        </span>
      );
    case "retry":
      return (
        <span className="flex items-center gap-2 text-wait">
          <span aria-hidden="true" className="inline-block size-3.5 flex-none animate-spin rounded-full border-2 border-wait border-t-transparent" />
          {t({ es: `Servicio ocupado, reintentando (${status.attempt} de ${MAX_RETRIES})`, en: `Service busy, retrying (${status.attempt} of ${MAX_RETRIES})` })}
        </span>
      );
    case "done": {
      const ev = status.record.evaluation;
      if (!ev) return <span className="text-late">{t({ es: "Hecho, sin solución legible", en: "Done, no readable plan" })}</span>;
      return (
        <span className="text-fg">
          <span className="font-semibold text-ok">{t({ es: "Hecho", en: "Done" })}</span>
          {" · "}
          <span className="num">{formatCost(ev.score)}</span>
          {" · "}
          <span className="num">{ev.vehicles_used}</span> {ev.vehicles_used === 1 ? t({ es: "furgoneta", en: "van" }) : t({ es: "furgonetas", en: "vans" })}
          {!ev.feasible && <span className="font-semibold text-late"> · {t({ es: "no válido", en: "not valid" })}</span>}
        </span>
      );
    }
    case "error":
      return <span className="text-late">{t(status.message)}</span>;
  }
}

/**
 * Resolver en vivo con los cuatro métodos clásicos. Los métodos marcados se
 * lanzan en serie (el servicio admite un solo cálculo a la vez) con `seed` 0 y
 * 30 s de límite. Cada resultado entra en la comparativa como «en vivo»; si el
 * servicio está ocupado (503) se espera y se reintenta. Cancelar aborta el
 * método en curso y vacía la cola. El estado sobrevive a cerrar el panel.
 */
export function ClassicPanel() {
  const t = useT();
  const { state, actions } = usePlanner();
  const { service } = useService();
  const [picked, setPicked] = useState<Record<ClassicMethod, boolean>>({ heuristic: true, aco: true, ga: true, tabu: true });
  const [status, setStatus] = useState<Record<ClassicMethod, Status>>(IDLE);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<Pair | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const abort = useRef<AbortController | null>(null);
  const metaRef = useRef(state.meta);
  const metaNow = useLatest(state.meta);

  const set = useCallback((m: ClassicMethod, s: Status) => setStatus((prev) => ({ ...prev, [m]: s })), []);

  // Cronómetro: un solo reloj mientras haya algo calculando.
  const ticking = running && CLASSIC_METHODS.some((m) => status[m].kind === "running" || status[m].kind === "retry");
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [ticking]);

  const cancel = useCallback(() => {
    abort.current?.abort();
    setStatus((prev) => {
      const next = { ...prev };
      for (const m of CLASSIC_METHODS) if (next[m].kind !== "done" && next[m].kind !== "error") next[m] = { kind: "idle" };
      return next;
    });
  }, []);

  // Otro caso: los resultados de este no valen para el nuevo. No se cancela al ocultarse el panel.
  useEffect(() => {
    if (metaRef.current === state.meta) return;
    metaRef.current = state.meta;
    abort.current?.abort();
    setStatus(IDLE);
    setSummary(null);
  }, [state.meta]);

  const instance = state.instance;
  const queue = CLASSIC_METHODS.filter((m) => picked[m]);
  const down = serviceOff(service);
  // Mientras se reevalúan los planes con un tráfico nuevo no se lanza ningún cálculo.
  const blocked = !instance || service !== "up" || state.busy.traffic;

  async function solve() {
    if (!instance || running) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    const batch = queue;
    const startMeta = state.meta;
    setRunning(true);
    actions.setBusy("classic", true);
    setSummary(null);
    setStatus({
      ...IDLE,
      ...Object.fromEntries(batch.map((m) => [m, { kind: "queued" } satisfies Status])),
    });
    const fresh: PlannerRun[] = [];
    for (const [i, method] of batch.entries()) {
      if (ctrl.signal.aborted) break;
      const since = Date.now();
      set(method, { kind: "running", since });
      const out = await solveWithRetry(instance, method, ctrl.signal, (attempt) =>
        set(method, { kind: "retry", since, attempt }),
      );
      // Cambió el caso mientras tanto (con el panel cerrado no corre el efecto que lo cancela): el resultado ya no vale.
      if (metaNow.current !== startMeta) {
        ctrl.abort();
        break;
      }
      if (!out.ok && out.aborted) break;
      if (out.ok) {
        const run = makeRun("en vivo", out.record);
        actions.addRun(run);
        fresh.push(run);
        set(method, { kind: "done", record: out.record });
        continue;
      }
      set(method, { kind: "error", message: errorText(out.error) });
      // Sin servicio no tiene sentido seguir: el resto de la cola no se lanza.
      if (out.error instanceof ApiError && out.error.kind === "network") {
        actions.setService("down");
        for (const rest of batch.slice(i + 1)) set(rest, { kind: "idle" });
        break;
      }
    }
    if (abort.current === ctrl) {
      setRunning(false);
      abort.current = null;
      actions.setBusy("classic", false);
    }
    if (ctrl.signal.aborted) return;
    const best = bestRunKey(fresh);
    if (best) actions.selectRun(best);
    setSummary(
      fresh.length === 0
        ? null
        : fresh.length === 1
          ? { es: "Plan nuevo en la comparativa y en el mapa.", en: "New plan in the comparison and on the map." }
          : {
              es: `${fresh.length} planes nuevos en la comparativa. El mejor está en el mapa.`,
              en: `${fresh.length} new plans in the comparison. The best is on the map.`,
            },
    );
  }

  return (
    // En escritorio el panel comparte fila con el mapa y la comparativa: si su contenido crece más que
    // esa fila, la página se alarga. El tope (altura de la fila menos la cabecera y las pestañas) lo evita.
    <div
      className="flex flex-col gap-4 min-[1180px]:max-h-[calc(clamp(560px,100svh-236px,760px)-230px)] min-[1180px]:overflow-y-auto min-[1180px]:overscroll-contain min-[1180px]:pr-1 [scrollbar-width:thin]"
      data-testid="classic-panel" aria-label={t({ es: "Métodos clásicos en vivo", en: "Classic methods, live" })} role="group">
      <ServiceNotice id={REASON_ID} />

      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          // El segundo clic de un doble clic en «Resolver» cae aquí: no cancela (el teclado da `detail` 0).
          <Button data-testid="solve-cancel" onClick={(e) => e.detail <= 1 && cancel()}>
            {t({ es: "Cancelar", en: "Cancel" })}
          </Button>
        ) : (
          <Button
            variant="primary"
            data-testid="solve-start"
            disabled={blocked || queue.length === 0}
            aria-describedby={down ? REASON_ID : undefined}
            onClick={() => void solve()}
          >
            {t({ es: "Resolver", en: "Solve" })}
          </Button>
        )}
        <span className="min-w-0 flex-1 text-base leading-snug text-fg-2" data-testid="solve-summary">
          {running
            ? t({ es: "Un método cada vez; el servicio calcula uno solo.", en: "One method at a time; the service runs only one." })
            : summary
              ? t(summary)
              : queue.length === 0
                ? t({ es: "Marca al menos un método.", en: "Select at least one method." })
                : t({ es: "Hasta 30 s por método.", en: "Up to 30 s per method." })}
        </span>
      </div>

      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={running}>
        <legend className="kicker mb-2 p-0">{t({ es: "Métodos", en: "Methods" })}</legend>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {CLASSIC_METHODS.map((m) => {
            const st = status[m];
            return (
              <li
                key={m}
                data-testid="solve-row"
                data-method={m}
                data-status={st.kind}
                className="rounded-hud border border-line bg-black/20 px-2.5 py-1"
              >
                <label className="flex min-h-11 cursor-pointer items-center gap-3 has-[:disabled]:cursor-default">
                  <input
                    type="checkbox"
                    data-testid={`solve-pick-${m}`}
                    checked={picked[m]}
                    onChange={(e) => setPicked((p) => ({ ...p, [m]: e.target.checked }))}
                    className="size-5 flex-none accent-[var(--amber)]"
                  />
                  <span className="min-w-0 flex-1 py-1">
                    <span className="block text-base leading-tight font-semibold text-fg">{t(methodLabel(m))}</span>
                    <span className="block text-base leading-snug text-fg-2">{t(methodHint(m) ?? { es: "", en: "" })}</span>
                  </span>
                </label>
                {st.kind !== "idle" && (
                  <p role="status" data-testid="solve-status" className="m-0 pb-1 pl-8 text-base leading-tight">
                    <StatusText status={st} now={now} />
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="border-t border-line pt-3">
        <TrafficPicker disabled={running || blocked} reason={down ? REASON_ID : undefined} />
      </div>
    </div>
  );
}
