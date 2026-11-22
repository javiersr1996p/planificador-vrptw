"use client";

import { useCallback, useEffect, useRef } from "react";
import { health } from "@/lib/api";
import { useT, type Pair } from "@/lib/i18n";
import { usePlanner, type ServiceState } from "./store";

/** Tiempo de espera de la primera petición a `/health`. */
const HEALTH_TIMEOUT_MS = 5000;
/** Si esa primera espera se agota, el servicio puede estar despertando (plan gratuito que se duerme): se sigue intentando. */
const WAKING_ATTEMPT_MS = 10000;
const WAKING_PAUSE_MS = 2000;
/** Plazo total desde el primer intento; pasado, el servicio se da por no disponible. */
const WAKING_DEADLINE_MS = 90000;

/** Texto del aviso cuando el servicio no responde; lo comparten el indicador y los paneles en vivo. */
export const SERVICE_DOWN_TEXT: Pair = {
  es: "Servicio no disponible: se muestran los resultados precalculados",
  en: "Service unavailable: showing the precomputed results",
};

/** Texto del aviso mientras el servicio despierta. */
export const SERVICE_WAKING_TEXT: Pair = {
  es: "Despertando el servicio (hasta un minuto)…",
  en: "Waking up the service (up to a minute)…",
};

/** Sin servicio utilizable ahora (caído o despertando): las acciones en vivo se desactivan. */
export const serviceOff = (s: ServiceState) => s === "down" || s === "waking";

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Estado del servicio y su comprobación (`GET /health`).
 * La primera petición espera 5 s: si falla antes, `down`; si se agota, `waking` y se sigue
 * intentando hasta 90 s desde el inicio (una respuesta no 2xx cuenta como "aún despertando").
 * `check` se puede llamar a mano (reintento); si ya hay una en curso, la sustituye.
 */
export function useService(): { service: ServiceState; check: () => Promise<void> } {
  const { state, actions } = usePlanner();
  const inflight = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    // Cancelada por otra comprobación o por ocultarse la página: la que manda decide el estado.
    const current = () => inflight.current === ctrl && !ctrl.signal.aborted;
    const start = Date.now();
    actions.setService("checking");
    for (let first = true; ; first = false) {
      const attempt = new AbortController();
      const cancel = () => attempt.abort();
      ctrl.signal.addEventListener("abort", cancel);
      let timedOut = false;
      const limit = first ? HEALTH_TIMEOUT_MS : Math.min(WAKING_ATTEMPT_MS, WAKING_DEADLINE_MS - (Date.now() - start));
      const timer = setTimeout(() => {
        timedOut = true;
        attempt.abort();
      }, limit);
      try {
        await health(attempt.signal);
        if (current()) actions.setService("up");
        return;
      } catch {
        if (!current()) return;
        if (first && !timedOut) return actions.setService("down");
        if (first) actions.setService("waking");
      } finally {
        clearTimeout(timer);
        ctrl.signal.removeEventListener("abort", cancel);
      }
      const left = WAKING_DEADLINE_MS - (Date.now() - start);
      if (left <= 0) return actions.setService("down");
      if (!timedOut) await sleep(Math.min(WAKING_PAUSE_MS, left));
      if (!current()) return;
      if (WAKING_DEADLINE_MS - (Date.now() - start) <= 0) return actions.setService("down");
    }
  }, [actions]);

  return { service: state.service, check };
}

/** Comprueba el servicio al cargar, una sola vez aunque la página se oculte y vuelva a mostrarse. */
function useInitialCheck(check: () => Promise<void>) {
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void check();
  }, [check]);
}

function Dot({ state }: { state: ServiceState }) {
  if (state === "down") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 flex-none">
        <path d="M8 1.5 L15 14 H1 Z" fill="var(--late)" />
        <path d="M8 6 V9.5" stroke="var(--ink-0)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="8" cy="11.8" r="1" fill="var(--ink-0)" />
      </svg>
    );
  }
  if (state === "waking") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 flex-none">
        <circle cx="8" cy="8" r="7" fill="none" stroke="var(--amber)" strokeWidth="1.6" />
        <path d="M8 4.2 V8 L10.6 9.6" fill="none" stroke="var(--amber)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (state === "up") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 flex-none">
        <circle cx="8" cy="8" r="7" fill="none" stroke="var(--ok)" strokeWidth="1.6" />
        <path d="M4.8 8.3 7 10.4 11.3 5.8" fill="none" stroke="var(--ok)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return <span aria-hidden="true" className="inline-block size-3.5 flex-none animate-spin rounded-full border-2 border-fg-2 border-t-transparent" />;
}

const SHORT: Record<ServiceState, Pair> = {
  unknown: { es: "Comprobando el servicio", en: "Checking the service" },
  checking: { es: "Comprobando el servicio", en: "Checking the service" },
  up: { es: "Servicio activo", en: "Service active" },
  waking: { es: "Despertando el servicio", en: "Waking up the service" },
  down: { es: "Sin servicio", en: "No service" },
};

/**
 * Indicador del servicio junto a las acciones en vivo. A menos de 761 px solo
 * queda el icono (con su texto para lectores de pantalla); el aviso completo y
 * el reintento están en cada panel (`ServiceNotice`).
 */
export function ServiceStatus() {
  const t = useT();
  const { service, check } = useService();
  useInitialCheck(check);
  const down = service === "down";

  return (
    <div
      data-testid="service-status"
      data-state={service}
      role="status"
      className="flex min-w-0 flex-none items-center gap-2 text-base leading-none text-fg-2"
    >
      <Dot state={service} />
      <span className="max-[760px]:sr-only">{t(SHORT[service])}</span>
      {down && (
        <button
          type="button"
          data-testid="service-retry"
          onClick={() => void check()}
          className="btn min-h-11 px-3 max-[760px]:hidden"
        >
          {t({ es: "Reintentar", en: "Retry" })}
        </button>
      )}
    </div>
  );
}

/**
 * Aviso completo de servicio caído (con el reintento) o despertando. No muestra nada si el
 * servicio responde. Lo usan los paneles en vivo para explicar por qué sus
 * acciones están desactivadas (`id` sirve para `aria-describedby`).
 */
export function ServiceNotice({ id }: { id?: string }) {
  const t = useT();
  const { service, check } = useService();
  if (!serviceOff(service)) return null;
  if (service === "waking") {
    return (
      <div
        id={id}
        role="status"
        data-testid="service-notice"
        className="flex items-center gap-3 rounded-hud border border-amber/50 bg-amber/10 px-3 py-2 text-base leading-snug text-fg"
      >
        <Dot state="waking" />
        <span className="min-w-0 flex-1">{t(SERVICE_WAKING_TEXT)}</span>
      </div>
    );
  }
  return (
    <div
      id={id}
      role="alert"
      data-testid="service-notice"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-hud border border-late/50 bg-late/10 px-3 py-2 text-base leading-snug text-fg"
    >
      <span className="min-w-0 flex-1 basis-48">{t(SERVICE_DOWN_TEXT)}</span>
      <button type="button" data-testid="service-notice-retry" onClick={() => void check()} className="btn min-h-11">
        {t({ es: "Reintentar", en: "Retry" })}
      </button>
    </div>
  );
}
