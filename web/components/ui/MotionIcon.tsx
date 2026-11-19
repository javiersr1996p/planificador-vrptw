import { useId } from "react";

/** Icono del interruptor de animación: destellos, para no confundirlo con «Reproducir el día»; tachado si está quitada. */
export function MotionIcon({ on }: { on: boolean }) {
  // La raya abre un hueco en los destellos para que no se fundan con ella.
  const cut = `motion-cut-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
      {!on && (
        <mask id={cut}>
          <rect width="18" height="18" fill="white" />
          <path d="M2 16 16 2" stroke="black" strokeWidth="3" strokeLinecap="round" />
        </mask>
      )}
      <g mask={on ? undefined : `url(#${cut})`}>
        <path d="M7.5 3Q8.9 8.6 14.5 10Q8.9 11.4 7.5 17Q6.1 11.4 0.5 10Q6.1 8.6 7.5 3Z" />
        <path d="M14.5 1Q14.9 3.1 17 3.5Q14.9 3.9 14.5 6Q14.1 3.9 12 3.5Q14.1 3.1 14.5 1Z" />
      </g>
      {!on && <path d="M2 16 16 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  );
}
