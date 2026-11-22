import { expect, test } from "@playwright/test";
import { GLOSSARY, methodHint } from "../lib/glossary";
import { createPlayback, nextSpeed, type PlaybackOptions } from "../lib/playback";
import { API_ORIGIN, MAX_HEIGHT, expectBodyText16, expectNoHorizontalOverflow, pageHeight, stubMapStyle } from "./helpers";

// La portada pinta el mapa: su estilo se sustituye para no depender de la red.
test.beforeEach(async ({ page }) => {
  await stubMapStyle(page);
});

test("la portada responde 200 con idioma y título propios", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  const title = await page.title();
  expect(title).toContain("Planificador VRPTW");
  expect(title).not.toMatch(/create next app/i);
  await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
});

test("una ruta inexistente muestra el 404 en español", async ({ page }) => {
  const response = await page.goto("/no-existe");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Esta ruta no existe" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Volver al planificador" })).toHaveAttribute("href", "/");
});

test("tema oscuro único: color-scheme dark en html y en la meta", async ({ page }) => {
  await page.goto("/");
  const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  expect(scheme).toBe("dark");
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute("content", "dark");
});

test("las tres familias se sirven desde el propio origen, sin Google Fonts", async ({ page, baseURL }) => {
  const external: string[] = [];
  const fontFiles: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) external.push(url);
    if (request.resourceType() === "font") fontFiles.push(url);
  });
  await page.goto("/no-existe");
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts)
      .filter((face) => face.status === "loaded" && !face.family.includes("Fallback"))
      .map((face) => face.family);
  });
  for (const family of ["Big Shoulders", "Instrument Sans", "Martian Mono"]) {
    expect(loaded.some((name) => name.includes(family)), `${family} cargada`).toBe(true);
  }
  expect(fontFiles.length).toBeGreaterThanOrEqual(3);
  for (const url of fontFiles) expect(new URL(url).origin).toBe(new URL(baseURL!).origin);
  expect(external).toEqual([]);

  // Corte Display de Big Shoulders: el fichero trae el eje opsz y los títulos usan opsz 72.
  const opsz = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.textContent = "PLANIFICADOR VRPTW";
    probe.style.cssText = "position:absolute;font:800 40px var(--ff-display);white-space:nowrap";
    document.body.append(probe);
    const width = (value: number) => {
      probe.style.fontVariationSettings = `"opsz" ${value}`;
      return probe.getBoundingClientRect().width;
    };
    const result = { text: width(10), display: width(72), h1: getComputedStyle(document.querySelector("h1")!).fontVariationSettings };
    probe.remove();
    return result;
  });
  expect(Math.abs(opsz.display - opsz.text)).toBeGreaterThan(1);
  expect(opsz.h1).toBe('"opsz" 72');
});

test("sin desbordamiento horizontal y dentro del presupuesto de altura", async ({ page }) => {
  await page.goto("/");
  await expectNoHorizontalOverflow(page);
  const width = page.viewportSize()!.width;
  expect(await pageHeight(page)).toBeLessThanOrEqual(MAX_HEIGHT[width]);
  await page.goto("/no-existe");
  await expectNoHorizontalOverflow(page);
  expect(await pageHeight(page)).toBeLessThanOrEqual(MAX_HEIGHT[width]);
});

test("el texto de cuerpo mide 16 px o más en la cabecera y el 404", async ({ page }) => {
  await page.goto("/");
  const size = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);
  await expectBodyText16(page, "[data-testid=site-header]");
  await page.goto("/no-existe");
  await expectBodyText16(page);
});

test("el botón del recorrido se ve en la portada y se oculta donde no hay recorrido", async ({ page }) => {
  await page.goto("/");
  const tour = page.getByTestId("tour-start");
  await expect(tour).toHaveCount(1);
  await expect(tour).toBeVisible();
  await page.goto("/no-existe");
  await expect(page.getByTestId("tour-start")).toBeHidden();
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Planificador VRPTW, inicio" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: "Repositorio" })).toBeVisible();
});

test("la cabecera cabe en una línea con el recorrido conectado, «Aprende» y «Sobre el TFE»", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tour-start")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Aprende" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Sobre el TFE" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expectNoHorizontalOverflow(page);
  expect((await page.getByTestId("site-header").boundingBox())!.height).toBeLessThanOrEqual(64);
  const nav = (await page.getByRole("navigation", { name: "Principal" }).boundingBox())!;
  const title = (await page.getByRole("link", { name: "Planificador VRPTW, inicio" }).locator("span").first().boundingBox())!;
  expect(nav.x + nav.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(title.x + title.width).toBeLessThanOrEqual(nav.x);
});

