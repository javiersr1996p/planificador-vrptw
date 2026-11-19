import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import {
  API_ORIGIN,
  MAX_HEIGHT,
  blockService,
  expectBodyText16,
  expectNoHorizontalOverflow,
  pageHeight,
  solverTest,
  stubMapStyle,
} from "./helpers";

// Caso propio: CSV, formulario, geocodificación y matriz. Salvo los casos que piden el
// servicio de pruebas real (sin claves de mapas: /geocode da 503 y /matrix cae a línea
// recta), /geocode y /matrix se simulan con page.route. Las que resuelven de verdad van
// con `solverTest`, que turna el cálculo clásico entre trabajadores.

test.setTimeout(90_000);

const FIXTURES = path.join(__dirname, "fixtures");
const fixture = (name: string) => path.join(FIXTURES, name);
const readJson = <T>(name: string): T => JSON.parse(readFileSync(fixture(name), "utf8")) as T;

type Place = { lat: number; lon: number; label: string };
const PLACES = readJson<Record<string, Place>>("lugares.json");
const MATRIX_3 = readJson<Record<string, unknown>>("matriz_3.json");

const CORS = { "access-control-allow-origin": "http://localhost:3100" };

const panel = (page: Page) => page.getByTestId("case-panel");
const step = (page: Page, id: string) => page.locator(`[data-testid="case-step"][data-step="${id}"]`);
const stops = (page: Page) => page.getByTestId("stop");
const warning = (page: Page) => page.getByTestId("straight-line-warning");
const load = (page: Page) => page.getByTestId("case-load");

async function openCase(page: Page): Promise<void> {
  await page.locator('[data-testid="live-action"][data-live="caso"]').click();
  await expect(panel(page)).toBeVisible();
}

async function openTab(page: Page, tab: "resolver" | "caso"): Promise<void> {
  const button = page.locator(`[data-testid="live-action"][data-live="${tab}"]`);
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
}

async function closePanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Cerrar el panel" }).click();
  await expect(page.getByTestId("live-panel")).toBeHidden();
}

/** Sube un CSV de `fixtures/`. */
async function upload(page: Page, name: string): Promise<void> {
  await page.getByTestId("csv-file").setInputFiles(fixture(name));
  await expect(page.getByTestId("csv-info")).toContainText(name);
}

/** Responde `/geocode` con `lugares.json` (lo que no está allí, "no encontrado") y registra las direcciones pedidas. */
async function mockGeocode(page: Page, places: Record<string, Place> = PLACES): Promise<string[][]> {
  const asked: string[][] = [];
  await page.route(`${API_ORIGIN}/geocode`, async (route: Route) => {
    if (route.request().method() !== "POST") return route.continue();
    const { addresses } = route.request().postDataJSON() as { addresses: string[] };
    asked.push(addresses);
    const results = addresses.map((address) => {
      const p = places[address];
      return p ? { address, found: true, lat: p.lat, lon: p.lon, label: p.label } : { address, found: false, lat: null, lon: null, label: null };
    });
    await route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ results }) });
  });
  return asked;
}

async function mockMatrix(page: Page): Promise<void> {
  await page.route(`${API_ORIGIN}/matrix`, async (route: Route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(MATRIX_3) });
  });
}

/** Cuenta las peticiones POST a una ruta del servicio. */
function countPosts(page: Page, pathname: string): () => number {
  let n = 0;
  page.on("request", (r: Request) => {
    if (r.method() === "POST" && r.url() === API_ORIGIN + pathname) n++;
  });
  return () => n;
}

test.beforeEach(async ({ page }) => {
  await stubMapStyle(page);
  await page.goto("/");
  await expect(page.getByTestId("comparison-row")).toHaveCount(4);
  await expect(page.getByTestId("service-status")).toHaveAttribute("data-state", "up");
});

