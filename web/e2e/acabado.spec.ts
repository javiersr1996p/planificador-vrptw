import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  LEARN_SCENE_HEIGHT,
  MADRID12_HEIGHT,
  MAX_HEIGHT,
  MOTIONLESS,
  blockService,
  expectBodyText16,
  expectContrastAA,
  expectNoHorizontalOverflow,
  motionLoops,
  pageHeight,
  smallTargets,
  solverTest,
  stubMapStyle,
} from "./helpers";

/*
  Acabado: cada estado principal de la portada y de «Aprende», a 390 y 1440 px, dentro
  de su presupuesto de altura, sin desbordamiento horizontal, con texto de 16 px,
  contraste AA, zonas táctiles de 44 px en móvil y sin errores en consola. Sin red:
  estilo del mapa sustituido siempre y servicio bloqueado salvo donde el estado lo
  necesita. Con ACABADO_SHOTS=<carpeta>, una captura a página completa y la altura y el
  peor contraste de cada estado y tamaño.
*/

test.setTimeout(90_000);

const SHOTS = process.env.ACABADO_SHOTS;
const DATA = path.join(__dirname, "..", "public", "data");
const CASE_IDS: string[] = JSON.parse(readFileSync(path.join(DATA, "index.json"), "utf8")).cases.map((c: { id: string }) => c.id);
const runsOf = (id: string): number => JSON.parse(readFileSync(path.join(DATA, "cases", `${id}.json`), "utf8")).runs.length;

/**
 * Las paradas del mapa miden 30 px; en pantallas táctiles (`pointer: coarse`) su zona
 * pulsable crece a 44 px (map.css). Las pruebas emulan un puntero fino.
 */
const MAP_STOPS = '[data-testid="stop"]';

