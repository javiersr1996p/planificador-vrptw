export type NavLink = { href: string; label: string };

/** Entradas de la cabecera. Cada página nueva añade aquí la suya. */
export const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Planificador" },
  { href: "/aprende", label: "Aprende" },
];

export const REPO_URL = "https://github.com/javiersr1996p/planificador-vrptw";
