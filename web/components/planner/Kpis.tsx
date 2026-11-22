"use client";

import type { CSSProperties, ReactNode } from "react";
import { useFormat } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { methodLabel } from "@/lib/labels";
import { hasSolution, usePlanner } from "./store";
import { formatSpan, isReal } from "./units";

/** Cifra con sus números grandes y sus unidades pequeñas («13 h 41 min»), sin cambiar su texto. */
function Figure({ text }: { text: string }) {
  return (
    <>
      {text.split(/([\d.,]+)/).map((part, i) =>
        /^[\d.,]+$/.test(part) ? (
          <span key={i}>{part}</span>
        ) : (
          part && (
            <span key={i} className="font-sans text-base font-semibold tracking-normal text-fg-3">
              {part}
            </span>
          )
        ),
      )}
    </>
  );
}

function Gauge({
  testId,
  value,
  raw,
  after,
  label,
  color,
}: {
  testId: string;
  value: string;
  raw: number;
  after?: ReactNode;
  label: string;
  color?: string;
}) {
  return (
    <div
      className="relative flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 overflow-hidden rounded-[10px] border border-line bg-black/30 px-3 pt-[7px] pb-2 after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:bg-[var(--gc)] after:shadow-[0_0_10px_var(--gc)]"
      style={{ "--gc": color ?? "var(--line-2)" } as CSSProperties}
    >
      <span className="font-display text-[32px] leading-[0.9] font-bold whitespace-nowrap tabular-nums" style={{ color: color ?? "var(--fg)" }}>
        <span data-testid={testId} data-value={raw}>
          <Figure text={value} />
        </span>
        {after}
      </span>
      <span className="min-w-0 text-base leading-tight text-fg-2">{label}</span>
    </div>
  );
}

/** Indicadores del plan seleccionado, tal cual los trae su evaluación. */
export function Kpis() {
  const { state, selected } = usePlanner();
  const t = useT();
  const { lang, formatNumber } = useFormat();
  const instance = state.instance;
  const ev = selected && hasSolution(selected) ? selected.record.evaluation! : null;
  const real = instance ? isReal(instance) : false;
  const span = (v: number) => (real ? formatSpan(v, true, lang) : formatNumber(v, 1));

  return (
    <section data-testid="kpis" data-zone aria-labelledby="kpi-title" className="panel pt-3 pb-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="kicker" id="kpi-title">
          Plan en el mapa
        </span>
        <b className="truncate font-display text-[20px] leading-none font-bold tracking-[0.03em]">
          {selected ? t(methodLabel(selected.record.method)) : "–"}
        </b>
      </div>
      {ev && instance ? (
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <Gauge
            testId="kpi-distance"
            value={formatNumber(ev.distance, 1)}
            raw={ev.distance}
            label={real ? "km en total" : "de distancia"}
            color="var(--amber)"
          />
          <Gauge
            testId="kpi-vehicles"
            value={String(ev.vehicles_used)}
            raw={ev.vehicles_used}
            after={<span className="font-sans text-base font-semibold text-fg-3">/{instance.fleet.vehicles}</span>}
            label="furgonetas"
          />
          <Gauge
            testId="kpi-late"
            value={span(ev.total_late)}
            raw={ev.total_late}
            label="de retraso"
            color={ev.total_late > 0 ? "var(--late)" : "var(--ok)"}
          />
          <Gauge testId="kpi-wait" value={span(ev.total_wait)} raw={ev.total_wait} label="de espera" color="var(--wait)" />
        </div>
      ) : (
        <p className="mt-3 text-fg-2">Elige un plan de la comparativa.</p>
      )}
    </section>
  );
}
