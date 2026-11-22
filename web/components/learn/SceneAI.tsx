"use client";

import { useState } from "react";
import { Help } from "@/components/ui/Help";
import { useFormat } from "@/lib/format";
import { GLOSSARY } from "@/lib/glossary";
import { useT, type Pair } from "@/lib/i18n";
import { methodLabel, unreadableReason } from "@/lib/labels";
import type { components } from "@/lib/types";
import { CasePlane, lateCustomers } from "./CasePlane";
import { AgentIdea, DirectIdea } from "./Ideas";
import type { CaseState } from "./LearnStory";
import { Stage, StateIcon } from "./parts";
import { SceneFrame } from "./SceneFrame";
import { CaseFallback, Fact, RunId, planKey, planLabel, solved, violationText } from "./SceneMethods";

type S = components["schemas"];
type Run = S["RunRecord"];

const ROLES = [
  { role: "llm_direct", term: "llm_direct", title: "Resolvedor directo" },
  { role: "llm_agent", term: "llm_agent", title: "Agente con herramientas" },
] as const;

type ToolCall = { name?: string; arguments?: { method?: string } };

/** Pasos de la traza del agente: cada método lanzado y las evaluaciones seguidas, agrupadas. */
function traceSteps(r: Run, t: (pair: Pair) => string): string[] {
  const calls = (Array.isArray(r.tool_calls) ? r.tool_calls : []) as ToolCall[];
  const steps: { label: string; n: number }[] = [];
  for (const c of calls) {
    const label =
      c.name === "solve_classic" ? `Lanza ${t(methodLabel(c.arguments?.method ?? "")).toLowerCase()}` : c.name === "evaluate_routes" ? "Evalúa" : (c.name ?? "Herramienta");
    const last = steps[steps.length - 1];
    if (last && last.label === label && label === "Evalúa") last.n += 1;
    else steps.push({ label, n: 1 });
  }
  return steps.map((s) => (s.label === "Evalúa" ? `Evalúa ${s.n} ${s.n === 1 ? "plan" : "planes"}` : s.label));
}

const modelOf = (r: Run) => r.model_returned ?? r.model_requested ?? "modelo";

