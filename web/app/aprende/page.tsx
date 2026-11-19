import type { Metadata } from "next";
import { LearnStory } from "@/components/learn/LearnStory";

export const metadata: Metadata = {
  title: "Aprende: rutas de reparto con ventanas horarias, en siete escenas",
  description:
    "Qué es el problema de rutas con ventanas horarias, qué hace válido un plan y cómo lo resuelven cuatro métodos clásicos y un modelo de lenguaje, con dibujos interactivos.",
};

/** Página estática: la historia es un Client Component que lee un caso de ejemplo de `/data/`. */
export default function LearnPage() {
  return (
    <main className="wrap flex-1">
      <LearnStory />
    </main>
  );
}
