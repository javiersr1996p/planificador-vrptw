import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Request } from "@playwright/test";
import { formatCost } from "../lib/format";
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

// Resolver en vivo con los métodos clásicos, tráfico y modo sin servicio. Usa el
// servicio de pruebas de `playwright.config.ts`. Para no esperar 30 s por método,
// las pruebas reescriben `time_limit_s` de la petición a unos pocos segundos; la
// primera comprueba que la interfaz envía `seed` 0 y 30 s. Las que mandan el cálculo
// real van con `solverTest`: se turnan el servicio con las de los demás trabajadores.

test.setTimeout(120_000);

type Run = { method: string; evaluation: { score: number; vehicles_used: number; distance: number } | null };
const madrid: { runs: Run[] } = JSON.parse(
  readFileSync(path.join(__dirname, "..", "public", "data", "cases", "madrid-12.json"), "utf8"),
);
const pre = (method: string) => madrid.runs.find((r) => r.method === method)!;

const CORS = {
  "access-control-allow-origin": "http://localhost:3100",
  "access-control-expose-headers": "Retry-After",
};
const SOLVE = `${API_ORIGIN}/solve/classic`;

const rows = (page: Page) => page.getByTestId("comparison-row");
const live = (page: Page) => rows(page).and(page.locator('[data-origin="en vivo"]'));
const solveRow = (page: Page, method: string) => page.locator(`[data-testid="solve-row"][data-method="${method}"]`);
const start = (page: Page) => page.getByTestId("solve-start");

async function openPanel(page: Page): Promise<void> {
  await page.locator('[data-testid="live-action"][data-live="resolver"]').click();
  await expect(page.getByTestId("classic-panel")).toBeVisible();
}

/** Deja marcados solo estos métodos. */
async function pick(page: Page, methods: string[]): Promise<void> {
  for (const m of ["heuristic", "aco", "ga", "tabu"]) {
    const box = page.getByTestId(`solve-pick-${m}`);
    if (methods.includes(m)) await box.check();
    else await box.uncheck();
  }
}

/**
 * Atiende `/solve/classic`: `limit` sustituye el tiempo de la petición y `intercept`
 * puede responder él mismo (devuelve `true` si lo hizo). Registra los cuerpos originales.
 */
async function handleSolve(
  page: Page,
  options: {
    limit?: number | ((method: string) => number);
    intercept?: (n: number, route: import("@playwright/test").Route) => Promise<boolean>;
  } = {},
): Promise<{ bodies: Record<string, unknown>[]; times: number[] }> {
  const seen = { bodies: [] as Record<string, unknown>[], times: [] as number[] };
  await page.route(SOLVE, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    seen.bodies.push(body);
    seen.times.push(Date.now());
    if (await options.intercept?.(seen.bodies.length, route)) return;
    const l = options.limit ?? 2;
    const limit = typeof l === "function" ? l(String(body.method)) : l;
    await route.continue({ postData: JSON.stringify({ ...body, time_limit_s: limit }) });
  });
  return seen;
}

/** Cuenta las peticiones en vuelo a una ruta del servicio y guarda el máximo simultáneo. */
function trackInflight(page: Page, pathname: string): { max: () => number; total: () => number } {
  let current = 0;
  let max = 0;
  let total = 0;
  const mine = (r: Request) => r.method() === "POST" && r.url() === API_ORIGIN + pathname;
  page.on("request", (r) => {
    if (!mine(r)) return;
    current++;
    total++;
    max = Math.max(max, current);
  });
  page.on("requestfinished", (r) => {
    if (mine(r)) current--;
  });
  page.on("requestfailed", (r) => {
    if (mine(r)) current--;
  });
  return { max: () => max, total: () => total };
}

const busy = (route: import("@playwright/test").Route, retryAfter: string) =>
  route.fulfill({
    status: 503,
    headers: { ...CORS, "Retry-After": retryAfter },
    contentType: "application/json",
    body: JSON.stringify({ detail: "Hay otro cálculo en curso" }),
  });

test.beforeEach(async ({ page }) => {
  await stubMapStyle(page);
  await page.goto("/");
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByTestId("service-status")).toHaveAttribute("data-state", "up");
});

