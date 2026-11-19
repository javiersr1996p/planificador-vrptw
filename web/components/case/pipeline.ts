import { ApiError, geocode, matrix } from "@/lib/api";
import type { components } from "@/lib/types";

type S = components["schemas"];
type Instance = S["Instance"];

/** Posición 0 = depósito; `i` = `customers[i - 1]`. Es el orden de la matriz. */
export type Position = number;

const placeOf = (inst: Instance, pos: Position) => (pos === 0 ? inst.depot : inst.customers[pos - 1]);

export const addressOf = (inst: Instance, pos: Position): string => placeOf(inst, pos).address ?? "";

const hasCoords = (p: { lat?: number | null; lon?: number | null }) => p.lat != null && p.lon != null;

/** Posiciones que aún no tienen coordenadas. */
export function unplaced(inst: Instance): Position[] {
  return [inst.depot, ...inst.customers].flatMap((p, pos) => (hasCoords(p) ? [] : [pos]));
}

/**
 * Geocodifica las posiciones indicadas (las que no tienen dirección escrita no se envían)
 * y devuelve la instancia con las coordenadas de las encontradas.
 */
export async function geocodePositions(inst: Instance, positions: Position[], signal: AbortSignal): Promise<Instance> {
  const asked = positions.filter((pos) => addressOf(inst, pos).trim() !== "");
  if (asked.length === 0) return inst;
  const { results } = await geocode({ addresses: asked.map((pos) => addressOf(inst, pos).trim()) }, signal);
  if (results.length !== asked.length) throw new ApiError({ status: 500, kind: "server", message: "Respuesta incompleta" });
  const found = new Map<Position, { lat: number; lon: number }>();
  results.forEach((r, i) => {
    if (r.found && r.lat != null && r.lon != null) found.set(asked[i], { lat: r.lat, lon: r.lon });
  });
  const withCoords = <T extends { lat?: number | null; lon?: number | null }>(p: T, pos: Position): T =>
    found.has(pos) ? { ...p, ...found.get(pos) } : p;
  return {
    ...inst,
    depot: withCoords(inst.depot, 0),
    customers: inst.customers.map((c, i) => withCoords(c, i + 1)),
  };
}

/** Matriz de distancias y tiempos con el depósito primero. Todas las posiciones llevan ya coordenadas. */
export function buildMatrix(inst: Instance, signal: AbortSignal): Promise<S["Matrix"]> {
  const points = [inst.depot, ...inst.customers].map((p) => ({ lat: p.lat as number, lon: p.lon as number }));
  return matrix({ points }, signal);
}

export function withAddress(inst: Instance, pos: Position, address: string): Instance {
  return pos === 0
    ? { ...inst, depot: { ...inst.depot, address } }
    : { ...inst, customers: inst.customers.map((c, i) => (i === pos - 1 ? { ...c, address } : c)) };
}

export function withoutCustomer(inst: Instance, pos: Position): Instance {
  return { ...inst, customers: inst.customers.filter((_, i) => i !== pos - 1) };
}

/** Texto legible de un fallo del servicio; nunca vuelca el cuerpo de la respuesta. */
export function failureText(e: unknown, step: "read" | "geocode" | "matrix"): string {
  if (!(e instanceof ApiError)) return "Algo falló. Inténtalo de nuevo.";
  switch (e.kind) {
    case "network":
      return "No se pudo contactar con el servicio.";
    case "unavailable":
    case "rate-limit":
      return step === "geocode"
        ? `${e.message.replace(/\.$/, "")}. Alternativa: pon LAT y LON en lugar de la dirección.`
        : e.message;
    case "payload":
      return "El caso es demasiado grande para el servicio.";
    case "validation":
      return `El servicio no aceptó el caso: ${e.message}.`;
    default:
      return `El servicio falló (error ${e.status}). Inténtalo de nuevo.`;
  }
}
