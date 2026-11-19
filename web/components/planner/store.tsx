"use client";

import { createContext, useCallback, useContext, useMemo, useReducer, useState, type ReactNode } from "react";
import type { components } from "@/lib/types";

type S = components["schemas"];

/** De dónde sale una fila de la comparativa. */
export type Origin = "precalculada" | "en vivo" | "manual";

/**
 * Una ejecución en la comparativa. Toda cifra que se muestra sale de `record`
 * (un `RunRecord` del servicio o de los datos precalculados) o de `/evaluate`.
 */
export type PlannerRun = {
  /** Única en el store; `addRun` con una clave existente sustituye esa fila. */
  key: string;
  origin: Origin;
  record: S["RunRecord"];
  /** La evaluación se rehízo con `/evaluate` tras cambiar el tráfico. */
  reevaluated?: boolean;
  /** No se pudo rehacer con el tráfico elegido: sus cifras son las de antes del cambio. */
  reevaluationFailed?: boolean;
};

/** Datos del caso que no van en la instancia. `id` es el del ejemplo, o `null` en un caso propio. */
export type CaseMeta = {
  id: string | null;
  name: string;
  attribution?: string | null;
  note?: string | null;
};

export type ServiceState = "unknown" | "checking" | "up" | "down";

/** Cálculos en vivo que no pueden solaparse con un cambio de tráfico. */
export type LiveJob = "classic" | "llm" | "traffic";

export type PlannerState = {
  meta: CaseMeta | null;
  instance: S["Instance"] | null;
  runs: PlannerRun[];
  selectedKey: string | null;
  /** Índice en `solution.routes` de la ejecución seleccionada, o `null` para todas. */
  selectedRoute: number | null;
  /** Perfil de tráfico elegido (id de `/data/traffic-profiles.json`), o `null`. */
  traffic: string | null;
  service: ServiceState;
  /** Qué cálculo en vivo está en marcha. */
  busy: Record<LiveJob, boolean>;
};

type Action =
  | { type: "setInstance"; instance: S["Instance"]; meta: CaseMeta; runs: PlannerRun[] }
  | { type: "addRun"; run: PlannerRun; select: boolean; replacing?: PlannerRun }
  | { type: "replaceRuns"; runs: PlannerRun[] }
  | { type: "selectRun"; key: string | null }
  | { type: "selectRoute"; route: number | null }
  | { type: "setTraffic"; id: string | null; windows: S["TrafficWindow"][] | null }
  | { type: "setService"; service: ServiceState }
  | { type: "setBusy"; job: LiveJob; busy: boolean };

/**
 * Clave estable de una fila: las precalculadas por `run_id`; las demás por
 * origen, método y modelo, para que una nueva ejecución en vivo del mismo
 * método sustituya a la anterior.
 */
export function runKey(origin: Origin, record: S["RunRecord"]): string {
  if (origin === "precalculada") return `precalculada:${record.run_id}`;
  if (origin === "manual") return "manual";
  return `en vivo:${record.method}:${record.model_requested ?? ""}`;
}

export function makeRun(origin: Origin, record: S["RunRecord"]): PlannerRun {
  return { key: runKey(origin, record), origin, record };
}

/** Tiene rutas y evaluación: se puede dibujar y comparar. */
export function hasSolution(run: PlannerRun): boolean {
  return !!run.record.solution && !!run.record.evaluation;
}

/**
 * Orden de la comparativa: válidas por coste, después no válidas por coste y al
 * final las que no dejaron una solución legible. Nunca se descarta ninguna.
 */
export function rankRuns(runs: PlannerRun[]): PlannerRun[] {
  const group = (r: PlannerRun) => (!hasSolution(r) ? 2 : r.record.evaluation!.feasible ? 0 : 1);
  return runs
    .map((run, i) => ({ run, i }))
    .sort((a, b) => {
      const g = group(a.run) - group(b.run);
      if (g !== 0) return g;
      const sa = a.run.record.evaluation?.score ?? 0;
      const sb = b.run.record.evaluation?.score ?? 0;
      return sa - sb || a.i - b.i;
    })
    .map((x) => x.run);
}

/** La mejor solución válida o, si no hay ninguna, la de menor coste. */
export function bestRunKey(runs: PlannerRun[]): string | null {
  return rankRuns(runs).find(hasSolution)?.key ?? null;
}

export const initialPlannerState: PlannerState = {
  meta: null,
  instance: null,
  runs: [],
  selectedKey: null,
  selectedRoute: null,
  traffic: null,
  service: "unknown",
  busy: { classic: false, llm: false, traffic: false },
};

