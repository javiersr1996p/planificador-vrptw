"use client";

import { useState } from "react";
import { Help } from "@/components/ui/Help";
import { formatCost, formatDuration, formatNumber } from "@/lib/format";
import { GLOSSARY, type GlossaryTerm } from "@/lib/glossary";
import { groupViolations, methodLabel, unreadableReason } from "@/lib/labels";
import type { components } from "@/lib/types";
import { CasePlane, lateCustomers } from "./CasePlane";
import { METHOD_IDEAS } from "./Ideas";
import type { CaseState } from "./LearnStory";
import { Stage, StateIcon } from "./parts";
import { SceneFrame } from "./SceneFrame";

type S = components["schemas"];
type Run = S["RunRecord"];

const ORDER = ["heuristic", "aco", "ga", "tabu"];

export const solved = (r: Run): r is Run & { evaluation: S["Evaluation"] } =>
  r.parse_status === "ok" && r.evaluation != null && r.solution != null;

/** Una línea con las violaciones: «fuera de ventana (4)». */
export const violationText = (ev: S["Evaluation"]) =>
  groupViolations(ev.violations)
    .map((g) => `${g.label} (${g.count})`)
    .join(", ");

/** Rutas de una solución en forma canónica, para saber si dos planes son el mismo. */
export const planKey = (routes: number[][]) =>
  routes
    .map((r) => r.join("-"))
    .sort()
    .join("|");

/** Mensaje mientras se lee el caso, o si no se pudo leer. */
export function CaseFallback({ data, onRetry }: { data: CaseState; onRetry: () => void }) {
  if (data.status === "error")
    return (
      <div className="flex flex-col items-start gap-3 rounded-panel border border-late/50 bg-late/10 p-5" role="alert">
        <p className="text-base">No se pudo leer el caso de ejemplo.</p>
        <button type="button" className="btn" onClick={onRetry}>
          Reintentar
        </button>
      </div>
    );
  return (
    <p className="rounded-panel border border-line p-5 text-base text-fg-2" aria-busy="true">
      Leyendo el caso de ejemplo…
    </p>
  );
}