test("la plantilla con coordenadas llega al mapa con sus paradas y el aviso de línea recta (servicio real)", async ({ page }) => {
  const hookBefore = await page.getByTestId("hook").textContent();
  await openCase(page);
  await expect(page.getByTestId("csv-template")).toHaveAttribute("href", "/data/plantilla_caso_real.csv");
  await expect(load(page)).toBeDisabled(); // sin fichero no hay nada que cargar
  await upload(page, "plantilla_con_coordenadas.csv");
  await page.getByTestId("case-name").fill("Plantilla de prueba");
  await load(page).click();

  await expect(page.getByTestId("case-loaded")).toContainText("Plantilla de prueba");
  await expect(step(page, "read")).toHaveAttribute("data-status", "done");
  await expect(step(page, "geocode")).toHaveAttribute("data-status", "skipped");
  await expect(step(page, "matrix")).toHaveAttribute("data-status", "done");
  await expect(step(page, "matrix")).toContainText("en línea recta");

  await expect(warning(page)).toHaveText("Distancias en línea recta: el servicio de rutas no está disponible");
  await expect(page.getByTestId("comparison-row")).toHaveCount(0);
  await expect(page.getByTestId("hook")).not.toHaveText(hookBefore!);
  await expect(page.getByTestId("hook")).toContainText("3 furgonetas");
  await expect(page.getByTestId("hook")).toContainText("3 paradas");
  await expect(stops(page)).toHaveCount(3, { timeout: 15_000 });
  await expect(page.getByTestId("depot")).toHaveCount(1);
  // La ayuda del coste no dice «por carretera» si la matriz es en línea recta. En móvil, la hoja del panel la tapa.
  await page.getByTestId("live-panel").getByRole("button", { name: "Cerrar el panel" }).click();
  await page.getByTestId("comparison").locator('[data-testid="help-button"][data-help="coste"]').click();
  await expect(page.getByTestId("help-popover")).toContainText("Tramos y distancias en línea recta");
  await expect(page.getByTestId("help-popover")).not.toContainText("por carretera");
});

test("un CSV con direcciones, con /geocode y /matrix simulados, llega al mapa sin aviso", async ({ page }) => {
  const asked = await mockGeocode(page);
  await mockMatrix(page);
  await openCase(page);
  await upload(page, "direcciones.csv");
  await load(page).click();

  await expect(page.getByTestId("case-loaded")).toBeVisible();
  await expect(step(page, "geocode")).toHaveAttribute("data-status", "done");
  await expect(step(page, "matrix")).toContainText("por carretera");
  expect(asked).toHaveLength(1);
  expect(asked[0]).toHaveLength(3); // depósito y dos clientes, en ese orden
  await expect(warning(page)).toHaveCount(0);
  await expect(stops(page)).toHaveCount(2, { timeout: 15_000 });
});

test("doble clic en «Cargar el caso» no cancela la carga", async ({ page }) => {
  await mockGeocode(page);
  await mockMatrix(page);
  await openCase(page);
  await upload(page, "direcciones.csv");
  await load(page).dblclick();
  await expect(page.getByTestId("case-loaded")).toBeVisible();
  await expect(stops(page)).toHaveCount(2, { timeout: 15_000 });
});

test("una dirección no encontrada queda señalada, el caso no avanza y se corrige", async ({ page }) => {
  const mistyped = "Tienda Norte, Calle del Norte 2, Madrid, España";
  const places = { ...PLACES };
  delete places[mistyped];
  const asked = await mockGeocode(page, places);
  await mockMatrix(page);
  const matrices = countPosts(page, "/matrix");
  const hookBefore = await page.getByTestId("hook").textContent();

  await openCase(page);
  await upload(page, "direcciones.csv");
  await load(page).click();

  const missing = page.getByTestId("geocode-missing");
  await expect(missing).toBeVisible();
  await expect(missing.getByTestId("geocode-missing-row")).toHaveCount(1);
  await expect(missing.getByTestId("missing-address")).toHaveValue(mistyped);
  await expect(step(page, "geocode")).toHaveAttribute("data-status", "error");
  await expect(step(page, "geocode")).toContainText("1 sin encontrar");
  await expect(step(page, "matrix")).toHaveAttribute("data-status", "idle");
  await expect(page.getByTestId("case-loaded")).toHaveCount(0);
  expect(matrices()).toBe(0);
  await expect(page.getByTestId("hook")).toHaveText(hookBefore!); // el caso actual no se tocó

  // Corregida, se vuelve a buscar solo esa y el caso llega al mapa.
  await missing.getByTestId("missing-address").fill("Calle del Norte 2, Madrid");
  await page.getByTestId("geocode-retry").click();
  await expect(page.getByTestId("case-loaded")).toBeVisible();
  expect(asked[1]).toEqual(["Calle del Norte 2, Madrid"]);
  expect(matrices()).toBe(1);
  await expect(page.getByTestId("geocode-missing")).toHaveCount(0);
  await expect(stops(page)).toHaveCount(2, { timeout: 15_000 });
});

