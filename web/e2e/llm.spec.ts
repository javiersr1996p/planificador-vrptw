import { expect, test, type Page, type Route } from "@playwright/test";
import { formatNumber } from "../lib/format";
import {
  API_ORIGIN,
  MAX_HEIGHT,
  blockService,
  expectBodyText16,
  expectNoHorizontalOverflow,
  pageHeight,
  stubMapStyle,
} from "./helpers";

// IA en vivo con la clave del visitante y «Explicar», contra el servicio de
// pruebas de `playwright.config.ts` (proveedor `fake`: ninguna llamada de pago).
// La clave es una centinela: se comprueba que no sale del panel salvo en la
// cabecera `X-LLM-Key` de `/solve/llm` y `/explain`.

test.setTimeout(90_000);

const SENTINEL = "sk-ant-centinela-07";
const CASE = "tfe2024-10c-1";
const SOLVE = `${API_ORIGIN}/solve/llm`;
const EXPLAIN = `${API_ORIGIN}/explain`;
const CORS = { "access-control-allow-origin": "http://localhost:3100" };

const rows = (page: Page) => page.getByTestId("comparison-row");
const live = (page: Page, method: string) =>
  rows(page).and(page.locator(`[data-origin="en vivo"][data-method="${method}"]`));
const panel = (page: Page) => page.getByTestId("llm-panel");
const start = (page: Page) => page.getByTestId("llm-start");
const status = (page: Page) => page.getByTestId("llm-status");
const keyField = (page: Page) => page.getByTestId("llm-key");

async function openCase(page: Page, id: string, count: number): Promise<void> {
  await page.locator(`[data-testid="example-card"][data-case-id="${id}"]`).click();
  await expect(rows(page)).toHaveCount(count);
}

async function openIa(page: Page): Promise<void> {
  const action = page.locator('[data-testid="live-action"][data-live="ia"]');
  if ((await action.getAttribute("aria-expanded")) !== "true") await action.click();
  await expect(panel(page)).toBeVisible();
}

async function closePanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Cerrar el panel" }).click();
  await expect(page.getByTestId("live-panel")).toBeHidden();
}

async function pickRole(page: Page, role: "llm_direct" | "llm_agent"): Promise<void> {
  await page.locator(`[data-testid="llm-role"][data-role="${role}"]`).click();
  await expect(page.locator(`[data-testid="llm-role"][data-role="${role}"] input`)).toBeChecked();
}

/** Todo lo que el navegador guarda: almacenamiento, cookies y cada base de IndexedDB con su contenido. */
function storageDump(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const parts: string[] = [];
    for (const s of [localStorage, sessionStorage]) {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i)!;
        parts.push(k, s.getItem(k) ?? "");
      }
    }
    parts.push(document.cookie);
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      parts.push(info.name);
      const db = await new Promise<IDBDatabase>((ok, ko) => {
        const r = indexedDB.open(info.name!);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ko(r.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const all = await new Promise<unknown[]>((ok, ko) => {
          const r = db.transaction(store).objectStore(store).getAll();
          r.onsuccess = () => ok(r.result);
          r.onerror = () => ko(r.error);
        });
        parts.push(JSON.stringify(all));
      }
      db.close();
    }
    return parts.join("\n");
  });
}

type Seen = { method: string; url: string; headers: Record<string, string>; body: string };

/** Registra cada petición de la página con todas sus cabeceras y su cuerpo. */
function recordRequests(page: Page): () => Promise<Seen[]> {
  const pending: Promise<Seen>[] = [];
  page.on("request", (r) => {
    pending.push(
      r.allHeaders().then((headers) => ({ method: r.method(), url: r.url(), headers, body: r.postData() ?? "" })),
    );
  });
  return () => Promise.all(pending);
}

/** Mensajes de consola y errores de la página. */
function recordConsole(page: Page): string[] {
  const logs: string[] = [];
  page.on("console", (m) => logs.push(m.text()));
  page.on("pageerror", (e) => logs.push(`${e.name}: ${e.message}`));
  return logs;
}

