import { expect, test } from "@playwright/test";
import { ApiError, health, parseCsv, solveClassic, solveLlm } from "../lib/api";
import type { components } from "../lib/types";

type Fleet = components["schemas"]["Fleet"];
const FLEET = {} as Fleet;
const originalFetch = globalThis.fetch;

function stub(status: number, body: unknown, headers: Record<string, string> = {}) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    })) as typeof fetch;
}

async function failure(call: () => Promise<unknown>): Promise<ApiError> {
  try {
    await call();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error("la llamada debía fallar");
}

test.describe("lib/api", () => {
  test.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("422 de campos: kind validation y fields por loc", async () => {
    stub(422, { detail: [{ loc: "instance.customers.3.due", msg: "debe ser positivo" }] });
    const err = await failure(() => solveClassic({ instance: {} as never, method: "heuristic", seed: 0, time_limit_s: 30 }));
    expect(err.status).toBe(422);
    expect(err.kind).toBe("validation");
    expect(err.fields).toEqual({ "instance.customers.3.due": "debe ser positivo" });
    expect(err.message).toContain("instance.customers.3.due");
  });

  test("422 de filas de CSV: kind csv y rows", async () => {
    stub(422, { detail: [{ row: 2, msg: "falta la dirección" }, { row: 5, msg: "demanda negativa" }] });
    const err = await failure(() => parseCsv({ csv: "x", name: "n", fleet: FLEET }));
    expect(err.kind).toBe("csv");
    expect(err.rows).toEqual([
      { row: 2, msg: "falta la dirección" },
      { row: 5, msg: "demanda negativa" },
    ]);
  });

  test("503 con Retry-After: kind unavailable y retryAfterS", async () => {
    stub(503, { detail: "otro cálculo en curso" }, { "Retry-After": "5" });
    const err = await failure(() => solveClassic({ instance: {} as never, method: "aco", seed: 0, time_limit_s: 30 }));
    expect(err.status).toBe(503);
    expect(err.kind).toBe("unavailable");
    expect(err.retryAfterS).toBe(5);
    expect(err.message).toBe("otro cálculo en curso");
  });

  test("detail de texto: 401, 429 y 502 con su kind", async () => {
    for (const [status, kind] of [
      [401, "auth"],
      [429, "rate-limit"],
      [502, "provider"],
      [500, "server"],
    ] as const) {
      stub(status, { detail: "texto" });
      const err = await failure(() => health());
      expect(err.kind).toBe(kind);
      expect(err.message).toBe("texto");
    }
  });

  test("red caída: kind network sin estado", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const err = await failure(() => health());
    expect(err.kind).toBe("network");
    expect(err.status).toBe(0);
  });

  test("cancelación: kind aborted", async () => {
    globalThis.fetch = (async () => {
      throw new DOMException("cancelada", "AbortError");
    }) as typeof fetch;
    const err = await failure(() => health(new AbortController().signal));
    expect(err.kind).toBe("aborted");
  });

  test("X-LLM-Key solo viaja en la cabecera de solveLlm y no en el cuerpo", async () => {
    let seen: { headers: Headers; body: string } | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      seen = { headers: new Headers(init?.headers), body: String(init?.body) };
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    await solveLlm(
      { instance: {} as never, model: "m", role: "llm_direct", recheck: false, seed: 0 },
      "sk-ant-centinela-09",
    );
    expect(seen!.headers.get("X-LLM-Key")).toBe("sk-ant-centinela-09");
    expect(seen!.body).not.toContain("sk-ant");
    await solveClassic({ instance: {} as never, method: "tabu", seed: 0, time_limit_s: 30 });
    expect(seen!.headers.has("X-LLM-Key")).toBe(false);
  });
});
