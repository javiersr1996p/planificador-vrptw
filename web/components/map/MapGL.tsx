"use client";

import { type CSSProperties, type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  type ExpressionSpecification,
  LngLatBounds,
  Map as MapLibreMap,
  type MapMouseEvent,
  Marker,
  type StyleSpecification,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { type Lang, currentLang, useLang } from "@/lib/i18n";
import { playback } from "@/lib/playback";
import { type Pt, mercator, vehicleColor } from "./geometry";
import { useOnScreen, usePageVisible } from "./hooks";
import "./map.css";
import { DepotMarker, StopMarker, type StopView, VanMarker } from "./markers";
import { type RouteSchedule, type Units, cumulative } from "./schedule";
import { paintStops, paintVan, simulate } from "./sim";
import { nightStyle, vehicleRgba } from "./theme";

/** Estilo oscuro de OpenFreeMap: sin clave; se recolorea antes de crear el mapa. */
export const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

export type MapStatus = "ok" | "style-error" | "webgl-error";

/** Acciones de los botones del visor, comunes al mapa y al plano. */
export type ViewControls = { zoomIn: () => void; zoomOut: () => void; recenter: () => void };

type Props = {
  /** `[lon, lat]` de cada nodo: 0 es la base, i es `customers[i - 1]`. */
  nodes: [number, number][];
  depotLabel: string;
  stops: StopView[];
  schedules: RouteSchedule[];
  units: Units;
  dayStart: number;
  selectedRoute: number | null;
  activeCustomer: number | null;
  motion: boolean;
  /** La leyenda ocupa una columna a la izquierda: el encuadre le deja sitio. */
  legendColumn: boolean;
  /** Visor estrecho: la base va sin rótulo. */
  compact: boolean;
  /** Elemento que recibe `data-frames` en navegadores automatizados. */
  frameSink: RefObject<HTMLElement | null>;
  onStop: (customer: number) => void;
  onRoute: (route: number) => void;
  onStatus: (status: MapStatus) => void;
  onControls: (controls: ViewControls | null) => void;
  /** La cámara ha terminado su vuelo inicial. */
  onReady: () => void;
  /** El equipo no sostiene la animación: se pide pausar el movimiento. */
  onDegrade: () => void;
};

const LOCALE: Record<Lang, Record<string, string>> = {
  es: {
    "Map.Title": "Mapa de rutas",
    "CooperativeGesturesHandler.WindowsHelpText": "Usa Ctrl + rueda para ampliar el mapa",
    "CooperativeGesturesHandler.MacHelpText": "Usa ⌘ + rueda para ampliar el mapa",
    "CooperativeGesturesHandler.MobileHelpText": "Usa dos dedos para mover el mapa",
  },
  en: {
    "Map.Title": "Route map",
    "CooperativeGesturesHandler.WindowsHelpText": "Use Ctrl + scroll to zoom the map",
    "CooperativeGesturesHandler.MacHelpText": "Use ⌘ + scroll to zoom the map",
    "CooperativeGesturesHandler.MobileHelpText": "Use two fingers to move the map",
  },
};

// El paquete trae el worker en un fichero aparte; el empaquetador lo publica como estático.
const WORKER_URL = new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href;

/** Vuelo inicial: una vez por caso, corto y con frenada suave. */
const FLIGHT_MS = 1200;
const RECENTER_MS = 1200;
/** Distancia a la base, en píxeles, por debajo de la cual la cabeza de la estela se apaga. */
const HEAD_CLEAR_PX = 28;
/** Dibujo de cada ruta y desfase máximo entre rutas. */
const DRAW_MS = 1400;
const DRAW_STAGGER_MS = 300;
/** Órbita: grados de vaivén y milisegundos por radián. */
const ORBIT_DEG = 6;
const ORBIT_MS = 9000;
/** Degradación: media de fotograma tolerada en los primeros segundos. */
const PERF_WINDOW_MS = 2000;
const PERF_MAX_FRAME_MS = 40;

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const CLEAR = ["interpolate", ["linear"], ["line-progress"], 0, "rgba(0,0,0,0)", 1, "rgba(0,0,0,0)"];

/** Ruta visible hasta la fracción `p`. */
function revealGradient(route: number, p: number): unknown[] {
  if (p <= 0.001) return CLEAR;
  const on = vehicleRgba(route, 1);
  if (p >= 0.997) return ["interpolate", ["linear"], ["line-progress"], 0, on, 1, on];
  const off = vehicleRgba(route, 0);
  return ["interpolate", ["linear"], ["line-progress"], 0, on, p, on, p + 0.002, off, 1, off];
}

/** Estela entre las fracciones `s0` y `s1`, más intensa hacia la cabeza. */
function streakGradient(route: number, s0: number, s1: number, core: boolean): unknown[] {
  if (s1 - s0 < 0.003) return CLEAR;
  const off = vehicleRgba(route, 0);
  const stops: (number | string)[] = [];
  if (s0 > 0) stops.push(0, off);
  stops.push(s0, off, s0 + (s1 - s0) * 0.7, vehicleRgba(route, core ? 0.95 : 0.45), s1, core ? "#ffffff" : vehicleRgba(route, 0.95));
  if (s1 + 0.003 < 1) stops.push(s1 + 0.003, off, 1, off);
  else if (s1 < 1) stops.push(1, off);
  return ["interpolate", ["linear"], ["line-progress"], ...stops];
}

type Line = {
  route: number;
  /** Vértices `[lon, lat]` del recorrido y su longitud acumulada. */
  points: [number, number][];
  lengths: number[];
};

function lineData(points: [number, number][]) {
  const coordinates = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  return {
    type: "FeatureCollection" as const,
    features:
      coordinates.length > 1
        ? [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } }]
        : [],
  };
}

