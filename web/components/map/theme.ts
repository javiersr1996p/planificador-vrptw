import type { LayerSpecification, StyleSpecification } from "maplibre-gl";

/**
 * Colores del mapa. Los de furgonetas y estados se leen de las variables de
 * `globals.css` al dibujar; la base nocturna del estilo vive solo en esta tabla.
 */

type Rgb = [number, number, number];

const cache = new Map<string, Rgb>();

/** Variable de color `#rrggbb` de `:root` como terna RGB. */
export function cssRgb(name: string): Rgb {
  const hit = cache.get(name);
  if (hit) return hit;
  const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  const rgb: Rgb = m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [236, 241, 250];
  if (m) cache.set(name, rgb);
  return rgb;
}

/** Color de la furgoneta `route` con opacidad, para pinturas de MapLibre. */
export function vehicleRgba(route: number, alpha: number): string {
  const [r, g, b] = cssRgb(`--veh-${(route % 10) + 1}`);
  return `rgba(${r},${g},${b},${alpha})`;
}

const GROUND = "#050a14";
const LABEL_HALO = "rgba(5,10,20,0.92)";

/** Pintura nocturna por capa del estilo `dark` de OpenFreeMap. */
const NIGHT: Record<string, Record<string, string>> = {
  background: { "background-color": GROUND },
  water: { "fill-color": "#0a1c32" },
  waterway: { "line-color": "#0c2340" },
  landcover_ice_shelf: { "fill-color": GROUND },
  landcover_glacier: { "fill-color": GROUND },
  landcover_wood: { "fill-color": "#07151a" },
  landuse_park: { "fill-color": "#07151a" },
  landuse_residential: { "fill-color": "#070e1c" },
  building: { "fill-color": "#0a1427", "fill-outline-color": "#14233d" },
  "aeroway-area": { "fill-color": "#0d1628" },
  "aeroway-taxiway": { "line-color": "#0d1628" },
  "aeroway-runway": { "line-color": "#0d1628" },
  "aeroway-runway-casing": { "line-color": "#16233c" },
  road_area_pier: { "fill-color": GROUND },
  road_pier: { "line-color": GROUND },
  highway_path: { "line-color": "#0f1a2d" },
  highway_minor: { "line-color": "#14223a" },
  highway_major_casing: { "line-color": "rgba(70,104,160,0.42)" },
  highway_major_inner: { "line-color": "#17263f" },
  highway_major_subtle: { "line-color": "#1c2c4a" },
  highway_motorway_casing: { "line-color": "rgba(96,128,184,0.5)" },
  highway_motorway_inner: { "line-color": "#1f3254" },
  highway_motorway_subtle: { "line-color": "#1c2c4a" },
  railway_transit: { "line-color": "#1b2741" },
  railway_minor: { "line-color": "#1b2741" },
  railway: { "line-color": "#1b2741" },
  railway_transit_dashline: { "line-color": GROUND },
  railway_minor_dashline: { "line-color": GROUND },
  railway_dashline: { "line-color": GROUND },
  boundary_state: { "line-color": "#26375a" },
  "boundary_country_z0-4": { "line-color": "#26375a" },
  "boundary_country_z5-": { "line-color": "#26375a" },
  highway_name_other: { "text-color": "#8191ad", "text-halo-color": GROUND },
  highway_name_motorway: { "text-color": "#8d9dba", "text-halo-color": GROUND },
  water_name: { "text-color": "#7299c6", "text-halo-color": GROUND },
};

const PLACE = { "text-color": "#aab8cf", "text-halo-color": LABEL_HALO };

const BUILDINGS_3D = {
  id: "buildings-3d",
  type: "fill-extrusion",
  source: "openmaptiles",
  "source-layer": "building",
  minzoom: 13,
  paint: {
    "fill-extrusion-color": [
      "interpolate",
      ["linear"],
      ["coalesce", ["get", "render_height"], 8],
      0,
      "#0b1629",
      40,
      "#16274a",
      120,
      "#22386a",
    ],
    "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
    "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
    "fill-extrusion-opacity": 0.88,
  },
} as LayerSpecification;

/** Recolorea el estilo hacia la noche azul de la interfaz y le añade edificios en 3D y cielo. */
export function nightStyle(style: StyleSpecification): StyleSpecification {
  const layers = (style.layers ?? []).map((layer) => {
    const paint = NIGHT[layer.id] ?? (layer.id.startsWith("place_") ? PLACE : null);
    if (!paint) return layer;
    const next = { ...(layer.paint as Record<string, unknown> | undefined), ...paint };
    // La trama de bosque es clara: se queda el relleno liso.
    delete next["fill-pattern"];
    return { ...layer, paint: next } as LayerSpecification;
  });
  if (style.sources?.openmaptiles) {
    const firstSymbol = layers.findIndex((l) => l.type === "symbol");
    layers.splice(firstSymbol < 0 ? layers.length : firstSymbol, 0, BUILDINGS_3D);
  }
  return {
    ...style,
    layers,
    sky: {
      "sky-color": "#03060c",
      "horizon-color": "#10224a",
      "fog-color": GROUND,
      "sky-horizon-blend": 0.7,
      "horizon-fog-blend": 0.8,
      "fog-ground-blend": 0.3,
      "atmosphere-blend": 0,
    },
  };
}
