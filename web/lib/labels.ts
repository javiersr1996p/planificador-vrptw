import type { components } from "@/lib/types";

type S = components["schemas"];

/** Nombre en español de cada método (`RunRecord.method`). */
const METHOD_LABELS: Record<string, string> = {
  heuristic: "Heurística",
  aco: "Colonia de hormigas",
  ga: "Algoritmo genético",
  tabu: "Búsqueda tabú",
  llm_direct: "LLM directo",
  llm_agent: "LLM agente",
  manual: "Tu ruta",
};

export function methodLabel(method: string): string {
  return METHOD_LABELS[method] ?? method;
}

/** Violaciones del evaluador, en español. */
export const VIOLATION_LABELS: Record<S["Violation"]["type"], string> = {
  capacity: "capacidad excedida",
  late: "fuera de ventana",
  unserved: "sin atender",
  duplicate: "cliente repetido",
  unknown_customer: "cliente desconocido",
  fleet_exceeded: "flota excedida",
  depot_due: "vuelta tarde al depósito",
};

/** Agrupa las violaciones por tipo, en el orden de `VIOLATION_LABELS`. */
export function groupViolations(violations: S["Violation"][]): { type: S["Violation"]["type"]; label: string; count: number }[] {
  const counts = new Map<S["Violation"]["type"], number>();
  for (const v of violations) counts.set(v.type, (counts.get(v.type) ?? 0) + 1);
  return (Object.keys(VIOLATION_LABELS) as S["Violation"]["type"][])
    .filter((t) => counts.has(t))
    .map((t) => ({ type: t, label: VIOLATION_LABELS[t], count: counts.get(t)! }));
}

export const SOURCE_LABELS: Record<S["Instance"]["source"], string> = {
  real: "Caso real",
  tfe2024: "TFE 2024",
  solomon: "Solomon",
};

const MATRIX_LABELS: Record<string, string> = {
  euclidean: "euclídea",
  euclidean_truncated: "euclídea truncada",
  haversine_fallback: "en línea recta",
  openrouteservice: "por carretera (openrouteservice)",
};

export function matrixLabel(source: string): string {
  return MATRIX_LABELS[source] ?? source;
}

/** Por qué una ejecución LLM no dejó una solución legible. */
export function unreadableReason(record: Pick<S["RunRecord"], "parse_status" | "stop_reason">): string {
  if (record.stop_reason === "max_tokens") return "agotó el límite de salida";
  if (record.parse_status === "timeout") return "tiempo agotado";
  if (record.parse_status === "refused") return "el modelo se negó";
  return "no se pudo leer la solución";
}
