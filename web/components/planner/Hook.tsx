"use client";

import { Help } from "@/components/ui/Help";
import { useT } from "@/lib/i18n";
import type { components } from "@/lib/types";
import { cityOf } from "./units";

type S = components["schemas"];

function N({ children }: { children: number }) {
  return <span className="text-amber [text-shadow:0_0_26px_rgb(255_181_71/0.5)]">{children}</span>;
}

/**
 * Titular-gancho generado de la instancia: furgonetas, paradas y lugar, con
 * «ventana horaria» subrayada y su «?». En los casos sin mapa, sin ciudad.
 */
export function Hook({ instance }: { instance: S["Instance"] | null }) {
  const t = useT();
  const vehicles = instance?.fleet.vehicles ?? 0;
  const stops = instance?.customers.length ?? 0;
  const city = instance ? cityOf(instance) : null;

  return (
    <h1
      data-testid="hook"
      data-tour="hook"
      className="m-0 text-[25px] leading-[1.08] font-extrabold tracking-[0.012em] min-[761px]:text-[clamp(27px,2.95vw,46px)] min-[761px]:leading-[1.04]"
    >
      {instance ? (
        <>
          <N>{vehicles}</N> {vehicles === 1 ? t({ es: "furgoneta", en: "van" }) : t({ es: "furgonetas", en: "vans" })},{" "}
          <N>{stops}</N> {stops === 1 ? t({ es: "parada", en: "stop" }) : t({ es: "paradas", en: "stops" })}
          {city ? ` ${t({ es: "por", en: "around" })} ${city}` : ""} {t({ es: "y cada una con su", en: "and each with its own" })}{" "}
        </>
      ) : (
        `${t({ es: "Furgonetas, paradas y cada una con su", en: "Vans, stops and each with its own" })} `
      )}
      <span className="term-mark">{t({ es: "ventana", en: "time" })}</span>{" "}
      <span className="whitespace-nowrap">
        <span className="term-mark">{t({ es: "horaria", en: "window" })}</span>
        <Help term="ventana" className="ml-2" />
      </span>
    </h1>
  );
}
