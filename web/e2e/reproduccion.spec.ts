import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { formatNumber, formatTime } from "../lib/format";
import { blockService, stubMapStyle } from "./helpers";

// Reproducción del día: barra, reloj, deslizador, línea de estado y vuelta a la base.
// Sin red: servicio apagado y estilo del mapa sustituido.

type Stop = { customer: number; arrival: number; start: number; late: number };
type Run = {
  run_id: string;
  method: string;
  evaluation: { score: number; feasible: boolean; stops: Stop[][]; depot_arrival: number[] | null } | null;
};
type Customer = { id: number; address: string | null };
type CaseFile = { instance: { depot: { ready: number }; customers: Customer[] }; runs: Run[] };

const DATA = path.join(__dirname, "..", "public", "data", "cases");
const readCase = (id: string): CaseFile => JSON.parse(readFileSync(path.join(DATA, `${id}.json`), "utf8"));
const bestValid = (c: CaseFile) =>
  c.runs.filter((r) => r.evaluation?.feasible).sort((a, b) => a.evaluation!.score - b.evaluation!.score)[0];

const clock = (page: Page) => page.getByTestId("sim-clock");
const scrubber = (page: Page) => page.getByTestId("scrubber");

async function openCase(page: Page, id: string): Promise<void> {
  const card = page.locator(`[data-testid="example-card"][data-case-id="${id}"]`);
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("comparison-row")).toHaveCount(readCase(id).runs.length);
}

test.beforeEach(async ({ page }) => {
  await blockService(page);
  await stubMapStyle(page);
  await page.goto("/");
  await expect(page.getByTestId("comparison-row")).toHaveCount(4);
});

test("la barra trae un carril por furgoneta del plan seleccionado y el reloj empieza al abrir la base", async ({ page }) => {
  const madrid = readCase("madrid-12");
  await expect(page.getByTestId("lane")).toHaveCount(bestValid(madrid).evaluation!.stops.length);
  await expect(clock(page)).toHaveText(formatTime(madrid.instance.depot.ready));
  await expect(page.getByTestId("radio-line")).toHaveAttribute("aria-live", "polite");
  await expect(page.getByTestId("radio-line")).toContainText("Pulsa «Reproducir»");
});

test("reproducir: el reloj avanza y se detiene al final del día", async ({ page }) => {
  const ev = bestValid(readCase("madrid-12")).evaluation!;
  const end = Math.max(...ev.depot_arrival!);
  const speed = page.getByTestId("speed-button");
  await speed.click();
  await speed.click();
  await expect(speed).toHaveAccessibleName("Velocidad de reproducción: ×10");

  const play = page.getByTestId("play-button");
  await play.click();
  await expect(play).toHaveAttribute("aria-pressed", "true");
  await expect(clock(page)).not.toHaveText("08:00");
  // A ×10 el día dura 3 s: al acabar, el reloj marca la última vuelta y la barra se para.
  await expect(clock(page)).toHaveText(formatTime(end), { timeout: 10_000 });
  await expect(play).toHaveAttribute("aria-pressed", "false");
  await expect(play).toContainText("Repetir");
  const settled = await clock(page).textContent();
  await page.waitForTimeout(400);
  await expect(clock(page)).toHaveText(settled!);
  await expect(page.getByTestId("radio-line")).toContainText("vuelve a la base");
});

test("el deslizador lleva el reloj a la hora pedida y la línea de estado nombra un cliente del caso", async ({ page }) => {
  const madrid = readCase("madrid-12");
  const names = madrid.instance.customers.map((c) => c.address!.split(",")[0].trim());
  await scrubber(page).fill("630");
  await expect(clock(page)).toHaveText("10:30");
  await expect(scrubber(page)).toHaveAttribute("aria-valuetext", "10:30");
  const text = (await page.getByTestId("radio-line").textContent())!;
  expect(names.some((n) => text.includes(n)), `«${text}» nombra un cliente`).toBe(true);

  await scrubber(page).fill("540");
  await expect(clock(page)).toHaveText("09:00");
});

test("«Vuelta a la base» muestra la hora de depot_arrival de cada furgoneta", async ({ page }) => {
  const ev = bestValid(readCase("madrid-12")).evaluation!;
  for (let r = 0; r < ev.stops.length; r++) {
    await page.getByTestId("detail-lane").nth(r).click();
    await expect(page.getByTestId("detail")).toHaveAttribute("data-selected-route", String(r));
    await expect(page.getByTestId("depot-return")).toHaveText(formatTime(ev.depot_arrival![r]));
  }
});

test("en un caso sin horas reales, el reloj va en las unidades de la instancia", async ({ page }) => {
  const tfe = readCase("tfe2024-10c-1");
  await openCase(page, "tfe2024-10c-1");
  await expect(clock(page)).toHaveText(formatNumber(tfe.instance.depot.ready, 1));
  await scrubber(page).fill("100");
  await expect(clock(page)).toHaveText(formatNumber(100, 1));
  const ev = bestValid(tfe).evaluation!;
  await expect(page.getByTestId("lane")).toHaveCount(ev.stops.length);
  const route = Number(await page.getByTestId("detail-lane").and(page.locator('[aria-selected="true"]')).getAttribute("data-route"));
  await expect(page.getByTestId("depot-return")).toHaveText(formatNumber(ev.depot_arrival![route], 1));
});

test.describe("con movimiento reducido", () => {
  test.use({ reducedMotion: "reduce" });

  test("el reloj no avanza solo y el deslizador sigue funcionando", async ({ page }) => {
    const play = page.getByTestId("play-button");
    await expect(play).toBeDisabled();
    await play.click({ force: true });
    await page.waitForTimeout(800);
    await expect(clock(page)).toHaveText("08:00");
    await expect(page.getByTestId("radio-line")).toContainText("Mueve el deslizador");

    await scrubber(page).fill("700");
    await expect(clock(page)).toHaveText("11:40");
    await page.waitForTimeout(500);
    await expect(clock(page)).toHaveText("11:40");
  });
});
