"use client";

import { MotionIcon } from "@/components/ui/MotionIcon";
import { useT } from "@/lib/i18n";

type Props = {
  motion: boolean;
  /** Con sitio, el botón de movimiento lleva texto; si no, solo el icono. */
  wide: boolean;
  onMotion: () => void;
  onRecenter: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

const tool =
  "inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-[9px] px-2.5 text-base font-semibold text-fg-2 transition-colors duration-200 ease-[var(--ease-out)] hover:bg-white/5 hover:text-fg";

/** Botones del visor: pausar el movimiento, recentrar y zoom. Los mismos en el mapa y en el plano. */
export function MapTools({ motion, wide, onMotion, onRecenter, onZoomIn, onZoomOut }: Props) {
  const t = useT();
  return (
    <div className="absolute right-3 top-3 z-[4] flex flex-col items-end gap-2">
      <div className="hud flex gap-1 p-1">
        <button
          type="button"
          role="switch"
          data-testid="motion-toggle"
          aria-checked={motion}
          aria-label={t({ es: "Animación", en: "Animation" })}
          title={
            motion
              ? t({ es: "Quitar la animación del mapa", en: "Turn off the map animation" })
              : t({ es: "Volver a animar el mapa", en: "Turn the map animation back on" })
          }
          className={`${tool} aria-[checked=false]:text-amber`}
          onClick={onMotion}
        >
          <MotionIcon on={motion} />
          {wide && (
            <span>
              {motion ? t({ es: "Animación: sí", en: "Animation: on" }) : t({ es: "Animación: no", en: "Animation: off" })}
            </span>
          )}
        </button>
        <button type="button" data-testid="recenter" aria-label={t({ es: "Recentrar", en: "Recenter" })} title={t({ es: "Recentrar", en: "Recenter" })} className={tool} onClick={onRecenter}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <circle cx="9" cy="9" r="3.2" />
            <path d="M9 1.5v3M9 13.5v3M1.5 9h3M13.5 9h3" />
          </svg>
        </button>
      </div>
      <div className="hud flex flex-col p-1">
        <button type="button" className={tool} onClick={onZoomIn} aria-label={t({ es: "Acercar", en: "Zoom in" })} title={t({ es: "Acercar", en: "Zoom in" })}>
          +
        </button>
        <button type="button" className={tool} onClick={onZoomOut} aria-label={t({ es: "Alejar", en: "Zoom out" })} title={t({ es: "Alejar", en: "Zoom out" })}>
          −
        </button>
      </div>
    </div>
  );
}
