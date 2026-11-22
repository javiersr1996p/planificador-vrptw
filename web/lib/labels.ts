import type { Pair } from "@/lib/i18n";
import type { components } from "@/lib/types";

type S = components["schemas"];

/** Nombre de cada método (`RunRecord.method`) en los dos idiomas. */
const METHOD_LABELS: Record<string, Pair> = {
  heuristic: { es: "Heurística", en: "Heuristic" },
  aco: { es: "Colonia de hormigas", en: "Ant colony" },
  ga: { es: "Algoritmo genético", en: "Genetic algorithm" },
  tabu: { es: "Búsqueda tabú", en: "Tabu search" },
  llm_direct: { es: "LLM directo", en: "Direct LLM" },
  llm_agent: { es: "LLM agente", en: "LLM agent" },
  manual: { es: "Tu ruta", en: "Your route" },
};

export function methodLabel(method: string): Pair {
  return METHOD_LABELS[method] ?? { es: method, en: method };
}

/** Violaciones del evaluador, en los dos idiomas. */
export const VIOLATION_LABELS: Record<S["Violation"]["type"], Pair> = {
  capacity: { es: "capacidad excedida", en: "over capacity" },
  late: { es: "fuera de ventana", en: "outside the time window" },
  unserved: { es: "sin atender", en: "unserved" },
  duplicate: { es: "cliente repetido", en: "duplicate customer" },
  unknown_customer: { es: "cliente desconocido", en: "unknown customer" },
  fleet_exceeded: { es: "flota excedida", en: "fleet exceeded" },
  depot_due: { es: "vuelta tarde al depósito", en: "late return to depot" },
};

/** Agrupa las violaciones por tipo, en el orden de `VIOLATION_LABELS`. */
export function groupViolations(violations: S["Violation"][]): { type: S["Violation"]["type"]; label: Pair; count: number }[] {
  const counts = new Map<S["Violation"]["type"], number>();
  for (const v of violations) counts.set(v.type, (counts.get(v.type) ?? 0) + 1);
  return (Object.keys(VIOLATION_LABELS) as S["Violation"]["type"][])
    .filter((t) => counts.has(t))
    .map((t) => ({ type: t, label: VIOLATION_LABELS[t], count: counts.get(t)! }));
}

export const SOURCE_LABELS: Record<S["Instance"]["source"], Pair> = {
  real: { es: "Caso real", en: "Real case" },
  tfe2024: { es: "TFE 2024", en: "2024 thesis" },
  solomon: { es: "Solomon", en: "Solomon" },
};

const MATRIX_LABELS: Record<string, Pair> = {
  euclidean: { es: "euclídea", en: "Euclidean" },
  euclidean_truncated: { es: "euclídea truncada", en: "truncated Euclidean" },
  haversine_fallback: { es: "en línea recta", en: "straight-line" },
  openrouteservice: { es: "por carretera (openrouteservice)", en: "road distance (openrouteservice)" },
};

export function matrixLabel(source: string): Pair {
  return MATRIX_LABELS[source] ?? { es: source, en: source };
}

/** Por qué una ejecución LLM no dejó una solución legible. */
export function unreadableReason(record: Pick<S["RunRecord"], "parse_status" | "stop_reason">): Pair {
  if (record.stop_reason === "max_tokens") return { es: "agotó el límite de salida", en: "hit the output limit" };
  if (record.parse_status === "timeout") return { es: "tiempo agotado", en: "timed out" };
  if (record.parse_status === "refused") return { es: "el modelo se negó", en: "the model refused" };
  return { es: "no se pudo leer la solución", en: "the solution could not be read" };
}
