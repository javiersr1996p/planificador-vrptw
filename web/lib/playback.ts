import { useSyncExternalStore } from "react";

/**
 * Reloj de reproducción del día simulado, fuera de React.
 *
 * El mapa y la barra de reproducción lo leen con `useSyncExternalStore` (o con
 * `subscribe` directo): avanzar el reloj no pasa por el estado del planificador.
 * La hora va en las unidades de la instancia (minutos en los casos reales).
 *
 * Tres niveles de movimiento:
 * - completo (`motion: true`);
 * - "Pausar movimiento" (`setMotion(false)`): sin adornos, la reproducción sigue;
 * - `prefers-reduced-motion: reduce`: arranca con `motion: false` y el reloj no
 *   avanza solo (`play` no hace nada); `seek` sigue funcionando. Si el visitante
 *   activa el movimiento a mano, `play` vuelve a funcionar.
 */

/** Velocidades de la barra, en orden de ciclo. */
export const SPEEDS = [1, 4, 10] as const;

/** Segundos reales que dura el día completo a ×1, sea cual sea su unidad. */
export const DAY_SECONDS = 30;

/** Paso máximo por fotograma: tras una pestaña oculta, el reloj no salta. */
const MAX_STEP_S = 0.1;

export type PlaybackSnapshot = Readonly<{
  /** Inicio y fin del día (p. ej. `depot.ready` y la última vuelta a la base). */
  start: number;
  end: number;
  /** Hora simulada actual, entre `start` y `end`. */
  t: number;
  playing: boolean;
  speed: number;
  /** Adornos en marcha: órbita, estelas, pulsos. */
  motion: boolean;
  /** El sistema pide reducir el movimiento. */
  reducedMotion: boolean;
}>;

export type Playback = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): PlaybackSnapshot;
  getServerSnapshot(): PlaybackSnapshot;
  /** Fija el día y lleva el reloj al inicio, en pausa. Sin efecto si no cambia. */
  setRange(start: number, end: number): void;
  /** Reproduce desde la hora actual; al final, vuelve a empezar. */
  play(): void;
  pause(): void;
  /** Lleva el reloj a `t`, recortada al día. */
  seek(t: number): void;
  setSpeed(speed: number): void;
  setMotion(on: boolean): void;
};

type FrameScheduler = {
  request: (callback: (timestamp: number) => void) => number;
  cancel: (id: number) => void;
};

export type PlaybackOptions = {
  /** Por defecto, `prefers-reduced-motion` del navegador. */
  reducedMotion?: boolean;
  /** Por defecto, `requestAnimationFrame`. Las pruebas pasan uno propio. */
  frames?: FrameScheduler;
};

const SERVER_SNAPSHOT: PlaybackSnapshot = Object.freeze({
  start: 0,
  end: 0,
  t: 0,
  playing: false,
  speed: 1,
  motion: true,
  reducedMotion: false,
});

export function createPlayback(options: PlaybackOptions = {}): Playback {
  const browser = typeof window !== "undefined";
  const media =
    browser && options.reducedMotion === undefined ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reduced = options.reducedMotion ?? media?.matches ?? false;
  const frames: FrameScheduler | null =
    options.frames ??
    (browser ? { request: (cb) => window.requestAnimationFrame(cb), cancel: (id) => window.cancelAnimationFrame(id) } : null);

  let state: PlaybackSnapshot = Object.freeze({ ...SERVER_SNAPSHOT, motion: !reduced, reducedMotion: reduced });
  const listeners = new Set<() => void>();
  let frame: number | null = null;
  let last: number | null = null;

  function set(patch: Partial<PlaybackSnapshot>) {
    const next = { ...state, ...patch };
    if ((Object.keys(next) as (keyof PlaybackSnapshot)[]).every((k) => next[k] === state[k])) return;
    state = Object.freeze(next);
    listeners.forEach((listener) => listener());
  }

  const canAdvance = () => state.end > state.start && (state.motion || !state.reducedMotion);

  function stopLoop() {
    if (frame !== null) frames?.cancel(frame);
    frame = null;
    last = null;
  }

  function tick(timestamp: number) {
    frame = null;
    if (!state.playing) return;
    const dt = last === null ? 0 : Math.min(MAX_STEP_S, Math.max(0, (timestamp - last) / 1000));
    last = timestamp;
    const rate = ((state.end - state.start) / DAY_SECONDS) * state.speed;
    const t = Math.min(state.end, state.t + dt * rate);
    set({ t, playing: t < state.end });
    if (state.playing && frames) frame = frames.request(tick);
    else stopLoop();
  }

  function pause() {
    stopLoop();
    set({ playing: false });
  }

  media?.addEventListener("change", (event) => {
    set({ reducedMotion: event.matches, motion: !event.matches });
    if (state.playing && !canAdvance()) pause();
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    getServerSnapshot: () => SERVER_SNAPSHOT,
    setRange(start, end) {
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
      if (start === state.start && end === state.end) return;
      stopLoop();
      set({ start, end, t: start, playing: false });
    },
    play() {
      if (state.playing || !canAdvance()) return;
      set({ t: state.t >= state.end ? state.start : state.t, playing: true });
      if (frames && frame === null) frame = frames.request(tick);
    },
    pause,
    seek(t) {
      if (!Number.isFinite(t)) return;
      const clamped = Math.min(state.end, Math.max(state.start, t));
      if (state.playing && clamped >= state.end) {
        stopLoop();
        set({ t: clamped, playing: false });
      } else {
        set({ t: clamped });
      }
    },
    setSpeed(speed) {
      if (Number.isFinite(speed) && speed > 0) set({ speed });
    },
    setMotion(on) {
      set({ motion: on });
      if (state.playing && !canAdvance()) pause();
    },
  };
}

/** Siguiente velocidad del ciclo ×1, ×4, ×10. */
export function nextSpeed(speed: number): number {
  const i = SPEEDS.indexOf(speed as (typeof SPEEDS)[number]);
  return SPEEDS[(i + 1) % SPEEDS.length];
}

/** Reloj compartido de la aplicación. */
export const playback = createPlayback();

/** Lectura del reloj compartido desde un Client Component. */
export function usePlayback(): PlaybackSnapshot {
  return useSyncExternalStore(playback.subscribe, playback.getSnapshot, playback.getServerSnapshot);
}
