"use client";

import { Activity, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchCase, type CaseFile } from "@/lib/cases";
import { MotionIcon } from "@/components/ui/MotionIcon";
import { playback } from "@/lib/playback";
import { Arrow } from "./parts";
import { sceneTitleId } from "./SceneFrame";
import { SceneAI } from "./SceneAI";
import { SceneCapacity } from "./SceneCapacity";
import { SceneCost } from "./SceneCost";
import { SceneMethods } from "./SceneMethods";
import { SceneProblem } from "./SceneProblem";
import { SceneWindow } from "./SceneWindow";
import { SceneYou } from "./SceneYou";
import "./learn.css";

/** El caso de las escenas 5 y 6: se lee como fichero estático, sin el servicio. */
export const LEARN_CASE_ID = "tfe2024-10c-1";

export type CaseState = { status: "loading" } | { status: "error" } | { status: "ready"; file: CaseFile };

const TITLES = ["El problema", "La ventana horaria", "La capacidad", "El coste", "Los métodos", "La IA", "Ahora tú"];
const LAST = TITLES.length - 1;

/** Solo cambia con el nivel de movimiento (compartido con el planificador), no a cada fotograma. */
function useMotion(): boolean {
  return useSyncExternalStore(playback.subscribe, () => playback.getSnapshot().motion, () => true);
}

function loadCase(set: (state: CaseState) => void) {
  fetchCase(LEARN_CASE_ID).then(
    (file) => set({ status: "ready", file }),
    () => set({ status: "error" }),
  );
}

/** Teclas de flecha para pasar de escena, salvo dentro de un control que ya las usa. */
function usesArrows(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select, [role='slider'], [role='radiogroup']") !== null;
}

/**
 * Historia por escenas, una a la vez. Las escenas ocultas siguen montadas
 * (`Activity`): lo que el visitante dibujó sigue ahí al volver.
 */
export function LearnStory() {
  const [scene, setScene] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [data, setData] = useState<CaseState>({ status: "loading" });
  const motion = useMotion();
  const root = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const ctaRef = useRef<HTMLAnchorElement>(null);
  const focusAfter = useRef<"next" | "cta" | null>(null);
  const started = useRef(false);

  // Una sola carga: al volver a esta página (oculta, no desmontada) el caso sigue ahí.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    loadCase(setData);
  }, []);

  function retry() {
    setData({ status: "loading" });
    loadCase(setData);
  }

  function go(target: number) {
    if (target < 0 || target > LAST || target === scene) return;
    setDir(target > scene ? 1 : -1);
    setScene(target);
    // Si el botón con el foco desaparece o se desactiva, el foco pasa al siguiente paso lógico.
    if (target === LAST) focusAfter.current = "cta";
    else if (target === 0) focusAfter.current = "next";
    // En móvil la escena nueva se lee desde su título.
    const top = root.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      root.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
  }

  useEffect(() => {
    const pending = focusAfter.current;
    focusAfter.current = null;
    const active = document.activeElement;
    const lost = !active || active === document.body || (active instanceof HTMLButtonElement && active.disabled);
    if (pending === "cta" && lost) {
      ctaRef.current?.focus({ preventScroll: true });
    } else if (pending === "next" && lost) {
      nextRef.current?.focus({ preventScroll: true });
    }
  }, [scene]);

  // Flechas izquierda y derecha: escena anterior y siguiente.
  const stepRef = useRef((delta: number) => go(scene + delta));
  useEffect(() => {
    stepRef.current = (delta) => go(scene + delta);
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      if (usesArrows(event.target) || document.querySelector("[data-testid='help-popover']")) return;
      event.preventDefault();
      stepRef.current(event.key === "ArrowRight" ? 1 : -1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const scenes = [
    <SceneProblem key="1" motion={motion} />,
    <SceneWindow key="2" />,
    <SceneCapacity key="3" />,
    <SceneCost key="4" />,
    <SceneMethods key="5" data={data} motion={motion} onRetry={retry} />,
    <SceneAI key="6" data={data} motion={motion} onRetry={retry} />,
    <SceneYou key="7" motion={motion} ctaRef={ctaRef} onPick={go} />,
  ];

  return (
    <div ref={root} className="scroll-mt-2 pt-2 pb-6 lg:pt-3" data-motion={motion ? "on" : "off"} data-testid="learn-story">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 lg:mb-6 lg:gap-y-3">
        <div className="min-w-0">
          <p className="kicker">
            Aprende · escena {scene + 1} de {TITLES.length}
          </p>
          <h1 className="mt-2 text-[24px] font-extrabold sm:text-[clamp(28px,2.6vw,38px)]">Rutas con horario, en siete escenas</h1>
        </div>
        <nav aria-label="Escenas" className="-mx-1.5 max-w-full">
          <ol className="flex">
            {TITLES.map((title, i) => (
              <li key={title}>
                <button
                  type="button"
                  data-testid="learn-dot"
                  aria-label={`Escena ${i + 1}: ${title}`}
                  aria-current={i === scene ? "step" : undefined}
                  title={title}
                  onClick={() => go(i)}
                  className="group grid h-11 w-11 cursor-pointer place-items-center"
                >
                  <span
                    aria-hidden="true"
                    className={`block h-2.5 rounded-full transition-[width,background-color,box-shadow] duration-200 ease-[var(--ease-out)] ${
                      i === scene
                        ? "w-7 bg-amber shadow-[0_0_14px_rgb(255_181_71/0.8)]"
                        : i < scene
                          ? "w-2.5 bg-amber/55"
                          : "w-2.5 bg-fg-3/40 [@media(hover:hover)]:group-hover:bg-fg-3"
                    }`}
                  />
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </div>

      <p className="sr-only" aria-live="polite">
        Escena {scene + 1} de {TITLES.length}: {TITLES[scene]}
      </p>

      {/* La entrada lateral de cada escena no debe ensanchar la página: se recorta con margen para los anillos de foco. */}
      <div className="overflow-x-clip [overflow-clip-margin:12px]">
        {scenes.map((node, i) => (
          <Activity key={i} mode={i === scene ? "visible" : "hidden"}>
            <section
              data-testid="learn-scene"
              data-scene={i + 1}
              data-dir={dir}
              aria-labelledby={sceneTitleId(i + 1)}
              className="lrn-scene"
            >
              {node}
            </section>
          </Activity>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4 lg:mt-6">
        <button
          type="button"
          className="btn"
          data-testid="learn-prev"
          disabled={scene === 0}
          onClick={() => go(scene - 1)}
        >
          <Arrow back />
          Anterior
        </button>
        <button
          type="button"
          role="switch"
          className="btn max-md:btn-icon"
          aria-checked={motion}
          aria-label="Animación"
          data-testid="learn-motion"
          onClick={() => playback.setMotion(!motion)}
        >
          <MotionIcon on={motion} />
          <span className="max-md:hidden">{motion ? "Animación: sí" : "Animación: no"}</span>
        </button>
        {scene < LAST ? (
          <button key="next" ref={nextRef} type="button" className="btn btn-amber" data-testid="learn-next" onClick={() => go(scene + 1)}>
            <span>
              Siguiente<span className="font-normal max-lg:sr-only">: {TITLES[scene + 1]}</span>
            </span>
            <Arrow />
          </button>
        ) : (
          <button key="restart" type="button" className="btn" data-testid="learn-restart" onClick={() => go(0)}>
            Volver a empezar
          </button>
        )}
      </div>
    </div>
  );
}
