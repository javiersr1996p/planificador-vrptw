"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { ServiceNotice, useService } from "@/components/planner/ServiceStatus";
import { useLatest } from "@/components/solve/useLatest";
import { usePlanner } from "@/components/planner/store";
import { Button } from "@/components/ui/Button";
import { ApiError, parseCsv, type CsvRowError } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useLang, useT, type Pair } from "@/lib/i18n";
import type { components } from "@/lib/types";
import { CaseForm, Field, INPUT } from "./CaseForm";
import { MAX_CSV_CHARS, formToCsv, newForm, rowTarget } from "./csv";
import {
  addressOf,
  buildMatrix,
  failureText,
  geocodePositions,
  unplaced,
  withAddress,
  withoutCustomer,
  type Position,
} from "./pipeline";

type S = components["schemas"];
type Mode = "csv" | "form";
type StepId = "read" | "geocode" | "matrix";
type StepStatus = "idle" | "running" | "done" | "error" | "skipped";
type StepState = { status: StepStatus; note?: Pair };

const STEPS: { id: StepId; label: Pair }[] = [
  { id: "read", label: { es: "Leer", en: "Read" } },
  { id: "geocode", label: { es: "Geocodificar", en: "Geocode" } },
  { id: "matrix", label: { es: "Calcular matriz", en: "Calculate matrix" } },
];
const IDLE: Record<StepId, StepState> = { read: { status: "idle" }, geocode: { status: "idle" }, matrix: { status: "idle" } };
const STATUS_TEXT: Record<StepStatus, Pair> = {
  idle: { es: "Pendiente", en: "Pending" },
  running: { es: "En curso", en: "In progress" },
  done: { es: "Hecho", en: "Done" },
  error: { es: "Error", en: "Error" },
  skipped: { es: "No hace falta", en: "Not needed" },
};
const DEFAULT_NAME: Pair = { es: "Mi caso", en: "My case" };

