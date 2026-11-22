import type { Pair } from "@/lib/i18n";

/**
 * Glosario de la interfaz: una o dos frases por término, para quien no conoce
 * el problema. Lo usan el botón de ayuda "?", la comparativa y las páginas
 * explicativas.
 */

export type GlossaryEntry = {
  /** Nombre del término, como título del globo de ayuda. */
  title: Pair;
  /** Nombre accesible del botón "?". */
  ask: Pair;
  /** Explicación de una o dos frases. */
  text: Pair;
  /** Línea corta bajo el nombre de un método en la comparativa. */
  hint?: Pair;
  /** Dibujo que acompaña a la explicación. */
  figure?: "ventana";
};

export const GLOSSARY = {
  ventana: {
    title: { es: "Ventana horaria", en: "Time window" },
    ask: { es: "¿Qué es una ventana horaria?", en: "What is a time window?" },
    text: { es: "La franja en la que el cliente acepta el pedido. Si llegas antes, esperas; si llegas después, es retraso.", en: "The slot when the customer accepts the order. If you arrive earlier, you wait; if you arrive later, you are late." },
    figure: "ventana",
  },
  espera: {
    title: { es: "Espera", en: "Wait" },
    ask: { es: "¿Qué es la espera?", en: "What does wait mean?" },
    text: { es: "Tiempo parado ante un cliente cuya ventana aún no ha abierto: la furgoneta llegó pronto y aguarda.", en: "Time spent parked at a customer whose time window has not opened yet: the van arrived early and waits." },
  },
  retraso: {
    title: { es: "Retraso", en: "Late" },
    ask: { es: "¿Qué es el retraso?", en: "What does late mean?" },
    text: { es: "Llegar cuando la ventana ya cerró. Se multa en el coste y el plan deja de ser válido.", en: "Arriving after the time window has closed. It is penalized in the cost and the plan stops being valid." },
  },
  capacidad: {
    title: { es: "Capacidad", en: "Capacity" },
    ask: { es: "¿Qué es la capacidad?", en: "What is capacity?" },
    text: { es: "Lo que cabe en una furgoneta. Los pedidos de su ruta, sumados, no pueden pasar de ahí.", en: "How much fits in a van. The orders on its route, added up, cannot go over that." },
  },
  coste: {
    title: { es: "Coste", en: "Cost" },
    ask: { es: "¿Qué es el coste?", en: "What is cost?" },
    text: { es: "La distancia recorrida más las multas que fija cada caso, como llegar tarde o dejar clientes sin atender. Menos es mejor.", en: "The distance driven plus the penalties each case sets, such as arriving late or leaving customers unserved. Lower is better." },
  },
  valido: {
    title: { es: "Plan válido", en: "Valid plan" },
    ask: { es: "¿Qué es un plan válido?", en: "What is a valid plan?" },
    text: { es: "El que atiende a todos los clientes una sola vez, sin pasar la capacidad y sin llegar tarde a nadie.", en: "One that serves every customer exactly once, without going over capacity and without making anyone late." },
  },
  heuristic: {
    title: { es: "Heurística", en: "Heuristic" },
    ask: { es: "¿Qué es la heurística?", en: "What is the heuristic?" },
    hint: { es: "Regla rápida, de una pasada", en: "Quick rule, single pass" },
    text: { es: "Cada furgoneta va siempre al cliente posible más cercano hasta que no le cabe ninguno más. Muy rápida, rara vez la mejor.", en: "Each van always goes to the nearest customer it can still serve until none more fits. Very fast, rarely the best." },
  },
  aco: {
    title: { es: "Colonia de hormigas", en: "Ant colony" },
    ask: { es: "¿Qué es la colonia de hormigas?", en: "What is the ant colony?" },
    hint: { es: "Hormigas que marcan atajos", en: "Ants that mark shortcuts" },
    text: { es: "Muchas «hormigas» trazan planes y dejan rastro en los tramos buenos; las siguientes tienden a seguirlo.", en: "Many \"ants\" build plans and leave a trail on the good legs; the next ones tend to follow it." },
  },
  ga: {
    title: { es: "Algoritmo genético", en: "Genetic algorithm" },
    ask: { es: "¿Qué es el algoritmo genético?", en: "What is the genetic algorithm?" },
    hint: { es: "Cruza planes y evoluciona", en: "Crosses plans and evolves" },
    text: { es: "Mezcla planes como si fueran genes y se queda con los mejores, generación tras generación.", en: "It mixes plans like genes and keeps the best ones, generation after generation." },
  },
  tabu: {
    title: { es: "Búsqueda tabú", en: "Tabu search" },
    ask: { es: "¿Qué es la búsqueda tabú?", en: "What is tabu search?" },
    hint: { es: "Mejora sin repetir pasos", en: "Improves without repeating steps" },
    text: { es: "Retoca un plan con cambios pequeños y prohíbe deshacerlos durante un tiempo para no dar vueltas en círculo.", en: "It tweaks a plan with small changes and forbids undoing them for a while so it does not go around in circles." },
  },
  llm_direct: {
    title: { es: "LLM directo", en: "Direct LLM" },
    ask: { es: "¿Qué es el LLM directo?", en: "What is the direct LLM?" },
    hint: { es: "El modelo escribe el plan de una vez", en: "The model writes the plan in one go" },
    text: { es: "Un modelo de lenguaje lee el problema y escribe las rutas de una sola vez, sin calcular nada aparte.", en: "A language model reads the problem and writes the routes in one go, without calculating anything separately." },
  },
  llm_agent: {
    title: { es: "Agente LLM", en: "LLM agent" },
    ask: { es: "¿Qué es un agente LLM?", en: "What is an LLM agent?" },
    hint: { es: "El modelo usa herramientas y corrige", en: "The model uses tools and corrects itself" },
    text: { es: "El modelo puede lanzar los métodos clásicos y evaluar rutas; mira los resultados y entrega su plan.", en: "The model can run the classic methods and evaluate routes; it looks at the results and delivers its plan." },
  },
  manual: {
    title: { es: "Tu ruta", en: "Your route" },
    ask: { es: "¿Qué es «Tu ruta»?", en: "What is \"Your route\"?" },
    hint: { es: "Rutas armadas por ti, mismo evaluador", en: "Routes you build, same evaluator" },
    text: { es: "Las rutas que montas pulsando paradas en el mapa, medidas con el mismo evaluador que los métodos.", en: "The routes you put together by tapping stops on the map, measured with the same evaluator as the methods." },
  },
  tokens: {
    title: { es: "Tokens", en: "Tokens" },
    ask: { es: "¿Qué son los tokens?", en: "What are tokens?" },
    text: { es: "Los trozos de texto con los que un modelo de lenguaje lee y escribe. Se pagan por millón: más tokens, más coste.", en: "The chunks of text a language model uses to read and write. They are billed per million: more tokens, more cost." },
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryTerm = keyof typeof GLOSSARY;

/** Línea corta que explica un método (`RunRecord.method`), si el glosario la tiene. */
export function methodHint(method: string): Pair | undefined {
  const entry: GlossaryEntry | undefined = (GLOSSARY as Record<string, GlossaryEntry>)[method];
  return entry?.hint;
}
