import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { formatCost, formatEuro, formatNumber, formatTime } from "../lib/format";
import { methodHint } from "../lib/glossary";
import {
  MADRID12_HEIGHT,
  MAX_HEIGHT,
  blockService,
  expectBodyText16,
  expectNoHorizontalOverflow,
  pageHeight,
  stubMapStyle,
} from "./helpers";

// Los ejemplos se leen de ficheros estáticos: todo funciona con el servicio apagado.

type Stop = { customer: number; arrival: number; wait: number; late: number; load: number };
type Evaluation = {
  score: number;
  distance: number;
  total_wait: number;
  total_late: number;
  vehicles_used: number;
  feasible: boolean;
  stops: Stop[][];
};
type Run = {
  run_id: string;
  method: string;
  role: string;
  parse_status: string;
  model_requested: string | null;
  model_returned: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  api_cost_eur: number | null;
  raw_response: string | null;
  tool_calls: unknown[] | null;
  evaluation: Evaluation | null;
};
type CaseFile = { instance: { source: string; customers: { id: number; address: string | null }[] }; runs: Run[] };

const DATA = path.join(__dirname, "..", "public", "data");
const readCase = (id: string): CaseFile => JSON.parse(readFileSync(path.join(DATA, "cases", `${id}.json`), "utf8"));
const caseIds = (): string[] =>
  JSON.parse(readFileSync(path.join(DATA, "index.json"), "utf8")).cases.map((c: { id: string }) => c.id);

const bestValid = (c: CaseFile) =>
  c.runs.filter((r) => r.evaluation?.feasible).sort((a, b) => a.evaluation!.score - b.evaluation!.score)[0];

const rows = (page: Page) => page.getByTestId("comparison-row");

