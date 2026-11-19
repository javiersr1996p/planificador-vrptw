import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { formatCost } from "../lib/format";
import { API_ORIGIN, MAX_HEIGHT, blockService, expectBodyText16, expectNoHorizontalOverflow, pageHeight, stubMapStyle } from "./helpers";

// Modo «Tu ruta»: el visitante arma rutas pulsando paradas y compite con los métodos.
// Usa el servicio de pruebas de `playwright.config.ts` (`/evaluate` real).

type Run = { method: string; solution: { routes: number[][] } | null; evaluation: { score: number } | null };
const DATA = path.join(__dirname, "..", "public", "data", "cases");
const heuristic = (id: string): Run =>
  (JSON.parse(readFileSync(path.join(DATA, `${id}.json`), "utf8")) as { runs: Run[] }).runs.find((r) => r.method === "heuristic")!;

const manualRow = (page: Page) => page.locator('[data-testid="comparison-row"][data-origin="manual"]');
const manualCost = (page: Page) => manualRow(page).getByTestId("row-cost");
const verdict = (page: Page) => page.getByTestId("manual-verdict");

async function openCase(page: Page, id: string): Promise<void> {
  await stubMapStyle(page);
  await page.goto("/");
  const card = page.locator(`[data-testid="example-card"][data-case-id="${id}"]`);
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("service-status")).toHaveAttribute("data-state", "up");
}

async function openManual(page: Page): Promise<void> {
  await page.locator('[data-testid="live-action"][data-live="ruta"]').click();
  await expect(page.getByTestId("manual-panel")).toHaveAttribute("data-active", "true");
}

/** Pulsa una parada del mapa. Con el panel abierto en móvil la hoja puede cubrirla, así que se envía el clic al elemento. */
const tapStop = (page: Page, customer: number) =>
  page.locator(`[data-testid="stop"][data-customer="${customer}"]`).dispatchEvent("click");

/** Arma rutas: cada una en una furgoneta nueva, con sus paradas en orden. */
async function build(page: Page, routes: number[][]): Promise<void> {
  for (const route of routes) {
    await page.locator('[data-testid="manual-vehicle"][data-new]').click();
    for (const customer of route) await tapStop(page, customer);
  }
}

for (const id of ["tfe2024-10c-1", "madrid-12"]) {
  test(`reproducir las rutas de la heurística en ${id} da su mismo coste`, async ({ page }) => {
    const h = heuristic(id);
    await openCase(page, id);
    await openManual(page);
    await build(page, h.solution!.routes);
    await expect(manualCost(page)).toHaveText(formatCost(h.evaluation!.score));
    await expect(manualRow(page).getByRole("button")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("manual-pending")).toHaveAttribute("data-count", "0");
    await expect(verdict(page)).toHaveAttribute("data-state", "valid-tie");
    await expect(page.locator('[data-testid="stop"][data-unserved]')).toHaveCount(0);
    await expect(page.getByTestId("validity-verdict")).toHaveText("Sí, válido");
    const first = page.getByTestId("manual-route").first();
    await expect(first).toContainText(h.solution!.routes[0].join(" → "));
  });
}

test("con una parada sin asignar la fila es no válida y la deja pendiente en el mapa", async ({ page }) => {
  const routes = heuristic("tfe2024-10c-1").solution!.routes.map((r) => r.slice());
  const left = routes[routes.length - 1].pop()!;
  await openCase(page, "tfe2024-10c-1");
  await openManual(page);
  await build(page, routes.filter((r) => r.length > 0));
  await expect(manualRow(page)).toHaveAttribute("data-invalid", "true");
  await expect(manualRow(page)).toContainText("sin atender (1)");
  await expect(verdict(page)).toHaveAttribute("data-state", "invalid");
  await expect(page.getByTestId("validity-verdict")).toHaveText("No válido");
  await expect(page.getByTestId("manual-pending")).toContainText(String(left));
  const stop = page.locator(`[data-testid="stop"][data-customer="${left}"]`);
  await expect(stop).toHaveAttribute("data-unserved", "true");
  await expect(stop).toHaveAttribute("aria-label", /Sin atender/);
});

