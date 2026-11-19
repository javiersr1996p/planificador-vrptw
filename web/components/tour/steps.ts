/** Pasos del recorrido guiado: zona de la portada (`data-tour`) y texto. */
export type TourStep = {
  /** Selector de la zona; el recorrido omite el paso si no está en la página. */
  target: string;
  text: string;
  /** Marca la base con un aro, si hay un marcador `depot` dentro de la zona. */
  ring?: boolean;
};

export const TOUR_STEPS: readonly TourStep[] = [
  {
    target: '[data-tour="map"]',
    text: "Cada número es un cliente y la torre ámbar es la base de donde salen las furgonetas.",
    ring: true,
  },
  {
    target: '[data-tour="play"]',
    text: "Pulsa reproducir y mira pasar el día: quién espera, quién entrega y quién vuelve.",
  },
  {
    target: '[data-tour="hook"]',
    text: "Cada cliente solo recibe en su ventana horaria. Si llegas antes, toca esperar.",
  },
  {
    target: '[data-tour="comparison"]',
    text: "Varios métodos resuelven el mismo reparto. Gana el plan válido que menos cuesta.",
  },
  {
    target: '[data-tour="detail"]',
    text: "El día de una furgoneta: ventana, espera y entrega de cada parada.",
  },
  {
    target: '[data-tour="learn"]',
    text: "¿Quieres entenderlo a fondo? Empieza por aquí.",
  },
];
