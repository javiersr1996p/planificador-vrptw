"use client";

import { Fragment } from "react";
import { CasePanel } from "@/components/case/CasePanel";
import { useLang, useT } from "@/lib/i18n";
import { SOURCE_LABELS, matrixLabel } from "@/lib/labels";
import { usePlanner } from "./store";
import { formatClock, isReal } from "./units";

/** Texto con sus URL convertidas en enlaces, sin interpretar HTML. */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-fg-2">
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Origen de los datos del caso: nota y atribución, plegadas en una línea (al pie de la validez). */
export function CaseSource({ className }: { className?: string }) {
  const { state } = usePlanner();
  const t = useT();
  const { instance, meta } = state;
  if (!instance || !meta || (!meta.note && !meta.attribution)) return null;
  return (
    <details data-testid="case-source" className={["group/src", className].filter(Boolean).join(" ")}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-base text-fg-2 select-none [@media(hover:hover)]:hover:text-fg [&::-webkit-details-marker]:hidden">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="transition-transform duration-150 group-open/src:rotate-90">
          <path d="M4 2 L8 6 L4 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        Origen de los datos
        <span className="kicker ml-auto text-fg-3">{t(SOURCE_LABELS[instance.source])}</span>
      </summary>
      <div className="flex flex-col gap-2 pb-2 text-base leading-snug text-fg-2">
        {meta.note && <p>{meta.note}</p>}
        {meta.attribution && (
          <p className="text-fg-3">
            <Linkified text={meta.attribution} />
          </p>
        )}
      </div>
    </details>
  );
}

/**
 * Pestaña «Tu caso»: el caso cargado, sus cifras y el hueco para cargar uno propio.
 * Con el formulario abierto, la ficha se pliega a su nombre para dejarle sitio.
 */
export function CaseInfo() {
  const { state } = usePlanner();
  const t = useT();
  const [lang] = useLang();
  const { instance, meta } = state;

  return (
    <div data-testid="case-info" className="group/info flex flex-col gap-3">
      {instance && meta && (
        <>
          <div>
            <span className="kicker text-fg-3">Caso cargado · {t(SOURCE_LABELS[instance.source])}</span>
            <h3 className="mt-1.5 font-display text-[22px] leading-tight font-bold">{meta.name}</h3>
          </div>
          <dl data-testid="case-facts" className="grid grid-cols-2 gap-2 group-has-[[data-mode=form]]/info:hidden">
            {[
              ["Clientes", String(instance.customers.length)],
              ["Flota", `${instance.fleet.vehicles} furgonetas`],
              ["Capacidad", instance.fleet.capacity != null ? String(instance.fleet.capacity) : "sin límite"],
              [
                "Jornada",
                instance.depot.due != null
                  ? `${formatClock(instance.depot.ready, isReal(instance), lang)}–${formatClock(instance.depot.due, isReal(instance), lang)}`
                  : "abierta",
              ],
              ["Distancias", instance.matrix ? t(matrixLabel(instance.matrix.source)) : "–"],
              ["Unidades", isReal(instance) ? "km y HH:MM" : "las del caso"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-tag border border-line bg-black/25 px-2.5 py-1.5">
                <dt className="font-mono text-[12px] tracking-[0.1em] text-fg-3 uppercase">{label}</dt>
                <dd className="num text-base font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <CasePanel />
    </div>
  );
}
