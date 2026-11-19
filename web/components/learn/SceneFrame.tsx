import type { ReactNode } from "react";
import { SourceTag } from "./parts";

export const sceneTitleId = (n: number) => `lrn-title-${n}`;

/**
 * Esqueleto de una escena: número, origen de los datos, título y una o dos
 * líneas a la izquierda (arriba en móvil), con sus controles; el dibujo a la derecha.
 */
export function SceneFrame({
  n,
  title,
  real,
  lead,
  controls,
  stage,
  stageFirst = false,
}: {
  n: number;
  title: string;
  /** `true`: cifras de ejecuciones reales; `false`: ejemplo ilustrativo. */
  real?: boolean;
  lead: ReactNode;
  controls?: ReactNode;
  stage: ReactNode;
  /** En móvil, el dibujo antes que los controles (p. ej. un deslizador que lo mueve). */
  stageFirst?: boolean;
}) {
  const stageBox = <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">{stage}</div>;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,370px)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-8 lg:gap-y-4">
      <div className="flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-1 lg:gap-4">
        <div className="flex items-start gap-3.5">
          <span
            aria-hidden="true"
            className="font-display text-[60px] leading-[0.8] font-extrabold text-amber [text-shadow:0_0_32px_rgb(255_181_71/0.5)] lg:text-[72px]"
          >
            {String(n).padStart(2, "0")}
          </span>
          <div className="flex min-w-0 flex-col items-start gap-2">
            {real !== undefined && <SourceTag real={real} />}
            <h2 id={sceneTitleId(n)} className="text-[clamp(30px,2.8vw,42px)] font-extrabold text-balance">
              {title}
            </h2>
          </div>
        </div>
        <p className="text-lg leading-snug text-fg-2">{lead}</p>
      </div>
      {stageFirst && stageBox}
      {controls && <div className="min-w-0 lg:col-start-1 lg:row-start-2">{controls}</div>}
      {!stageFirst && stageBox}
    </div>
  );
}