/** Punto de la línea a la fracción `h` de su longitud. */
function pointAt(line: Line, h: number): [number, number] {
  const { points, lengths } = line;
  const target = lengths[lengths.length - 1] * clamp01(h);
  for (let i = 1; i < points.length; i++) {
    if (lengths[i] >= target) {
      const f = (target - lengths[i - 1]) / Math.max(1e-12, lengths[i] - lengths[i - 1]);
      return lerp(points[i - 1], points[i], f);
    }
  }
  return points[points.length - 1];
}

const lerp = (a: [number, number], b: [number, number], f: number): [number, number] => [
  a[0] + (b[0] - a[0]) * f,
  a[1] + (b[1] - a[1]) * f,
];

function boundsOf(nodes: [number, number][]) {
  const b = new LngLatBounds();
  for (const n of nodes) b.extend(n);
  return b;
}

type CameraTarget = { center: [number, number]; zoom: number; pitch: number; bearing: number };

/**
 * Encuadre inclinado: prueba varios rumbos y se queda con el que deja ver
 * todos los nodos más de cerca, sin que los tapen los controles.
 */
function viewFor(map: MapLibreMap, nodes: [number, number][], layout: { legendColumn: boolean; compact: boolean }): CameraTarget {
  const box = map.getContainer();
  const [W, H] = [box.clientWidth, box.clientHeight];
  // Abajo queda sitio para la línea de estado de la portada y la atribución.
  const small = layout.compact;
  const pad = small ? { t: 84, b: 118, l: 56, r: 64 } : { t: 96, b: 148, l: layout.legendColumn ? 264 : 64, r: 96 };
  const pitch = small ? 52 : 60;
  const saved = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  const [aw, ah] = [Math.max(40, W - pad.l - pad.r), Math.max(40, H - pad.t - pad.b)];
  let best: CameraTarget | null = null;
  for (const bearing of small ? [-12, -24, -36] : [-30, -42, -54, -66]) {
    let center: [number, number] = [
      nodes.reduce((sum, n) => sum + n[0], 0) / nodes.length,
      nodes.reduce((sum, n) => sum + n[1], 0) / nodes.length,
    ];
    let zoom = Math.min(15, saved.zoom);
    for (let i = 0; i < 8; i++) {
      // La caja cubre también los extremos de la órbita: ningún nodo se sale al girar.
      const xy = [-ORBIT_DEG, ORBIT_DEG, 0].flatMap((turn) => {
        map.jumpTo({ center, zoom, pitch, bearing: bearing + turn });
        return nodes.map((n) => map.project(n));
      });
      const xs = xy.map((q) => q.x);
      const ys = xy.map((q) => q.y);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const scale = Math.min(aw / Math.max(1, x1 - x0), ah / Math.max(1, y1 - y0));
      const shifted = map.unproject([W / 2 + (x0 + x1) / 2 - (pad.l + aw / 2), H / 2 + (y0 + y1) / 2 - (pad.t + ah / 2)]);
      center = [shifted.lng, shifted.lat];
      zoom = Math.min(15, zoom + Math.log2(scale) * 0.85);
    }
    if (!best || zoom > best.zoom) best = { center, zoom, pitch, bearing };
  }
  map.jumpTo(saved);
  return best as CameraTarget;
}

