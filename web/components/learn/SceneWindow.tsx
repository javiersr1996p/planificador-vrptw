"use client";

import { useId, useState } from "react";
import { formatSpan } from "@/components/planner/units";
import { Help } from "@/components/ui/Help";
import { formatTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Stage, StateIcon } from "./parts";
import { SceneFrame } from "./SceneFrame";
import { TOY_ARRIVAL, TOY_DAY, TOY_WINDOW } from "./toy";

type WindowState = "wait" | "ok" | "late";

const pct = (t: number) => ((t - TOY_DAY.start) / (TOY_DAY.end - TOY_DAY.start)) * 100;
const HOURS = Array.from({ length: (TOY_DAY.end - TOY_DAY.start) / 60 + 1 }, (_, i) => TOY_DAY.start + i * 60);

const TONE: Record<WindowState, string> = {
  wait: "border-wait/60 bg-wait/10 text-wait",
  ok: "border-ok/60 bg-ok/10 text-ok",
  late: "border-late/60 bg-late/10 text-late",
};

/** Escena 2: un deslizador mueve la hora de llegada frente a la ventana del cliente. */
export function SceneWindow() {
  const t = useT();
  const [arrival, setArrival] = useState(TOY_ARRIVAL);
  const sliderId = useId();
  const state: WindowState = arrival < TOY_WINDOW.ready ? "wait" : arrival > TOY_WINDOW.due ? "late" : "ok";
  const label =
    state === "wait"
      ? t({ es: `Espera ${formatSpan(TOY_WINDOW.ready - arrival, true)}`, en: `Wait ${formatSpan(TOY_WINDOW.ready - arrival, true)}` })
      : state === "late"
        ? t({ es: `Retraso de ${formatSpan(arrival - TOY_WINDOW.due, true)}`, en: `Late by ${formatSpan(arrival - TOY_WINDOW.due, true)}` })
        : t({ es: "Entrega a tiempo", en: "On-time delivery" });
  const hint =
    state === "wait"
      ? t({ es: "Llega antes de que abra: la furgoneta espera parada.", en: "Arrives before it opens: the van waits, parked." })
      : state === "late"
        ? t({ es: "Llega cuando ya cerró: el plan deja de ser válido.", en: "Arrives after it closed: the plan is no longer valid." })
        : t({ es: "Llega con la ventana abierta: entrega y sigue.", en: "Arrives with the window open: it delivers and moves on." });

  return (
    <SceneFrame
      n={2}
      title={t({ es: "Cada cliente tiene su horario", en: "Each customer has set hours" })}
      real={false}
      stageFirst
      lead={
        <>
          {t({ es: "Este cliente solo recibe de", en: "This customer only receives from" })} {formatTime(TOY_WINDOW.ready)}{" "}
          {t({ es: "a", en: "to" })} {formatTime(TOY_WINDOW.due)}: {t({ es: "es su", en: "that is its" })}{" "}
          <span className="whitespace-nowrap">
            <span className="term-mark text-fg">{t({ es: "ventana horaria", en: "time window" })}</span>
            <Help term="ventana" size="sm" className="ml-1.5" />
          </span>
          . {t({ es: "Mueve la hora de llegada.", en: "Move the arrival time." })}
        </>
      }
      controls={
        <div className="flex flex-col gap-3">
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={sliderId} className="text-base font-semibold">
                {t({ es: "Hora de llegada", en: "Arrival time" })}
              </label>
              <output htmlFor={sliderId} className="font-display text-[40px] leading-none font-extrabold text-amber [font-variant-numeric:tabular-nums]">
                {formatTime(arrival)}
              </output>
            </div>
            <input
              id={sliderId}
              type="range"
              className="lrn-range"
              min={TOY_DAY.start}
              max={TOY_DAY.end}
              step={5}
              value={arrival}
              aria-valuetext={`${formatTime(arrival)}: ${label}`}
              data-testid="window-slider"
              onChange={(e) => setArrival(Number(e.target.value))}
            />
          </div>
          <p
            data-testid="window-state"
            data-state={state}
            aria-live="polite"
            className={`flex items-center gap-2.5 rounded-hud border px-3 py-2.5 text-lg font-semibold ${TONE[state]}`}
          >
            <StateIcon state={state} className="size-6 flex-none" />
            {label}
          </p>
          <p className="text-base leading-snug text-fg-2">{hint}</p>
        </div>
      }
      stage={
        <Stage className="flex h-[320px] flex-col sm:h-[440px] lg:h-[560px]" data-state={state}>
          <Street arrival={arrival} state={state} />
          <Timeline arrival={arrival} state={state} />
        </Stage>
      }
    />
  );
}

