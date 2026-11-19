/**
 * Glosario de la interfaz: una o dos frases por término, para quien no conoce
 * el problema. Lo usan el botón de ayuda "?", la comparativa y las páginas
 * explicativas.
 */

export type GlossaryEntry = {
  /** Nombre del término, como título del globo de ayuda. */
  title: string;
  /** Nombre accesible del botón "?". */
  ask: string;
  /** Explicación de una o dos frases. */
  text: string;
  /** Línea corta bajo el nombre de un método en la comparativa. */
  hint?: string;
  /** Dibujo que acompaña a la explicación. */
  figure?: "ventana";
};

export const GLOSSARY = {
  ventana: {
    title: "Ventana horaria",
    ask: "¿Qué es una ventana horaria?",
    text: "La franja en la que el cliente acepta el pedido. Si llegas antes, esperas; si llegas después, es retraso.",
    figure: "ventana",
  },
  espera: {
    title: "Espera",
    ask: "¿Qué es la espera?",
    text: "Tiempo parado ante un cliente cuya ventana aún no ha abierto: la furgoneta llegó pronto y aguarda.",
  },
  retraso: {
    title: "Retraso",
    ask: "¿Qué es el retraso?",
    text: "Llegar cuando la ventana ya cerró. Se multa en el coste y el plan deja de ser válido.",
  },
  capacidad: {
    title: "Capacidad",
    ask: "¿Qué es la capacidad?",
    text: "Lo que cabe en una furgoneta. Los pedidos de su ruta, sumados, no pueden pasar de ahí.",
  },
  coste: {
    title: "Coste",
    ask: "¿Qué es el coste?",
    text: "La distancia recorrida más las multas que fija cada caso, como llegar tarde o dejar clientes sin atender. Menos es mejor.",
  },
  valido: {
    title: "Plan válido",
    ask: "¿Qué es un plan válido?",
    text: "El que atiende a todos los clientes una sola vez, sin pasar la capacidad y sin llegar tarde a nadie.",
  },
  heuristic: {
    title: "Heurística",
    ask: "¿Qué es la heurística?",
    hint: "Regla rápida, de una pasada",
    text: "Cada furgoneta va siempre al cliente posible más cercano hasta que no le cabe ninguno más. Muy rápida, rara vez la mejor.",
  },
  aco: {
    title: "Colonia de hormigas",
    ask: "¿Qué es la colonia de hormigas?",
    hint: "Hormigas que marcan atajos",
    text: "Muchas «hormigas» trazan planes y dejan rastro en los tramos buenos; las siguientes tienden a seguirlo.",
  },
  ga: {
    title: "Algoritmo genético",
    ask: "¿Qué es el algoritmo genético?",
    hint: "Cruza planes y evoluciona",
    text: "Mezcla planes como si fueran genes y se queda con los mejores, generación tras generación.",
  },
  tabu: {
    title: "Búsqueda tabú",
    ask: "¿Qué es la búsqueda tabú?",
    hint: "Mejora sin repetir pasos",
    text: "Retoca un plan con cambios pequeños y prohíbe deshacerlos durante un tiempo para no dar vueltas en círculo.",
  },
  llm_direct: {
    title: "LLM directo",
    ask: "¿Qué es el LLM directo?",
    hint: "El modelo escribe el plan de una vez",
    text: "Un modelo de lenguaje lee el problema y escribe las rutas de una sola vez, sin calcular nada aparte.",
  },
  llm_agent: {
    title: "Agente LLM",
    ask: "¿Qué es un agente LLM?",
    hint: "El modelo usa herramientas y corrige",
    text: "El modelo puede lanzar los métodos clásicos y evaluar rutas; mira los resultados y entrega su plan.",
  },
  manual: {
    title: "Tu ruta",
    ask: "¿Qué es «Tu ruta»?",
    hint: "Rutas armadas por ti, mismo evaluador",
    text: "Las rutas que montas pulsando paradas en el mapa, medidas con el mismo evaluador que los métodos.",
  },
  tokens: {
    title: "Tokens",
    ask: "¿Qué son los tokens?",
    text: "Los trozos de texto con los que un modelo de lenguaje lee y escribe. Se pagan por millón: más tokens, más coste.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryTerm = keyof typeof GLOSSARY;

/** Línea corta que explica un método (`RunRecord.method`), si el glosario la tiene. */
export function methodHint(method: string): string | undefined {
  const entry: GlossaryEntry | undefined = (GLOSSARY as Record<string, GlossaryEntry>)[method];
  return entry?.hint;
}
