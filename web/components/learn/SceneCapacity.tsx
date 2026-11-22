"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import { vehicleColor } from "@/components/planner/units";
import { Help } from "@/components/ui/Help";
import { useT, type Pair } from "@/lib/i18n";
import { Stage } from "./parts";
import { SceneFrame } from "./SceneFrame";
import { TOY_CAPACITY, TOY_CLIENTS, toyClient } from "./toy";

/** Color de cada pedido: distinto del de las furgonetas (1 y 2). */
const BOX_COLOR: Record<string, string> = {
  A: "var(--veh-3)",
  B: "var(--veh-4)",
  C: "var(--veh-5)",
  D: "var(--veh-6)",
  E: "var(--veh-7)",
  F: "var(--veh-9)",
};

type Load = { id: string; van: number };

/** Escena 3: cargar pedidos hasta que la furgoneta se llena. */
export function SceneCapacity() {
  const t = useT();
  const [loads, setLoads] = useState<Load[]>([]);
  // El mensaje se guarda en los dos idiomas: así se repinta al cambiar de idioma.
  const [message, setMessage] = useState<Pair>({
    es: `Cada furgoneta lleva ${TOY_CAPACITY} cajas. Pulsa un pedido para cargarlo.`,
    en: `Each van carries ${TOY_CAPACITY} boxes. Tap an order to load it.`,
  });

  const used = (van: number, list = loads) => list.filter((l) => l.van === van).reduce((n, l) => n + toyClient(l.id).demand, 0);

  function toggle(id: string) {
    const c = toyClient(id);
    const loaded = loads.find((l) => l.id === id);
    if (loaded) {
      setLoads(loads.filter((l) => l.id !== id));
      setMessage({ es: `${id} sale de la furgoneta ${loaded.van + 1}.`, en: `${id} leaves van ${loaded.van + 1}.` });
      return;
    }
    const free = [0, 1].map((v) => TOY_CAPACITY - used(v));
    if (c.demand <= free[0]) {
      setLoads([...loads, { id, van: 0 }]);
      setMessage(
        free[0] === c.demand
          ? { es: `${id} entra justo: la furgoneta 1 va llena.`, en: `${id} fits exactly: van 1 is full.` }
          : { es: `${id} entra en la furgoneta 1.`, en: `${id} goes into van 1.` },
      );
    } else if (c.demand <= free[1]) {
      setLoads([...loads, { id, van: 1 }]);
      setMessage({
        es: `${id} trae ${c.demand} cajas y en la furgoneta 1 ${free[0] === 1 ? "queda 1 hueco" : `quedan ${free[0]} huecos`}: va en la 2.`,
        en: `${id} has ${c.demand} boxes and van 1 has ${free[0] === 1 ? "1 space" : `${free[0]} spaces`} left: it goes in van 2.`,
      });
    } else {
      setMessage({ es: `${id} no cabe en ninguna: haría falta una tercera furgoneta.`, en: `${id} fits in neither: a third van would be needed.` });
    }
  }

  return (
    <SceneFrame
      n={3}
      title={t({ es: "La furgoneta se llena", en: "The van fills up" })}
      real={false}
      lead={
        <>
          {t({ es: "Cada furgoneta tiene su", en: "Each van has its" })}{" "}
          <span className="whitespace-nowrap">
            <span className="term-mark text-fg">{t({ es: "capacidad", en: "capacity" })}</span>
            <Help term="capacidad" size="sm" className="ml-1.5" />
          </span>
          . {t({ es: "Si un pedido ya no cabe, lo tiene que llevar otra.", en: "If an order no longer fits, another van has to take it." })}
        </>
      }
      controls={
        <div className="flex flex-col gap-3">
          <div role="group" aria-label={t({ es: "Pedidos", en: "Orders" })} className="grid grid-cols-3 gap-2">
            {TOY_CLIENTS.map((c) => {
              const l = loads.find((x) => x.id === c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  data-testid="toy-order"
                  data-client={c.id}
                  aria-pressed={!!l}
                  aria-label={t({
                    es: `Pedido de ${c.id}: ${c.demand} cajas, ${l ? `en la furgoneta ${l.van + 1}` : "sin cargar"}`,
                    en: `Order from ${c.id}: ${c.demand} boxes, ${l ? `in van ${l.van + 1}` : "not loaded"}`,
                  })}
                  onClick={() => toggle(c.id)}
                  className={`flex min-h-14 cursor-pointer flex-col items-start justify-center gap-1 rounded-hud border px-3 py-2 text-left transition-[background-color,border-color] duration-200 ease-[var(--ease-out)] ${
                    l ? "border-amber/60 bg-amber/[0.08]" : "border-line-2 bg-white/[0.03] [@media(hover:hover)]:hover:bg-white/[0.07]"
                  }`}
                >
                  <span className="flex items-center gap-2 text-base leading-none font-bold">
                    <span aria-hidden="true" className="size-3 rounded-[3px]" style={{ background: BOX_COLOR[c.id] }} />
                    {c.id}
                  </span>
                  <span className="text-base leading-none text-fg-2">
                    {c.demand} {t({ es: "cajas", en: "boxes" })}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="min-h-[3em] text-base leading-snug text-fg" aria-live="polite" data-testid="capacity-status">
            {t(message)}
          </p>
          <div>
            <button
              type="button"
              className="btn"
              disabled={loads.length === 0}
              onClick={() => {
                setLoads([]);
                setMessage({ es: "Furgonetas vacías.", en: "Both vans are empty." });
              }}
            >
              {t({ es: "Vaciar", en: "Empty" })}
            </button>
          </div>
        </div>
      }
      stage={
        <Stage className="flex h-[400px] flex-col justify-center gap-5 px-4 sm:h-[440px] sm:px-8 lg:h-[560px] lg:gap-8 lg:px-12">
          {[0, 1].map((van) => (
            <Hold key={van} van={van} loads={loads.filter((l) => l.van === van)} />
          ))}
        </Stage>
      }
    />
  );
}

/** Una furgoneta con su bodega de huecos: cada caja, del color y la letra de su pedido. */
function Hold({ van, loads }: { van: number; loads: Load[] }) {
  const t = useT();
  const boxes = loads.flatMap((l) => Array.from({ length: toyClient(l.id).demand }, (_, k) => ({ id: l.id, k, key: `${l.id}-${k}` })));
  const full = boxes.length === TOY_CAPACITY;
  const idle = boxes.length === 0 && van > 0;
  const color = vehicleColor(van);
  return (
    <div className="mx-auto w-full max-w-[540px]" data-testid="toy-hold" data-used={boxes.length}>
      <p className="mb-2 flex flex-wrap items-baseline gap-x-3 text-base">
        <span className="font-semibold" style={{ color }}>
          {t({ es: "Furgoneta", en: "Van" })} {van + 1}
        </span>
        <span className="text-fg-2">
          {idle
            ? t({ es: "En la base, por si hace falta", en: "At the depot, just in case" })
            : t({ es: `${boxes.length} de ${TOY_CAPACITY} cajas${full ? ": llena" : ""}`, en: `${boxes.length} of ${TOY_CAPACITY} boxes${full ? ": full" : ""}` })}
        </span>
      </p>
      {/* Solo el dibujo se apaga en la furgoneta sin usar: su rótulo sigue legible. */}
      <div className="transition-opacity duration-200 ease-[var(--ease-out)]" style={{ opacity: idle ? 0.45 : 1 }}>
        <div className="flex items-end">
          <div
            className="relative grid flex-1 grid-cols-5 gap-1.5 rounded-l-xl rounded-r-sm border-2 bg-[#0c1729] p-2 sm:gap-2 sm:p-2.5"
            style={{ borderColor: color, boxShadow: full ? `0 0 26px -6px ${color}` : undefined }}
          >
            {Array.from({ length: TOY_CAPACITY }, (_, i) => {
              const box = boxes[i];
              return box ? (
                <span
                  key={box.key}
                  className="lrn-box grid aspect-[5/4] place-items-center rounded-md font-mono text-[12px] font-bold text-ink-0 uppercase"
                  style={{ background: BOX_COLOR[box.id], "--i": box.k } as CSSProperties}
                  aria-hidden="true"
                >
                  {box.id}
                </span>
              ) : (
                <span key={`hueco-${i}`} className="aspect-[5/4] rounded-md border border-dashed border-fg-3/35" aria-hidden="true" />
              );
            })}
          </div>
          <svg viewBox="0 0 60 70" className="h-auto w-[52px] flex-none sm:w-[64px]" aria-hidden="true">
            <path d="M2 14h30l24 26v24H2z" fill="#0c1729" stroke={color} strokeWidth="3" strokeLinejoin="round" />
            <path d="M10 22h19l15 16H10z" fill={color} opacity="0.5" />
          </svg>
        </div>
        <div className="flex justify-between px-6" aria-hidden="true">
          {[0, 1].map((w) => (
            <span key={w} className="-mt-2 size-6 rounded-full border-[3px] bg-ink-0" style={{ borderColor: color }} />
          ))}
        </div>
      </div>
    </div>
  );
}
