import type { components } from "@/lib/types";

type S = components["schemas"];
export type Instance = S["Instance"];
export type Evaluation = S["Evaluation"];
export type StopEvaluation = S["StopEvaluation"];

export type Pt = { x: number; y: number };

/** Primer tramo de una dirección ("Museo del Prado, Calle..." da "Museo del Prado"). */
export function placeName(address: string | null | undefined): string | null {
  const name = address?.split(",")[0].trim();
  return name ? name : null;
}

/** Zoom y desplazamiento del modo plano: pantalla = base * k + (tx, ty). */
export type View = { k: number; tx: number; ty: number };
export const IDENTITY: View = { k: 1, tx: 0, ty: 0 };

export const vehicleColor = (route: number) => `var(--veh-${(route % 10) + 1})`;

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Nodos en orden de la matriz: 0 es el depósito, i es `customers[i - 1]`. */
export function nodesOf(instance: Instance) {
  return [instance.depot, ...instance.customers];
}

/** Modo mapa solo si todos los nodos tienen latitud y longitud. */
export function hasGeo(instance: Instance): boolean {
  return nodesOf(instance).every((n) => finite(n.lat) && finite(n.lon));
}

/** `[lon, lat]` de cada nodo (solo para instancias con `hasGeo`). */
export function lngLats(instance: Instance): [number, number][] {
  return nodesOf(instance).map((n) => [n.lon as number, n.lat as number]);
}

/** Mercator de una lista `[lon, lat]`, en grados: la misma forma que tiene en el mapa. */
export function mercator(nodes: [number, number][]): Pt[] {
  return nodes.map(([lon, lat]) => ({
    x: lon,
    y: (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI,
  }));
}

/**
 * Coordenadas planas de cada nodo con el eje y hacia arriba: `x`/`y` de la
 * instancia o, si es geográfica, Mercator.
 */
export function planeCoords(instance: Instance, geo: boolean): (Pt | null)[] {
  if (geo) return mercator(lngLats(instance));
  return nodesOf(instance).map((n) => (finite(n.x) && finite(n.y) ? { x: n.x, y: n.y } : null));
}

export type Pad = { top: number; right: number; bottom: number; left: number };

/** Encaja los puntos en la caja con la misma escala en los dos ejes y aplica el zoom. */
export function fitToBox(raw: (Pt | null)[], width: number, height: number, pad: Pad, view: View): (Pt | null)[] {
  const pts = raw.filter((p): p is Pt => p !== null);
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  if (pts.length === 0 || innerW <= 0 || innerH <= 0) return raw.map(() => null);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const s = Math.min(innerW / dx, innerH / dy);
  const ox = pad.left + (innerW - dx * s) / 2;
  const oy = pad.top + (innerH - dy * s) / 2;
  return raw.map((p) =>
    p === null
      ? null
      : { x: (ox + (p.x - minX) * s) * view.k + view.tx, y: (oy + (maxY - p.y) * s) * view.k + view.ty },
  );
}

/** Zoom con factor `f` alrededor del centro de la caja, entre 1x y 8x. */
export function zoomView(view: View, f: number, width: number, height: number): View {
  const k = Math.min(8, Math.max(1, view.k * f));
  if (k === 1) return IDENTITY;
  const r = k / view.k;
  const cx = width / 2;
  const cy = height / 2;
  return { k, tx: cx - (cx - view.tx) * r, ty: cy - (cy - view.ty) * r };
}

export type StopInfo = { route: number; position: number; evaluation: StopEvaluation | null };

/**
 * Parada de cada cliente servido, con su evaluación si la de `evaluation`
 * corresponde exactamente a esa ruta (en el modo manual pueden ir desfasadas).
 */
export function stopIndex(routes: number[][], evaluation: Evaluation | null | undefined): Map<number, StopInfo> {
  const index = new Map<number, StopInfo>();
  routes.forEach((route, r) => {
    const evals = evaluation?.stops?.[r];
    const matches = !!evals && evals.length === route.length && evals.every((s, j) => s.customer === route[j]);
    route.forEach((customer, j) => {
      if (!index.has(customer)) {
        index.set(customer, { route: r, position: j + 1, evaluation: matches ? evals[j] : null });
      }
    });
  });
  return index;
}

export const isLate = (info: StopInfo | undefined) => !!info?.evaluation && info.evaluation.late > 1e-6;
