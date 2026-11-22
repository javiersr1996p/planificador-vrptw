import { closeSync, openSync, readFileSync, statSync, unlinkSync, utimesSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

export const API_ORIGIN = "http://127.0.0.1:8010";

/** Altura máxima de la página con un ejemplo cargado, por ancho de ventana. */
export const MAX_HEIGHT: Record<number, number> = { 1440: 1800, 390: 2900 };

/** Altura máxima de la portada con `madrid-12` cargado, por ancho de ventana. */
export const MADRID12_HEIGHT: Record<number, number> = { 1440: 1520, 390: 2745 };

/** Altura máxima de la página de «Aprende» con cada escena, por ancho de ventana (dos pantallas en móvil, una en escritorio). */
export const LEARN_SCENE_HEIGHT: Record<number, number> = { 1440: 900, 390: 1690 };

export function pageHeight(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollHeight);
}

/**
 * Ningún texto visible de cuerpo por debajo de 16 px. Las etiquetas en
 * mayúsculas (`text-transform: uppercase`) y los ejes (texto SVG o dentro de un
 * elemento con `data-axis`) admiten 12 px. Solo mira el texto bajo `scope`.
 */
export async function expectBodyText16(page: Page, scope = "body"): Promise<void> {
  const offenders = await page.evaluate((selector) => {
    const found: string[] = [];
    for (const root of Array.from(document.querySelectorAll(selector))) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        const el = node.parentElement;
        if (!text || !el || el.closest("script, style, noscript, template")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        const style = getComputedStyle(el);
        // Oculto, recortado a 1 px (solo para lectores de pantalla) o invisible.
        if (box.width < 2 || box.height < 2 || style.visibility === "hidden") continue;
        const size = parseFloat(style.fontSize);
        const label = style.textTransform === "uppercase" || el.closest("svg, [data-axis]") !== null;
        const min = label ? 12 : 16;
        if (size < min) found.push(`${size}px < ${min}px: «${text.slice(0, 50)}»`);
      }
    }
    return found;
  }, scope);
  expect(offenders, "texto por debajo del tamaño mínimo").toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

/**
 * Animaciones en bucle en marcha, SVG animados y fotogramas pedidos durante un segundo.
 * Un bucle pide uno por fotograma (decenas por segundo); el mapa puede pedir alguno
 * suelto al terminar de pintar, así que se admiten hasta 10.
 */
export function motionLoops(page: Page): Promise<{ infinite: number; smil: number; loop: boolean }> {
  return page.evaluate(async () => {
    let frames = 0;
    const request = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => {
      frames++;
      return request(cb);
    };
    await new Promise((resolve) => setTimeout(resolve, 1000));
    window.requestAnimationFrame = request;
    const infinite = document
      .getAnimations()
      .filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations === Infinity).length;
    return { infinite, smil: document.querySelectorAll("animate, animateMotion, animateTransform").length, loop: frames > 10 };
  });
}

/** Lo que mide `motionLoops` en una página quieta. */
export const MOTIONLESS = { infinite: 0, smil: 0, loop: false };

/** Simula el servicio apagado: aborta toda petición a su origen. */
export async function blockService(page: Page): Promise<void> {
  await page.route(`${API_ORIGIN}/**`, (route) => route.abort("connectionrefused"));
}

/** Sustituye el estilo del mapa por uno vacío y aborta las teselas: ninguna prueba depende de la red. */
export async function stubMapStyle(page: Page): Promise<void> {
  await page.route("**://tiles.openfreemap.org/**", (route) =>
    route.request().url().includes("/styles/")
      ? route.fulfill({ contentType: "application/json", body: JSON.stringify({ version: 8, sources: {}, layers: [] }) })
      : route.abort(),
  );
}

/** Un texto con contraste por debajo de AA: su razón, la exigida y dónde está. */
export type ContrastIssue = { ratio: number; need: number; text: string; where: string };

/**
 * Contraste WCAG de cada texto visible bajo `scope` con su fondo calculado. El fondo
 * se compone subiendo por los ancestros: colores con su transparencia y degradados
 * con su color medio. Sobre el mapa con teselas, lo que hay debajo del último panel
 * puede ser cualquier cosa: se prueba con blanco y con negro. AA: 4,5:1, o 3:1 en
 * texto grande (24 px, o 18,66 px en negrita). Los controles desactivados y los
 * adornos animados (`.decor`, como los dos puntos del reloj) no cuentan.
 * Devuelve todos los textos medidos, de peor a mejor.
 */
