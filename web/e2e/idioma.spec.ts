import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ApiError, health, parseCsv } from "../lib/api";
import { formatNumber, formatTime } from "../lib/format";
import { GLOSSARY } from "../lib/glossary";
import { VIOLATION_LABELS, methodLabel } from "../lib/labels";
import { blockService, expectNoHorizontalOverflow, stubMapStyle } from "./helpers";

// El motor de idioma (lib/i18n.tsx) y el conmutador de la cabecera. Se prueba en /sobre y en el 404:
// páginas sin mapa ni servicio.

const KEY = "vrptw-lang";
// En desarrollo, el texto del aviso; en producción, React solo da el código (#418 a #425).
const HYDRATION_ERROR = /hydrat|did not match|mismatch|#41[89]|#42[0-5]/i;
const nav = (page: Page, name: string) => page.getByRole("navigation", { name });

test.beforeEach(async ({ page }) => {
  await stubMapStyle(page);
});

test("por defecto, español: html[lang], cabecera y conmutador", async ({ page }) => {
  await page.goto("/sobre");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(nav(page, "Principal")).toBeVisible();
  await expect(page.getByRole("link", { name: /Aprende/ })).toBeVisible();
  const group = page.getByRole("group", { name: "Idioma · Language" });
  await expect(group.getByRole("button", { name: "ES" })).toHaveAttribute("aria-pressed", "true");
  await expect(group.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "false");
});

test("?lang=en pone inglés y no se guarda", async ({ page }) => {
  await page.goto("/sobre?lang=en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-lang", "en");
  await expect(nav(page, "Main")).toBeVisible();
  await expect(page.getByRole("link", { name: "Learn" })).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
  await page.goto("/sobre");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(nav(page, "Principal")).toBeVisible();
});

test("pulsar EN cambia la cabecera sin recargar y la elección sobrevive a la recarga", async ({ page }) => {
  await page.goto("/sobre");
  await page.evaluate(() => ((window as unknown as { marca: number }).marca = 1));
  const group = page.getByRole("group", { name: "Idioma · Language" });
  await group.getByRole("button", { name: "EN" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(nav(page, "Main")).toBeVisible();
  await expect(group.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
  await expect(group.getByRole("button", { name: "ES" })).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => (window as unknown as { marca?: number }).marca)).toBe(1);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(nav(page, "Main")).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/i18n-pending/);
  await group.getByRole("button", { name: "ES" }).click();
  await expect(nav(page, "Principal")).toBeVisible();
});

test("?lang=es gana a un localStorage en inglés", async ({ page }) => {
  await page.addInitScript((k) => localStorage.setItem(k, "en"), KEY);
  await page.goto("/sobre");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.goto("/sobre?lang=es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(nav(page, "Principal")).toBeVisible();
});

test("el 404 y la marca también cambian de idioma", async ({ page }) => {
  await page.goto("/no-existe?lang=en");
  await expect(page.getByRole("heading", { name: "This route does not exist" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the planner" })).toBeVisible();
  await expect(page.getByRole("link", { name: "VRPTW Planner, home" })).toBeVisible();
  await expect(page).toHaveTitle("Page not found · VRPTW Planner");
});

test("sin errores de hidratación al cargar en inglés", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") problems.push(msg.text());
  });
  page.on("pageerror", (err) => problems.push(err.message));
  await page.goto("/sobre?lang=en");
  await expect(nav(page, "Main")).toBeVisible();
  await page.goto("/no-existe?lang=en");
  await expect(page.getByRole("link", { name: "Back to the planner" })).toBeVisible();
  expect(problems.filter((m) => HYDRATION_ERROR.test(m))).toEqual([]);
});

test("con el JavaScript retrasado, la hidratación no falla ni pierde el inglés", async ({ page }) => {
  // Con el script de idioma dentro de <head>, una hidratación tardía fallaba (#418) y React,
  // al regenerar la raíz, devolvía <html> al español. Debe ir al principio de <body>.
  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(msg.text());
  });
  // Retrasos distintos por fichero: la hidratación empieza tarde y en otro orden.
  await page.route(/\/_next\/static\/.*\.js/, async (route) => {
    await new Promise((r) => setTimeout(r, 300 + Math.floor(Math.random() * 2200)));
    await route.continue().catch(() => {}); // la petición pudo morir con la navegación anterior
  });
  for (let i = 0; i < 6; i++) {
    await page.goto("/sobre?lang=en");
    await expect(nav(page, "Main")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  }
  const parent = await page.evaluate(
    () => [...document.scripts].find((s) => s.textContent?.includes("vrptw-lang"))?.parentElement?.tagName,
  );
  expect(parent).toBe("BODY");
  expect(problems.filter((m) => HYDRATION_ERROR.test(m))).toEqual([]);
});