solverTest("heurística y GA añaden dos filas en vivo; la heurística coincide con la precalculada", async ({ page }) => {
  const seen = await handleSolve(page);
  await openPanel(page);
  await pick(page, ["heuristic", "ga"]);
  await start(page).click();

  await expect(live(page)).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByTestId("solve-summary")).toContainText("2 planes nuevos");
  await expect(solveRow(page, "heuristic")).toHaveAttribute("data-status", "done");
  await expect(solveRow(page, "ga")).toHaveAttribute("data-status", "done");
  await expect(solveRow(page, "aco")).toHaveAttribute("data-status", "idle");

  // Los precalculados siguen; las dos nuevas traen coste, furgonetas y tiempo.
  await expect(rows(page).and(page.locator('[data-origin="precalculada"]'))).toHaveCount(4);
  for (const method of ["heuristic", "ga"]) {
    const r = live(page).and(page.locator(`[data-method="${method}"]`));
    await expect(r.getByTestId("row-cost")).not.toHaveText("");
    await expect(r.getByTestId("row-vehicles")).toHaveText(/^\d+$/);
    await expect(r).toContainText(/\d+(,\d+)? (ms|s)/);
  }
  const heuristic = live(page).and(page.locator('[data-method="heuristic"]'));
  await expect(heuristic.getByTestId("row-cost")).toHaveText(formatCost(pre("heuristic").evaluation!.score));
  await expect(heuristic.getByTestId("row-vehicles")).toHaveText(String(pre("heuristic").evaluation!.vehicles_used));

  // El plan nuevo queda seleccionado.
  await expect(rows(page).and(page.locator('[data-selected="true"]'))).toHaveAttribute("data-origin", "en vivo");

  // Petición: seed 0, 30 s, un método cada vez y en el orden de la lista.
  expect(seen.bodies.map((b) => [b.method, b.seed, b.time_limit_s])).toEqual([
    ["heuristic", 0, 30],
    ["ga", 0, 30],
  ]);

  // Volver a resolver sustituye la fila del mismo método, no la duplica.
  await start(page).click();
  await expect(solveRow(page, "ga")).toHaveAttribute("data-status", "done");
  await expect(live(page)).toHaveCount(2);
});

solverTest("nunca hay dos peticiones a /solve/classic en vuelo a la vez", async ({ page }) => {
  await handleSolve(page);
  const solves = trackInflight(page, "/solve/classic");
  await openPanel(page);
  await start(page).click(); // los cuatro métodos
  await expect(live(page)).toHaveCount(4, { timeout: 90_000 });
  await expect(solveRow(page, "tabu")).toHaveAttribute("data-status", "done");
  expect(solves.total()).toBe(4);
  expect(solves.max()).toBe(1);
});