test("una dirección no encontrada se puede quitar y el caso sigue con el resto", async ({ page }) => {
  const places = { ...PLACES };
  delete places["Tienda Sur, Calle del Sur 3, Madrid, España"];
  await mockGeocode(page, places);
  await page.route(`${API_ORIGIN}/matrix`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const { points } = route.request().postDataJSON() as { points: unknown[] };
    expect(points).toHaveLength(2); // depósito y un cliente
    await route.fulfill({
      status: 200,
      headers: CORS,
      contentType: "application/json",
      body: JSON.stringify({ distance: [[0, 5], [5, 0]], time: [[0, 9], [9, 0]], source: "openrouteservice", distance_unit: "km", time_unit: "min" }),
    });
  });
  await openCase(page);
  await upload(page, "direcciones.csv");
  await load(page).click();

  await expect(page.getByTestId("geocode-missing")).toBeVisible();
  await expect(page.getByTestId("case-loaded")).toHaveCount(0);
  await page.getByTestId("missing-remove").click();
  await expect(page.getByTestId("geocode-missing")).toHaveCount(0);
  await page.getByTestId("geocode-continue").click();
  await expect(page.getByTestId("case-loaded")).toContainText("1 cliente");
  await expect(stops(page)).toHaveCount(1, { timeout: 15_000 });
});

test("el CSV con tres errores muestra las tres filas con su número", async ({ page }) => {
  await openCase(page);
  await upload(page, "tres_errores.csv");
  await load(page).click();

  const list = page.getByTestId("csv-errors");
  await expect(list).toBeVisible();
  await expect(list).toContainText("3 filas con error");
  const items = list.getByTestId("csv-error");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("Fila 3");
  await expect(items.nth(0)).toContainText("READY_TIME");
  await expect(items.nth(1)).toContainText("Fila 4");
  await expect(items.nth(1)).toContainText("DEMAND");
  await expect(items.nth(2)).toContainText("Fila 5");
  await expect(items.nth(2)).toContainText("LAT y LON");
  await expect(step(page, "read")).toHaveAttribute("data-status", "error");
  await expect(page.getByTestId("case-loaded")).toHaveCount(0);
  await expect(page.getByTestId("comparison-row")).toHaveCount(4); // el caso actual sigue
  await expectBodyText16(page, '[data-testid="live-panel"]');
});

test("los errores de fila también se marcan en su fila del formulario", async ({ page }) => {
  await openCase(page);
  await page.getByTestId("case-mode-form").click();
  const rows = page.getByTestId("form-customer");
  await expect(rows).toHaveCount(2);
  await page.getByTestId("depot-lat").fill("40.39");
  await page.getByTestId("depot-lon").fill("-3.69");
  await page.getByTestId("customer-lat").nth(0).fill("40.41");
  await page.getByTestId("customer-lon").nth(0).fill("-3.69");
  await page.getByTestId("customer-lat").nth(1).fill("40.42");
  await page.getByTestId("customer-lon").nth(1).fill("-3.70");
  await page.getByTestId("customer-ready").nth(1).fill("nueve");
  await load(page).click();

  await expect(page.getByTestId("csv-error")).toHaveCount(1);
  await expect(page.getByTestId("csv-error")).toContainText("Fila 4"); // cabecera, depósito y cliente 1 son las filas 1 a 3
  await expect(rows.nth(1)).toHaveAttribute("data-error", "true");
  await expect(rows.nth(1).getByTestId("row-error")).toContainText("READY_TIME");
  await expect(rows.nth(0)).not.toHaveAttribute("data-error", "true");
  // Se puede quitar la fila con error y cargar el resto.
  await rows.nth(1).getByTestId("remove-customer").click();
  await expect(rows).toHaveCount(1);
  await load(page).click();
  await expect(page.getByTestId("case-loaded")).toContainText("1 cliente");
});

