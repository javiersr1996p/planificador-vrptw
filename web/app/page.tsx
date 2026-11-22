import { Planner } from "@/components/planner/Planner";
import { Tour } from "@/components/tour/Tour";
import { DocMeta } from "@/lib/i18n";

export default function Home() {
  return (
    <main className="wrap flex-1">
      {/* El español es el de `metadata` en app/layout.tsx; el inglés se aplica al cambiar de idioma. */}
      <DocMeta
        es={{
          title: "Planificador VRPTW: rutas de reparto con métodos clásicos y LLM",
          description:
            "Compara heurística, colonia de hormigas, algoritmo genético, búsqueda tabú y modelos de lenguaje en problemas de rutas con ventanas horarias.",
        }}
        en={{
          title: "VRPTW Planner: delivery routes with classic methods and LLMs",
          description:
            "Compare heuristic, ant colony, genetic algorithm, tabu search and language models on routing problems with time windows.",
        }}
      />
      <Planner />
      <Tour />
    </main>
  );
}
