"use client";

import { useState } from "react";
import { vehicleColor } from "@/components/planner/units";
import { Help } from "@/components/ui/Help";
import { useT, type Pair } from "@/lib/i18n";
import { BaseMarker, RouteSegments, Stage, StageSvg, StateIcon, at } from "./parts";
import { SceneFrame } from "./SceneFrame";
import { TOY_BASE, TOY_CAPACITY, TOY_CLIENTS, TOY_PLANS, loopStops, routesLength, toyClient, type ToyPlan } from "./toy";

const lengths = TOY_PLANS.map((p) => routesLength(p.routes));
const scale = Math.max(...TOY_PLANS.map((p, i) => lengths[i] + p.fine));

function rules(plan: ToyPlan) {
  const loads = plan.routes.map((r) => r.reduce((n, id) => n + toyClient(id).demand, 0));
  const rules: { label: Pair; ok: boolean; why: Pair }[] = [
    {
      label: { es: "Todos atendidos", en: "All customers served" },
      ok: plan.unserved.length === 0,
      why: { es: `${plan.unserved.join(", ")} sin atender`, en: `${plan.unserved.join(", ")} unserved` },
    },
    {
      label: { es: "Ninguna se pasa de carga", en: "No van is overloaded" },
      ok: loads.every((l) => l <= TOY_CAPACITY),
      why: { es: "una furgoneta va sobrecargada", en: "one carries too much" },
    },
    {
      label: { es: "Nadie recibe tarde", en: "No late deliveries" },
      ok: plan.late.length === 0,
      why: { es: `${plan.late.join(", ")} recibe tarde`, en: `${plan.late.join(", ")} is late` },
    },
  ];
  return rules;
}

const valid = (plan: ToyPlan) => rules(plan).every((r) => r.ok);

