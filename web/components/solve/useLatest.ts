import { useRef } from "react";

/**
 * Referencia al último valor renderizado. Un panel oculto con `Activity` deja de
 * ejecutar sus efectos pero sigue renderizando, así que un cálculo largo que
 * quedó en marcha mira aquí (y no en un efecto) si el caso cambió mientras tanto.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  // eslint-disable-next-line react-hooks/refs
  ref.current = value;
  return ref;
}
