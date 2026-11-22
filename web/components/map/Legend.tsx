"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Kicker } from "@/components/ui/Kicker";
import { useT, type Pair } from "@/lib/i18n";
import { vehicleColor } from "./geometry";

type Props = {
  routes: number[][];
  selectedRoute: number | null;
  onSelectRoute: (route: number | null) => void;
  hasLate: boolean;
  hasUnserved: boolean;
  /** Columna con el número de paradas (pocas furgonetas y sitio); si no, fila desplazable. */
  column: boolean;
  /** Ancho que ocupan los botones del visor, a la derecha de la fila. */
  toolsWidth: number;
};

// Zona pulsable de 44 px alrededor del círculo de 32.
const arrow =
  "absolute top-1/2 z-[1] grid size-8 -translate-y-1/2 place-items-center rounded-full border border-line-2 bg-ink-3 text-lg leading-none text-fg before:absolute before:-inset-1.5 before:content-['']";

const stops = (n: number, t: (pair: Pair) => string) =>
  `${n} ${n === 1 ? t({ es: "parada", en: "stop" }) : t({ es: "paradas", en: "stops" })}`;

/** Leyenda de flota sobre el mapa: un botón por furgoneta y las formas especiales presentes. */
export function Legend({ routes, selectedRoute, onSelectRoute, hasLate, hasUnserved, column, toolsWidth }: Props) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  // Si la fila no cabe, se desplaza: difuminado y flecha en el lado donde quedan furgonetas.
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () =>
      setMore({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [routes, column]);
  const page = (dir: 1 | -1) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
  };
  const fade = column
    ? undefined
    : `linear-gradient(to right, ${more.left ? "transparent, #000 40px" : "#000"}, ${more.right ? "#000 calc(100% - 40px), transparent" : "#000"})`;
  const key = "flex shrink-0 items-center gap-1.5 px-2 text-base text-fg-2";

  return (
    <div data-testid="route-legend" className="contents">
      <div
        className={`hud absolute left-3 top-3 z-[4] min-w-0 ${column ? "flex flex-col gap-0.5 p-1.5" : "p-1"}`}
        style={column ? undefined : { maxWidth: `calc(100% - ${toolsWidth + 32}px)` }}
      >
        {column && <Kicker className="px-2 pb-1 pt-1.5">{t({ es: "Flota", en: "Fleet" })}</Kicker>}
        {!column && more.left && (
          <button type="button" className={`${arrow} left-1`} onClick={() => page(-1)} aria-label={t({ es: "Furgonetas anteriores", en: "Previous vans" })}>
            ‹
          </button>
        )}
        {!column && more.right && (
          <button type="button" className={`${arrow} right-1`} onClick={() => page(1)} aria-label={t({ es: "Más furgonetas", en: "More vans" })}>
            ›
          </button>
        )}
        <div
          ref={scroller}
          data-testid="legend-scroll"
          className={column ? "flex flex-col gap-0.5" : "flex items-center gap-1 overflow-x-auto [scrollbar-width:none]"}
          style={{ maskImage: fade, WebkitMaskImage: fade }}
        >
          {routes.map((route, i) =>
            route.length === 0 ? null : (
              <button
                key={i}
                type="button"
                data-testid="legend-route"
                data-route={i}
                aria-pressed={selectedRoute === i}
                aria-label={`${t({ es: "Furgoneta", en: "Van" })} ${i + 1}: ${stops(route.length, t)}`}
                title={`${t({ es: "Furgoneta", en: "Van" })} ${i + 1}: ${stops(route.length, t)}`}
                onClick={() => onSelectRoute(selectedRoute === i ? null : i)}
                style={{ "--c": vehicleColor(i) } as CSSProperties}
                className={`flex shrink-0 items-center gap-2.5 rounded-tag border border-transparent text-left transition-colors duration-200 ease-[var(--ease-out)] hover:bg-white/5 aria-pressed:border-[var(--c)] aria-pressed:bg-white/5 ${
                  column ? "min-h-9 px-2 py-1" : "h-11 px-2.5"
                }`}
              >
                <span className="h-1 w-6 rounded-full bg-[var(--c)] shadow-[0_0_10px_var(--c)]" aria-hidden="true" />
                <b className="text-base font-semibold">
                  {t({ es: "F", en: "V" })}
                  {i + 1}
                </b>
                {column && <span className="num text-xs uppercase tracking-wider text-fg-3">{stops(route.length, t)}</span>}
              </button>
            ),
          )}
          {hasLate && (
            <span className={`${key} ${column ? "min-h-8" : ""}`}>
              <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
                <rect x="-5" y="-5" width="10" height="10" rx="1.5" transform="rotate(45)" fill="none" stroke="var(--late)" strokeWidth="2" />
              </svg>
              {t({ es: "Con retraso", en: "Late" })}
            </span>
          )}
          {hasUnserved && (
            <span className={`${key} ${column ? "min-h-8" : ""}`}>
              <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
                <rect x="-6" y="-6" width="12" height="12" rx="2" fill="none" stroke="var(--late)" strokeWidth="2" strokeDasharray="3 2" />
              </svg>
              {t({ es: "Sin atender", en: "Unserved" })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
