"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ServiceNotice, useService } from "@/components/planner/ServiceStatus";
import { hasSolution, makeRun, usePlanner, type PlannerRun } from "@/components/planner/store";
import { useLatest } from "@/components/solve/useLatest";
import { Button } from "@/components/ui/Button";
import { Help } from "@/components/ui/Help";
import { ApiError, solveLlm } from "@/lib/api";
import { formatCost, formatEuro, formatNumber } from "@/lib/format";
import { GLOSSARY } from "@/lib/glossary";
import { unreadableReason } from "@/lib/labels";
import type { components } from "@/lib/types";
import { KEY_NOTE, isSendableKey, llmErrorText, useLlm, withoutKey, type Role } from "./scope";

export { LlmScope } from "./scope";
export { LlmExplain } from "./LlmExplain";

type S = components["schemas"];

type Status =
  | { kind: "idle" }
  | { kind: "running"; since: number; role: Role }
  | { kind: "done"; record: S["RunRecord"] }
  | { kind: "error"; message: string }
  | { kind: "cancelled" };

const ROLES: { id: Role; label: string }[] = [
  { id: "llm_direct", label: "Directo" },
  { id: "llm_agent", label: "Agente" },
];

const REASON_ID = "llm-reason";

/** `0:07`, `1:05`. */
function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Precio por millón de tokens: `2`, `0,10`. */
function price(value: number): string {
  return formatNumber(value, Number.isInteger(value) ? 0 : 2);
}

/** Tokens y coste de API de una ejecución, tal como los devuelve el servicio. */
function spend(record: S["RunRecord"]): string {
  const parts: string[] = [];
  if (record.tokens_in != null && record.tokens_out != null) {
    parts.push(`${formatNumber(record.tokens_in, 0)} / ${formatNumber(record.tokens_out, 0)} tokens`);
  }
  if (record.api_cost_eur != null) parts.push(formatEuro(record.api_cost_eur));
  return parts.join(" · ");
}

function StatusText({ status, now }: { status: Status; now: number }) {
  switch (status.kind) {
    case "idle":
      return null;
    case "running":
      return (
        <span className="flex items-center gap-2 text-fg">
          <span aria-hidden="true" className="inline-block size-3.5 flex-none animate-spin rounded-full border-2 border-amber border-t-transparent" />
          {status.role === "llm_agent" ? "El agente trabaja" : "El modelo escribe el plan"}{" "}
          <span className="num" data-testid="llm-timer">{clock(now - status.since)}</span>
        </span>
      );
    case "done": {
      const { record } = status;
      const ev = record.evaluation;
      const model = record.model_returned ?? record.model_requested ?? "";
      const cost = spend(record);
      if (record.parse_status !== "ok" || !record.solution || !ev) {
        return (
          <span className="text-late">
            <span className="font-semibold">Sin plan legible:</span> {unreadableReason(record)}.
            <span className="block text-fg-2">
              {model}
              {cost && ` · ${cost}`}
            </span>
          </span>
        );
      }
      return (
        <span className="text-fg">
          <span className="font-semibold text-ok">Hecho</span>
          {" · "}
          <span className="num">{formatCost(ev.score)}</span>
          {" · "}
          <span className="num">{ev.vehicles_used}</span> {ev.vehicles_used === 1 ? "furgoneta" : "furgonetas"}
          {!ev.feasible && <span className="font-semibold text-late"> · no válido</span>}
          <span className="block text-fg-2">
            {model}
            {cost && ` · ${cost}`}
          </span>
        </span>
      );
    }
    case "error":
      return <span className="text-late">{status.message}</span>;
    case "cancelled":
      return <span className="text-fg-2">Cancelada. Si el modelo ya había empezado, la llamada puede cobrarse.</span>;
  }
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-amber">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function RoleIcon({ role }: { role: Role }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {role === "llm_direct" ? (
        <path d="M4 12h14M13 6l6 6-6 6" />
      ) : (
        <>
          <path d="M20 12a8 8 0 1 1-2.3-5.6" />
          <path d="M20 4v4h-4" />
        </>
      )}
    </svg>
  );
}

