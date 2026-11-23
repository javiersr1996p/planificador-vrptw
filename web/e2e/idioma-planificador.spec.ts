import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { caseText } from "../lib/case-names";
import {
  MADRID12_HEIGHT,
  MAX_HEIGHT,
  blockService,
  expectBodyText16,
  expectNoHorizontalOverflow,
  pageHeight,
  spanishLeaks,
  stubMapStyle,
} from "./helpers";

// El planificador y el mapa en inglés: los cinco casos de ejemplo, sin español visible, y el cambio de idioma en caliente.

type CaseData = { instance: { name: string; depot: { address: string | null }; customers: { address: string | null }[] }; runs: unknown[] };
const DATA = path.join(__dirname, "..", "public", "data");
const readCase = (id: string): CaseData => JSON.parse(readFileSync(path.join(DATA, "cases", `${id}.json`), "utf8"));
const caseIds = (): string[] => JSON.parse(readFileSync(path.join(DATA, "index.json"), "utf8")).cases.map((c: { id: string }) => c.id);

/** Nombres de lugares y direcciones de los casos: son datos y no se traducen. */
function placeNames(id: string): string[] {
  const { instance } = readCase(id);
  const addresses = [instance.depot.address, ...instance.customers.map((c) => c.address)].filter((a): a is string => !!a);
  const first = addresses.map((a) => a.split(",")[0].trim());
  // Más largos primero: «Estación de Atocha» antes que «Atocha».
  return [...new Set([...addresses, ...first])].sort((a, b) => b.length - a.length);
}

const NAMES = ["Solomon", "Geoapify", "openrouteservice"];
/** Textos de «Explicar» (módulo del LLM): este módulo no los traduce ni los comprueba. */
const OTHER_MODULES = ["Sin servicio: no se puede pedir ahora."];

async function openCase(page: Page, id: string, lang: "es" | "en" = "en"): Promise<void> {
  await blockService(page);
  await stubMapStyle(page);
  await page.goto(`/?lang=${lang}`);
  const card = page.locator(`[data-testid="example-card"][data-case-id="${id}"]`);
  await expect(card).toBeVisible();
  if ((await card.getAttribute("aria-pressed")) !== "true") await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("comparison-row")).toHaveCount(readCase(id).runs.length);
  await expect(page.getByTestId("detail-stop").first()).toBeVisible();
}

/** Textos que no salen en `innerText`: nombres accesibles, títulos y rótulos del lienzo. */
async function attributeTexts(page: Page, scope: string): Promise<string[]> {
  return page.locator(scope).first().evaluate((root) =>
    Array.from(root.querySelectorAll("[aria-label], [title]")).flatMap((el) => [el.getAttribute("aria-label"), el.getAttribute("title")]).filter((v): v is string => !!v),
  );
}

const SPANISH_ATTR =
  /[áéíóúüñ¿¡]|\b(el|la|los|las|del|al|una|unos|para|con|sin|por|que|de|tu|ruta|rutas|furgoneta|furgonetas|parada|paradas|cliente|clientes|coste|ventana|caso|casos|resolver|llega|tarde|espera|animación|recentrar|acercar|alejar|cerrar)\b/i;

for (const id of caseIds()) {
  test(`${id} en inglés: sin español visible, sin desbordes, en su altura y con texto de 16 px`, async ({ page }) => {
    await openCase(page, id);
    // Primero las medidas, con la página como llega; luego se abren los plegables para leer su texto.
    await expectNoHorizontalOverflow(page);
    const width = page.viewportSize()!.width;
    const budget = id === "madrid-12" ? MADRID12_HEIGHT[width] : MAX_HEIGHT[width];
    expect(await pageHeight(page), `altura de ${id} a ${width} px`).toBeLessThanOrEqual(budget);
    await expectBodyText16(page, "[data-zone]");
    // Plegables abiertos: traza del agente y origen de los datos.
    for (const details of await page.locator('[data-testid="agent-trace"], [data-testid="case-source"]').all()) {
      await details.locator("summary").click();
    }
    await page.evaluate(() => document.fonts.ready);
    const allow = [...placeNames(id), ...NAMES, ...OTHER_MODULES];
    // El texto final del agente lo escribe el propio modelo y no está a la vista (plegado).
    expect(await spanishLeaks(page, { scope: '[data-testid="comparison"]', allow })).toEqual([]);
    expect(await spanishLeaks(page, { scope: '[data-testid="kpis"]', allow })).toEqual([]);
    expect(await spanishLeaks(page, { scope: '[data-testid="validity"]', allow })).toEqual([]);
    expect(await spanishLeaks(page, { scope: '[data-testid="playbar"]', allow })).toEqual([]);
    expect(await spanishLeaks(page, { scope: '[data-testid="route-map"]', allow })).toEqual([]);
    expect(await spanishLeaks(page, { scope: '[data-testid="hook"]', allow })).toEqual([]);
    expect(await spanishLeaks(page, { scope: '[data-testid="learn-card"]', allow })).toEqual([]);
    expect(await spanishLeaks(page, { scope: '[data-testid="live-panel"], [data-testid="service-status"]', allow })).toEqual([]);
    expect(await spanishLeaks(page, { scope: '[data-testid="detail"]', allow: [...allow, /run_id.*/] })).toEqual([]);

    const attrs = [
      ...(await attributeTexts(page, '[data-testid="route-map"]')),
      ...(await attributeTexts(page, '[data-testid="playbar"]')),
      ...(await attributeTexts(page, '[data-testid="comparison"]')),
      ...(await attributeTexts(page, '[data-testid="detail"]')),
    ].map((text) => allow.reduce((acc, a) => acc.split(a).join(" "), text));
    expect(attrs.filter((text) => SPANISH_ATTR.test(text))).toEqual([]);

  });

  test(`${id}: los textos del caso son los del inglés y no cambian el español`, async ({ page }) => {
    const data = readCase(id);
    expect(caseText(id, "name", data.instance.name).es).toBe(data.instance.name);
    await openCase(page, id);
    const name = caseText(id, "name", data.instance.name).en;
    expect(name).not.toBe(data.instance.name);
    await expect(page.locator(`[data-testid="example-card"][data-case-id="${id}"]`)).toContainText(name.split(",")[0].split(":")[0]);
    await page.getByTestId("live-action").filter({ hasText: "Your case" }).click();
    await expect(page.getByTestId("case-info")).toContainText(name);
  });
}

