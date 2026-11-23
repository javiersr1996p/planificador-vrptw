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
  { role: "llm_direct", term: "llm_direct", title: { es: "Resolvedor directo", en: "Direct solver" } },
  { role: "llm_agent", term: "llm_agent", title: { es: "Agente con herramientas", en: "Agent with tools" } },
] as const;

type ToolCall = { name?: string; arguments?: { method?: string } };

/** Pasos de la traza del agente: cada método lanzado y las evaluaciones seguidas, agrupadas. */
function traceSteps(r: Run, t: (pair: Pair) => string): string[] {
  const calls = (Array.isArray(r.tool_calls) ? r.tool_calls : []) as ToolCall[];
  const steps: { label: string; evaluates: boolean; n: number }[] = [];
  for (const c of calls) {
    const evaluates = c.name === "evaluate_routes";
    const label =
      c.name === "solve_classic"
        ? t({ es: "Lanza", en: "Runs" }) + ` ${t(methodLabel(c.arguments?.method ?? "")).toLowerCase()}`
        : evaluates
          ? ""
          : (c.name ?? t({ es: "Herramienta", en: "Tool" }));
    const last = steps[steps.length - 1];
    if (last && evaluates && last.evaluates) last.n += 1;
    else steps.push({ label, evaluates, n: 1 });
  }
  return steps.map((s) =>
    s.evaluates ? t({ es: `Evalúa ${s.n} ${s.n === 1 ? "plan" : "planes"}`, en: `Evaluates ${s.n} ${s.n === 1 ? "plan" : "plans"}` }) : s.label,
  );
}

const modelOf = (r: Run, t: (pair: Pair) => string) => r.model_returned ?? r.model_requested ?? t({ es: "modelo", en: "model" });

