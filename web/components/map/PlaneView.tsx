"use client";

import { type CSSProperties, type PointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { playback } from "@/lib/playback";
import { IDENTITY, type Pad, type Pt, type View, fitToBox, vehicleColor, zoomView } from "./geometry";
import { useBoxSize } from "./hooks";
import "./map.css";
import type { ViewControls } from "./MapGL";
import { DepotMarker, type MarkerSize, StopMarker, type StopView, VanMarker } from "./markers";
import { type RouteSchedule, type Units, cumulative } from "./schedule";
import { paintStops, paintVan, simulate } from "./sim";

type Props = {
  /** Coordenadas planas de cada nodo (eje y hacia arriba), o `null` si faltan. */
  coords: (Pt | null)[];
  depotLabel: string;
  stops: StopView[];
  schedules: RouteSchedule[];
  units: Units;
  dayStart: number;
  selectedRoute: number | null;
  activeCustomer: number | null;
  legendColumn: boolean;
  /** Visor estrecho: la línea de estado de la portada ocupa todo el ancho, abajo. */
  compact: boolean;
  /** Hay nota de tramos rectos y atribución abajo (respaldo de un caso con mapa). */
  attributed: boolean;
  onStop: (customer: number) => void;
  onRoute: (route: number) => void;
  onControls: (controls: ViewControls | null) => void;
};

const ZOOM_STEP = 1.6;
/** Con más paradas que esto, los marcadores empiezan pequeños y crecen al ampliar. */
const DENSE = 30;

const pin = (p: Pt, anchor = "translate(-50%, -50%)") => `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) ${anchor}`;
const VAN_ANCHOR = "translate(-50%, -100%) translateY(-10px)";

/**
 * Plano cartesiano en SVG para instancias sin coordenadas geográficas, y
 * respaldo de las que las tienen si el mapa no se puede dibujar. Misma estética
 * que el mapa: rejilla, brillo, estelas y los mismos marcadores.
 */
export default function PlaneView({
  coords,
  depotLabel,
  stops,
  schedules,
  units,
  dayStart,
  selectedRoute,
  activeCustomer,
  legendColumn,
  compact,
  attributed,
  onStop,
  onRoute,
  onControls,
}: Props) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const size = useBoxSize(box);
  const [view, setView] = useState<View>(IDENTITY);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const stopEls = useRef(new Map<number, HTMLButtonElement>());
  const vanEls = useRef(new Map<number, HTMLDivElement>());
  const vanPins = useRef(new Map<number, HTMLDivElement>());
  const trails = useRef(new Map<number, SVGPolylineElement>());

  const dense = stops.length > DENSE;
  const markerSize: MarkerSize = !dense || view.k >= 3 ? "full" : view.k >= 2 ? "mid" : "dot";

  const points = useMemo(() => {
    const pad: Pad = {
      top: compact ? 88 : 80,
      right: 68,
      // Abajo queda sitio para la línea de estado de la portada y, si la hay, la atribución.
      bottom: compact ? (attributed ? 128 : 108) : 128,
      left: legendColumn ? 264 : compact ? 24 : 36,
    };
    return fitToBox(coords, size.width, size.height, pad, view);
  }, [coords, size.width, size.height, legendColumn, compact, attributed, view]);

  const lines = useMemo(
    () =>
      schedules.map((s) => ({
        route: s.route,
        points: s.path.map((n) => points[n]),
        // Proporciones del recorrido: no cambian con el zoom.
        lengths: cumulative(s.path.map((n) => coords[n] ?? { x: 0, y: 0 })),
      })),
    [schedules, points, coords],
  );
  // Otro plan: las líneas se montan de nuevo y vuelven a dibujarse.
  const planKey = useMemo(() => schedules.map((s) => `${s.route}:${s.path.join(".")}`).join("|"), [schedules]);

  useEffect(() => {
    onControls({
      zoomIn: () => setView((v) => zoomView(v, ZOOM_STEP, size.width, size.height)),
      zoomOut: () => setView((v) => zoomView(v, 1 / ZOOM_STEP, size.width, size.height)),
      recenter: () => setView(IDENTITY),
    });
    return () => onControls(null);
  }, [onControls, size.width, size.height]);

  const applySim = useCallback(() => {
    const sim = simulate(
      schedules,
      lines.map((l) => l.lengths),
      units,
      dayStart,
    );
    paintStops(stopEls.current, schedules, sim.t, dayStart);
    if (box.current) box.current.dataset.overview = String(sim.overview);
    sim.vans.forEach((van, i) => {
      const { route, points: path } = lines[i];
      const [a, b] = [path[van.from], path[van.to]];
      const wrap = vanPins.current.get(route);
      if (wrap && a && b) wrap.style.transform = pin({ x: a.x + (b.x - a.x) * van.f, y: a.y + (b.y - a.y) * van.f }, VAN_ANCHOR);
      const el = vanEls.current.get(route);
      if (el) paintVan(el, van);
      const trail = trails.current.get(route);
      if (trail) {
        const length = sim.overview ? 0 : van.progress - van.tail;
        trail.style.visibility = length < 0.003 ? "hidden" : "visible";
        trail.style.strokeDasharray = `${length.toFixed(4)} 2`;
        trail.style.strokeDashoffset = (-van.tail).toFixed(4);
      }
    });
  }, [schedules, lines, units, dayStart]);
  useLayoutEffect(() => {
    applySim();
    return playback.subscribe(applySim);
  }, [applySim]);

  const panStart = (e: PointerEvent<HTMLDivElement>) => {
    if (view.k === 1) return;
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const panMove = (e: PointerEvent<HTMLDivElement>) => {
    const from = drag.current;
    if (!from) return;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, tx: v.tx + e.clientX - from.x, ty: v.ty + e.clientY - from.y }));
  };
  const panEnd = () => {
    drag.current = null;
  };

  const dimmed = (route: number | null) => selectedRoute !== null && route !== null && route !== selectedRoute;
  const depot = points[0];
  const stagger = Math.min(300, 900 / Math.max(1, lines.length));
  const order = [...lines].sort((a, b) => Number(!dimmed(a.route)) - Number(!dimmed(b.route)));
  const polyline = (path: (Pt | null)[]) =>
    path
      .filter((q): q is Pt => q !== null)
      .map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`)
      .join(" ");

  return (
    <div ref={box} className="rm-plane" data-overview="true">
      <div
        className="absolute inset-0"
        style={{ touchAction: view.k > 1 ? "none" : "auto", cursor: view.k > 1 ? "grab" : "default" }}
        onPointerDown={panStart}
        onPointerMove={panMove}
        onPointerUp={panEnd}
        onPointerCancel={panEnd}
      />
      {size.width > 0 && (
        <>
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full select-none"
            viewBox={`0 0 ${size.width} ${size.height}`}
            role="group"
            aria-label={t({ es: "Rutas", en: "Routes" })}
          >
            {order.map((l) => {
              const i = lines.indexOf(l);
              const d = polyline(l.points);
              const color = vehicleColor(l.route);
              const selected = l.route === selectedRoute;
              const vars = {
                "--c": color,
                "--delay": `${Math.round(i * stagger)}ms`,
                "--dur": `${(7 + Math.min(8, l.points.length * 0.4)).toFixed(1)}s`,
              } as CSSProperties;
              return (
                <g key={`${planKey}/${l.route}`} className="rm-line" data-dim={dimmed(l.route) || undefined} style={vars}>
                  <polyline points={d} className="rm-glow" style={{ stroke: color }} strokeWidth={dense ? 6 : 12} />
                  <polyline
                    data-testid="route-line"
                    data-route={l.route}
                    points={d}
                    pathLength={1}
                    className="rm-core decor"
                    style={{ stroke: color }}
                    strokeWidth={selected ? 4.5 : dense ? 2 : 3.2}
                  />
                  <polyline points={d} className="rm-hit" onClick={() => onRoute(l.route)} />
                  <polyline points={d} pathLength={1} className="rm-comet decor" strokeWidth={dense ? 2 : 3} />
                  <polyline
                    ref={(el) => {
                      if (el) trails.current.set(l.route, el);
                      else trails.current.delete(l.route);
                    }}
                    points={d}
                    pathLength={1}
                    className="rm-trail"
                    style={{ stroke: color, visibility: "hidden" }}
                    strokeWidth={dense ? 4 : 5.5}
                  />
                </g>
              );
            })}
          </svg>

          {depot && (
            <div className="rm-pin" style={{ transform: pin(depot), zIndex: 1 }}>
              <DepotMarker label={depotLabel} size={dense ? markerSize : "full"} labelled={!compact} />
            </div>
          )}
          {stops.map((stop) => {
            const q = points[stop.node];
            if (!q) return null;
            const active = stop.customer === activeCustomer;
            return (
              <div
                key={stop.customer}
                className="rm-pin"
                style={{ transform: pin(q), zIndex: active ? 5 : dimmed(stop.route) ? 2 : 3 }}
              >
                <StopMarker
                  stop={stop}
                  size={markerSize}
                  active={active}
                  dimmed={dimmed(stop.route)}
                  onClick={onStop}
                  buttonRef={(el) => {
                    if (el) stopEls.current.set(stop.customer, el);
                    else stopEls.current.delete(stop.customer);
                  }}
                />
              </div>
            );
          })}
          {lines.map((l) => (
            <div
              key={l.route}
              ref={(el) => {
                if (el) vanPins.current.set(l.route, el);
                else vanPins.current.delete(l.route);
              }}
              className="rm-pin"
              style={{ zIndex: 6 }}
            >
              <VanMarker
                route={l.route}
                vanRef={(el) => {
                  if (el) vanEls.current.set(l.route, el);
                  else vanEls.current.delete(l.route);
                }}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
