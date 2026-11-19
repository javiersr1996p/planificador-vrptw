import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { REPO_URL } from "../lib/nav";
import {
  MAX_HEIGHT,
  MOTIONLESS,
  expectBodyText16,
  expectContrastAA,
  expectNoHorizontalOverflow,
  motionLoops,
  pageHeight,
  smallTargets,
  stubMapStyle,
} from "./helpers";

// «Sobre el TFE» es estática: sin mapa, sin servicio y sin peticiones fuera del propio origen.

const CODE_2024 = "https://github.com/oscarsr96/tfm_vrptw_osr_jsr";

const CREDITS: [name: string, role: string][] = [
  ["Javier Sánchez Rueda", "Autor"],
  ["Óscar Sánchez Rueda", "Autor"],
  ["María Teresa García Ordás", "Directora"],
  ["Hernán Díaz Rodríguez", "Codirector"],
];

/** Capturas de página completa para la revisión, solo si se pide una carpeta en `ABOUT_SHOTS`. */
const SHOTS = process.env.ABOUT_SHOTS;

test.beforeEach(async ({ page }) => {
  // La portada (desde la que se navega) pinta el mapa.
  await stubMapStyle(page);
});

test("/sobre responde 200 con su propio título", async ({ page }) => {
  const res = await page.goto("/sobre");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/^Sobre el TFE: /);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("about-work")).toContainText(
    "Comparativa de soluciones en problemas VRPTW empleando métodos tradicionales e Inteligencia Artificial Generativa",
  );
});

test("se llega desde la cabecera", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("site-header").getByRole("link", { name: "Sobre el TFE" }).click();
  await expect(page).toHaveURL(/\/sobre$/);
  await expect(page.getByTestId("about-work")).toBeVisible();
});

test("los cuatro nombres se ven con su papel", async ({ page }) => {
  await page.goto("/sobre");
  const credits = page.getByTestId("credit");
  await expect(credits).toHaveCount(CREDITS.length);
  for (const [name, role] of CREDITS) {
    const credit = credits.filter({ hasText: name });
    await expect(credit).toBeVisible();
    await expect(credit.getByTestId("credit-role")).toHaveText(role);
  }
});

test("el código de 2024 y este repositorio se abren en otra pestaña; no hay enlace al PDF", async ({ page }) => {
  await page.goto("/sobre");
  const main = page.getByRole("main");
  const code = main.getByRole("link", { name: /Código de 2024/ });
  await expect(code).toHaveAttribute("href", CODE_2024);
  await expect(code).toHaveAttribute("target", "_blank");
  await expect(code).toHaveAttribute("rel", "noopener noreferrer");
  await expect(code).toContainText("c3ad94c");

  const repo = main.getByRole("link", { name: "Este repositorio" });
  await expect(repo).toHaveAttribute("href", REPO_URL);
  await expect(repo).toHaveAttribute("target", "_blank");
  await expect(repo).toHaveAttribute("rel", "noopener noreferrer");

  await expect(page.locator('a[href$=".pdf" i], a[href*=".pdf?" i]')).toHaveCount(0);
  await expect(main.getByRole("link", { name: /pdf|documento/i })).toHaveCount(0);
});

test("qué ha cambiado y limitaciones: frases cortas", async ({ page }) => {
  await page.goto("/sobre");
  await expect(page.getByTestId("about-change")).toHaveCount(6);
  await expect(page.getByTestId("about-limit")).toHaveCount(4);
  // Ningún párrafo pasa de dos líneas en escritorio (ni de cinco en móvil).
  const maxLines = page.viewportSize()!.width >= 1440 ? 2 : 5;
  const lines = await page.getByRole("main").locator("p").evaluateAll((ps) =>
    ps.map((p) => {
      const lineHeight = parseFloat(getComputedStyle(p).lineHeight);
      return { text: p.textContent!.slice(0, 40), lines: Math.round(p.getBoundingClientRect().height / lineHeight) };
    }),
  );
  for (const p of lines) expect(p.lines, `«${p.text}»`).toBeLessThanOrEqual(maxLines);
});

test("cabe en su techo de altura, sin desbordamiento, con texto de 16 px, contraste AA y dianas de 44 px", async ({ page }) => {
  const width = page.viewportSize()!.width;
  await page.goto("/sobre");
  await page.evaluate(() => document.fonts.ready);
  const h = await pageHeight(page);
  console.log(`altura de /sobre a ${width} px: ${h}`);
  expect(h).toBeLessThanOrEqual(MAX_HEIGHT[width]);
  await expectNoHorizontalOverflow(page);
  await expectBodyText16(page);
  await expectContrastAA(page);
  expect(await smallTargets(page)).toEqual([]);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, `sobre-${width}.png`), fullPage: true });
  }
});

test("sin errores de consola ni peticiones a otros orígenes", async ({ page, baseURL }) => {
  const errors: string[] = [];
  const foreign: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("request", (req) => {
    if (new URL(req.url()).origin !== new URL(baseURL!).origin) foreign.push(req.url());
  });
  await page.goto("/sobre");
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
  expect(foreign).toEqual([]);
});

test("con movimiento reducido no hay animaciones en bucle", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/sobre");
  expect(await motionLoops(page)).toEqual(MOTIONLESS);
});
