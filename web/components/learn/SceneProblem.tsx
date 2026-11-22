"use client";

import { useEffect, useRef, useState } from "react";
import { vehicleColor } from "@/components/planner/units";
import { useT } from "@/lib/i18n";
import { BaseMarker, RouteSegments, Stage, StageSvg, VanGlyph, at } from "./parts";
import { SceneFrame } from "./SceneFrame";
import { TOY_BASE, TOY_CLIENTS, loopPoints, loopStops, routesLength, type Pt } from "./toy";

const VANS = 2;

/** Escena 1: el visitante traza las rutas pulsando clientes. */
export function SceneProblem({ motion }: { motion: boolean }) {
  const t = useT();
  const [routes, setRoutes] = useState<string[][]>(() => Array.from({ length: VANS }, () => []));
  const [van, setVan] = useState(0);
  const [trip, setTrip] = useState(0);

  const where = new Map<string, { van: number; pos: number }>();
  routes.forEach((r, v) => r.forEach((id, pos) => where.set(id, { van: v, pos })));
  const done = where.size === TOY_CLIENTS.length;

  function toggle(id: string) {
    const next = where.has(id) ? routes.map((r) => r.filter((x) => x !== id)) : routes.map((r, v) => (v === van ? [...r, id] : r));
    setRoutes(next);
    // Al completar el plan, las furgonetas salen a repartir.
    if (next.reduce((n, r) => n + r.length, 0) === TOY_CLIENTS.length) setTrip((t) => t + 1);
  }

  const pending = TOY_CLIENTS.filter((c) => !where.has(c.id)).map((c) => c.id);
  const status = done
    ? t({ es: "Plan completo: cada cliente, una vez. Las furgonetas salen y vuelven a la base.", en: "Plan complete: each customer, once. The vans set out and return to the depot." })
    : where.size === 0
      ? t({ es: `Pulsa un cliente para sumarlo a la ruta de la furgoneta ${van + 1}.`, en: `Tap a customer to add it to van ${van + 1}'s route.` })
      : t({
          es: `Faltan ${pending.length === 1 ? "el cliente" : "los clientes"} ${pending.join(", ")}.`,
          en: `Still missing: ${pending.length === 1 ? "customer" : "customers"} ${pending.join(", ")}.`,
        });

  return (
    <SceneFrame
      n={1}
      title={t({ es: "Repartir sin dar vueltas de más", en: "Deliver without detours" })}
      real={false}
      lead={t({
        es: "Las furgonetas salen de la base, visitan a cada cliente una vez y vuelven. El problema: quién va a cada cliente, y en qué orden.",
        en: "Vans leave the depot, visit each customer once and come back. The problem: who serves which customer, and in what order.",
      })}
      controls={
        <div className="flex flex-col gap-3">
          <div role="group" aria-label={t({ es: "Furgoneta que traza", en: "Van to draw" })} className="flex flex-wrap gap-2">
            {routes.map((_, v) => (
              <button
                key={v}
                type="button"
                className="btn"
                aria-pressed={van === v}
                data-testid="toy-van"
                onClick={() => setVan(v)}
                style={van === v ? { borderColor: vehicleColor(v), background: "rgb(255 255 255 / 0.07)" } : undefined}
              >
                <span aria-hidden="true" className="h-1 w-5 rounded-full" style={{ background: vehicleColor(v), boxShadow: `0 0 8px ${vehicleColor(v)}` }} />
                {t({ es: "Furgoneta", en: "Van" })} {v + 1}
              </button>
            ))}
          </div>
          <p className="min-h-[3em] text-base leading-snug text-fg" aria-live="polite" data-testid="toy-status">
            {status}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => setRoutes(routes.map(() => []))} disabled={where.size === 0}>
              {t({ es: "Borrar rutas", en: "Clear routes" })}
            </button>
            {done && motion && (
              <button type="button" className="btn" onClick={() => setTrip((t) => t + 1)}>
                {t({ es: "Repetir el reparto", en: "Repeat the run" })}
              </button>
            )}
          </div>
        </div>
      }
      stage={
        <Stage className="h-[340px] sm:h-[440px] lg:h-[560px]">
          <StageSvg>
            {routes.map((r, v) => (
              <RouteSegments key={v} stops={loopStops(r)} color={vehicleColor(v)} />
            ))}
          </StageSvg>
          <BaseMarker pt={TOY_BASE} />
          {TOY_CLIENTS.map((c) => {
            const w = where.get(c.id);
            const color = w ? vehicleColor(w.van) : undefined;
            return (
              <button
                key={c.id}
                type="button"
                data-testid="toy-client"
                data-client={c.id}
                aria-pressed={!!w}
                aria-label={t({
                  es: `Cliente ${c.id}: ${w ? `furgoneta ${w.van + 1}, parada ${w.pos + 1}` : "sin ruta"}`,
                  en: `Customer ${c.id}: ${w ? `van ${w.van + 1}, stop ${w.pos + 1}` : "no route"}`,
                })}
                onClick={() => toggle(c.id)}
                className="absolute z-[2] grid size-11 -translate-1/2 cursor-pointer place-items-center rounded-full border-2 text-base font-bold transition-[background-color,border-color,box-shadow] duration-200 ease-[var(--ease-out)]"
                style={{
                  ...at(c),
                  borderColor: color ?? "var(--fg-3)",
                  borderStyle: w ? "solid" : "dashed",
                  background: w ? `color-mix(in srgb, ${color} 22%, #07101f)` : "#07101f",
                  boxShadow: w ? `0 0 16px -2px ${color}` : undefined,
                  color: "var(--fg)",
                }}
              >
                {!w && (
                  <span aria-hidden="true" className="decor absolute inset-[-2px] rounded-full border-2 border-amber/60" style={{ animation: "ping 2.4s var(--ease-out) infinite" }} />
                )}
                {c.id}
                {w && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-2.5 left-[70%] rounded-tag px-1 py-0.5 font-mono text-[12px] leading-none font-bold whitespace-nowrap text-ink-0 uppercase"
                    style={{ background: color }}
                  >
                    {t({ es: "F", en: "V" })}{w.van + 1}·{w.pos + 1}
                  </span>
                )}
              </button>
            );
          })}
          {done && motion && <Vans routes={routes} trip={trip} />}
        </Stage>
      }
    />
  );
}

