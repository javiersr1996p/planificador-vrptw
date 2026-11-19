/**
 * Enchufe del botón "Recorrido guiado" de la cabecera. El botón está oculto
 * hasta que un recorrido se conecta con `connectTour`; la función devuelta lo
 * desconecta. Volver a llamar a `connectTour` sustituye la conexión (p. ej.
 * para quitar la llamada de atención tras la primera visita).
 */

export type TourConnection = {
  open: () => void;
  /** Llamada discreta sobre el botón. */
  attention?: boolean;
};

let current: TourConnection | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function connectTour(connection: TourConnection): () => void {
  current = connection;
  emit();
  return () => {
    if (current !== connection) return;
    current = null;
    emit();
  };
}

export function subscribeTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getTour(): TourConnection | null {
  return current;
}

/** Id del botón, para devolverle el foco al cerrar el recorrido. */
export const TOUR_BUTTON_ID = "tour-start";
