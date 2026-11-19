import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { formatTime } from "../lib/format";
import { MAX_HEIGHT, blockService, expectNoHorizontalOverflow, pageHeight, stubMapStyle } from "./helpers";

// Mapa de rutas sobre la portada. Sin red: estilo vacío, teselas abortadas y servicio apagado.

type Stop = { customer: number; arrival: number; late: number };
type Evaluation = { vehicles_used: number; stops: Stop[][]; depot_arrival?: number[] | null };
type Run = { run_id: string; method: string; evaluation: Evaluation | null };
type CaseFile = { instance: { depot: { ready: number }; customers: unknown[] }; runs: Run[] };

const DATA = path.join(__dirname, "..", "public", "data", "cases");
const readCase = (id: string): CaseFile => JSON.parse(readFileSync(path.join(DATA, `${id}.json`), "utf8"));
const heuristic = (id: string) => readCase(id).runs.find((r) => r.method === "heuristic")!;

const map = (page: Page) => page.getByTestId("route-map");
const lines = (page: Page) => page.getByTestId("route-line");
const stops = (page: Page) => page.getByTestId("stop");

async function openCase(page: Page, id: string): Promise<void> {
  const card = page.locator(`[data-testid="example-card"][data-case-id="${id}"]`);
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(stops(page)).toHaveCount(readCase(id).instance.customers.length);
}

/** Abre la ayuda «?» del coste en la comparativa y devuelve su globo. */
async function costHelp(page: Page) {
  await page.getByTestId("comparison").locator('[data-testid="help-button"][data-help="coste"]').click();
  return page.getByTestId("help-popover");
}

async function selectRun(page: Page, runId: string): Promise<void> {
  await page.locator(`[data-testid="comparison-row"][data-run-id="${runId}"] > button`).click();
}

/** El mapa ha terminado su vuelo inicial (en plano, siempre). */
const settled = (page: Page) => expect(map(page)).toHaveAttribute("data-ready", "true", { timeout: 15_000 });

/** Lleva el reloj a la hora `t` con el deslizador de la barra de reproducción. */
async function seek(page: Page, t: number): Promise<void> {
  await page.getByTestId("scrubber").fill(String(t));
}

const states = (page: Page, state: string) => page.locator(`[data-testid="stop"][data-state="${state}"]`);

/** Primer cliente cuyo centro no tapa otra parada (en el centro de Madrid se solapan). */
async function freeStop(page: Page): Promise<number> {
  await settled(page);
  const id = await page.evaluate(() => {
    // En móvil, elegir una fila de la comparativa desplaza la página: el mapa ha de estar a la vista.
    document.querySelector('[data-testid="route-map"]')?.scrollIntoView({ block: "center" });
    for (const el of document.querySelectorAll('[data-testid="stop"]')) {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (hit?.closest('[data-testid="stop"]') === el) return Number(el.getAttribute("data-customer"));
    }
    return null;
  });
  expect(id).not.toBeNull();
  return id!;
}

const minHitSize = (page: Page) =>
  page.evaluate(() =>
    Math.min(
      ...[...document.querySelectorAll('[data-testid="stop"]')].map((el) => {
        const r = el.getBoundingClientRect();
        return Math.min(r.width, r.height);
      }),
    ),
  );

const CASES = ["madrid-12", "madrid-25", "tfe2024-10c-1", "c101-25-trunc", "r101-100-trunc"];

/**
 * Paradas, depósito y chips de leyenda fuera del rectángulo visible del mapa: la
 * caja de dibujo recortada por el contenedor que le da la portada.
 */
const outside = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const root = document.querySelector('[data-testid="route-map"]')!;
    const box = document.querySelector('[data-testid="map-box"]')!.getBoundingClientRect();
    const clip = root.parentElement!.getBoundingClientRect();
    const area = sel.includes("legend") ? root.getBoundingClientRect() : box;
    const v = {
      left: Math.max(area.left, clip.left),
      right: Math.min(area.right, clip.right),
      top: Math.max(area.top, clip.top),
      bottom: Math.min(area.bottom, clip.bottom),
    };
    return [...document.querySelectorAll(sel)]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        return b.left < v.left - 1 || b.right > v.right + 1 || b.top < v.top - 1 || b.bottom > v.bottom + 1;
      })
      .map((el) => el.getAttribute("data-customer") ?? el.getAttribute("data-route") ?? el.getAttribute("data-testid"));
  }, selector);

const NODES = '[data-testid="stop"], [data-testid="depot"]';