test.beforeEach(async ({ page }) => {
  await stubMapStyle(page);
  await page.goto("/");
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByTestId("service-status")).toHaveAttribute("data-state", "up");
});

test("directo y agente añaden su fila en vivo, «Explicar» muestra el texto y la clave no sale del panel", async ({ page }) => {
  const requests = recordRequests(page);
  const logs = recordConsole(page);
  await openCase(page, CASE, 10);
  await openIa(page);

  // Sin clave no se lanza; con ella, sí. El campo es de contraseña, sin `name` ni autocompletado.
  await expect(page.getByTestId("llm-model")).not.toHaveValue("");
  await expect(start(page)).toBeDisabled();
  await expect(keyField(page)).toHaveAttribute("type", "password");
  await expect(keyField(page)).toHaveAttribute("autocomplete", "off");
  expect(await keyField(page).getAttribute("name")).toBeNull();
  await keyField(page).fill(SENTINEL);
  await expect(page.getByTestId("llm-key-state")).toContainText("En memoria");
  await expect(page.getByTestId("llm-cost-warning")).toContainText("se cobra en tu cuenta");

  // Directo.
  await pickRole(page, "llm_direct");
  await start(page).click();
  await expect(status(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(status(page)).toContainText("fake");
  await expect(live(page, "llm_direct")).toHaveCount(1);
  await expect(live(page, "llm_direct").getByTestId("method-hint")).toContainText("fake");
  await expect(live(page, "llm_direct")).toContainText(/tokens/);

  // Agente: su traza va en el desplegable de la comparativa.
  await pickRole(page, "llm_agent");
  await expect(page.getByTestId("llm-recheck")).toBeDisabled();
  await start(page).click();
  await expect(live(page, "llm_agent")).toHaveCount(1, { timeout: 30_000 });
  await expect(status(page)).toHaveAttribute("data-status", "done");
  await expect(live(page, "llm_agent").getByTestId("method-hint")).toContainText("fake");
  await expect(live(page, "llm_agent").getByTestId("agent-trace")).toBeVisible();
  await expect(rows(page)).toHaveCount(12);
  // El plan nuevo queda seleccionado.
  await expect(rows(page).and(page.locator('[data-selected="true"]'))).toHaveAttribute("data-method", "llm_agent");

  // Con el panel abierto y las dos filas nuevas, la página sigue dentro del tope.
  const width = page.viewportSize()!.width;
  expect(await pageHeight(page)).toBeLessThanOrEqual(MAX_HEIGHT[width]);
  await expectNoHorizontalOverflow(page);

  // «Explicar» en el detalle del plan seleccionado.
  await closePanel(page);
  await page.getByTestId("explain-button").click();
  await expect(page.getByTestId("explain-text")).toContainText("Respuesta de prueba");
  await expect(page.getByTestId("explain-meta")).toContainText("fake");
  await expect(page.getByTestId("explain-meta")).toContainText("tokens");
  expect(await pageHeight(page)).toBeLessThanOrEqual(MAX_HEIGHT[width]);
  await expectBodyText16(page, '[data-testid="explain"]');

  // Ni almacenamiento, ni cookies, ni IndexedDB, ni URL, ni consola, ni HTML.
  expect(await storageDump(page)).not.toContain(SENTINEL);
  expect(page.url()).not.toContain(SENTINEL);
  expect(logs.join("\n")).not.toContain(SENTINEL);
  expect(await page.content()).not.toContain(SENTINEL);

  // Peticiones: la clave solo va en la cabecera `x-llm-key` de POST /solve/llm y /explain al servicio.
  const seen = await requests();
  for (const r of seen) {
    expect(r.url).not.toContain(SENTINEL);
    expect(r.body).not.toContain(SENTINEL);
    for (const [name, value] of Object.entries(r.headers)) {
      if (!value.includes(SENTINEL)) continue;
      expect(name).toBe("x-llm-key");
      expect(value).toBe(SENTINEL);
      expect(r.method).toBe("POST");
      expect([SOLVE, EXPLAIN]).toContain(r.url);
    }
  }
  const carrying = seen.filter((r) => Object.values(r.headers).some((v) => v.includes(SENTINEL)));
  expect(carrying.map((r) => r.url)).toEqual([SOLVE, SOLVE, EXPLAIN]);
  // El cuerpo lleva lo que pide el contrato y nada más.
  const body = JSON.parse(carrying[0].body) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["instance", "model", "recheck", "role", "seed"]);
  expect(Object.keys(JSON.parse(carrying[2].body)).sort()).toEqual(["instance", "method", "model", "routes"]);

  // Cerrar y reabrir el panel no deja la clave en el HTML serializado.
  await openIa(page);
  await expect(keyField(page)).toHaveValue(SENTINEL);
  expect(await page.content()).not.toContain(SENTINEL);
  await closePanel(page);
  expect(await page.content()).not.toContain(SENTINEL);
});

test("recargar vacía el campo, «Olvidar clave» lo vacía sin recargar y la clave nunca entra en el HTML", async ({ page }) => {
  await openIa(page);
  await keyField(page).fill(SENTINEL);
  await expect(start(page)).toBeEnabled();
  expect(await page.content()).not.toContain(SENTINEL);

  // Olvidar: el campo y el estado quedan vacíos y el foco vuelve al campo.
  await page.getByTestId("llm-forget").click();
  await expect(keyField(page)).toHaveValue("");
  await expect(keyField(page)).toBeFocused();
  await expect(page.getByTestId("llm-key-state")).toHaveCount(0);
  await expect(start(page)).toBeDisabled();
  await expect(page.getByTestId("llm-forget")).toBeDisabled();

  // Recargar: la clave se pierde.
  await keyField(page).fill(SENTINEL);
  await page.reload();
  await expect(rows(page)).toHaveCount(4);
  await openIa(page);
  await expect(keyField(page)).toHaveValue("");
  await expect(start(page)).toBeDisabled();
  expect(await page.content()).not.toContain(SENTINEL);
  expect(await storageDump(page)).not.toContain(SENTINEL);
});

for (const [code, expected] of [
  [401, "Clave rechazada"],
  [429, "límite de uso"],
  [502, "error 502"],
] as const) {
  test(`un ${code} cuyo cuerpo repite la clave sale con su texto y sin la clave`, async ({ page }) => {
    await page.route(SOLVE, (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            status: code,
            headers: CORS,
            contentType: "application/json",
            body: JSON.stringify({ detail: `la clave ${SENTINEL} no vale` }),
          })
        : route.continue(),
    );
    await openIa(page);
    await keyField(page).fill(SENTINEL);
    await start(page).click();
    await expect(status(page)).toHaveAttribute("data-status", "error");
    await expect(status(page)).toContainText(expected);
    await expect(status(page)).not.toContainText(SENTINEL);
    expect(await page.content()).not.toContain(SENTINEL);
    await expect(rows(page).and(page.locator('[data-origin="en vivo"]'))).toHaveCount(0);
    await expect(start(page)).toBeEnabled();
  });
}