/** Escena 4: tres planes del mismo reparto; el más corto no siempre vale. */
export function SceneCost() {
  const t = useT();
  const [pick, setPick] = useState(0);
  const plan = TOY_PLANS[pick];
  const checks = rules(plan);
  const ok = checks.every((r) => r.ok);

  return (
    <SceneFrame
      n={4}
      title={t({ es: "El más barato no siempre vale", en: "The cheapest is not always valid" })}
      real={false}
      lead={
        <>
          {t({ es: "El", en: "The" })}{" "}
          <span className="whitespace-nowrap">
            <span className="term-mark text-fg">{t({ es: "coste", en: "cost" })}</span>
            <Help term="coste" size="sm" className="ml-1.5" />
          </span>{" "}
          {t({ es: "suma distancia y multas, pero solo cuenta entre planes que cumplen las reglas: un", en: "adds distance and penalties, but only counts among plans that follow the rules: a" })}{" "}
          <span className="whitespace-nowrap">
            <span className="term-mark text-fg">{t({ es: "plan válido", en: "valid plan" })}</span>
            <Help term="valido" size="sm" className="ml-1.5" />
          </span>
          .
        </>
      }
      controls={
        <div className="flex flex-col gap-3">
          <div role="group" aria-label={t({ es: "Planes", en: "Plans" })} className="flex flex-col gap-1.5">
            {TOY_PLANS.map((p, i) => {
              const v = valid(p);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={pick === i}
                  data-testid="toy-plan"
                  data-valid={v}
                  onClick={() => setPick(i)}
                  className={`grid min-h-12 cursor-pointer grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-hud border px-3 py-2 text-left transition-[background-color,border-color] duration-200 ease-[var(--ease-out)] ${
                    pick === i ? "border-amber/60 bg-amber/[0.08]" : "border-line bg-white/[0.03] [@media(hover:hover)]:hover:bg-white/[0.07]"
                  }`}
                >
                  <span className="text-base font-semibold">{p.name}</span>
                  <span aria-hidden="true" className="relative flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <span className="h-full bg-[linear-gradient(90deg,#34507c,#7f9dce)]" style={{ width: `${(lengths[i] / scale) * 100}%` }} />
                    <span className="lrn-hatch-late h-full" style={{ width: `${(p.fine / scale) * 100}%` }} />
                  </span>
                  <span className={`flex items-center gap-1.5 text-base font-semibold ${v ? "text-ok" : "text-late"}`}>
                    <StateIcon state={v ? "ok" : "bad"} className="size-5" />
                    {v ? t({ es: "Vale", en: "Valid" }) : t({ es: "No vale", en: "Not valid" })}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-fg-2" aria-hidden="true">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-6 rounded-full bg-[linear-gradient(90deg,#34507c,#7f9dce)]" />
              {t({ es: "distancia", en: "distance" })}
            </span>
            <span className="flex items-center gap-2">
              <span className="lrn-hatch-late h-2.5 w-6 rounded-full" />
              {t({ es: "multa", en: "penalty" })}
            </span>
          </p>
          <ul className="flex flex-col gap-1.5" aria-label={`${t({ es: "Reglas del", en: "Rules for" })} ${plan.name.toLowerCase()}`} data-testid="toy-rules">
            {checks.map((r) => (
              <li key={r.label.es} className="flex items-center gap-2.5 text-base">
                <StateIcon state={r.ok ? "ok" : "bad"} className="size-5 flex-none" />
                <span className={r.ok ? "text-fg" : "font-semibold text-late"}>{r.ok ? t(r.label) : `${t(r.label)}: no, ${t(r.why)}`}</span>
              </li>
            ))}
          </ul>
          <p className="text-base leading-snug text-fg" aria-live="polite">
            {ok
              ? t({ es: "Más largo, pero cumple todo: este es el que vale.", en: "Longer, but it meets every rule: this is the valid one." })
              : t({ es: "Sale más corto, pero incumple una regla: no vale.", en: "Shorter, but it breaks a rule: not valid." })}
          </p>
        </div>
      }
      stage={
        <Stage className="h-[340px] sm:h-[440px] lg:h-[560px]">
          <div
            role="img"
            aria-label={t({
              es: `${plan.name}: ${plan.routes.map((r, v) => `furgoneta ${v + 1} visita ${r.join(", ")}`).join("; ")}.${
                plan.late.length ? ` ${plan.late.join(", ")} recibe tarde.` : ""
              }${plan.unserved.length ? ` ${plan.unserved.join(", ")} se queda sin atender.` : ""}`,
              en: `${plan.name}: ${plan.routes.map((r, v) => `van ${v + 1} visits ${r.join(", ")}`).join("; ")}.${
                plan.late.length ? ` ${plan.late.join(", ")} is late.` : ""
              }${plan.unserved.length ? ` ${plan.unserved.join(", ")} is left unserved.` : ""}`,
            })}
            className="absolute inset-0"
          >
            <StageSvg>
              {plan.routes.map((r, v) => (
                <RouteSegments key={v} stops={loopStops(r)} color={vehicleColor(v)} />
              ))}
            </StageSvg>
            <BaseMarker pt={TOY_BASE} />
            {TOY_CLIENTS.map((c) => {
              const van = plan.routes.findIndex((r) => r.includes(c.id));
              const late = plan.late.includes(c.id);
              const out = plan.unserved.includes(c.id);
              const color = van >= 0 ? vehicleColor(van) : "var(--fg-3)";
              return (
                <span key={c.id} className="absolute z-[2] -translate-1/2" style={at(c)} aria-hidden="true">
                  {late ? (
                    <span className="grid size-10 rotate-45 place-items-center rounded-md border-2 border-late bg-[#2a0b0e] shadow-[0_0_18px_-2px_var(--late)]">
                      <span className="-rotate-45 text-base font-bold text-fg">{c.id}</span>
                    </span>
                  ) : (
                    <span
                      className="grid size-10 place-items-center rounded-full border-2 text-base font-bold text-fg"
                      style={{
                        borderColor: color,
                        borderStyle: out ? "dashed" : "solid",
                        background: out ? "#07101f" : `color-mix(in srgb, ${color} 22%, #07101f)`,
                        opacity: out ? 0.8 : 1,
                      }}
                    >
                      {c.id}
                    </span>
                  )}
                  {(late || out) && (
                    <span
                      className={`absolute top-full left-1/2 mt-1.5 -translate-x-1/2 rounded-tag px-1.5 py-0.5 font-mono text-[12px] leading-none font-bold whitespace-nowrap uppercase ${
                        late ? "bg-late text-ink-0" : "border border-fg-3 bg-ink-0 text-fg-2"
                      }`}
                    >
                      {late ? t({ es: "Llega tarde", en: "Late" }) : t({ es: "Sin atender", en: "Unserved" })}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </Stage>
      }
    />
  );
}
