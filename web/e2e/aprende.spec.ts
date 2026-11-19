import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { formatCost, formatDuration, formatEuro, formatNumber } from "../lib/format";
import {
  API_ORIGIN,
  LEARN_SCENE_HEIGHT,
  blockService,
  expectBodyText16,
  expectNoHorizontalOverflow,
  pageHeight,
  stubMapStyle,
} from "./helpers";

// «Aprende» lee un único caso estático y nunca llama al servicio.

type Evaluation = {
  score: number;
  distance: number;
  total_late: number;
  vehicles_used: number;
  feasible: boolean;
  violations: { type: string; customer: number | null }[];
};
type Run = {
  run_id: string;
  method: string;
  role: string;
  model_requested: string | null;
  model_returned: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  api_cost_eur: number | null;
  wall_time_s: number;
  evaluation: Evaluation | null;
};

const CASE_FILE = "/data/cases/tfe2024-10c-1.json";
const CASE: { runs: Run[] } = JSON.parse(
  readFileSync(path.join(__dirname, "..", "public", "data", "cases", "tfe2024-10c-1.json"), "utf8"),
);
const CLASSIC = CASE.runs.filter((r) => r.role === "classic");
const LLM = CASE.runs.filter((r) => r.role !== "classic");

/** La escena a la vista (las demás siguen montadas, ocultas). */
const scene = (page: Page) => page.getByTestId("learn-scene").filter({ visible: true });

async function goToScene(page: Page, n: number): Promise<void> {
  await page.getByTestId("learn-dot").nth(n - 1).click();
  await expect(scene(page)).toHaveAttribute("data-scene", String(n));
}

/** Capturas y alturas para la revisión, solo si se pide una carpeta en `LEARN_SHOTS`. */
const SHOTS = process.env.LEARN_SHOTS;

test.beforeEach(async ({ page }) => {
  await blockService(page);
  await stubMapStyle(page);
});

test("/aprende responde 200 con su propio título y empieza en la escena 1", async ({ page }) => {
  const res = await page.goto("/aprende");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/^Aprende: /);
  await expect(scene(page)).toHaveAttribute("data-scene", "1");
  await expect(page.getByTestId("learn-prev")).toBeDisabled();
  await expect(page.getByTestId("learn-dot")).toHaveCount(7);
});

test("se llega desde la cabecera y desde la tarjeta «Aprende» de la portada", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("site-header").getByRole("link", { name: "Aprende" }).click();
  await expect(page).toHaveURL(/\/aprende$/);
  await expect(scene(page)).toHaveAttribute("data-scene", "1");

  await page.goto("/");
  await page.getByTestId("learn-card").click();
  await expect(page).toHaveURL(/\/aprende$/);
  await expect(scene(page)).toBeVisible();
});

test("se recorren todas las escenas con teclado y la última vuelve a la portada", async ({ page }) => {
  await page.goto("/aprende");
  await page.getByTestId("learn-next").focus();
  for (let n = 2; n <= 7; n++) {
    await page.keyboard.press("Enter");
    await expect(scene(page)).toHaveAttribute("data-scene", String(n));
  }
  // El botón «Siguiente» desaparece en la última: el foco pasa al enlace al planificador.
  await expect(page.getByTestId("learn-go")).toBeFocused();

  // Flechas del teclado: atrás y adelante.
  await page.keyboard.press("ArrowLeft");
  await expect(scene(page)).toHaveAttribute("data-scene", "6");
  await page.keyboard.press("ArrowRight");
  await expect(scene(page)).toHaveAttribute("data-scene", "7");
  await expect(page.getByTestId("learn-go")).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("example-card").first()).toBeVisible();
});

test("escena 2: el deslizador pasa por espera, a tiempo y retraso, con texto e icono", async ({ page }) => {
  await page.goto("/aprende");
  await page.getByTestId("learn-next").click();
  await expect(scene(page)).toHaveAttribute("data-scene", "2");
  const slider = scene(page).getByTestId("window-slider");
  const state = scene(page).getByTestId("window-state");

  await slider.focus();
  await page.keyboard.press("Home");
  await expect(state).toHaveAttribute("data-state", "wait");
  await expect(state).toContainText("Espera 2 h");

  // Las flechas mueven el deslizador, no la escena.
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue("485");
  await expect(scene(page)).toHaveAttribute("data-scene", "2");

  await slider.fill("660");
  await expect(state).toHaveAttribute("data-state", "ok");
  await expect(state).toContainText("Entrega a tiempo");

  await page.keyboard.press("End");
  await expect(state).toHaveAttribute("data-state", "late");
  await expect(state).toContainText("Retraso de 2 h");

  // Cada estado lleva icono y texto, no solo color.
  for (const [value, s, text] of [
    ["540", "wait", "Espera 1 h"],
    ["660", "ok", "Entrega a tiempo"],
    ["780", "late", "Retraso de 1 h"],
  ]) {
    await slider.fill(value);
    await expect(state).toHaveAttribute("data-state", s);
    await expect(state).toHaveText(text);
    await expect(state.locator("svg")).toHaveCount(1);
  }
});

