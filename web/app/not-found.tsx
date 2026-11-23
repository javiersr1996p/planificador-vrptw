import Link from "next/link";
import type { CSSProperties } from "react";
import { buttonClass } from "@/components/ui/Button";
import { Corners } from "@/components/ui/Corners";
import { Help } from "@/components/ui/Help";
import { Kicker } from "@/components/ui/Kicker";
import { DocMeta, T } from "@/lib/i18n";
import { TowerIcon } from "@/components/ui/TowerIcon";

export default function NotFound() {
  return (
    <main className="wrap grid flex-1 content-center items-center gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:gap-16 lg:py-12">
      <DocMeta
        es={{ title: "Página no encontrada · Planificador VRPTW" }}
        en={{ title: "Page not found · VRPTW Planner" }}
      />
      <div className="flex flex-col items-start gap-4" style={{ animation: "rise 700ms var(--ease-out) both" }}>
        <Kicker>
          <T es="Error 404 · Parada desconocida" en="Error 404 · Unknown stop" />
        </Kicker>
        <p
          className="pt-2 font-display text-[clamp(104px,15vw,208px)] leading-[0.78] font-extrabold text-amber [text-shadow:0_0_42px_rgb(255_181_71/0.45)]"
          aria-hidden="true"
        >
          404
        </p>
        <h1 className="text-[clamp(36px,4vw,56px)] font-extrabold">
          <T es="Esta ruta no existe" en="This route does not exist" />
        </h1>
        <p className="max-w-[32rem] text-lg leading-snug text-fg-2">
          <T es="Ninguna furgoneta para en esta dirección, así que no entra en ningún" en="No van stops at this address, so it is not part of any" />{" "}
          <span className="whitespace-nowrap">
            <span className="term-mark text-fg">
              <T es="plan válido" en="valid plan" />
            </span>
            <Help term="valido" size="sm" className="ml-2" />
          </span>
        </p>
        <Link href="/" className={buttonClass("primary", "mt-2")}>
          <T es="Volver al planificador" en="Back to the planner" />
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Link>
      </div>
      <Radar />
    </main>
  );
}

const ROUTES = [
  { color: "var(--veh-1)", points: "200,200 118,132 86,222 200,200" },
  { color: "var(--veh-2)", points: "200,200 262,104 326,170 292,252 200,200" },
  { color: "var(--veh-3)", points: "200,200 162,304 252,322 200,200" },
];

/** Radar decorativo: tres rutas cerradas y una parada que no está en ninguna. */
function Radar() {
  const glow = (color: string): CSSProperties => ({ stroke: color, filter: `drop-shadow(0 0 5px ${color})` });
  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[480px] overflow-hidden rounded-panel border border-line-2 bg-[#050a14] shadow-[var(--shadow-deep)]"
      style={{ animation: "rise 800ms 120ms var(--ease-out) both" }}
      aria-hidden="true"
    >
      <div
        className="decor absolute inset-[10%] rounded-full"
        style={{
          background: "conic-gradient(from 0deg, rgb(255 181 71 / 0.2), transparent 16%, transparent)",
          animation: "sweep 7s linear infinite",
        }}
      />
      <svg viewBox="0 0 400 400" className="absolute inset-0 size-full">
        {[60, 120, 160].map((r) => (
          <circle key={r} cx="200" cy="200" r={r} fill="none" strokeDasharray="2 6" style={{ stroke: "rgb(255 181 71 / 0.22)" }} />
        ))}
        <path d="M200 30v340M30 200h340" style={{ stroke: "rgb(150 180 230 / 0.12)" }} />
        {ROUTES.map((route) => (
          <polyline key={route.color} points={route.points} fill="none" strokeWidth="2.5" strokeLinejoin="round" style={glow(route.color)} />
        ))}
        {ROUTES.flatMap((route) =>
          route.points
            .split(" ")
            .slice(1, -1)
            .map((p) => {
              const [x, y] = p.split(",");
              return <circle key={route.color + p} cx={x} cy={y} r="8" strokeWidth="2" style={{ fill: "#07101f", stroke: route.color }} />;
            }),
        )}
        <line x1="200" y1="200" x2="322" y2="318" strokeWidth="2" strokeDasharray="4 7" style={{ stroke: "rgb(255 103 103 / 0.6)" }} />
        <circle cx="330" cy="326" r="16" strokeWidth="2" strokeDasharray="5 4" style={{ fill: "#1a0709", stroke: "var(--late)" }} />
        <text x="330" y="332" textAnchor="middle" style={{ fill: "var(--late)", font: "700 17px var(--ff-body), sans-serif" }}>
          ?
        </text>
        <text
          x="330"
          y="366"
          textAnchor="middle"
          style={{ fill: "var(--late)", font: "600 12px var(--ff-mono), monospace", letterSpacing: "0.12em", textTransform: "uppercase" }}
        >
          <T es="Sin ruta" en="No route" />
        </text>
      </svg>
      <span className="absolute top-1/2 left-1/2 grid size-11 -translate-1/2 place-items-center">
        {[0, 1.6].map((delay) => (
          <span
            key={delay}
            className="decor absolute inset-0 rounded-full border-2 border-amber/60"
            style={{ animation: `radar 3.2s ${delay}s var(--ease-out) infinite` }}
          />
        ))}
        <span className="relative grid size-10 place-items-center rounded-xl border-2 border-amber bg-[#1a1203] text-amber shadow-[0_0_28px_4px_rgb(255_181_71/0.55)]">
          <TowerIcon className="size-6" />
        </span>
      </span>
      <Corners />
    </div>
  );
}
