"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TOUR_BUTTON_ID, connectTour } from "@/components/layout/tour-slot";
import { buttonClass } from "@/components/ui/Button";
import { playback } from "@/lib/playback";
import { placeBubble } from "./place";
import { markSeen, readSeen } from "./seen";
import { TOUR_STEPS, type TourStep } from "./steps";

const PAD = 8;

const present = (step: TourStep) => {
  const el = document.querySelector(step.target);
  return el !== null && el.getClientRects().length > 0;
};

/** Lleva la zona a la vista si no está: las grandes, por su arranque; las pequeñas, al centro. */
function bringIntoView(el: Element) {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const big = r.height > vh * 0.6;
  const visible = big ? r.top >= 0 && r.top <= vh * 0.4 : r.top >= 70 && r.bottom <= vh - 20;
  if (visible) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const offset = big ? r.top - 76 : r.top - (vh - r.height) / 2;
  window.scrollTo({ top: window.scrollY + offset, behavior: reduced ? "auto" : "smooth" });
}

/**
 * Recorrido guiado: un foco de luz sobre cada zona de la portada y un globo
 * con su explicación. No se abre solo: se conecta al botón de la cabecera
 * (`connectTour`). Mientras está abierto, el mapa deja de moverse.
 */
export function Tour() {
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  // El aro late solo si el visitante no había pausado el movimiento (ni lo pide reducido).
  const [ringMotion, setRingMotion] = useState(true);
  const spot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const reconnect = useRef<(attention: boolean) => void>(() => {});

  const open = steps !== null;
  const step = steps?.[index];

  const openTour = useCallback(() => {
    const found = TOUR_STEPS.filter(present);
    if (found.length === 0) return;
    markSeen();
    reconnect.current(false);
    setRingMotion(playback.getSnapshot().motion);
    setIndex(0);
    setSteps(found);
  }, []);

  const closeTour = useCallback(() => {
    setSteps(null);
    document.getElementById(TOUR_BUTTON_ID)?.focus({ preventScroll: true });
  }, []);

  // Conexión con el botón de la cabecera; la llamada discreta, solo la primera visita.
  useEffect(() => {
    let dispose = connectTour({ open: openTour, attention: !readSeen() });
    reconnect.current = (attention) => {
      dispose = connectTour({ open: openTour, attention });
    };
    return () => dispose();
  }, [openTour]);

  // Órbita y adornos del mapa detenidos mientras el recorrido está abierto.
  useEffect(() => {
    if (!open) return;
    const before = playback.getSnapshot().motion;
    playback.setMotion(false);
    return () => {
      if (before) playback.setMotion(true);
    };
  }, [open]);

  // El aro sigue a la base aunque el mapa se mueva (vuelo inicial, arrastre).
  const placeRing = useCallback(() => {
    const el = step?.ring ? document.querySelector(step.target) : null;
    const dot = ring.current;
    if (!dot) return;
    const depot = el?.querySelector('[data-testid="depot"]')?.getBoundingClientRect();
    const zone = el?.getBoundingClientRect();
    const cx = depot ? depot.left + depot.width / 2 : 0;
    const cy = depot ? depot.top + depot.height / 2 : 0;
    const inside = !!depot && !!zone && depot.width > 0 && cx > zone.left && cx < zone.right && cy > zone.top && cy < zone.bottom;
    dot.style.display = inside ? "block" : "none";
    dot.style.left = `${cx}px`;
    dot.style.top = `${cy}px`;
  }, [step]);

  // Posición del foco, del aro y del globo: se escribe en el DOM, sin pasar por React.
  const place = useCallback(() => {
    const el = step && document.querySelector(step.target);
    const box = bubble.current;
    if (!step || !el || !box || !spot.current || !ring.current || !arrow.current) return;
    const r = el.getBoundingClientRect();
    const zone = { left: r.left - PAD, top: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
    Object.assign(spot.current.style, {
      left: `${zone.left}px`,
      top: `${zone.top}px`,
      width: `${zone.width}px`,
      height: `${zone.height}px`,
    });
    const view = { width: window.innerWidth, height: window.innerHeight };
    const p = placeBubble(zone, { width: box.offsetWidth, height: box.offsetHeight }, view);
    Object.assign(box.style, { left: `${p.left}px`, top: `${p.top}px`, visibility: "visible" });
    const a = arrow.current.style;
    a.display = p.arrow === "none" ? "none" : "block";
    a.left = `${p.arrowX}px`;
    a.top = p.arrow === "up" ? "-8px" : "auto";
    a.bottom = p.arrow === "down" ? "-8px" : "auto";
    a.transform = p.arrow === "down" ? "rotate(225deg)" : "rotate(45deg)";

    placeRing();
  }, [step, placeRing]);

  // Al cambiar de paso: la zona a la vista, el globo en su sitio y el foco en "Siguiente".
  useLayoutEffect(() => {
    if (!step) return;
    const el = document.querySelector(step.target);
    if (el) bringIntoView(el);
    place();
    next.current?.focus({ preventScroll: true });
  }, [step, place]);

  // Recolocar al desplazar, cambiar el tamaño de la ventana o de la zona, y cuando el mapa
  // mueve sus marcadores (vuelo inicial, arrastre), que cambian su `style`: sin bucle de fotogramas.
  useEffect(() => {
    if (!step) return;
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const el = document.querySelector(step.target);
    const observer = new ResizeObserver(again);
    if (el) observer.observe(el);
    observer.observe(document.body);
    const moves = new MutationObserver(again);
    if (step.ring && el) moves.observe(el, { subtree: true, childList: true, attributeFilter: ["style", "transform"] });
    window.addEventListener("scroll", again, { passive: true });
    window.addEventListener("resize", again);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      moves.disconnect();
      window.removeEventListener("scroll", again);
      window.removeEventListener("resize", again);
    };
  }, [step, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) closeTour();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeTour]);

  if (!steps || !step) return null;
  const last = index === steps.length - 1;

  return (
    <div className="pointer-events-none fixed inset-0 z-50" data-testid="tour">
      <div
        ref={spot}
        data-testid="tour-spot"
        aria-hidden="true"
        className="fixed rounded-[18px] outline-2 outline-amber shadow-[0_0_0_200vmax_rgb(2_4_9/0.74)] motion-safe:transition-[left,top,width,height] motion-safe:duration-[400ms] motion-safe:ease-[var(--ease-out)]"
      />
      <div
        ref={ring}
        data-testid="tour-ring"
        data-motion={ringMotion ? "on" : "off"}
        aria-hidden="true"
        className="decor fixed z-[51] hidden size-[56px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber shadow-[0_0_30px_rgb(255_181_71/0.7)] animate-[ping_1.8s_var(--ease-out)_infinite]"
      />
      <div
        ref={bubble}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        data-testid="tour-bubble"
        style={{ visibility: "hidden" }}
        className="pointer-events-auto fixed w-[min(400px,calc(100vw-32px))] animate-[pop_250ms_var(--ease-out)_both] rounded-[14px] border border-amber/65 bg-ink-3 px-4 py-3.5 shadow-[0_30px_70px_-20px_rgb(0_0_0/0.95),0_0_46px_-10px_rgb(255_181_71/0.45)]"
      >
        <div
          ref={arrow}
          aria-hidden="true"
          className="absolute size-3.5 border-t border-l border-amber/65 bg-ink-3"
        />
        <div className="flex items-center justify-between gap-3">
          <span id="tour-title" className="kicker">
            Recorrido guiado
          </span>
          <span data-testid="tour-step" className="num text-base leading-none font-semibold text-amber">
            {index + 1}/{steps.length}
          </span>
        </div>
        <p data-testid="tour-text" aria-live="polite" className="mt-2.5 mb-3 text-[17px] leading-[1.4] text-fg">
          {step.text}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" data-testid="tour-close" className={buttonClass()} onClick={closeTour}>
            Salir
          </button>
          <button
            type="button"
            ref={next}
            data-testid="tour-next"
            className={buttonClass("primary")}
            onClick={() => (last ? closeTour() : setIndex(index + 1))}
          >
            {last ? "Terminar" : "Siguiente"}
          </button>
        </div>
      </div>
    </div>
  );
}
