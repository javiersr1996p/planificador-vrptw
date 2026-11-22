import Link from "next/link";
import { T } from "@/lib/i18n";
import { NAV_LINKS } from "@/lib/nav";

const LEARN_HREF = "/aprende";

/**
 * Tarjeta «Aprende»: solo aparece cuando la página existe en la navegación. Es
 * una sola fila (dibujo, título y flecha); la frase queda para lectores de pantalla.
 */
export function LearnCard() {
  if (!NAV_LINKS.some((l) => l.href === LEARN_HREF)) return null;
  return (
    <Link
      href={LEARN_HREF}
      data-testid="learn-card"
      data-tour="learn"
      data-zone
      className="group relative grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3.5 overflow-hidden rounded-panel border border-amber/50 bg-[radial-gradient(420px_220px_at_100%_0%,rgb(255_181_71/0.2),transparent_60%),linear-gradient(160deg,#15213a,#0a1222)] px-3.5 py-2 text-fg no-underline shadow-[0_20px_50px_-24px_rgb(255_181_71/0.45)] transition-[transform,box-shadow] duration-200 ease-[var(--ease-out)] [@media(hover:hover)]:hover:-translate-y-0.5"
    >
      <svg viewBox="0 0 112 112" aria-hidden="true" className="size-full">
        <circle cx="56" cy="56" r="50" fill="none" stroke="rgb(255 181 71 / 0.25)" strokeDasharray="2 5" />
        <circle cx="56" cy="56" r="32" fill="none" stroke="rgb(255 181 71 / 0.18)" />
        <path d="M56 56 L24 34 L38 84 L82 78 L90 36 Z" fill="none" stroke="var(--veh-1)" strokeWidth="2.5" strokeLinejoin="round" />
        {[
          [24, 34],
          [38, 84],
          [82, 78],
          [90, 36],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill="#07101f" stroke="var(--veh-1)" strokeWidth="2" />
        ))}
        <rect x="48" y="48" width="16" height="16" rx="4" fill="#1a1203" stroke="var(--amber)" strokeWidth="2" />
      </svg>
      <span className="min-w-0">
        <span className="block font-display text-[30px] leading-[0.95] font-extrabold tracking-[0.04em] text-amber uppercase [text-shadow:0_0_24px_rgb(255_181_71/0.45)]">
          <T es="Aprende" en="Learn" />
        </span>
        <span className="sr-only">
          <T es="Rutas, horarios y métodos, explicados con dibujos." en="Routes, schedules and methods, explained with drawings." />
        </span>
      </span>
      <span className="grid size-11 place-items-center rounded-full border border-amber/50 text-amber-2">
        <Arrow />
      </span>
    </Link>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-[18px] transition-transform duration-200 group-hover:translate-x-1">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