test("deshacer restaura el coste anterior y vaciar retira la fila", async ({ page }) => {
  await openCase(page, "tfe2024-10c-1");
  await openManual(page);
  await tapStop(page, 1);
  await tapStop(page, 2);
  await expect(manualRow(page)).toContainText("sin atender (8)");
  const before = (await manualCost(page).textContent())!;
  await tapStop(page, 3);
  await expect(manualCost(page)).not.toHaveText(before);
  await page.getByTestId("manual-undo").click();
  await expect(manualCost(page)).toHaveText(before);
  await expect(page.getByTestId("manual-route")).toHaveText(/1 → 2$/);

  await page.getByTestId("manual-clear").click();
  await expect(page.getByTestId("manual-pending")).toHaveAttribute("data-count", "10");
  await expect(manualRow(page)).toHaveCount(0);
  // Y deshacer recupera el plan de antes de vaciar.
  await page.getByTestId("manual-undo").click();
  await expect(manualCost(page)).toHaveText(before);
});

test("pulsar una asignada la pasa al final de la furgoneta elegida; si ya era la última, la quita", async ({ page }) => {
  await openCase(page, "tfe2024-10c-1");
  await openManual(page);
  await tapStop(page, 4);
  await tapStop(page, 5);
  await expect(page.getByTestId("manual-route")).toHaveText(/4 → 5$/);
  await tapStop(page, 4);
  await expect(page.getByTestId("manual-route")).toHaveText(/5 → 4$/);
  await tapStop(page, 4);
  await expect(page.getByTestId("manual-route")).toHaveText(/F1: 5$/);
  await expect(page.getByTestId("manual-pending")).toHaveAttribute("data-count", "9");
});

test("espera 300 ms entre pulsaciones y nunca hay dos evaluaciones en vuelo", async ({ page }) => {
  await openCase(page, "tfe2024-10c-1");
  await openManual(page);
  let inflight = 0;
  let peak = 0;
  const bodies: number[][][] = [];
  const done = () => {
    inflight -= 1;
  };
  page.on("request", (r) => {
    if (r.url() !== `${API_ORIGIN}/evaluate`) return;
    inflight += 1;
    peak = Math.max(peak, inflight);
    bodies.push((JSON.parse(r.postData()!) as { routes: number[][] }).routes);
  });
  page.on("requestfinished", (r) => r.url() === `${API_ORIGIN}/evaluate` && done());
  page.on("requestfailed", (r) => r.url() === `${API_ORIGIN}/evaluate` && done());

  for (const c of [1, 2, 3, 4, 5]) await tapStop(page, c);
  await expect(page.getByTestId("manual-route")).toHaveText(/1 → 2 → 3 → 4 → 5$/);
  await expect(page.getByTestId("manual-status")).toHaveText("");
  await expect(manualRow(page)).toContainText("sin atender (5)");
  expect(peak).toBeLessThanOrEqual(1);
  expect(bodies.length).toBeLessThan(5);
  expect(bodies[bodies.length - 1]).toEqual([[1, 2, 3, 4, 5]]);
});

test("con el modo activo pulsar una parada no abre su ficha; al cerrar el panel, sí", async ({ page }) => {
  await openCase(page, "tfe2024-10c-1");
  await openManual(page);
  await tapStop(page, 3);
  await expect(manualRow(page)).toBeVisible();
  await expect(page.getByTestId("stop-card")).toHaveCount(0);
  await page.locator('[data-testid="live-action"][data-live="ruta"]').click();
  await expect(page.getByTestId("live-panel")).toBeHidden();
  await page.locator('[data-testid="stop"][data-customer="3"]').click();
  await expect(page.getByTestId("stop-card")).toBeVisible();
});

