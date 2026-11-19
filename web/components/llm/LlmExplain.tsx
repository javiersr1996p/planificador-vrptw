"use client";

import { useState } from "react";
import { useService } from "@/components/planner/ServiceStatus";
import { hasSolution, usePlanner, type PlannerRun } from "@/components/planner/store";
import { ApiError, explain } from "@/lib/api";
import { formatEuro, formatNumber } from "@/lib/format";
import { methodLabel } from "@/lib/labels";
import type { components } from "@/lib/types";
import { isSendableKey, llmErrorText, useLlm, withoutKey } from "./scope";

type S = components["schemas"];

/** Estado de la explicación de una ejecución, ligado a su registro (otra evaluación, otro registro). */
type Entry = { record: S["RunRecord"] } & (
  | { kind: "running"; ctrl: AbortController }
  | { kind: "done"; reply: S["ExplainResponse"] }
  | { kind: "error"; message: string }
);

/** Explicaciones que se recuerdan al cambiar de plan y volver. */
const KEEP = 12;

/**
 * Disparador en una línea de 12 px en mayúsculas, como la del run_id, con un
 * fundido al color del fondo del detalle para tapar el final de esa línea.
 */
const TRIGGER =
  "flex h-[15px] items-center gap-1.5 bg-[linear-gradient(90deg,transparent,#070c17_16px)] pl-6 font-mono text-[12px] leading-none font-semibold tracking-[0.08em] whitespace-nowrap uppercase";

/** Zona pulsable de 45 px de alto sin cambiar el tamaño visible. */
const HIT = "relative before:absolute before:-inset-x-2 before:-inset-y-[15px] before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber";

/** Botón «Con IA» de la fila de acciones en vivo, que abre el panel de la clave. */
const IA_ACTION = '[data-testid="live-action"][data-live="ia"]';

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M12 3.5 13.9 10l6.6 2-6.6 2L12 20.5 10.1 14l-6.6-2 6.6-2z" />
    </svg>
  );
}

/**
 * «Explicar»: un modelo cuenta en palabras el plan seleccionado (`POST /explain`,
 * con la clave del visitante y el modelo elegido en «Con IA»). El servicio
 * reevalúa las rutas; el texto se muestra como texto, nunca como HTML. Sin
 * clave, el botón abre el panel «Con IA» y lleva el foco al campo.
 */
export function LlmExplain({ run }: { run: PlannerRun | null }) {
  const { state, actions } = usePlanner();
  const { service } = useService();
  const { llmKey, model, focusKey } = useLlm();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [asked, setAsked] = useState(false);

  const instance = state.instance;
  if (!run || !hasSolution(run) || !instance) return null;
  const record = run.record;
  const entry = entries.find((e) => e.record === record) ?? null;
  const key = llmKey.trim();
  const up = service === "up";

  const put = (next: Entry) => setEntries((all) => [...all.filter((e) => e.record !== next.record), next].slice(-KEEP));
  const drop = (rec: S["RunRecord"]) => setEntries((all) => all.filter((e) => e.record !== rec));

  function askForKey() {
    const opener = document.querySelector<HTMLButtonElement>(IA_ACTION);
    if (opener && opener.getAttribute("aria-expanded") !== "true") opener.click();
    setAsked(true);
    // Tras mostrarse el panel (y su foco en la pestaña), el foco pasa al campo de la clave.
    requestAnimationFrame(focusKey);
  }

  async function ask() {
    if (!key) {
      askForKey();
      return;
    }
    if (!isSendableKey(key) || !model || !instance) {
      askForKey();
      return;
    }
    setAsked(false);
    const rec = record;
    const ctrl = new AbortController();
    put({ record: rec, kind: "running", ctrl });
    try {
      const reply = await explain(
        { instance, routes: rec.solution!.routes, method: methodLabel(rec.method).slice(0, 40), model },
        key,
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      put({ record: rec, kind: "done", reply: withoutKey(reply, key) });
    } catch (e) {
      if (ctrl.signal.aborted || (e instanceof ApiError && e.kind === "aborted")) return;
      if (e instanceof ApiError && e.kind === "network") actions.setService("down");
      put({ record: rec, kind: "error", message: llmErrorText(e) });
    }
  }

  function cancel() {
    if (entry?.kind !== "running") return;
    entry.ctrl.abort();
    drop(entry.record);
  }

  const line = !up
    ? service === "down"
      ? "Sin servicio: no se puede pedir ahora."
      : "Comprobando el servicio…"
    : !key || !isSendableKey(key)
      ? "Necesita tu clave: se escribe en «Con IA»."
      : "Un modelo lo cuenta en palabras. Tiene coste.";

  return (
    <div data-testid="explain" className="flex flex-col">
      {/*
        Disparador sobre el final de la línea del run_id, que el detalle pinta justo antes (texto de 12 px
        con interlineado de 15 px): no añade altura al detalle. La zona pulsable mide 45 px de alto.
      */}
      {entry?.kind !== "done" && (
        <div className="relative z-[1] -mt-[15px] flex h-[15px] items-center justify-end">
          {entry?.kind === "running" ? (
            <span role="status" className={`${TRIGGER} text-fg-2`}>
              <span aria-hidden="true" className="inline-block size-3 flex-none animate-spin rounded-full border-2 border-amber border-t-transparent" />
              Redactando
              <button type="button" data-testid="explain-cancel" onClick={cancel} className={`${HIT} ml-2 text-amber-2 underline underline-offset-2`}>
                Cancelar
              </button>
            </span>
          ) : (
            <button
              type="button"
              data-testid="explain-button"
              disabled={!up}
              aria-describedby="explain-line"
              title={line}
              onClick={() => void ask()}
              className={`${TRIGGER} ${HIT} text-amber-2 disabled:cursor-not-allowed disabled:text-fg-3 [@media(hover:hover)]:hover:text-amber`}
            >
              <SparkIcon className="size-3.5 flex-none" />
              Explicar
            </button>
          )}
          <span id="explain-line" data-testid="explain-line" className="sr-only">
            {line}
          </span>
        </div>
      )}
      {asked && !key && (
        <p role="status" data-testid="explain-ask" className="m-0 mt-2.5 text-base leading-snug text-wait">
          Escribe tu clave en el panel «Con IA» y vuelve a pulsar «Explicar».
        </p>
      )}
      {entry?.kind === "error" && (
        <p role="alert" data-testid="explain-error" className="m-0 mt-2.5 text-base leading-snug text-late">
          {entry.message}
        </p>
      )}
      {entry?.kind === "done" && (
        <figure className="m-0 mt-3 flex flex-col gap-1.5">
          <figcaption className="kicker flex items-center gap-2">
            <SparkIcon className="size-3.5 flex-none" />
            Explicación del plan
          </figcaption>
          <p
            data-testid="explain-text"
            tabIndex={0}
            aria-label="Explicación del plan"
            className="m-0 max-h-60 overflow-y-auto rounded-hud border border-line bg-black/25 px-3 py-2 text-base leading-relaxed whitespace-pre-wrap text-fg [scrollbar-width:thin]"
          >
            {entry.reply.text}
          </p>
          <p data-testid="explain-meta" className="m-0 font-mono text-[12px] leading-tight tracking-[0.06em] text-fg-3 uppercase">
            {entry.reply.model_returned} · {formatNumber(entry.reply.tokens_in, 0)} / {formatNumber(entry.reply.tokens_out, 0)} tokens ·{" "}
            {formatEuro(entry.reply.api_cost_eur)}
          </p>
        </figure>
      )}
    </div>
  );
}