test("el /geocode real del servicio de pruebas (503, sin clave) da un mensaje legible", async ({ page }) => {
  const matrices = countPosts(page, "/matrix");
  await openCase(page);
  await upload(page, "direcciones.csv");
  await load(page).click();

  const failure = page.getByTestId("case-failure");
  await expect(failure).toBeVisible();
  await expect(failure).toContainText("Geocodificación no disponible");
  await expect(failure).toContainText("LAT y LON");
  await expect(failure).not.toContainText("{");
  await expect(step(page, "read")).toHaveAttribute("data-status", "done");
  await expect(step(page, "geocode")).toHaveAttribute("data-status", "error");
  await expect(step(page, "matrix")).toHaveAttribute("data-status", "idle");
  await expect(page.getByTestId("geocode-missing")).toHaveCount(0); // no es una dirección sin encontrar
  expect(matrices()).toBe(0);
});

test("un 429 del geocodificador sale con su texto", async ({ page }) => {
  await page.route(`${API_ORIGIN}/geocode`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 429,
      headers: CORS,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Tope diario de geocodificación alcanzado (1000 direcciones): se renueva a las 00:00 UTC" }),
    });
  });
  await openCase(page);
  await upload(page, "direcciones.csv");
  await load(page).click();
  await expect(page.getByTestId("case-failure")).toContainText("Tope diario de geocodificación alcanzado");
});

test("un CSV de más de 100 000 caracteres se avisa antes de enviar", async ({ page }) => {
  const posts = countPosts(page, "/instances/parse-csv");
  await openCase(page);
  await page.getByTestId("csv-file").setInputFiles({
    name: "enorme.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("CUSTOMER,ADDRESS\n" + "x".repeat(100_001)),
  });
  await expect(page.getByTestId("csv-too-big")).toContainText("100.000");
  await expect(load(page)).toBeDisabled();
  expect(posts()).toBe(0);
});

solverTest("un caso de dos clientes hecho con el formulario se resuelve con la heurística y se reproduce", async ({ page }) => {
  await openCase(page);
  await page.getByTestId("case-mode-form").click();
  await page.getByTestId("case-name").fill("Dos clientes");
  await page.getByTestId("case-vehicles").fill("1");
  await page.getByTestId("depot-address").fill("Base de prueba");
  await page.getByTestId("depot-lat").fill("40,3921");
  await page.getByTestId("depot-lon").fill("-3,6970");
  const coords = [
    ["40,4135", "-3,6913"],
    ["40,4153", "-3,7090"],
  ];
  for (const [i, [lat, lon]] of coords.entries()) {
    await page.getByTestId("customer-address").nth(i).fill(`Cliente de prueba ${i + 1}`);
    await page.getByTestId("customer-lat").nth(i).fill(lat);
    await page.getByTestId("customer-lon").nth(i).fill(lon);
    await page.getByTestId("customer-demand").nth(i).fill("3");
  }
  await load(page).click();
  await expect(page.getByTestId("case-loaded")).toContainText("2 clientes y 1 furgoneta");
  await expect(page.getByTestId("hook")).toContainText("1 furgoneta");

  await openTab(page, "resolver");
  await page.getByTestId("solve-pick-aco").uncheck();
  await page.getByTestId("solve-pick-ga").uncheck();
  await page.getByTestId("solve-pick-tabu").uncheck();
  await page.getByTestId("solve-start").click();
  const row = page.getByTestId("comparison-row");
  await expect(row).toHaveCount(1, { timeout: 40_000 });
  await expect(row).toHaveAttribute("data-origin", "en vivo");
  await expect(row.getByTestId("row-vehicles")).toHaveText("1");

  await closePanel(page);
  const clock = page.getByTestId("sim-clock");
  const start = await clock.textContent();
  await page.getByTestId("play-button").click();
  await expect(clock).not.toHaveText(start!);
  await expect(page.getByTestId("radio-line")).toContainText(/Cliente de prueba|Base de prueba/);
});

