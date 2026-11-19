"use client";

import { useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { LlmExplain } from "@/components/llm/LlmPanel";
import { Help } from "@/components/ui/Help";
import { formatNumber } from "@/lib/format";
import { methodLabel } from "@/lib/labels";
import { playback } from "@/lib/playback";
import type { components } from "@/lib/types";
import { axisTicks, customersById, focusRoute, timeDomain, vehicleDays, type VehicleDay } from "./schedule";
import { hasSolution, usePlanner } from "./store";
import { customerName, formatClock, formatSpan, isReal, vehicleColor } from "./units";

type S = components["schemas"];

/**
 * Columnas del detalle: nombre y pista (y, en escritorio, las cifras a la
 * derecha; en móvil van debajo). Los desplazamientos sitúan la rejilla de
 * horas y el cursor sobre la columna de la pista.
 */
const COLS = "grid-cols-[112px_minmax(0,1fr)] min-[761px]:grid-cols-[230px_minmax(0,1fr)_262px]";
const TRACK_OFFSET = "left-[122px] right-0 min-[761px]:left-[240px] min-[761px]:right-[272px]";

/**
 * Cifras de cada parada en tres columnas fijas, para que queden bajo sus rótulos
 * «Llegada · Espera · Carga», que se escriben una sola vez. Pasan por encima del
 * cursor y de la rejilla de horas.
 */
const NUMS =
  "relative z-[1] grid w-full max-w-[262px] grid-cols-[60px_minmax(0,1fr)_64px] gap-x-3 font-sans min-[761px]:pl-3 text-[12px] leading-[1.35] tracking-[0.03em] text-fg-3 uppercase [text-shadow:0_0_2px_var(--ink-1),0_0_4px_var(--ink-1)]";

/** Rótulos de las columnas de cifras. Cada fila los repite solo para lectores de pantalla. */
function StopColumns({ className }: { className: string }) {
  return (
    <div data-testid="stop-columns" aria-hidden="true" className={`${NUMS} ${className}`}>
      <span>Llegada</span>
      <span>Espera</span>
      <span>Carga</span>
    </div>
  );
}

const HATCH = "repeating-linear-gradient(135deg,var(--wait) 0 3px,transparent 3px 6px)";

/** En móvil, una furgoneta con muchas paradas enseña estas primeras y pliega el resto tras un botón. */
const FOLD_SHOW = 6;

/** Pestañas por furgoneta, con su carga; se manejan con flechas, Inicio y Fin. */
function VehicleTabs({
  days,
  shown,
  capacity,
  onPick,
}: {
  days: VehicleDay[];
  shown: number;
  capacity: number | null | undefined;
  onPick: (route: number) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const n = days.length;

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const next =
      e.key === "ArrowRight" ? (i + 1) % n
      : e.key === "ArrowLeft" ? (i - 1 + n) % n
      : e.key === "Home" ? 0
      : e.key === "End" ? n - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    onPick(next);
    refs.current[next]?.focus();
  }

  return (
    <div className="-mx-1 max-w-full min-w-0 overflow-x-auto px-1 py-1 [scrollbar-width:thin] max-[760px]:w-full">
      <div role="tablist" aria-label="Elige furgoneta" className="flex w-max min-w-full gap-1.5">
        {days.map((d, i) => {
          const load = d.stops.length ? d.stops[d.stops.length - 1].load : 0;
          const share = capacity ? Math.min(1, load / capacity) : 1;
          const active = i === shown;
          return (
            <button
              key={d.route}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`veh-tab-${i}`}
              aria-selected={active}
              aria-controls="veh-panel"
              tabIndex={active ? 0 : -1}
              data-testid="detail-lane"
              data-route={i}
              onClick={() => onPick(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              style={{ "--c": vehicleColor(i) } as CSSProperties}
              className={`grid min-h-12 grid-cols-[auto_auto] items-center justify-start gap-x-2 gap-y-[5px] rounded-[10px] border px-3 py-1.5 text-left transition-[background-color,border-color] duration-200 ease-[var(--ease-out)] ${
                n <= 3 ? "max-[760px]:flex-1" : ""
              } shrink-0 ${
                active
                  ? "border-[var(--c)] bg-white/[0.06] shadow-[0_0_18px_-8px_var(--c)]"
                  : "border-line bg-white/[0.03] [@media(hover:hover)]:hover:bg-white/[0.07]"
              }`}
            >
              <span aria-hidden="true" className="size-3 rounded-full bg-[var(--c)] shadow-[0_0_8px_var(--c)]" />
              <b className="text-base leading-none font-semibold whitespace-nowrap">
                <span className="max-[760px]:hidden">Furgoneta </span>
                <span className="min-[761px]:hidden">F</span>
                {i + 1}
              </b>
              <span className="col-span-2 flex items-center gap-1.5 font-mono text-[12px] leading-none tracking-[0.04em] whitespace-nowrap text-fg-3 uppercase">
                <span
                  aria-hidden="true"
                  className="block h-1 w-[30px] rounded-sm min-[761px]:w-[54px]"
                  style={{ background: `linear-gradient(90deg,var(--c) ${share * 100}%,rgb(255 255 255/0.12) ${share * 100}%)` }}
                />
                <span className="max-[760px]:hidden">carga </span>
                {formatNumber(load, 0)}
                {capacity ? `/${formatNumber(capacity, 0)}` : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Cursor de la hora simulada sobre la línea de tiempo. */
function NowCursor({ lo, hi, real }: { lo: number; hi: number; real: boolean }) {
  const t = useSyncExternalStore(playback.subscribe, () => playback.getSnapshot().t, () => lo);
  if (t < lo || t > hi) return null;
  const p = ((t - lo) / (hi - lo)) * 100;
  return (
    <span aria-hidden="true" className="absolute top-0 bottom-0 w-0" style={{ left: `${p}%` }}>
      <span className="absolute top-[22px] bottom-0 left-0 w-[1.5px] -translate-x-1/2 bg-amber shadow-[0_0_4px_var(--amber)]" />
      {/* Se desplaza tanto como avanza el día: en los extremos tapa entera la hora del eje. */}
      <span
        data-axis
        className="num absolute top-0 left-0 rounded-[4px] bg-amber px-1.5 py-[3px] text-[12px] leading-none font-semibold whitespace-nowrap text-amber-ink"
        style={{ transform: `translateX(-${p}%)` }}
      >
        {formatClock(t, real)}
      </span>
    </span>
  );
}

function Badge({ children, base, color, late }: { children: string; base?: boolean; color: string; late?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-[22px] flex-none place-items-center border-[1.5px] font-mono text-[12px] leading-none font-bold uppercase ${
        base ? "rounded-[6px] border-amber bg-[#1a1203] text-amber" : "rounded-full bg-[#07101f] text-fg"
      } ${late ? "border-late bg-late/20" : ""}`}
      style={base || late ? undefined : { borderColor: color }}
    >
      {children}
    </span>
  );
}

/** Marca de hora dentro de la pista, a la izquierda si queda cerca del borde derecho. */
function TimeMark({ p, children, testId }: { p: number; children: string; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className={`num absolute top-1/2 -translate-y-1/2 text-base leading-none whitespace-nowrap text-fg-2 ${p > 80 ? "-translate-x-[calc(100%+12px)]" : "translate-x-3"}`}
      style={{ left: `${p}%` }}
    >
      {children}
    </span>
  );
}

/** Línea de tiempo de una furgoneta: salida, cada parada con su ventana, y vuelta. */
function Timeline({ instance, day, lo, hi }: { instance: S["Instance"]; day: VehicleDay; lo: number; hi: number }) {
  const [open, setOpen] = useState(false);
  // Sin paradas no hay salida ni vuelta: la hora que trae `depot_arrival` es la de apertura de la base.
  if (day.stops.length === 0) {
    return (
      <p role="tabpanel" id="veh-panel" aria-labelledby={`veh-tab-${day.route}`} className="py-2 text-fg-2">
        Esta furgoneta no sale de la base: no tiene paradas.
      </p>
    );
  }
  const real = isReal(instance);
  const byId = customersById(instance);
  const color = vehicleColor(day.route);
  const capacity = instance.fleet.capacity;
  const pct = (t: number) => ((Math.min(Math.max(t, lo), hi) - lo) / (hi - lo)) * 100;
  const span = (a: number, b: number) => ({ left: `${pct(a)}%`, width: `${Math.max(0, pct(b) - pct(a))}%` });
  const ticks = axisTicks(lo, hi, real, 6);
  const fine = real ? axisTicks(lo, hi, true, 12) : ticks;

  // Salida de cada parada (inicio más servicio): de ahí parte el trayecto a la siguiente.
  const leave = day.stops.map((s) => s.start + (byId.get(s.customer)?.service ?? 0));
  const lastLeave = leave.length ? leave[leave.length - 1] : day.departure;
  const row = `grid ${COLS} items-center gap-x-2.5`;
  // Plegar menos de tres paradas no compensa el botón. Si alguna plegada llega tarde, el botón lo dice.
  const foldable = day.stops.length > FOLD_SHOW + 2;
  const folded = foldable && !open;
  const hiddenLate = day.stops.slice(FOLD_SHOW).filter((s) => s.late > 0).length;

  return (
    <div role="tabpanel" id="veh-panel" aria-labelledby={`veh-tab-${day.route}`} className="relative">
      {/* Rejilla de horas y cursor, sobre la columna de pistas. */}
      <div aria-hidden="true" className={`pointer-events-none absolute inset-y-0 ${TRACK_OFFSET}`}>
        {fine.map((t) => (
          <span key={t} className="absolute top-[22px] bottom-0 w-px bg-[rgb(150_180_230/0.08)]" style={{ left: `${pct(t)}%` }} />
        ))}
      </div>
      <div className={row}>
        <span />
        <div data-axis aria-hidden="true" className="relative h-[22px] font-mono text-[12px] leading-none text-fg-3">
          {ticks.map((t) => {
            const p = pct(t);
            const shift = p < 4 ? "" : p > 96 ? "-translate-x-full" : "-translate-x-1/2";
            return (
              <span key={t} className={`absolute top-1 ${shift}`} style={{ left: `${p}%` }}>
                {real ? (
                  <>
                    {formatClock(t, true).slice(0, 2)}
                    <span className="max-[760px]:hidden">:00</span>
                  </>
                ) : (
                  formatClock(t, false).replace(/,0$/, "")
                )}
              </span>
            );
          })}
        </div>
        <StopColumns className="self-start pt-1 leading-none max-[760px]:hidden" />
      </div>

      <ol id="veh-stops" aria-label={`Paradas de la furgoneta ${day.route + 1}`} className="relative flex flex-col">
        <li className={`${row} min-h-[30px] min-[761px]:min-h-8`}>
          <span className="flex min-w-0 items-center gap-2.5">
            <Badge base color={color}>
              B
            </Badge>
            <span className="truncate text-fg-2">
              Salida<span className="max-[760px]:hidden"> de la base</span>
            </span>
          </span>
          <span className="relative h-[22px]">
            <span className="absolute top-1/2 size-2.5 -translate-1/2 rounded-full" style={{ left: `${pct(day.departure)}%`, background: color }} />
            <TimeMark p={pct(day.departure)}>{formatClock(day.departure, real)}</TimeMark>
          </span>
          <StopColumns className="col-span-2 pb-0.5 min-[761px]:hidden" />
        </li>

        {day.stops.map((s, k) => {
          const c = byId.get(s.customer);
          const service = c?.service ?? 0;
          const late = s.late > 0;
          const from = k === 0 ? day.departure : leave[k - 1];
          return (
            <li
              key={`${s.customer}-${k}`}
              data-testid="detail-stop"
              data-customer={s.customer}
              data-late={late ? "true" : undefined}
              className={`grid ${COLS} items-center gap-x-2.5 border-t border-white/[0.04] py-0.5 [grid-template-areas:'label_track'_'nums_nums'] min-[761px]:min-h-8 min-[761px]:py-[3px] min-[761px]:[grid-template-areas:'label_track_nums'] ${
                late ? "bg-late/[0.06]" : ""
              } ${folded && k >= FOLD_SHOW ? "max-[760px]:hidden" : ""}`}
            >
              <span className="flex min-w-0 items-center gap-2.5 [grid-area:label]">
                <Badge color={color} late={late}>
                  {String(s.customer)}
                </Badge>
                <span className="truncate text-fg" title={c?.address ?? undefined}>
                  {customerName(c, s.customer, real)}
                </span>
              </span>
              <span className="relative h-[22px] [grid-area:track]">
                {c && (
                  <span
                    className="absolute inset-y-0 rounded-[5px] border-[1.2px] border-[rgb(236_241_250/0.5)] bg-white/[0.045]"
                    style={span(c.ready, c.due)}
                  />
                )}
                <span
                  className="absolute top-1/2 h-0 border-t-[1.6px] border-dashed opacity-75"
                  style={{ ...span(from, s.arrival), borderColor: color }}
                />
                {s.wait > 0 && (
                  <span className="absolute top-1/2 h-2 -translate-y-1/2" style={{ ...span(s.arrival, s.start), background: HATCH }} />
                )}
                {late && c && <span className="absolute top-1/2 h-2.5 -translate-y-1/2 bg-late" style={span(c.due, s.start)} />}
                <span
                  className={`absolute top-1/2 h-3.5 min-w-[3px] -translate-y-1/2 rounded-[2px] ${
                    late ? "bg-late shadow-[0_0_8px_rgb(255_103_103/0.7)]" : "bg-ok shadow-[0_0_8px_rgb(78_240_162/0.6)]"
                  }`}
                  style={span(s.start, s.start + service)}
                />
                <span
                  className="absolute top-1/2 size-2 -translate-1/2 rounded-full"
                  style={{ left: `${pct(s.arrival)}%`, background: color }}
                />
              </span>
              {/* En móvil las cifras van bajo la pista. Los rótulos, una sola vez arriba. */}
              <dl className={`${NUMS} [grid-area:nums]`}>
                <div>
                  <dt className="sr-only">Llegada</dt>
                  <dd data-testid="stop-arrival" className="font-semibold text-fg-2">
                    {formatClock(s.arrival, real)}
                  </dd>
                </div>
                {/* Quien llega tarde no espera: en su columna va el retraso, en rojo y con su nombre. */}
                {!late && (
                  <div>
                    <dt className="sr-only">Espera</dt>
                    <dd data-testid="stop-wait" className="font-semibold text-fg-2">
                      {s.wait > 0 ? formatSpan(s.wait, real) : "–"}
                    </dd>
                  </div>
                )}
                {late && (
                  <div className="flex flex-wrap gap-x-1 font-bold text-late">
                    <dt>Retraso</dt>
                    <dd data-testid="stop-late">{formatSpan(s.late, real)}</dd>
                  </div>
                )}
                <div>
                  <dt className="sr-only">Carga</dt>
                  <dd data-testid="stop-load" className="font-semibold text-fg-2">
                    {formatNumber(s.load, 0)}
                    {capacity ? ` / ${formatNumber(capacity, 0)}` : ""}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}

        {foldable && (
          <li className="border-t border-white/[0.04] py-1.5 min-[761px]:hidden">
            <button
              type="button"
              data-testid="detail-more"
              aria-expanded={open}
              aria-controls="veh-stops"
              onClick={() => setOpen(!open)}
              className="btn w-full"
            >
              {open
                ? "Ver menos paradas"
                : `Ver ${day.stops.length - FOLD_SHOW} paradas más${hiddenLate ? ` (${hiddenLate} con retraso)` : ""}`}
            </button>
          </li>
        )}

        {day.back !== null && (
          <li className={`${row} min-h-[30px] border-t border-white/[0.04] min-[761px]:min-h-8`}>
            <span className="flex min-w-0 items-center gap-2.5">
              <Badge base color={color}>
                B
              </Badge>
              <span className="truncate text-fg-2">
                Vuelta<span className="max-[760px]:hidden"> a la base</span>
              </span>
            </span>
            <span className="relative h-[22px]">
              <span
                className="absolute top-1/2 h-0 border-t-[1.6px] border-dashed opacity-75"
                style={{ ...span(lastLeave, day.back), borderColor: color }}
              />
              <span className="absolute top-1/2 size-2.5 -translate-1/2 rounded-full" style={{ left: `${pct(day.back)}%`, background: color }} />
              <TimeMark p={pct(day.back)} testId="depot-return">
                {formatClock(day.back, real)}
              </TimeMark>
            </span>
          </li>
        )}
      </ol>

      <div className={`pointer-events-none absolute inset-y-0 ${TRACK_OFFSET}`}>
        <NowCursor lo={lo} hi={hi} real={real} />
      </div>
    </div>
  );
}

function Key({ swatch, children }: { swatch: CSSProperties; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-[761px]:gap-2">
      <span aria-hidden="true" className="inline-block w-5 flex-none rounded-[3px]" style={swatch} />
      {children}
    </span>
  );
}

/**
 * «El día de la furgoneta N»: pestañas por furgoneta, leyenda y línea de
 * tiempo con la salida, cada parada y la vuelta a la base (`depot_arrival`).
 */
export function RunDetail({ onShowLate }: { onShowLate?: () => void }) {
  const { state, selected, actions } = usePlanner();
  const instance = state.instance;
  const ev = selected && hasSolution(selected) ? selected.record.evaluation! : null;
  const days = useMemo(() => (instance && ev ? vehicleDays(instance, ev) : []), [instance, ev]);
  if (!instance) return null;

  if (!selected || !ev) {
    return (
      <section data-testid="detail" data-tour="detail" data-zone className="panel">
        <span className="kicker">Detalle</span>
        <p className="mt-2 text-fg-2">Elige un plan de la comparativa para ver el día de cada furgoneta.</p>
      </section>
    );
  }

  const { record, origin } = selected;
  const real = isReal(instance);
  const [lo, hi] = timeDomain(instance, days);
  const n = days.length;
  const route = state.selectedRoute !== null && state.selectedRoute < n ? state.selectedRoute : null;
  const shown = route ?? focusRoute(ev);
  const day = days[shown];
  const color = vehicleColor(shown);
  const anyLate = ev.stops.some((r) => r.some((s) => s.late > 0));
  const unserved = ev.violations.filter((v) => v.type === "unserved" && v.customer != null).map((v) => v.customer!);
  const model = record.model_returned ?? record.model_requested;
  const byId = customersById(instance);

  return (
    <section
      data-testid="detail"
      data-tour="detail"
      data-zone
      data-selected-route={route ?? "all"}
      aria-labelledby="detail-title"
      className="panel"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2.5">
        <div className="min-w-0">
          <span className="kicker">Detalle</span>
          <h2 id="detail-title" className="panel-title">
            El día de la furgoneta {shown + 1}
          </h2>
        </div>
        <div className="flex max-w-full min-w-0 items-center gap-2 max-[760px]:w-full">
          {route !== null && (
            <button
              type="button"
              title="Ver todas las furgonetas en el mapa"
              onClick={() => actions.selectRoute(null)}
              className="btn min-h-12 shrink-0 rounded-[10px] px-3"
            >
              ← Todas
            </button>
          )}
          <VehicleTabs days={days} shown={shown} capacity={instance.fleet.capacity} onPick={(i) => actions.selectRoute(i)} />
        </div>
      </div>

      <div className="mt-3 mb-2 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-base text-fg-2 min-[761px]:gap-x-[18px]">
        <Key swatch={{ height: 16, border: "1.5px solid rgb(236 241 250 / 0.6)", background: "rgb(255 255 255 / 0.05)" }}>
          Ventana horaria
          <Help term="ventana" size="sm" />
        </Key>
        <Key swatch={{ height: 8, background: HATCH }}>Espera</Key>
        <Key swatch={{ height: 12, background: "var(--ok)", boxShadow: "0 0 8px rgb(78 240 162 / 0.6)" }}>Entrega</Key>
        <Key swatch={{ height: 12, background: "var(--late)" }}>
          Retraso
          <Help term="retraso" size="sm" />
        </Key>
        <Key swatch={{ height: 0, borderTop: `2px dashed ${color}`, borderRadius: 0 }}>Trayecto</Key>
        {onShowLate && !anyLate && (
          <button type="button" data-testid="show-late" onClick={onShowLate} className="btn min-[761px]:ml-auto">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-late shadow-[0_0_10px_var(--late)]" />
            Ver un plan que llega tarde
          </button>
        )}
      </div>

      {/* Otra furgoneta u otro plan empiezan plegados. */}
      {day && <Timeline key={`${selected.key}:${shown}`} instance={instance} day={day} lo={lo} hi={hi} />}

      {unserved.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 rounded-tag border border-late/40 bg-late/10 px-3 py-2">
          <p className="font-semibold text-late">
            <span aria-hidden="true">✕ </span>Sin atender ({unserved.length})
          </p>
          <p className="flex flex-wrap gap-1.5">
            {unserved.map((c) => (
              <span key={c} className="rounded-tag bg-ink-2 px-1.5 text-fg">
                {customerName(byId.get(c), c, real)}
              </span>
            ))}
          </p>
        </div>
      )}

      {/* Hueco a la derecha para «Explicar», que se pinta sobre esta línea. */}
      <p className="mt-2.5 truncate border-t border-line pt-2 pr-24 font-mono text-[12px] leading-tight tracking-[0.06em] text-fg-3 uppercase">
        {methodLabel(record.method)} · {origin}
        {model ? ` · ${model}` : ""} · run_id <span data-testid="detail-run-id">{record.run_id}</span>
      </p>

      <LlmExplain run={selected} />
    </section>
  );
}