solverTest("cada método marca su estado: en cola, calculando con cronómetro y hecho", async ({ page }) => {
  await handleSolve(page, { limit: (m) => (m === "aco" ? 4 : 1) });
  await openPanel(page);
  await pick(page, ["aco", "ga"]);
  await start(page).click();
  await expect(solveRow(page, "aco")).toHaveAttribute("data-status", "running");
  await expect(solveRow(page, "ga")).toHaveAttribute("data-status", "queued");
  await expect(solveRow(page, "ga")).toContainText("En cola");
  await expect(solveRow(page, "aco").getByTestId("solve-timer")).toHaveText(/^\d+:\d{2}$/);
  // Mientras se calcula, la interfaz sigue dentro del presupuesto y legible.
  const width = page.viewportSize()!.width;
  expect(await pageHeight(page)).toBeLessThanOrEqual(MAX_HEIGHT[width]);
  await expectNoHorizontalOverflow(page);
  await expectBodyText16(page, '[data-testid="live-panel"]');
  await expect(solveRow(page, "ga")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
});

solverTest("un 503 simulado muestra el aviso, respeta Retry-After y acaba en resultado", async ({ page }) => {
  const seen = await handleSolve(page, {
    intercept: async (n, route) => {
      if (n > 1) return false;
      await busy(route, "2");
      return true;
    },
  });
  await openPanel(page);
  await pick(page, ["heuristic"]);
  await start(page).click();
  await expect(solveRow(page, "heuristic")).toContainText("Servicio ocupado, reintentando");
  await expect(solveRow(page, "heuristic")).toHaveAttribute("data-status", "done", { timeout: 20_000 });
  await expect(live(page)).toHaveCount(1);
  expect(seen.bodies).toHaveLength(2);
  expect(seen.times[1] - seen.times[0]).toBeGreaterThanOrEqual(1800);
});

solverTest("siete 503 seguidos acaban en error legible y la cola sigue con el siguiente método", async ({ page }) => {
  const seen = await handleSolve(page, {
    intercept: async (n, route) => {
      if (n > 7) return false;
      await busy(route, "1");
      return true;
    },
  });
  await openPanel(page);
  await pick(page, ["heuristic", "ga"]);
  await start(page).click();
  await expect(solveRow(page, "heuristic")).toHaveAttribute("data-status", "error", { timeout: 30_000 });
  await expect(solveRow(page, "heuristic")).toContainText("sigue ocupado");
  await expect(solveRow(page, "heuristic")).not.toContainText("Hay otro cálculo en curso");
  await expect(solveRow(page, "ga")).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  expect(seen.bodies.map((b) => b.method)).toEqual([...Array(7).fill("heuristic"), "ga"]);
  await expect(live(page)).toHaveCount(1);
  await expect(live(page)).toHaveAttribute("data-method", "ga");
});

for (const [status, detail, expected] of [
  [500, "Traceback (most recent call last) secreto-interno", "error 500"],
  [422, [{ loc: ["body", "instance"], msg: "campo secreto-interno" }], "error 422"],
] as const) {
  test(`un ${status} del servicio sale como mensaje legible, sin volcar la respuesta`, async ({ page }) => {
    await handleSolve(page, {
      intercept: async (_n, route) => {
        await route.fulfill({ status, headers: CORS, contentType: "application/json", body: JSON.stringify({ detail }) });
        return true;
      },
    });
    await openPanel(page);
    await pick(page, ["heuristic"]);
    await start(page).click();
    await expect(solveRow(page, "heuristic")).toHaveAttribute("data-status", "error");
    await expect(solveRow(page, "heuristic")).toContainText(expected);
    await expect(page.getByTestId("classic-panel")).not.toContainText("secreto-interno");
    await expect(live(page)).toHaveCount(0);
    await expect(start(page)).toBeEnabled();
  });
}

solverTest("cancelar deja la interfaz utilizable y sin filas a medias", async ({ page }) => {
  await handleSolve(page, { limit: (m) => (m === "aco" ? 4 : 1) });
  await openPanel(page);
  await start(page).click(); // heurística, hormigas, genético, tabú
  await expect(solveRow(page, "heuristic")).toHaveAttribute("data-status", "done");
  await expect(solveRow(page, "aco")).toHaveAttribute("data-status", "running");
  await page.getByTestId("solve-cancel").click();

  for (const m of ["aco", "ga", "tabu"]) await expect(solveRow(page, m)).toHaveAttribute("data-status", "idle");
  await expect(solveRow(page, "heuristic")).toHaveAttribute("data-status", "done");
  await expect(start(page)).toBeEnabled();
  await expect(page.getByTestId("solve-pick-aco")).toBeEnabled();
  await expect(live(page)).toHaveCount(1); // solo la heurística, que ya había acabado
  await page.waitForTimeout(500);
  await expect(live(page)).toHaveCount(1);

  // Se puede volver a resolver (el servicio puede seguir ocupado un momento: se reintenta solo).
  await pick(page, ["ga"]);
  await start(page).click();
  await expect(solveRow(page, "ga")).toHaveAttribute("data-status", "done", { timeout: 40_000 });
  await expect(live(page)).toHaveCount(2);
});

solverTest("con horas-punta cambia al menos una llegada del detalle y la distancia no; se marca como reevaluada", async ({ page }) => {
  const seen = await handleSolve(page);
  const evals = trackInflight(page, "/evaluate");
  const bodies: { instance: { traffic_profile: { factor: number }[] | null } }[] = [];
  page.on("request", (r) => {
    if (r.url() === `${API_ORIGIN}/evaluate` && r.method() === "POST") bodies.push(r.postDataJSON());
  });
  const arrivals = () => page.getByTestId("stop-arrival").allTextContents();
  const distance = () => page.getByTestId("kpi-distance").getAttribute("data-value");

  await expect(page.getByTestId("stop-arrival").first()).toBeVisible();
  const before = await arrivals();
  const km = await distance();
  await openPanel(page);
  await expect(page.getByTestId("traffic")).toContainText("ilustrativos");

  await page.locator("label", { hasText: "Horas punta" }).click();
  await expect(page.getByTestId("traffic-horas-punta")).toBeChecked();
  const marked = page.getByTestId("reevaluated").getByRole("listitem");
  await expect(marked).toHaveCount(4, { timeout: 30_000 });
  await expect(marked.first()).toContainText("reevaluada con tráfico");
  // También en su fila de la comparativa, con texto.
  const reevaluated = rows(page).and(page.locator('[data-reevaluated="true"]'));
  await expect(reevaluated).toHaveCount(4);
  await expect(reevaluated.first().getByTestId("row-reevaluated")).toHaveText("reevaluada con tráfico");
  await expect(reevaluated.first().getByTestId("row-reevaluated")).toBeVisible();
  await expect.poll(arrivals).not.toEqual(before);
  expect(await distance()).toBe(km);

  expect(evals.total()).toBe(4);
  expect(evals.max()).toBe(1);
  expect(bodies.every((b) => b.instance.traffic_profile?.some((w) => w.factor === 1.5))).toBe(true);

  // Sin tráfico vuelve a las cifras de partida y desaparecen las marcas.
  await page.locator("label", { hasText: "Sin tráfico" }).click();
  await expect(page.getByTestId("reevaluated")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("row-reevaluated")).toHaveCount(0);
  await expect.poll(arrivals).toEqual(before);

  // Lo que se resuelva con un perfil elegido lleva ese tráfico.
  await page.locator("label", { hasText: "Horas punta" }).click();
  await expect(page.getByTestId("reevaluated").getByRole("listitem")).toHaveCount(4, { timeout: 30_000 });
  await pick(page, ["heuristic"]);
  await start(page).click();
  await expect(live(page)).toHaveCount(1, { timeout: 30_000 });
  expect((seen.bodies[0].instance as { traffic_profile: unknown[] }).traffic_profile).toHaveLength(2);

  // Con el panel lleno (cuatro métodos hechos, tráfico y planes reevaluados) la página sigue dentro del tope.
  await pick(page, ["heuristic", "aco", "ga", "tabu"]);
  await start(page).click();
  await expect(solveRow(page, "tabu")).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(page.getByTestId("reevaluated").getByRole("listitem")).toHaveCount(4);
  const width = page.viewportSize()!.width;
  expect(await pageHeight(page)).toBeLessThanOrEqual(MAX_HEIGHT[width]);
});

test("el tráfico solo se ofrece en los casos de Madrid", async ({ page }) => {
  await page.locator('[data-testid="example-card"][data-case-id="tfe2024-10c-1"]').click();
  await expect(rows(page)).toHaveCount(10);
  await openPanel(page);
  await expect(page.getByTestId("traffic-unavailable")).toBeVisible();
  await expect(page.getByTestId("traffic-horas-punta")).toHaveCount(0);
});

test("con el servicio apagado: aviso, resolver y tráfico desactivados, el resto intacto", async ({ page }) => {
  await blockService(page);
  // La comprobación inicial se hizo con el servicio activo: se repite ya apagado.
  await page.reload();
  await expect(page.getByTestId("service-status")).toHaveAttribute("data-state", "down");
  await expect(rows(page)).toHaveCount(4);
  await openPanel(page);

  await expect(page.getByTestId("classic-panel").getByTestId("service-notice")).toContainText(
    "Servicio no disponible: se muestran los resultados precalculados",
  );
  await expect(start(page)).toBeDisabled();
  await expect(start(page)).toHaveAccessibleDescription(/Servicio no disponible/);
  await expect(page.getByTestId("traffic-horas-punta")).toBeDisabled();
  await expect(page.getByTestId("traffic-plano")).toBeDisabled();

  // Ejemplos, reproducción y comparativa siguen funcionando.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("live-panel")).toBeHidden();
  const play = page.getByTestId("play-button");
  const clock = page.getByTestId("sim-clock");
  const t0 = await clock.textContent();
  await play.click();
  await expect(clock).not.toHaveText(t0!, { timeout: 10_000 });
  await page.locator('[data-testid="example-card"][data-case-id="madrid-25"]').click();
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByTestId("detail-run-id")).not.toHaveText("");
  await expect(page.getByTestId("kpi-distance")).toBeVisible();
  const width = page.viewportSize()!.width;
  expect(await pageHeight(page)).toBeLessThanOrEqual(MAX_HEIGHT[width]);
  await expectNoHorizontalOverflow(page);

  // Reintentar vuelve a comprobar el servicio (sigue apagado: el aviso se mantiene).
  await openPanel(page);
  await page.getByTestId("classic-panel").getByTestId("service-notice-retry").click();
  await expect(page.getByTestId("classic-panel").getByTestId("service-notice")).toBeVisible();
  await expect(page.getByTestId("service-status")).toHaveAttribute("data-state", "down");
});

