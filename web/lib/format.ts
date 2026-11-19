/** Formato de cifras en español: coma decimal y punto de millares a partir de 10 000. */

function group(intPart: string): string {
  return intPart.length >= 5 ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : intPart;
}

export function formatNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "–";
  const fixed = Math.abs(value).toFixed(digits);
  const [int, dec] = fixed.split(".");
  const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
  return sign + group(int) + (dec ? "," + dec : "");
}

/** Minutos desde medianoche a `HH:MM`. Más de 24 h sigue contando (25:10). */
export function formatTime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "--:--";
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Coste de una solución, en las unidades de la instancia. */
export function formatCost(value: number, digits = 1): string {
  return formatNumber(value, digits);
}

export function formatEuro(value: number, digits = 4): string {
  return `${formatNumber(value, digits)} €`;
}

/** Duración en segundos: `850 ms`, `12,3 s`, `2 min 5 s`. Se redondea antes de elegir la unidad. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "–";
  const ms = Math.round(seconds * 1000);
  if (ms < 1000) return `${ms} ms`;
  const tenths = Math.round(seconds * 10);
  if (tenths < 600) return `${formatNumber(tenths / 10, 1)} s`;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}