async function expectFramed(page: Page, id: string): Promise<void> {
  await expect(stops(page)).toHaveCount(readCase(id).instance.customers.length);
  // El encuadre final llega al acabar el vuelo inicial (3,2 s tras cargar el estilo): con la
  // máquina cargada, medir durante el vuelo con la espera de 5 s de `poll` fallaba a veces.
  await settled(page);
  await expect.poll(() => outside(page, NODES), { message: `${id}: nodos fuera del mapa` }).toEqual([]);
}

/** La leyenda no se sale: o cabe entera o se desplaza y el último chip se alcanza dentro del mapa. */
async function expectLegendReachable(page: Page, id: string): Promise<void> {
  const scroller = page.getByTestId("legend-scroll");
  const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  if (scrollWidth <= clientWidth) {
    expect(await outside(page, '[data-testid="legend-route"]'), id).toEqual([]);
    return;
  }
  await page.getByTestId("legend-route").last().scrollIntoViewIfNeeded();
  await expect
    .poll(() => outside(page, '[data-testid="legend-route"]:last-of-type'), { message: `${id}: último chip` })
    .toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await blockService(page);
});

test.describe("encuadre y leyenda en cada caso", () => {
  // Cada caso espera su vuelo inicial (3,2 s): ocho casos seguidos no caben en los 30 s por defecto.
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await stubMapStyle(page);
  });

  test("llegando directamente a cada caso, todo queda dentro del mapa", async ({ page }) => {
    for (const id of CASES) {
      await page.goto("/");
      await openCase(page, id);
      await expectFramed(page, id);
      await expectLegendReachable(page, id);
    }
  });

  test("tras pasar por los otros casos (con zoom), el encuadre se recalcula", async ({ page }) => {
    await page.goto("/");
    // Pasa de mapa a plano y viceversa, y vuelve a R101 tras ampliarlo y salir a un caso de mapa.
    const order = [
      "madrid-12",
      "tfe2024-10c-1",
      "r101-100-trunc",
      "madrid-25",
      "r101-100-trunc",
      "c101-25-trunc",
      "madrid-12",
      "tfe2024-10c-1",
    ];
    for (const id of order) {
      await openCase(page, id);
      await expectFramed(page, id);
      await expectLegendReachable(page, id);
      // Zoom antes de salir: no debe heredarlo el caso siguiente.
      await page.getByRole("button", { name: "Acercar" }).click();
    }
  });
});

