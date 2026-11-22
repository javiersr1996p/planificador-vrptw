/**
 * Formato de cifras según el idioma. Español: coma decimal y punto de millares a partir de
 * 10 000. Inglés: punto decimal y coma de millares desde 1 000 (`1,234.5`).
 *
 * Cada función recibe `lang` como último parámetro (por defecto `es`, que usan las pruebas y el
 * código sin idioma). Los componentes usan `useFormat()`, que las devuelve ya ligadas al idioma.
 */
import { useMemo } from "react";
import { useLang, type Lang } from "@/lib/i18n";

function group(intPart: string, lang: Lang): string {
  if (lang === "en") return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return intPart.length >= 5 ? intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : intPart;
}

export function formatNumber(value: number, digits = 1, lang: Lang = "es"): string {
  if (!Number.isFinite(value)) return "–";
  const fixed = Math.abs(value).toFixed(digits);
  const [int, dec] = fixed.split(".");
  const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
  return sign + group(int, lang) + (dec ? (lang === "en" ? "." : ",") + dec : "");
}

/** Minutos desde medianoche a `HH:MM` (24 h en los dos idiomas). Más de 24 h sigue contando (25:10). */
export function formatTime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "--:--";
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Coste de una solución, en las unidades de la instancia. */
export function formatCost(value: number, digits = 1, lang: Lang = "es"): string {
  return formatNumber(value, digits, lang);
}

/** `0,0123 €` en español, `€0.0123` en inglés. */
export function formatEuro(value: number, digits = 4, lang: Lang = "es"): string {
  const n = formatNumber(value, digits, lang);
  return lang === "en" ? `€${n}` : `${n} €`;
}

/** Duración en segundos: `850 ms`, `12,3 s`, `2 min 5 s`. Se redondea antes de elegir la unidad. */
export function formatDuration(seconds: number, lang: Lang = "es"): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "–";
  const ms = Math.round(seconds * 1000);
  if (ms < 1000) return `${ms} ms`;
  const tenths = Math.round(seconds * 10);
  if (tenths < 600) return `${formatNumber(tenths / 10, 1, lang)} s`;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

/** Las funciones de formato ligadas al idioma activo; los componentes las llaman al pintar. */
export function useFormat() {
  const [lang] = useLang();
  return useMemo(
    () => ({
      lang,
      formatNumber: (value: number, digits = 1) => formatNumber(value, digits, lang),
      formatCost: (value: number, digits = 1) => formatCost(value, digits, lang),
      formatEuro: (value: number, digits = 4) => formatEuro(value, digits, lang),
      formatDuration: (seconds: number) => formatDuration(seconds, lang),
      formatTime,
    }),
    [lang],
  );
}
