"use client";

import { useMemo, useSyncExternalStore } from "react";
import { hasGeo } from "@/components/map/geometry";
import { useLang, useT } from "@/lib/i18n";
import { playback } from "@/lib/playback";
import type { components } from "@/lib/types";
import { lastEventAt, radioEvents, type RadioEvent } from "./schedule";
import { formatClock, isReal, plural } from "./units";

type S = components["schemas"];

/** Lo que la línea necesita del reloj: el suceso en curso, si se reproduce y si puede avanzar solo. */
function useRadioState(events: RadioEvent[]): { index: number; playing: boolean; canPlay: boolean } {
  const key = useSyncExternalStore(
    playback.subscribe,
    () => {
      const s = playback.getSnapshot();
      const idle = !s.playing && s.t <= s.start;
      const index = idle ? -1 : lastEventAt(events, s.t);
      return `${index}|${s.playing ? 1 : 0}|${s.motion || !s.reducedMotion ? 1 : 0}`;
    },
    () => "-1|0|1",
  );
  const [index, playing, canPlay] = key.split("|").map(Number);
  return { index, playing: playing === 1, canPlay: canPlay === 1 };
}

/**
 * Línea de estado sobre el mapa: la frase del último suceso a la hora
 * simulada, generada de la evaluación. Mientras se reproduce no se anuncia
 * cada suceso a los lectores de pantalla; al parar, sí.
 */
export function RadioLine({ instance, evaluation }: { instance: S["Instance"]; evaluation: S["Evaluation"] | null }) {
  const real = isReal(instance);
  const [lang] = useLang();
  const t = useT();
  const events = useMemo(() => (evaluation ? radioEvents(instance, evaluation, lang) : []), [instance, evaluation, lang]);
  const { index, playing, canPlay } = useRadioState(events);
  if (!evaluation) return null;

  const event = index >= 0 ? events[index] : null;
  const ready =
    lang === "en"
      ? `${plural(evaluation.vehicles_used, "van ready", "vans ready")} at the depot.`
      : `${plural(evaluation.vehicles_used, "furgoneta lista", "furgonetas listas")} en la base.`;
  const text =
    event?.text ??
    `${ready} ${
      canPlay
        ? t({ es: "Pulsa «Reproducir».", en: "Press “Play”." })
        : t({ es: "Mueve el deslizador para recorrer el día.", en: "Move the slider to go through the day." })
    }`;

  return (
    <div
      data-testid="radio-line"
      data-zone
      role="status"
      aria-live={playing ? "off" : "polite"}
      className={`hud pointer-events-none absolute right-3 ${
        // En móvil, con mapa (o su respaldo) la atribución ocupa el borde inferior; en plano puro, no.
        hasGeo(instance) ? "bottom-[34px]" : "bottom-3"
      } left-3 z-[4] flex items-center gap-2.5 px-3 py-2 text-base leading-[1.3] @min-[700px]:right-auto @min-[700px]:bottom-5 @min-[700px]:left-5 @min-[700px]:max-w-[min(560px,calc(100%-400px))] @min-[700px]:py-[9px] @min-[700px]:pr-3.5 @min-[700px]:pl-2.5`}
    >
      <span
        aria-hidden="true"
        className="decor size-[9px] flex-none animate-[breathe_0.9s_ease-in-out_infinite_alternate] rounded-full bg-ok shadow-[0_0_10px_var(--ok)]"
      />
      <span className="num flex-none text-base font-semibold text-amber">
        {formatClock(event?.t ?? instance.depot.ready, real, lang)}
      </span>
      <span className="line-clamp-2 min-w-0">{text}</span>
    </div>
  );
}