/** Duración como la muestra la interfaz en casos reales: `0 min`, `36 min`, `13 h 41 min`. */
function span(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Los cuatro indicadores del plan seleccionado: cifra mostrada y valor de la evaluación. */
async function expectKpis(page: Page, ev: Evaluation, real: boolean): Promise<void> {
  const fmt = (v: number) => (real ? span(v) : formatNumber(v, 1));
  const expected: [string, string, number][] = [
    ["kpi-distance", formatNumber(ev.distance, 1), ev.distance],
    ["kpi-vehicles", String(ev.vehicles_used), ev.vehicles_used],
    ["kpi-late", fmt(ev.total_late), ev.total_late],
    ["kpi-wait", fmt(ev.total_wait), ev.total_wait],
  ];
  for (const [id, text, raw] of expected) {
    await expect(page.getByTestId(id)).toHaveText(text);
    await expect(page.getByTestId(id)).toHaveAttribute("data-value", String(raw));
  }
}
const row = (page: Page, runId: string) => page.locator(`[data-testid="comparison-row"][data-run-id="${runId}"]`);

async function openCase(page: Page, id: string, runs: number): Promise<void> {
  const card = page.locator(`[data-testid="example-card"][data-case-id="${id}"]`);
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(runs);
}

test.beforeEach(async ({ page }) => {
  await blockService(page);
  await stubMapStyle(page);
  await page.goto("/");
});

test("el caso por defecto se carga solo con su mejor solución válida seleccionada", async ({ page }) => {
  const madrid = readCase("madrid-12");
  await expect(page.locator('[data-testid="example-card"][data-case-id="madrid-12"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByTestId("detail-run-id")).toHaveText(bestValid(madrid).run_id);
  await expect(page.getByTestId("llm-live-only")).toBeVisible();
});

test("tfe2024-10c-1: diez filas, las no válidas marcadas y al final, y las ilegibles sin barra", async ({ page }) => {
  const tfe = readCase("tfe2024-10c-1");
  await openCase(page, "tfe2024-10c-1", 10);
  await expect(page.getByTestId("llm-live-only")).toHaveCount(0);

  const invalid = rows(page).and(page.locator('[data-invalid="true"]'));
  await expect(invalid).toHaveCount(tfe.runs.filter((r) => r.evaluation && !r.evaluation.feasible).length);
  await expect(invalid.first()).toContainText("No válida");
  await expect(invalid.filter({ hasText: "fuera de ventana" }).first()).toBeVisible();

  const unreadable = rows(page).filter({ hasText: "Sin respuesta legible" });
  await expect(unreadable).toHaveCount(tfe.runs.filter((r) => r.parse_status !== "ok").length);
  await expect(unreadable.first().getByTestId("row-cost")).toHaveCount(0);

  // Orden: válidas, no válidas y sin respuesta, por ese orden.
  const kinds = await rows(page).evaluateAll((els) =>
    els.map((e) => (e.hasAttribute("data-unreadable") ? 2 : e.getAttribute("data-invalid") === "true" ? 1 : 0)),
  );
  expect(kinds).toEqual([...kinds].sort((a, b) => a - b));
});

for (const id of ["madrid-12", "tfe2024-10c-1"]) {
  test(`${id}: las cifras de cada fila coinciden con las del JSON`, async ({ page }) => {
    const data = readCase(id);
    await openCase(page, id, data.runs.length);
    for (const run of data.runs) {
      const r = row(page, run.run_id);
      await expect(r).toHaveCount(1);
      if (run.evaluation) {
        await expect(r.getByTestId("row-cost")).toHaveText(formatCost(run.evaluation.score));
        await expect(r.getByTestId("row-vehicles")).toHaveText(String(run.evaluation.vehicles_used));
      }
      if (run.api_cost_eur != null) await expect(r).toContainText(formatEuro(run.api_cost_eur));
      if (run.tokens_out != null) await expect(r).toContainText(formatNumber(run.tokens_out, 0));
    }
    const pick = data.runs.find((r) => r.evaluation && r.run_id !== bestValid(data).run_id)!;
    await row(page, pick.run_id).getByRole("button").first().click();
    await expect(page.getByTestId("detail-run-id")).toHaveText(pick.run_id);
  });
}

test("seleccionar una fila cambia el detalle, y cada parada muestra llegada, espera y carga", async ({ page }) => {
  const madrid = readCase("madrid-12");
  const heuristic = madrid.runs.find((r) => r.method === "heuristic")!;
  const before = await page.getByTestId("detail-run-id").textContent();
  await row(page, heuristic.run_id).getByRole("button").first().click();
  await expect(page.getByTestId("detail-run-id")).toHaveText(heuristic.run_id);
  expect(before).not.toBe(heuristic.run_id);

  const stops = heuristic.evaluation!.stops;
  await expect(page.getByTestId("detail-lane")).toHaveCount(stops.length);
  await page.getByTestId("detail-lane").first().click();
  await expect(page.getByTestId("detail")).toHaveAttribute("data-selected-route", "0");

  const shown = page.getByTestId("detail-stop");
  await expect(shown).toHaveCount(stops[0].length);
  const first = shown.first();
  await expect(first).toContainText("Llegada");
  await expect(first).toContainText("Espera");
  await expect(first).toContainText("Carga");
  await expect(first.getByTestId("stop-arrival")).toHaveText(formatTime(stops[0][0].arrival));
  await expect(first.getByTestId("stop-load")).toHaveText(new RegExp(`^${stops[0][0].load}\\b`));
  if (stops[0][0].wait > 0) await expect(first.getByTestId("stop-wait")).not.toHaveText("–");

  await page.getByRole("button", { name: "← Todas" }).click();
  await expect(page.getByTestId("detail")).toHaveAttribute("data-selected-route", "all");
});

test("«Llegada · Espera · Carga» se rotula una sola vez y cada parada lleva solo sus cifras, alineadas debajo", async ({ page }) => {
  const header = page.locator('[data-testid="stop-columns"]:visible');
  await expect(header).toHaveCount(1);
  await expect(header).toHaveText(/Llegada.*Espera.*Carga/);
  const first = page.getByTestId("detail-stop").first();
  // Los rótulos de cada fila quedan para los lectores de pantalla, sin ocupar sitio.
  for (const dt of await first.locator("dt").all()) {
    expect(await dt.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  }
  for (const [label, id] of [
    ["Llegada", "stop-arrival"],
    ["Espera", "stop-wait"],
    ["Carga", "stop-load"],
  ]) {
    const h = (await header.getByText(label, { exact: true }).boundingBox())!;
    const v = (await first.getByTestId(id).boundingBox())!;
    expect(Math.abs(h.x - v.x), `«${label}» sobre su cifra`).toBeLessThanOrEqual(1);
  }
  // En escritorio las cifras caben en la misma línea que la pista.
  if (page.viewportSize()!.width >= 761) expect((await first.boundingBox())!.height).toBeLessThanOrEqual(36);
});

test("las paradas con retraso se resaltan en el detalle", async ({ page }) => {
  const tfe = readCase("tfe2024-10c-1");
  const tabu = tfe.runs.find((r) => r.method === "tabu")!;
  const route = tabu.evaluation!.stops.findIndex((s) => s.some((x) => x.late > 0));
  await openCase(page, "tfe2024-10c-1", tfe.runs.length);
  await row(page, tabu.run_id).getByRole("button").first().click();
  await page.getByTestId("detail-lane").nth(route).click();
  const late = tabu.evaluation!.stops[route].filter((s) => s.late > 0).length;
  await expect(page.locator('[data-testid="detail-stop"][data-late="true"]')).toHaveCount(late);
});

test("en móvil, una furgoneta con muchas paradas enseña las seis primeras y pliega el resto", async ({ page }) => {
  const c101 = readCase("c101-25-trunc");
  await openCase(page, "c101-25-trunc", c101.runs.length);
  await expect(page.getByTestId("detail-run-id")).toHaveText(bestValid(c101).run_id);
  const all = page.getByTestId("detail-stop");
  await expect(all.first()).toBeAttached();
  const total = await all.count();
  expect(total, "la furgoneta del detalle tiene más de ocho paradas").toBeGreaterThan(8);
  const visible = page.locator('[data-testid="detail-stop"]:visible');
  const more = page.getByTestId("detail-more");

  if (page.viewportSize()!.width >= 761) {
    await expect(more).toBeHidden();
    await expect(visible).toHaveCount(total);
    return;
  }
  await expect(visible).toHaveCount(6);
  await expect(more).toHaveText(`Ver ${total - 6} paradas más`);
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(visible).toHaveCount(total);
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await more.click();
  await expect(visible).toHaveCount(6);
});

test("la traza del agente está plegada y se abre con el teclado", async ({ page }) => {
  const tfe = readCase("tfe2024-10c-1");
  const agent = tfe.runs.find((r) => r.role === "llm_agent" && r.parse_status === "ok")!;
  await openCase(page, "tfe2024-10c-1", tfe.runs.length);
  const trace = row(page, agent.run_id).getByTestId("agent-trace");
  await expect(trace).toHaveJSProperty("open", false);
  await expect(trace.getByTestId("trace-call").first()).toBeHidden();

  await trace.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(trace).toHaveJSProperty("open", true);
  await expect(trace.getByTestId("trace-call")).toHaveCount(agent.tool_calls!.length);
  await expect(trace.getByTestId("trace-call").first()).toBeVisible();
  await expect(trace.getByTestId("trace-final")).toContainText(agent.raw_response!.slice(0, 40));
  // Este caso no se camufla: no hay aviso de numeración.
  await expect(trace.getByTestId("trace-camouflaged")).toHaveCount(0);
});

test("c101-25-trunc: la traza del agente avisa de que el modelo vio el caso camuflado", async ({ page }) => {
  const c101 = readCase("c101-25-trunc");
  const agent = c101.runs.find((r) => r.role === "llm_agent" && r.parse_status === "ok")!;
  await openCase(page, "c101-25-trunc", c101.runs.length);
  const trace = row(page, agent.run_id).getByTestId("agent-trace");
  await trace.locator("summary").click();
  await expect(trace).toHaveJSProperty("open", true);
  const note = trace.getByTestId("trace-camouflaged");
  await expect(note).toBeVisible();
  await expect(note).toContainText("camuflado");
  await expect(note).toContainText("ya está traducido");
  await expect(trace.getByTestId("trace-final")).toContainText(agent.raw_response!.slice(0, 40));
});

test("si no se puede leer la lista de ejemplos, el velo de carga desaparece y queda el aviso", async ({ page }) => {
  await page.route("**/data/index.json", (route) => route.abort());
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "No se pudo leer la lista de ejemplos." })).toBeVisible();
  await expect(page.getByTestId("map-area").getByText("Cargando el caso")).toHaveCount(0);
});

test("las pestañas del panel en vivo se manejan con el teclado y Escape lo cierra", async ({ page }) => {
  const action = page.locator('[data-testid="live-action"][data-live="resolver"]');
  await action.click();
  await expect(action).toHaveAttribute("aria-expanded", "true");
  const resolver = page.getByRole("tab", { name: "Resolver" });
  await expect(resolver).toHaveAttribute("aria-selected", "true");
  await expect(resolver).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Tu ruta" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(resolver).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Tu caso" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel").getByRole("heading", { name: /Madrid/ })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("live-panel")).toBeHidden();
  await expect(page.locator('[data-testid="live-action"][data-live="caso"]')).toBeFocused();
});

test("con el panel en vivo abierto, el mapa sigue a la vista (y la comparativa, en escritorio)", async ({ page }) => {
  await page.locator('[data-testid="live-action"][data-live="ruta"]').click();
  const panel = page.getByTestId("live-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByRole("tab", { name: "Tu ruta" })).toHaveAttribute("aria-selected", "true");
  const map = page.getByTestId("map-area");
  await expect(map).toBeInViewport({ ratio: 0.3 });
  if (page.viewportSize()!.width >= 1180) {
    // Panel a la izquierda que empuja: no tapa ni el mapa ni la comparativa.
    const m = (await map.boundingBox())!;
    const p = (await panel.boundingBox())!;
    expect(p.x + p.width).toBeLessThanOrEqual(m.x + 1);
    expect(m.width).toBeGreaterThanOrEqual(400);
    await expect(page.getByTestId("comparison")).toBeInViewport({ ratio: 0.5 });
  } else {
    // Hoja inferior: el mapa sube y queda encima, con al menos 200 px a la vista.
    const p = (await panel.boundingBox())!;
    expect(p.y + p.height).toBeGreaterThanOrEqual(page.viewportSize()!.height - 1);
    await expect
      .poll(async () => p.y - Math.max(0, (await map.boundingBox())!.y), { message: "mapa visible sobre la hoja" })
      .toBeGreaterThanOrEqual(200);
  }
  await expectNoHorizontalOverflow(page);
  expect(await pageHeight(page)).toBeLessThanOrEqual(MAX_HEIGHT[page.viewportSize()!.width]);
  await expectBodyText16(page, '[data-testid="live-panel"] [role="tablist"], [data-testid="live-panel"] h2');

  // El mismo botón lo cierra.
  await page.locator('[data-testid="live-action"][data-live="ruta"]').click();
  await expect(panel).toBeHidden();
});

test("con muchos vehículos, las pestañas se desplazan dentro del detalle y el detalle no crece", async ({ page }) => {
  const r101 = readCase("r101-100-trunc");
  const routes = bestValid(r101).evaluation!.stops.length;
  await openCase(page, "r101-100-trunc", r101.runs.length);
  const lanes = page.getByTestId("detail-lane");
  await expect(lanes).toHaveCount(routes);
  const detail = page.getByTestId("detail");
  const d = (await detail.boundingBox())!;

  // Una sola fila de pestañas, que se desplaza en horizontal dentro del detalle.
  const strip = page.getByRole("tablist", { name: "Elige furgoneta" });
  const s = (await strip.boundingBox())!;
  expect(s.height).toBeLessThanOrEqual(64);
  const first = (await lanes.first().boundingBox())!;
  const lastBox = (await lanes.last().boundingBox())!;
  expect(Math.abs(lastBox.y - first.y)).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page);

  const last = lanes.last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  const l = (await last.boundingBox())!;
  expect(l.x).toBeGreaterThanOrEqual(d.x);
  expect(l.x + l.width).toBeLessThanOrEqual(d.x + d.width + 1);
  await last.click();
  await expect(page.getByTestId("detail")).toHaveAttribute("data-selected-route", String(routes - 1));
  await expect(last).toHaveAttribute("aria-selected", "true");
});

test("la cabecera cabe en una sola línea sin perder sus enlaces", async ({ page }) => {
  const title = page.getByRole("link", { name: "Planificador VRPTW, inicio" }).locator("span").first();
  const { height, lineHeight } = await title.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(el).lineHeight),
  }));
  expect(height).toBeLessThanOrEqual(lineHeight + 1);
  const nav = page.getByRole("navigation", { name: "Principal" });
  const width = page.viewportSize()!.width;
  // Por debajo de 768 px la marca lleva a la portada y el enlace «Planificador» se oculta a propósito.
  for (const name of width < 768 ? ["Repositorio"] : ["Planificador", "Repositorio"]) {
    const link = nav.getByRole("link", { name });
    await expect(link).toBeVisible();
    const box = (await link.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
});

