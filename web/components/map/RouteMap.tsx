"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { playback } from "@/lib/playback";
import type { components } from "@/lib/types";
import { hasGeo, isLate, lngLats, placeName, planeCoords, stopIndex } from "./geometry";
import { useBoxSize } from "./hooks";
import { Legend } from "./Legend";
import "./map.css";
import type { MapStatus, ViewControls } from "./MapGL";
import { MapTools } from "./MapTools";
import type { StopView } from "./markers";
import PlaneView from "./PlaneView";
import { buildSchedules, unitsOf } from "./schedule";
import { StopCard } from "./StopCard";

type S = components["schemas"];

export type RouteMapProps = {
  /** Instancia del caso: con `lat`/`lon` se dibuja sobre el mapa; con `x`/`y`, en plano. */
  instance: S["Instance"];
  /** Rutas de la solución, una lista de clientes por vehículo (`solution.routes`). */
  routes: number[][];
  /** Evaluación de esas rutas (`RunRecord.evaluation`): llegadas, esperas, retrasos, cargas y vuelta a la base. */
  evaluation: S["Evaluation"] | null | undefined;
  /** Índice del vehículo seleccionado en `routes`, o `null` si no hay ninguno. */
  selectedRoute: number | null;
  onSelectRoute: (route: number | null) => void;
  /** Si se pasa, pulsar un cliente lo comunica (modo "Tu ruta") en vez de abrir su ficha. */
  onStopClick?: (customer: number) => void;
};

// MapLibre usa WebGL y `window`: solo en el navegador.
const MapGL = dynamic(() => import("./MapGL"), { ssr: false });

/** Con más furgonetas, la leyenda pasa de columna a fila desplazable. */
const LEGEND_COLUMN_MAX = 6;

const subscribeMotion = (listener: () => void) => playback.subscribe(listener);
const readMotion = () => playback.getSnapshot().motion;

/**
 * Mapa de rutas con reproducción del día. La hora sale del reloj compartido
 * (`lib/playback`); posiciones y estados, de la evaluación recibida.
 */