test("«Explicar»: un 401 sale sin la clave y un texto que la repitiera llega sin ella", async ({ page }) => {
  let calls = 0;
  await page.route(EXPLAIN, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls++;
    if (calls === 1) {
      return route.fulfill({
        status: 401,
        headers: CORS,
        contentType: "application/json",
        body: JSON.stringify({ detail: `clave ${SENTINEL} rechazada` }),
      });
    }
    const res = await route.fetch();
    const reply = await res.json();
    return route.fulfill({ response: res, json: { ...reply, text: `Texto con la clave ${SENTINEL} dentro.` } });
  });
  await openIa(page);
  await keyField(page).fill(SENTINEL);
  await closePanel(page);
  await page.getByTestId("explain-button").click();
  await expect(page.getByTestId("explain-error")).toContainText("Clave rechazada");
  expect(await page.content()).not.toContain(SENTINEL);

  await page.getByTestId("explain-button").click();
  await expect(page.getByTestId("explain-text")).toContainText("Texto con la clave");
  await expect(page.getByTestId("explain-text")).toContainText("[clave oculta]");
  expect(await page.content()).not.toContain(SENTINEL);
});

test("una respuesta sin plan legible sale con su motivo y queda en la comparativa", async ({ page }) => {
  await page.route(SOLVE, async (route: Route) => {
    if (route.request().method() !== "POST") return route.continue();
    const res = await route.fetch();
    const record = await res.json();
    return route.fulfill({
      response: res,
      json: { ...record, parse_status: "unparseable", solution: null, evaluation: null, raw_response: `eco ${SENTINEL}` },
    });
  });
  await openIa(page);
  await keyField(page).fill(SENTINEL);
  await start(page).click();
  await expect(status(page)).toHaveAttribute("data-status", "done");
  await expect(status(page)).toContainText("Sin plan legible");
  await expect(status(page)).toContainText("no se pudo leer la solución");
  const row = live(page, "llm_direct");
  await expect(row).toHaveAttribute("data-unreadable", "true");
  await expect(row).toContainText("Sin respuesta legible");
  expect(await page.content()).not.toContain(SENTINEL);
});