test.describe("con el estilo sustituido", () => {
  test.beforeEach(async ({ page }) => {
    await stubMapStyle(page);
    await page.goto("/");
    await expect(map(page)).toHaveAttribute("data-mode", "map");
  });

  test("madrid-12 con la heurística: una ruta por vehículo usado, 12 paradas y la atribución", async ({ page }) => {
    const run = heuristic("madrid-12");
    await selectRun(page, run.run_id);
    // En modo mapa las líneas son capas de MapLibre: el número de rutas va en un atributo.
    await expect(map(page)).toHaveAttribute("data-mode", "map");
    await expect(map(page)).toHaveAttribute("data-routes", String(run.evaluation!.vehicles_used));
    await expect(page.getByTestId("van")).toHaveCount(run.evaluation!.vehicles_used);
    await expect(stops(page)).toHaveCount(12);
    await expect(page.getByTestId("depot")).toBeVisible();
    const attribution = page.getByTestId("map-attribution");
    await expect(attribution).toBeVisible();
    await expect(attribution.getByRole("link", { name: "OpenStreetMap" })).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/copyright",
    );
    await expect(attribution.getByRole("link", { name: "OpenMapTiles" })).toHaveAttribute("href", "https://www.openmaptiles.org/");
    await expect(attribution.getByRole("link", { name: "OpenFreeMap" })).toHaveAttribute("href", "https://openfreemap.org/");
    // Sin el control de atribución de MapLibre: la línea propia es la única.
    await expect(page.locator(".maplibregl-ctrl-attrib")).toHaveCount(0);
    // La nota de los tramos rectos no tapa el mapa: va en la ayuda del coste de la comparativa.
    await expect(page.getByTestId("route-legend")).not.toContainText("Tramos");
    await expect(await costHelp(page)).toContainText("Tramos rectos; la distancia es por carretera");
  });

  test("pulsar una parada abre su ficha con la llegada en HH:MM del JSON", async ({ page }) => {
    const run = heuristic("madrid-12");
    await selectRun(page, run.run_id);
    await expect(map(page)).toHaveAttribute("data-routes", String(run.evaluation!.vehicles_used));
    const customer = await freeStop(page);
    await page.locator(`[data-testid="stop"][data-customer="${customer}"]`).click();
    const expected = run.evaluation!.stops.flat().find((s) => s.customer === customer)!;
    const card = page.getByTestId("stop-card");
    await expect(card).toContainText(`Cliente ${customer}`);
    await expect(card.getByTestId("stop-card-arrival")).toHaveText(formatTime(expected.arrival));
    await page.getByRole("button", { name: "Cerrar ficha" }).click();
    await expect(card).toHaveCount(0);
  });

  test("elegir un vehículo en la leyenda cambia la ruta seleccionada del detalle", async ({ page }) => {
    await selectRun(page, heuristic("madrid-12").run_id);
    const chip = page.locator('[data-testid="legend-route"][data-route="1"]');
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("detail")).toHaveAttribute("data-selected-route", "1");
    await page.locator('[data-testid="legend-route"][data-route="0"]').click();
    await expect(page.getByTestId("detail")).toHaveAttribute("data-selected-route", "0");
  });

  test("tfe2024-10c-1 y r101-100-trunc se dibujan en plano, sin atribución", async ({ page }) => {
    for (const [id, n] of [["tfe2024-10c-1", 10], ["r101-100-trunc", 100]] as const) {
      await openCase(page, id);
      const run = heuristic(id);
      await selectRun(page, run.run_id);
      await expect(map(page)).toHaveAttribute("data-mode", "plane");
      await expect(map(page)).toHaveAttribute("data-routes", String(run.evaluation!.vehicles_used));
      await expect(stops(page)).toHaveCount(n);
      await expect(page.getByTestId("map-attribution")).toHaveCount(0);
      await expect(lines(page)).toHaveCount(run.evaluation!.vehicles_used);
      await expect(lines(page).first()).toBeVisible();
    }
  });

  test("zona pulsable de 24 px o más; en r101-100-trunc se llega ampliando", async ({ page }) => {
    for (const id of ["madrid-12", "madrid-25", "tfe2024-10c-1", "c101-25-trunc"]) {
      await openCase(page, id);
      expect(await minHitSize(page), id).toBeGreaterThanOrEqual(24);
    }
    await openCase(page, "r101-100-trunc");
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Acercar" }).click();
    expect(await minHitSize(page)).toBeGreaterThanOrEqual(24);
  });

  test("altura dentro del presupuesto y sin desbordamiento, también con la ficha abierta", async ({ page }) => {
    await expect(stops(page)).toHaveCount(12);
    await page.locator(`[data-testid="stop"][data-customer="${await freeStop(page)}"]`).click();
    await expect(page.getByTestId("stop-card")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const width = page.viewportSize()!.width;
    expect(await pageHeight(page)).toBeLessThanOrEqual(MAX_HEIGHT[width]);
    await openCase(page, "r101-100-trunc");
    await expectNoHorizontalOverflow(page);
    expect(await pageHeight(page)).toBeLessThanOrEqual(MAX_HEIGHT[width]);
  });

  test("a una hora intermedia hay paradas atendidas y otras pendientes", async ({ page }) => {
    const run = heuristic("madrid-12");
    await selectRun(page, run.run_id);
    await expect(stops(page)).toHaveCount(12);
    await expect(states(page, "pend")).toHaveCount(12);
    const start = readCase("madrid-12").instance.depot.ready;
    const end = Math.max(...run.evaluation!.depot_arrival!);
    await seek(page, Math.round((start + end) / 2));
    await expect(states(page, "done").first()).toBeAttached();
    await expect(states(page, "pend").first()).toBeAttached();
    // Las furgonetas en ruta se ven; al volver al inicio, todas las paradas quedan pendientes.
    await expect(page.locator('[data-testid="van"][data-on]').first()).toBeVisible();
    await seek(page, start);
    await expect(states(page, "pend")).toHaveCount(12);
  });

  test("en el plan con retraso de tfe2024-10c-1 hay paradas en estado late", async ({ page }) => {
    await openCase(page, "tfe2024-10c-1");
    const run = readCase("tfe2024-10c-1").runs.find((r) => r.evaluation?.stops.flat().some((s) => s.late > 0))!;
    const late = run.evaluation!.stops.flat().filter((s) => s.late > 0).length;
    await selectRun(page, run.run_id);
    await expect(map(page)).toHaveAttribute("data-routes", String(run.evaluation!.vehicles_used));
    // Forma además de color: las paradas con retraso llevan su marca desde el principio.
    await expect(page.locator('[data-testid="stop"][data-late]')).toHaveCount(late);
    await expect(page.getByTestId("route-legend")).toContainText("Con retraso");
    const max = await page.getByTestId("scrubber").getAttribute("max");
    await seek(page, Number(max));
    await expect(states(page, "late")).toHaveCount(late);
  });

  test("pausar el movimiento detiene el bucle de fotogramas", async ({ page }) => {
    await settled(page);
    const frames = async () => Number(await map(page).getAttribute("data-frames"));
    await expect(map(page)).toHaveAttribute("data-motion", "on");
    const before = await frames();
    await expect.poll(frames).toBeGreaterThan(before);
    const toggle = page.getByTestId("motion-toggle");
    // Interruptor, no un segundo «play»: nombre fijo, estado en `aria-checked` y sin los iconos de reproducir o pausar.
    await expect(toggle).toHaveRole("switch");
    await expect(toggle).toHaveAccessibleName("Animación");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    if (page.viewportSize()!.width >= 761) await expect(toggle).toHaveText("Animación: sí");
    await toggle.click();
    await expect(map(page)).toHaveAttribute("data-motion", "off");
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    if (page.viewportSize()!.width >= 761) await expect(toggle).toHaveText("Animación: no");
    const paused = await frames();
    await page.waitForTimeout(400);
    expect(await frames()).toBe(paused);
    await toggle.click();
    await expect(map(page)).toHaveAttribute("data-motion", "on");
    await expect.poll(frames).toBeGreaterThan(paused);
    // Recentrar sigue disponible y no saca ninguna parada del mapa.
    await page.getByTestId("recenter").click();
    await expectFramed(page, "madrid-12");
  });
});

