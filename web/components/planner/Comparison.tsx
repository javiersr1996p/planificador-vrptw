"use client";

import type { CSSProperties } from "react";
import { hasGeo } from "@/components/map/geometry";
import { Help } from "@/components/ui/Help";
import { useFormat } from "@/lib/format";
import { methodHint } from "@/lib/glossary";
import { useT, type Pair } from "@/lib/i18n";
import { groupViolations, methodLabel, unreadableReason } from "@/lib/labels";
import type { components } from "@/lib/types";
import { AgentTrace } from "./AgentTrace";
import { ORIGIN_LABELS, hasSolution, rankRuns, usePlanner, type PlannerRun } from "./store";
import { isReal } from "./units";

type S = components["schemas"];

/**
 * Escala común de las barras: hasta el mayor coste válido. Las no válidas con
 * penalizaciones enormes se cortan con una marca de "fuera de escala".
 */
function scaleMax(runs: PlannerRun[]): number {
  const solved = runs.filter(hasSolution).map((r) => r.record.evaluation!);
  const valid = solved.filter((e) => e.feasible).map((e) => e.score);
  const all = solved.map((e) => e.score);
  return Math.max(1e-9, ...(valid.length ? valid : all));
}

/** Línea que explica el método; en las ejecuciones LLM, además, el modelo. */
export function runHint(record: S["RunRecord"], t: (pair: Pair) => string): string {
  const hint = t(methodHint(record.method) ?? methodLabel(record.method));
  const model = record.model_returned ?? record.model_requested;
  return record.role !== "classic" && model ? `${hint} · ${model}` : hint;
}

/** El coste es exactamente la distancia en km (casos reales sin multas): se rotula con su unidad. */
function costUnit(instance: S["Instance"] | null, ev: S["Evaluation"]): string | null {
  return instance && isReal(instance) && Math.abs(ev.score - ev.distance) < 1e-9 ? "km" : null;
}

function WarnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <path d="M8 1.5 L15 14 H1 Z" fill="var(--late)" />
      <path d="M8 6 V9.5" stroke="var(--ink-0)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8" cy="11.8" r="1" fill="var(--ink-0)" />
    </svg>
  );
}

function VanIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="size-3.5 flex-none text-fg-3">
      <path d="M1 4h8v7H1zM9.5 6h3l2.5 2.5V11h-5.5z" />
      <circle cx="4" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" className="size-3.5 flex-none text-fg-3">
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.5V8l2.4 1.6" />
    </svg>
  );
}

const ORIGIN_TAG: Record<PlannerRun["origin"], string> = {
  precalculada: "border-line-2 text-fg-3",
  "en vivo": "border-ok/60 text-ok",
  manual: "border-amber/60 text-amber",
};

