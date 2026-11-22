import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { MAX_HEIGHT, expectNoHorizontalOverflow, pageHeight, solverTest, spanishLeaks, stubMapStyle } from "./helpers";

// Los paneles de acciones en vivo en inglés (`?lang=en`): Resolver, Con IA, Tu caso y Tu ruta,
// a 390 y 1440 px, contra el servicio de pruebas de `playwright.config.ts` (proveedor `fake`:
// ninguna llamada de pago). Sin español visible dentro de cada panel, salvo lo que no se traduce:
// los motivos de las filas del CSV (los redacta el servicio) y su plantilla.

test.setTimeout(90_000);

const SENTINEL = "sk-ant-centinela-21";
const FIXTURES = path.join(__dirname, "fixtures");

const panel = (page: Page, id: string) => page.getByTestId(id);
const heightLimit = (page: Page) => MAX_HEIGHT[page.viewportSize()!.width];

async function openCase(page: Page, id: string): Promise<void> {
  await stubMapStyle(page);
  await page.goto("/?lang=en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const card = page.locator(`[data-testid="example-card"][data-case-id="${id}"]`);
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("service-status")).toHaveAttribute("data-state", "up");
}

async function openTab(page: Page, tab: "resolver" | "ia" | "caso" | "ruta"): Promise<void> {
  const button = page.locator(`[data-testid="live-action"][data-live="${tab}"]`);
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
}

/** Ningún texto en español dentro del panel, salvo lo que `allow` deje pasar. */
async function expectEnglish(page: Page, testId: string, allow: RegExp[] = []): Promise<void> {
  expect(await spanishLeaks(page, { scope: `[data-testid="${testId}"]`, allow })).toEqual([]);
  await expectNoHorizontalOverflow(page);
}

// Las filas del CSV con error: «Row 3: ...», con el motivo que redacta el servicio en español.
const CSV_ROWS = [/^(Row \d+|General): .*/];

test("Resolver: panel, tráfico y un plan hecho, en inglés", async ({ page }) => {
  await openCase(page, "madrid-12");
  await openTab(page, "resolver");
  const p = panel(page, "classic-panel");
  await expect(p).toBeVisible();
  await expect(page.getByTestId("solve-start")).toHaveText("Solve");
  await expect(page.getByTestId("solve-summary")).toHaveText("Up to 30 s per method.");
  await expect(p).toContainText("Heuristic");
  await expect(p).toContainText("Traffic");
  await expect(p).toContainText("Rush hours");
  await expectEnglish(page, "classic-panel");

  await page.locator('label:has([data-testid="traffic-horas-punta"])').click();
  await expect(page.getByTestId("traffic-horas-punta")).toBeChecked();
  await expect(page.getByTestId("traffic-progress")).toBeHidden({ timeout: 60_000 });
  await expect(page.getByTestId("reevaluated")).toContainText("precomputed: re-evaluated with traffic");
  await expect(p).toContainText("Illustrative factors, not measured");
  await expectEnglish(page, "classic-panel");

  for (const m of ["heuristic", "aco", "ga", "tabu"]) await page.getByTestId(`solve-pick-${m}`).uncheck();
  await expect(page.getByTestId("solve-summary")).toHaveText("Select at least one method.");
  expect(await pageHeight(page)).toBeLessThanOrEqual(heightLimit(page));
});

solverTest("Resolver: el estado de un método terminado, en inglés", async ({ page }) => {
  await openCase(page, "tfe2024-10c-1");
  await openTab(page, "resolver");
  for (const m of ["aco", "ga", "tabu"]) await page.getByTestId(`solve-pick-${m}`).uncheck();
  await page.getByTestId("solve-start").click();
  const row = page.locator('[data-testid="solve-row"][data-method="heuristic"]');
  await expect(row).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(row.getByTestId("solve-status")).toContainText(/^Done · [\d.,]+ · \d+ vans?/);
  await expect(page.getByTestId("solve-summary")).toHaveText("New plan in the comparison and on the map.");
  await expectEnglish(page, "classic-panel");
});