test("escenas 1, 3 y 4: los dibujos responden al visitante", async ({ page }) => {
  await page.goto("/aprende");
  // 1: pulsar clientes traza rutas hasta completar el plan.
  const clients = scene(page).getByTestId("toy-client");
  await expect(clients).toHaveCount(6);
  await clients.nth(0).click();
  await expect(clients.nth(0)).toHaveAttribute("aria-label", /furgoneta 1, parada 1/);
  await scene(page).getByTestId("toy-van").nth(1).click();
  for (let i = 1; i < 6; i++) await clients.nth(i).click();
  await expect(clients.nth(1)).toHaveAttribute("aria-label", /furgoneta 2, parada 1/);
  await expect(scene(page).getByTestId("toy-status")).toContainText("Plan completo");

  // 3: los pedidos llenan la furgoneta 1 y el que no cabe va en la 2.
  await goToScene(page, 3);
  await expect(scene(page).getByTestId("toy-order")).toHaveCount(6);
  for (const id of ["A", "D", "B"]) await scene(page).locator(`[data-testid="toy-order"][data-client="${id}"]`).click();
  await expect(scene(page).getByTestId("capacity-status")).toContainText("va en la 2");
  await expect(scene(page).getByTestId("toy-hold").nth(0)).toHaveAttribute("data-used", "9");
  await expect(scene(page).getByTestId("toy-hold").nth(1)).toHaveAttribute("data-used", "3");

  // 4: cada plan dice si vale y por qué, con texto.
  await goToScene(page, 4);
  const plans = scene(page).getByTestId("toy-plan");
  await expect(plans).toHaveCount(3);
  await expect(plans.filter({ hasText: "No vale" })).toHaveCount(2);
  await plans.nth(2).click();
  await expect(scene(page).getByTestId("toy-rules")).toContainText("sin atender");
  await plans.nth(0).click();
  await expect(scene(page).getByTestId("toy-rules")).toContainText("recibe tarde");
});

test("escena 5: las cifras de los cuatro métodos coinciden con el JSON, con su run_id", async ({ page }) => {
  await page.goto("/aprende");
  await goToScene(page, 5);
  const rows = scene(page).getByTestId("learn-method");
  await expect(rows).toHaveCount(CLASSIC.length);
  // Con movimiento, el dibujo de la idea se anima.
  expect(await scene(page).locator("animate, animateMotion, animateTransform").count()).toBeGreaterThan(0);
  const best = CLASSIC.filter((r) => r.evaluation?.feasible).sort((a, b) => a.evaluation!.score - b.evaluation!.score)[0];

  for (const run of CLASSIC) {
    const ev = run.evaluation!;
    const row = scene(page).locator(`[data-testid="learn-method"][data-run-id="${run.run_id}"]`);
    await expect(row.getByTestId("learn-cost")).toHaveText(formatCost(ev.score));
    await expect(row.getByTestId("learn-vehicles")).toHaveText(String(ev.vehicles_used));
    await expect(row.getByTestId("learn-validity")).toContainText(ev.feasible ? "Válido" : "No válido: fuera de ventana");
    if (run === best) await expect(row).toContainText("Mejor válida");
    else await expect(row).not.toContainText("Mejor válida");

    await row.click();
    const detail = scene(page).getByTestId("learn-run-detail");
    await expect(detail).toHaveAttribute("data-run-id", run.run_id);
    await expect(detail.getByTestId("learn-run-id")).toHaveText(run.run_id);
    await expect(detail.getByTestId("learn-distance")).toHaveText(formatNumber(ev.distance, 1));
    await expect(detail.getByTestId("learn-late")).toHaveText(formatNumber(ev.total_late, 1));
    await expect(detail.getByTestId("learn-time")).toHaveText(formatDuration(run.wall_time_s));
    const late = new Set(ev.violations.filter((v) => v.type === "late").map((v) => v.customer)).size;
    await expect(detail.locator('[data-testid="case-stop"][data-late="true"]')).toHaveCount(late);
  }
});