function Row({
  run,
  index,
  max,
  best,
  bestScore,
  instance,
  selected,
  showOrigin,
  onSelect,
}: {
  run: PlannerRun;
  index: number;
  max: number;
  best: boolean;
  /** Coste de la mejor válida, o `null` si no hay ninguna. */
  bestScore: number | null;
  instance: S["Instance"] | null;
  selected: boolean;
  /** Etiqueta de origen en la fila (si todas son precalculadas, la lleva la cabecera). */
  showOrigin: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const { formatCost, formatDuration, formatEuro, formatNumber } = useFormat();
  const { record, origin } = run;
  const ev = record.evaluation;
  const solved = hasSolution(run);
  const invalid = solved && !ev!.feasible;
  const ratio = ev ? ev.score / max : 0;
  const offScale = ratio > 1.0001;
  const unit = ev ? costUnit(instance, ev) : null;
  const real = instance ? isReal(instance) : false;
  // Una no válida no se compara: sus penalizaciones no son un ahorro ni un sobrecoste del recorrido.
  const delta = ev && ev.feasible && bestScore !== null && !best ? ev.score - bestScore : null;
  const tokens =
    record.tokens_in != null && record.tokens_out != null
      ? `${formatNumber(record.tokens_in, 0)} / ${formatNumber(record.tokens_out, 0)} tokens`
      : null;
  const style = { "--i": index } as CSSProperties;
  // En móvil, tiempo, tokens y coste de API van plegados salvo en la fila seleccionada.
  const folded = selected ? "" : "max-[760px]:hidden";

  const cells = (
    <>
      <span className="row-span-3 self-start pt-[3px] font-mono text-[13px] max-[760px]:hidden leading-none font-semibold text-fg-3 uppercase">
        {index + 1}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-base leading-tight font-semibold text-fg">
        {t(methodLabel(record.method))}
        {best && (
          <span className="rounded-full bg-amber px-[7px] py-[3px] font-mono text-[12px] leading-none font-bold tracking-[0.08em] whitespace-nowrap text-amber-ink uppercase shadow-[0_0_14px_-2px_rgb(255_181_71/0.8)]">
            {t({ es: "Mejor válida", en: "Best valid" })}
          </span>
        )}
        {showOrigin && (
          <span className={`rounded-full border px-[7px] py-[2px] font-mono text-[12px] leading-none font-semibold tracking-[0.08em] uppercase ${ORIGIN_TAG[origin]}`}>
            {t(ORIGIN_LABELS[origin])}
          </span>
        )}
        {(run.reevaluated || run.reevaluationFailed) && (
          <span
            data-testid="row-reevaluated"
            className={`rounded-full border px-[7px] py-[2px] font-mono text-[12px] leading-none font-semibold tracking-[0.08em] uppercase ${
              run.reevaluated ? "border-wait/60 text-wait" : "border-late/60 text-late"
            }`}
          >
            {run.reevaluated
              ? t({ es: "reevaluada con tráfico", en: "re-evaluated with traffic" })
              : t({ es: "sin reevaluar", en: "not re-evaluated" })}
          </span>
        )}
      </span>
      {solved ? (
        <>
          <span className="text-right text-base leading-none font-semibold whitespace-nowrap">
            <span data-testid="row-cost" className="num">
              {formatCost(ev!.score)}
            </span>
            {unit && <span className="num ml-1 text-fg-3 max-[760px]:hidden">{unit}</span>}
          </span>
          <span aria-hidden="true" className={`relative h-[7px] overflow-hidden rounded-full bg-white/[0.07] ${best ? "max-[760px]:col-span-2" : ""}`}>
            <span
              className={`grow absolute inset-y-0 left-0 rounded-full ${
                invalid
                  ? "bar-invalid"
                  : best
                    ? "bg-[linear-gradient(90deg,#b8651a,var(--amber))] shadow-[0_0_14px_rgb(255_181_71/0.65)]"
                    : "bg-[linear-gradient(90deg,#34507c,#7f9dce)]"
              }`}
              style={{ width: `${Math.min(ratio, 1) * 100}%`, ...style }}
            />
            {offScale && <span className="absolute -inset-y-1 right-3 w-1.5 -skew-x-[24deg] bg-ink-2" />}
          </span>
          <span
            data-testid="row-delta"
            className={`text-right font-mono text-[12px] leading-none font-medium tracking-[0.06em] whitespace-nowrap text-fg-3 uppercase ${best ? "max-[760px]:hidden" : ""}`}
          >
            {best
              ? real
                ? t({ es: "el más corto", en: "the shortest" })
                : t({ es: "el menor coste", en: "the lowest cost" })
              : invalid
                ? t({ es: "no comparable", en: "not comparable" })
                : delta !== null
                  ? `+${formatCost(delta)}`
                  : ""}
            {offScale && <span className="sr-only"> ({t({ es: "fuera de escala", en: "off scale" })})</span>}
          </span>
        </>
      ) : (
        <span className="col-span-2 flex min-w-0 flex-wrap items-baseline gap-x-2 text-fg">
          <span className="font-semibold">{t({ es: "Sin respuesta legible", en: "No readable answer" })}</span>
          <span className="text-fg-3">{t(unreadableReason(record))}</span>
        </span>
      )}
      <span
        data-testid="method-hint"
        title={runHint(record, t)}
        className={`min-w-0 truncate text-base leading-tight text-fg-2 ${selected ? "max-[760px]:whitespace-normal" : ""}`}
      >
        {runHint(record, t)}
      </span>
      <span className="flex items-center justify-end gap-1.5 text-base leading-none whitespace-nowrap text-fg-2 tabular-nums">
        <VanIcon />
        <span className="sr-only">{t({ es: "furgonetas", en: "vans" })}:</span>
        <span data-testid="row-vehicles">{ev ? ev.vehicles_used : "–"}</span>
        <span data-testid="row-time" className={`ml-1.5 flex items-center gap-1.5 ${folded}`}>
          <ClockIcon />
          <span className="sr-only">{t({ es: "cálculo", en: "compute time" })}:</span>
          {origin === "manual" ? "–" : formatDuration(record.wall_time_s)}
        </span>
      </span>
      {(tokens || record.api_cost_eur != null) && (
        <span
          data-testid="row-spend"
          className={`col-span-2 flex flex-wrap justify-end gap-x-3 text-base leading-tight text-fg-3 tabular-nums min-[761px]:col-start-2 ${folded}`}
        >
          {tokens && <span>{tokens}</span>}
          {record.api_cost_eur != null && <span>{formatEuro(record.api_cost_eur)}</span>}
        </span>
      )}
    </>
  );

  const grid =
    "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 rounded-[11px] border px-2.5 py-[5px] text-left min-[761px]:grid-cols-[20px_minmax(0,1fr)_auto]";

  return (
    <li
      data-testid="comparison-row"
      data-run-id={record.run_id}
      data-method={record.method}
      data-origin={origin}
      data-invalid={invalid ? "true" : undefined}
      data-unreadable={solved ? undefined : "true"}
      data-selected={selected ? "true" : undefined}
      data-reevaluated={run.reevaluated ? "true" : run.reevaluationFailed ? "failed" : undefined}
      className="rise flex flex-col gap-1"
      style={style}
    >
      {solved ? (
        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          className={`${grid} cursor-pointer transition-[background-color,border-color] duration-200 ease-[var(--ease-out)] ${
            selected
              ? "border-amber/60 bg-amber/[0.07]"
              : "border-transparent bg-white/[0.028] [@media(hover:hover)]:hover:bg-white/[0.06]"
          }`}
        >
          {cells}
        </button>
      ) : (
        <div className={`${grid} border-transparent bg-white/[0.02]`}>{cells}</div>
      )}
      {(invalid || record.role === "llm_agent") && (
        <div className="flex flex-col gap-1 px-2.5 pb-1 min-[761px]:pl-[40px]">
          {invalid && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base">
              <WarnIcon />
              <span className="font-semibold text-late">{t({ es: "No válida", en: "Not valid" })}</span>
              {groupViolations(ev!.violations).map((g) => (
                <span key={g.type} className="rounded-tag bg-late/15 px-1.5 leading-7 text-late">
                  {t(g.label)} ({g.count})
                </span>
              ))}
            </p>
          )}
          {record.role === "llm_agent" && <AgentTrace record={record} />}
        </div>
      )}
    </li>
  );
}