let stylePromise: Promise<StyleSpecification> | null = null;

/** Estilo ya recoloreado; se descarga una vez por página. */
function loadStyle(): Promise<StyleSpecification> {
  stylePromise ??= fetch(STYLE_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`estilo: ${response.status}`);
      return response.json() as Promise<StyleSpecification>;
    })
    .then(nightStyle)
    .catch((error: unknown) => {
      stylePromise = null;
      throw error;
    });
  return stylePromise.then((style) => structuredClone(style));
}

/** Mapas ya destruidos: sus capas no se pueden retirar. */
const removed = new WeakSet<MapLibreMap>();

/** La medida de rendimiento se hace una sola vez por página. */
let perfChecked = false;

type MarkerProps = {
  map: MapLibreMap;
  at: [number, number];
  z: number;
  bottom?: boolean;
  id?: number;
  registry?: RefObject<Map<number, Marker>>;
  children: ReactNode;
};

const VAN_OFFSET: [number, number] = [0, -10];

/** Marcador de MapLibre cuyo contenido pinta React. */
function MapMarker({ map, at, z, bottom = false, id, registry, children }: MarkerProps) {
  const [el] = useState(() => document.createElement("div"));
  const placed = useRef<Marker | null>(null);
  useEffect(() => {
    const marker = new Marker({ element: el, anchor: bottom ? "bottom" : "center", offset: bottom ? VAN_OFFSET : undefined })
      .setLngLat(at)
      .addTo(map);
    placed.current = marker;
    const markers = registry?.current;
    if (id !== undefined) markers?.set(id, marker);
    return () => {
      if (id !== undefined) markers?.delete(id);
      marker.remove();
    };
  }, [map, el, at, bottom, id, registry]);
  useEffect(() => {
    placed.current?.getElement().style.setProperty("z-index", String(z));
  }, [z, map, at]);
  return createPortal(children, el);
}

/**
 * Mapa en 3D de MapLibre: rutas, brillo y estelas en capas con `line-gradient`;
 * base, paradas y furgonetas como marcadores. Se monta uno por instancia.
 */