test("el servicio vuelve: reintentar activa las acciones", async ({ page }) => {
  await blockService(page);
  await page.reload();
  await expect(page.getByTestId("service-status")).toHaveAttribute("data-state", "down");
  await openPanel(page);
  await expect(start(page)).toBeDisabled();
  await page.unroute(`${API_ORIGIN}/**`);
  await page.getByTestId("classic-panel").getByTestId("service-notice-retry").click();
  await expect(page.getByTestId("service-status")).toHaveAttribute("data-state", "up");
  await expect(page.getByTestId("classic-panel").getByTestId("service-notice")).toHaveCount(0);
  await expect(start(page)).toBeEnabled();
});

test("panel abierto: dentro del presupuesto de altura, texto de 16 px y zonas táctiles de 44 px", async ({ page }) => {
  await openPanel(page);
  const width = page.viewportSize()!.width;
  expect(await pageHeight(page)).toBeLessThanOrEqual(MAX_HEIGHT[width]);
  await expectNoHorizontalOverflow(page);
  await expectBodyText16(page, '[data-testid="live-panel"]');
  await expectBodyText16(page, '[data-testid="service-status"]');
  // Cada línea con casilla, el botón y los perfiles de tráfico miden al menos 44 px de alto.
  const targets = page.locator(
    '[data-testid="solve-row"] label, [data-testid="solve-start"], [data-testid="traffic"] label',
  );
  for (const el of await targets.all()) {
    const box = await el.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(43.5);
  }
  // Escape cierra el panel y el foco vuelve a su botón.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("live-panel")).toBeHidden();
});

