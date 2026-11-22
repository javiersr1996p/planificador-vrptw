import path from "node:path";
import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  LEARN_SCENE_HEIGHT,
  blockService,
  expectBodyText16,
  expectNoHorizontalOverflow,
  pageHeight,
  spanishLeaks,
  stubMapStyle,
} from "./helpers";

// «Aprende» y el recorrido guiado en inglés: sin español visible, sin desbordamiento, dentro de la
// altura de cada escena y con texto de cuerpo de 16 px o más. Con LANG_SHOTS=<carpeta> guarda capturas.

const SHOTS = process.env.LANG_SHOTS;
const GROUP = "Idioma · Language";

// Nombres de modelos y el nombre del caso (dato de la instancia): no se traducen.
const ALLOW = [/[a-z]+-(?:haiku|sonnet|opus)-[\w.-]+/g, /run_id/g, /\d+-\d+-[\w-]+/g];

const scene = (page: Page) => page.getByTestId("learn-scene").filter({ visible: true });

async function goToScene(page: Page, n: number): Promise<void> {
  await page.getByTestId("learn-dot").nth(n - 1).click();
  await expect(scene(page)).toHaveAttribute("data-scene", String(n));
}

/** Textos que no salen en `innerText` (aria-label, title, valuetext y `<title>` de SVG) como líneas visibles de una sonda. */
async function attributeLeaks(page: Page, scope: string): Promise<string[]> {
  await page.evaluate((selector) => {
    document.getElementById("attr-probe")?.remove();
    const lines: string[] = [];
    for (const root of Array.from(document.querySelectorAll(selector))) {
      for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
        if (el.closest("[hidden], [inert]")) continue;
        for (const name of ["aria-label", "title", "aria-valuetext"]) {
          const value = el.getAttribute(name);
          if (value) lines.push(value);
        }
      }
    }
    const probe = document.createElement("div");
    probe.id = "attr-probe";
    probe.style.cssText = "position:absolute;left:-9999px;top:0;width:600px";
    for (const line of lines) {
      const p = document.createElement("p");
      p.textContent = line;
      probe.appendChild(p);
    }
    document.body.appendChild(probe);
  }, scope);
  const leaks = await spanishLeaks(page, { scope: "#attr-probe", allow: ALLOW });
  await page.evaluate(() => document.getElementById("attr-probe")?.remove());
  return leaks;
}

async function expectEnglish(page: Page, scope: string, what: string): Promise<void> {
  expect(await spanishLeaks(page, { scope, allow: ALLOW }), `español visible en ${what}`).toEqual([]);
  expect(await attributeLeaks(page, scope), `español en atributos de ${what}`).toEqual([]);
}

/** Pulsa los controles de la escena para sacar todos sus textos y estados. */
async function exercise(page: Page, n: number): Promise<void> {
  const s = scene(page);
  if (n === 1) {
    // Primera furgoneta con A y B, segunda con el resto: pasa por «faltan» y por «plan completo».
    for (const [i, id] of ["A", "B", "C", "D", "E", "F"].entries()) {
      if (i === 2) await s.getByTestId("toy-van").nth(1).click();
      await s.locator(`[data-testid="toy-client"][data-client="${id}"]`).click();
      await expectEnglish(page, '[data-testid="learn-story"]', `escena 1 tras ${id}`);
    }
  }
  if (n === 2) {
    for (const minutes of ["480", "600", "780"]) {
      await s.getByTestId("window-slider").fill(minutes);
      await expectEnglish(page, '[data-testid="learn-story"]', `escena 2 a ${minutes}`);
    }
  }
  if (n === 3) {
    for (const id of ["A", "B", "C", "D", "E", "F"]) {
      await s.locator(`[data-testid="toy-order"][data-client="${id}"]`).click();
      await expectEnglish(page, '[data-testid="learn-story"]', `escena 3 tras ${id}`);
    }
    await s.getByRole("button", { name: "Empty" }).click();
  }
  if (n === 4) {
    for (const i of [1, 2, 0]) {
      await s.getByTestId("toy-plan").nth(i).click();
      await expectEnglish(page, '[data-testid="learn-story"]', `escena 4, plan ${i + 1}`);
    }
  }
  if (n === 5) {
    for (const [i, button] of (await s.getByTestId("learn-method").all()).entries()) {
      await button.click();
      await expectEnglish(page, '[data-testid="learn-story"]', `escena 5, método ${i + 1}`);
    }
  }
  if (n === 6) {
    for (const [i, button] of (await s.getByTestId("learn-llm-run").all()).entries()) {
      await button.click();
      await expectEnglish(page, '[data-testid="learn-story"]', `escena 6, ejecución ${i + 1}`);
    }
  }
}