test("la ayuda del coste dice cómo se dibujan los tramos solo en los casos con mapa", async ({ page }) => {
  await stubMapStyle(page);
  await page.goto("/");
  await expect(await costHelp(page)).toContainText("Tramos rectos; la distancia es por carretera");
  await page.keyboard.press("Escape");
  await openCase(page, "c101-25-trunc");
  await expect(await costHelp(page)).not.toContainText("Tramos");
});

/** Pares de piezas del mapa cuyas cajas se cruzan. */
const overlaps = (page: Page, pairs: [string, string][]) =>
  page.evaluate((list) => {
    const box = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
    return list
      .filter(([a, b]) => {
        const [p, q] = [box(a), box(b)];
        return !!p && !!q && p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom;
      })
      .map(([a, b]) => `${a} / ${b}`);
  }, pairs);

const BOTTOM_PIECES: [string, string][] = [
  ["depot", "radio-line"],
  ["depot", "map-attribution"],
  ["radio-line", "map-attribution"],
];

test("la base, la línea de estado y la atribución no se pisan, tampoco con el panel en vivo abierto", async ({ page }) => {
  await stubMapStyle(page);
  await page.goto("/");
  await expect(stops(page)).toHaveCount(12);
  await settled(page);
  await expect(page.getByTestId("radio-line")).toBeVisible();
  await expect.poll(() => overlaps(page, BOTTOM_PIECES)).toEqual([]);
  // Con el panel abierto el mapa se estrecha y se reencuadra.
  await page.getByTestId("live-action").first().click();
  await expect(page.getByTestId("live-panel")).toBeVisible();
  await map(page).scrollIntoViewIfNeeded();
  await expect(page.getByTestId("depot")).toBeVisible();
  await expect(page.getByTestId("map-attribution")).toBeVisible();
  await expect.poll(() => overlaps(page, BOTTOM_PIECES)).toEqual([]);
  await expectFramed(page, "madrid-12");
  expect(await outside(page, '[data-testid="map-attribution"]')).toEqual([]);
});

test("con movimiento reducido el mapa arranca en pausa", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubMapStyle(page);
  await page.goto("/");
  await expect(stops(page)).toHaveCount(12);
  await expect(map(page)).toHaveAttribute("data-motion", "off");
  await expect(page.getByTestId("motion-toggle")).toHaveAttribute("aria-checked", "false");
  await settled(page);
  expect(Number(await map(page).getAttribute("data-frames"))).toBe(0);
});