solverTest("al cambiar de caso se abandona lo que quedaba por resolver", async ({ page }) => {
  await handleSolve(page, { limit: (m) => (m === "aco" ? 4 : 1) });
  await openPanel(page);
  await start(page).click();
  await expect(solveRow(page, "aco")).toHaveAttribute("data-status", "running");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="example-card"][data-case-id="madrid-25"]').click();
  await expect(rows(page)).toHaveCount(4);
  await page.waitForTimeout(1500);
  // Ninguna fila en vivo del caso anterior se cuela en el nuevo.
  await expect(live(page)).toHaveCount(0);
  await openPanel(page);
  for (const m of ["heuristic", "aco", "ga", "tabu"]) await expect(solveRow(page, m)).toHaveAttribute("data-status", "idle");
});

/** Registro completo de la heurística precalculada de madrid-12, base de las respuestas simuladas. */
type FullRecord = {
  run_id: string;
  solution: { routes: number[][] };
  evaluation: { total_late: number; feasible: boolean; violations: { type: string; route?: number }[] };
};
const heuristicRecord = () => structuredClone(pre("heuristic")) as unknown as FullRecord;
const madridInstance = (madrid as unknown as { instance: unknown }).instance;

/** Responde `/solve/classic` con `record`, pasados `delayMs`. */
async function fulfillSolve(page: Page, record: unknown, delayMs = 0): Promise<void> {
  await page.route(SOLVE, async (route) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route
      .fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify(record) })
      .catch(() => {}); // la página pudo cancelar la petición
  });
}

