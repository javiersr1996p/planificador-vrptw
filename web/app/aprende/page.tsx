import type { Metadata } from "next";
import { LearnStory } from "@/components/learn/LearnStory";
import { DocMeta } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Aprende: rutas de reparto con ventanas horarias, en siete escenas",
  description:
    "Qué es el problema de rutas con ventanas horarias, qué hace válido un plan y cómo lo resuelven cuatro métodos clásicos y un modelo de lenguaje, con dibujos interactivos.",
};

/** Página estática: la historia es un Client Component que lee un caso de ejemplo de `/data/`. */
export default function LearnPage() {
  return (
    <main className="wrap flex-1">
      <DocMeta
        es={{ title: metadata.title as string, description: metadata.description as string }}
        en={{
          title: "Learn: delivery routes with time windows, in seven scenes",
          description:
            "What the routing problem with time windows is, what makes a plan valid and how four classic methods and a language model solve it, with interactive drawings.",
        }}
      />
      <LearnStory />
    </main>
  );
}