/**
 * Resolver con un LLM usando la clave del visitante. La clave vive solo en
 * `LlmScope` (estado de React) y en el campo, que no es controlado: React no
 * copia su valor a un atributo del HTML. Solo viaja en la cabecera `X-LLM-Key`
 * de `POST /solve/llm`. El resultado entra en la comparativa como «en vivo».
 */
export function LlmPanel() {
  const { state, actions } = usePlanner();
  const { service } = useService();
  const { llmKey, setLlmKey, model, setModel, models, loadModels, keyField, forgetKey } = useLlm();
  const [role, setRole] = useState<Role>("llm_direct");
  const [recheck, setRecheck] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const abort = useRef<AbortController | null>(null);
  const metaRef = useRef(state.meta);
  const metaNow = useLatest(state.meta);
  const ids = useId();
  const keyId = `${ids}-key`;
  const noteId = `${ids}-note`;
  const modelId = `${ids}-model`;
  const hintId = `${ids}-hint`;

  const up = service === "up";
  const down = service === "down";
  const running = status.kind === "running";

  // La lista de modelos se pide al mostrarse el panel con el servicio activo (una vez obtenida, no se repite).
  useEffect(() => {
    if (up) void loadModels();
  }, [up, loadModels]);

  // Cronómetro mientras el modelo trabaja.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  // Otro caso: el resultado en curso ya no vale. No se cancela al ocultarse el panel.
  useEffect(() => {
    if (metaRef.current === state.meta) return;
    metaRef.current = state.meta;
    abort.current?.abort();
    setStatus({ kind: "idle" });
  }, [state.meta]);

  const instance = state.instance;
  const key = llmKey.trim();
  const list = models.kind === "ok" ? models.models : [];
  const info = list.find((m) => m.model_id === model) ?? null;
  // Mientras se reevalúan los planes con un tráfico nuevo no se lanza ningún cálculo.
  const reevaluating = state.busy.traffic;
  const blocked = !instance || !up || !info || reevaluating;
  const canLaunch = !blocked && isSendableKey(key) && !running;

  function cancel() {
    abort.current?.abort();
    abort.current = null;
    actions.setBusy("llm", false);
    setStatus({ kind: "cancelled" });
  }

  /** `since`: hora del clic (`Date.now()`), para el cronómetro. */
  async function launch(since: number) {
    if (!instance || !info || !canLaunch) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    const startMeta = state.meta;
    const sent = role;
    setNow(since);
    setStatus({ kind: "running", since, role: sent });
    actions.setBusy("llm", true);
    try {
      const reply = await solveLlm(
        { instance, model: info.model_id, role: sent, recheck: sent === "llm_direct" && recheck, seed: 0 },
        key,
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      // Cambió el caso mientras tanto (con el panel cerrado no corre el efecto que lo cancela).
      if (metaNow.current !== startMeta) {
        setStatus({ kind: "idle" });
        return;
      }
      const record = withoutKey(reply, key);
      const run: PlannerRun = makeRun("en vivo", record);
      actions.addRun(run, { select: hasSolution(run) });
      setStatus({ kind: "done", record });
    } catch (e) {
      if (ctrl.signal.aborted || (e instanceof ApiError && e.kind === "aborted")) return;
      if (e instanceof ApiError && e.kind === "network") actions.setService("down");
      setStatus({ kind: "error", message: llmErrorText(e) });
    } finally {
      if (abort.current === ctrl) {
        abort.current = null;
        actions.setBusy("llm", false);
      }
    }
  }

  const hint = down
    ? "Sin servicio."
    : models.kind === "error"
      ? "No se pudo leer la lista de modelos."
      : !info
        ? "Leyendo los modelos del servicio…"
        : reevaluating
          ? "Espera: se reevalúan los planes con el tráfico nuevo."
          : !key
            ? "Escribe tu clave para lanzar."
            : !isSendableKey(key)
              ? "La clave no parece completa."
              : role === "llm_agent"
                ? "Varias llamadas: tarda y cuesta más."
                : recheck
                  ? "Dos llamadas al modelo."
                  : "Una llamada al modelo.";

  return (
    // Con desplazamiento interno en escritorio, como «Resolver»: la página no crece con el panel.
    <div
      className="flex flex-col gap-4 min-[1180px]:max-h-[calc(clamp(560px,100svh-236px,760px)-230px)] min-[1180px]:overflow-y-auto min-[1180px]:overscroll-contain min-[1180px]:pr-1 [scrollbar-width:thin]"
      data-testid="llm-panel"
      role="group"
      aria-label="IA con tu clave"
    >
      <ServiceNotice id={REASON_ID} />

      {/* Clave: campo de contraseña sin `name` ni autocompletado; su valor no pasa al HTML. */}
      <div className="flex flex-col gap-2">
        <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <label htmlFor={keyId} className="kicker whitespace-nowrap">
            Clave de Anthropic
          </label>
          {key && (
            <span data-testid="llm-key-state" className="flex items-center gap-1.5 text-base leading-none whitespace-nowrap text-ok">
              <span aria-hidden="true" className="size-2 rounded-full bg-ok shadow-[0_0_8px_var(--ok)]" />
              En memoria
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="relative min-w-0 flex-1">
            <LockIcon />
            <input
              ref={keyField}
              id={keyId}
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              data-testid="llm-key"
              placeholder="sk-ant-…"
              aria-describedby={noteId}
              onChange={(e) => setLlmKey(e.target.value)}
              className="h-11 w-full rounded-hud border border-line-2 bg-ink-0/70 pr-3 pl-10 font-mono text-base text-fg placeholder:text-fg-3 focus:border-amber/70 focus:shadow-[var(--glow-amber)] focus:outline-none"
            />
          </span>
          <Button data-testid="llm-forget" onClick={forgetKey} disabled={!llmKey} className="px-3">
            Olvidar clave
          </Button>
        </div>
        <p id={noteId} data-testid="llm-key-note" className="m-0 text-base leading-snug text-fg-2">
          {KEY_NOTE}
        </p>
      </div>

      {/* Papel del modelo: directo o agente, cada uno con su «?». */}
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="kicker mb-2 p-0">Papel del modelo</legend>
        <div className="grid grid-cols-2 gap-2">
          {ROLES.map((r) => (
            <div key={r.id} className="flex min-w-0 items-center gap-2">
              <label
                data-testid="llm-role"
                data-role={r.id}
                className="btn min-w-0 flex-1 cursor-pointer gap-2 px-3 has-[:checked]:border-amber/70 has-[:checked]:bg-amber/[0.14] has-[:checked]:text-amber-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-amber"
              >
                <input
                  type="radio"
                  name={`${ids}-role`}
                  value={r.id}
                  checked={role === r.id}
                  disabled={running || down}
                  aria-describedby={down ? REASON_ID : undefined}
                  onChange={() => setRole(r.id)}
                  className="sr-only"
                />
                <RoleIcon role={r.id} />
                {r.label}
              </label>
              <Help term={r.id} size="sm" />
            </div>
          ))}
        </div>
        <p data-testid="llm-role-hint" className="mt-2 mb-0 text-base leading-snug text-fg-2">
          {GLOSSARY[role].hint}.
        </p>
      </fieldset>

      {/* Modelo y su precio, tal como los da `GET /models`. */}
      <div className="flex flex-col gap-2">
        <span className="flex items-center gap-2">
          <label htmlFor={modelId} className="kicker">
            Modelo
          </label>
          <Help term="tokens" size="sm" />
        </span>
        <select
          id={modelId}
          data-testid="llm-model"
          value={info?.model_id ?? ""}
          disabled={!info || running || down}
          aria-describedby={down ? REASON_ID : undefined}
          onChange={(e) => setModel(e.target.value)}
          className="h-11 w-full rounded-hud border border-line-2 bg-ink-0/70 px-3 font-mono text-base text-fg focus:border-amber/70 focus:shadow-[var(--glow-amber)] focus:outline-none disabled:opacity-55"
        >
          {list.length === 0 && <option value="">{models.kind === "error" ? "Sin lista de modelos" : "Cargando…"}</option>}
          {list.map((m) => (
            <option key={m.model_id} value={m.model_id}>
              {m.model_id}
            </option>
          ))}
        </select>
        {info && (
          <p data-testid="llm-price" className="m-0 text-base leading-snug text-fg-2">
            <span className="num text-fg">{price(info.price_in_per_mtok)}</span> {info.currency} entrada ·{" "}
            <span className="num text-fg">{price(info.price_out_per_mtok)}</span> {info.currency} salida, por millón de tokens ·{" "}
            <a
              data-testid="llm-price-source"
              href={info.source_url}
              target="_blank"
              rel="noopener noreferrer"
              title={`Precio consultado el ${info.checked_on}`}
              className="text-amber-2 underline underline-offset-2"
            >
              fuente
            </a>
          </p>
        )}
        {models.kind === "error" && up && (
          <Button data-testid="llm-models-retry" onClick={() => void loadModels()} className="self-start">
            Reintentar
          </Button>
        )}
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-55">
        <input
          type="checkbox"
          data-testid="llm-recheck"
          checked={recheck && role === "llm_direct"}
          disabled={role !== "llm_direct" || running || down}
          onChange={(e) => setRecheck(e.target.checked)}
          className="size-5 flex-none accent-[var(--amber)]"
        />
        <span className="min-w-0 flex-1 text-base leading-snug">
          <span className="font-semibold text-fg">Segunda comprobación</span>
          <span className="block text-fg-2">{role === "llm_direct" ? "Revisa su plan una vez más." : "Solo con el directo."}</span>
        </span>
      </label>

      {/* Coste y lanzamiento. */}
      <div className="flex flex-col gap-2.5 border-t border-line pt-3">
        <p data-testid="llm-cost-warning" className="m-0 flex items-center gap-2 text-base leading-snug text-wait">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 flex-none">
            <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 4.5v7M10 6.2c-.4-.6-1.1-.9-2-.9-1.1 0-1.9.6-1.9 1.4 0 1.9 4 1 4 2.9 0 .8-.8 1.5-2 1.5-.9 0-1.7-.4-2.1-1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          Tiene coste: se cobra en tu cuenta de Anthropic.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {running ? (
            // El segundo clic de un doble clic en «Lanzar» cae aquí: no cancela (el teclado da `detail` 0).
            <Button data-testid="llm-cancel" onClick={(e) => e.detail <= 1 && cancel()}>
              Cancelar
            </Button>
          ) : (
            <Button
              variant="primary"
              data-testid="llm-start"
              disabled={!canLaunch}
              aria-describedby={down ? REASON_ID : hintId}
              onClick={() => void launch(Date.now())}
            >
              <RoleIcon role={role} />
              {role === "llm_agent" ? "Lanzar el agente" : "Lanzar el directo"}
            </Button>
          )}
          <span id={hintId} data-testid="llm-launch-hint" className="min-w-0 flex-1 basis-32 text-base leading-snug text-fg-2">
            {running ? "Puede tardar; la comparativa se actualiza al acabar." : hint}
          </span>
        </div>
        {status.kind !== "idle" && (
          <p role="status" data-testid="llm-status" data-status={status.kind} className="m-0 text-base leading-snug">
            <StatusText status={status} now={now} />
          </p>
        )}
      </div>
    </div>
  );
}