for (const lang of ["es", "en"]) {
  test(`la cabecera no desborda ni crece con el conmutador (${lang})`, async ({ page }) => {
    await page.goto(`/sobre?lang=${lang}`);
    await expect(page.getByRole("group", { name: "Idioma · Language" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const header = page.getByTestId("site-header");
    const box = await header.boundingBox();
    const expected = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.height = "var(--header-h)";
      document.body.appendChild(probe);
      const h = probe.getBoundingClientRect().height;
      probe.remove();
      return h;
    });
    const width = page.viewportSize()!.width;
    expect(box!.height).toBe(width < 768 ? 58 : expected);
    // Todo lo de la cabecera cabe en ella, a lo ancho y a lo alto.
    const overflow = await header.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll("a, button"))
        .filter((n) => n.getBoundingClientRect().width > 0)
        .filter((n) => {
          const b = n.getBoundingClientRect();
          return b.right > r.right + 0.5 || b.left < r.left - 0.5 || b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5;
        })
        .map((n) => n.textContent);
    });
    expect(overflow).toEqual([]);
    // La marca no se mete bajo la navegación.
    const gap = await header.evaluate((el) => {
      const brand = el.querySelector("a")!;
      const range = document.createRange();
      range.selectNodeContents(brand);
      return el.querySelector("nav")!.getBoundingClientRect().left - range.getBoundingClientRect().right;
    });
    expect(gap).toBeGreaterThanOrEqual(0);
    for (const name of ["ES", "EN"]) {
      const b = await page.getByRole("group", { name: "Idioma · Language" }).getByRole("button", { name }).boundingBox();
      expect(b!.width).toBeGreaterThanOrEqual(44);
      expect(b!.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test("en inglés, de 768 a 1920 px, la marca y el lema no se solapan con la navegación", async ({ page }) => {
  await page.goto("/?lang=en");
  await expect(page.getByTestId("tour-start")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const width of [768, 1024, 1280, 1419, 1420, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const { brandRight, navLeft, navRight } = await page.evaluate(() => {
      const link = document.querySelector('a[aria-label="VRPTW Planner, home"]')!;
      const spans = Array.from(link.querySelectorAll("span"), (s) => s.getBoundingClientRect()).filter((b) => b.width > 1);
      const nav = document.querySelector('nav[aria-label="Main"]')!.getBoundingClientRect();
      return { brandRight: Math.max(...spans.map((b) => b.right)), navLeft: nav.left, navRight: nav.right };
    });
    expect(brandRight, `${width} px`).toBeLessThanOrEqual(navLeft);
    expect(navRight, `${width} px`).toBeLessThanOrEqual(width);
  }
});

// Módulos compartidos: formatos, etiquetas, glosario y errores del servicio, en inglés.

type CaseRun = { method: string; tokens_in: number | null; tokens_out: number | null; evaluation: { score: number; distance: number; feasible: boolean } | null };
const readCase = (id: string): { runs: CaseRun[] } =>
  JSON.parse(readFileSync(path.join(__dirname, "..", "public", "data", "cases", `${id}.json`), "utf8"));

test("en inglés: etiquetas de método y violación, y cifras con punto decimal", async ({ page }) => {
  await blockService(page);
  await page.goto("/?lang=en");
  // El caso por defecto: la distancia del plan seleccionado (la mejor válida) lleva punto decimal y coma de millares.
  const best = readCase("madrid-12").runs.filter((r) => r.evaluation?.feasible).sort((a, b) => a.evaluation!.score - b.evaluation!.score)[0];
  await expect(page.getByTestId("kpi-distance")).toContainText(formatNumber(best.evaluation!.distance, 1, "en"));
  const tfe = readCase("tfe2024-10c-1");
  const card = page.locator('[data-testid="example-card"][data-case-id="tfe2024-10c-1"]');
  await card.click();
  const rows = page.getByTestId("comparison-row");
  await expect(rows).toHaveCount(tfe.runs.length);
  await expect(rows.filter({ hasText: methodLabel("heuristic").en }).first()).toBeVisible();
  await expect(rows.filter({ hasText: VIOLATION_LABELS.late.en }).first()).toBeVisible();
  await expect(rows.filter({ hasText: VIOLATION_LABELS.late.es })).toHaveCount(0);
  // Las cifras de la ficha siguen el idioma: tokens con coma de millares y distancia con punto.
  const llm = readCase("c101-25-trunc").runs.filter((r) => r.tokens_in != null && r.tokens_out != null);
  const tokens = llm.map((r) => `${formatNumber(r.tokens_in!, 0, "en")} / ${formatNumber(r.tokens_out!, 0, "en")} tokens`);
  const c101 = page.locator('[data-testid="example-card"][data-case-id="c101-25-trunc"]');
  await c101.click();
  await expect(c101).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("comparison-row")).toHaveCount(readCase("c101-25-trunc").runs.length);
  const withTokens = page.getByTestId("comparison-row").filter({ hasText: "tokens" }).first();
  const shown = (await withTokens.textContent()) ?? "";
  expect(tokens.some((x) => shown.includes(x))).toBe(true);
  // La hora no cambia con el idioma.
  expect(formatTime(845)).toBe("14:05");
});

test("en inglés: el globo «?» del glosario habla inglés", async ({ page }) => {
  await blockService(page);
  await page.goto("/?lang=en");
  const button = page.locator('[data-testid="help-button"][data-help="valido"]').first();
  await expect(button).toHaveAccessibleName(GLOSSARY.valido.ask.en);
  await button.click();
  const popover = page.getByTestId("help-popover");
  await expect(popover.getByRole("heading")).toHaveText(GLOSSARY.valido.title.en);
  await expect(popover.getByTestId("help-text")).toHaveText(GLOSSARY.valido.text.en);
  await expect(popover.getByRole("button", { name: "Close" })).toBeVisible();
});

test.describe("errores del servicio en inglés", () => {
  const originalFetch = globalThis.fetch;
  test.afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  const stub = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } })) as typeof fetch;
  };
  const failure = async (call: () => Promise<unknown>): Promise<ApiError> => {
    try {
      await call();
    } catch (e) {
      return e as ApiError;
    }
    throw new Error("la llamada debía fallar");
  };

  test("por estado y situación; el español conserva lo que dijo el servicio", async () => {
    stub(401, { detail: "falta la cabecera X-LLM-Key" });
    let err = await failure(() => health());
    expect(err.text).toEqual({ es: "falta la cabecera X-LLM-Key", en: "The API key is missing or was not accepted." });

    stub(503, { detail: "Hay otro cálculo en curso" }, { "Retry-After": "5" });
    err = await failure(() => health());
    expect(err.text.es).toBe("Hay otro cálculo en curso");
    expect(err.text.en).toBe("The service is busy with another calculation. Try again in 5 s.");

    stub(503, { detail: "Geocodificación no disponible: falta configurarla" });
    err = await failure(() => health());
    expect(err.text.en).toBe("Geocoding is not available: it has not been set up.");

    stub(422, { detail: [{ loc: "model", msg: "modelo no disponible" }] });
    err = await failure(() => health());
    expect(err.text).toEqual({ es: "model: modelo no disponible", en: "The request is not valid (model)." });

    stub(500, { detail: "error interno" });
    err = await failure(() => health());
    expect(err.text.en).toBe("Internal error in the service.");
  });

  test("CSV: la intro avisa en inglés de que las filas vienen en español; sin red, el aviso de conexión", async () => {
    stub(422, { detail: [{ row: 2, msg: "falta la dirección" }] });
    let err = await failure(() => parseCsv({ csv: "x", name: "n", fleet: {} as never }));
    expect(err.text.en).toBe("Errors in your CSV (1 row, listed in Spanish)");
    expect(err.rows).toEqual([{ row: 2, msg: "falta la dirección" }]);

    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    err = await failure(() => health());
    expect(err.text).toEqual({ es: "No se pudo contactar con el servicio", en: "Could not reach the service" });
  });
});