test.describe("Aprende en inglés", () => {
  test.beforeEach(async ({ page }) => {
    await blockService(page);
    await stubMapStyle(page);
  });

  test("cada escena: sin español, sin desbordamiento, dentro de su altura y con texto de 16 px", async ({ page }) => {
    const width = page.viewportSize()!.width;
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    await page.goto("/aprende?lang=en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Routes with time windows, in seven scenes");
    for (let n = 1; n <= 7; n++) {
      if (n > 1) await page.getByTestId("learn-next").click();
      await expect(scene(page)).toHaveAttribute("data-scene", String(n));
      if (n === 5) await expect(scene(page).getByTestId("learn-run-detail")).toBeVisible();
      if (n === 6) await expect(scene(page).getByTestId("learn-llm-detail")).toBeVisible();
      await expectEnglish(page, '[data-testid="learn-story"]', `escena ${n}`);
      if (SHOTS) {
        await page.waitForTimeout(400);
        if (n === 2 || n === 5) await page.screenshot({ path: path.join(SHOTS, `${width}-aprende-${n}.png`), fullPage: true });
      }
      expect(await pageHeight(page), `altura de la escena ${n}`).toBeLessThanOrEqual(LEARN_SCENE_HEIGHT[width]);
      await exercise(page, n);
      // En la escena 6 las ejecuciones largas pasan del techo también en español: solo cuenta la elegida por defecto.
      if (n !== 6) expect(await pageHeight(page), `altura de la escena ${n} tras pulsar`).toBeLessThanOrEqual(LEARN_SCENE_HEIGHT[width]);
      await expectNoHorizontalOverflow(page);
      await expectBodyText16(page);
    }
    // La navegación y los controles comunes también.
    await expect(page.getByRole("navigation", { name: "Scenes" })).toBeVisible();
    await expect(page.getByTestId("learn-restart")).toHaveText("Start over");
    await expect(page.getByTestId("learn-prev")).toHaveText("Previous");
    expect(await page.title()).toBe("Learn: delivery routes with time windows, in seven scenes");
  });

  test("el cambio de idioma en caliente repinta la escena activa y lo dibujado se conserva", async ({ page }) => {
    await page.goto("/aprende");
    await goToScene(page, 3);
    await scene(page).locator('[data-testid="toy-order"][data-client="A"]').click();
    await expect(scene(page).getByTestId("capacity-status")).toHaveText("A entra en la furgoneta 1.");
    await expect(scene(page).getByRole("heading", { level: 2 })).toHaveText("La furgoneta se llena");
    await page.getByRole("group", { name: GROUP }).getByRole("button", { name: "EN" }).click();
    await expect(scene(page).getByRole("heading", { level: 2 })).toHaveText("The van fills up");
    await expect(scene(page).getByTestId("capacity-status")).toHaveText("A goes into van 1.");
    await expect(scene(page).locator('[data-testid="toy-order"][data-client="A"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("learn-next")).toContainText("Next: Cost");
    expect(await page.title()).toContain("Learn:");
    await page.getByRole("group", { name: GROUP }).getByRole("button", { name: "ES" }).click();
    await expect(scene(page).getByTestId("capacity-status")).toHaveText("A entra en la furgoneta 1.");
    await expect(page.getByTestId("learn-next")).toContainText("Siguiente: El coste");
  });
});

test.describe("Recorrido guiado en inglés", () => {
  test.beforeEach(async ({ page }) => {
    await blockService(page);
    await stubMapStyle(page);
    await page.goto("/?lang=en");
    await expect(page.getByTestId("comparison-row")).toHaveCount(4);
    await expect(page.getByTestId("tour-start")).toBeVisible();
  });

  test("cada paso: globo en inglés, dentro de la pantalla, con texto de 16 px y sin desbordar", async ({ page }) => {
    const width = page.viewportSize()!.width;
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    const learn = (await page.getByTestId("learn-card").count()) > 0;
    const steps = learn ? 6 : 5;
    await page.getByTestId("tour-start").click();
    const bubble = page.getByTestId("tour-bubble");
    await expect(bubble).toBeVisible();
    for (let i = 0; i < steps; i++) {
      await expect(page.getByTestId("tour-step")).toHaveText(`${i + 1}/${steps}`);
      await expect(bubble.locator(".kicker")).toHaveText("Guided tour");
      await expect(page.getByTestId("tour-close")).toHaveText("Exit");
      await expect(page.getByTestId("tour-next")).toHaveText(i < steps - 1 ? "Next" : "Finish");
      await expectEnglish(page, '[data-testid="tour-bubble"]', `paso ${i + 1}`);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const b = document.querySelector('[data-testid="tour-bubble"]')!.getBoundingClientRect();
            return b.left >= 0 && b.right <= window.innerWidth && b.top >= 0 && b.bottom <= window.innerHeight;
          }),
        )
        .toBe(true);
      await expectNoHorizontalOverflow(page);
      await expectBodyText16(page, '[data-testid="tour-bubble"]');
      if (SHOTS && (i === 0 || i === 3)) {
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(SHOTS, `${width}-recorrido-${i + 1}.png`) });
      }
      await page.getByTestId("tour-next").click();
    }
    await expect(bubble).toHaveCount(0);
  });

  test("cambiar de idioma con el recorrido abierto repinta el globo", async ({ page }) => {
    await page.goto("/?lang=es");
    await expect(page.getByTestId("comparison-row")).toHaveCount(4);
    await page.getByTestId("tour-start").click();
    await expect(page.getByTestId("tour-text")).toContainText("Cada número es un cliente");
    await page.getByRole("group", { name: GROUP }).getByRole("button", { name: "EN" }).click();
    await expect(page.getByTestId("tour-text")).toContainText("Each number is a customer");
    await expect(page.getByTestId("tour-next")).toHaveText("Next");
    await expect(page.getByTestId("tour-step")).toHaveText(/^1\//);
  });
});
