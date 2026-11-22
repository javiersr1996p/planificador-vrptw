"use client";

import { useCallback, useEffect, useRef } from "react";
import { health } from "@/lib/api";
import { useT, type Pair } from "@/lib/i18n";
import { usePlanner, type ServiceState } from "./store";

/** Tiempo de espera de `/health`. */
const HEALTH_TIMEOUT_MS = 5000;

/** Texto del aviso cuando el servicio no responde; lo comparten el indicador y los paneles en vivo. */
export const SERVICE_DOWN_TEXT: Pair = {
  es: "Servicio no disponible: se muestran los resultados precalculados",
  en: "Service unavailable: showing the precomputed results",
};

/**
 * Estado del servicio y su comprobación (`GET /health`, 5 s de espera).
 * `check` se puede llamar a mano (reintento); si ya hay una en curso, la sustituye.
 */
export function useService(): { service: ServiceState; check: () => Promise<void> } {
  const { state, actions } = usePlanner();
  const inflight = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, HEALTH_TIMEOUT_MS);
    actions.setService("checking");
    try {
      await health(ctrl.signal);
      if (inflight.current === ctrl) actions.setService("up");
    } catch {
      // Cancelada por otra comprobación o por ocultarse la página: la que manda decide el estado.
      if (inflight.current === ctrl && (timedOut || !ctrl.signal.aborted)) actions.setService("down");
    } finally {
      clearTimeout(timer);
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
 * Aviso completo de servicio caído, con el reintento. No muestra nada si el
 * servicio responde. Lo usan los paneles en vivo para explicar por qué sus
 * acciones están desactivadas (`id` sirve para `aria-describedby`).
 */
export function ServiceNotice({ id }: { id?: string }) {
  const t = useT();
  const { service, check } = useService();
  if (service !== "down") return null;
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
