import { formatNumber, formatTime } from "@/lib/format";
import type { Evaluation, Instance, Pt, StopEvaluation } from "./geometry";

/**
 * Horario de cada furgoneta, leído de la evaluación: llegada, inicio y servicio
 * de cada parada, y la vuelta a la base. Aquí no se calcula ninguna hora: solo
 * se interpola la posición entre dos horas que ya vienen dadas (tramos rectos).
 */

export type StopState = "pend" | "wait" | "serve" | "late" | "done";
export type VanState = "base" | "travel" | "wait" | "serve" | "late" | "home";

type Segment = {
  kind: "travel" | "wait" | "serve" | "late";
  t0: number;
  t1: number;
  /** Posiciones dentro de `path`; iguales salvo en un trayecto. */
  from: number;
  to: number;
  stop: number;
};

export type ScheduledStop = { customer: number; evaluation: StopEvaluation; service: number; ready: number };

export type RouteSchedule = {
  /** Índice de la ruta en `routes`. */
  route: number;
  /** Nodos del recorrido: base, clientes en orden y base (0 es la base, i es `customers[i - 1]`). */
  path: number[];
  /** Paradas con su evaluación; vacío si la evaluación no corresponde a la ruta. */
  stops: ScheduledStop[];
  segments: Segment[];
};

export type VanPosition = { state: VanState; from: number; to: number; f: number; stop: ScheduledStop | null };

const EPS = 1e-6;

/** Un horario por ruta con paradas, en el orden de `routes`. */
export function buildSchedules(
  instance: Instance,
  routes: number[][],
  evaluation: Evaluation | null | undefined,
): RouteSchedule[] {
  const nodeOf = new Map(instance.customers.map((c, i) => [c.id, i + 1]));
  const byId = new Map(instance.customers.map((c) => [c.id, c]));
  const schedules: RouteSchedule[] = [];
  routes.forEach((route, r) => {
    const known = route.filter((id) => nodeOf.has(id));
    if (known.length === 0) return;
    const path = [0, ...known.map((id) => nodeOf.get(id) as number), 0];
    const evals = evaluation?.stops?.[r];
    const matches =
      known.length === route.length && !!evals && evals.length === route.length && evals.every((s, j) => s.customer === route[j]);
    const stops: ScheduledStop[] = [];
    const segments: Segment[] = [];
    if (matches) {
      let t = instance.depot.ready;
      evals.forEach((ev, j) => {
        const customer = byId.get(ev.customer)!;
        const stop = stops.push({ customer: ev.customer, evaluation: ev, service: customer.service, ready: customer.ready }) - 1;
        segments.push({ kind: "travel", t0: t, t1: ev.arrival, from: j, to: j + 1, stop });
        if (ev.start > ev.arrival + EPS) segments.push({ kind: "wait", t0: ev.arrival, t1: ev.start, from: j + 1, to: j + 1, stop });
        t = ev.start + customer.service;
        segments.push({ kind: ev.late > EPS ? "late" : "serve", t0: ev.start, t1: t, from: j + 1, to: j + 1, stop });
      });
      // La vuelta solo se anima si la evaluación trae su hora.
      const back = evaluation?.depot_arrival?.[r];
      if (typeof back === "number" && Number.isFinite(back) && back >= t) {
        segments.push({ kind: "travel", t0: t, t1: back, from: evals.length, to: evals.length + 1, stop: -1 });
      }
    }
    schedules.push({ route: r, path, stops, segments });
  });
  return schedules;
}

/** Dónde está la furgoneta a la hora `t`. */
export function vanAt(schedule: RouteSchedule, t: number, dayStart: number): VanPosition {
  const { segments, stops } = schedule;
  if (segments.length === 0 || t <= dayStart) return { state: "base", from: 0, to: 0, f: 0, stop: null };
  for (const s of segments) {
    if (t < s.t1) {
      const f = s.kind === "travel" ? Math.min(1, Math.max(0, (t - s.t0) / Math.max(EPS, s.t1 - s.t0))) : 0;
      return { state: s.kind, from: s.from, to: s.to, f, stop: stops[s.stop] ?? null };
    }
  }
  const last = segments[segments.length - 1].to;
  return { state: "home", from: last, to: last, f: 0, stop: null };
}

/**
 * Estado de una parada a la hora `t`. Una parada atendida con retraso se queda
 * en `late`: al acabar el día se ve cuáles llegaron tarde.
 */
export function stopStateAt(stop: ScheduledStop, t: number, dayStart: number): StopState {
  const ev = stop.evaluation;
  if (t <= dayStart || t < ev.arrival) return "pend";
  if (t < ev.start) return "wait";
  if (ev.late > EPS) return "late";
  return t < ev.start + stop.service ? "serve" : "done";
}

/** Longitud acumulada de una polilínea, punto a punto. */
export function cumulative(points: Pt[]): number[] {
  const acc = [0];
  for (let i = 1; i < points.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return acc;
}

/** Fracción recorrida de la línea de la ruta (0 a 1). */
export function progressOf(acc: number[], p: Pick<VanPosition, "from" | "to" | "f">): number {
  const total = acc[acc.length - 1];
  if (!(total > 0)) return 0;
  return (acc[p.from] + p.f * (acc[p.to] - acc[p.from])) / total;
}

export type Units = { clock: (v: number) => string; span: (v: number) => string };

/** Casos reales: `HH:MM` y minutos. El resto, en las unidades de la instancia. */
export function unitsOf(instance: Instance): Units {
  if (instance.source !== "real") {
    const plain = (v: number) => formatNumber(v, 1);
    return { clock: plain, span: plain };
  }
  return {
    clock: formatTime,
    span: (v) => {
      const total = Math.round(v);
      if (total < 60) return `${total} min`;
      const m = total % 60;
      return m === 0 ? `${Math.floor(total / 60)} h` : `${Math.floor(total / 60)} h ${m} min`;
    },
  };
}

/** Rótulo de la furgoneta mientras espera, entrega o llega tarde. */
export function vanLabel(p: VanPosition, units: Units): string {
  if (!p.stop) return "";
  if (p.state === "wait") return `Espera · abre ${units.clock(p.stop.ready)}`;
  if (p.state === "serve") return `Entregando · ${units.span(p.stop.service)}`;
  if (p.state === "late") return `Tarde +${units.span(p.stop.evaluation.late)}`;
  return "";
}