/** La calle: la furgoneta ante la tienda del cliente, abierta o con la persiana bajada. */
function Street({ arrival, state }: { arrival: number; state: WindowState }) {
  const t = useT();
  const open = state === "ok";
  // El sol recorre el cielo con la hora.
  const k = (arrival - TOY_DAY.start) / (TOY_DAY.end - TOY_DAY.start);
  const sunX = 24 + k * 252;
  const sunY = 58 - Math.sin(k * Math.PI) * 36;
  const shop =
    state === "wait"
      ? t({ es: "Aún cerrado", en: "Not open yet" })
      : state === "late"
        ? t({ es: "Ya cerró", en: "Closed" })
        : t({ es: "Abierto", en: "Open" });
  const sign = state === "ok" ? "var(--ok)" : state === "wait" ? "var(--wait)" : "var(--late)";
  const mono = (size: number, weight = 600) => ({ font: `${weight} ${size}px var(--ff-mono), monospace` });
  return (
    <svg viewBox="0 0 300 196" className="min-h-0 w-full flex-1" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <circle cx={sunX} cy={sunY} r="10" style={{ fill: "var(--amber)", filter: "drop-shadow(0 0 10px var(--amber))" }} />
      {/* suelo y calzada */}
      <path d="M0 172h300" stroke="rgb(150 180 230 / 0.35)" strokeWidth="1.5" />
      <path d="M6 186h28M60 186h28M114 186h28M168 186h28M222 186h28M276 186h24" stroke="rgb(150 180 230 / 0.25)" strokeWidth="1.5" />
      {/* tienda */}
      <path d="M158 70h134l-9-16H167z" fill="#132542" stroke="rgb(150 180 230 / 0.45)" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="164" y="70" width="122" height="102" rx="3" fill="#0e1a30" stroke="rgb(150 180 230 / 0.45)" strokeWidth="1.5" />
      <rect x="172" y="80" width="106" height="24" rx="4" fill="#07101f" stroke={sign} strokeWidth="1.5" />
      <text x="225" y="96" textAnchor="middle" style={{ ...mono(12, 700), fill: sign, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {shop}
      </text>
      <text x="225" y="120" textAnchor="middle" style={{ ...mono(12), fill: "var(--fg-2)" }}>
        {formatTime(TOY_WINDOW.ready)} {t({ es: "a", en: "to" })} {formatTime(TOY_WINDOW.due)}
      </text>
      {/* puerta y persiana */}
      <rect x="203" y="128" width="44" height="44" fill="#132542" />
      <rect x="210" y="136" width="12" height="9" rx="2" fill={open ? "var(--ok)" : "rgb(150 180 230 / 0.25)"} />
      <g className="lrn-shutter" data-open={open}>
        <rect x="203" y="128" width="44" height="44" fill="#25344f" stroke="rgb(150 180 230 / 0.5)" />
        {[136, 144, 152, 160].map((y) => (
          <path key={y} d={`M205 ${y}h40`} stroke="rgb(150 180 230 / 0.3)" />
        ))}
      </g>
      {/* furgoneta, caja entregada y reloj de llegada */}
      <g transform="translate(40 128)">
        <rect x="0" y="4" width="76" height="32" rx="4" fill="#0c1729" stroke="var(--veh-1)" strokeWidth="2" />
        <path d="M76 12h18l12 13v11H76z" fill="#0c1729" stroke="var(--veh-1)" strokeWidth="2" strokeLinejoin="round" />
        <path d="M80 15h12l7 8H80z" fill="var(--veh-1)" opacity="0.5" />
        <circle cx="18" cy="38" r="6.5" fill="#04070d" stroke="var(--veh-1)" strokeWidth="2" />
        <circle cx="88" cy="38" r="6.5" fill="#04070d" stroke="var(--veh-1)" strokeWidth="2" />
        {open && <rect x="126" y="20" width="16" height="14" rx="2" fill="var(--amber)" stroke="var(--amber-ink)" />}
      </g>
      <g transform="translate(52 92)">
        <rect width="74" height="26" rx="13" fill="#07101f" stroke="var(--amber)" strokeWidth="1.5" />
        <text x="37" y="18" textAnchor="middle" style={{ ...mono(14, 700), fill: "var(--amber)" }}>
          {formatTime(arrival)}
        </text>
      </g>
    </svg>
  );
}

/** El día en una línea: la ventana, la llegada y la espera o el retraso. */
function Timeline({ arrival, state }: { arrival: number; state: WindowState }) {
  const t = useT();
  const a = pct(arrival);
  const r = pct(TOY_WINDOW.ready);
  const d = pct(TOY_WINDOW.due);
  return (
    <div className="relative mx-7 mt-2 mb-9 shrink-0 sm:mx-10 lg:mx-12">
      <p className="mb-2 font-mono text-[12px] leading-none font-semibold tracking-[0.12em] text-fg-3 uppercase">
        {t({ es: "El día del cliente", en: "The customer's day" })}
      </p>
      <div className="relative h-14">
        {/* eje */}
        <div className="absolute inset-x-0 top-1/2 h-px bg-fg-3/50" />
        {/* ventana */}
        <div className="absolute inset-y-0 rounded-tag border-2 border-ok/70 bg-ok/10" style={{ left: `${r}%`, width: `${d - r}%` }}>
          <span className="absolute top-1 left-1/2 -translate-x-1/2 font-mono text-[12px] leading-none font-semibold tracking-[0.1em] whitespace-nowrap text-ok uppercase">
            {t({ es: "Ventana", en: "Window" })}
          </span>
        </div>
        {/* espera o retraso */}
        <div
          className={`absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full ${state === "late" ? "lrn-hatch-late" : "lrn-hatch-wait"}`}
          style={{
            clipPath:
              state === "wait"
                ? `inset(0 ${100 - r}% 0 ${a}%)`
                : state === "late"
                  ? `inset(0 ${100 - a}% 0 ${d}%)`
                  : "inset(0 100% 0 0)",
          }}
        />
        {/* llegada */}
        <div className="lrn-layer" style={{ transform: `translateX(${a}%)` }}>
          <span className="absolute top-1/2 left-0 grid -translate-1/2 place-items-center">
            <StateIcon state={state} className="size-7 drop-shadow-[0_0_8px_rgb(0_0_0/0.8)]" />
          </span>
        </div>
      </div>
      <div data-axis aria-hidden="true" className="relative mt-2 h-3 font-mono text-[12px] leading-none text-fg-3">
        {HOURS.map((h) => (
          <span key={h} className="absolute -translate-x-1/2" style={{ left: `${pct(h)}%` }}>
            {String(h / 60).padStart(2, "0")}
          </span>
        ))}
      </div>
    </div>
  );
}