solverTest("un nombre de cliente con HTML se muestra como texto en la ficha, la línea de estado y el detalle", async ({ page }) => {
  const payload = "<img src=x onerror=window.__xss=1>";
  await openCase(page);
  await upload(page, "nombre_html.csv");
  await page.getByTestId("case-vehicles").fill("1");
  await load(page).click();
  await expect(page.getByTestId("case-loaded")).toContainText("2 clientes");

  await openTab(page, "resolver");
  await page.getByTestId("solve-pick-aco").uncheck();
  await page.getByTestId("solve-pick-ga").uncheck();
  await page.getByTestId("solve-pick-tabu").uncheck();
  await page.getByTestId("solve-start").click();
  await expect(page.getByTestId("comparison-row")).toHaveCount(1, { timeout: 40_000 });
  await closePanel(page);

  // Detalle: la parada con el nombre malicioso, como texto.
  await expect(page.getByTestId("detail-stop").filter({ hasText: payload })).toHaveCount(1);

  // Línea de estado: se recorre el día hasta que nombra al cliente.
  const scrubber = page.getByTestId("scrubber");
  let named = false;
  for (let t = 540; t <= 960 && !named; t += 15) {
    await scrubber.fill(String(t));
    named = ((await page.getByTestId("radio-line").textContent()) ?? "").includes(payload);
  }
  expect(named, "la línea de estado nombra al cliente como texto").toBe(true);

  // Ficha del mapa.
  await page.locator('[data-testid="stop"][data-customer="1"]').evaluate((el: HTMLElement) => el.click());
  await expect(page.getByTestId("stop-card")).toContainText(payload);

  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(await page.locator("img").evaluateAll((els) => els.filter((e) => e.getAttribute("onerror")).length)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test("con el servicio apagado el panel muestra su motivo y los ejemplos siguen", async ({ page }) => {
  await blockService(page);
  await page.reload();
  await expect(page.getByTestId("service-status")).toHaveAttribute("data-state", "down");
  await expect(page.getByTestId("comparison-row")).toHaveCount(4);
  await openCase(page);

  await expect(page.getByTestId("case-needs-service")).toContainText("necesita el servicio");
  await expect(panel(page).getByTestId("service-notice")).toContainText("Servicio no disponible");
  await expect(load(page)).toBeDisabled();
  await expect(load(page)).toHaveAttribute("aria-describedby", "case-reason");
  await expectBodyText16(page, '[data-testid="live-panel"]');

  await page.locator('[data-testid="example-card"][data-case-id="tfe2024-10c-1"]').click();
  await expect(page.getByTestId("comparison-row")).toHaveCount(10);
});

test("con el formulario abierto y muchas filas la página sigue dentro del presupuesto y es legible", async ({ page }) => {
  await openCase(page);
  await expect(page.getByTestId("case-facts")).toBeVisible();
  await page.getByTestId("case-mode-form").click();
  // Con el formulario abierto, la ficha del caso cargado se pliega a su nombre.
  await expect(page.getByTestId("case-facts")).toBeHidden();
  await expect(page.getByTestId("case-info").getByRole("heading", { name: /Madrid/ })).toBeVisible();
  for (let i = 0; i < 8; i++) await page.getByTestId("add-customer").click();
  await expect(page.getByTestId("form-customer")).toHaveCount(10);
  await expect(page.getByTestId("form-depot")).toBeVisible();

  const width = page.viewportSize()!.width;
  expect(await pageHeight(page)).toBeLessThanOrEqual(MAX_HEIGHT[width]);
  await expectNoHorizontalOverflow(page);
  await expectBodyText16(page, '[data-testid="live-panel"]');

  // Cada campo del formulario y cada botón tiene al menos 44 px de alto.
  const small = await page.getByTestId("case-form").evaluate((root) =>
    [...root.querySelectorAll("input, button")]
      .filter((el) => el.getBoundingClientRect().height < 43.5)
      .map((el) => el.getAttribute("data-testid") ?? el.tagName),
  );
  expect(small).toEqual([]);
});
