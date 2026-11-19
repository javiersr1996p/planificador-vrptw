import { Planner } from "@/components/planner/Planner";
import { Tour } from "@/components/tour/Tour";

export default function Home() {
  return (
    <main className="wrap flex-1">
      <Planner />
      <Tour />
    </main>
  );
}