export function RouteMap({ instance, routes, evaluation, selectedRoute, onSelectRoute, onStopClick }: RouteMapProps) {
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const size = useBoxSize(box);
  const controls = useRef<ViewControls | null>(null);
  const motion = useSyncExternalStore(subscribeMotion, readMotion, () => true);
  const [activeCustomer, setActive] = useState<number | null>(null);
  const [degraded, setDegraded] = useState(false);

  const geo = hasGeo(instance);
  // Lista estable mientras no cambien las coordenadas, para no recrear el mapa en cada render.
  const nodesKey = geo ? JSON.stringify(lngLats(instance)) : "";
  const nodes = useMemo(() => (nodesKey ? (JSON.parse(nodesKey) as [number, number][]) : null), [nodesKey]);
  const instanceKey = `${instance.id}|${nodesKey}`;

  // Estado del mapa de la instancia actual; el de la anterior no cuenta.
  const [status, setStatus] = useState<{ key: string; value: MapStatus } | null>(null);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const mapStatus = status?.key === instanceKey ? status.value : null;
  const failed = mapStatus === "style-error" || mapStatus === "webgl-error";
  const mode = geo && !failed ? "map" : "plane";

  // Otra instancia: sin la ficha de la anterior.
  const [shownKey, setShownKey] = useState(instanceKey);
  if (shownKey !== instanceKey) {
    setShownKey(instanceKey);
    setActive(null);
  }

  const stops = useMemo(() => stopIndex(routes, evaluation), [routes, evaluation]);
  const schedules = useMemo(() => buildSchedules(instance, routes, evaluation), [instance, routes, evaluation]);
  const units = useMemo(() => unitsOf(instance), [instance]);
  const coords = useMemo(() => planeCoords(instance, geo), [instance, geo]);
  const depotLabel = useMemo(() => {
    const name = placeName(instance.depot.address);
    return name ? `Base · ${name}` : "Base";
  }, [instance]);

  const stopViews = useMemo<StopView[]>(
    () =>
      instance.customers.map((c, i) => {
        const info = stops.get(c.id);
        const late = isLate(info);
        const name = placeName(c.address);
        const window = c.due == null ? `desde ${units.clock(c.ready)}` : `de ${units.clock(c.ready)} a ${units.clock(c.due)}`;
        const served = info ? `Furgoneta ${info.route + 1}, parada ${info.position}` : "Sin atender";
        return {
          customer: c.id,
          node: i + 1,
          route: info?.route ?? null,
          late,
          label: `Cliente ${c.id}${name ? `, ${name}` : ""}. ${served}. Ventana ${window}${late ? ". Llega tarde" : ""}`,
        };
      }),
    [instance, stops, units],
  );

  const onStatus = useCallback((value: MapStatus) => setStatus({ key: instanceKey, value }), [instanceKey]);
  const onReady = useCallback(() => setReadyKey(instanceKey), [instanceKey]);
  const onControls = useCallback((next: ViewControls | null) => {
    controls.current = next;
  }, []);
  const onDegrade = useCallback(() => {
    playback.setMotion(false);
    setDegraded(true);
  }, []);
  const onRoute = useCallback(
    (route: number) => onSelectRoute(selectedRoute === route ? null : route),
    [onSelectRoute, selectedRoute],
  );

  // Contador de fotogramas para las pruebas automatizadas.
  useEffect(() => {
    if (navigator.webdriver && root.current && root.current.dataset.frames === undefined) root.current.dataset.frames = "0";
  }, []);

  const openStop = (customer: number) => {
    if (onStopClick) {
      onStopClick(customer);
      return;
    }
    const same = activeCustomer === customer;
    setActive(same ? null : customer);
    const info = stops.get(customer);
    if (!same && info) onSelectRoute(info.route);
  };

  // Mismo umbral que la portada usa para su línea de estado: por debajo, todo se apila abajo.
  const wide = size.width >= 700;
  const legendColumn = wide && schedules.length <= LEGEND_COLUMN_MAX;
  const hasLate = stopViews.some((s) => s.late);
  const hasUnserved = stopViews.some((s) => s.route === null);
  const slowNotice = degraded && !motion;
  const view = {
    depotLabel,
    stops: stopViews,
    schedules,
    units,
    dayStart: instance.depot.ready,
    selectedRoute,
    activeCustomer,
    legendColumn,
    compact: !wide,
    onStop: openStop,
    onRoute,
    onControls,
  };

  return (
    <div
      ref={root}
      data-testid="route-map"
      data-mode={mode}
      data-routes={schedules.length}
      data-motion={motion ? "on" : "off"}
      data-ready={mode === "plane" || readyKey === instanceKey}
      className="flex h-full min-h-0 w-full min-w-0 flex-col"
      onKeyDown={(e) => {
        if (e.key === "Escape" && activeCustomer !== null) setActive(null);
      }}
    >
      <div ref={box} data-testid="map-box" className="relative isolate min-h-[260px] flex-1 overflow-hidden bg-[#050a14]">
        {mode === "map" && nodes ? (
          <MapGL
            key={instanceKey}
            {...view}
            nodes={nodes}
            motion={motion}
            frameSink={root}
            onStatus={onStatus}
            onReady={onReady}
            onDegrade={onDegrade}
          />
        ) : (
          <PlaneView key={instanceKey} {...view} coords={coords} attributed={geo} />
        )}
        <div className="rm-vignette" aria-hidden="true" />

        <Legend
          routes={routes}
          selectedRoute={selectedRoute}
          onSelectRoute={onSelectRoute}
          hasLate={hasLate}
          hasUnserved={hasUnserved}
          column={legendColumn}
          toolsWidth={wide ? 268 : 100}
        />
        <MapTools
          motion={motion}
          wide={wide}
          onMotion={() => {
            playback.setMotion(!motion);
            setDegraded(false);
          }}
          onRecenter={() => controls.current?.recenter()}
          onZoomIn={() => controls.current?.zoomIn()}
          onZoomOut={() => controls.current?.zoomOut()}
        />

        {(failed || slowNotice || activeCustomer !== null) && (
          <div className={`pointer-events-none absolute right-[4.75rem] top-[4.5rem] z-[5] flex flex-col items-end gap-2 ${wide ? "w-[20rem]" : "left-3"}`}>
            {geo && failed && (
              <p data-testid="map-notice" role="status" className="hud pointer-events-auto px-3 py-1.5 text-base text-fg">
                Sin mapa base: rutas en plano
              </p>
            )}
            {slowNotice && (
              <p data-testid="motion-notice" role="status" className="hud pointer-events-auto flex items-center gap-2 py-1 pl-3 pr-1 text-base text-fg">
                Animación quitada para ir más fluido
                <button
                  type="button"
                  className="h-9 rounded-full border border-line-2 px-3 font-semibold text-amber hover:bg-white/5"
                  onClick={() => {
                    playback.setMotion(true);
                    setDegraded(false);
                  }}
                >
                  Reactivar
                </button>
              </p>
            )}
            {activeCustomer !== null && (
              <StopCard
                instance={instance}
                customer={activeCustomer}
                info={stops.get(activeCustomer)}
                units={units}
                onClose={() => setActive(null)}
              />
            )}
          </div>
        )}

        {geo && (
          <p
            data-testid="map-attribution"
            className={`hud absolute z-[3] whitespace-nowrap rounded-tag px-2.5 text-base leading-7 text-fg-2 ${
              wide ? "bottom-3 right-3" : "bottom-1 left-2 font-display tracking-wide"
            }`}
          >
            ©{" "}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="text-fg">
              OpenStreetMap
            </a>
            {mode === "map" && (
              <>
                {" · "}
                <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer" className="text-fg">
                  OpenMapTiles
                </a>
                {" · "}
                <a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer" className="text-fg">
                  OpenFreeMap
                </a>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

export default RouteMap;
