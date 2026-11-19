import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/Button";
import { TowerIcon } from "@/components/ui/TowerIcon";
import { NAV_LINKS, REPO_URL } from "@/lib/nav";
import { TourButton } from "./TourButton";

/** Entradas que van como botón fantasma con su icono: una ruta (portada) y un birrete (TFE). */
const NAV_ICONS: Record<string, ReactNode> = {
  "/": (
    <>
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="6" r="2" />
      <path d="M7 18h6a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h6" />
    </>
  ),
  "/sobre": <path d="m2 9 10-5 10 5-10 5zM6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M22 9v6" />,
};

/**
 * Marca, lema y navegación. Las entradas de `NAV_ICONS`, el recorrido y el
 * repositorio van como botones fantasma, solo con icono por debajo del punto
 * `nav` (globals.css); el resto de `NAV_LINKS`, en ámbar.
 */
export function Header() {
  return (
    <header
      data-testid="site-header"
      className="wrap flex h-[var(--header-h)] items-center justify-between gap-3 max-md:h-[58px] md:gap-4"
    >
      <Link href="/" className="flex min-h-11 min-w-0 items-center gap-3 text-fg no-underline" aria-label="Planificador VRPTW, inicio">
        <TowerIcon className="size-[38px] flex-none rounded-[11px] border border-amber/45 p-[7px] text-amber shadow-[var(--glow-amber)] [background:radial-gradient(circle_at_50%_30%,rgb(255_181_71/0.25),rgb(255_181_71/0.04))]" />
        <span className="font-display text-[24px] leading-none font-extrabold tracking-[0.07em] whitespace-nowrap uppercase max-md:text-[22px]">
          <span className="max-md:hidden">Planificador </span>VRPTW
        </span>
        <span className="border-l border-line-2 pl-3 font-mono text-[12px] leading-tight tracking-[0.12em] whitespace-nowrap text-fg-3 uppercase max-lg:hidden">
          Rutas de reparto con horario
        </span>
      </Link>
      <nav aria-label="Principal" className="flex flex-none items-center gap-1 md:gap-2">
        <TourButton />
        {NAV_LINKS.map((l) =>
          NAV_ICONS[l.href] ? (
            // En móvil la marca ya lleva a la portada: su botón deja sitio a los demás.
            <Link key={l.href} href={l.href} className={buttonClass("ghost", l.href === "/" ? "max-nav:btn-icon max-md:hidden" : "max-nav:btn-icon")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {NAV_ICONS[l.href]}
              </svg>
              <span className="max-nav:sr-only">{l.label}</span>
            </Link>
          ) : (
            <Link key={l.href} href={l.href} className={buttonClass("primary", "max-md:px-3.5")}>
              {l.label}
            </Link>
          ),
        )}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "max-nav:btn-icon")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" />
          </svg>
          <span className="max-nav:sr-only">Repositorio</span>
        </a>
      </nav>
    </header>
  );
}
