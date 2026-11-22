import type { Pair } from "@/lib/i18n";
import type { components } from "@/lib/types";

type S = components["schemas"];

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export type ApiErrorKind =
  | "network" // sin respuesta (servicio apagado, CORS, red)
  | "aborted" // cancelada con AbortSignal
  | "validation" // 422 de campos
  | "csv" // 422 de filas de un CSV
  | "auth" // 401
  | "rate-limit" // 429
  | "unavailable" // 503
  | "provider" // 502
  | "payload" // 411 y 413
  | "server"; // 500 y el resto

export type CsvRowError = { row: number; msg: string };

export class ApiError extends Error {
  readonly status: number;
  readonly kind: ApiErrorKind;
  readonly rows?: CsvRowError[];
  readonly fields?: Record<string, string>;
  readonly retryAfterS?: number;
  /**
   * El mensaje en los dos idiomas. El servicio responde en español: `es` es lo que dijo y `en` la
   * traducción de los errores conocidos, por estado HTTP y situación. Para la pantalla, `t(e.text)`.
   */
  readonly text: Pair;

  constructor(init: {
    status: number;
    kind: ApiErrorKind;
    message: string;
    rows?: CsvRowError[];
    fields?: Record<string, string>;
    retryAfterS?: number;
    text?: Pair;
  }) {
    super(init.message);
    this.text = init.text ?? { es: init.message, en: init.message };
    this.name = "ApiError";
    this.status = init.status;
    this.kind = init.kind;
    this.rows = init.rows;
    this.fields = init.fields;
    this.retryAfterS = init.retryAfterS;
  }
}

function kindOf(status: number): ApiErrorKind {
  if (status === 401) return "auth";
  if (status === 411 || status === 413) return "payload";
  if (status === 422) return "validation";
  if (status === 429) return "rate-limit";
  if (status === 502) return "provider";
  if (status === 503) return "unavailable";
  return "server";
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Traducción al inglés de un `detail` de texto del servicio, según su estado y lo que cuenta. */
function englishDetail(status: number, kind: ApiErrorKind, detail: string, retryAfterS?: number): string {
  const retry = retryAfterS !== undefined ? ` Try again in ${Math.ceil(retryAfterS)} s.` : "";
  if (kind === "auth") return "The API key is missing or was not accepted.";
  if (kind === "rate-limit") {
    return /geocodificaci/i.test(detail)
      ? "Daily geocoding limit reached. It resets at 00:00 UTC. Meanwhile, the CSV accepts LAT and LON instead of ADDRESS."
      : `Too many requests or usage limit reached (error 429).${retry}`;
  }
  if (kind === "unavailable") {
    if (/geocodificaci/i.test(detail)) return "Geocoding is not available: it has not been set up.";
    if (/otro c[aá]lculo/i.test(detail)) return `The service is busy with another calculation.${retry}`;
    return `The service is unavailable.${retry}`;
  }
  if (kind === "provider") return "The model provider failed (error 502).";
  if (kind === "payload") return "The case is too large for the service.";
  if (kind === "validation") return "The request is not valid.";
  return status === 500 ? "Internal error in the service." : `Service error (${status}).`;
}

/** Convierte una respuesta de error del servicio en un `ApiError`. */
export async function errorFromResponse(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const detail = (body as { detail?: unknown } | null)?.detail;
  const retryAfterS = parseRetryAfter(res.headers.get("Retry-After"));

  if (typeof detail === "string") {
    const kind = kindOf(res.status);
    return new ApiError({
      status: res.status,
      kind,
      message: detail,
      retryAfterS,
      text: { es: detail, en: englishDetail(res.status, kind, detail, retryAfterS) },
    });
  }

  if (Array.isArray(detail) && res.status === 422) {
    const items = detail as Array<Record<string, unknown>>;
    if (items.length > 0 && items.every((i) => typeof i.row === "number")) {
      const rows = items.map((i) => ({ row: i.row as number, msg: String(i.msg ?? "") }));
      return new ApiError({
        status: 422,
        kind: "csv",
        message: `El CSV tiene ${rows.length} ${rows.length === 1 ? "fila con error" : "filas con error"}`,
        rows,
        // Los errores por fila los redacta el servicio en español: el aviso de la intro lo dice.
        text: {
          es: `El CSV tiene ${rows.length} ${rows.length === 1 ? "fila con error" : "filas con error"}`,
          en: `Errors in your CSV (${rows.length} ${rows.length === 1 ? "row" : "rows"}, listed in Spanish)`,
        },
      });
    }
    const fields: Record<string, string> = {};
    for (const i of items) {
      const loc = String(i.loc ?? "");
      if (!(loc in fields)) fields[loc] = String(i.msg ?? "");
    }
    const first = items[0];
    return new ApiError({
      status: 422,
      kind: "validation",
      message: first ? `${String(first.loc ?? "")}: ${String(first.msg ?? "")}` : "Petición no válida",
      fields,
      text: {
        es: first ? `${String(first.loc ?? "")}: ${String(first.msg ?? "")}` : "Petición no válida",
        en: first?.loc ? `The request is not valid (${String(first.loc)}).` : "The request is not valid.",
      },
    });
  }

  return new ApiError({
    status: res.status,
    kind: kindOf(res.status),
    message: `Error ${res.status}`,
    retryAfterS,
    text: { es: `Error ${res.status}`, en: `Error ${res.status}` },
  });
}

type Options = { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> };

async function request<T>(path: string, { method = "GET", body, signal, headers }: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      signal,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new ApiError({ status: 0, kind: "aborted", message: "Petición cancelada", text: { es: "Petición cancelada", en: "Request canceled" } });
    }
    throw new ApiError({
      status: 0,
      kind: "network",
      message: "No se pudo contactar con el servicio",
      text: { es: "No se pudo contactar con el servicio", en: "Could not reach the service" },
    });
  }
  if (!res.ok) throw await errorFromResponse(res);
  return (await res.json()) as T;
}

export const health = (signal?: AbortSignal) => request<S["HealthResponse"]>("/health", { signal });

export const models = (signal?: AbortSignal) => request<S["ModelsResponse"]>("/models", { signal });

export const parseCsv = (body: S["ParseCsvRequest"], signal?: AbortSignal) =>
  request<S["Instance"]>("/instances/parse-csv", { method: "POST", body, signal });

export const geocode = (body: S["GeocodeRequest"], signal?: AbortSignal) =>
  request<S["GeocodeResponse"]>("/geocode", { method: "POST", body, signal });

export const matrix = (body: S["MatrixRequest"], signal?: AbortSignal) =>
  request<S["Matrix"]>("/matrix", { method: "POST", body, signal });

export const solveClassic = (body: S["SolveRequest"], signal?: AbortSignal) =>
  request<S["RunRecord"]>("/solve/classic", { method: "POST", body, signal });

export const evaluate = (body: S["EvaluateRequest"], signal?: AbortSignal) =>
  request<S["Evaluation"]>("/evaluate", { method: "POST", body, signal });

/** La clave del visitante solo viaja aquí y en `explain`, en la cabecera `X-LLM-Key`. */
export const solveLlm = (body: S["SolveLlmRequest"], llmKey: string, signal?: AbortSignal) =>
  request<S["RunRecord"]>("/solve/llm", { method: "POST", body, signal, headers: { "X-LLM-Key": llmKey } });

export const explain = (body: S["ExplainRequest"], llmKey: string, signal?: AbortSignal) =>
  request<S["ExplainResponse"]>("/explain", { method: "POST", body, signal, headers: { "X-LLM-Key": llmKey } });