test("el borrador se conserva al cerrar el panel y se vacía al cambiar de caso", async ({ page }) => {
  await openCase(page, "tfe2024-10c-1");
  await openManual(page);
  await tapStop(page, 1);
  await page.locator('[data-testid="live-action"][data-live="ruta"]').click();
  await expect(page.getByTestId("live-panel")).toBeHidden();
  await openManual(page);
  await expect(page.getByTestId("manual-route")).toHaveText(/F1: 1$/);
  await page.locator('[data-testid="live-action"][data-live="ruta"]').click();
  await expect(page.getByTestId("live-panel")).toBeHidden();
  await page.locator('[data-testid="example-card"][data-case-id="madrid-12"]').click();
  await expect(page.locator('[data-testid="example-card"][data-case-id="madrid-12"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("manual-route")).toHaveCount(0);
  await expect(manualRow(page)).toHaveCount(0);
});

test("«Ver un plan que llega tarde» en el mismo caso conserva tu ruta y selecciona el plan con retraso", async ({ page }) => {
  const tabu = (JSON.parse(readFileSync(path.join(DATA, "tfe2024-10c-1.json"), "utf8")) as { runs: (Run & { run_id: string })[] }).runs.find(
    (r) => r.method === "tabu",
  )!;
  await openCase(page, "tfe2024-10c-1");
  await openManual(page);
  await tapStop(page, 1);
  await expect(manualCost(page)).toBeVisible();
  await page.locator('[data-testid="live-action"][data-live="ruta"]').click();
  await expect(page.getByTestId("live-panel")).toBeHidden();

  await page.getByTestId("show-late").click();
  await expect(page.getByTestId("detail-run-id")).toHaveText(tabu.run_id);
  await expect(page.locator('[data-testid="detail-stop"][data-late="true"]').first()).toBeVisible();
  // El caso no se recarga: la fila de tu ruta y el borrador siguen ahí.
  await expect(manualRow(page)).toHaveCount(1);
  await openManual(page);
  await expect(page.getByTestId("manual-route")).toHaveText(/F1: 1$/);
});

test("sin servicio queda desactivado con su motivo y las fichas siguen abriéndose", async ({ page }) => {
  await stubMapStyle(page);
  await blockService(page);
  await page.goto("/");
  const card = page.locator('[data-testid="example-card"][data-case-id="tfe2024-10c-1"]');
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("service-status")).toHaveAttribute("data-state", "down");
  await page.locator('[data-testid="live-action"][data-live="ruta"]').click();
  await expect(page.getByTestId("manual-panel")).toHaveAttribute("data-active", "false");
  await expect(page.getByTestId("manual-panel").getByTestId("service-notice")).toBeVisible();
  await expect(page.getByTestId("manual-undo")).toBeDisabled();
  await expect(page.getByTestId("manual-clear")).toBeDisabled();
  await expect(page.getByTestId("manual-vehicle").first()).toBeDisabled();
  await tapStop(page, 3);
  await expect(page.getByTestId("stop-card")).toBeVisible();
  await expect(manualRow(page)).toHaveCount(0);
});

test("en un caso de más de 25 clientes queda desactivado con su motivo", async ({ page }) => {
  await openCase(page, "r101-100-trunc");
  await page.locator('[data-testid="live-action"][data-live="ruta"]').click();
  await expect(page.getByTestId("manual-panel")).toHaveAttribute("data-active", "false");
  await expect(page.getByTestId("manual-reason")).toHaveText("Tu ruta está disponible en casos de hasta 25 clientes.");
  await expect(page.getByTestId("manual-vehicle").first()).toBeDisabled();
});

test("con el panel abierto y una ruta, la altura entra en el presupuesto y el texto es de 16 px", async ({ page }) => {
  await openCase(page, "tfe2024-10c-1");
  await openManual(page);
  await build(page, heuristic("tfe2024-10c-1").solution!.routes);
  await expect(manualRow(page)).toBeVisible();
  await expect(page.getByTestId("manual-status")).toHaveText("");
  const width = page.viewportSize()!.width;
  expect(await pageHeight(page)).toBeLessThanOrEqual(MAX_HEIGHT[width]);
  await expectNoHorizontalOverflow(page);
  await expectBodyText16(page, '[data-testid="manual-panel"]');
  for (const chip of await page.getByTestId("manual-vehicle").all()) {
    const box = (await chip.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
});

// Capturas para la revisión visual; solo con MANUAL_SHOTS=<carpeta>.
test("capturas", async ({ page }) => {
  const dir = process.env.MANUAL_SHOTS;
  test.skip(!dir, "solo con MANUAL_SHOTS");
  const w = page.viewportSize()!.width;
  const shot = (name: string) => page.screenshot({ path: path.join(dir!, `${name}-${w}.png`), fullPage: true });
  const routes = heuristic("tfe2024-10c-1").solution!.routes;

  await openCase(page, "tfe2024-10c-1");
  await openManual(page);
  await build(page, [routes[0], routes[1].slice(0, 2)]);
  await expect(manualRow(page)).toContainText("sin atender");
  await expect(page.getByTestId("manual-status")).toHaveText("");
  await shot("1-a-medias");

  await page.getByTestId("manual-clear").click();
  await build(page, routes);
  await expect(manualCost(page)).toHaveText(formatCost(heuristic("tfe2024-10c-1").evaluation!.score));
  await shot("2-igual-a-la-heuristica");

  await page.getByTestId("manual-clear").click();
  const short = routes.map((r) => r.slice());
  short[short.length - 1].pop();
  await build(page, short.filter((r) => r.length > 0));
  await expect(manualRow(page)).toHaveAttribute("data-invalid", "true");
  await expect(manualRow(page)).toContainText("sin atender (1)");
  await shot("3-no-valida");
});
