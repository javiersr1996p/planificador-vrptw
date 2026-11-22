import type { Pair } from "@/lib/i18n";

/** Pasos del recorrido guiado: zona de la portada (`data-tour`) y texto. */
export type TourStep = {
  /** Selector de la zona; el recorrido omite el paso si no está en la página. */
  target: string;
  text: Pair;
  /** Marca la base con un aro, si hay un marcador `depot` dentro de la zona. */
  ring?: boolean;
};

export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: '[data-tour="map"]',
    text: {
      es: "Cada número es un cliente y la torre ámbar es la base de donde salen las furgonetas.",
      en: "Each number is a customer, and the amber tower is the depot the vans leave from.",
    },
    ring: true,
  },
  {
    target: '[data-tour="play"]',
    text: {
      es: "Pulsa reproducir y mira pasar el día: quién espera, quién entrega y quién vuelve.",
      en: "Press play and watch the day go by: who waits, who delivers and who returns.",
    },
  },
  {
    target: '[data-tour="hook"]',
    text: {
      es: "Cada cliente solo recibe en su ventana horaria. Si llegas antes, toca esperar.",
      en: "Each customer only receives in their time window. Arrive early and you wait.",
    },
  },
  {
    target: '[data-tour="comparison"]',
    text: {
      es: "Varios métodos resuelven el mismo reparto. Gana el plan válido que menos cuesta.",
      en: "Several methods solve the same delivery run. The valid plan that costs least wins.",
    },
  },
  {
    target: '[data-tour="detail"]',
    text: {
      es: "El día de una furgoneta: ventana, espera y entrega de cada parada.",
      en: "One van's day: time window, wait and delivery at each stop.",
    },
  },
  {
    target: '[data-tour="learn"]',
    text: { es: "¿Quieres entenderlo a fondo? Empieza por aquí.", en: "Want to understand it in depth? Start here." },
  },
];