test("Con IA: clave, aviso de coste, plan hecho y explicación pedida en inglés", async ({ page }) => {
  await openCase(page, "tfe2024-10c-1");
  await openTab(page, "ia");
  const p = panel(page, "llm-panel");
  await expect(p).toBeVisible();
  await expect(page.getByTestId("llm-model")).not.toHaveValue("");
  await expect(page.getByTestId("llm-key-note")).toContainText("travels only with your request");
  await expect(page.getByTestId("llm-cost-warning")).toContainText("billed to your Anthropic account");
  await expect(page.getByTestId("llm-start")).toBeDisabled();
  await expect(page.getByTestId("llm-launch-hint")).toHaveText("Enter your key to launch.");
  await expectEnglish(page, "llm-panel");

  await page.getByTestId("llm-key").fill(SENTINEL);
  await expect(page.getByTestId("llm-key-state")).toContainText("In memory");
  await page.locator('[data-testid="llm-role"][data-role="llm_agent"]').click();
  await expect(page.getByTestId("llm-recheck")).toBeDisabled();
  await expect(page.getByTestId("llm-start")).toContainText("Launch the agent");
  await page.locator('[data-testid="llm-role"][data-role="llm_direct"]').click();
  await page.getByTestId("llm-start").click();
  await expect(page.getByTestId("llm-status")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(page.getByTestId("llm-status")).toContainText("Done");
  await expectEnglish(page, "llm-panel");

  // «Explicar» pide la explicación en el idioma activo: la petición lleva `lang: "en"`.
  await page.locator('[data-testid="live-action"][data-live="ia"]').click(); // abierta: la cierra
  await expect(page.getByTestId("live-panel")).toBeHidden();
  const sent = page.waitForRequest((r) => r.url().endsWith("/explain") && r.method() === "POST");
  await page.getByTestId("explain-button").click();
  expect(JSON.parse((await sent).postData() ?? "{}")).toMatchObject({ lang: "en" });
  await expect(page.getByTestId("explain-text")).toContainText("Test answer");
  await expectEnglish(page, "explain");
  expect(await pageHeight(page)).toBeLessThanOrEqual(heightLimit(page));
});

test("Tu caso: plantilla cargada y CSV con errores, en inglés", async ({ page }) => {
  await openCase(page, "tfe2024-10c-1");
  await openTab(page, "caso");
  const p = panel(page, "case-panel");
  await expect(p).toBeVisible();
  await expect(page.getByTestId("case-load")).toBeDisabled();
  await expect(page.getByTestId("csv-info")).toContainText("The template is in Spanish");
  await expectEnglish(page, "case-panel");

  // Una plantilla con coordenadas pasa los tres pasos.
  await page.getByTestId("csv-file").setInputFiles(path.join(FIXTURES, "plantilla_con_coordenadas.csv"));
  await expect(page.getByTestId("csv-info")).toContainText("plantilla_con_coordenadas.csv");
  await page.getByTestId("case-name").fill("Template test");
  await page.getByTestId("case-load").click();
  await expect(page.getByTestId("case-loaded")).toContainText("“Template test” loaded: 3 customers and 3 vans.");
  await expect(page.locator('[data-testid="case-step"][data-step="geocode"]')).toContainText("Not needed");
  await expect(page.locator('[data-testid="case-step"][data-step="matrix"]')).toContainText("straight-line");
  await expectEnglish(page, "case-panel");

  // Un CSV con tres errores: los motivos van en español (los redacta el servicio) y el aviso lo dice.
  await page.getByTestId("csv-file").setInputFiles(path.join(FIXTURES, "tres_errores.csv"));
  await page.getByTestId("case-load").click();
  const errors = page.getByTestId("csv-errors");
  await expect(errors).toContainText("3 rows with errors (messages in Spanish)");
  await expect(errors.getByTestId("csv-error").nth(0)).toContainText("Row 3");
  await expectEnglish(page, "case-panel", CSV_ROWS);

  // El formulario, con un error de fila escrito en la tarjeta.
  await page.getByTestId("case-mode-form").click();
  await expect(page.getByTestId("case-form")).toBeVisible();
  await expect(page.getByTestId("add-customer")).toHaveText(/Add customer/);
  await expectEnglish(page, "case-panel", CSV_ROWS);
});

test("Tu ruta: paradas, borrador y veredicto, en inglés", async ({ page }) => {
  await openCase(page, "tfe2024-10c-1");
  await openTab(page, "ruta");
  const p = panel(page, "manual-panel");
  await expect(p).toHaveAttribute("data-active", "true");
  await expect(p).toContainText("Can you beat the heuristic?");
  await expect(page.getByTestId("manual-status")).toContainText("You have not assigned any stop yet.");
  await expectEnglish(page, "manual-panel");

  await page.locator('[data-testid="manual-vehicle"][data-new]').click();
  for (const customer of [1, 2]) {
    await page.locator(`[data-testid="stop"][data-customer="${customer}"]`).dispatchEvent("click");
  }
  await expect(page.getByTestId("manual-route")).toHaveText("V1: 1 → 2");
  await expect(page.getByTestId("manual-verdict")).toContainText("Not a valid plan yet: outside the time window (1), unserved (8).");
  await expect(page.getByTestId("manual-pending")).toContainText("Pending 8 of 10");
  await expect(page.getByTestId("manual-vehicle").first()).toHaveAttribute("aria-label", "Van 1, 2 stops");
  await expectEnglish(page, "manual-panel");
  expect(await pageHeight(page)).toBeLessThanOrEqual(heightLimit(page));
});