/** Escena 6: la IA como resolvedor directo y como agente, con sus ejecuciones reales. */
export function SceneAI({ data, motion, onRetry }: { data: CaseState; motion: boolean; onRetry: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const t = useT();
  const { formatDuration, formatNumber } = useFormat();
  if (data.status !== "ready")
    return (
      <SceneFrame n={6} title="¿Y si lo resuelve una IA?" real lead="Ejecuciones reales de modelos de lenguaje en el mismo caso." stage={<CaseFallback data={data} onRetry={onRetry} />} />
    );

  const { instance, runs: all } = data.file;
  const llm = all.filter((r) => r.role !== "classic");
  const classicByPlan = new Map(all.filter((r) => r.role === "classic" && r.solution).map((r) => [planKey(r.solution!.routes), r]));
  const current = llm.find((r) => r.run_id === pick) ?? llm.find(solved) ?? llm[0];
  const validCount = llm.filter((r) => solved(r) && r.evaluation.feasible).length;
  const unreadable = llm.filter((r) => !solved(r)).length;
  const role = ROLES.find((x) => x.role === current?.role) ?? ROLES[0];

  return (
    <SceneFrame
      n={6}
      title="¿Y si lo resuelve una IA?"
      real
      lead="Un modelo de lenguaje puede escribir el plan de una vez o usar los métodos como herramientas y corregir."
      controls={
        <div className="flex flex-col gap-3">
          <figure className="flex flex-col gap-1 rounded-hud border border-line bg-ink-0/50 p-3" data-testid="learn-ai-idea" data-role={role.role}>
            <figcaption className="flex items-center gap-2 text-base leading-tight font-semibold">
              {role.title}
              <Help term={role.term} size="sm" />
            </figcaption>
            <div className="mx-auto w-full max-w-[300px]">
              {role.role === "llm_agent" ? <AgentIdea key="agente" motion={motion} /> : <DirectIdea key="directo" motion={motion} />}
            </div>
          </figure>
          <p className="text-base leading-snug text-fg" data-testid="learn-ai-summary">
            En este caso, {validCount} de {llm.length} ejecuciones con IA dieron un plan válido y {unreadable} no dejaron una respuesta legible.
          </p>
          <p className="text-base leading-snug text-fg-2">
            Cada una gasta{" "}
            <span className="whitespace-nowrap">
              <span className="term-mark text-fg">tokens</span>
              <Help term="tokens" size="sm" className="ml-1.5" />
            </span>
            , con su coste en euros.
          </p>
        </div>
      }
      stage={
        <Stage className="flex flex-col gap-4 p-4 sm:p-8 lg:min-h-[560px] lg:gap-5" data-dense="true">
          <div className="grid gap-4 md:grid-cols-2">
            {ROLES.map((x) => (
              <div key={x.role} className="flex min-w-0 flex-col gap-1.5" role="group" aria-label={x.title}>
                <p className="kicker">{x.title}</p>
                {llm
                  .filter((r) => r.role === x.role)
                  .map((r) => (
                    <RunCard key={r.run_id} run={r} selected={r === current} onSelect={() => setPick(r.run_id)} />
                  ))}
              </div>
            ))}
          </div>
          {current && (
            <div
              className="grid min-h-0 gap-4 border-t border-line pt-4 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]"
              data-testid="learn-llm-detail"
              data-run-id={current.run_id}
            >
              <CasePlane
                instance={instance}
                routes={current.solution?.routes ?? null}
                late={lateCustomers(current.evaluation)}
                label={planLabel(current, t)}
                key={current.run_id}
                className="max-w-[240px] sm:max-w-none"
              >
                {!solved(current) && (
                  <span className="absolute inset-x-3 top-1/2 z-[3] -translate-y-1/2 rounded-hud border border-late/60 bg-[#1f0d10]/95 px-3 py-2 text-center text-base leading-snug">
                    Sin plan: {t(unreadableReason(current))}
                  </span>
                )}
              </CasePlane>
              <div className="flex min-w-0 flex-col gap-3">
                <p className="text-base leading-snug">
                  <span className="font-semibold">{modelOf(current)}</span>
                  <span className="text-fg-2"> · {current.role === "llm_agent" ? t(GLOSSARY.llm_agent.hint) : t(GLOSSARY.llm_direct.hint)}</span>
                </p>
                <dl className="grid grid-cols-3 gap-2">
                  <Fact label="Tiempo" value={formatDuration(current.wall_time_s)} testId="learn-llm-time" />
                  <Fact label="Furgonetas" value={solved(current) ? String(current.evaluation.vehicles_used) : "–"} />
                  <Fact label="Retraso" value={solved(current) ? formatNumber(current.evaluation.total_late, 1) : "–"} />
                </dl>
                {current.role === "llm_agent" && (
                  <ol className="flex flex-wrap items-center gap-1.5 text-base" aria-label="Lo que hizo el agente" data-testid="learn-trace">
                    {[...traceSteps(current, t), solved(current) ? "Entrega su plan" : "Se queda sin respuesta"].map((step, i, list) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <span
                          className={`rounded-tag border px-2 py-1 leading-tight ${
                            i === list.length - 1 ? (solved(current) ? "border-amber/60 text-amber" : "border-late/60 text-late") : "border-line-2 text-fg-2"
                          }`}
                        >
                          {step}
                        </span>
                        {i < list.length - 1 && (
                          <span aria-hidden="true" className="text-fg-3">
                            →
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                {current.solution && classicByPlan.has(planKey(current.solution.routes)) && (
                  <p className="text-base leading-snug text-fg" data-testid="learn-same-plan">
                    Es el mismo plan que dio {t(methodLabel(classicByPlan.get(planKey(current.solution.routes))!.method))} en la escena anterior.
                  </p>
                )}
                <RunId id={current.run_id} />
              </div>
            </div>
          )}
        </Stage>
      }
    />
  );
}

/**
 * Tarjeta de una ejecución: modelo, resultado (o por qué no lo hay), tokens y coste.
 * En móvil, las no elegidas se quedan en una línea (icono, modelo y coste); el resto
 * sigue ahí para los lectores de pantalla.
 */
function RunCard({ run, selected, onSelect }: { run: Run; selected: boolean; onSelect: () => void }) {
  const t = useT();
  const { formatCost, formatEuro, formatNumber } = useFormat();
  const ev = solved(run) ? run.evaluation : null;
  const state = ev ? (ev.feasible ? "ok" : "bad") : "bad";
  const folded = selected ? "" : "max-lg:sr-only";
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-testid="learn-llm-run"
      data-run-id={run.run_id}
      data-role={run.role}
      onClick={onSelect}
      className={`flex min-h-11 min-w-0 cursor-pointer flex-col justify-center gap-1 rounded-hud border px-3 py-2 text-left transition-[background-color,border-color] duration-200 ease-[var(--ease-out)] ${
        selected ? "border-amber/60 bg-amber/[0.08]" : "border-line bg-white/[0.03] [@media(hover:hover)]:hover:bg-white/[0.07]"
      }`}
    >
      <span className="flex w-full items-baseline justify-between gap-2 text-base leading-tight">
        {!selected && <StateIcon state={state} className="size-4 flex-none self-center lg:hidden" />}
        <span className="mr-auto truncate font-semibold">{modelOf(run)}</span>
        {ev && (
          <span className="num font-semibold" data-testid="learn-llm-cost">
            {formatCost(ev.score)}
          </span>
        )}
      </span>
      <span className={`flex items-center gap-1.5 text-base leading-tight ${folded}`}>
        <StateIcon state={state} className="size-4 flex-none" />
        <span className={ev?.feasible ? "text-ok" : "text-late"} data-testid="learn-llm-status">
          {ev ? (ev.feasible ? "Válido" : `No válido: ${violationText(ev, t)}`) : `Sin respuesta legible: ${t(unreadableReason(run))}`}
        </span>
      </span>
      <span className={`text-base leading-tight text-fg-3 tabular-nums ${folded}`}>
        <span data-testid="learn-llm-tokens">
          {run.tokens_in != null && run.tokens_out != null ? `${formatNumber(run.tokens_in, 0)} / ${formatNumber(run.tokens_out, 0)} tokens` : "–"}
        </span>
        {run.api_cost_eur != null && (
          <>
            {" · "}
            <span data-testid="learn-llm-eur">{formatEuro(run.api_cost_eur)}</span>
          </>
        )}
      </span>
    </button>
  );
}
