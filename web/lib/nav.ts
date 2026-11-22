import type { Pair } from "./i18n";

export type NavLink = { href: string; label: Pair };

/** Entradas de la cabecera. Cada página nueva añade aquí la suya. */
export const NAV_LINKS: NavLink[] = [
  { href: "/", label: { es: "Planificador", en: "Planner" } },
  { href: "/aprende", label: { es: "Aprende", en: "Learn" } },
  { href: "/sobre", label: { es: "Sobre el TFE", en: "About the thesis" } },
];

export const REPO_URL = "https://github.com/javiersr1996p/planificador-vrptw";

/** Código del TFE de 2024 y el commit del que se portaron los métodos. */
export const TFE_CODE_URL = "https://github.com/oscarsr96/tfm_vrptw_osr_jsr";
export const TFE_CODE_COMMIT = "c3ad94c";

/** Documento del TFE. Sin URL pública todavía: con `null`, «Sobre el TFE» no lo enlaza. */
export const TFE_DOC_URL: string | null = null;
