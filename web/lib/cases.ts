import type { components } from "@/lib/types";

type S = components["schemas"];

/** Entrada de `/data/index.json`. */
export type CaseSummary = {
  id: string;
  name: string;
  source: S["Instance"]["source"];
  customers: number;
  vehicles: number;
  has_map: boolean;
  methods: string[];
  default: boolean;
};

/** Contenido de `/data/cases/<id>.json`. */
export type CaseFile = {
  instance: S["Instance"];
  runs: S["RunRecord"][];
  built_on?: string | null;
  attribution?: string | null;
  note?: string | null;
};

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** Los ejemplos precalculados se leen como ficheros estáticos, sin pasar por el servicio. */
export const fetchCaseIndex = (signal?: AbortSignal) => getJson<{ cases: CaseSummary[] }>("/data/index.json", signal);

export const fetchCase = (id: string, signal?: AbortSignal) =>
  getJson<CaseFile>(`/data/cases/${encodeURIComponent(id)}.json`, signal);