test("el cambio de idioma en caliente repinta la comparativa, el detalle y el mapa", async ({ page }) => {
  await openCase(page, "madrid-12", "es");
  await page.evaluate(() => ((window as unknown as { marca: number }).marca = 1));
  await expect(page.getByTestId("comparison")).toContainText("Comparativa");
  await expect(page.getByTestId("detail")).toContainText("El día de la furgoneta");
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toHaveAttribute("aria-label", "Mapa de rutas");
  // El aviso de gestos del mapa (oculto hasta que se hace scroll sin Ctrl) también cambia de idioma.
  const gestures = page.locator(".maplibregl-cooperative-gesture-screen");
  await expect(gestures).toContainText("para ampliar el mapa");
  const stop = page.getByTestId("stop").first();
  await expect(stop).toHaveAttribute("aria-label", /^Cliente \d+/);
  await expect(page.getByTestId("legend-route").first()).toHaveAttribute("aria-label", /^Furgoneta 1: \d+ paradas?$/);

  await page.getByRole("group", { name: "Idioma · Language" }).getByRole("button", { name: "EN" }).click();
  await expect(page.getByTestId("comparison")).toContainText("Comparison");
  await expect(page.getByTestId("comparison")).toContainText("Best valid");
  await expect(page.getByTestId("detail")).toContainText(/Van \d+'s day/);
  await expect(page.getByTestId("kpis")).toContainText("Plan on the map");
  await expect(canvas).toHaveAttribute("aria-label", "Route map");
  await expect(gestures).toContainText("to zoom the map");
  await expect(gestures).toContainText("Use two fingers to move the map");
  await expect(gestures).not.toContainText("ampliar");
  await expect(stop).toHaveAttribute("aria-label", /^Customer \d+/);
  await expect(stop).toHaveAttribute("aria-label", /Time window/);
  await expect(page.getByTestId("legend-route").first()).toHaveAttribute("aria-label", /^Van 1: \d+ stops?$/);
  await expect(page.getByTestId("play-button")).toContainText("Play the day");
  await expect(page.getByTestId("example-card").first()).toContainText("stops · real map");
  // Sin recargar la página.
  expect(await page.evaluate(() => (window as unknown as { marca?: number }).marca)).toBe(1);

  await page.getByRole("group", { name: "Idioma · Language" }).getByRole("button", { name: "ES" }).click();
  await expect(page.getByTestId("comparison")).toContainText("Comparativa");
  await expect(canvas).toHaveAttribute("aria-label", "Mapa de rutas");
  await expect(gestures).toContainText("Usa dos dedos para mover el mapa");
  await expect(page.getByTestId("example-card").first()).toContainText("paradas · mapa real");
});

test("el rótulo de la furgoneta y la línea de estado siguen el idioma durante la reproducción", async ({ page }) => {
  await openCase(page, "madrid-12");
  await expect(page.getByTestId("radio-line")).toContainText("ready at the depot");
  await page.getByTestId("scrubber").evaluate((el: HTMLInputElement) => {
    const mid = (Number(el.min) + Number(el.max)) / 2;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, String(mid));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const radio = await page.getByTestId("radio-line").innerText();
  expect(radio).not.toMatch(/[áéíóúñ]|\b(llega|espera|entrega|furgoneta)\b/i);
});

test("el plano (sin mapa) en inglés: paradas rotuladas en inglés", async ({ page }) => {
  await openCase(page, "c101-25-trunc");
  await expect(page.getByTestId("route-map")).toHaveAttribute("data-mode", "plane");
  await expect(page.getByTestId("stop").first()).toHaveAttribute("aria-label", /^Customer \d+\. (Van \d+, stop \d+|Unserved)\. Time window \d/);
  await expect(page.getByRole("group", { name: "Routes" })).toBeVisible();
});
