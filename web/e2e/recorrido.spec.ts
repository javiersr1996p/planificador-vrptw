import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { blockService, motionLoops, pageHeight, stubMapStyle } from "./helpers";

// Recorrido guiado: pasos, teclado, foco, movimiento reducido y almacenamiento.
// Sin red: servicio apagado y estilo del mapa sustituido. Con TOUR_SHOTS=<carpeta>
// guarda una captura de cada paso.

const ZONES = ["map", "play", "hook", "comparison", "detail", "learn"];
const SHOTS = process.env.TOUR_SHOTS;

const startButton = (page: Page) => page.getByTestId("tour-start");
const bubble = (page: Page) => page.getByTestId("tour-bubble");

/** Con `/aprende` en la navegación hay seis pasos; sin ella, cinco. */
async function expectedSteps(page: Page): Promise<string[]> {
  const learn = (await page.getByTestId("learn-card").count()) > 0;
  return learn ? ZONES : ZONES.slice(0, 5);
}

/** La zona del paso y el globo están dentro de la ventana, y el foco de luz sigue a la zona. */
async function expectStepInView(page: Page, zone: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((z) => {
          const el = document.querySelector(`[data-tour="${z}"]`)!;
          const r = el.getBoundingClientRect();
          const b = document.querySelector('[data-testid="tour-bubble"]')!.getBoundingClientRect();
          const s = document.querySelector('[data-testid="tour-spot"]')!.getBoundingClientRect();
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const fits = r.height <= vh - 100;
          return {
            zoneStartsInView: r.top >= 0 && r.top < vh - 40 && r.right > 0 && r.left < vw,
            zoneFullyInView: !fits || (r.top >= 0 && r.bottom <= vh),
            bubbleInView: b.left >= 0 && b.right <= vw && b.top >= 0 && b.bottom <= vh,
            spotOnZone: Math.abs(s.left - (r.left - 8)) < 2 && Math.abs(s.top - (r.top - 8)) < 2,
          };
        }, zone),
      { message: `zona ${zone}` },
    )
    .toEqual({ zoneStartsInView: true, zoneFullyInView: true, bubbleInView: true, spotOnZone: true });
}

/** El aro del paso 1 rodea la base, también tras el vuelo inicial del mapa. */
async function expectRingOnDepot(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const depot = await page.getByTestId("depot").boundingBox();
      const ring = await page.getByTestId("tour-ring").boundingBox();
      if (!depot || !ring) return Infinity;
      return Math.hypot(depot.x + depot.width / 2 - (ring.x + ring.width / 2), depot.y + depot.height / 2 - (ring.y + ring.height / 2));
    })
    .toBeLessThan(8);
}

/** Animaciones en marcha del aro del paso 1. */
const ringAnimations = (page: Page) =>
  page.getByTestId("tour-ring").evaluate((el) => el.getAnimations().filter((a) => a.playState === "running").length);

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) });
}

test.beforeEach(async ({ page }) => {
  await blockService(page);
  await stubMapStyle(page);
  await page.goto("/");
  await expect(page.getByTestId("comparison-row")).toHaveCount(4);
  await expect(startButton(page)).toBeVisible();
});

