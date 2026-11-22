"use client";

import { useSyncExternalStore } from "react";
import { T } from "@/lib/i18n";
import { TOUR_BUTTON_ID, getTour, subscribeTour } from "./tour-slot";

/** "Recorrido guiado": visible solo con un recorrido conectado. */
export function TourButton() {
  const tour = useSyncExternalStore(subscribeTour, getTour, () => null);
  return (
    <button
      id={TOUR_BUTTON_ID}
      type="button"
      className="btn max-nav:btn-icon"
      data-testid="tour-start"
      data-attention={tour?.attention ? "true" : undefined}
      hidden={!tour}
      onClick={() => tour?.open()}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="m15.5 8.5-2 5-5 2 2-5z" />
      </svg>
      <span className="max-nav:sr-only">
        <T es="Recorrido guiado" en="Guided tour" />
      </span>
    </button>
  );
}