export async function contrastAudit(page: Page, scope = "body"): Promise<ContrastIssue[]> {
  return page.evaluate((selector) => {
    type RGBA = [number, number, number, number];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const cache = new Map<string, RGBA>();
    const parse = (css: string): RGBA => {
      let c = cache.get(css);
      if (!c) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = "rgba(0, 0, 0, 0)";
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        c = [d[0], d[1], d[2], d[3] / 255];
        cache.set(css, c);
      }
      return c;
    };
    const over = (top: RGBA, below: RGBA): RGBA => {
      const a = top[3] + below[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      const mix = (i: number) => (top[i] * top[3] + below[i] * below[3] * (1 - top[3])) / a;
      return [mix(0), mix(1), mix(2), a];
    };
    const lum = (c: RGBA) => {
      const ch = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
    };
    const ratio = (a: RGBA, b: RGBA) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    // Partes de primer nivel de una función CSS, separadas por comas.
    const split = (inner: string) => {
      const parts: string[] = [];
      let depth = 0;
      let cur = "";
      for (const ch of inner) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
          parts.push(cur.trim());
          cur = "";
        } else cur += ch;
      }
      if (cur.trim()) parts.push(cur.trim());
      return parts;
    };
    const COLOR = /^((?:rgba?|hsla?|oklab|oklch|lab|lch|color|color-mix)\((?:[^()]|\([^()]*\))*\)|#[0-9a-f]{3,8}|transparent)/i;
    // Color medio de un degradado, ponderado por lo que ocupa cada tramo entre paradas.
    const gradientMean = (layer: string): RGBA | null => {
      const open = layer.indexOf("(");
      const stops = split(layer.slice(open + 1, layer.lastIndexOf(")")))
        .map((part) => {
          const m = part.match(COLOR);
          if (!m) return null;
          const pos = part.slice(m[0].length).trim().match(/^(-?[\d.]+)%/);
          return { color: parse(m[0]), pos: pos ? Number(pos[1]) / 100 : null };
        })
        .filter((s): s is { color: RGBA; pos: number | null } => s !== null);
      if (stops.length === 0) return null;
      stops[0].pos ??= 0;
      stops[stops.length - 1].pos ??= 1;
      for (let i = 1; i < stops.length - 1; i++) {
        if (stops[i].pos !== null) continue;
        let j = i;
        while (stops[j].pos === null) j++;
        const a = stops[i - 1].pos!;
        stops[i].pos = a + (stops[j].pos! - a) / (j - i + 1);
      }
      const premul = (c: RGBA): RGBA => [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]];
      const acc: RGBA = [0, 0, 0, 0];
      const add = (c: RGBA, w: number) => premul(c).forEach((v, i) => (acc[i] += v * w));
      const first = Math.min(1, Math.max(0, stops[0].pos!));
      add(stops[0].color, first);
      for (let i = 1; i < stops.length; i++) {
        const a = Math.min(1, Math.max(0, stops[i - 1].pos!));
        const b = Math.min(1, Math.max(a, stops[i].pos!));
        add(stops[i - 1].color, (b - a) / 2);
        add(stops[i].color, (b - a) / 2);
      }
      add(stops[stops.length - 1].color, 1 - Math.min(1, Math.max(0, stops[stops.length - 1].pos!)));
      return acc[3] > 0 ? [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3], acc[3]] : [0, 0, 0, 0];
    };
    const WHITE: RGBA = [255, 255, 255, 1];
    const BLACK: RGBA = [0, 0, 0, 1];
    const PAGE = parse(getComputedStyle(document.documentElement).backgroundColor);

    /** Capas de fondo de un elemento, de arriba abajo; `null` si hay una imagen desconocida. */
    function layersOf(el: Element): RGBA[][] {
      const st = getComputedStyle(el);
      const layers: RGBA[][] = [];
      if (st.backgroundImage !== "none") {
        for (const layer of split(st.backgroundImage)) {
          if (/gradient\(/.test(layer)) {
            const mean = gradientMean(layer);
            if (mean) layers.push([mean]);
          } else if (/url\(/.test(layer)) layers.push([WHITE, BLACK]);
        }
      }
      layers.push([parse(st.backgroundColor)]);
      return layers;
    }

    // Fondos posibles bajo cada elemento, de abajo arriba y memorizados: los hermanos comparten ancestros.
    const memo = new Map<Element, RGBA[]>();
    function backgrounds(el: Element | null): RGBA[] {
      if (!el) return [PAGE];
      const known = memo.get(el);
      if (known) return known;
      // Bajo los paneles del mapa con teselas puede haber cualquier color.
      if (el.matches('[data-testid="map-box"]') && el.closest('[data-testid="route-map"][data-mode="map"]')) {
        memo.set(el, [WHITE, BLACK]);
        return [WHITE, BLACK];
      }
      const own = layersOf(el).filter((layer) => !layer.every((c) => c[3] === 0));
      const cut = own.findIndex((layer) => layer.every((c) => c[3] >= 0.999));
      const layers = cut === -1 ? own : own.slice(0, cut + 1);
      let set = cut === -1 ? backgrounds(el.parentElement) : [PAGE];
      for (let i = layers.length - 1; i >= 0; i--) {
        const next: RGBA[] = [];
        for (const top of layers[i]) for (const below of set) next.push(over(top, below));
        set = next;
      }
      memo.set(el, set);
      return set;
    }
    const opacities = new Map<Element, number>();
    function opacityOf(el: Element | null): number {
      if (!el) return 1;
      let o = opacities.get(el);
      if (o === undefined) {
        o = Number(getComputedStyle(el).opacity) * opacityOf(el.parentElement);
        opacities.set(el, o);
      }
      return o;
    }

    const found: { ratio: number; need: number; text: string; where: string }[] = [];
    for (const root of Array.from(document.querySelectorAll(selector))) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        const el = node.parentElement;
        if (!text || !el || el.closest("script, style, noscript, template")) continue;
        // Controles desactivados (también la etiqueta de una casilla desactivada) y adornos animados.
        if (el.closest(":disabled, [aria-disabled='true'], label:has(:disabled), .decor")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (box.width < 2 || box.height < 2 || st.visibility === "hidden") continue;
        const opacity = opacityOf(el);
        if (opacity < 0.05) continue;
        const svg = el instanceof SVGElement;
        const raw = svg ? st.fill : st.color;
        if (svg && !/^(rgb|#|color|oklab|oklch)/.test(raw)) continue;
        const fg: RGBA = [...parse(raw)];
        fg[3] *= opacity;
        if (fg[3] === 0) continue;
        const size = parseFloat(st.fontSize);
        const bold = Number(st.fontWeight) >= 700;
        const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
        const worst = Math.min(...backgrounds(el).map((bg) => ratio(over(fg, bg), bg)));
        const where = el.closest("[data-testid]")?.getAttribute("data-testid") ?? el.tagName.toLowerCase();
        found.push({ ratio: Math.round(worst * 100) / 100, need, text: text.slice(0, 40), where });
      }
    }
    return found.sort((a, b) => a.ratio / a.need - b.ratio / b.need);
  }, scope);
}