/** Escena 6: la IA como resolvedor directo y como agente, con sus ejecuciones reales. */
export function SceneAI({ data, motion, onRetry }: { data: CaseState; motion: boolean; onRetry: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const t = useT();
  const { formatDuration, formatNumber } = useFormat();
  if (data.status !== "ready")
    return (
      <SceneFrame
        n={6}
        title={t({ es: "¿Y si lo resuelve una IA?", en: "What if an AI solves it?" })}
        real
        lead={t({ es: "Ejecuciones reales de modelos de lenguaje en el mismo caso.", en: "Real runs of language models on the same case." })}
        stage={<CaseFallback data={data} onRetry={onRetry} />}
      />
    );

  const { instance, runs: all } = data.file;
  const llm = all.filter((r) => r.role !== "classic");
  const classicByPlan = new Map(all.filter((r) => r.role === "classic" && r.solution).map((r) => [planKey(r.solution!.routes), r]));
  const current = llm.find((r) => r.run_id === pick) ?? llm.find(solved) ?? llm[0];
  const validCount = llm.filter((r) => solved(r) && r.evaluation.feasible).length;
  const unreadable = llm.filter((r) => !solved(r)).length;
  const role = ROLES.find((x) => x.role === current?.role) ?? ROLES[0];
  // Método clásico que dio en la escena anterior el mismo plan que la ejecución elegida.
  const same = current?.solution ? classicByPlan.get(planKey(current.solution.routes)) : undefined;
  const sameName = same ? t(methodLabel(same.method)) : "";

  return (
    <SceneFrame
      n={6}
      title={t({ es: "¿Y si lo resuelve una IA?", en: "What if an AI solves it?" })}
      real
      lead={t({
        es: "Un modelo de lenguaje puede escribir el plan de una vez o usar los métodos como herramientas y corregir.",
        en: "A language model can write the plan in one go, or use the methods as tools and correct itself.",
      })}
      controls={
        <div className="flex flex-col gap-3">
          <figure className="flex flex-col gap-1 rounded-hud border border-line bg-ink-0/50 p-3" data-testid="learn-ai-idea" data-role={role.role}>
            <figcaption className="flex items-center gap-2 text-base leading-tight font-semibold">
              {t(role.title)}
              <Help term={role.term} size="sm" />
            </figcaption>
            <div className="mx-auto w-full max-w-[300px]">
              {role.role === "llm_agent" ? <AgentIdea key="agente" motion={motion} /> : <DirectIdea key="directo" motion={motion} />}
            </div>
          </figure>
          <p className="text-base leading-snug text-fg" data-testid="learn-ai-summary">
            {t({
              es: `En este caso, ${validCount} de ${llm.length} ejecuciones con IA dieron un plan válido y ${unreadable} no dejaron una respuesta legible.`,
              en: `In this case, ${validCount} of ${llm.length} AI runs gave a valid plan and ${unreadable} left no readable answer.`,
            })}
          </p>
          <p className="text-base leading-snug text-fg-2">
            {t({ es: "Cada una gasta", en: "Each one uses" })}{" "}
            <span className="whitespace-nowrap">
              <span className="term-mark text-fg">tokens</span>
              <Help term="tokens" size="sm" className="ml-1.5" />
            </span>
            {t({ es: ", con su coste en euros.", en: ", with a cost in euros." })}
          </p>
        </div>
      }
      stage={
        <Stage className="flex flex-col gap-4 p-4 sm:p-8 lg:min-h-[560px] lg:gap-5" data-dense="true">
          <div className="grid gap-4 md:grid-cols-2">
            {ROLES.map((x) => (
              <div key={x.role} className="flex min-w-0 flex-col gap-1.5" role="group" aria-label={t(x.title)}>
                <p className="kicker">{t(x.title)}</p>
                {llm
                  .filter((r) => r.role === x.role)
                  .map((r) => (
                    <RunCard key={r.run_id} run={r} selected={r === current} onSelect={() => setPick(r.run_id)} />
                  ))}
              </div>
            ))}
          </div>
          {current && (
            // En móvil, plano y cifras van lado a lado y el resto ocupa las dos columnas, para no pasar del techo de altura.
            <div
              className="grid min-h-0 gap-4 border-t border-line pt-4 max-sm:grid-cols-[156px_minmax(0,1fr)] max-sm:gap-x-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]"
              data-testid="learn-llm-detail"
              data-run-id={current.run_id}
            >
              <CasePlane
                instance={instance}
                routes={current.solution?.routes ?? null}
                late={lateCustomers(current.evaluation)}
                label={planLabel(current, t)}
                key={current.run_id}
              >
                {!solved(current) && (
                  <span className="absolute inset-x-3 top-1/2 z-[3] -translate-y-1/2 rounded-hud border border-late/60 bg-[#1f0d10]/95 px-3 py-2 text-center text-base leading-snug">
                    {t({ es: "Sin plan", en: "No plan" })}: {t(unreadableReason(current))}
                  </span>
                )}
              </CasePlane>
              <div className="flex min-w-0 flex-col gap-3 max-sm:contents">
                <p className="text-base leading-snug max-sm:order-first max-sm:col-span-2">
                  <span className="font-semibold">{modelOf(current, t)}</span>
                  {/* En móvil sobra: la ilustración de arriba ya nombra el papel. */}
                  <span className="text-fg-2 max-sm:hidden"> · {current.role === "llm_agent" ? t(GLOSSARY.llm_agent.hint) : t(GLOSSARY.llm_direct.hint)}</span>
                </p>
                <dl className="grid grid-cols-3 gap-2 max-sm:grid-cols-1 max-sm:content-center max-sm:gap-1.5 max-sm:[&>div]:py-1.5">
                  <Fact label={t({ es: "Tiempo", en: "Time" })} value={formatDuration(current.wall_time_s)} testId="learn-llm-time" />
                  <Fact label={t({ es: "Furgonetas", en: "Vans" })} value={solved(current) ? String(current.evaluation.vehicles_used) : "–"} />
                  <Fact label={t({ es: "Retraso", en: "Late" })} value={solved(current) ? formatNumber(current.evaluation.total_late, 1) : "–"} />
                </dl>
                {current.role === "llm_agent" && (
                  <ol
                    className="flex flex-wrap items-center gap-1.5 text-base max-sm:col-span-2 max-sm:gap-1"
                    aria-label={t({ es: "Lo que hizo el agente", en: "What the agent did" })}
                    data-testid="learn-trace"
                  >
                    {[
                      ...traceSteps(current, t),
                      !solved(current)
                        ? t({ es: "Se queda sin respuesta", en: "Ends with no answer" })
                        : same
                          ? t({ es: `Entrega el mismo plan que ${sameName.toLowerCase()}`, en: `Submits the same plan as ${sameName.toLowerCase()}` })
                          : t({ es: "Entrega su plan", en: "Submits its plan" }),
                    ].map((step, i, list) => (
                      <li key={i} className="flex items-center gap-1.5 max-sm:gap-1">
                        <span
                          className={`rounded-tag border px-2 py-1 leading-tight max-sm:py-0.5 ${
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
                {/* En el agente, la coincidencia ya va en el último paso de la traza. */}
                {same && current.role !== "llm_agent" && (
                  <p className="text-base leading-snug text-fg max-sm:col-span-2" data-testid="learn-same-plan">
                    {t({ es: "Es el mismo plan que dio", en: "This is the same plan that" })} {sameName}{" "}
                    {t({ es: "en la escena anterior.", en: "gave in the previous scene." })}
                  </p>
                )}
                <div className="max-sm:col-span-2 max-sm:[&_p]:tracking-[-0.04em]">
                  <RunId id={current.run_id} />
                </div>
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
        <span className="mr-auto truncate font-semibold">{modelOf(run, t)}</span>
        {ev && (
          <span className="num font-semibold" data-testid="learn-llm-cost">
            {formatCost(ev.score)}
          </span>
        )}
      </span>
      <span className={`flex items-center gap-1.5 text-base leading-tight ${folded}`}>
        <StateIcon state={state} className="size-4 flex-none" />
        <span className={ev?.feasible ? "text-ok" : "text-late"} data-testid="learn-llm-status">
          {ev
            ? ev.feasible
              ? t({ es: "Válido", en: "Valid" })
              : `${t({ es: "No válido", en: "Not valid" })}: ${violationText(ev, t)}`
            : `${t({ es: "Sin respuesta legible", en: "No readable answer" })}: ${t(unreadableReason(run))}`}
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