/** Coste en una línea: kilómetros en los casos reales; distancia y multas en el resto. */
function costLine(instance: S["Instance"] | null, t: (pair: Pair) => string): string {
  if (instance && isReal(instance)) return t({ es: "Coste = kilómetros; llegar tarde se multa.", en: "Cost = kilometers; arriving late is penalized." });
  const w = instance?.cost_profile?.w_vehicle ?? 0;
  return w > 0
    ? t({ es: "Coste = distancia, furgonetas y multas.", en: "Cost = distance, vans and penalties." })
    : t({ es: "Coste = distancia; llegar tarde se multa.", en: "Cost = distance; arriving late is penalized." });
}

/** En los casos con mapa los tramos se dibujan rectos: la ayuda del coste dice si la distancia es por carretera. */
function mapNote(instance: S["Instance"] | null, t: (pair: Pair) => string): string | undefined {
  if (!instance || !hasGeo(instance)) return undefined;
  return instance.matrix?.source === "haversine_fallback"
    ? t({ es: "Tramos y distancias en línea recta.", en: "Legs and distances in a straight line." })
    : t({ es: "Tramos rectos; la distancia es por carretera.", en: "Straight legs; the distance is by road." });
}

/** Comparativa de planes, ordenada por coste, con las no válidas al final. */
export function Comparison() {
  const { state, actions } = usePlanner();
  const t = useT();
  const ranked = rankRuns(state.runs);
  const max = scaleMax(ranked);
  const bestRun = ranked.find((r) => hasSolution(r) && r.record.evaluation!.feasible) ?? null;
  const invalid = ranked.filter((r) => hasSolution(r) && !r.record.evaluation!.feasible).length;
  const unreadable = ranked.filter((r) => !hasSolution(r)).length;
  const hasLlm = state.runs.some((r) => r.record.role !== "classic");
  const origins = new Set(ranked.map((r) => r.origin));
  const allPrecalc = origins.size === 1 && origins.has("precalculada");
  const methods = new Set(ranked.map((r) => r.record.method)).size;
  const n = ranked.length;

  return (
    <section
      data-testid="comparison"
      data-tour="comparison"
      data-zone
      aria-labelledby="comparison-title"
      className="panel flex min-h-0 flex-col min-[1180px]:flex-1"
    >
      <span className="flex items-center gap-2">
        <span className="kicker">
          {t({ es: "Comparativa", en: "Comparison" })}
          {allPrecalc ? ` · ${t(ORIGIN_LABELS.precalculada)}` : ""}
        </span>
        <Help term="coste" note={mapNote(state.instance, t)} size="sm" />
      </span>
      <h2 id="comparison-title" className="panel-title">
        {n === 0
          ? t({ es: "Sin planes todavía", en: "No plans yet" })
          : `${n} ${n === methods ? t({ es: "métodos", en: "methods" }) : t({ es: "planes", en: "plans" })}, ${t({ es: "el mismo reparto", en: "the same deliveries" })}`}
      </h2>
      {(invalid > 0 || unreadable > 0) && (
        <p className="mt-1 text-base text-fg-3">
          {invalid > 0 && (
            <span className="text-late">
              {invalid} {t({ es: "no válidos", en: "not valid" })}
            </span>
          )}
          {invalid > 0 && unreadable > 0 && " · "}
          {unreadable > 0 && `${unreadable} ${t({ es: "sin respuesta", en: "with no answer" })}`}
        </p>
      )}

      {n > 0 ? (
        <ol
          aria-label={t({ es: "Planes ordenados por coste", en: "Plans sorted by cost" })}
          className="-mr-2 mt-2.5 flex max-h-[30rem] min-h-0 flex-col gap-1.5 overflow-y-auto overscroll-contain pr-2 [scrollbar-width:thin] min-[761px]:max-h-[36rem] min-[1180px]:max-h-[21.5rem]"
        >
          {ranked.map((run, i) => (
            <Row
              key={run.key}
              run={run}
              index={i}
              max={max}
              best={run.key === bestRun?.key}
              bestScore={bestRun?.record.evaluation?.score ?? null}
              instance={state.instance}
              selected={run.key === state.selectedKey}
              showOrigin={!allPrecalc}
              onSelect={() => actions.selectRun(run.key)}
            />
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-fg-2">
          {t({ es: "Abre «Resolver» para calcular planes de este caso.", en: "Open “Solve” to compute plans for this case." })}
        </p>
      )}

      <p className="mt-auto pt-2 text-base leading-snug text-fg-3">
        <b className="font-semibold text-fg-2">{costLine(state.instance, t)}</b>
        {state.meta?.id && !hasLlm && (
          <span data-testid="llm-live-only" className="block">
            {t({ es: "Sin IA precalculada: la IA va en vivo, con tu clave.", en: "No precomputed AI: the AI runs live, with your key." })}
          </span>
        )}
      </p>
    </section>
  );
}
