import type { CSSProperties, ReactNode } from "react";
import { Corners } from "@/components/ui/Corners";
import { TowerIcon } from "@/components/ui/TowerIcon";
import type { Pt } from "./toy";

/** Posición absoluta de un marcador, centrado en `pt` (en % del escenario). */
export const at = (pt: Pt): CSSProperties => ({ left: `${pt.x}%`, top: `${pt.y}%` });

/** Escenario del dibujo: fondo de radar, esquinas de visor y su contenido encima. */
export function Stage({ className, children, ...props }: { className?: string; children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <div className={["lrn-stage", className].filter(Boolean).join(" ")} {...props}>
      {children}
      <Corners />
    </div>
  );
}

/** SVG de 0 a 100 que ocupa todo el escenario (las líneas no engordan al estirarse). */
export function StageSvg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
      {children}
    </svg>
  );
}

/** La base: torre ámbar con su rótulo. */
export function BaseMarker({ pt }: { pt: Pt }) {
  return (
    <span className="absolute z-[1] grid -translate-1/2 justify-items-center gap-1" style={at(pt)} aria-hidden="true">
      <span className="grid size-11 place-items-center rounded-xl border-2 border-amber bg-[#1a1203] text-amber shadow-[0_0_28px_4px_rgb(255_181_71/0.45)]">
        <TowerIcon className="size-6" />
      </span>
      <span className="absolute top-full mt-1 rounded-tag bg-ink-0/80 px-1.5 py-0.5 font-mono text-[12px] leading-none font-semibold tracking-[0.12em] text-amber uppercase">
        Base
      </span>
    </span>
  );
}

/**
 * Ruta de un vehículo, tramo a tramo: la ida continua y la vuelta a la base
 * discontinua. Cada tramo nuevo se dibuja al aparecer; los que ya estaban, no.
 */
export function RouteSegments({ stops, color }: { stops: { id: string; pt: Pt }[]; color: string }) {
  if (stops.length < 2) return null;
  const glow = { stroke: color, filter: `drop-shadow(0 0 4px ${color})` };
  return (
    <g>
      {stops.slice(1).map((to, k) => {
        const from = stops[k];
        const back = k === stops.length - 2;
        return (
          <line
            key={`${from.id}-${to.id}${back ? "-vuelta" : ""}`}
            x1={from.pt.x}
            y1={from.pt.y}
            x2={to.pt.x}
            y2={to.pt.y}
            className={back ? "lrn-route" : "lrn-route lrn-fade-in decor"}
            strokeDasharray={back ? "5 6" : undefined}
            style={back ? { stroke: color, opacity: 0.55 } : glow}
          />
        );
      })}
    </g>
  );
}

/** Marca «ejemplo ilustrativo» o «datos reales». */
export function SourceTag({ real }: { real: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[12px] leading-none font-semibold tracking-[0.1em] uppercase ${
        real ? "border-ok/50 text-ok" : "border-line-2 text-fg-3"
      }`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${real ? "bg-ok" : "bg-fg-3"}`} />
      {real ? "Datos reales" : "Ejemplo ilustrativo"}
    </span>
  );
}

/** Rótulo de estado con icono y texto (nunca solo color). */
export function StateIcon({ state, className = "size-5" }: { state: "ok" | "wait" | "late" | "bad"; className?: string }) {
  if (state === "ok")
    return (
      <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
        <circle cx="10" cy="10" r="9" fill="var(--ok)" />
        <path d="m5.8 10.3 2.7 2.7 5.7-6" fill="none" stroke="var(--ink-0)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (state === "wait")
    return (
      <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
        <circle cx="10" cy="10" r="9" fill="var(--wait)" />
        <path d="M6.5 5h7M6.5 15h7M7.3 5c0 3 5.4 3 5.4 5s-5.4 2-5.4 5M12.7 5c0 3-5.4 3-5.4 5s5.4 2 5.4 5" fill="none" stroke="var(--ink-0)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  if (state === "late")
    return (
      <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
        <path d="M10 1 19 10 10 19 1 10Z" fill="var(--late)" />
        <path d="M10 5.5v5.5" stroke="var(--ink-0)" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="10" cy="14.2" r="1.3" fill="var(--ink-0)" />
      </svg>
    );
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="var(--late)" />
      <path d="m6.5 6.5 7 7m0-7-7 7" stroke="var(--ink-0)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** Flecha de botón. */
export function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={back ? "M19 12H5M11 6l-6 6 6 6" : "M5 12h14M13 6l6 6-6 6"} />
    </svg>
  );
}

/** Furgoneta vista de lado, en el color de su ruta. */
export function VanGlyph({ color, className }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 64 36" className={className} aria-hidden="true">
      <rect x="3" y="6" width="38" height="22" rx="3" fill="#0c1729" stroke={color} strokeWidth="2.5" />
      <path d="M41 12h11l8 9v7H41z" fill="#0c1729" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M45 15h6l4.5 5H45z" fill={color} opacity="0.55" />
      <circle cx="14" cy="29" r="5" fill="#04070d" stroke={color} strokeWidth="2.5" />
      <circle cx="50" cy="29" r="5" fill="#04070d" stroke={color} strokeWidth="2.5" />
    </svg>
  );
}