/** Ningún texto visible bajo `scope` por debajo de AA. Devuelve la peor razón medida. */
export async function expectContrastAA(page: Page, scope = "body"): Promise<ContrastIssue | null> {
  const all = await contrastAudit(page, scope);
  const failing = all.filter((t) => t.ratio < t.need).map((t) => `${t.ratio}:1 < ${t.need}:1 «${t.text}» (${t.where})`);
  expect(failing, "textos por debajo del contraste AA").toEqual([]);
  return all[0] ?? null;
}

/**
 * Controles visibles bajo `scope` con una zona táctil menor que `min` px de alto o de
 * ancho. Una casilla cuenta con su etiqueta; un `::before` absoluto amplía la zona
 * (los «?» de ayuda). Los enlaces dentro de una frase quedan fuera, como en WCAG, y
 * también lo que case con `ignore`.
 */
export async function smallTargets(page: Page, { scope = "body", min = 44, ignore = "" } = {}): Promise<string[]> {
  return page.evaluate(
    ({ selector, min, ignore }) => {
      const CONTROLS =
        'a[href], button, summary, select, textarea, input:not([type="hidden"]), [role="button"], [role="tab"], [role="slider"]';
      const out: string[] = [];
      const seen = new Set<Element>();
      for (const root of Array.from(document.querySelectorAll(selector))) {
        for (const el of Array.from(root.querySelectorAll(CONTROLS))) {
          const target = el.matches("input, select, textarea") ? (el.closest("label") ?? el) : el;
          if (seen.has(target) || (ignore && target.matches(ignore))) continue;
          seen.add(target);
          const st = getComputedStyle(target);
          const r = target.getBoundingClientRect();
          if (r.width < 2 || r.height < 2 || st.visibility === "hidden" || target.closest("[inert]")) continue;
          if (target.matches("a") && st.display === "inline") continue;
          let { width, height } = r;
          const before = getComputedStyle(target, "::before");
          if (before.content !== "none" && before.position === "absolute") {
            const px = (v: string) => parseFloat(v) || 0;
            width = Math.max(width, r.width - px(before.left) - px(before.right));
            height = Math.max(height, r.height - px(before.top) - px(before.bottom));
          }
          if (width < min - 0.5 || height < min - 0.5) {
            const name = (target.getAttribute("aria-label") ?? target.textContent ?? "").trim().slice(0, 30);
            const id = target.closest("[data-testid]")?.getAttribute("data-testid") ?? "";
            out.push(`${Math.round(width)}×${Math.round(height)} ${target.tagName.toLowerCase()} «${name}» (${id})`);
          }
        }
      }
      return out;
    },
    { selector: scope, min, ignore },
  );
}

