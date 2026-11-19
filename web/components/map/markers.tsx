"use client";

import type { CSSProperties, Ref } from "react";
import { TowerIcon } from "@/components/ui/TowerIcon";
import { vehicleColor } from "./geometry";
import "./map.css";

export type MarkerSize = "full" | "mid" | "dot";

export type StopView = {
  customer: number;
  /** Índice del nodo: 0 es la base, i es `customers[i - 1]`. */
  node: number;
  /** Ruta que lo atiende, o `null` si nadie lo atiende. */
  route: number | null;
  late: boolean;
  label: string;
};

type StopProps = {
  stop: StopView;
  size: MarkerSize;
  active: boolean;
  dimmed: boolean;
  onClick: (customer: number) => void;
  buttonRef: Ref<HTMLButtonElement>;
};

/**
 * Parada. El estado de la reproducción (`data-state`) lo escribe quien anima,
 * fuera de React, para no renderizar en cada fotograma.
 */
export function StopMarker({ stop, size, active, dimmed, onClick, buttonRef }: StopProps) {
  const id = String(stop.customer);
  const style = {
    "--c": stop.route === null ? "var(--late)" : vehicleColor(stop.route),
    "--d": `${((stop.customer * 0.37) % 2.4).toFixed(2)}s`,
  } as CSSProperties;
  return (
    <button
      ref={buttonRef}
      type="button"
      data-testid="stop"
      data-customer={stop.customer}
      data-state="pend"
      data-size={size}
      data-late={stop.late || undefined}
      data-unserved={stop.route === null || undefined}
      data-dim={dimmed || undefined}
      aria-label={stop.label}
      aria-pressed={active}
      className="rm-stop"
      style={style}
      onClick={() => onClick(stop.customer)}
    >
      {size === "full" && <span className="rm-halo decor" aria-hidden="true" />}
      <span className="rm-disc" data-long={id.length > 2 || undefined}>
        {size === "full" && <span className="rm-num">{id}</span>}
      </span>
    </button>
  );
}

/** Base: torre ámbar con ondas de radar y su nombre. */
export function DepotMarker({ label, size, labelled = true }: { label: string; size: MarkerSize; labelled?: boolean }) {
  return (
    <div data-testid="depot" data-size={size === "full" ? undefined : "dot"} role="img" aria-label={label} className="rm-depot">
      <span className="rm-radar decor" aria-hidden="true" />
      <span className="rm-radar decor" aria-hidden="true" />
      <span className="rm-depot-core">
        <TowerIcon />
      </span>
      {size === "full" && labelled && (
        <span className="rm-depot-label" aria-hidden="true">
          {label}
        </span>
      )}
    </div>
  );
}

/** Furgoneta: oculta hasta que la reproducción la saca de la base. */
export function VanMarker({ route, vanRef }: { route: number; vanRef: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={vanRef}
      data-testid="van"
      data-route={route}
      data-state="base"
      aria-hidden="true"
      className="rm-van"
      style={{ "--c": vehicleColor(route) } as CSSProperties}
    >
      <span className="rm-van-badge">
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M1 4h8v7H1zM9.5 6h3l2.5 2.5V11h-5.5z" />
        </svg>
        F{route + 1}
      </span>
      <span className="rm-van-pill" />
    </div>
  );
}