async function closePanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Cerrar el panel" }).click();
  await expect(page.getByTestId("live-panel")).toBeHidden();
}

/** Una puerta: las peticiones esperan en `wait` hasta que la prueba llama a `open`. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = () => {};
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { wait, open };
}

const LLM_KEY = "sk-ant-centinela-05";
const trafficRadio = (page: Page) => page.getByTestId("traffic-horas-punta");
const peak = (page: Page) => page.locator("label", { hasText: "Horas punta" });

test("doble clic en «Resolver» no cancela el cálculo que acaba de lanzar", async ({ page }) => {
  await fulfillSolve(page, { ...heuristicRecord(), run_id: "doble-clic" }, 400);
  await openPanel(page);
  await pick(page, ["heuristic"]);
  await start(page).dblclick();
  await expect(solveRow(page, "heuristic")).toHaveAttribute("data-status", "done");
  await expect(live(page)).toHaveCount(1);
});

test("una furgoneta sin paradas no sale de la base: su detalle no trae salida ni vuelta", async ({ page, request }) => {
  const record = heuristicRecord();
  const routes = [...record.solution.routes, []];
  const res = await request.post(`${API_ORIGIN}/evaluate`, { data: { instance: madridInstance, routes } });
  expect(res.ok()).toBe(true);
  await fulfillSolve(page, { ...record, run_id: "ruta-vacia", solution: { routes }, evaluation: await res.json() });
  await openPanel(page);
  await pick(page, ["heuristic"]);
  await start(page).click();
  await expect(solveRow(page, "heuristic")).toHaveAttribute("data-status", "done");
  await closePanel(page);
  await expect(page.getByTestId("detail-run-id")).toHaveText("ruta-vacia");

  await page.locator(`[data-testid="detail-lane"][data-route="${routes.length - 1}"]`).click();
  const day = page.locator("#veh-panel");
  await expect(day).toContainText("no sale de la base");
  await expect(day).not.toContainText("Salida");
  await expect(day).not.toContainText("Vuelta");
  await expect(page.getByTestId("depot-return")).toHaveCount(0);
});

test("una vuelta tarde a la base sale como fallo y no se cuenta como retraso de un cliente", async ({ page }) => {
  const record = heuristicRecord();
  expect(record.evaluation.total_late).toBe(0);
  // Lo que el servicio devuelve si solo falla la vuelta: `total_late` incluye ese retraso.
  const evaluation = {
    ...record.evaluation,
    feasible: false,
    total_late: 7,
    violations: [...record.evaluation.violations, { type: "depot_due", route: 0 }],
  };
  await fulfillSolve(page, { ...record, run_id: "vuelta-tarde", evaluation });
  await openPanel(page);
  await pick(page, ["heuristic"]);
  await start(page).click();
  await expect(solveRow(page, "heuristic")).toHaveAttribute("data-status", "done");
  await closePanel(page);
  await expect(page.getByTestId("detail-run-id")).toHaveText("vuelta-tarde");

  const late = page.locator('[data-testid="validity-check"][data-rule="late"]');
  await expect(late).toHaveAttribute("data-ok", "true");
  await expect(late).toContainText("0 min");
  const other = page.locator('[data-testid="validity-check"][data-rule="other"]');
  await expect(other).toHaveAttribute("data-ok", "false");
  await expect(other).toContainText("vuelta tarde al depósito (1)");
});

test("mientras la IA calcula no se cambia el tráfico, y mientras se reevalúa no se lanza nada", async ({ page }) => {
  const llm = gate();
  await page.route(`${API_ORIGIN}/solve/llm`, async (route) => {
    await llm.wait;
    await route.continue();
  });
  await page.locator('[data-testid="live-action"][data-live="ia"]').click();
  await page.getByTestId("llm-key").fill(LLM_KEY);
  await expect(page.getByTestId("llm-start")).toBeEnabled();
  await page.getByTestId("llm-start").click();
  await expect(page.getByTestId("llm-status")).toHaveAttribute("data-status", "running");

  await page.locator("#live-tab-resolver").click();
  await expect(trafficRadio(page)).toBeDisabled();
  llm.open();
  await expect(trafficRadio(page)).toBeEnabled({ timeout: 30_000 });
  await expect(live(page)).toHaveCount(1);

  const evaluations = gate();
  await page.route(`${API_ORIGIN}/evaluate`, async (route) => {
    await evaluations.wait;
    await route.continue();
  });
  await peak(page).click();
  await expect(page.getByTestId("traffic-progress")).toBeVisible();
  await expect(start(page)).toBeDisabled();
  await page.locator("#live-tab-ia").click();
  await expect(page.getByTestId("llm-start")).toBeDisabled();
  await expect(page.getByTestId("llm-launch-hint")).toContainText("tráfico");
  evaluations.open();
  await expect(page.getByTestId("llm-start")).toBeEnabled({ timeout: 30_000 });
  await expect(rows(page).and(page.locator('[data-reevaluated="true"]'))).toHaveCount(5);
});

test("un plan que no se pudo reevaluar con tráfico queda marcado con texto en la comparativa", async ({ page }) => {
  let n = 0;
  await page.route(`${API_ORIGIN}/evaluate`, async (route) => {
    n += 1;
    if (n !== 2) return route.continue();
    await route.fulfill({ status: 500, headers: CORS, contentType: "application/json", body: JSON.stringify({ detail: "fallo simulado" }) });
  });
  await openPanel(page);
  await peak(page).click();
  await expect(page.getByTestId("traffic-progress")).toBeHidden({ timeout: 30_000 });
  await expect(page.getByTestId("traffic").getByRole("alert")).toContainText("No se pudo reevaluar 1 plan");
  await expect(rows(page).and(page.locator('[data-reevaluated="true"]'))).toHaveCount(3);
  const failed = rows(page).and(page.locator('[data-reevaluated="failed"]'));
  await expect(failed).toHaveCount(1);
  await expect(failed.getByTestId("row-reevaluated")).toHaveText("sin reevaluar");
});

test("la reevaluación no pisa una fila que cambió después de empezar", async ({ page }) => {
  const first = gate();
  let armed = false;
  await page.route(`${API_ORIGIN}/evaluate`, async (route) => {
    if (armed) {
      armed = false;
      await first.wait;
    }
    await route.continue();
  });
  const tap = (customer: number) => page.locator(`[data-testid="stop"][data-customer="${customer}"]`).dispatchEvent("click");
  const manual = rows(page).and(page.locator('[data-origin="manual"]'));
  const evaluating = page.getByTestId("manual-status");

  await page.locator('[data-testid="live-action"][data-live="ruta"]').click();
  await expect(page.getByTestId("manual-panel")).toHaveAttribute("data-active", "true");
  await tap(1);
  await tap(2);
  await expect(page.getByTestId("manual-route")).toHaveText(/F1: 1 → 2$/);
  await expect(manual).toHaveCount(1);
  await expect(evaluating).not.toContainText("Evaluando");
  await expect(page.getByTestId("detail-stop")).toHaveCount(2);

  // La foto lleva la ruta a mano [1, 2]; la primera reevaluación espera.
  await page.locator("#live-tab-resolver").click();
  armed = true;
  await peak(page).click();
  await expect(page.getByTestId("traffic-progress")).toBeVisible();

  // Mientras tanto, la ruta a mano vuelve a [1] y se evalúa.
  await page.locator("#live-tab-ruta").click();
  await page.getByTestId("manual-undo").click();
  await expect(page.getByTestId("manual-route")).toHaveText(/F1: 1$/);
  await expect(evaluating).not.toContainText("Evaluando");
  await expect(page.getByTestId("detail-stop")).toHaveCount(1);

  first.open();
  await page.locator("#live-tab-resolver").click();
  await expect(page.getByTestId("traffic-progress")).toBeHidden({ timeout: 30_000 });
  await expect(rows(page).and(page.locator('[data-reevaluated="true"]'))).toHaveCount(4);
  await expect(manual).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("detail-stop")).toHaveCount(1);
});
