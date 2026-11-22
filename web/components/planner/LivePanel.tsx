"use client";

import { Activity, useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { LlmPanel } from "@/components/llm/LlmPanel";
import { ManualBuilder } from "@/components/manual/ManualBuilder";
import { ClassicPanel } from "@/components/solve/ClassicPanel";
import { useT, type Pair } from "@/lib/i18n";
import { CaseInfo } from "./CaseInfo";

/**
 * Acciones en vivo: una fila de botones junto a los casos que abre un panel
 * deslizante. En escritorio el panel entra por la izquierda de la zona de
 * trabajo y empuja el mapa, que sigue entero a la vista junto a la
 * comparativa; en móvil es una hoja inferior. El contenido de cada pestaña
 * se conserva montado (`Activity`) al cambiar de pestaña o cerrar el panel.
 */

export type LiveTab = "resolver" | "ia" | "caso" | "ruta";

type TabInfo = { id: LiveTab; action: Pair; title: Pair; line: Pair; icon: ReactNode };

const ICON = "size-[18px] flex-none";

export const LIVE_TABS: TabInfo[] = [
  {
    id: "resolver",
    action: { es: "Resolver", en: "Solve" },
    title: { es: "Resolver en vivo", en: "Solve live" },
    line: { es: "Lanza los métodos clásicos sobre este caso.", en: "Runs the classic methods on this case." },
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={ICON}>
        <circle cx="12" cy="12" r="9" />
        <path d="M10 8.5v7l5.5-3.5z" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "ia",
    action: { es: "Con IA", en: "With AI" },
    title: { es: "IA con tu clave", en: "AI with your key" },
    line: { es: "Un modelo de lenguaje traza el plan; tu clave no se guarda.", en: "A language model draws up the plan; your key is not stored." },
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={ICON}>
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5" />
      </svg>
    ),
  },
  {
    id: "caso",
    action: { es: "Tu caso", en: "Your case" },
    title: { es: "Tu caso", en: "Your case" },
    line: { es: "El caso cargado y cómo subir el tuyo.", en: "The loaded case and how to upload yours." },
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={ICON}>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5M12 18v-6M9.5 14.5 12 12l2.5 2.5" />
      </svg>
    ),
  },
  {
    id: "ruta",
    action: { es: "Tu ruta", en: "Your route" },
    title: { es: "Tu ruta", en: "Your route" },
    line: { es: "Arma las rutas a mano pulsando paradas en el mapa.", en: "Build the routes by hand by clicking stops on the map." },
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={ICON}>
        <circle cx="5" cy="18" r="2" />
        <circle cx="19" cy="6" r="2" />
        <path d="M7 18h6a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h6" />
      </svg>
    ),
  },
];

export const LIVE_PANEL_ID = "live-panel";