/** Errores de consola y de página. Los abortos deliberados de `blockService` y `stubMapStyle` no cuentan. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/^Failed to load resource: net::ERR_(CONNECTION_REFUSED|FAILED)\b/.test(m.text())) {
      errors.push(m.text());
    }
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Se mide el estado final: las entradas y transiciones terminan; las animaciones en bucle siguen. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() =>
    document.getAnimations().forEach((a) => {
      if (a.effect?.getComputedTiming().iterations !== Infinity) a.finish();
    }),
  );
}

async function expectFinished(page: Page, state: string, budget: number, errors: string[]): Promise<void> {
  await settle(page);
  const width = page.viewportSize()!.width;
  const height = await pageHeight(page);
  expect(height, `altura de «${state}» a ${width} px`).toBeLessThanOrEqual(budget);
  await expectNoHorizontalOverflow(page);
  await expectBodyText16(page);
  const worst = await expectContrastAA(page);
  if (width < 761) expect(await smallTargets(page, { ignore: MAP_STOPS }), "zonas táctiles de menos de 44 px").toEqual([]);
  expect(errors, "errores en consola").toEqual([]);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${width}-${state}.png`), fullPage: true });
    writeFileSync(path.join(SHOTS, `${width}-${state}.json`), JSON.stringify({ state, width, height, budget, worst }, null, 2));
  }
}

const rows = (page: Page) => page.getByTestId("comparison-row");
const budgetFor = (page: Page) => MAX_HEIGHT[page.viewportSize()!.width];

async function home(page: Page, { service = false } = {}): Promise<string[]> {
  const errors = watchConsole(page);
  await stubMapStyle(page);
  if (!service) await blockService(page);
  await page.goto("/");
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByTestId("service-status")).toHaveAttribute("data-state", service ? "up" : "down");
  return errors;
}

async function openCase(page: Page, id: string): Promise<void> {
  const card = page.locator(`[data-testid="example-card"][data-case-id="${id}"]`);
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await expect(rows(page)).toHaveCount(runsOf(id));
  await expect(page.getByTestId("route-map")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
}

async function openLive(page: Page, tab: "resolver" | "ia" | "caso" | "ruta"): Promise<void> {
  await page.locator(`[data-testid="live-action"][data-live="${tab}"]`).click();
  await expect(page.getByTestId("live-panel")).toBeVisible();
  // En móvil el mapa sube con un desplazamiento suave antes de medir.
  await page.waitForTimeout(600);
}

test.describe("estados de la portada", () => {
  for (const id of CASE_IDS) {
    test(`ejemplo ${id} en reposo`, async ({ page }) => {
      const errors = await home(page);
      await openCase(page, id);
      await expectFinished(page, `ejemplo-${id}`, id === "madrid-12" ? MADRID12_HEIGHT[page.viewportSize()!.width] : budgetFor(page), errors);
    });
  }

  test("reproduciendo el día", async ({ page }) => {
    const errors = await home(page);
    const clock = page.getByTestId("sim-clock");
    const t0 = await clock.textContent();
    await page.getByTestId("play-button").click();
    await expect(clock).not.toHaveText(t0!, { timeout: 10_000 });
    await expectFinished(page, "reproduciendo", MADRID12_HEIGHT[page.viewportSize()!.width], errors);
  });

  test("plan que llega tarde", async ({ page }) => {
    const errors = await home(page);
    await page.getByTestId("show-late").click();
    await expect(page.getByTestId("validity-verdict")).toHaveText("No válido");
    await expect(page.locator('[data-testid="detail-stop"][data-late="true"]').first()).toBeVisible();
    await expectFinished(page, "plan-con-retraso", budgetFor(page), errors);
  });

  solverTest("Resolver con resultados", async ({ page }) => {
    const errors = await home(page, { service: true });
    await openLive(page, "resolver");
    for (const m of ["aco", "ga", "tabu"]) await page.getByTestId(`solve-pick-${m}`).uncheck();
    await page.getByTestId("solve-start").click();
    await expect(page.locator('[data-testid="solve-row"][data-method="heuristic"]')).toHaveAttribute("data-status", "done", {
      timeout: 30_000,
    });
    await expect(rows(page).and(page.locator('[data-origin="en vivo"]'))).toHaveCount(1);
    await expectFinished(page, "resolver-con-resultados", budgetFor(page), errors);
  });

  test("panel de la IA", async ({ page }) => {
    const errors = await home(page, { service: true });
    await openLive(page, "ia");
    await expect(page.getByTestId("llm-model")).toBeEnabled();
    await expectFinished(page, "panel-ia", budgetFor(page), errors);
  });

  test("«Tu caso» con el formulario", async ({ page }) => {
    const errors = await home(page, { service: true });
    await openLive(page, "caso");
    await page.getByTestId("case-mode-form").click();
    await expect(page.getByTestId("case-form")).toBeVisible();
    await expect(page.getByTestId("case-facts")).toBeHidden();
    await expectFinished(page, "tu-caso-formulario", budgetFor(page), errors);
  });

  test("«Tu ruta»: todas las paradas se pueden pulsar", async ({ page }) => {
    const errors = await home(page, { service: true });
    await openLive(page, "ruta");
    await expect(page.getByTestId("manual-panel")).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("route-map")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
    // Ninguna parada queda bajo la hoja inferior (móvil) ni fuera de la ventana.
    const hidden = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="stop"]')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return !hit || hit.closest('[data-testid="live-panel"]') !== null || hit.closest('[data-testid="map-box"]') === null;
        })
        .map((el) => el.getAttribute("data-customer")),
    );
    expect(hidden, "paradas tapadas").toEqual([]);
    await expectFinished(page, "tu-ruta", budgetFor(page), errors);
  });

  test("recorrido guiado, paso a paso", async ({ page }) => {
    const errors = await home(page);
    await page.getByTestId("tour-start").click();
    const steps = 6;
    for (let n = 1; n <= steps; n++) {
      await expect(page.getByTestId("tour-step")).toContainText(String(n));
      await page.waitForTimeout(500);
      await expectFinished(page, `recorrido-paso-${n}`, budgetFor(page), errors);
      if (n < steps) await page.getByTestId("tour-next").click();
    }
  });

  test("sin servicio", async ({ page }) => {
    const errors = await home(page);
    await openLive(page, "resolver");
    await expect(page.getByTestId("classic-panel").getByTestId("service-notice")).toBeVisible();
    await expect(page.getByTestId("solve-start")).toBeDisabled();
    await expectFinished(page, "sin-servicio", budgetFor(page), errors);
  });

  test("comparativa en móvil: tiempo, tokens y coste plegados salvo en la fila elegida", async ({ page }) => {
    test.skip(page.viewportSize()!.width > 760, "solo móvil");
    await home(page);
    await openCase(page, "tfe2024-10c-1");
    const runId = await rows(page)
      .filter({ has: page.getByTestId("row-spend") })
      .and(page.locator(":not([data-selected])"))
      .first()
      .getAttribute("data-run-id");
    const other = page.locator(`[data-testid="comparison-row"][data-run-id="${runId}"]`);
    await expect(other.getByTestId("row-spend")).toBeHidden();
    await expect(other.getByTestId("row-time")).toBeHidden();
    await expect(other.getByTestId("row-spend")).toContainText("tokens");
    await other.getByRole("button").first().click();
    await expect(other).toHaveAttribute("data-selected", "true");
    await expect(other.getByTestId("row-spend")).toBeVisible();
    await expect(other.getByTestId("row-spend")).toContainText("€");
    await expect(other.getByTestId("row-time")).toBeVisible();
    // Las diez filas siguen en la lista, que se desplaza dentro de su panel.
    await expect(rows(page)).toHaveCount(10);
    expect(await pageHeight(page)).toBeLessThanOrEqual(MAX_HEIGHT[390]);
  });
});

test.describe("estados de «Aprende»", () => {
  test("cada escena", async ({ page }) => {
    const errors = watchConsole(page);
    await stubMapStyle(page);
    await blockService(page);
    await page.goto("/aprende");
    for (let n = 1; n <= 7; n++) {
      if (n > 1) await page.getByTestId("learn-next").click();
      const scene = page.getByTestId("learn-scene").filter({ visible: true });
      await expect(scene).toHaveAttribute("data-scene", String(n));
      if (n === 5) await expect(scene.getByTestId("learn-run-detail")).toBeVisible();
      if (n === 6) await expect(scene.getByTestId("learn-llm-detail")).toBeVisible();
      await expectFinished(page, `aprende-escena-${n}`, LEARN_SCENE_HEIGHT[page.viewportSize()!.width], errors);
    }
  });
});

test.describe("movimiento", () => {
  const loops = motionLoops;
  const still = MOTIONLESS;

  test.describe("con movimiento reducido", () => {
    test.use({ reducedMotion: "reduce" });

    test("ninguna animación en bucle en la portada ni en ninguna escena", async ({ page }) => {
      await home(page);
      await openCase(page, "madrid-25");
      expect(await loops(page), "portada").toEqual(still);
      await page.goto("/aprende");
      for (let n = 1; n <= 7; n++) {
        if (n > 1) await page.getByTestId("learn-next").click();
        await expect(page.getByTestId("learn-scene").filter({ visible: true })).toHaveAttribute("data-scene", String(n));
        expect(await loops(page), `escena ${n}`).toEqual(still);
      }
      await page.goto("/pagina-que-no-existe");
      expect(await loops(page), "404").toEqual(still);
    });
  });

  test("«Animación: no» se conserva al ir a «Aprende» y volver", async ({ page }) => {
    await home(page);
    // El vuelo inicial del mapa (3,2 s) no es un bucle: se pausa cuando ha terminado.
    await expect(page.getByTestId("route-map")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
    const toggle = page.getByTestId("motion-toggle");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await page.waitForTimeout(600);
    expect(await loops(page), "portada en pausa").toEqual(still);

    const nav = page.getByTestId("site-header");
    await nav.getByRole("link", { name: "Aprende", exact: true }).click();
    await expect(page.getByTestId("learn-story")).toHaveAttribute("data-motion", "off");
    await expect(page.getByTestId("learn-motion")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("learn-motion")).toHaveRole("switch");
    await expect(page.getByTestId("learn-motion")).toHaveAccessibleName("Animación");
    await page.getByTestId("learn-dot").nth(4).click();
    expect(await loops(page), "escena 5 en pausa").toEqual(still);

    // En móvil el enlace «Planificador» se oculta; la marca lleva a la portada en todos los anchos.
    await page.getByRole("link", { name: "Planificador VRPTW, inicio" }).click();
    await expect(page.getByTestId("motion-toggle").filter({ visible: true })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("route-map").filter({ visible: true })).toHaveAttribute("data-motion", "off");
  });
});

test.describe("teclado", () => {
  test("el tabulador recorre la portada en orden, con el foco siempre a la vista", async ({ page }) => {
    await home(page);
    // Con el mapa listo, sus controles y paradas ya están en el orden de tabulación.
    await expect(page.getByTestId("route-map")).toHaveAttribute("data-ready", "true", { timeout: 15_000 });
    const seen: { top: number; left: number; right: number; name: string }[] = [];
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        // Zona a la que pertenece: dentro del mapa las paradas van por cliente, no de arriba abajo.
        const z = (el.closest('header, [data-testid="map-area"], [data-zone]') ?? el).getBoundingClientRect();
        return {
          top: z.top + window.scrollY,
          left: z.left,
          right: z.right,
          name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30),
          visible: r.width > 0 && r.height > 0,
          ring: st.outlineStyle !== "none" && parseFloat(st.outlineWidth) >= 2,
        };
      });
      expect(info, `paso ${i + 1}: el foco no se pierde`).not.toBeNull();
      expect(info!.visible, `«${info!.name}» a la vista`).toBe(true);
      expect(info!.ring, `«${info!.name}» con anillo de foco`).toBe(true);
      seen.push(info!);
    }
    // De arriba abajo por zonas, columna a columna: solo se vuelve arriba al pasar a una columna a la derecha.
    for (let i = 1; i < seen.length; i++) {
      const [a, b] = [seen[i - 1], seen[i]];
      const inOrder = b.top >= a.top - 120 || b.left >= a.right - 1;
      expect(inOrder, `«${b.name}» tras «${a.name}»`).toBe(true);
    }
  });

  test("el recorrido se abre, avanza y se cierra con el teclado, y el foco vuelve a su botón", async ({ page }) => {
    await home(page);
    const start = page.getByTestId("tour-start");
    await start.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tour")).toBeVisible();
    await expect(page.getByTestId("tour-next")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("tour-step")).toContainText("2");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("tour")).toBeHidden();
    await expect(start).toBeFocused();
  });
});
