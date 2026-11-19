/**
 * Ejemplo de juguete de las escenas 1 a 4. Es ilustrativo: no sale de ningún
 * caso ni de ninguna ejecución, y por eso no muestra cifras de resultados.
 * Las posiciones van de 0 a 100 en los dos ejes del escenario.
 */

export type Pt = { x: number; y: number };

export type ToyClient = Pt & {
  id: string;
  /** Cajas del pedido (escena 3). */
  demand: number;
};

export const TOY_BASE: Pt = { x: 50, y: 55 };

export const TOY_CLIENTS: ToyClient[] = [
  { id: "A", x: 16, y: 22, demand: 4 },
  { id: "B", x: 34, y: 82, demand: 3 },
  { id: "C", x: 64, y: 17, demand: 2 },
  { id: "D", x: 87, y: 40, demand: 5 },
  { id: "E", x: 78, y: 80, demand: 3 },
  { id: "F", x: 14, y: 60, demand: 2 },
];

export const toyClient = (id: string): ToyClient => TOY_CLIENTS.find((c) => c.id === id)!;

/** Puntos de una ruta: sale de la base, visita y vuelve. */
export function loopPoints(route: string[]): Pt[] {
  return route.length ? [TOY_BASE, ...route.map(toyClient), TOY_BASE] : [];
}

/** Longitud en el escenario apaisado (16:10), solo para comparar planes de juguete entre sí. */
function length(pts: Pt[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, (pts[i].y - pts[i - 1].y) * 0.625);
  return total;
}

export const routesLength = (routes: string[][]) => routes.reduce((sum, r) => sum + length(loopPoints(r)), 0);

/** Escena 3: cajas que caben en cada furgoneta. */
export const TOY_CAPACITY = 10;

/** Escena 2: la ventana del cliente y el día, en minutos desde las 00:00. */
export const TOY_DAY = { start: 8 * 60, end: 14 * 60 };
export const TOY_WINDOW = { ready: 10 * 60, due: 12 * 60 };
export const TOY_ARRIVAL = 9 * 60 + 20;

/**
 * Escena 4: tres planes del mismo reparto. La multa es ilustrativa, en las
 * mismas unidades que la longitud, para que se vea en la barra.
 */
export type ToyPlan = {
  id: string;
  name: string;
  routes: string[][];
  late: string[];
  unserved: string[];
  fine: number;
};

export const TOY_PLANS: ToyPlan[] = [
  { id: "corto", name: "Plan 1", routes: [["A", "F", "B"], ["C", "D", "E"]], late: ["E"], unserved: [], fine: 15 },
  { id: "rodeo", name: "Plan 2", routes: [["B", "F", "A"], ["E", "C", "D"]], late: [], unserved: [], fine: 0 },
  { id: "fuera", name: "Plan 3", routes: [["A", "F", "B"], ["E", "C"]], late: [], unserved: ["D"], fine: 90 },
];

/** Paradas de una ruta con su identificador, para `RouteSegments`. */
export function loopStops(route: string[]): { id: string; pt: Pt }[] {
  return route.length
    ? [{ id: "base", pt: TOY_BASE }, ...route.map((id) => ({ id, pt: toyClient(id) as Pt })), { id: "base", pt: TOY_BASE }]
    : [];
}