export default function MapGL({
  nodes,
  depotLabel,
  stops,
  schedules,
  units,
  dayStart,
  selectedRoute,
  activeCustomer,
  motion,
  legendColumn,
  compact,
  frameSink,
  onStop,
  onRoute,
  onStatus,
  onControls,
  onReady,
  onDegrade,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [styled, setStyled] = useState(false);
  const camera = useRef({ target: null as CameraTarget | null, ready: false, userMoved: false, hover: false, orbit: 0 });
  const layout = useRef({ legendColumn, compact });
  const stopEls = useRef(new Map<number, HTMLButtonElement>());
  const vanEls = useRef(new Map<number, HTMLDivElement>());
  const headEls = useRef(new Map<number, HTMLDivElement>());
  const vanMarkers = useRef(new Map<number, Marker>());
  const headMarkers = useRef(new Map<number, Marker>());
  const gradients = useRef(new Map<string, string>());
  const reveal = useRef({ t0: null as number | null, done: false });
  const overview = useRef(true);
  const visible = usePageVisible();
  const onScreen = useOnScreen(box);
  const [lang] = useLang();

  const lines = useMemo<Line[]>(() => {
    const flat: Pt[] = mercator(nodes);
    return schedules.map((s) => ({
      route: s.route,
      points: s.path.map((n) => nodes[n]),
      lengths: cumulative(s.path.map((n) => flat[n])),
    }));
  }, [schedules, nodes]);

  useLayoutEffect(() => {
    layout.current = { legendColumn, compact };
  }, [legendColumn, compact]);

  // El mapa se crea una vez por caso: al cambiar de idioma se actualizan sus textos en el sitio.
  // MapLibre no ofrece `setLocale`; la tabla de textos es la que comparten sus controles.
  useEffect(() => {
    if (!map) return;
    const table = (map as unknown as { _locale?: Record<string, string> })._locale;
    if (table) Object.assign(table, LOCALE[lang]);
    // El aviso de gestos se escribe al activarse: se rehace para que tome la tabla nueva.
    if (map.cooperativeGestures.isEnabled()) {
      map.cooperativeGestures.disable();
      map.cooperativeGestures.enable();
    }
    map.getCanvas().setAttribute("aria-label", LOCALE[lang]["Map.Title"]);
  }, [map, lang]);

  const setGradient = useCallback(
    (id: string, expression: unknown[]) => {
      if (!map?.getLayer(id)) return;
      const key = JSON.stringify(expression);
      if (gradients.current.get(id) === key) return;
      gradients.current.set(id, key);
      // Sin validar: son expresiones propias y se cambian en cada fotograma.
      map.setPaintProperty(id, "line-gradient", expression as ExpressionSpecification, { validate: false });
    },
    [map],
  );
  // El halo de la estela se repinta un fotograma sí y otro no: su retraso no se
  // aprecia y cada cambio de degradado cuesta una textura por tesela.
  const streakTick = useRef(0);
  const setStreak = useCallback(
    (route: number, s0: number, s1: number) => {
      const empty = s1 - s0 < 0.003;
      if (empty || (streakTick.current++ & 1) === 0) setGradient(`route-${route}-trail-glow`, streakGradient(route, s0, s1, false));
      setGradient(`route-${route}-trail`, streakGradient(route, s0, s1, true));
    },
    [setGradient],
  );
  const setReveal = useCallback(
    (route: number, p: number) => {
      setGradient(`route-${route}-glow`, revealGradient(route, p));
      setGradient(`route-${route}-core`, revealGradient(route, p));
    },
    [setGradient],
  );

  // Mapa: se crea con el estilo ya recoloreado y un encuadre plano de todos los nodos.
  useEffect(() => {
    let cancelled = false;
    let created: MapLibreMap | null = null;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const cam = camera.current;
    loadStyle().then(
      (style) => {
        if (cancelled || !box.current) return;
        try {
          setWorkerUrl(WORKER_URL);
          created = new MapLibreMap({
            container: box.current,
            style,
            bounds: boundsOf(nodes),
            fitBoundsOptions: { padding: 48, maxZoom: 15 },
            // La atribución va en una línea fija propia, siempre visible.
            attributionControl: false,
            cooperativeGestures: true,
            maxPitch: 70,
            maxZoom: 18,
            fadeDuration: 0,
            pixelRatio: Math.min(window.devicePixelRatio, 2),
            locale: LOCALE[currentLang()],
          });
        } catch {
          // Sin WebGL 2: el caso se dibuja en el plano.
          onStatus("webgl-error");
          return;
        }
        const m = created;
        // Los fallos de teselas o tipografías no impiden ver las rutas.
        m.on("error", () => {});
        m.on("movestart", (e) => {
          if (e.originalEvent) cam.userMoved = true;
        });
        m.on("resize", () => {
          if (!cam.ready || cam.userMoved) return;
          cam.target = viewFor(m, nodes, layout.current);
          m.jumpTo(cam.target);
        });
        m.once("style.load", () => {
          if (!cancelled) setStyled(true);
        });
        const fly = () => {
          clearTimeout(fallback);
          if (cancelled || cam.target) return;
          const target = viewFor(m, nodes, layout.current);
          cam.target = target;
          const settle = () => {
            cam.ready = true;
            onReady();
          };
          if (playback.getSnapshot().motion) {
            m.once("moveend", settle);
            m.easeTo({ ...target, duration: FLIGHT_MS, easing: easeOutCubic });
          } else {
            m.jumpTo(target);
            settle();
          }
        };
        // Con la red lenta no se espera a la última tesela para empezar el vuelo.
        m.once("load", fly);
        fallback = setTimeout(fly, 2000);
        onStatus("ok");
        setMap(m);
      },
      () => {
        if (!cancelled) onStatus("style-error");
      },
    );
    return () => {
      cancelled = true;
      clearTimeout(fallback);
      cam.target = null;
      cam.ready = false;
      if (created) {
        removed.add(created);
        created.remove();
      }
      setMap(null);
      setStyled(false);
    };
  }, [nodes, onStatus, onReady]);

  useEffect(() => {
    if (!map) return;
    const cam = camera.current;
    onControls({
      zoomIn: () => {
        cam.userMoved = true;
        map.zoomIn();
      },
      zoomOut: () => {
        cam.userMoved = true;
        map.zoomOut();
      },
      recenter: () => {
        cam.target = viewFor(map, nodes, layout.current);
        cam.userMoved = false;
        cam.orbit = 0;
        map.easeTo({ ...cam.target, duration: playback.getSnapshot().motion ? RECENTER_MS : 0, easing: easeOutCubic });
      },
    });
    return () => onControls(null);
  }, [map, nodes, onControls]);

  // Cambia la disposición del visor (p. ej. se estrecha): se reencuadra si el visitante no ha movido el mapa.
  useEffect(() => {
    const cam = camera.current;
    if (!map || !cam.ready || cam.userMoved) return;
    cam.target = viewFor(map, nodes, { legendColumn, compact });
    map.jumpTo(cam.target);
  }, [map, nodes, legendColumn, compact]);

  // Reproducción: posición de cada furgoneta y estado de cada parada a la hora del reloj.
  const applySim = useCallback(() => {
    const sim = simulate(
      schedules,
      lines.map((l) => l.lengths),
      units,
      dayStart,
    );
    paintStops(stopEls.current, schedules, sim.t, dayStart);
    overview.current = sim.overview;
    sim.vans.forEach((van, i) => {
      const { route, points } = lines[i];
      vanMarkers.current.get(route)?.setLngLat(lerp(points[van.from], points[van.to], van.f));
      const el = vanEls.current.get(route);
      if (el) paintVan(el, van);
      // En reposo las estelas las mueve el bucle de adornos; sin movimiento no hay estelas.
      if (!sim.overview || !sim.motion) setStreak(route, sim.motion && !sim.overview ? van.tail : 0, sim.motion && !sim.overview ? van.progress : 0);
    });
  }, [schedules, lines, units, dayStart, setStreak]);
  const applyRef = useRef(applySim);
  useLayoutEffect(() => {
    applyRef.current = applySim;
    applySim();
    return playback.subscribe(applySim);
  }, [applySim]);

  // Capas: brillo y núcleo por ruta y, encima de todas, las estelas.
  useEffect(() => {
    if (!map || !styled) return;
    const cache = gradients.current;
    const layout = { "line-cap": "round", "line-join": "round" } as const;
    const animate = playback.getSnapshot().motion;
    const layers: string[] = [];
    const line = (id: string, source: string, width: number, blur: number, opacity: number, gradient: unknown[]) => {
      map.addLayer({
        id,
        type: "line",
        source,
        layout,
        paint: {
          "line-width": width,
          "line-blur": blur,
          "line-opacity": opacity,
          "line-gradient": gradient as ExpressionSpecification,
        },
      });
      layers.push(id);
    };
    for (const l of lines) {
      const source = `route-${l.route}`;
      // Teselas grandes (zoom 10 como mucho): cada ruta cae en una o dos, y cada
      // cambio de degradado repinta menos texturas.
      map.addSource(source, { type: "geojson", lineMetrics: true, maxzoom: 10, tolerance: 0, data: lineData(l.points) });
      const gradient = animate ? CLEAR : revealGradient(l.route, 1);
      line(`${source}-glow`, source, 16, 12, 0.5, gradient);
      line(`${source}-core`, source, 3.2, 0, 0.95, gradient);
    }
    for (const l of lines) {
      line(`route-${l.route}-trail-glow`, `route-${l.route}`, 22, 13, 1, CLEAR);
      line(`route-${l.route}-trail`, `route-${l.route}`, 5, 0, 1, CLEAR);
    }
    reveal.current = { t0: null, done: !animate };
    applyRef.current();
    return () => {
      cache.clear();
      if (removed.has(map)) return;
      for (const id of layers) if (map.getLayer(id)) map.removeLayer(id);
      for (const l of lines) if (map.getSource(`route-${l.route}`)) map.removeSource(`route-${l.route}`);
    };
  }, [map, styled, lines]);

  // Al elegir una furgoneta, el resto se atenúa.
  useEffect(() => {
    if (!map || !styled) return;
    for (const l of lines) {
      const on = selectedRoute === null || selectedRoute === l.route;
      if (!map.getLayer(`route-${l.route}-core`)) continue;
      map.setPaintProperty(`route-${l.route}-core`, "line-opacity", on ? 0.95 : 0.16);
      map.setPaintProperty(`route-${l.route}-glow`, "line-opacity", on ? 0.5 : 0.05);
    }
  }, [map, styled, lines, selectedRoute]);

  // Pulsar una línea elige su furgoneta.
  useEffect(() => {
    if (!map || !styled) return;
    const onClick = (e: MapMouseEvent) => {
      if ((e.originalEvent.target as Element | null)?.closest("button")) return;
      const ids = lines.map((l) => `route-${l.route}-core`).filter((id) => map.getLayer(id));
      if (ids.length === 0) return;
      const hit = map.queryRenderedFeatures(
        [
          [e.point.x - 6, e.point.y - 6],
          [e.point.x + 6, e.point.y + 6],
        ],
        { layers: ids },
      )[0];
      if (hit) onRoute(Number(hit.layer.id.split("-")[1]));
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map, styled, lines, onRoute]);

  // Adornos: dibujo de las rutas, estelas en reposo y órbita. Un solo bucle,
  // parado con el movimiento en pausa, la pestaña oculta o el mapa fuera de pantalla.
  const running = !!map && styled && motion && visible && onScreen;
  useEffect(() => {
    if (!map || !styled) return;
    const cam = camera.current;
    const heads = headEls.current;
    const hideHeads = () =>
      heads.forEach((el) => {
        delete el.dataset.on;
        el.style.opacity = "";
        el.style.transition = "";
      });
    if (!running) {
      reveal.current.done = true;
      for (const l of lines) {
        setReveal(l.route, 1);
        if (overview.current) setStreak(l.route, 0, 0);
      }
      hideHeads();
      return;
    }
    const sink = navigator.webdriver ? frameSink.current : null;
    let frames = Number(sink?.dataset.frames) || 0;
    let id = 0;
    let last: number | null = null;
    let perfStart: number | null = null;
    let perfFrames = 0;
    let headsOn = true;
    const stagger = Math.min(DRAW_STAGGER_MS, 900 / Math.max(1, lines.length));
    const frame = (now: number) => {
      const dt = last === null ? 0 : Math.min(100, now - last);
      last = now;
      if (sink) sink.dataset.frames = String(++frames);

      // Los navegadores automatizados pintan por software: no sirven de medida.
      if (!perfChecked && cam.ready && !navigator.webdriver) {
        if (perfStart === null) perfStart = now;
        else perfFrames++;
        if (now - perfStart >= PERF_WINDOW_MS) {
          perfChecked = true;
          if ((now - perfStart) / Math.max(1, perfFrames) > PERF_MAX_FRAME_MS) onDegrade();
        }
      }

      const rv = reveal.current;
      if (!rv.done) {
        if (rv.t0 === null) rv.t0 = now + (cam.ready ? 0 : 500);
        let all = true;
        lines.forEach((l, i) => {
          const p = clamp01((now - (rv.t0 as number) - i * stagger) / DRAW_MS);
          if (p < 1) all = false;
          setReveal(l.route, easeOutCubic(p));
        });
        rv.done = all;
      }

      if (overview.current && rv.done) {
        lines.forEach((l, i) => {
          const period = 7000 + Math.min(8000, l.lengths[l.lengths.length - 1] * 60000);
          const h = (now / period + i * 0.31) % 1;
          setStreak(l.route, Math.max(0, h - 0.2), h);
          const at = pointAt(l, h);
          headMarkers.current.get(l.route)?.setLngLat(at);
          const el = heads.get(l.route);
          if (el) {
            // La cabeza se apaga al pasar por encima de la base: no la tapa.
            const [a, b] = [map.project(at), map.project(nodes[0])];
            el.style.transition = "none";
            el.style.opacity = String(clamp01((Math.hypot(a.x - b.x, a.y - b.y) - HEAD_CLEAR_PX) / 20));
            if (el.dataset.on === undefined) el.dataset.on = "";
          }
        });
        headsOn = true;
      } else if (headsOn) {
        hideHeads();
        headsOn = false;
      }

      // La órbita se detiene si el visitante mueve el mapa y espera mientras apunta sobre él.
      if (cam.ready && cam.target && !cam.userMoved && !cam.hover && !map.isMoving()) {
        cam.orbit += dt;
        map.setBearing(cam.target.bearing + ORBIT_DEG * Math.sin(cam.orbit / ORBIT_MS));
      }
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [map, styled, running, lines, nodes, frameSink, setReveal, setStreak, onDegrade]);

  const dimmed = (route: number | null) => selectedRoute !== null && route !== null && route !== selectedRoute;

  return (
    <div
      className="absolute inset-0"
      onPointerEnter={() => {
        camera.current.hover = true;
      }}
      onPointerLeave={() => {
        camera.current.hover = false;
      }}
    >
      {/* MapLibre fija la posición de su contenedor: va dentro de uno propio. */}
      <div ref={box} className="h-full w-full" />
      {map && (
        <>
          <MapMarker map={map} at={nodes[0]} z={1}>
            <DepotMarker label={depotLabel} size="full" labelled={!compact} />
          </MapMarker>
          {stops.map((stop) => (
            <MapMarker
              key={stop.customer}
              map={map}
              at={nodes[stop.node]}
              z={stop.customer === activeCustomer ? 5 : dimmed(stop.route) ? 2 : 3}
            >
              <StopMarker
                stop={stop}
                size="full"
                active={stop.customer === activeCustomer}
                dimmed={dimmed(stop.route)}
                onClick={onStop}
                buttonRef={(el) => {
                  if (el) stopEls.current.set(stop.customer, el);
                  else stopEls.current.delete(stop.customer);
                }}
              />
            </MapMarker>
          ))}
          {lines.map((l) => (
            <MapMarker key={`head-${l.route}`} map={map} at={nodes[0]} z={4} id={l.route} registry={headMarkers}>
              <div
                ref={(el) => {
                  if (el) headEls.current.set(l.route, el);
                  else headEls.current.delete(l.route);
                }}
                data-testid="head"
                className="rm-head"
                style={{ "--c": vehicleColor(l.route) } as CSSProperties}
              />
            </MapMarker>
          ))}
          {lines.map((l) => (
            <MapMarker key={`van-${l.route}`} map={map} at={nodes[0]} z={6} bottom id={l.route} registry={vanMarkers}>
              <VanMarker
                route={l.route}
                vanRef={(el) => {
                  if (el) vanEls.current.set(l.route, el);
                  else vanEls.current.delete(l.route);
                }}
              />
            </MapMarker>
          ))}
        </>
      )}
    </div>
  );
}
