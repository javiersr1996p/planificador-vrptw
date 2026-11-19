export type Box = { left: number; top: number; width: number; height: number };

export type Placement = {
  /** Esquina del globo, en coordenadas de ventana. */
  left: number;
  top: number;
  /** Lado de la flecha que apunta a la zona; `none` si el globo se superpone. */
  arrow: "up" | "down" | "none";
  /** Posición horizontal de la flecha dentro del globo. */
  arrowX: number;
};

const MARGIN = 16;
const GAP = 14;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Coloca el globo bajo la zona, o sobre ella si no cabe debajo; si no cabe en
 * ninguno de los dos lados (zona muy alta), lo superpone dentro de la ventana.
 */
export function placeBubble(zone: Box, bubble: { width: number; height: number }, view: { width: number; height: number }): Placement {
  const { width: bw, height: bh } = bubble;
  const left = clamp(zone.left, MARGIN, view.width - bw - MARGIN);
  const arrowX = clamp(zone.left + Math.min(zone.width, 200) / 2 - left, MARGIN, bw - 30);
  const below = view.height - (zone.top + zone.height);
  const above = zone.top;
  if (below > bh + GAP + MARGIN) return { left, top: zone.top + zone.height + GAP, arrow: "up", arrowX };
  if (above > bh + GAP + MARGIN) return { left, top: zone.top - GAP - bh, arrow: "down", arrowX };
  const top = Math.min(Math.max(MARGIN, zone.top + MARGIN), view.height - bh - MARGIN);
  return { left: clamp(zone.left + MARGIN, MARGIN, view.width - bw - MARGIN), top, arrow: "none", arrowX };
}