test("de 768 a 1920 px, la marca y el lema no se solapan con la navegación", async ({ page }) => {
  // Una sola carga: los cortes son de CSS y basta con cambiar el ancho de la ventana.
  await page.goto("/");
  await expect(page.getByTestId("tour-start")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const width of [768, 1024, 1280, 1419, 1420, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const { brandRight, navLeft, navRight } = await page.evaluate(() => {
      const link = document.querySelector('a[aria-label="Planificador VRPTW, inicio"]')!;
      const spans = Array.from(link.querySelectorAll("span"), (s) => s.getBoundingClientRect()).filter((b) => b.width > 1);
      const nav = document.querySelector('nav[aria-label="Principal"]')!.getBoundingClientRect();
      return { brandRight: Math.max(...spans.map((b) => b.right)), navLeft: nav.left, navRight: nav.right };
    });
    expect(brandRight, `${width} px`).toBeLessThanOrEqual(navLeft);
    expect(navRight, `${width} px`).toBeLessThanOrEqual(width);
  }
});

test("el «?» se abre y se cierra con teclado y su texto sale del glosario", async ({ page }) => {
  await page.goto("/no-existe");
  const button = page.locator('[data-testid="help-button"][data-help="valido"]');
  const popover = page.getByTestId("help-popover");
  await expect(button).toHaveAccessibleName(GLOSSARY.valido.ask.es);

  await button.focus();
  await page.keyboard.press("Enter");
  await expect(popover).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(popover).toHaveAttribute("role", "dialog");
  await expect(popover.getByRole("heading")).toHaveText(GLOSSARY.valido.title.es);
  await expect(popover.getByTestId("help-text")).toHaveText(GLOSSARY.valido.text.es);
  await expect(popover.getByRole("button", { name: "Cerrar" })).toBeFocused();

  // El globo cabe en la ventana.
  const box = (await popover.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();

  // Con la «×» también vuelve el foco; pulsar fuera lo cierra.
  await page.keyboard.press("Space");
  await expect(popover).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(popover).toBeHidden();
  await expect(button).toBeFocused();
  await button.click();
  await expect(popover).toBeVisible();
  await page.mouse.click(5, viewport.height - 5);
  await expect(popover).toBeHidden();
});

test("el servicio de pruebas responde a /health desde el navegador (CORS)", async ({ page }) => {
  await page.goto("/");
  const body = await page.evaluate(async (origin) => (await fetch(`${origin}/health`)).json(), API_ORIGIN);
  expect(body.status).toBe("ok");
});

test("el servicio de pruebas usa el proveedor fake en /solve/llm", async ({ page }) => {
  await page.goto("/");
  const run = await page.evaluate(async (origin) => {
    const { instance } = await (await fetch("/data/cases/madrid-12.json")).json();
    const { models } = await (await fetch(`${origin}/models`)).json();
    const res = await fetch(`${origin}/solve/llm`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LLM-Key": "sk-ant-centinela-09" },
      body: JSON.stringify({ instance, model: models[0].model_id, role: "llm_direct", recheck: false, seed: 0 }),
    });
    return { status: res.status, body: await res.json() };
  }, API_ORIGIN);
  expect(run.status).toBe(200);
  expect(run.body.provider).toBe("fake");
});

test.describe("lib/glossary", () => {
  test("trae los términos de la interfaz, en una o dos frases cortas", () => {
    const required = ["ventana", "espera", "retraso", "capacidad", "coste", "valido", "heuristic", "aco", "ga", "tabu", "llm_direct", "llm_agent", "tokens"];
    expect(Object.keys(GLOSSARY)).toEqual(expect.arrayContaining(required));
    for (const [term, entry] of Object.entries(GLOSSARY)) {
      for (const lang of ["es", "en"] as const) {
        expect(entry.text[lang].length, `${term} ${lang}`).toBeLessThanOrEqual(140);
        expect(entry.text[lang].split(/[.!?](?=\s|$)/).filter((s) => s.trim()).length, `${term} ${lang}`).toBeLessThanOrEqual(2);
      }
      expect(entry.ask.es, term).toMatch(/^¿.+\?$/);
      expect(entry.ask.en, term).toMatch(/^What .+\?$/);
    }
  });

  test("cada método tiene su línea corta", () => {
    for (const method of ["heuristic", "aco", "ga", "tabu", "llm_direct", "llm_agent"]) {
      expect(methodHint(method), method).toBeTruthy();
    }
    expect(methodHint("desconocido")).toBeUndefined();
  });
});

test.describe("lib/playback", () => {
  /** Fotogramas manuales: `step(ms)` ejecuta los pendientes con esa marca de tiempo. */
  function manualFrames() {
    let queue: ((ts: number) => void)[] = [];
    const frames: PlaybackOptions["frames"] = {
      request: (cb) => queue.push(cb),
      cancel: () => {
        queue = [];
      },
    };
    return {
      frames,
      step(ts: number) {
        const run = queue;
        queue = [];
        run.forEach((cb) => cb(ts));
      },
      pending: () => queue.length,
    };
  }

  test("reproduce el día a la velocidad pedida y se detiene al final", () => {
    const clock = manualFrames();
    const pb = createPlayback({ reducedMotion: false, frames: clock.frames });
    pb.setRange(480, 1080); // 600 min en 30 s: 20 min por segundo a ×1
    pb.play();
    clock.step(0);
    clock.step(100);
    expect(pb.getSnapshot().t).toBeCloseTo(482);
    pb.setSpeed(4);
    clock.step(200);
    expect(pb.getSnapshot().t).toBeCloseTo(490);
    // Tras una pestaña oculta el paso se limita a 0,1 s.
    clock.step(60_000);
    expect(pb.getSnapshot().t).toBeCloseTo(498);
    pb.seek(1079);
    clock.step(60_100);
    expect(pb.getSnapshot()).toMatchObject({ t: 1080, playing: false });
    expect(clock.pending()).toBe(0);
    // Al final, reproducir vuelve a empezar.
    pb.play();
    expect(pb.getSnapshot()).toMatchObject({ t: 480, playing: true });
    pb.pause();
    expect(pb.getSnapshot().playing).toBe(false);
    expect(clock.pending()).toBe(0);
  });

  test("seek recorta al día y setRange reinicia en pausa", () => {
    const pb = createPlayback({ reducedMotion: false, frames: manualFrames().frames });
    pb.setRange(0, 230);
    pb.seek(-5);
    expect(pb.getSnapshot().t).toBe(0);
    pb.seek(999);
    expect(pb.getSnapshot().t).toBe(230);
    pb.seek(100);
    pb.play();
    pb.setRange(0, 1236);
    expect(pb.getSnapshot()).toMatchObject({ start: 0, end: 1236, t: 0, playing: false });
  });

  test("con movimiento reducido arranca sin movimiento y el reloj solo avanza con seek", () => {
    const clock = manualFrames();
    const pb = createPlayback({ reducedMotion: true, frames: clock.frames });
    pb.setRange(480, 1080);
    expect(pb.getSnapshot()).toMatchObject({ motion: false, reducedMotion: true });
    pb.play();
    expect(pb.getSnapshot().playing).toBe(false);
    expect(clock.pending()).toBe(0);
    pb.seek(600);
    expect(pb.getSnapshot().t).toBe(600);
    // Si el visitante activa el movimiento, puede reproducir.
    pb.setMotion(true);
    pb.play();
    expect(pb.getSnapshot().playing).toBe(true);
    pb.setMotion(false);
    expect(pb.getSnapshot().playing).toBe(false);
  });

  test("«Animación: no» no detiene la reproducción", () => {
    const pb = createPlayback({ reducedMotion: false, frames: manualFrames().frames });
    pb.setRange(480, 1080);
    pb.play();
    pb.setMotion(false);
    expect(pb.getSnapshot()).toMatchObject({ motion: false, playing: true });
  });

  test("la instantánea es estable y solo avisa cuando cambia", () => {
    const pb = createPlayback({ reducedMotion: false, frames: manualFrames().frames });
    let calls = 0;
    const unsubscribe = pb.subscribe(() => calls++);
    pb.setRange(480, 1080);
    const snap = pb.getSnapshot();
    expect(pb.getSnapshot()).toBe(snap);
    pb.seek(480);
    pb.setRange(480, 1080);
    expect(calls).toBe(1);
    pb.seek(500);
    expect(calls).toBe(2);
    unsubscribe();
    pb.seek(510);
    expect(calls).toBe(2);
    expect(pb.getServerSnapshot()).toBe(pb.getServerSnapshot());
  });

  test("la velocidad cicla ×1, ×4, ×10", () => {
    expect([1, 4, 10].map(nextSpeed)).toEqual([4, 10, 1]);
  });
});
