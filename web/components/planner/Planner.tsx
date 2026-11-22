"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { LlmScope } from "@/components/llm/LlmPanel";
import { hasGeo } from "@/components/map/geometry";
import { RouteMap } from "@/components/map/RouteMap";
import { Corners } from "@/components/ui/Corners";
import { caseText } from "@/lib/case-names";
import { fetchCase, fetchCaseIndex, type CaseFile, type CaseSummary } from "@/lib/cases";
import { useT } from "@/lib/i18n";
import { playback } from "@/lib/playback";
import { Comparison } from "./Comparison";
import { ExamplePicker } from "./ExamplePicker";
import { Hook } from "./Hook";
import { Kpis } from "./Kpis";
import { LearnCard } from "./LearnCard";
import { LiveActions, LivePanel, type LiveTab } from "./LivePanel";
import { Playbar } from "./Playbar";
import { RadioLine } from "./RadioLine";
import { RunDetail } from "./RunDetail";
import { ServiceStatus } from "./ServiceStatus";
import { PlannerProvider, makeRun, usePlanner, type PlannerRun } from "./store";
import { Validity } from "./Validity";

/** Plan que enseña el estado «tarde»: la búsqueda tabú exportada de este caso llega tarde a 4 paradas. */
const LATE_EXAMPLE = { caseId: "tfe2024-10c-1", method: "tabu" } as const;

/** Escritorio: la zona de trabajo en dos columnas y el panel en vivo a su izquierda. */
const DESKTOP = "(min-width: 1180px)";

/**
 * Portada: titular, casos y acciones en vivo, mapa con la reproducción del
 * día, comparativa e indicadores, y debajo el detalle por furgoneta y la
 * validez del plan. Los ejemplos se leen de `/data/`, sin depender del servicio.
 */
export function Planner() {
  return (
    <PlannerProvider>
      <LlmScope>
        <Workspace />
      </LlmScope>
    </PlannerProvider>
  );
}

/** Solo cambia cuando cambia el nivel de movimiento, no a cada fotograma. */
function useMotion(): boolean {
  return useSyncExternalStore(playback.subscribe, () => playback.getSnapshot().motion, () => true);
}

