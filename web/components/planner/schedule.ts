import type { components } from "@/lib/types";
import { customerName, depotName, formatClock, formatSpan, isReal } from "./units";

type S = components["schemas"];

/**
 * El día de cada furgoneta, leído de la evaluación: llegada, inicio y retraso
 * de cada parada, y la vuelta a la base (`depot_arrival`). Aquí no se calcula
 * ninguna cifra que se muestre: solo se ordenan en tramos las horas que trae
 * la evaluación, con el servicio de cada cliente de la instancia.
 */

export type SegmentKind = "travel" | "wait" | "serve" | "late";
export type Segment = { kind: SegmentKind; t0: number; t1: number };

export type VehicleDay = {
  /** Índice de la ruta en `solution.routes` y `evaluation.stops`. */
  route: number;
  stops: S["StopEvaluation"][];
  /** Salida de la base: el inicio de la jornada. */
  departure: number;
  /** Vuelta a la base según la evaluación, o `null` si no la trae. */
  back: number | null;
  segments: Segment[];
};

const EPS = 1e-6;

export function customersById(instance: S["Instance"]): Map<number, S["Customer"]> {
  return new Map(instance.customers.map((c) => [c.id, c]));
}

export function vehicleDays(instance: S["Instance"], ev: S["Evaluation"]): VehicleDay[] {
  const byId = customersById(instance);
  const departure = instance.depot.ready;
  return ev.stops.map((stops, route) => {
    const segments: Segment[] = [];
    let t = departure;
    for (const s of stops) {
      const service = byId.get(s.customer)?.service ?? 0;
      if (s.arrival > t + EPS) segments.push({ kind: "travel", t0: t, t1: s.arrival });
      if (s.start > s.arrival + EPS) segments.push({ kind: "wait", t0: s.arrival, t1: s.start });
      segments.push({ kind: s.late > EPS ? "late" : "serve", t0: s.start, t1: s.start + service });
      t = s.start + service;
    }
    const raw = ev.depot_arrival?.[route];
    const back = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    if (back !== null && back > t + EPS) segments.push({ kind: "travel", t0: t, t1: back });
    return { route, stops, departure, back, segments };
  });
}

/** Día de la reproducción: de la apertura de la base a la última vuelta. */
export function dayRange(instance: S["Instance"], ev: S["Evaluation"]): [number, number] {
  const start = instance.depot.ready;
  const backs = (ev.depot_arrival ?? []).filter((b): b is number => typeof b === "number" && Number.isFinite(b));
  let end = backs.length > 0 ? Math.max(...backs) : start;
  if (backs.length === 0) {
    // Sin vuelta en la evaluación: el día acaba con la última entrega.
    const byId = customersById(instance);
    for (const route of ev.stops) for (const s of route) end = Math.max(end, s.start + (byId.get(s.customer)?.service ?? 0));
  }
  return [start, end > start ? end : start + 1];
}

/** Eje del detalle: de la apertura de la base al último cierre, entrega o vuelta. */
export function timeDomain(instance: S["Instance"], days: VehicleDay[]): [number, number] {
  const lo = instance.depot.ready;
  let hi = instance.depot.due ?? lo;
  for (const c of instance.customers) hi = Math.max(hi, c.due);
  for (const d of days) {
    for (const s of d.segments) hi = Math.max(hi, s.t1);
    if (d.back !== null) hi = Math.max(hi, d.back);
  }
  return [lo, hi > lo ? hi : lo + 1];
}

/** Marcas "redondas" del eje: horas en los casos reales, números en el resto. */
export function axisTicks(lo: number, hi: number, real: boolean, max = 6): number[] {
  const span = hi - lo;
  const steps = real ? [60, 120, 180, 240, 360, 720] : [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const step = steps.find((s) => span / s <= max) ?? Math.ceil(span / max);
  const out: number[] = [];
  for (let t = Math.ceil(lo / step - EPS) * step; t <= hi + EPS; t += step) out.push(t);
  return out;
}

/**
 * Furgoneta que el detalle enseña si no se ha elegido ninguna: la que más
 * paradas tiene con retraso y, si nadie llega tarde, la de más paradas.
 */
export function focusRoute(ev: S["Evaluation"]): number {
  let best = 0;
  let key = -1;
  ev.stops.forEach((route, i) => {
    const late = route.filter((s) => s.late > EPS).length;
    const k = late * 10_000 + route.length;
    if (k > key) {
      key = k;
      best = i;
    }
  });
  return best;
}

export type RadioEvent = { t: number; text: string };

/**
 * Sucesos del día para la línea de estado, en orden de hora: salidas,
 * llegadas, esperas, retrasos y vueltas, con las horas de la evaluación.
 */
export function radioEvents(instance: S["Instance"], ev: S["Evaluation"]): RadioEvent[] {
  const real = isReal(instance);
  const byId = customersById(instance);
  const at = (t: number) => (real ? `a las ${formatClock(t, true)}` : `en t = ${formatClock(t, false)}`);
  const base = depotName(instance);
  const events: RadioEvent[] = [];
  vehicleDays(instance, ev).forEach(({ route, stops, departure, back }) => {
    if (stops.length === 0) return;
    const f = `F${route + 1}`;
    events.push({ t: departure, text: `${f} sale de la base${base ? ` de ${base}` : ""}` });
    for (const s of stops) {
      const c = byId.get(s.customer);
      const name = customerName(c, s.customer, real);
      if (s.late > EPS) {
        events.push({ t: s.arrival, text: `${f} llega ${formatSpan(s.late, real)} tarde a ${name}` });
      } else if (s.wait > EPS && c) {
        events.push({
          t: s.arrival,
          text: `${f} llega a ${name}, que abre ${at(c.ready)}: espera ${formatSpan(s.wait, real)}`,
        });
        events.push({ t: s.start, text: `${f} empieza a entregar en ${name}` });
      } else {
        events.push({ t: s.arrival, text: `${f} llega a ${name} y entrega al momento` });
      }
    }
    if (back !== null) events.push({ t: back, text: `${f} vuelve a la base ${at(back)}` });
  });
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.t - b.e.t || a.i - b.i)
    .map((x) => x.e);
}

/** Índice del último suceso a la hora `t` o antes, o -1. */
export function lastEventAt(events: RadioEvent[], t: number): number {
  let lo = 0;
  let hi = events.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].t <= t + EPS) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
