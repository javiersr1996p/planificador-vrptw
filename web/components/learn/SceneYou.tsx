"use client";

import Link from "next/link";
import type { RefObject } from "react";
import { vehicleColor } from "@/components/planner/units";
import { buttonClass } from "@/components/ui/Button";
import { Arrow, BaseMarker, RouteSegments, Stage, StageSvg, at } from "./parts";
import { SceneFrame } from "./SceneFrame";
import { Vans } from "./SceneProblem";
import { TOY_BASE, TOY_CLIENTS, TOY_PLANS, loopStops } from "./toy";

const RECAP = ["Rutas", "Ventanas", "Capacidad", "Coste", "Métodos", "IA"];
const PLAN = TOY_PLANS.find((p) => p.late.length === 0 && p.unserved.length === 0)!;

/** Escena 7: de la historia al planificador. */
export function SceneYou({
  motion,
  ctaRef,
  onPick,
}: {
  motion: boolean;
  ctaRef: RefObject<HTMLAnchorElement | null>;
  onPick: (scene: number) => void;
}) {
  return (
    <SceneFrame
      n={7}
      title="Ahora tú"
      lead="En el planificador eliges un caso, reproduces el día con su reloj y comparas los métodos con cifras reales."
      controls={
        <div className="flex flex-col gap-4">
          <Link ref={ctaRef} href="/" className={buttonClass("primary", "h-14 self-start px-6 text-lg")} data-testid="learn-go">
            Abrir el planificador
            <Arrow />
          </Link>
          <div>
            <p className="kicker mb-2">Repasar</p>
            <ul className="flex flex-wrap gap-2">
              {RECAP.map((label, i) => (
                <li key={label}>
                  <button type="button" className="btn" onClick={() => onPick(i)}>
                    <span className="font-mono text-[12px] text-amber uppercase">{i + 1}</span>
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      }
      stage={
        <Stage className="h-[320px] sm:h-[420px] lg:h-[560px]">
          <StageSvg>
            {PLAN.routes.map((r, v) => (
              <RouteSegments key={v} stops={loopStops(r)} color={vehicleColor(v)} />
            ))}
          </StageSvg>
          <div className="absolute top-1/2 left-1/2 aspect-square w-[80%] -translate-1/2" aria-hidden="true">
            <div
              className="decor size-full rounded-full"
              style={{
                background: "conic-gradient(from 0deg, rgb(255 181 71 / 0.16), transparent 18%, transparent)",
                animation: "sweep 8s linear infinite",
              }}
            />
          </div>
          <BaseMarker pt={TOY_BASE} />
          {TOY_CLIENTS.map((c) => {
            const v = PLAN.routes.findIndex((r) => r.includes(c.id));
            return (
              <span
                key={c.id}
                aria-hidden="true"
                className="absolute z-[2] grid size-10 -translate-1/2 place-items-center rounded-full border-2 text-base font-bold text-fg"
                style={{ ...at(c), borderColor: vehicleColor(v), background: `color-mix(in srgb, ${vehicleColor(v)} 22%, #07101f)` }}
              >
                {c.id}
              </span>
            );
          })}
          {motion && <Vans routes={PLAN.routes} loop />}
        </Stage>
      }
    />
  );
}