test("con movimiento reducido, las flechas de la leyenda desplazan sin animación", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const seen: (ScrollToOptions | undefined)[] = [];
    Object.assign(window, { __scrollBy: seen });
    const original = Element.prototype.scrollBy as (this: Element, options?: ScrollToOptions) => void;
    Element.prototype.scrollBy = function (this: Element, options?: ScrollToOptions) {
      seen.push(options);
      original.call(this, options);
    } as typeof Element.prototype.scrollBy;
  });
  await stubMapStyle(page);
  await page.goto("/");
  await openCase(page, "r101-100-trunc");
  const more = page.getByRole("button", { name: "Más furgonetas" });
  await expect(more).toBeVisible();
  await more.click();
  const behaviors = await page.evaluate(() =>
    (window as unknown as { __scrollBy: (ScrollToOptions | undefined)[] }).__scrollBy.map((o) => o?.behavior ?? "auto"),
  );
  expect(behaviors.length).toBeGreaterThan(0);
  expect(behaviors).not.toContain("smooth");
});

test("ningún error en consola al recorrer los casos", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // El servicio está apagado a propósito: sus peticiones fallidas no cuentan.
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(message.text());
  });
  await stubMapStyle(page);
  await page.goto("/");
  for (const id of ["madrid-12", "tfe2024-10c-1", "madrid-25", "r101-100-trunc"]) {
    await openCase(page, id);
    await settled(page);
  }
  expect(errors).toEqual([]);
});

test("con el estilo abortado, madrid-12 cae al plano con aviso y sus 12 paradas", async ({ page }) => {
  await page.route("**://tiles.openfreemap.org/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByTestId("map-notice")).toBeVisible();
  await expect(map(page)).toHaveAttribute("data-mode", "plane");
  await expect(lines(page).first()).toBeVisible();
  await expect(stops(page)).toHaveCount(12);
  await expect(page.getByTestId("map-attribution")).toBeVisible();
});

test("sin WebGL, las rutas se dibujan en el plano con el aviso", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "webgl2" || type === "webgl") return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await stubMapStyle(page);
  await page.goto("/");
  await expect(map(page)).toHaveAttribute("data-mode", "plane");
  await expect(page.getByTestId("map-notice")).toBeVisible();
  await expect(lines(page).first()).toBeVisible();
  await expect(stops(page)).toHaveCount(12);
});

test("en el plano no queda franja vacía bajo la línea de estado (sin atribución que reservar)", async ({ page }) => {
  await stubMapStyle(page);
  await page.goto("/");
  await openCase(page, "tfe2024-10c-1");
  await settled(page);
  await expect(page.getByTestId("map-attribution")).toHaveCount(0);
  const gap = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="map-box"]')!.getBoundingClientRect();
    const line = document.querySelector('[data-testid="radio-line"]')!.getBoundingClientRect();
    return box.bottom - line.bottom;
  });
  expect(gap).toBeLessThanOrEqual(24);
  // Con mapa, el borde inferior sigue reservado a la nota y la atribución: no se pisan (prueba de arriba).
});

test("madrid-12: la base queda con margen del borde y ninguna parada ni furgoneta la tapa", async ({ page }) => {
  await stubMapStyle(page);
  await page.goto("/");
  await expect(stops(page)).toHaveCount(12);
  await settled(page);
  const m = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="map-box"]')!.getBoundingClientRect();
    const d = document.querySelector('[data-testid="depot"]')!.getBoundingClientRect();
    const hit = (r: DOMRect, el: Element) => {
      const b = el.getBoundingClientRect();
      return r.left < b.right && b.left < r.right && r.top < b.bottom && b.top < r.bottom;
    };
    const covering = [...document.querySelectorAll('[data-testid="stop"], [data-testid="van"][data-on]')].filter((el) => hit(d, el)).length;
    return { left: d.left - box.left, right: box.right - d.right, covering };
  });
  expect(m.left).toBeGreaterThanOrEqual(24);
  expect(m.right).toBeGreaterThanOrEqual(24);
  expect(m.covering).toBe(0);
  // Las cabezas de las estelas en reposo recorren las rutas: ninguna visible queda sobre la base.
  for (let i = 0; i < 8; i++) {
    const over = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="depot"]')!.getBoundingClientRect();
      return [...document.querySelectorAll('[data-testid="head"]')].filter((el) => {
        const r = el.getBoundingClientRect();
        const [x, y] = [r.x + r.width / 2, r.y + r.height / 2];
        return Number(getComputedStyle(el).opacity) > 0.5 && x > d.left && x < d.right && y > d.top && y < d.bottom;
      }).length;
    });
    expect(over).toBe(0);
    await page.waitForTimeout(250);
  }
});