export function plannerReducer(state: PlannerState, action: Action): PlannerState {
  switch (action.type) {
    case "setInstance":
      return {
        ...state,
        instance: action.instance,
        meta: action.meta,
        runs: action.runs,
        selectedKey: bestRunKey(action.runs),
        selectedRoute: null,
        traffic: null,
      };
    case "addRun": {
      const at = state.runs.findIndex((r) => r.key === action.run.key);
      // Solo sustituye la fila que se leyó: si cambió (o se retiró) mientras tanto, no se toca.
      if (action.replacing && state.runs[at] !== action.replacing) return state;
      const runs = at === -1 ? [...state.runs, action.run] : state.runs.map((r, i) => (i === at ? action.run : r));
      if (action.select) return { ...state, runs, selectedKey: action.run.key, selectedRoute: null };
      // Si se sustituye la fila seleccionada, la ruta elegida se conserva mientras exista.
      const routes = action.run.record.solution?.routes.length ?? 0;
      const keepRoute = state.selectedKey !== action.run.key || (state.selectedRoute ?? 0) < routes;
      return { ...state, runs, selectedRoute: keepRoute ? state.selectedRoute : null };
    }
    case "replaceRuns": {
      const stillThere = action.runs.some((r) => r.key === state.selectedKey);
      return stillThere
        ? { ...state, runs: action.runs }
        : { ...state, runs: action.runs, selectedKey: bestRunKey(action.runs), selectedRoute: null };
    }
    case "selectRun":
      return { ...state, selectedKey: action.key, selectedRoute: null };
    case "selectRoute":
      return { ...state, selectedRoute: action.route };
    case "setTraffic":
      return state.instance
        ? { ...state, traffic: action.id, instance: { ...state.instance, traffic_profile: action.windows } }
        : state;
    case "setService":
      return { ...state, service: action.service };
    case "setBusy":
      return state.busy[action.job] === action.busy ? state : { ...state, busy: { ...state.busy, [action.job]: action.busy } };
  }
}

export type PlannerActions = {
  /** Sustituye el caso. Sin `runs`, la comparativa queda vacía. Selecciona la mejor solución válida. */
  setInstance: (instance: S["Instance"], options?: { meta?: CaseMeta; runs?: PlannerRun[] }) => void;
  /**
   * Añade una fila o sustituye la de la misma clave. Con `select`, la deja seleccionada.
   * Con `replacing`, solo sustituye si la fila de esa clave sigue siendo esa.
   */
  addRun: (run: PlannerRun, options?: { select?: boolean; replacing?: PlannerRun }) => void;
  replaceRuns: (runs: PlannerRun[]) => void;
  selectRun: (key: string | null) => void;
  selectRoute: (route: number | null) => void;
  /** Cambia el perfil de tráfico de la instancia (`windows` va a `instance.traffic_profile`). */
  setTraffic: (id: string | null, windows: S["TrafficWindow"][] | null) => void;
  setService: (service: ServiceState) => void;
  setBusy: (job: LiveJob, busy: boolean) => void;
};

type StopClickHandler = (customer: number) => void;

type PlannerContextValue = {
  state: PlannerState;
  actions: PlannerActions;
  /** Ejecución seleccionada, o `null`. */
  selected: PlannerRun | null;
  /** Si hay un manejador registrado, pulsar una parada del mapa lo llama en vez de abrir su ficha. */
  stopClickHandler: StopClickHandler | null;
  /** Registra (o quita, con `null`) el manejador de pulsación de paradas del mapa. */
  setStopClickHandler: (handler: StopClickHandler | null) => void;
};

const PlannerContext = createContext<PlannerContextValue | null>(null);

export function PlannerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(plannerReducer, initialPlannerState);
  const [stopClickHandler, setHandler] = useState<StopClickHandler | null>(null);

  const actions = useMemo<PlannerActions>(
    () => ({
      setInstance: (instance, options) =>
        dispatch({
          type: "setInstance",
          instance,
          meta: options?.meta ?? { id: null, name: instance.name },
          runs: options?.runs ?? [],
        }),
      addRun: (run, options) => dispatch({ type: "addRun", run, select: options?.select ?? false, replacing: options?.replacing }),
      replaceRuns: (runs) => dispatch({ type: "replaceRuns", runs }),
      selectRun: (key) => dispatch({ type: "selectRun", key }),
      selectRoute: (route) => dispatch({ type: "selectRoute", route }),
      setTraffic: (id, windows) => dispatch({ type: "setTraffic", id, windows }),
      setService: (service) => dispatch({ type: "setService", service }),
      setBusy: (job, busy) => dispatch({ type: "setBusy", job, busy }),
    }),
    [],
  );

  const setStopClickHandler = useCallback((handler: StopClickHandler | null) => setHandler(() => handler), []);

  const selected = state.runs.find((r) => r.key === state.selectedKey) ?? null;

  const value = useMemo(
    () => ({ state, actions, selected, stopClickHandler, setStopClickHandler }),
    [state, actions, selected, stopClickHandler, setStopClickHandler],
  );

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): PlannerContextValue {
  const value = useContext(PlannerContext);
  if (!value) throw new Error("usePlanner necesita un PlannerProvider");
  return value;
}