/** Fila de acciones en vivo. Cada botón abre el panel en su pestaña; el de la pestaña abierta lo cierra. */
export function LiveActions({
  open,
  tab,
  onToggle,
  refs,
  children,
}: {
  open: boolean;
  tab: LiveTab;
  onToggle: (tab: LiveTab) => void;
  refs: RefObject<Partial<Record<LiveTab, HTMLButtonElement | null>>>;
  /** Estado del servicio, a la izquierda de los botones. */
  children?: ReactNode;
}) {
  const tr = useT();
  return (
    <div data-zone className="flex min-w-0 items-center gap-3">
      <span id="live-label" className="kicker flex-none max-[760px]:sr-only">
        {tr({ es: "En vivo", en: "Live" })}
      </span>
      {children}
      <div role="group" aria-labelledby="live-label" className="grid w-full grid-cols-4 gap-1.5 min-[761px]:flex min-[761px]:w-auto">
        {LIVE_TABS.map((t) => {
          const active = open && tab === t.id;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              type="button"
              data-testid="live-action"
              data-live={t.id}
              aria-expanded={active}
              aria-controls={LIVE_PANEL_ID}
              onClick={() => onToggle(t.id)}
              className={`btn gap-2 px-2 min-[761px]:px-4 ${active ? "border-amber/70 bg-amber/[0.14] text-amber-2" : ""}`}
            >
              <span className="max-[760px]:hidden">{t.icon}</span>
              {tr(t.action)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Panel de acciones en vivo con sus cuatro pestañas. */
export function LivePanel({
  open,
  tab,
  onTab,
  onClose,
}: {
  open: boolean;
  tab: LiveTab;
  onTab: (tab: LiveTab) => void;
  /** Cierra el panel; el foco vuelve al botón de la acción. */
  onClose: () => void;
}) {
  return (
    <Activity mode={open ? "visible" : "hidden"}>
      <PanelBody tab={tab} onTab={onTab} onClose={onClose} />
    </Activity>
  );
}

function PanelBody({ tab, onTab, onClose }: { tab: LiveTab; onTab: (tab: LiveTab) => void; onClose: () => void }) {
  const tr = useT();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const info = LIVE_TABS.find((t) => t.id === tab)!;

  // Al mostrarse el panel o cambiar de pestaña, el foco entra en la pestaña activa.
  useEffect(() => {
    tabs.current[LIVE_TABS.findIndex((t) => t.id === tab)]?.focus({ preventScroll: true });
  }, [tab]);

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const last = LIVE_TABS.length - 1;
    const next =
      e.key === "ArrowRight" ? (i === last ? 0 : i + 1)
      : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    onTab(LIVE_TABS[next].id);
    tabs.current[next]?.focus();
  }

  return (
    <aside
      id={LIVE_PANEL_ID}
      data-testid="live-panel"
      data-zone
      aria-labelledby="live-title"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
      className={`rise fixed inset-x-0 bottom-0 z-40 flex ${tab === "ruta" ? "max-h-[44svh]" : "max-h-[58svh]"} flex-col overflow-hidden rounded-t-[20px] border-t border-amber/45 bg-[linear-gradient(180deg,rgb(17_29_51/0.98),rgb(7_13_24/0.98))] shadow-[0_-30px_70px_-20px_rgb(0_0_0/0.9)] backdrop-blur-md min-[1180px]:static min-[1180px]:z-auto min-[1180px]:max-h-none min-[1180px]:min-h-0 min-[1180px]:rounded-panel min-[1180px]:border min-[1180px]:border-amber/35 min-[1180px]:shadow-[var(--shadow-deep)]`}
    >
      <span aria-hidden="true" className="mx-auto mt-2 h-1 w-10 flex-none rounded-full bg-white/20 min-[1180px]:hidden" />
      <div className="flex flex-none items-start gap-3 px-4 pt-3 min-[1180px]:px-[18px] min-[1180px]:pt-4">
        <div className="min-w-0 flex-1">
          <span className="kicker">{tr({ es: "En vivo", en: "Live" })}</span>
          <h2 id="live-title" className="panel-title mt-1.5">
            {tr(info.title)}
          </h2>
          <p className="mt-1 text-base leading-snug text-fg-2">{tr(info.line)}</p>
        </div>
        <button
          type="button"
          aria-label={tr({ es: "Cerrar el panel", en: "Close the panel" })}
          onClick={onClose}
          className="grid size-11 flex-none place-items-center rounded-full text-2xl leading-none text-fg-2 [@media(hover:hover)]:hover:bg-white/[0.07] [@media(hover:hover)]:hover:text-fg"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div role="tablist" aria-label={tr({ es: "Acciones en vivo", en: "Live actions" })} className="mx-4 mt-3 grid flex-none grid-cols-4 gap-1 rounded-hud border border-line bg-black/25 p-1 min-[1180px]:mx-[18px]">
        {LIVE_TABS.map((t, i) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`live-tab-${t.id}`}
              aria-selected={active}
              aria-controls={`live-tabpanel-${t.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onTab(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
              className={`min-h-11 rounded-[9px] px-1 text-base font-semibold whitespace-nowrap transition-colors duration-150 ${
                active ? "bg-amber text-amber-ink" : "text-fg-2 [@media(hover:hover)]:hover:bg-white/[0.06] [@media(hover:hover)]:hover:text-fg"
              }`}
            >
              {tr(t.action)}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-4 [scrollbar-width:thin] min-[1180px]:px-[18px]">
        {LIVE_TABS.map((t) => (
          <Activity key={t.id} mode={t.id === tab ? "visible" : "hidden"}>
            <div role="tabpanel" id={`live-tabpanel-${t.id}`} aria-labelledby={`live-tab-${t.id}`} className="flex flex-col gap-3">
              {t.id === "resolver" && <ClassicPanel />}
              {t.id === "ia" && <LlmPanel />}
              {t.id === "caso" && <CaseInfo />}
              {t.id === "ruta" && <ManualBuilder />}
            </div>
          </Activity>
        ))}
      </div>
    </aside>
  );
}
