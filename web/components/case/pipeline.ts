import { ApiError, geocode, matrix } from "@/lib/api";
import type { Pair } from "@/lib/i18n";
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
  if (results.length !== asked.length) throw new ApiError({
      status: 500,
      kind: "server",
      message: "Respuesta incompleta",
      text: { es: "Respuesta incompleta", en: "Incomplete response" },
    });
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

/** Texto legible de un fallo del servicio, en los dos idiomas; nunca vuelca el cuerpo de la respuesta. */
export function failureText(e: unknown, step: "read" | "geocode" | "matrix"): Pair {
  if (!(e instanceof ApiError)) return { es: "Algo falló. Inténtalo de nuevo.", en: "Something went wrong. Try again." };
  switch (e.kind) {
    case "network":
      return { es: "No se pudo contactar con el servicio.", en: "Could not reach the service." };
    case "unavailable":
    case "rate-limit":
      if (step !== "geocode") return e.text;
      return {
        es: `${e.text.es.replace(/\.$/, "")}. Alternativa: pon LAT y LON en lugar de la dirección.`,
        // El aviso del límite diario ya trae esta alternativa.
        en: /LAT and LON/.test(e.text.en) ? e.text.en : `${e.text.en.replace(/\.$/, "")}. Alternative: use LAT and LON instead of the address.`,
      };
    case "payload":
      return { es: "El caso es demasiado grande para el servicio.", en: "The case is too large for the service." };
    case "validation":
      return { es: `El servicio no aceptó el caso: ${e.text.es}.`, en: `The service did not accept the case: ${e.text.en}.` };
    default:
      return { es: `El servicio falló (error ${e.status}). Inténtalo de nuevo.`, en: `The service failed (error ${e.status}). Try again.` };
  }
}
