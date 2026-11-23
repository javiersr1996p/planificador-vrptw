import { expect, test, type Page, type Route } from "@playwright/test";
import { API_ORIGIN, blockService, stubMapStyle } from "./helpers";

// El servicio puede estar en un plan gratuito que se duerme: la primera comprobación que agota
// sus 5 s pasa a «despertando» y sigue intentando hasta 90 s; un fallo inmediato es «no disponible».
// El reloj de la página es simulado para no esperar de verdad.

const LANGS = [
  { lang: "es", waking: "Despertando el servicio (en torno a un minuto)…", down: "Servicio no disponible: se muestran los resultados precalculados" },
  { lang: "en", waking: "Waking up the service (about a minute)…", down: "Service unavailable: showing the precomputed results" },
] as const;

const status = (page: Page) => page.getByTestId("service-status");
const notice = (page: Page) => page.getByTestId("classic-panel").getByTestId("service-notice");
const start = (page: Page) => page.getByTestId("solve-start");

/** Deja las peticiones a `/health` sin responder; devuelve las pendientes para contestarlas luego. */
async function holdHealth(page: Page): Promise<Route[]> {
  const held: Route[] = [];
  await page.route(`${API_ORIGIN}/health`, (route) => void held.push(route));
  return held;
}

async function load(page: Page, lang: string): Promise<void> {
  await stubMapStyle(page);
  await page.clock.install();
  await page.goto(`/?lang=${lang}`);
  await expect(page.getByTestId("comparison-row")).toHaveCount(4);
}

async function openPanel(page: Page): Promise<void> {
  await page.locator('[data-testid="live-action"][data-live="resolver"]').click();
  await expect(page.getByTestId("classic-panel")).toBeVisible();
}

/** Adelanta el reloj de la página `ms` en saltos de hasta 10 s, dejando que la página reaccione entre uno y otro. */
async function advance(page: Page, ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 10_000) {
    await page.clock.fastForward(Math.min(left, 10_000));
    await page.waitForTimeout(100);
  }
}

for (const { lang, waking, down } of LANGS) {
  test.describe(`servicio (${lang})`, () => {
    test("tarda más de 5 s y responde: despertando, acciones desactivadas y luego activas", async ({ page }) => {
      const held = await holdHealth(page);
      await load(page, lang);
      await openPanel(page);

      await advance(page, 6000);
      await expect(status(page)).toHaveAttribute("data-state", "waking");
      await expect(status(page)).toContainText(lang === "es" ? "Despertando el servicio" : "Waking up the service");
      await expect(notice(page)).toContainText(waking);
      await expect(page.getByTestId("service-notice-retry")).toHaveCount(0);
      await expect(start(page)).toBeDisabled();
      await expect(start(page)).toHaveAccessibleDescription(waking);
      // Los resultados precalculados siguen a la vista.
      await expect(page.getByTestId("comparison-row")).toHaveCount(4);

      // El servicio despierta: responde a la petición en curso.
      await expect.poll(() => held.length).toBeGreaterThan(1);
      await held[held.length - 1].fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ status: "ok" }),
      });
      await expect(status(page)).toHaveAttribute("data-state", "up");
      await expect(page.getByTestId("service-notice")).toHaveCount(0);
      await expect(start(page)).toBeEnabled();
    });

    test("nunca responde: no disponible al acabar el plazo de 90 s", async ({ page }) => {
      await holdHealth(page);
      await load(page, lang);
      await openPanel(page);

      await advance(page, 6000);
      await expect(status(page)).toHaveAttribute("data-state", "waking");
      await advance(page, 70_000);
      // A los 76 s sigue despertando.
      await expect(status(page)).toHaveAttribute("data-state", "waking");
      await expect(notice(page)).toContainText(waking);

      await advance(page, 20_000);
      await expect(status(page)).toHaveAttribute("data-state", "down");
      await expect(notice(page)).toContainText(down);
      await expect(page.getByTestId("classic-panel").getByTestId("service-notice-retry")).toBeVisible();
      await expect(start(page)).toBeDisabled();
    });

    test("una respuesta 503 mientras despierta cuenta como «aún despertando»", async ({ page }) => {
      let calls = 0;
      await page.route(`${API_ORIGIN}/health`, (route) => {
        calls += 1;
        if (calls === 1) return; // la primera espera se agota
        return route.fulfill({ status: 503, headers: { "access-control-allow-origin": "*" }, body: "" });
      });
      await load(page, lang);
      await advance(page, 6000);
      await expect(status(page)).toHaveAttribute("data-state", "waking");
      await advance(page, 12_000);
      await expect(status(page)).toHaveAttribute("data-state", "waking");
      expect(calls).toBeGreaterThan(2);
    });

    test("fallo inmediato: no disponible sin pasar por el aviso", async ({ page }) => {
      await page.addInitScript(() => {
        const seen: string[] = [];
        (window as unknown as { __states: string[] }).__states = seen;
        new MutationObserver(() => {
          const s = document.querySelector('[data-testid="service-status"]')?.getAttribute("data-state");
          if (s && seen[seen.length - 1] !== s) seen.push(s);
        }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-state"] });
      });
      await blockService(page);
      await stubMapStyle(page);
      await page.goto(`/?lang=${lang}`);
      await expect(page.getByTestId("comparison-row")).toHaveCount(4);
      await expect(status(page)).toHaveAttribute("data-state", "down");
      await openPanel(page);
      await expect(notice(page)).toContainText(down);
      await expect(start(page)).toBeDisabled();
      const states = await page.evaluate(() => (window as unknown as { __states: string[] }).__states);
      expect(states).not.toContain("waking");
    });
  });
}