/** Escena 5: los cuatro métodos clásicos, su idea y su resultado real en el caso. */
export function SceneMethods({ data, motion, onRetry }: { data: CaseState; motion: boolean; onRetry: () => void }) {
  const [pick, setPick] = useState(ORDER[0]);
  if (data.status !== "ready")
    return (
      <SceneFrame n={5} title="Cuatro métodos, un mismo caso" real lead="Así resolvió cada método un caso real del trabajo." stage={<CaseFallback data={data} onRetry={onRetry} />} />
    );

  const { instance, runs: all } = data.file;
  const runs = all
    .filter((r) => r.role === "classic")
    .sort((a, b) => ORDER.indexOf(a.method) - ORDER.indexOf(b.method));
  const valid = runs.filter(solved).filter((r) => r.evaluation.feasible);
  const best = valid.reduce<Run | null>((b, r) => (!b || r.evaluation!.score < b.evaluation!.score ? r : b), null);
  const max = Math.max(1e-9, ...runs.filter(solved).map((r) => r.evaluation.score));
  const cheaper = best ? runs.filter(solved).filter((r) => !r.evaluation.feasible && r.evaluation.score < best.evaluation!.score) : [];
  const current = runs.find((r) => r.method === pick) ?? runs[0];
  const Idea = current ? METHOD_IDEAS[current.method] : undefined;
  const entry = current && current.method in GLOSSARY ? GLOSSARY[current.method as GlossaryTerm] : undefined;

  return (
    <SceneFrame
      n={5}
      title="Cuatro métodos, un mismo caso"
      real
      lead={`Así resolvió cada método «${instance.name}»: ${instance.customers.length} clientes, hasta ${instance.fleet.vehicles} furgonetas.`}
      controls={
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="Métodos" className="flex flex-col gap-1">
            {runs.map((r) => {
              const ev = solved(r) ? r.evaluation : null;
              const isBest = r === best;
              return (
                <button
                  key={r.run_id}
                  type="button"
                  aria-pressed={r === current}
                  data-testid="learn-method"
                  data-method={r.method}
                  data-run-id={r.run_id}
                  onClick={() => setPick(r.method)}
                  className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-hud border px-3 py-1.5 text-left transition-[background-color,border-color] duration-200 ease-[var(--ease-out)] ${
                    r === current ? "border-amber/60 bg-amber/[0.08]" : "border-line bg-white/[0.03] [@media(hover:hover)]:hover:bg-white/[0.07]"
                  }`}
                >
                  <span className="min-w-0 truncate text-base leading-tight font-semibold">{methodLabel(r.method)}</span>
                  <span className="num text-right text-base leading-none font-semibold" data-testid="learn-cost">
                    {ev ? formatCost(ev.score) : "–"}
                  </span>
                  {ev && (
                    <span aria-hidden="true" className="col-span-2 flex h-2 overflow-hidden rounded-full bg-white/[0.06]">
                      <span
                        className={isBest ? "bg-amber shadow-[0_0_10px_rgb(255_181_71/0.7)]" : "bg-[#7f9dce]"}
                        style={{ width: `${(ev.distance / max) * 100}%` }}
                      />
                      <span className={isBest ? "bg-amber/40" : "bg-[#7f9dce]/35"} style={{ width: `${((ev.score - ev.distance) / max) * 100}%` }} />
                    </span>
                  )}
                  <span className="flex min-w-0 items-center gap-2 text-base leading-tight" data-testid="learn-validity">
                    {ev ? (
                      <>
                        <StateIcon state={ev.feasible ? "ok" : "bad"} className="size-4 flex-none" />
                        <span className={`truncate ${ev.feasible ? "text-ok" : "text-late"}`}>{ev.feasible ? "Válido" : `No válido: ${violationText(ev)}`}</span>
                        {isBest && (
                          <span className="rounded-full bg-amber px-[7px] py-[3px] font-mono text-[12px] leading-none font-bold tracking-[0.08em] whitespace-nowrap text-amber-ink uppercase">
                            Mejor válida
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="truncate text-fg-2">Sin respuesta legible: {unreadableReason(r)}</span>
                    )}
                  </span>
                  <span className="flex items-center justify-end gap-1.5 text-base leading-none text-fg-2">
                    <VanIcon />
                    <span className="sr-only">furgonetas:</span>
                    <span data-testid="learn-vehicles">{ev ? ev.vehicles_used : "–"}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-fg-2" aria-hidden="true">
            <span className="flex items-center gap-2">
              <span className="h-2 w-6 rounded-full bg-[#7f9dce]" />
              distancia
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2 w-6 rounded-full bg-[#7f9dce]/35" />
              furgonetas y multas
            </span>
          </p>
          {best && (
            <p className="text-base leading-snug text-fg" data-testid="learn-methods-summary">
              {cheaper.length > 0
                ? `Más baratos que la mejor válida, pero no valen: ${cheaper.map((r) => methodLabel(r.method)).join(" y ")}.`
                : `Mejor válida: ${methodLabel(best.method)}.`}
            </p>
          )}
        </div>
      }
      stage={
        current && (
          <Stage className="grid gap-4 p-4 sm:p-8 lg:min-h-[560px] lg:grid-cols-[minmax(0,1fr)_minmax(0,330px)] lg:gap-6" data-dense="true" data-testid="learn-run-detail" data-run-id={current.run_id}>
            <div className="flex min-w-0 flex-col gap-3">
              <p className="kicker">La idea</p>
              <h3 className="flex items-center gap-2 text-[28px] font-bold">
                {methodLabel(current.method)}
                {entry && <Help term={current.method as GlossaryTerm} size="sm" />}
              </h3>
              <div className="max-w-[380px]">{Idea && <Idea key={current.method} motion={motion} />}</div>
              {entry && <p className="text-base leading-snug text-fg-2">{entry.text}</p>}
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <p className="kicker">Su plan</p>
              <CasePlane
                key={current.run_id}
                instance={instance}
                routes={current.solution?.routes ?? null}
                late={lateCustomers(current.evaluation)}
                label={planLabel(current)}
                className="max-w-[240px] lg:max-w-[330px]"
              />
              {solved(current) && (
                <dl className="grid grid-cols-3 gap-2 text-base">
                  <Fact label="Distancia" value={formatNumber(current.evaluation.distance, 1)} testId="learn-distance" />
                  <Fact label="Retraso" value={formatNumber(current.evaluation.total_late, 1)} testId="learn-late" />
                  <Fact label="Cálculo" value={formatDuration(current.wall_time_s)} testId="learn-time" />
                </dl>
              )}
              <RunId id={current.run_id} />
            </div>
          </Stage>
        )
      }
    />
  );
}

/** Texto alternativo del plano: rutas por furgoneta y clientes con retraso. */
export function planLabel(r: Run): string {
  const routes = r.solution?.routes;
  if (!routes) return `${methodLabel(r.method)}: sin respuesta legible, sin rutas.`;
  const late = [...lateCustomers(r.evaluation)];
  return `Plan de ${methodLabel(r.method)}: ${routes.map((x, i) => `F${i + 1} visita ${x.join(", ")}`).join("; ")}.${
    late.length ? ` Llega tarde a ${late.join(", ")}.` : ""
  }`;
}

function VanIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className="size-4 flex-none text-fg-3">
      <path d="M1 4h8v7H1zM9.5 6h3l2.5 2.5V11h-5.5z" />
      <circle cx="4" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
    </svg>
  );
}

export function Fact({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="min-w-0 rounded-hud border border-line bg-ink-0/60 px-2.5 py-2">
      <dt className="font-mono text-[12px] leading-none font-semibold tracking-[0.04em] text-fg-3 uppercase">{label}</dt>
      <dd className="num mt-1.5 truncate text-base leading-none font-semibold" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/** Identificador de la ejecución, siempre a la vista. */
export function RunId({ id }: { id: string }) {
  return (
    <p className="font-mono text-[12px] leading-snug tracking-[0.06em] break-all text-fg-3 uppercase">
      run_id <span data-testid="learn-run-id">{id}</span>
    </p>
  );
}
