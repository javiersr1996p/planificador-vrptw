import { expect, test } from "@playwright/test";
import { formatCost, formatDuration, formatEuro, formatNumber, formatTime } from "../lib/format";

test.describe("lib/format", () => {
  test("formatTime da HH:MM desde minutos", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(485)).toBe("08:05");
    expect(formatTime(479.6)).toBe("08:00");
    expect(formatTime(1510)).toBe("25:10");
    expect(formatTime(-1)).toBe("--:--");
    expect(formatTime(Number.NaN)).toBe("--:--");
  });

  test("formatNumber usa coma decimal y punto de millares desde 10 000", () => {
    expect(formatNumber(1234.56, 1)).toBe("1234,6");
    expect(formatNumber(12345.678, 2)).toBe("12.345,68");
    expect(formatNumber(3, 0)).toBe("3");
    expect(formatNumber(-2.5, 1)).toBe("-2,5");
    expect(formatNumber(-0.01, 1)).toBe("0,0");
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("–");
  });

  test("costes y euros", () => {
    expect(formatCost(1523.456)).toBe("1523,5");
    expect(formatEuro(0.0312)).toBe("0,0312 €");
  });

  test("formatDuration elige la unidad", () => {
    expect(formatDuration(0.85)).toBe("850 ms");
    expect(formatDuration(12.34)).toBe("12,3 s");
    expect(formatDuration(125)).toBe("2 min 5 s");
    expect(formatDuration(120)).toBe("2 min");
    // Se redondea antes de elegir la unidad: nada de «1 min 60 s» ni «60,0 s».
    expect(formatDuration(119.6)).toBe("2 min");
    expect(formatDuration(59.96)).toBe("1 min");
    expect(formatDuration(0.9996)).toBe("1,0 s");
    expect(formatDuration(-1)).toBe("–");
  });

  test("en inglés: punto decimal, coma de millares desde 1 000 y euro delante", () => {
    expect(formatNumber(1234.5, 1, "en")).toBe("1,234.5");
    expect(formatNumber(1234567.891, 2, "en")).toBe("1,234,567.89");
    expect(formatNumber(999, 0, "en")).toBe("999");
    expect(formatNumber(-2.5, 1, "en")).toBe("-2.5");
    expect(formatCost(1523.456, 1, "en")).toBe("1,523.5");
    expect(formatEuro(0.0312, 4, "en")).toBe("€0.0312");
    expect(formatDuration(12.34, "en")).toBe("12.3 s");
    expect(formatDuration(125, "en")).toBe("2 min 5 s");
    // La hora va en 24 h en los dos idiomas.
    expect(formatTime(845)).toBe("14:05");
  });

  test("el español no cambia sin idioma explícito", () => {
    expect(formatNumber(1234.5, 1, "es")).toBe(formatNumber(1234.5, 1));
    expect(formatNumber(12345.6, 1)).toBe("12.345,6");
  });
});