/** Las furgonetas recorren su ruta, una vez o en bucle (WAAPI: solo transform y opacidad). */
export function Vans({ routes, trip = 0, loop = false }: { routes: string[][]; trip?: number; loop?: boolean }) {
  const t = useT();
  const layers = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const running: Animation[] = [];
    routes.forEach((r, v) => {
      const el = layers.current[v];
      const pts = loopPoints(r);
      if (!el || pts.length < 2) return;
      const lengths = pts.map((_, i) => (i === 0 ? 0 : Math.hypot(pts[i].x - pts[i - 1].x, (pts[i].y - pts[i - 1].y) * 0.625)));
      const total = lengths.reduce((a, b) => a + b, 0);
      let acc = 0;
      const frames: Keyframe[] = pts.map((p: Pt, i) => {
        acc += lengths[i];
        return { transform: `translate(${p.x}%, ${p.y}%)`, offset: acc / total };
      });
      const timing = { duration: 900 + routesLength([r]) * 26, iterations: loop ? Infinity : 1, delay: loop ? v * 500 : 0 };
      running.push(el.animate(frames, { ...timing, easing: "cubic-bezier(0.77, 0, 0.175, 1)" }));
      running.push(el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.06 }, { opacity: 1, offset: 0.94 }, { opacity: 0 }], timing));
    });
    return () => running.forEach((a) => a.cancel());
  }, [routes, trip, loop]);

  return routes.map((_, v) => (
    <div
      key={v}
      ref={(el) => {
        layers.current[v] = el;
      }}
      className="lrn-layer decor z-[3]"
      style={{ transform: `translate(${TOY_BASE.x}%, ${TOY_BASE.y}%)`, opacity: 0 }}
      aria-hidden="true"
    >
      <span
        className="absolute top-0 left-0 flex -translate-1/2 items-center gap-1 rounded-full border bg-ink-0/90 px-1.5 py-1"
        style={{ borderColor: vehicleColor(v), boxShadow: `0 0 18px -2px ${vehicleColor(v)}` }}
      >
        <VanGlyph color={vehicleColor(v)} className="h-4 w-7" />
        <span className="font-mono text-[12px] leading-none font-bold uppercase" style={{ color: vehicleColor(v) }}>
          {t({ es: "F", en: "V" })}{v + 1}
        </span>
      </span>
    </div>
  ));
}
