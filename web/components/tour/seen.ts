/** Única clave de `localStorage` del recorrido: solo guarda que ya se vio. */
export const TOUR_STORAGE_KEY = "vrptw-tour";

export function readSeen(): boolean {
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function markSeen(): void {
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "1");
  } catch {
    // Sin almacenamiento (ventana privada): el recorrido sigue funcionando.
  }
}
