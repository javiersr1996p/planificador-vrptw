"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/Button";
import { TowerIcon } from "@/components/ui/TowerIcon";
import { useLang, useT } from "@/lib/i18n";
import { NAV_LINKS, REPO_URL } from "@/lib/nav";
import { LangSwitch } from "./LangSwitch";
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

/** Entradas en ámbar que por debajo de `md` pasan a botón solo con icono, para dejar sitio al conmutador de idioma. */
const COMPACT_ICONS: Record<string, ReactNode> = {
  "/aprende": <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />,
};

/**
 * Marca, lema y navegación. Las entradas de `NAV_ICONS`, el recorrido y el
 * repositorio van como botones fantasma, solo con icono por debajo del punto
 * `nav` (globals.css); el resto de `NAV_LINKS`, en ámbar.
 */
export function Header() {
  const [lang] = useLang();
  const t = useT();
  return (
    <header
      data-testid="site-header"
      className="wrap flex h-[var(--header-h)] items-center justify-between gap-2 max-md:h-[58px] md:gap-4"
    >
      <Link href="/" className="flex min-h-11 min-w-0 items-center gap-2 text-fg md:gap-3 no-underline" aria-label={t({ es: "Planificador VRPTW, inicio", en: "VRPTW Planner, home" })}>
        <TowerIcon className="size-[38px] flex-none max-[439px]:hidden rounded-[11px] border border-amber/45 p-[7px] text-amber shadow-[var(--glow-amber)] [background:radial-gradient(circle_at_50%_30%,rgb(255_181_71/0.25),rgb(255_181_71/0.04))]" />
        <span className="font-display text-[24px] leading-none font-extrabold tracking-[0.07em] whitespace-nowrap uppercase max-md:text-[22px]">
          {lang === "es" ? (
            <>
              <span className="max-md:hidden">Planificador </span>VRPTW
            </>
          ) : (
            <>
              VRPTW<span className="max-md:hidden"> Planner</span>
            </>
          )}
        </span>
        <span className="border-l border-line-2 pl-3 font-mono text-[12px] leading-tight tracking-[0.12em] whitespace-nowrap text-fg-3 uppercase max-lg:hidden nav:hidden">
          {t({ es: "Rutas de reparto con horario", en: "Delivery routes with time windows" })}
        </span>
      </Link>
      <nav aria-label={t({ es: "Principal", en: "Main" })} className="flex flex-none items-center gap-0.5 md:gap-2">
        <TourButton />
        {NAV_LINKS.map((l) =>
          NAV_ICONS[l.href] ? (
            // En móvil la marca ya lleva a la portada: su botón deja sitio a los demás.
            <Link key={l.href} href={l.href} className={buttonClass("ghost", l.href === "/" ? "max-nav:btn-icon max-md:hidden" : "max-nav:btn-icon")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {NAV_ICONS[l.href]}
              </svg>
              <span className="max-nav:sr-only">{t(l.label)}</span>
            </Link>
          ) : (
            <Link key={l.href} href={l.href} className={buttonClass("primary", COMPACT_ICONS[l.href] ? "max-md:btn-icon" : "max-md:px-3.5")}>
              {COMPACT_ICONS[l.href] && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="md:hidden">
                  {COMPACT_ICONS[l.href]}
                </svg>
              )}
              <span className={COMPACT_ICONS[l.href] ? "max-md:sr-only" : undefined}>{t(l.label)}</span>
            </Link>
          ),
        )}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "max-nav:btn-icon")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" />
          </svg>
          <span className="max-nav:sr-only">{t({ es: "Repositorio", en: "Repository" })}</span>
        </a>
        <LangSwitch />
      </nav>
    </header>
  );
}
