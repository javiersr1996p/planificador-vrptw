"use client";

import { useEffect, useMemo, type CSSProperties } from "react";
import { formatNumber } from "@/lib/format";
import { useLang, useT } from "@/lib/i18n";
import { nextSpeed, playback, usePlayback } from "@/lib/playback";
import type { components } from "@/lib/types";
import { axisTicks, dayRange, vehicleDays, type SegmentKind } from "./schedule";
import { formatClock, isReal, vehicleColor } from "./units";

type S = components["schemas"];

const LANE_FILL: Record<Exclude<SegmentKind, "travel">, string> = {
  wait: "rgb(255 181 71 / 0.6)",
  serve: "var(--ok)",
  late: "var(--late)",
};

/** Carriles de la barra: un trazo por furgoneta con trayecto, espera, entrega y retraso. */
function Lanes({ instance, ev, start, end }: { instance: S["Instance"]; ev: S["Evaluation"]; start: number; end: number }) {
  const days = useMemo(() => vehicleDays(instance, ev), [instance, ev]);
  const n = days.length;
  // Hasta tres furgonetas, carriles de 5 px; con más, se reparten 36 px.
  const pitch = n <= 3 ? 7 : Math.max(1.5, 36 / n);
  const height = Math.max(22, Math.ceil(n * pitch));
  const thick = n <= 3 ? 5 : Math.max(1, pitch - 0.5);
  const x = (t: number) => ((t - start) / (end - start)) * 600;
  return (
    <svg
      viewBox={`0 0 600 ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="block w-full"
      style={{ height }}
    >
      {days.map((d, v) => {
        const y = (height - n * pitch) / 2 + v * pitch;
        return (
          <g key={d.route} data-testid="lane" data-route={d.route}>
            <rect x="0" y={y + thick / 2 - 0.5} width="600" height="1" fill="rgb(255 255 255 / 0.08)" />
            {d.segments.map((s, k) => (
              <rect
                key={k}
                x={x(s.t0)}
                y={y}
                width={Math.max(0.8, x(s.t1) - x(s.t0))}
                height={thick}
                style={{ fill: s.kind === "travel" ? vehicleColor(d.route) : LANE_FILL[s.kind] }}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true" className="size-3.5">
      {playing ? (
        <>
          <rect x="2" y="1.5" width="3.6" height="11" rx="1" />
          <rect x="8.4" y="1.5" width="3.6" height="11" rx="1" />
        </>
      ) : (
        <path d="M3 1.5v11l9.5-5.5z" />
      )}
    </svg>
  );
}

/** Reloj grande: en casos reales, `HH:MM` con los dos puntos latiendo. */
function Clock({ t, real }: { t: number; real: boolean }) {
  const [lang] = useLang();
  const text = formatClock(t, real, lang);
  if (!real) return <>{text}</>;
  const [h, m] = text.split(":");
  return (
    <>
      {h}
      <span className="decor inline-block animate-[breathe_1s_ease-in-out_infinite_alternate]">:</span>
      {m}
    </>
  );
}

/**
 * Barra de reproducción del día: botón, reloj, carriles, deslizador y
 * velocidad. Todo contra el reloj compartido de `lib/playback.ts`.
 */
export function Playbar({ instance, evaluation }: { instance: S["Instance"]; evaluation: S["Evaluation"] | null }) {
  const snap = usePlayback();
  const tr = useT();
  const [lang] = useLang();
  const real = isReal(instance);
  const [start, end] = useMemo(
    () => (evaluation ? dayRange(instance, evaluation) : [instance.depot.ready, instance.depot.ready + 1]),
    [instance, evaluation],
  );

  // Plan nuevo: día nuevo, con el reloj al principio y en pausa.
  useEffect(() => {
    playback.setRange(start, end);
    playback.pause();
    playback.seek(start);
    return () => playback.pause();
  }, [start, end, evaluation]);

  const inRange = snap.start === start && snap.end === end;
  const t = inRange ? snap.t : start;
  const atEnd = inRange && !snap.playing && t >= end;
  const canPlay = !!evaluation && (snap.motion || !snap.reducedMotion);
  const pct = ((t - start) / (end - start)) * 100;
  const ticks = axisTicks(start, end, real, 6);

  return (
    <div
      data-testid="playbar"
      data-tour="play"
      data-zone
      className="relative z-[3] grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-line-2 bg-[linear-gradient(180deg,#0b1427,#070d18)] p-3 @min-[700px]:grid-cols-[auto_auto_minmax(0,1fr)_auto] @min-[700px]:gap-x-5 @min-[700px]:px-[18px]"
    >
      <button
        type="button"
        data-testid="play-button"
        aria-pressed={snap.playing}
        disabled={!canPlay}
        title={canPlay ? undefined : tr({ es: "Movimiento reducido: recorre el día con el deslizador", en: "Reduced motion: go through the day with the slider" })}
        onClick={() => (snap.playing ? playback.pause() : playback.play())}
        className="inline-flex min-h-[50px] min-w-[146px] items-center gap-2.5 rounded-full bg-amber pr-4 pl-2.5 text-base font-bold text-amber-ink shadow-[0_8px_28px_-8px_rgb(255_181_71/0.7)] transition-[transform,background-color] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-55 @min-[700px]:min-w-[206px] @min-[700px]:pr-[22px] @min-[700px]:pl-3.5 [@media(hover:hover)]:hover:enabled:bg-amber-2"
      >
        <span className="grid size-[30px] place-items-center rounded-full bg-amber-ink text-amber">
          <PlayIcon playing={snap.playing} />
        </span>
        {snap.playing ? (
          tr({ es: "Pausa", en: "Pause" })
        ) : (
          <span>
            {atEnd ? tr({ es: "Repetir", en: "Replay" }) : tr({ es: "Reproducir", en: "Play" })}
            <span className="@max-[699px]:hidden"> {tr({ es: "el día", en: "the day" })}</span>
          </span>
        )}
      </button>

      <div className="flex min-w-0 flex-col items-center gap-1.5 @min-[700px]:min-w-[126px] @min-[700px]:items-start">
        <span className="font-mono text-[12px] leading-none font-semibold tracking-[0.14em] text-fg-3 uppercase">
          {real ? (
            <>
              {tr({ es: "Hora", en: "Time" })}
              <span className="@max-[699px]:hidden"> {tr({ es: "del día", en: "of day" })}</span>
            </>
          ) : (
            tr({ es: "Tiempo", en: "Time" })
          )}
        </span>
        <output
          data-testid="sim-clock"
          aria-live="off"
          className="num text-[27px] leading-none font-medium tracking-[-0.03em] text-amber [text-shadow:0_0_22px_rgb(255_181_71/0.55)] @min-[700px]:text-[34px]"
        >
          <Clock t={t} real={real} />
        </output>
      </div>

      <div className="col-span-full row-start-2 flex min-w-0 flex-col gap-1 @min-[700px]:col-span-1 @min-[700px]:col-start-3 @min-[700px]:row-start-1">
        {evaluation && <Lanes instance={instance} ev={evaluation} start={start} end={end} />}
        <input
          type="range"
          data-testid="scrubber"
          aria-label={real ? tr({ es: "Hora del día simulada", en: "Simulated time of day" }) : tr({ es: "Tiempo simulado", en: "Simulated time" })}
          aria-valuetext={formatClock(t, real, lang)}
          min={start}
          max={end}
          step={real ? 1 : "any"}
          value={t}
          disabled={!evaluation}
          onChange={(e) => playback.seek(Number(e.currentTarget.value))}
          style={{ "--p": `${pct}%` } as CSSProperties}
          className="relative z-[1] -my-2.5 h-11 w-full cursor-pointer appearance-none bg-transparent @min-[700px]:my-0 @min-[700px]:h-[22px] [&::-moz-range-progress]:h-1 [&::-moz-range-progress]:rounded-sm [&::-moz-range-progress]:bg-amber [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-[#0b1427] [&::-moz-range-thumb]:bg-amber [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-sm [&::-moz-range-track]:bg-white/15 [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-sm [&::-webkit-slider-runnable-track]:bg-[linear-gradient(90deg,var(--amber)_var(--p),rgb(255_255_255/0.14)_var(--p))] [&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:size-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-[#0b1427] [&::-webkit-slider-thumb]:bg-amber [&::-webkit-slider-thumb]:shadow-[0_0_14px_rgb(255_181_71/0.8)]"
        />
        <div data-axis aria-hidden="true" className="relative h-3 font-mono text-[12px] leading-none text-fg-3">
          {ticks.map((tick) => {
            const p = ((tick - start) / (end - start)) * 100;
            const shift = p < 4 ? "" : p > 96 ? "-translate-x-full" : "-translate-x-1/2";
            return (
              <span key={tick} className={`absolute top-0 ${shift}`} style={{ left: `${p}%` }}>
                {real ? formatClock(tick, true, lang).slice(0, 2) : formatNumber(tick, 0, lang)}
              </span>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        data-testid="speed-button"
        aria-label={`${tr({ es: "Velocidad de reproducción", en: "Playback speed" })}: ×${snap.speed}`}
        onClick={() => playback.setSpeed(nextSpeed(snap.speed))}
        className="col-start-3 row-start-1 min-h-11 min-w-16 rounded-[10px] border border-line-2 bg-white/[0.03] px-3 font-mono text-[16px] font-semibold @min-[700px]:col-start-4 [@media(hover:hover)]:hover:border-amber/55"
      >
        <span aria-hidden="true" className="mb-1 block text-[12px] leading-none tracking-[0.1em] text-fg-3 uppercase">
          {tr({ es: "Vel.", en: "Speed" })}
        </span>
        ×{snap.speed}
      </button>
    </div>
  );
}
