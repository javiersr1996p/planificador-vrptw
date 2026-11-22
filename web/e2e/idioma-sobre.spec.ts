import { expect, test } from "@playwright/test";
import { expectBodyText16, expectNoHorizontalOverflow, pageHeight, spanishLeaks, stubMapStyle } from "./helpers";

// «Sobre el TFE» en inglés: sin español visible, sin desbordes y sin crecer respecto al español.

// Nombres propios (autores, universidad, título del repositorio) y siglas que no se traducen.
const PROPER_NAMES = [
  "Javier Sánchez Rueda",
  "Óscar Sánchez Rueda",
  "María Teresa García Ordás",
  "Hernán Díaz Rodríguez",
  "Universidad Internacional de La Rioja",
  "UNIR",
];

test.beforeEach(async ({ page }) => {
  await stubMapStyle(page);
});

test("inglés: sin español visible, sin desbordes, sin crecer y con texto de 16 px", async ({ page }) => {
  const width = page.viewportSize()!.width;

  await page.goto("/sobre?lang=es");
  await page.evaluate(() => document.fonts.ready);
  const heightEs = await pageHeight(page);

  await page.goto("/sobre?lang=en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("From the 2024 thesis to this planner");
  await page.evaluate(() => document.fonts.ready);

  expect(await spanishLeaks(page, { allow: PROPER_NAMES })).toEqual([]);
  await expectNoHorizontalOverflow(page);
  await expectBodyText16(page);
  const heightEn = await pageHeight(page);
  console.log(`altura de /sobre a ${width} px: es ${heightEs}, en ${heightEn}`);
  expect(heightEn).toBeLessThanOrEqual(heightEs);

  await expect(page.getByTestId("about-change")).toHaveCount(6);
  await expect(page.getByTestId("about-limit")).toHaveCount(3);
  await expect(page.getByTestId("credit-role")).toHaveText(["Author", "Author", "Supervisor", "Co-supervisor"]);
});

test("inglés: título del documento y presenta una actualización, sin reconocer errores", async ({ page }) => {
  await page.goto("/sobre?lang=en");
  await expect(page).toHaveTitle(/^About the thesis/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /master's thesis/);
  await expect(page.getByRole("main")).not.toContainText(
    /fixed|bug|error|mistake|corrected|correction|erratum|legacy|flaw|did not iterate|did not move/i,
  );
});
