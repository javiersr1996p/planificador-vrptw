import { ApiError, solveClassic } from "@/lib/api";
import type { components } from "@/lib/types";

type S = components["schemas"];

/** Métodos clásicos que lanza el panel, en el orden en que se muestran y se ejecutan. */
export const CLASSIC_METHODS = ["heuristic", "aco", "ga", "tabu"] as const;
export type ClassicMethod = (typeof CLASSIC_METHODS)[number];

/** Parámetros fijos de la interfaz. */
export const SEED = 0;
export const TIME_LIMIT_S = 30;

/** Reintentos ante un 503 (servicio ocupado con otro cálculo) y espera si no se puede leer `Retry-After`. */
export const MAX_RETRIES = 6;
export const DEFAULT_RETRY_S = 5;
const MAX_WAIT_S = 30;

/** Texto legible de un error del servicio; nunca el cuerpo de la respuesta. */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return "Algo falló al calcular. Inténtalo de nuevo.";
  switch (e.kind) {
    case "network":
      return "No se pudo contactar con el servicio.";
    case "unavailable":
      return "El servicio sigue ocupado con otro cálculo. Inténtalo de nuevo en un momento.";
    case "validation":
    case "csv":
      return `El servicio no aceptó este caso (error ${e.status}).`;
    case "payload":
      return "El caso es demasiado grande para el servicio.";
    default:
      return `El servicio falló al calcular (error ${e.status}). Inténtalo de nuevo.`;
  }
}

/** Espera `ms`, o termina antes (sin error) si se cancela. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

export type SolveOutcome =
  | { ok: true; record: S["RunRecord"] }
  | { ok: false; aborted: true }
  | { ok: false; aborted: false; error: ApiError | unknown };

/**
 * Resuelve con un método clásico. Si el servicio responde 503, espera
 * `Retry-After` (5 s si no se puede leer) y reintenta hasta `MAX_RETRIES`
 * veces; `onRetry` recibe el número de reintento que va a empezar.
 */
export async function solveWithRetry(
  instance: S["Instance"],
  method: ClassicMethod,
  signal: AbortSignal,
  onRetry: (attempt: number) => void,
): Promise<SolveOutcome> {
  for (let attempt = 0; ; attempt++) {
    try {
      const record = await solveClassic({ instance, method, seed: SEED, time_limit_s: TIME_LIMIT_S }, signal);
      return signal.aborted ? { ok: false, aborted: true } : { ok: true, record };
    } catch (e) {
      if (signal.aborted || (e instanceof ApiError && e.kind === "aborted")) return { ok: false, aborted: true };
      if (!(e instanceof ApiError) || e.kind !== "unavailable" || attempt >= MAX_RETRIES) {
        return { ok: false, aborted: false, error: e };
      }
      onRetry(attempt + 1);
      await sleep(Math.min(e.retryAfterS ?? DEFAULT_RETRY_S, MAX_WAIT_S) * 1000, signal);
      if (signal.aborted) return { ok: false, aborted: true };
    }
  }
}
