import type { Pair } from "@/lib/i18n";

/**
 * Nombre, nota y atribución de los casos de ejemplo en inglés, por `id`. Los datos de
 * `public/data` vienen en español y no se tocan: el español de aquí es siempre el del dato.
 */
type CaseText = { name: string; note: string; attribution: string };

const SOLOMON_URL = "https://www.sintef.no/globalassets/project/top/vrptw/solomon/solomon-100.zip";
const SOLOMON_ATTRIBUTION =
  "Solomon instances: M. M. Solomon (1987), Algorithms for the vehicle routing and scheduling problems with time window constraints, Operations Research, 35(2):254-265. Files from SINTEF (TOP project): https://www.sintef.no/projectweb/top/vrptw/100-customers/";
const solomonNote = (name: string, n: number) =>
  `Solomon's ${name} instance (1987) cut to the first ${n} customers, with Euclidean distances truncated to one decimal (download from SINTEF: ${SOLOMON_URL}). The LLM results were obtained on a disguised version of the instance; the routes are mapped back and evaluated on this one.`;

const MADRID_NOTE =
  "Illustrative demands, time windows and fleet; addresses of public places geocoded with Geoapify; road distance matrix from openrouteservice.";
const MADRID_ATTRIBUTION =
  "Geocoding: Powered by Geoapify (https://www.geoapify.com/). Road distance matrix: © openrouteservice by HeiGIT | Data from OpenStreetMap, results under the CC BY-SA 4.0 license (https://creativecommons.org/licenses/by-sa/4.0/). Map data: © OpenStreetMap contributors (https://www.openstreetmap.org/copyright).";

const EN: Record<string, CaseText> = {
  "madrid-12": { name: "Madrid: 12 stops at public places", note: MADRID_NOTE, attribution: MADRID_ATTRIBUTION },
  "madrid-25": { name: "Madrid: 25 stops at public places", note: MADRID_NOTE, attribution: MADRID_ATTRIBUTION },
  "tfe2024-10c-1": {
    name: "2024 thesis: problem 10c-1",
    note: "Problem 10c-1 from the 2024 thesis, with Euclidean distances and the cost profile of that work.",
    attribution: "Problems from the 2024 thesis on VRPTW (public repository https://github.com/oscarsr96/tfm_vrptw_osr_jsr/).",
  },
  "c101-25-trunc": { name: "Solomon C101, 25 customers", note: solomonNote("C101", 25), attribution: SOLOMON_ATTRIBUTION },
  "r101-100-trunc": { name: "Solomon R101, 100 customers", note: solomonNote("R101", 100), attribution: SOLOMON_ATTRIBUTION },
};

/** Texto del caso en los dos idiomas; sin traducción (caso propio), el dato tal cual en ambos. */
export function caseText(id: string | null | undefined, field: keyof CaseText, data: string): Pair {
  return { es: data, en: (id ? EN[id]?.[field] : undefined) ?? data };
}