test("no se abre solo: la primera visita muestra una llamada en el botón y no guarda nada", async ({ page }) => {
  await expect(startButton(page)).toHaveAttribute("data-attention", "true");
  await expect(bubble(page)).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test("recorre los pasos con teclado, deja cada zona a la vista y no cambia la altura", async ({ page }, testInfo) => {
  const zones = await expectedSteps(page);
  const height = await pageHeight(page);
  const size = testInfo.project.name === "mobile-390" ? "390" : "1440";

  await startButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(bubble(page)).toBeVisible();
  await expect(bubble(page)).toHaveAttribute("role", "dialog");
  await expect(page.getByTestId("tour-next")).toBeFocused();
  await expect(page.getByTestId("route-map")).toHaveAttribute("data-motion", "off");

  for (const [i, zone] of zones.entries()) {
    await expect(page.getByTestId("tour-step")).toHaveText(`${i + 1}/${zones.length}`);
    await expect(page.getByTestId("tour-text")).not.toBeEmpty();
    await expectStepInView(page, zone);
    if (i === 0) await expectRingOnDepot(page);
    expect(await pageHeight(page)).toBe(height);
    await shot(page, `${size}-paso${i + 1}-${zone}.png`);
    if (i < zones.length - 1) {
      await expect(page.getByTestId("tour-next")).toHaveText("Siguiente");
    } else {
      await expect(page.getByTestId("tour-next")).toHaveText("Terminar");
    }
    await page.keyboard.press("Enter");
  }

  await expect(bubble(page)).toHaveCount(0);
  await expect(startButton(page)).toBeFocused();
  await expect(page.getByTestId("route-map")).toHaveAttribute("data-motion", "on");
  expect(await pageHeight(page)).toBe(height);
});

test("el aro sigue a la base sin un bucle de fotogramas y late mientras haya movimiento", async ({ page }) => {
  await expect(page.getByTestId("route-map")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
  await startButton(page).click();
  await expect(bubble(page)).toBeVisible();
  await expectRingOnDepot(page);
  await page.waitForTimeout(600);
  expect((await motionLoops(page)).loop, "bucle de fotogramas con el aro a la vista").toBe(false);
  expect(await ringAnimations(page)).toBe(1);
});

test("con «Animación: no», el aro queda quieto", async ({ page }) => {
  await expect(page.getByTestId("route-map")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
  const toggle = page.getByTestId("motion-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await startButton(page).click();
  await expectRingOnDepot(page);
  expect(await ringAnimations(page)).toBe(0);
});

test("Escape cierra el recorrido y devuelve el foco al botón; Salir también", async ({ page }) => {
  await startButton(page).click();
  await expect(bubble(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bubble(page)).toHaveCount(0);
  await expect(startButton(page)).toBeFocused();
  await expect(page.getByTestId("route-map")).toHaveAttribute("data-motion", "on");

  await startButton(page).click();
  await page.getByTestId("tour-close").click();
  await expect(bubble(page)).toHaveCount(0);
  await expect(startButton(page)).toBeFocused();
});

test("las zonas táctiles del globo miden 44 px y el texto 16 px o más", async ({ page }) => {
  await startButton(page).click();
  for (const id of ["tour-next", "tour-close"]) {
    // offset*: tamaño del elemento en el diseño, sin la escala de la animación de entrada.
    const box = await page.getByTestId(id).evaluate((el) => ({ w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight }));
    expect(box.h).toBeGreaterThanOrEqual(44);
    expect(box.w).toBeGreaterThanOrEqual(44);
  }
  const size = await page.getByTestId("tour-text").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
});

test("solo se guarda la clave vrptw-tour y la llamada desaparece tras verlo", async ({ page }) => {
  await startButton(page).click();
  await page.getByTestId("tour-close").click();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(["vrptw-tour"]);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);

  await page.reload();
  await expect(page.getByTestId("comparison-row")).toHaveCount(4);
  await expect(startButton(page)).toBeVisible();
  await expect(startButton(page)).not.toHaveAttribute("data-attention", "true");
  await expect(bubble(page)).toHaveCount(0);
});

test.describe("con movimiento reducido", () => {
  test.use({ reducedMotion: "reduce" });

  test("no hay transición ni animación y el mapa sigue quieto", async ({ page }) => {
    await expect(page.getByTestId("route-map")).toHaveAttribute("data-motion", "off");
    await startButton(page).click();
    await expect(bubble(page)).toBeVisible();
    const durations = await page.evaluate(() => {
      const t = (id: string) => getComputedStyle(document.querySelector(`[data-testid="${id}"]`)!);
      const ms = (v: string) => Math.max(...v.split(",").map((s) => parseFloat(s) * (s.trim().endsWith("ms") ? 1 : 1000)));
      return { spot: ms(t("tour-spot").transitionDuration), bubble: ms(t("tour-bubble").animationDuration) };
    });
    expect(durations.spot).toBeLessThanOrEqual(1);
    expect(durations.bubble).toBeLessThanOrEqual(1);
    await expectRingOnDepot(page);
    expect(await ringAnimations(page)).toBe(0);

    await page.getByTestId("tour-next").click();
    await expect(page.getByTestId("tour-step")).toContainText("2/");
    await page.keyboard.press("Escape");
    await expect(bubble(page)).toHaveCount(0);
    await expect(page.getByTestId("route-map")).toHaveAttribute("data-motion", "off");
  });
});