function Workspace() {
  const t = useT();
  const { state, actions, selected, stopClickHandler } = usePlanner();
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; name: string } | "index" | null>(null);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveTab, setLiveTab] = useState<LiveTab>("resolver");
  const actionRefs = useRef<Partial<Record<LiveTab, HTMLButtonElement | null>>>({});
  const mapCard = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, CaseFile>());
  const inflight = useRef<AbortController | null>(null);
  const started = useRef(false);
  const motion = useMotion();

  const open = useCallback(
    async (id: string, name: string, pick?: (runs: PlannerRun[]) => string | undefined) => {
      inflight.current?.abort();
      const ctrl = new AbortController();
      inflight.current = ctrl;
      setPending(id);
      setFailed(null);
      try {
        let file = cache.current.get(id);
        if (!file) {
          file = await fetchCase(id, ctrl.signal);
          cache.current.set(id, file);
        }
        if (ctrl.signal.aborted) return;
        const runs = file.runs.map((r) => makeRun("precalculada", r));
        actions.setInstance(file.instance, {
          meta: { id, name, attribution: file.attribution, note: file.note },
          runs,
        });
        const key = pick?.(runs);
        if (key) actions.selectRun(key);
      } catch {
        if (!ctrl.signal.aborted) setFailed({ id, name });
      } finally {
        if (inflight.current === ctrl) setPending(null);
      }
    },
    [actions],
  );

  const loadIndex = useCallback(async () => {
    setFailed(null);
    try {
      const index = await fetchCaseIndex();
      setCases(index.cases);
      const first = index.cases.find((c) => c.default) ?? index.cases[0];
      if (first) await open(first.id, first.name);
    } catch {
      setFailed("index");
    }
  }, [open]);

  // Una sola carga inicial: si la página se oculta y vuelve a mostrarse, el caso
  // abierto y sus ejecuciones se conservan.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void loadIndex();
  }, [loadIndex]);

  const lateCase = cases?.find((c) => c.id === LATE_EXAMPLE.caseId);
  const lateRun = (runs: PlannerRun[]) =>
    runs.find((r) => r.record.method === LATE_EXAMPLE.method && r.record.evaluation)?.key;
  // Con ese caso ya abierto solo se elige el plan: recargarlo descartaría las filas en vivo y tu ruta.
  const showLate = lateCase
    ? () => {
        const key = state.meta?.id === lateCase.id && pending === null ? lateRun(state.runs) : undefined;
        if (key) actions.selectRun(key);
        else void open(lateCase.id, lateCase.name, lateRun);
      }
    : undefined;

  // En móvil el panel es una hoja inferior: el mapa sube para quedar a la vista encima.
  function revealMap() {
    if (window.matchMedia(DESKTOP).matches) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    mapCard.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }

  function toggleLive(tab: LiveTab) {
    if (liveOpen && tab === liveTab) {
      setLiveOpen(false);
      return;
    }
    setLiveTab(tab);
    setLiveOpen(true);
    revealMap();
  }

  function pickTab(tab: LiveTab) {
    setLiveTab(tab);
    if (tab === "ruta") revealMap();
  }

  function closeLive() {
    setLiveOpen(false);
    actionRefs.current[liveTab]?.focus({ preventScroll: true });
  }

  const routes = selected?.record.solution?.routes ?? [];
  const evaluation = selected?.record.evaluation ?? null;
  const straightLine = state.instance?.matrix?.source === "haversine_fallback";
  // «Tu ruta» en móvil: hoja más baja y mapa que cabe entero encima, para poder pulsar todas las paradas.
  const routeSheet = liveOpen && liveTab === "ruta";
  // En móvil, 428 px con mapa real y 460 en plano, donde los casos de Solomon dibujan hasta cien clientes.
  const geo = state.instance ? hasGeo(state.instance) : true;

  return (
    <div className="flex flex-col pb-6" data-motion={motion ? "on" : "off"}>
      {/* Titular, pregunta, casos y acciones en vivo. */}
      <div className="rise grid gap-y-4 pt-1 pb-4 [grid-template-areas:'hook'_'sub'_'cases'_'live'] min-[761px]:gap-y-5 min-[761px]:pb-5 min-[1180px]:grid-cols-[minmax(0,1fr)_auto] min-[1180px]:gap-x-8 min-[1180px]:[grid-template-areas:'hook_hook'_'sub_live'_'cases_cases']">
        <div data-zone className="[grid-area:hook]">
          <Hook instance={state.instance} />
        </div>
        <p data-zone className="m-0 self-center text-base leading-snug font-medium text-fg-2 [grid-area:sub] min-[761px]:text-[clamp(16px,1.25vw,19px)]">
          {t({ es: "¿Qué método traza el plan más corto sin llegar tarde a nadie?", en: "Which method draws the shortest plan without making anyone late?" })}
        </p>
        <div className="min-w-0 [grid-area:cases]">
          <ExamplePicker
            cases={cases}
            activeId={state.meta?.id ?? null}
            pendingId={pending}
            onPick={(id) => {
              const c = cases?.find((x) => x.id === id);
              if (c && id !== state.meta?.id) void open(c.id, c.name);
            }}
          />
          {failed && (
            <p role="alert" className="mt-2 flex flex-wrap items-center gap-x-3 text-base text-late">
              {failed === "index"
                ? t({ es: "No se pudo leer la lista de ejemplos.", en: "Could not read the list of examples." })
                : t({
                    es: `No se pudo cargar «${failed.name}».`,
                    en: `Could not load “${t(caseText(failed.id, "name", failed.name))}”.`,
                  })}
              <button
                type="button"
                onClick={() => (failed === "index" ? void loadIndex() : void open(failed.id, failed.name))}
                className="btn min-h-10 border-late/60 text-late"
              >
                {t({ es: "Reintentar", en: "Retry" })}
              </button>
            </p>
          )}
        </div>
        <div className="min-w-0 self-center [grid-area:live]">
          <LiveActions open={liveOpen} tab={liveTab} onToggle={toggleLive} refs={actionRefs}>
            <ServiceStatus />
          </LiveActions>
        </div>
      </div>

      {/* Zona de trabajo: panel en vivo (si está abierto), mapa con reproducción, comparativa e indicadores. */}
      <div
        className={`grid gap-4 min-[761px]:gap-6 min-[1180px]:min-h-[clamp(538px,calc(100svh-258px),738px)] min-[1180px]:grid-rows-[minmax(0,1fr)] ${
          liveOpen
            ? "min-[1180px]:grid-cols-[360px_minmax(0,1fr)_404px]"
            : "min-[1180px]:grid-cols-[minmax(0,1fr)_404px]"
        }`}
      >
        <LivePanel open={liveOpen} tab={liveTab} onTab={pickTab} onClose={closeLive} />

        <div ref={mapCard} className="rise flex min-h-0 min-w-0 scroll-mt-3 flex-col gap-2" style={{ "--i": 2 } as CSSProperties}>
          {straightLine && (
            <p
              data-testid="straight-line-warning"
              className="rounded-tag border border-wait/40 bg-wait/10 px-3 py-1.5 text-base text-wait"
            >
              {t({ es: "Distancias en línea recta: el servicio de rutas no está disponible", en: "Straight-line distances: the routing service is not available" })}
            </p>
          )}
          <div className="@container relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-panel border border-line-2 bg-[#050a14] shadow-[var(--shadow-deep),inset_0_0_0_1px_rgb(255_255_255/0.02)]">
            <div
              data-testid="map-area"
              data-tour="map"
              aria-busy={pending !== null}
              className={`relative isolate grid min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden min-[1180px]:h-auto min-[1180px]:flex-1 ${
                routeSheet
                  ? `${geo ? "h-[min(428px,calc(56svh-24px))]" : "h-[min(460px,calc(56svh-24px))]"} min-[761px]:h-[min(560px,calc(56svh-24px))]`
                  : `${geo ? "h-[428px]" : "h-[460px]"} min-[761px]:h-[560px]`
              }`}
            >
              {state.instance && (
                <RouteMap
                  instance={state.instance}
                  routes={routes}
                  evaluation={evaluation}
                  selectedRoute={state.selectedRoute}
                  onSelectRoute={actions.selectRoute}
                  onStopClick={stopClickHandler ?? undefined}
                />
              )}
              <span className="max-[760px]:hidden">
                <Corners />
              </span>
              {state.instance && <RadioLine instance={state.instance} evaluation={evaluation} />}
              {(pending !== null || (!state.instance && !failed)) && (
                <div className="absolute inset-0 z-[5] grid place-items-center bg-ink-0/40 backdrop-blur-[1px]">
                  <span className="hud flex items-center gap-2 px-3 py-1.5 text-base text-fg-2">
                    <span className="inline-block size-4 animate-spin rounded-full border-2 border-fg-2 border-t-transparent" />
                    {t({ es: "Cargando el caso", en: "Loading the case" })}
                  </span>
                </div>
              )}
            </div>
            {state.instance && <Playbar instance={state.instance} evaluation={evaluation} />}
          </div>
        </div>

        <div className="rise flex min-h-0 min-w-0 flex-col gap-4 min-[761px]:max-[1179px]:grid min-[761px]:max-[1179px]:grid-cols-2 min-[761px]:max-[1179px]:items-start min-[761px]:gap-6" style={{ "--i": 3 } as CSSProperties}>
          <Comparison />
          <Kpis />
        </div>
      </div>

      {/* Debajo: el día de una furgoneta y, al lado, «Aprende» y la validez con el origen de los datos al pie. */}
      <div className="mt-4 grid items-start gap-4 min-[761px]:mt-6 min-[761px]:gap-6 min-[1180px]:grid-cols-[minmax(0,1fr)_404px]">
        <RunDetail onShowLate={showLate} />
        <div className="flex min-w-0 flex-col gap-4 min-[761px]:gap-6">
          <LearnCard />
          <Validity />
        </div>
      </div>
    </div>
  );
}
