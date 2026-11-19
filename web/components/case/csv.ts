/** Modelo del formulario y su conversión al texto CSV de la plantilla. */

export type Place = { address: string; lat: string; lon: string };
export type DepotRow = Place & { ready: string; due: string };
export type CustomerRow = Place & { key: number; demand: string; ready: string; due: string; service: string };
export type FormModel = { depot: DepotRow; customers: CustomerRow[] };

export const MAX_CSV_CHARS = 100_000;
export const MAX_CUSTOMERS = 100;
export const HEADER = "CUSTOMER,ADDRESS,LAT,LON,DEMAND,READY_TIME,DUE_TIME,SERVICE_TIME";

let nextKey = 1;

export function newCustomer(): CustomerRow {
  return { key: nextKey++, address: "", lat: "", lon: "", demand: "1", ready: "09:00", due: "18:00", service: "10" };
}

export function newForm(): FormModel {
  return { depot: { address: "", lat: "", lon: "", ready: "08:00", due: "18:00" }, customers: [newCustomer(), newCustomer()] };
}

/** Una celda del CSV: entre comillas si lleva coma, comillas o saltos de línea. */
function cell(value: string): string {
  const v = value.trim().replace(/[\r\n]+/g, " ");
  return /[",;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Los números del formulario admiten coma decimal: en el CSV irían en otra columna. */
const num = (value: string) => value.trim().replace(",", ".");

/** El texto CSV de la plantilla: fila 1 cabecera, fila 2 depósito y desde la 3 un cliente por fila. */
export function formToCsv(form: FormModel): string {
  const line = (id: number, p: Place, demand: string, ready: string, due: string, service: string) =>
    [String(id), cell(p.address), num(p.lat), num(p.lon), num(demand), cell(ready), cell(due), num(service)].join(",");
  return [
    HEADER,
    line(0, form.depot, "0", form.depot.ready, form.depot.due, "0"),
    ...form.customers.map((c, i) => line(i + 1, c, c.demand, c.ready, c.due, c.service)),
  ].join("\n");
}

/** A qué parte del formulario apunta una fila del CSV generado: `depot`, un cliente (0, 1, ...) o ninguna. */
export function rowTarget(row: number): "depot" | number | null {
  if (row === 2) return "depot";
  return row >= 3 ? row - 3 : null;
}