test("escena 6: las seis ejecuciones con IA, también las no válidas y las ilegibles, con sus cifras", async ({ page }) => {
  await page.goto("/aprende");
  await goToScene(page, 6);
  const cards = scene(page).getByTestId("learn-llm-run");
  await expect(cards).toHaveCount(LLM.length);
  const valid = LLM.filter((r) => r.evaluation?.feasible).length;
  const unreadable = LLM.filter((r) => !r.evaluation).length;
  expect(unreadable).toBeGreaterThan(0);
  await expect(scene(page).getByTestId("learn-ai-summary")).toContainText(
    `${valid} de ${LLM.length} ejecuciones con IA dieron un plan válido y ${unreadable} no dejaron`,
  );

  for (const run of LLM) {
    const card = scene(page).locator(`[data-testid="learn-llm-run"][data-run-id="${run.run_id}"]`);
    await expect(card).toHaveAttribute("data-role", run.role);
    await expect(card).toContainText(run.model_returned ?? run.model_requested!);
    await expect(card.getByTestId("learn-llm-tokens")).toHaveText(
      `${formatNumber(run.tokens_in!, 0)} / ${formatNumber(run.tokens_out!, 0)} tokens`,
    );
    await expect(card.getByTestId("learn-llm-eur")).toHaveText(formatEuro(run.api_cost_eur!));
    if (run.evaluation) {
      await expect(card.getByTestId("learn-llm-cost")).toHaveText(formatCost(run.evaluation.score));
      await expect(card.getByTestId("learn-llm-status")).toContainText(run.evaluation.feasible ? "Válido" : "No válido");
    } else {
      await expect(card.getByTestId("learn-llm-cost")).toHaveCount(0);
      await expect(card.getByTestId("learn-llm-status")).toContainText("Sin respuesta legible");
    }

    await card.click();
    const detail = scene(page).getByTestId("learn-llm-detail");
    await expect(detail).toHaveAttribute("data-run-id", run.run_id);
    await expect(detail.getByTestId("learn-run-id")).toHaveText(run.run_id);
    await expect(detail.getByTestId("learn-llm-time")).toHaveText(formatDuration(run.wall_time_s));
    if (run.role === "llm_agent") await expect(detail.getByTestId("learn-trace")).toBeVisible();
  }
});

test("la página no llama al servicio: solo lee el caso de ejemplo", async ({ page }) => {
  const service: string[] = [];
  const data: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (req.url().startsWith(API_ORIGIN)) service.push(req.url());
    if (url.pathname.startsWith("/data/")) data.push(url.pathname);
  });
  await page.goto("/aprende");
  for (let n = 2; n <= 7; n++) await goToScene(page, n);
  await expect(page.getByTestId("learn-go")).toBeVisible();
  expect(service).toEqual([]);
  expect(data).toEqual([CASE_FILE]);
});

test("al volver a la portada, el caso y el plan seleccionados se conservan", async ({ page }) => {
  await page.goto("/");
  const card = page.locator('[data-testid="example-card"][data-case-id="tfe2024-10c-1"]');
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  const tabu = CLASSIC.find((r) => r.method === "tabu")!;
  const row = page.locator(`[data-testid="comparison-row"][data-run-id="${tabu.run_id}"]`);
  await row.getByRole("button").first().click();
  await expect(row).toHaveAttribute("data-selected", "true");

  await page.getByTestId("site-header").getByRole("link", { name: "Aprende" }).click();
  await expect(scene(page)).toHaveAttribute("data-scene", "1");
  await goToScene(page, 7);
  await page.getByTestId("learn-go").click();

  await expect(page).toHaveURL(/\/$/);
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(row).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("detail-run-id").filter({ visible: true })).toHaveText(tabu.run_id);
});

test("con movimiento reducido, los dibujos quedan quietos y el deslizador sigue funcionando", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/aprende");
  await expect(page.getByTestId("learn-story")).toHaveAttribute("data-motion", "off");
  await goToScene(page, 5);
  await expect(scene(page).locator("animate, animateMotion, animateTransform")).toHaveCount(0);
  await goToScene(page, 2);
  await scene(page).getByTestId("window-slider").fill("780");
  await expect(scene(page).getByTestId("window-state")).toHaveAttribute("data-state", "late");
});

test("cada escena cabe en su techo de altura (dos pantallas en móvil, una en escritorio), sin desbordamiento y con texto de 16 px", async ({ page }) => {
  const width = page.viewportSize()!.width;
  const heights: Record<string, number> = {};
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  await page.goto("/aprende");
  for (let n = 1; n <= 7; n++) {
    if (n > 1) await page.getByTestId("learn-next").click();
    await expect(scene(page)).toHaveAttribute("data-scene", String(n));
    if (n === 5) await expect(scene(page).getByTestId("learn-run-detail")).toBeVisible();
    if (n === 6) await expect(scene(page).getByTestId("learn-llm-detail")).toBeVisible();
    const h = await pageHeight(page);
    heights[`escena-${n}`] = h;
    expect(h, `escena ${n}`).toBeLessThanOrEqual(LEARN_SCENE_HEIGHT[width]);
    await expectNoHorizontalOverflow(page);
    await expectBodyText16(page);
    if (SHOTS) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, `${width}-escena-${n}.png`), fullPage: true });
    }
  }
  if (SHOTS) {
    // Portada con la tarjeta «Aprende» y la cabecera con su enlace.
    await page.goto("/");
    await expect(page.getByTestId("learn-card")).toBeVisible();
    await expect(page.locator('[data-testid="example-card"][data-case-id="madrid-12"]')).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(600);
    heights["portada-madrid-12"] = await pageHeight(page);
    await page.screenshot({ path: path.join(SHOTS, `${width}-portada.png`), fullPage: true });
    await page.getByTestId("site-header").screenshot({ path: path.join(SHOTS, `${width}-cabecera.png`) });
    await page.getByTestId("learn-card").screenshot({ path: path.join(SHOTS, `${width}-tarjeta.png`) });
    writeFileSync(path.join(SHOTS, `${width}-alturas.json`), JSON.stringify(heights, null, 2));
  }
});
