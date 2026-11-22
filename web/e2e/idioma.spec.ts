import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, stubMapStyle } from "./helpers";

// El motor de idioma (lib/i18n.tsx) y el conmutador de la cabecera. Se prueba en /sobre y en el 404:
// páginas sin mapa ni servicio.

const KEY = "vrptw-lang";
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
  expect(problems.filter((m) => /hydrat|did not match|mismatch/i.test(m))).toEqual([]);
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
