import { playback } from "@/lib/playback";
import {
  type RouteSchedule,
  type StopState,
  type Units,
  type VanPosition,
  progressOf,
  stopStateAt,
  vanAt,
  vanLabel,
} from "./schedule";

/**
 * Fotograma de la reproducción: lee el reloj compartido y dice dónde está cada
 * furgoneta. Lo pintan el mapa y el plano directamente en el DOM, sin pasar por
 * React, porque cambia en cada fotograma.
 */

export type VanFrame = VanPosition & {
  /** Fracción de la línea recorrida, y la de la cola de su estela. */
  progress: number;
  tail: number;
  show: boolean;
  label: string;
};

export type SimFrame = {
  t: number;
  /** Reloj parado al inicio o al final del día: se ve el plan entero. */
  overview: boolean;
  motion: boolean;
  vans: VanFrame[];
};

/** Parte del día que abarca la estela de una furgoneta. */
const TRAIL = 0.027;

export function simulate(schedules: RouteSchedule[], lengths: number[][], units: Units, dayStart: number): SimFrame {
  const snap = playback.getSnapshot();
  const ranged = snap.end > snap.start;
  const t = ranged ? snap.t : dayStart;
  const eps = (snap.end - snap.start) * 1e-4;
  const overview = !snap.playing && (!ranged || t <= snap.start + eps || t >= snap.end - eps);
  const vans = schedules.map((schedule, i) => {
    const at = vanAt(schedule, t, dayStart);
    const from = vanAt(schedule, t - (snap.end - snap.start) * TRAIL, dayStart);
    return {
      ...at,
      progress: progressOf(lengths[i], at),
      tail: progressOf(lengths[i], from),
      show: !overview && at.state !== "base" && at.state !== "home",
      label: vanLabel(at, units),
    };
  });
  return { t, overview, motion: snap.motion, vans };
}

/** Escribe `data-state` en cada parada; las que nadie atiende quedan en `pend`. */
export function paintStops(els: Map<number, HTMLElement>, schedules: RouteSchedule[], t: number, dayStart: number): void {
  const states = new Map<number, StopState>();
  for (const s of schedules) for (const stop of s.stops) states.set(stop.customer, stopStateAt(stop, t, dayStart));
  els.forEach((el, customer) => {
    const state = states.get(customer) ?? "pend";
    if (el.dataset.state !== state) el.dataset.state = state;
  });
}

/** Estado, visibilidad y rótulo de una furgoneta. */
export function paintVan(el: HTMLElement, van: VanFrame): void {
  if (el.dataset.state !== van.state) el.dataset.state = van.state;
  if ((el.dataset.on !== undefined) !== van.show) {
    if (van.show) el.dataset.on = "";
    else delete el.dataset.on;
  }
  const pill = el.lastElementChild;
  if (pill && pill.textContent !== van.label) pill.textContent = van.label;
}
