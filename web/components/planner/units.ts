import { formatNumber, formatTime } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import type { components } from "@/lib/types";

type S = components["schemas"];

/**
 * En los casos reales el tiempo va en minutos desde las 00:00 y se muestra
 * como `HH:MM`; en el resto, en las unidades de la instancia, sin convertir.
 */
export function isReal(instance: S["Instance"]): boolean {
  return instance.source === "real";
}

/** Un instante: `08:03` en casos reales, `90,2` (`90.2` en inglés) en el resto. */
export function formatClock(value: number, real: boolean, lang: Lang = "es"): string {
  return real ? formatTime(value) : formatNumber(value, 1, lang);
}

/** Una duración: `36 min` o `3 h 56 min` en casos reales, `36,4` (`36.4` en inglés) en el resto. */
export function formatSpan(value: number, real: boolean, lang: Lang = "es"): string {
  if (!real) return formatNumber(value, 1, lang);
  const total = Math.round(value);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** La instancia trae coordenadas geográficas (se dibuja sobre un mapa real). */
export function hasGeo(instance: S["Instance"]): boolean {
  return instance.depot.lat != null && instance.depot.lon != null;
}

/** Nombre de un cliente: el lugar en casos reales, «Cliente N» («Customer N») en el resto. */
export function customerName(c: S["Customer"] | undefined, id: number, real: boolean, lang: Lang = "es"): string {
  if (real && c?.address) return c.address.split(",")[0].trim();
  return `${lang === "en" ? "Customer" : "Cliente"} ${id}`;
}

/** Nombre de la base en casos reales (primer campo de su dirección), o `null`. */
export function depotName(instance: S["Instance"]): string | null {
  const address = instance.depot.address;
  return isReal(instance) && address ? address.split(",")[0].trim() : null;
}

/** Ciudad de la base (penúltimo campo de su dirección) en casos con mapa, o `null`. */
export function cityOf(instance: S["Instance"]): string | null {
  if (!hasGeo(instance) || !instance.depot.address) return null;
  const parts = instance.depot.address.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 2] : null;
}

/** Color de la furgoneta `i` (índice de ruta): diez colores en ciclo. */
export const vehicleColor = (i: number) => `var(--veh-${(i % 10) + 1})`;

/** «1 furgoneta», «3 furgonetas». */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
