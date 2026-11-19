/**
 * Borrador de rutas del modo «Tu ruta». Solo ordena paradas: el coste, la
 * validez y las violaciones salen siempre de `/evaluate`.
 *
 * Todas las rutas del borrador tienen al menos una parada. `active` es la
 * furgoneta elegida; si vale `routes.length`, es una furgoneta nueva todavía vacía.
 */
export type Draft = { routes: number[][]; active: number };

export const EMPTY_DRAFT: Draft = { routes: [], active: 0 };

/** Quita las rutas vacías y recoloca `active` en la ruta que apuntaba. */
function compact(routes: number[][], active: number): Draft {
  const kept = routes.filter((r) => r.length > 0);
  const before = routes.slice(0, active).filter((r) => r.length > 0).length;
  return { routes: kept, active: Math.min(before, kept.length) };
}

/**
 * Pulsar una parada. Sin asignar, se añade al final de la furgoneta elegida.
 * Ya asignada, pasa al final de la furgoneta elegida; si ya era su última
 * parada, se quita (queda pendiente otra vez).
 */
export function tap(draft: Draft, customer: number): Draft {
  const routes = draft.routes.map((r) => r.slice());
  const from = routes.findIndex((r) => r.includes(customer));
  const undo = from === draft.active && from >= 0 && routes[from][routes[from].length - 1] === customer;
  if (from >= 0) routes[from] = routes[from].filter((c) => c !== customer);
  if (!undo) {
    if (draft.active >= routes.length) routes.push([customer]);
    else routes[draft.active].push(customer);
  }
  return compact(routes, draft.active);
}

/** Cambia de furgoneta (0 a `routes.length`, la nueva). */
export function chooseVehicle(draft: Draft, vehicle: number): Draft {
  return { ...draft, active: Math.max(0, Math.min(vehicle, draft.routes.length)) };
}

/** Clientes que ninguna ruta atiende, en el orden de la instancia. */
export function pendingOf(draft: Draft, customerIds: number[]): number[] {
  const served = new Set(draft.routes.flat());
  return customerIds.filter((id) => !served.has(id));
}