test("sin clave no se puede lanzar y «Explicar» la pide abriendo el panel", async ({ page }) => {
  let explains = 0;
  page.on("request", (r) => {
    if (r.url() === EXPLAIN) explains++;
  });
  await openIa(page);
  await expect(start(page)).toBeDisabled();
  await expect(start(page)).toHaveAccessibleDescription(/Escribe tu clave/);
  await closePanel(page);

  await page.getByTestId("explain-button").click();
  await expect(panel(page)).toBeVisible();
  await expect(keyField(page)).toBeFocused();
  await expect(page.getByTestId("explain-ask")).toBeVisible();
  expect(explains).toBe(0);
});

test("cancelar deja el panel utilizable y sin fila nueva", async ({ page }) => {
  await page.route(SOLVE, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise((r) => setTimeout(r, 3000));
    await route.continue().catch(() => {});
  });
  await openIa(page);
  await keyField(page).fill(SENTINEL);
  await start(page).click();
  await expect(status(page)).toHaveAttribute("data-status", "running");
  await expect(page.getByTestId("llm-timer")).toHaveText(/^\d+:\d{2}$/);
  await page.getByTestId("llm-cancel").click();
  await expect(status(page)).toHaveAttribute("data-status", "cancelled");
  await expect(start(page)).toBeEnabled();
  await page.waitForTimeout(3500);
  await expect(rows(page).and(page.locator('[data-origin="en vivo"]'))).toHaveCount(0);
});