test("los cinco casos caben en el presupuesto de altura, sin desbordamiento horizontal", async ({ page }) => {
  const width = page.viewportSize()!.width;
  for (const id of caseIds()) {
    await openCase(page, id, readCase(id).runs.length);
    await expectNoHorizontalOverflow(page);
    expect(await pageHeight(page), `altura de ${id} a ${width} px`).toBeLessThanOrEqual(MAX_HEIGHT[width]);
    await expectBodyText16(page, "[data-zone]");
  }
});

test("madrid-12 cabe en su presupuesto propio y su texto mide 16 px o más", async ({ page }) => {
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByTestId("detail-stop").first()).toBeVisible();
  const width = page.viewportSize()!.width;
  expect(await pageHeight(page), `altura de madrid-12 a ${width} px`).toBeLessThanOrEqual(MADRID12_HEIGHT[width]);
  await expectNoHorizontalOverflow(page);
  await expectBodyText16(page, "[data-zone]");
});

test("titular generado del caso: furgonetas, paradas y ciudad; sin ciudad en los casos sin mapa", async ({ page }) => {
  const hook = page.getByTestId("hook");
  await expect(hook).toHaveText(/^3 furgonetas, 12 paradas por Madrid y cada una con su ventana horaria/);
  await expect(hook.getByTestId("help-button")).toHaveAttribute("data-help", "ventana");
  await openCase(page, "tfe2024-10c-1", readCase("tfe2024-10c-1").runs.length);
  await expect(hook).toHaveText(/^5 furgonetas, 10 paradas y cada una con su ventana horaria/);
});