/** `3 clientes` / `1 customer`: el número y el sustantivo de cada idioma. */
const counted = (n: number, one: Pair, many: Pair): Pair => ({
  es: `${n} ${n === 1 ? one.es : many.es}`,
  en: `${n} ${n === 1 ? one.en : many.en}`,
});
const CUSTOMERS = [
  { es: "cliente", en: "customer" },
  { es: "clientes", en: "customers" },
] as const;
const VANS = [
  { es: "furgoneta", en: "van" },
  { es: "furgonetas", en: "vans" },
] as const;
const REASON_ID = "case-reason";
const CSV_ERROR_ID = "case-csv-errors";

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "running") {
    return <span aria-hidden="true" className="inline-block size-4 flex-none animate-spin rounded-full border-2 border-amber border-t-transparent" />;
  }
  const color = status === "done" ? "var(--ok)" : status === "error" ? "var(--late)" : "var(--fg-3)";
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 flex-none">
      <circle cx="8" cy="8" r="7" fill="none" stroke={color} strokeWidth="1.6" strokeDasharray={status === "idle" ? "2 2.4" : undefined} />
      {status === "done" && <path d="M4.8 8.3 7 10.4 11.3 5.8" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />}
      {status === "error" && <path d="M5.5 5.5l5 5m0-5l-5 5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />}
      {status === "skipped" && <path d="M5 8h6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

const group = "flex min-w-0 flex-col gap-2";
const legend = "kicker mb-1 p-0 text-fg-3";

/**
 * Caso propio: un CSV (o el formulario, que genera el mismo texto) pasa por tres pasos
 * visibles: leer en el servidor, geocodificar las direcciones y calcular la matriz.
 * Al acabar sustituye al caso actual. La única validación es la del servidor.
 */
export function CasePanel() {
  const { state, actions } = usePlanner();
  const [lang] = useLang();
  const t = useT();
  const { service } = useService();
  const metaNow = useLatest(state.meta);

  const [mode, setMode] = useState<Mode>("csv");
  const [form, setForm] = useState(newForm);
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [csvWarn, setCsvWarn] = useState<Pair | null>(null);
  // `null`: el nombre por defecto, que sigue al idioma hasta que el visitante escribe otro.
  const [name, setName] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState("3");
  const [capacity, setCapacity] = useState("20");

  const [steps, setSteps] = useState(IDLE);
  const [busy, setBusy] = useState(false);
  const [rowErrors, setRowErrors] = useState<{ from: Mode; items: CsvRowError[] } | null>(null);
  const [failure, setFailure] = useState<Pair | null>(null);
  const [work, setWork] = useState<S["Instance"] | null>(null);
  const [missing, setMissing] = useState<Position[]>([]);
  const [loaded, setLoaded] = useState<{ name: string; customers: number; vehicles: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const down = service === "down";
  const setStep = (id: StepId, s: StepState) => setSteps((prev) => ({ ...prev, [id]: s }));

  function reset() {
    setSteps(IDLE);
    setRowErrors(null);
    setFailure(null);
    setWork(null);
    setMissing([]);
    setLoaded(null);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    reset();
    setCsvWarn(null);
    // Un fichero enorme ni se lee: sus bytes ya pasan del tope de caracteres.
    const text = file.size > MAX_CSV_CHARS * 4 ? null : await file.text().catch(() => null);
    if (text === null || text.length > MAX_CSV_CHARS) {
      setCsv(null);
      const max = (l: "es" | "en") => formatNumber(MAX_CSV_CHARS, 0, l);
      setCsvWarn({
        es: `«${file.name}» es demasiado grande: el máximo son ${max("es")} caracteres. Recórtalo y vuelve a subirlo.`,
        en: `“${file.name}” is too large: the maximum is ${max("en")} characters. Trim it and upload it again.`,
      });
      return;
    }
    setCsv({ name: file.name, text });
  }

  /** Cancelar: aborta la petición en curso y deja los pasos como estaban antes de empezar. */
  function cancel() {
    abort.current?.abort();
    abort.current = null;
    setBusy(false);
    setSteps(IDLE);
    setWork(null);
    setMissing([]);
  }

  /** Geocodifica lo que falta y calcula la matriz. Se detiene si hay direcciones sin encontrar. */
  async function advance(start: S["Instance"], ctrl: AbortController, startMeta: unknown) {
    const stale = () => ctrl.signal.aborted || metaNow.current !== startMeta;
    let inst = start;
    const todo = unplaced(inst);
    if (todo.length === 0) {
      setStep("geocode", { status: "skipped", note: { es: "Todo trae coordenadas", en: "All have coordinates" } });
    } else {
      setStep("geocode", { status: "running", note: counted(todo.length, { es: "dirección", en: "address" }, { es: "direcciones", en: "addresses" }) });
      try {
        inst = await geocodePositions(inst, todo, ctrl.signal);
      } catch (e) {
        if (e instanceof ApiError && e.kind === "aborted") return;
        setWork(inst);
        setStep("geocode", { status: "error" });
        setFailure(failureText(e, "geocode"));
        return;
      }
      if (stale()) return;
      setWork(inst);
      const left = unplaced(inst);
      if (left.length > 0) {
        setMissing(left);
        setStep("geocode", { status: "error", note: { es: `${left.length} sin encontrar`, en: `${left.length} not found` } });
        return;
      }
      setStep("geocode", { status: "done", note: { es: `${todo.length} encontradas`, en: `${todo.length} found` } });
    }
    setMissing([]);

    setStep("matrix", { status: "running" });
    let matrix: S["Matrix"];
    try {
      matrix = await buildMatrix(inst, ctrl.signal);
    } catch (e) {
      if (e instanceof ApiError && e.kind === "aborted") return;
      setStep("matrix", { status: "error" });
      setFailure(failureText(e, "matrix"));
      return;
    }
    if (stale()) return;
    setStep("matrix", { status: "done", note: matrix.source === "haversine_fallback" ? { es: "en línea recta", en: "straight-line" } : { es: "por carretera", en: "by road" } });
    actions.setInstance({ ...inst, matrix }, { meta: { id: null, name: inst.name }, runs: [] });
    setWork(null);
    setLoaded({ name: inst.name, customers: inst.customers.length, vehicles: inst.fleet.vehicles });
  }

  async function load() {
    const text = mode === "csv" ? csv?.text : formToCsv(form);
    if (text === undefined || busy) return;
    reset();
    if (text.length > MAX_CSV_CHARS) {
      const n = (l: "es" | "en", v: number) => formatNumber(v, 0, l);
      setFailure({
        es: `El caso tiene ${n("es", text.length)} caracteres: el máximo son ${n("es", MAX_CSV_CHARS)}.`,
        en: `The case has ${n("en", text.length)} characters: the maximum is ${n("en", MAX_CSV_CHARS)}.`,
      });
      return;
    }
    const ctrl = new AbortController();
    abort.current = ctrl;
    const startMeta = metaNow.current;
    setBusy(true);
    setStep("read", { status: "running" });
    try {
      const inst = await parseCsv(
        {
          csv: text,
          name: name?.trim() || t(DEFAULT_NAME),
          fleet: { vehicles: Number(vehicles), capacity: capacity.trim() === "" ? null : Number(capacity.replace(",", ".")) },
        },
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      setStep("read", { status: "done", note: counted(inst.customers.length, CUSTOMERS[0], CUSTOMERS[1]) });
      await advance(inst, ctrl, startMeta);
    } catch (e) {
      if (e instanceof ApiError && e.kind === "aborted") return;
      setStep("read", { status: "error" });
      if (e instanceof ApiError && e.kind === "csv" && e.rows) setRowErrors({ from: mode, items: e.rows });
      else setFailure(failureText(e, "read"));
    } finally {
      if (abort.current === ctrl) {
        abort.current = null;
        setBusy(false);
      }
    }
  }

  /** Vuelve a geocodificar con las direcciones corregidas. */
  async function retry() {
    if (!work || busy) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    setFailure(null);
    try {
      await advance(work, ctrl, metaNow.current);
    } finally {
      if (abort.current === ctrl) {
        abort.current = null;
        setBusy(false);
      }
    }
  }

  function removeCustomer(pos: Position) {
    if (!work) return;
    const next = withoutCustomer(work, pos);
    setWork(next);
    const left = unplaced(next);
    setMissing(left);
    if (next.customers.length === 0) {
      setStep("geocode", { status: "error" });
      setFailure({ es: "No queda ningún cliente: añade alguno y vuelve a cargar el caso.", en: "No customers left: add some and load the case again." });
      setMissing([]);
      setWork(null);
    } else if (left.length === 0) {
      setStep("geocode", { status: "idle", note: { es: "Listo para continuar", en: "Ready to continue" } });
    } else {
      setStep("geocode", { status: "error", note: { es: `${left.length} sin encontrar`, en: `${left.length} not found` } });
    }
  }

  // Errores de fila pintados en el formulario: fila 2 = depósito, desde la 3 = un cliente por fila.
  const formErrors = new Map<"depot" | number, string[]>();
  if (rowErrors?.from === "form") {
    for (const { row, msg } of rowErrors.items) {
      const target = rowTarget(row);
      if (target !== null) formErrors.set(target, [...(formErrors.get(target) ?? []), `${t({ es: "Fila", en: "Row" })} ${row}: ${msg}`]);
    }
  }

  const needsFile = mode === "csv" && csv === null;
  const canLoad = service === "up" && !busy && !needsFile;
  const resolving = missing.length > 0 && work !== null;

  return (
    // En escritorio el panel comparte fila con el mapa: si su contenido pesa más que esa fila, la página
    // se alarga. Con altura mínima no cuenta para el cálculo de la fila y su contenido desborda hacia el
    // desplazamiento interno del panel (que se ve entero al bajar).
    <div
      data-testid="case-panel"
      data-mode={mode}
      role="group"
      aria-label={t({ es: "Cargar tu propio caso", en: "Load your own case" })}
      className="flex flex-col gap-4 min-[1180px]:h-px min-[1180px]:[&>:last-child]:mb-4"
    >
      <ServiceNotice id={REASON_ID} />
      {down && (
        <p data-testid="case-needs-service" className="text-base leading-snug text-fg-2">
          {t({ es: "Cargar un caso propio necesita el servicio. Los ejemplos siguen disponibles.", en: "Loading your own case needs the service. The examples are still available." })}
        </p>
      )}

      <div role="group" aria-label={t({ es: "Cómo cargarlo", en: "How to load it" })} className="grid grid-cols-2 gap-1 rounded-hud border border-line bg-black/25 p-1">
        {(
          [
            ["csv", { es: "Subir CSV", en: "Upload CSV" }],
            ["form", { es: "Formulario", en: "Form" }],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-testid={`case-mode-${id}`}
            aria-pressed={mode === id}
            disabled={busy}
            onClick={() => setMode(id)}
            className={`min-h-11 rounded-[9px] px-2 text-base font-semibold transition-colors duration-150 ${
              mode === id ? "bg-amber text-amber-ink" : "text-fg-2 [@media(hover:hover)]:hover:bg-white/[0.06] [@media(hover:hover)]:hover:text-fg"
            }`}
          >
            {t(label)}
          </button>
        ))}
      </div>

      <fieldset className={`${group} m-0 border-0 p-0`} disabled={busy}>
        <legend className={legend}>{t({ es: "Tu flota", en: "Your fleet" })}</legend>
        <label className="flex min-w-0 flex-col gap-1">
          <span aria-hidden="true" className="font-mono text-[12px] tracking-[0.1em] text-fg-3 uppercase">
            {t({ es: "Nombre del caso", en: "Case name" })}
          </span>
          <input
            type="text"
            data-testid="case-name"
            aria-label={t({ es: "Nombre del caso", en: "Case name" })}
            maxLength={200}
            value={name ?? t(DEFAULT_NAME)}
            onChange={(e) => setName(e.target.value)}
            className={INPUT}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t({ es: "Furgonetas", en: "Vans" })} name={t({ es: "Número de furgonetas", en: "Number of vans" })} testId="case-vehicles" value={vehicles} onChange={setVehicles} inputMode="numeric" />
          <Field label={t({ es: "Capacidad", en: "Capacity" })} name={t({ es: "Capacidad de cada furgoneta (vacío: sin límite)", en: "Capacity of each van (empty: no limit)" })} testId="case-capacity" value={capacity} onChange={setCapacity} inputMode="decimal" placeholder={t({ es: "sin límite", en: "no limit" })} />
        </div>
      </fieldset>

      {mode === "csv" ? (
        <div className={group}>
          <span className={legend}>{t({ es: "Tu CSV", en: "Your CSV" })}</span>
          <div className="flex flex-wrap items-center gap-2">
            <label className="btn has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-amber">
              <input type="file" accept=".csv,text/csv,text/plain" data-testid="csv-file" onChange={(e) => void onFile(e)} disabled={busy} className="sr-only" />
              {t({ es: "Elegir fichero CSV", en: "Choose CSV file" })}
            </label>
            <a href="/data/plantilla_caso_real.csv" download data-testid="csv-template" className="btn">
              {t({ es: "Descargar la plantilla", en: "Download the template" })}
            </a>
          </div>
          <p data-testid="csv-info" className="text-base leading-snug text-fg-2">
            {csv ? (
              <>
                <span className="font-semibold text-fg">{csv.name}</span> · {formatNumber(csv.text.length, 0, lang)} {t({ es: "caracteres", en: "characters" })}
              </>
            ) : (
              t({
                es: `Dirección o LAT y LON por fila, horas HH:MM. Máximo ${formatNumber(MAX_CSV_CHARS, 0, "es")} caracteres.`,
                // La plantilla (sus filas de ejemplo) no se traduce.
                en: `Address or LAT and LON per row, times as HH:MM. Maximum ${formatNumber(MAX_CSV_CHARS, 0, "en")} characters. The template is in Spanish.`,
              })
            )}
          </p>
          {csvWarn && (
            <p role="alert" data-testid="csv-too-big" className="text-base leading-snug text-late">
              <span aria-hidden="true">⚠ </span>
              {t(csvWarn)}
            </p>
          )}
        </div>
      ) : (
        <div className={group}>
          <span className={legend}>{t({ es: "Tu caso", en: "Your case" })}</span>
          <CaseForm form={form} onChange={setForm} errors={formErrors} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {busy ? (
          // El segundo clic de un doble clic en «Cargar el caso» cae aquí: no cancela (el teclado da `detail` 0).
          <Button data-testid="case-cancel" onClick={(e) => e.detail <= 1 && cancel()}>
            {t({ es: "Cancelar", en: "Cancel" })}
          </Button>
        ) : (
          <Button variant="primary" data-testid="case-load" disabled={!canLoad} aria-describedby={down ? REASON_ID : undefined} onClick={() => void load()}>
            {t({ es: "Cargar el caso", en: "Load the case" })}
          </Button>
        )}
        <span className="min-w-0 flex-1 text-base leading-snug text-fg-2">
          {busy
            ? t({ es: "Un paso cada vez.", en: "One step at a time." })
            : needsFile
              ? t({ es: "Elige un fichero para empezar.", en: "Choose a file to start." })
              : t({ es: "Sustituye al caso actual.", en: "Replaces the current case." })}
        </span>
      </div>

      <ol data-testid="case-steps" aria-live="polite" className="m-0 flex list-none flex-col gap-1.5 p-0">
        {STEPS.map(({ id, label }, i) => {
          const s = steps[id];
          return (
            <li
              key={id}
              data-testid="case-step"
              data-step={id}
              data-status={s.status}
              className="flex min-h-11 items-center gap-2.5 rounded-hud border border-line bg-black/20 px-2.5 text-base"
            >
              <StepIcon status={s.status} />
              <span className="font-semibold text-fg">
                {i + 1}. {t(label)}
              </span>
              <span className={`ml-auto text-right ${s.status === "error" ? "text-late" : s.status === "done" ? "text-ok" : "text-fg-2"}`}>
                {t(STATUS_TEXT[s.status])}
                {s.note ? ` · ${t(s.note)}` : ""}
              </span>
            </li>
          );
        })}
      </ol>

      {rowErrors && (
        <div role="alert" id={CSV_ERROR_ID} data-testid="csv-errors" className="rounded-hud border border-late/60 bg-late/10 px-3 py-2">
          <p className="text-base font-semibold text-fg">
            {t({
              es: `${rowErrors.items.length} ${rowErrors.items.length === 1 ? "fila con error" : "filas con error"}`,
              // Los motivos de cada fila los redacta el servicio en español.
              en: `${rowErrors.items.length} ${rowErrors.items.length === 1 ? "row with an error" : "rows with errors"} (messages in Spanish)`,
            })}
          </p>
          <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
            {rowErrors.items.map((it, i) => (
              <li key={i} data-testid="csv-error" data-row={it.row} className="text-base leading-snug text-fg">
                <span className="num font-semibold text-late">{it.row === 0 ? "General" : `${t({ es: "Fila", en: "Row" })} ${it.row}`}</span>
                {": "}
                {it.msg}
              </li>
            ))}
          </ul>
        </div>
      )}

      {failure && (
        <p role="alert" data-testid="case-failure" className="rounded-hud border border-late/60 bg-late/10 px-3 py-2 text-base leading-snug text-fg">
          <span aria-hidden="true">⚠ </span>
          {t(failure)}
        </p>
      )}

      {work && resolving && (
        <div data-testid="geocode-missing" className="flex flex-col gap-2 rounded-hud border border-wait/50 bg-wait/10 px-3 py-2.5">
          <p className="text-base leading-snug font-semibold text-fg">
            {t({
              es: `${missing.length === 1 ? "No encontramos esta dirección." : `No encontramos ${missing.length} direcciones.`} Corrígelas o quítalas para seguir.`,
              en: `${missing.length === 1 ? "We could not find this address." : `We could not find ${missing.length} addresses.`} Fix or remove them to continue.`,
            })}
          </p>
          {missing.map((pos) => {
            const label: Pair = pos === 0 ? { es: "Depósito", en: "Depot" } : { es: `Cliente ${work.customers[pos - 1].id}`, en: `Customer ${work.customers[pos - 1].id}` };
            return (
              <div key={pos} data-testid="geocode-missing-row" data-position={pos} className="flex flex-col gap-1.5">
                <Field label={t(label)} name={t({ es: `Dirección de ${label.es.toLowerCase()}`, en: `Address of ${label.en.toLowerCase()}` })} testId="missing-address" value={addressOf(work, pos)} onChange={(v) => setWork(withAddress(work, pos, v))} invalid />
                {pos !== 0 && (
                  <button type="button" data-testid="missing-remove" disabled={busy} onClick={() => removeCustomer(pos)} className="btn self-start">
                    <span aria-hidden="true">×</span> {t({ es: `Quitar ${label.es.toLowerCase()}`, en: `Remove ${label.en.toLowerCase()}` })}
                  </button>
                )}
              </div>
            );
          })}
          <Button variant="primary" data-testid="geocode-retry" disabled={busy} onClick={() => void retry()} className="self-start">
            {t({ es: "Buscar de nuevo", en: "Search again" })}
          </Button>
        </div>
      )}

      {work && !resolving && steps.geocode.status === "idle" && steps.geocode.note && (
        <Button variant="primary" data-testid="geocode-continue" disabled={busy} onClick={() => void retry()} className="self-start">
          {t({ es: "Continuar", en: "Continue" })}
        </Button>
      )}

      {loaded && (
        <p role="status" data-testid="case-loaded" className="rounded-hud border border-ok/50 bg-ok/10 px-3 py-2 text-base leading-snug text-fg">
          <span aria-hidden="true" className="text-ok">✓ </span>
          {t({
            es: `«${loaded.name}» cargado: ${counted(loaded.customers, CUSTOMERS[0], CUSTOMERS[1]).es} y ${counted(loaded.vehicles, VANS[0], VANS[1]).es}. Ya está en el mapa; lo resuelves desde «Resolver».`,
            en: `“${loaded.name}” loaded: ${counted(loaded.customers, CUSTOMERS[0], CUSTOMERS[1]).en} and ${counted(loaded.vehicles, VANS[0], VANS[1]).en}. It is on the map now; solve it from “Solve”.`,
          })}
        </p>
      )}
    </div>
  );
}