/*
  Cerrojo entre procesos para el cálculo clásico real. El servicio de pruebas admite un
  solo `/solve/classic` a la vez (503 si está ocupado) y lo comparten todos los
  trabajadores y los dos tamaños de ventana: las pruebas que lo usan de verdad se
  turnan con un fichero de bloqueo en el directorio temporal del sistema.
*/
const SOLVER_LOCK = path.join(tmpdir(), "planificador-vrptw-e2e-solve-classic.lock");
/** Sin renovar en este tiempo, el cerrojo es de un proceso que ya no existe. */
const SOLVER_LOCK_STALE_MS = 30_000;
const SOLVER_LOCK_BEAT_MS = 5_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function solverLockIsStale(): boolean {
  try {
    const pid = Number(readFileSync(SOLVER_LOCK, "utf8"));
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
      }
    }
    return Date.now() - statSync(SOLVER_LOCK).mtimeMs > SOLVER_LOCK_STALE_MS;
  } catch {
    return false; // ya no existe: se vuelve a intentar
  }
}

/**
 * Espera a que el servicio no esté calculando: un cálculo abandonado por la prueba
 * anterior (cancelar, cambiar de caso) sigue ocupándolo hasta que termina. La sonda
 * es una heurística sobre madrid-12, que tarda milisegundos.
 */
async function waitForIdleSolver(): Promise<void> {
  const file = path.join(__dirname, "..", "public", "data", "cases", "madrid-12.json");
  const body = JSON.stringify({
    instance: JSON.parse(readFileSync(file, "utf8")).instance,
    method: "heuristic",
    seed: 0,
    time_limit_s: 1,
  });
  const deadline = Date.now() + 90_000;
  for (;;) {
    const res = await fetch(`${API_ORIGIN}/solve/classic`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    await res.arrayBuffer();
    if (res.status !== 503) {
      expect(res.status, "sonda del servicio de pruebas").toBe(200);
      return;
    }
    if (Date.now() > deadline) throw new Error("El servicio de pruebas sigue ocupado tras 90 s");
    await sleep(250);
  }
}

async function acquireSolverLock(): Promise<() => void> {
  for (;;) {
    try {
      const fd = openSync(SOLVER_LOCK, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (solverLockIsStale()) {
        try {
          unlinkSync(SOLVER_LOCK);
        } catch {}
        continue;
      }
      await sleep(200);
    }
  }
  const beat = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(SOLVER_LOCK, now, now);
    } catch {}
  }, SOLVER_LOCK_BEAT_MS);
  return () => {
    clearInterval(beat);
    try {
      if (readFileSync(SOLVER_LOCK, "utf8") === String(process.pid)) unlinkSync(SOLVER_LOCK);
    } catch {}
  };
}

/**
 * `test` para las pruebas que mandan `/solve/classic` real: cada una toma el cerrojo
 * antes de empezar, espera a que el servicio quede libre y lo suelta al acabar,
 * pase lo que pase.
 */
export const solverTest = test.extend<{ classicSolver: void }>({
  classicSolver: [
    async ({}, provide) => {
      const release = await acquireSolverLock();
      try {
        await waitForIdleSolver();
        await provide();
      } finally {
        release();
      }
    },
    { auto: true },
  ],
});

/** Letras y palabras que delatan español en la interfaz en inglés. */
const SPANISH_HINTS =
  /[áéíóúüñ¿¡]|\b(el|la|los|las|del|al|una|unos|para|con|sin|por|que|son|de|tu|ruta|rutas|furgoneta|furgonetas|parada|paradas|cliente|clientes|coste|ventana|caso|casos|resolver|planes|método|métodos|válido|llega|tarde|espera)\b/i;

/**
 * Líneas de texto visible bajo `scope` que parecen español. `allow` quita antes
 * los nombres propios y los datos de los casos (direcciones, nombres de lugares),
 * que no se traducen.
 */
export async function spanishLeaks(page: Page, { scope = "body", allow = [] as (string | RegExp)[] } = {}): Promise<string[]> {
  const text = await page.locator(scope).first().evaluate((el) => (el as HTMLElement).innerText);
  return text
    .split("\n")
    .map((line) => allow.reduce<string>((acc, a) => acc.replace(typeof a === "string" ? a : new RegExp(a.source, a.flags.includes("g") ? a.flags : a.flags + "g"), " "), line).trim())
    .filter((line) => SPANISH_HINTS.test(line));
}