test("cada fila explica su método y los indicadores siguen al plan seleccionado", async ({ page }) => {
  const tfe = readCase("tfe2024-10c-1");
  await openCase(page, "tfe2024-10c-1", tfe.runs.length);
  for (const run of tfe.runs) {
    const hint = row(page, run.run_id).getByTestId("method-hint");
    await expect(hint).not.toHaveText("");
    await expect(hint).toContainText(methodHint(run.method)!);
    const model = run.model_returned ?? run.model_requested;
    if (run.role !== "classic" && model) await expect(hint).toContainText(model);
  }
  await expectKpis(page, bestValid(tfe).evaluation!, false);
  const tabu = tfe.runs.find((r) => r.method === "tabu")!;
  await row(page, tabu.run_id).getByRole("button").first().click();
  await expectKpis(page, tabu.evaluation!, false);

  const madrid = readCase("madrid-12");
  await openCase(page, "madrid-12", madrid.runs.length);
  await expectKpis(page, bestValid(madrid).evaluation!, true);
  const heuristic = madrid.runs.find((r) => r.method === "heuristic")!;
  await row(page, heuristic.run_id).getByRole("button").first().click();
  await expectKpis(page, heuristic.evaluation!, true);
});

test("«Ver un plan que llega tarde» deja a la vista retrasos y la regla «nadie tarde» incumplida", async ({ page }) => {
  const tfe = readCase("tfe2024-10c-1");
  const tabu = tfe.runs.find((r) => r.method === "tabu")!;
  await expect(page.getByTestId("validity-verdict")).toHaveText("Sí, válido");
  await page.getByTestId("show-late").click();
  await expect(page.locator('[data-testid="example-card"][data-case-id="tfe2024-10c-1"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("detail-run-id")).toHaveText(tabu.run_id);

  const late = page.locator('[data-testid="detail-stop"][data-late="true"]');
  await expect(late.first()).toBeVisible();
  expect(await late.count()).toBeGreaterThanOrEqual(1);
  await expect(late.first().getByTestId("stop-late")).toBeVisible();
  // El retraso ocupa la columna de la espera, en rojo y con su nombre a la vista.
  const named = late.first().getByText("Retraso", { exact: true });
  await expect(named).toBeVisible();
  const espera = (await page.locator('[data-testid="stop-columns"]:visible').getByText("Espera", { exact: true }).boundingBox())!;
  expect(Math.abs((await named.boundingBox())!.x - espera.x)).toBeLessThanOrEqual(1);
  const red = await page.getByTestId("validity-verdict").evaluate((el) => getComputedStyle(el).color);
  expect(await named.evaluate((el) => getComputedStyle(el).color)).toBe(red);

  // Con texto además de color: veredicto, regla incumplida y la violación por su nombre.
  await expect(page.getByTestId("validity-verdict")).toHaveText("No válido");
  const rule = page.locator('[data-testid="validity-check"][data-rule="late"]');
  await expect(rule).toHaveAttribute("data-ok", "false");
  await expect(rule).toContainText("No se cumple");
  await expect(rule).toContainText("fuera de ventana (4)");
  await expect(page.locator('[data-testid="validity-check"][data-rule="served"]')).toHaveAttribute("data-ok", "true");
  // El botón ya no hace falta: el plan a la vista llega tarde.
  await expect(page.getByTestId("show-late")).toHaveCount(0);
});

test("el origen de los datos se abre al pie de «¿Es un plan válido?», plegado de inicio", async ({ page }) => {
  const madrid = JSON.parse(readFileSync(path.join(DATA, "cases", "madrid-12.json"), "utf8"));
  const source = page.getByTestId("validity").getByTestId("case-source");
  await expect(source).toBeVisible();
  await expect(source).not.toHaveAttribute("open");
  await expect(source.getByText(madrid.note)).toBeHidden();
  await source.getByText("Origen de los datos").click();
  await expect(source).toHaveAttribute("open", "");
  await expect(source.getByText(madrid.note)).toBeVisible();
  await expect(source.getByRole("link", { name: "https://www.geoapify.com/" })).toHaveAttribute("rel", "noopener noreferrer");
});

test("la tarjeta «Aprende» de la portada es una sola línea", async ({ page }) => {
  const card = page.getByTestId("learn-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAccessibleName(/Aprende/);
  expect((await card.boundingBox())!.height).toBeLessThanOrEqual(72);
});

test("una fila no válida no se compara con la mejor: nada de «−1303,3», sino «no comparable»", async ({ page }) => {
  await openCase(page, "tfe2024-10c-1", 10);
  const invalid = rows(page).and(page.locator('[data-invalid="true"]'));
  const n = await invalid.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const delta = invalid.nth(i).getByTestId("row-delta");
    await expect(delta).toHaveText(/no comparable/i);
    await expect(delta).not.toHaveText(/[+−-]\d/);
  }
  // Las válidas que no son la mejor siguen mostrando su sobrecoste, nunca negativo.
  const valid = rows(page).and(page.locator(":not([data-invalid]):not([data-unreadable])"));
  const deltas = await valid.getByTestId("row-delta").allTextContents();
  const extra = deltas.filter((t) => /\d/.test(t));
  for (const t of extra) expect(t.trim()).toMatch(/^\+\d/);
});

test("madrid-12 a 1440 px: los cuatro métodos se ven enteros, sin desplazamiento interno", async ({ page }) => {
  test.skip(page.viewportSize()!.width < 1180, "solo escritorio");
  await expect(rows(page)).toHaveCount(4);
  // Las filas entran con una animación de subida: se mide cuando ha terminado.
  const measure = () =>
    page.evaluate(() => {
      const ol = document.querySelector('[data-testid="comparison"] ol')!;
      return {
        overflow: ol.scrollHeight - ol.clientHeight,
        below: ol.lastElementChild!.getBoundingClientRect().bottom - ol.getBoundingClientRect().bottom,
      };
    });
  await expect.poll(async () => (await measure()).overflow).toBeLessThanOrEqual(1);
  expect((await measure()).below).toBeLessThanOrEqual(1);
  expect(await pageHeight(page)).toBeLessThanOrEqual(MADRID12_HEIGHT[1440]);
});
