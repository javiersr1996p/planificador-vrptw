"use client";

import { Help } from "@/components/ui/Help";
import { useFormat } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { groupViolations } from "@/lib/labels";
import type { components } from "@/lib/types";
import { CaseSource } from "./CaseInfo";
import { hasSolution, usePlanner } from "./store";
import { formatSpan, isReal } from "./units";

type S = components["schemas"];
type ViolationType = S["Violation"]["type"];

/** Reglas del plan válido y las violaciones que incumplen cada una. */
const RULES: { id: string; types: ViolationType[] }[] = [
  { id: "served", types: ["unserved", "duplicate", "unknown_customer"] },
  { id: "capacity", types: ["capacity"] },
  { id: "late", types: ["late"] },
  { id: "other", types: ["fleet_exceeded", "depot_due"] },
];

function Mark({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-7 place-items-center rounded-tag border ${
        ok ? "border-ok/40 bg-ok/10 text-ok" : "border-late/45 bg-late/10 text-late"
      }`}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="size-4">
        {ok ? <path d="m3 8.5 3.2 3L13 4.5" /> : <path d="M4 4l8 8M12 4l-8 8" />}
      </svg>
    </span>
  );
}

/**
 * «¿Es un plan válido?»: una fila por regla con la cifra de la evaluación y,
 * si se incumple, sus violaciones por su nombre. No es un segundo cálculo:
 * presenta lo que la evaluación ya trae. Al pie, plegado, el origen de los datos.
 */
export function Validity() {
  const { state, selected } = usePlanner();
  const t = useT();
  const { lang, formatNumber } = useFormat();
  const instance = state.instance;
  const ev = selected && hasSolution(selected) ? selected.record.evaluation! : null;
  if (!instance) return null;
  // Sin plan legible no hay nada que validar: queda solo el origen de los datos.
  if (!ev) return <CaseSource className="panel py-0" />;

  const real = isReal(instance);
  const n = instance.customers.length;
  const capacity = instance.fleet.capacity;
  const maxLoad = Math.max(0, ...ev.stops.flat().map((s) => s.load));
  const late = ev.violations.filter((v) => v.type === "late").length;
  // Retraso con los clientes. `total_late` suma además la vuelta tarde a la base, que va en su propia fila.
  const lateAtStops = ev.stops.flat().reduce((sum, s) => sum + s.late, 0);
  const lateText = real ? formatSpan(lateAtStops, true, lang) : formatNumber(lateAtStops, 1);

  const rows = RULES.map((rule) => {
    const groups = groupViolations(ev.violations.filter((v) => rule.types.includes(v.type)));
    const value =
      rule.id === "served"
        ? `${n - ev.unserved}/${n}`
        : rule.id === "capacity"
          ? `${t({ es: "máx.", en: "max" })} ${formatNumber(maxLoad, 0)}`
          : rule.id === "late"
            ? late > 0
              ? `${late} · ${lateText}`
              : lateText
            : "";
    const label =
      rule.id === "served"
        ? t({ es: "Todos los clientes atendidos", en: "All customers served" })
        : rule.id === "capacity"
          ? capacity != null
            ? t({ es: `Ninguna pasa de ${formatNumber(capacity, 0)} uds.`, en: `None goes over ${formatNumber(capacity, 0)} units` })
            : t({ es: "Carga sin límite en este caso", en: "No load limit in this case" })
          : rule.id === "late"
            ? t({ es: "Nadie recibe tarde", en: "No late deliveries" })
            : t({ es: "Flota y vuelta a la base", en: "Fleet and return to depot" });
    const ok = rule.id === "capacity" ? groups.length === 0 && ev.overload <= 0 : groups.length === 0;
    return { ...rule, label, value, ok, groups };
  }).filter((r) => r.id !== "other" || !r.ok);

  return (
    <section data-testid="validity" data-zone aria-labelledby="validity-title" className="panel">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className="kicker" id="validity-title">
            {t({ es: "¿Es un plan válido?", en: "Is it a valid plan?" })}
          </span>
          <Help term="valido" size="sm" />
        </span>
        <b
          data-testid="validity-verdict"
          className={`font-display text-[20px] leading-none font-bold tracking-[0.03em] ${ev.feasible ? "text-ok" : "text-late"}`}
        >
          {ev.feasible ? t({ es: "Sí, válido", en: "Yes, valid" }) : t({ es: "No válido", en: "Not valid" })}
        </b>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {rows.map((r) => (
          <li
            key={r.id}
            data-testid="validity-check"
            data-rule={r.id}
            data-ok={r.ok ? "true" : "false"}
            className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 text-base text-fg-2"
          >
            <Mark ok={r.ok} />
            <span className={r.ok ? "" : "font-semibold text-fg"}>
              {r.label}
              <span className="sr-only">{r.ok ? t({ es: ": se cumple", en: ": met" }) : t({ es: ": no se cumple", en: ": not met" })}</span>
            </span>
            <span className={`num text-base font-semibold whitespace-nowrap ${r.ok ? "text-fg" : "text-late"}`}>{r.value}</span>
            {!r.ok && (
              <span className="col-start-2 col-end-4 flex flex-wrap gap-1.5">
                <span className="font-semibold text-late">{t({ es: "No se cumple:", en: "Not met:" })}</span>
                {r.groups.map((g) => (
                  <span key={g.type} className="rounded-tag bg-late/15 px-1.5 text-late">
                    {t(g.label)} ({g.count})
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
      <CaseSource className="mt-2 -mb-3 border-t border-line" />
    </section>
  );
}
