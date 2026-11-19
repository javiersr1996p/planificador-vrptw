"use client";

import type { ReactNode } from "react";
import { MAX_CUSTOMERS, newCustomer, type CustomerRow, type DepotRow, type FormModel } from "./csv";

export const INPUT =
  "min-h-11 w-full min-w-0 rounded-tag border border-line-2 bg-black/30 px-2.5 text-base text-fg placeholder:text-fg-3";

/** Campo con su etiqueta visible; el nombre accesible lleva además la fila a la que pertenece. */
export function Field({
  label,
  name,
  testId,
  value,
  onChange,
  placeholder,
  inputMode,
  invalid,
  className,
}: {
  label: string;
  name: string;
  testId: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: "decimal" | "numeric" | "text";
  invalid?: boolean;
  className?: string;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className ?? ""}`}>
      <span aria-hidden="true" className="font-mono text-[12px] tracking-[0.1em] text-fg-3 uppercase">
        {label}
      </span>
      <input
        type="text"
        data-testid={testId}
        aria-label={name}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        spellCheck={false}
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT} ${invalid ? "border-late" : ""}`}
      />
    </label>
  );
}

/** Fila con su cabecera y, si el servidor la rechazó, el motivo escrito (no solo el color). */
function RowCard({
  testId,
  index,
  title,
  errors,
  action,
  children,
}: {
  testId: string;
  index: number;
  title: string;
  errors: string[];
  action?: ReactNode;
  children: ReactNode;
}) {
  const bad = errors.length > 0;
  return (
    <fieldset
      data-testid={testId}
      data-index={index}
      data-error={bad ? "true" : undefined}
      className={`m-0 flex min-w-0 flex-col gap-2 rounded-hud border bg-black/20 px-2.5 pt-1 pb-2.5 ${bad ? "border-late" : "border-line"}`}
    >
      <legend className="sr-only">{title}</legend>
      <div className="flex min-h-11 items-center justify-between gap-2">
        <span aria-hidden="true" className="font-mono text-[12px] tracking-[0.1em] text-fg-2 uppercase">
          {title}
        </span>
        {action}
      </div>
      {children}
      {bad && (
        <ul data-testid="row-error" className="m-0 flex list-none flex-col gap-0.5 p-0 text-base leading-snug text-late">
          {errors.map((e, i) => (
            <li key={i}>
              <span aria-hidden="true">⚠ </span>
              {e}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

type Errors = Map<"depot" | number, string[]>;

/**
 * Formulario del caso: depósito, y una tarjeta por cliente con su dirección o sus coordenadas,
 * demanda, ventana `HH:MM` y servicio. No valida nada: el texto va tal cual al servidor.
 */
export function CaseForm({ form, onChange, errors }: { form: FormModel; onChange: (form: FormModel) => void; errors: Errors }) {
  const setDepot = (patch: Partial<DepotRow>) => onChange({ ...form, depot: { ...form.depot, ...patch } });
  const setCustomer = (i: number, patch: Partial<CustomerRow>) =>
    onChange({ ...form, customers: form.customers.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const d = form.depot;
  const full = form.customers.length >= MAX_CUSTOMERS;

  return (
    <div data-testid="case-form" className="flex flex-col gap-2">
      <RowCard testId="form-depot" index={-1} title="Depósito" errors={errors.get("depot") ?? []}>
        <Field label="Dirección" name="Dirección del depósito" testId="depot-address" value={d.address} onChange={(address) => setDepot({ address })} placeholder="Calle y ciudad" invalid={errors.has("depot")} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Lat" name="Latitud del depósito" testId="depot-lat" value={d.lat} onChange={(lat) => setDepot({ lat })} inputMode="decimal" placeholder="40,4168" />
          <Field label="Lon" name="Longitud del depósito" testId="depot-lon" value={d.lon} onChange={(lon) => setDepot({ lon })} inputMode="decimal" placeholder="-3,7038" />
          <Field label="Abre" name="Hora de apertura del depósito" testId="depot-ready" value={d.ready} onChange={(ready) => setDepot({ ready })} placeholder="HH:MM" />
          <Field label="Cierra" name="Hora de cierre del depósito" testId="depot-due" value={d.due} onChange={(due) => setDepot({ due })} placeholder="HH:MM" />
        </div>
      </RowCard>

      {form.customers.map((c, i) => {
        const n = i + 1;
        const bad = errors.has(i);
        return (
          <RowCard
            key={c.key}
            testId="form-customer"
            index={i}
            title={`Cliente ${n}`}
            errors={errors.get(i) ?? []}
            action={
              <button
                type="button"
                data-testid="remove-customer"
                aria-label={`Quitar el cliente ${n}`}
                disabled={form.customers.length === 1}
                onClick={() => onChange({ ...form, customers: form.customers.filter((_, j) => j !== i) })}
                className="btn min-h-11 px-3 text-base"
              >
                <span aria-hidden="true">×</span> Quitar
              </button>
            }
          >
            <Field label="Dirección" name={`Dirección del cliente ${n}`} testId="customer-address" value={c.address} onChange={(address) => setCustomer(i, { address })} placeholder="o rellena Lat y Lon" invalid={bad} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Lat" name={`Latitud del cliente ${n}`} testId="customer-lat" value={c.lat} onChange={(lat) => setCustomer(i, { lat })} inputMode="decimal" />
              <Field label="Lon" name={`Longitud del cliente ${n}`} testId="customer-lon" value={c.lon} onChange={(lon) => setCustomer(i, { lon })} inputMode="decimal" />
              <Field label="Demanda" name={`Demanda del cliente ${n}`} testId="customer-demand" value={c.demand} onChange={(demand) => setCustomer(i, { demand })} inputMode="decimal" />
              <Field label="Servicio (min)" name={`Servicio del cliente ${n}, en minutos`} testId="customer-service" value={c.service} onChange={(service) => setCustomer(i, { service })} inputMode="decimal" />
              <Field label="Desde" name={`Ventana del cliente ${n}: desde`} testId="customer-ready" value={c.ready} onChange={(ready) => setCustomer(i, { ready })} placeholder="HH:MM" />
              <Field label="Hasta" name={`Ventana del cliente ${n}: hasta`} testId="customer-due" value={c.due} onChange={(due) => setCustomer(i, { due })} placeholder="HH:MM" />
            </div>
          </RowCard>
        );
      })}

      <button
        type="button"
        data-testid="add-customer"
        disabled={full}
        onClick={() => onChange({ ...form, customers: [...form.customers, newCustomer()] })}
        className="btn self-start"
      >
        <span aria-hidden="true">+</span> Añadir cliente
      </button>
      {full && <p className="text-base text-fg-2">Máximo {MAX_CUSTOMERS} clientes.</p>}
    </div>
  );
}