test("doble clic en «Lanzar» no cancela la petición que acaba de salir", async ({ page }) => {
  await openIa(page);
  await keyField(page).fill(SENTINEL);
  await expect(start(page)).toBeEnabled();
  await start(page).dblclick();
  await expect(status(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(live(page, "llm_direct")).toHaveCount(1);
});

test("al cambiar de caso, el resultado en curso se descarta", async ({ page }) => {
  await page.route(SOLVE, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await new Promise((r) => setTimeout(r, 2000));
    await route.continue().catch(() => {});
  });
  await openIa(page);
  await keyField(page).fill(SENTINEL);
  await start(page).click();
  await expect(status(page)).toHaveAttribute("data-status", "running");
  await closePanel(page);
  await openCase(page, "madrid-25", 4);
  await page.waitForTimeout(2500);
  await expect(rows(page).and(page.locator('[data-origin="en vivo"]'))).toHaveCount(0);
  await openIa(page);
  await expect(status(page)).toHaveCount(0);
});

test("sin servicio, el panel y «Explicar» quedan desactivados con su motivo", async ({ page }) => {
  await blockService(page);
  await page.reload();
  await expect(page.getByTestId("service-status")).toHaveAttribute("data-state", "down");
  await openIa(page);
  await expect(panel(page).getByTestId("service-notice")).toContainText("Servicio no disponible");
  await keyField(page).fill(SENTINEL);
  await expect(start(page)).toBeDisabled();
  await expect(start(page)).toHaveAccessibleDescription(/Servicio no disponible/);
  await expect(page.getByTestId("llm-model")).toBeDisabled();
  // La clave se puede olvidar aunque no haya servicio.
  await expect(page.getByTestId("llm-forget")).toBeEnabled();
  await closePanel(page);
  await expect(page.getByTestId("explain-button")).toBeDisabled();
  await expect(page.getByTestId("explain-line")).toContainText("Sin servicio");
});

test("panel abierto: precio del servicio con su fuente, aviso de dos líneas, texto de 16 px y zonas de 44 px", async ({ page, request }) => {
  const res = await request.get(`${API_ORIGIN}/models`);
  const { models } = (await res.json()) as {
    models: { model_id: string; price_in_per_mtok: number; price_out_per_mtok: number; currency: string; source_url: string }[];
  };
  await openIa(page);
  const select = page.getByTestId("llm-model");
  await expect(select).toHaveValue(models[0].model_id);
  expect(await select.locator("option").allTextContents()).toEqual(models.map((m) => m.model_id));

  // Cada cifra sale de `GET /models`, con su enlace a la fuente.
  for (const m of models) {
    await select.selectOption(m.model_id);
    const fmt = (v: number) => formatNumber(v, Number.isInteger(v) ? 0 : 2);
    await expect(page.getByTestId("llm-price")).toContainText(`${fmt(m.price_in_per_mtok)} ${m.currency} entrada`);
    await expect(page.getByTestId("llm-price")).toContainText(`${fmt(m.price_out_per_mtok)} ${m.currency} salida`);
    await expect(page.getByTestId("llm-price-source")).toHaveAttribute("href", m.source_url);
  }

  // Aviso fijo junto al campo, en dos líneas como mucho.
  const note = page.getByTestId("llm-key-note");
  const lines = await note.evaluate((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
  expect(lines).toBeLessThanOrEqual(2.05);
  await expect(keyField(page)).toHaveAccessibleDescription(/no se guarda/);
  // Con clave, la etiqueta y «En memoria» caben en una sola fila, cada una en una línea.
  await keyField(page).fill(SENTINEL);
  const label = (await panel(page).getByText("Clave de Anthropic").boundingBox())!;
  const state = (await page.getByTestId("llm-key-state").boundingBox())!;
  expect(Math.abs(label.y + label.height / 2 - (state.y + state.height / 2))).toBeLessThan(4);
  expect(label.height).toBeLessThan(20);
  expect(state.height).toBeLessThan(24);

  // Cada papel con su «?».
  for (const term of ["llm_direct", "llm_agent", "tokens"]) {
    await expect(panel(page).locator(`[data-testid="help-button"][data-help="${term}"]`)).toBeVisible();
  }

  const width = page.viewportSize()!.width;
  expect(await pageHeight(page)).toBeLessThanOrEqual(MAX_HEIGHT[width]);
  await expectNoHorizontalOverflow(page);
  await expectBodyText16(page, '[data-testid="live-panel"]');
  const targets = panel(page).locator(
    '[data-testid="llm-key"], [data-testid="llm-forget"], [data-testid="llm-role"], [data-testid="llm-model"], label:has([data-testid="llm-recheck"]), [data-testid="llm-start"]',
  );
  expect(await targets.count()).toBe(7);
  for (const el of await targets.all()) {
    const box = (await el.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(43.5);
  }
  await closePanel(page);

  // «Explicar», en reposo, va sobre el final de la línea del run_id: no suma altura al detalle.
  const button = page.getByTestId("explain-button");
  await button.scrollIntoViewIfNeeded();
  const b = (await button.boundingBox())!;
  const runId = (await page.getByTestId("detail-run-id").boundingBox())!;
  expect(Math.abs(b.y + b.height / 2 - (runId.y + runId.height / 2))).toBeLessThan(3);
  expect((await page.getByTestId("explain").boundingBox())!.height).toBeLessThanOrEqual(1);
  // Su zona pulsable mide 44 px de alto o más (la amplía un pseudo-elemento).
  const hits = await button.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    return [y - 22, y + 22].map((py) => {
      const hit = document.elementFromPoint(x, py);
      return hit === el || el.contains(hit);
    });
  });
  expect(hits).toEqual([true, true]);
});
