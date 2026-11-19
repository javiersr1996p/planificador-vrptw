import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

/*
  Contraste WCAG 2.x de los pares de color del sistema visual, medido sobre los
  valores hexadecimales de app/globals.css (sin navegador). Umbral AA de texto
  normal, 4,5:1, en todos los pares: los colores de furgoneta y de estado se
  usan también como texto.
*/

const css = readFileSync(path.join(__dirname, "..", "app", "globals.css"), "utf8");
const vars = new Map<string, string>();
for (const [, name, hex] of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
  if (!vars.has(name)) vars.set(name, hex.toLowerCase());
}

function color(name: string): string {
  const hex = vars.get(name);
  if (!hex) throw new Error(`--${name} no está definida con un valor hexadecimal en globals.css`);
  return hex;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;
const BACKGROUNDS = ["ink-0", "ink-1", "ink-2", "ink-3"];
const VEHICLES = Array.from({ length: 10 }, (_, i) => `veh-${i + 1}`);
const STATES = ["ok", "wait", "late"];

const PAIRS: [fg: string, bg: string][] = [
  ...["fg", "fg-2", "fg-3"].flatMap((fg) => BACKGROUNDS.map((bg): [string, string] => [fg, bg])),
  ...[...VEHICLES, ...STATES].flatMap((fg) => ["ink-0", "ink-2"].map((bg): [string, string] => [fg, bg])),
  ["amber-ink", "amber"],
  ["amber-ink", "amber-2"],
];

test.describe("contraste del sistema visual", () => {
  test("la paleta tiene diez colores de furgoneta distintos", () => {
    const palette = VEHICLES.map(color);
    expect(new Set(palette).size).toBe(10);
  });

  for (const [fg, bg] of PAIRS) {
    test(`--${fg} sobre --${bg}: ${AA}:1 o más`, () => {
      expect(ratio(color(fg), color(bg))).toBeGreaterThanOrEqual(AA);
    });
  }

  test("tabla de cifras", () => {
    const rows = PAIRS.map(([fg, bg]) => `| --${fg} ${color(fg)} | --${bg} ${color(bg)} | ${ratio(color(fg), color(bg)).toFixed(2)} |`);
    console.log(["| Texto | Fondo | Contraste |", "|---|---|---|", ...rows].join("\n"));
  });
});
