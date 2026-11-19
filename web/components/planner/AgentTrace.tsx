"use client";

import { formatCost, formatDuration } from "@/lib/format";
import { methodLabel, unreadableReason } from "@/lib/labels";
import type { components } from "@/lib/types";

type S = components["schemas"];

/** Resumen que devuelve cada herramienta del agente (o un mensaje, si fue un error). */
type ToolResult = { score?: number; vehicles_used?: number; feasible?: boolean };
type ToolCall = {
  name?: string;
  arguments?: { method?: string };
  is_error?: boolean;
  result?: ToolResult | string;
  time_s?: number;
};

function callLabel(call: ToolCall): string {
  if (call.name === "solve_classic") return `Resolver: ${methodLabel(call.arguments?.method ?? "?").toLowerCase()}`;
  if (call.name === "evaluate_routes") return "Evaluar rutas";
  return call.name ?? "Herramienta";
}

/** Llamadas del agente a sus herramientas y su texto final. Plegada por defecto. */
export function AgentTrace({ record }: { record: S["RunRecord"] }) {
  const calls = (record.tool_calls ?? []) as ToolCall[];
  const result = (c: ToolCall) => (!c.is_error && typeof c.result === "object" && c.result !== null ? c.result : null);
  const max = Math.max(1, ...calls.map((c) => result(c)?.score ?? 0));

  return (
    <details data-testid="agent-trace" className="group/trace rounded-tag border border-line bg-ink-0/60">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-base whitespace-nowrap text-fg-2 select-none [@media(hover:hover)]:hover:text-fg [&::-webkit-details-marker]:hidden">
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          aria-hidden="true"
          className="transition-transform duration-150 group-open/trace:rotate-90"
        >
          <path d="M4 2 L8 6 L4 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        Traza del agente
        <span className="text-fg-3 tabular-nums">· {calls.length} llamadas</span>
      </summary>
      <div className="max-h-80 overflow-y-auto border-t border-line px-3 py-2">
        <ol className="flex flex-col gap-2" aria-label="Llamadas a herramientas">
          {calls.map((call, i) => {
            const r = result(call);
            return (
              <li key={i} data-testid="trace-call" className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-base">
                <span className="num w-6 text-fg-3">{String(i + 1).padStart(2, "0")}</span>
                <span className="font-medium">{callLabel(call)}</span>
                {r ? (
                  <>
                    <span className="flex min-w-[8rem] flex-1 items-center gap-2">
                      <span aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <span
                          className={`block h-full rounded-full ${r.feasible ? "bg-fg-3" : "bg-late/70"}`}
                          style={{ width: `${((r.score ?? 0) / max) * 100}%` }}
                        />
                      </span>
                      <span className="num">{r.score !== undefined ? formatCost(r.score) : "–"}</span>
                    </span>
                    <span className="w-full pl-9 text-fg-3">
                      {r.vehicles_used ?? "–"} furgonetas · {r.feasible ? "válida" : "no válida"} ·{" "}
                      {formatDuration(call.time_s ?? NaN)}
                    </span>
                  </>
                ) : (
                  <span className="flex-1 text-late">Error: {String(call.result ?? "sin detalle")}</span>
                )}
              </li>
            );
          })}
        </ol>
        <p className="kicker mt-3 mb-1 text-fg-3">Texto final</p>
        {record.params.camouflaged === true && (
          <p data-testid="trace-camouflaged" className="mb-1 text-base leading-snug text-fg-3">
            El modelo vio el caso camuflado: sus llamadas y este texto numeran los clientes a su manera. El plan
            dibujado ya está traducido.
          </p>
        )}
        <p data-testid="trace-final" className={`text-base whitespace-pre-wrap ${record.raw_response ? "" : "text-fg-3"}`}>
          {record.raw_response ||
            `Sin texto final${record.parse_status !== "ok" ? `: ${unreadableReason(record)}` : ""}.`}
        </p>
      </div>
    </details>
  );
}
