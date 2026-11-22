"use client";

import { formatNumber } from "@/lib/format";
import { useLang, useT } from "@/lib/i18n";
import { type Instance, type StopInfo, isLate, placeName, vehicleColor } from "./geometry";
import type { Units } from "./schedule";

type Props = {
  instance: Instance;
  customer: number;
  info: StopInfo | undefined;
  units: Units;
  onClose: () => void;
};

/** Ficha de una parada: nombre, ventana, llegada, espera, retraso y carga, tal como vienen en la evaluación. */
export function StopCard({ instance, customer, info, units, onClose }: Props) {
  const [lang] = useLang();
  const t = useT();
  const qty = (v: number) => formatNumber(v, Number.isInteger(v) ? 0 : 1, lang);
  const c = instance.customers.find((x) => x.id === customer);
  const ev = info?.evaluation ?? null;
  const late = isLate(info);
  const capacity = instance.fleet.capacity;
  const name = placeName(c?.address);

  // [id, rótulo, valor, data-testid]
  const rows: [string, string, string, string?][] = [];
  if (c) {
    const from = t({ es: "desde", en: "from" });
    rows.push(["window", t({ es: "Ventana", en: "Window" }), c.due == null ? `${from} ${units.clock(c.ready)}` : `${units.clock(c.ready)}–${units.clock(c.due)}`]);
  }
  if (ev) {
    rows.push(
      ["arrival", t({ es: "Llegada", en: "Arrival" }), units.clock(ev.arrival), "stop-card-arrival"],
      ["wait", t({ es: "Espera", en: "Wait" }), units.span(ev.wait)],
      ["late", t({ es: "Retraso", en: "Late" }), units.span(ev.late)],
      ["load", t({ es: "Carga", en: "Load" }), capacity ? `${qty(ev.load)}/${qty(capacity)}` : qty(ev.load)],
    );
  }

  return (
    <div data-testid="stop-card" className="hud pointer-events-auto w-full px-3 pb-2.5 pt-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="num flex flex-wrap items-center gap-x-2 text-xs font-semibold uppercase tracking-widest text-fg-2">
            <span>
              {t({ es: "Cliente", en: "Customer" })} {customer}
            </span>
            {info ? (
              <span className="flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-full" style={{ background: vehicleColor(info.route) }} />
                {t({ es: "F", en: "V" })}
                {info.route + 1} · {t({ es: "parada", en: "stop" })} {info.position}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-late">
                <span className="inline-block size-2.5 rounded-[3px] border-2 border-dashed border-late" />
                {t({ es: "Sin atender", en: "Unserved" })}
              </span>
            )}
          </p>
          {name && (
            <p className="mt-1 truncate text-base font-semibold leading-tight" title={c?.address ?? undefined}>
              {name}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t({ es: "Cerrar ficha", en: "Close card" })}
          className="-mr-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-full text-2xl leading-none text-fg-2 hover:bg-white/5 hover:text-fg"
        >
          ×
        </button>
      </div>
      {rows.length > 0 && (
        <dl className="mt-1 grid grid-cols-3 gap-x-3 gap-y-1.5">
          {rows.map(([key, k, v, id]) => (
            <div key={key} className={key === "window" ? "col-span-2" : undefined}>
              <dt className="num text-xs uppercase tracking-widest text-fg-3">{k}</dt>
              <dd data-testid={id} className={`num text-base font-semibold ${key === "late" && late ? "text-late" : "text-fg"}`}>
                {key === "late" && late ? `◆ ${v}` : v}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
