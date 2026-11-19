import type { ReactNode } from "react";
import { vehicleColor } from "@/components/planner/units";
import { TowerIcon } from "@/components/ui/TowerIcon";
import type { components } from "@/lib/types";
import { Stage, at } from "./parts";

type S = components["schemas"];

/** Clientes con retraso según la evaluación (violaciones `late`). */
export function lateCustomers(ev: S["Evaluation"] | null | undefined): Set<number> {
  return new Set((ev?.violations ?? []).filter((v) => v.type === "late" && v.customer != null).map((v) => v.customer!));
}

/**
 * Plano de un caso sin mapa (coordenadas x e y), con la misma escala en los
 * dos ejes, y las rutas de una solución. Sin rutas (respuesta ilegible), solo
 * los clientes y lo que se pase en `children`.
 */
export function CasePlane({
  instance,
  routes,
  late,
  label,
  className,
  children,
}: {
  instance: S["Instance"];
  routes: number[][] | null;
  late: Set<number>;
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  const pts = [instance.depot, ...instance.customers].map((p) => ({ x: p.x ?? 0, y: p.y ?? 0 }));
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const span = Math.max(1e-9, Math.max(...pts.map((p) => p.x)) - minX, Math.max(...pts.map((p) => p.y)) - minY);
  const pad = 9;
  const place = (p: { x?: number | null; y?: number | null }) => ({
    x: pad + (((p.x ?? 0) - minX) / span) * (100 - 2 * pad),
    y: 100 - pad - (((p.y ?? 0) - minY) / span) * (100 - 2 * pad),
  });
  const byId = new Map(instance.customers.map((c) => [c.id, c]));
  const depot = place(instance.depot);
  const routeOf = new Map<number, number>();
  routes?.forEach((r, i) => r.forEach((id) => routeOf.set(id, i)));

  return (
    <Stage className={["aspect-square w-full", className].filter(Boolean).join(" ")}>
      <div role="img" aria-label={label} className="absolute inset-0">
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden="true">
          {routes?.map((r, i) => {
            const line = [depot, ...r.map((id) => place(byId.get(id) ?? {})), depot];
            return (
              <polyline
                key={`${i}-${r.join("-")}`}
                points={line.map((p) => `${p.x},${p.y}`).join(" ")}
                pathLength={1}
                className="lrn-line lrn-draw decor"
                style={{ stroke: vehicleColor(i), filter: `drop-shadow(0 0 1px ${vehicleColor(i)})`, strokeWidth: 0.8 }}
              />
            );
          })}
        </svg>
        <span
          className="absolute z-[1] grid size-8 -translate-1/2 place-items-center rounded-lg border-2 border-amber bg-[#1a1203] text-amber shadow-[0_0_20px_2px_rgb(255_181_71/0.45)]"
          style={at(depot)}
          aria-hidden="true"
        >
          <TowerIcon className="size-5" />
        </span>
        {instance.customers.map((c) => {
          const route = routeOf.get(c.id);
          const isLate = late.has(c.id);
          const color = route !== undefined ? vehicleColor(route) : "var(--fg-3)";
          return (
            <span
              key={c.id}
              aria-hidden="true"
              data-testid="case-stop"
              data-late={isLate || undefined}
              className={`absolute z-[2] grid size-7 -translate-1/2 place-items-center border-2 font-mono text-[12px] leading-none font-bold text-fg uppercase ${
                isLate ? "rounded-[5px] rotate-45 border-late bg-[#2a0b0e]" : "rounded-full"
              }`}
              style={{
                ...at(place(c)),
                ...(isLate
                  ? {}
                  : {
                      borderColor: color,
                      borderStyle: route === undefined ? "dashed" : "solid",
                      background: route === undefined ? "#07101f" : `color-mix(in srgb, ${color} 24%, #07101f)`,
                    }),
              }}
            >
              <span className={isLate ? "-rotate-45" : undefined}>{c.id}</span>
            </span>
          );
        })}
        {children}
      </div>
    </Stage>
  );
}
