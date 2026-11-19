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

  constructor(init: {
    status: number;
    kind: ApiErrorKind;
    message: string;
    rows?: CsvRowError[];
    fields?: Record<string, string>;
    retryAfterS?: number;
  }) {
    super(init.message);
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
    return new ApiError({ status: res.status, kind: kindOf(res.status), message: detail, retryAfterS });
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
    });
  }

  return new ApiError({ status: res.status, kind: kindOf(res.status), message: `Error ${res.status}`, retryAfterS });
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
      throw new ApiError({ status: 0, kind: "aborted", message: "Petición cancelada" });
    }
    throw new ApiError({ status: 0, kind: "network", message: "No se pudo contactar con el servicio" });
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
