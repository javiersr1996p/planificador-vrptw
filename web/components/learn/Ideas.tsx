"use client";

import { useId, type ReactNode } from "react";

/**
 * Dibujos de la idea de cada método y de los dos papeles de la IA. Son SVG
 * con animaciones SMIL que solo se montan con el movimiento activo; sin
 * movimiento queda el fotograma final, que ya cuenta la idea.
 */

const C1 = "#3fd6ff";
const C2 = "#ff6ec7";
const C3 = "#a993ff";
const AMBER = "#ffb547";
const NODE = "#07101f";
const MUTED = "rgb(150 180 230 / 0.35)";
const LABEL = { fill: "var(--fg-3)", font: "600 12px var(--ff-mono), monospace", letterSpacing: "0.1em", textTransform: "uppercase" } as const;

function Svg({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg viewBox="0 0 240 140" className="block h-auto w-full" role="img" aria-label={label}>
      {children}
    </svg>
  );
}

/** `values`/`keyTimes` de SMIL a partir de pares [instante, valor]. */
function anim(attr: string, frames: [number, string | number][], dur = 6) {
  return (
    <animate
      attributeName={attr}
      values={frames.map((f) => f[1]).join(";")}
      keyTimes={frames.map((f) => f[0]).join(";")}
      dur={`${dur}s`}
      repeatCount="indefinite"
    />
  );
}

/** Heurística: desde cada parada, al cliente más cercano. */
function Heuristic({ motion }: { motion: boolean }) {
  const P: [number, number][] = [
    [30, 112],
    [78, 92],
    [110, 52],
    [166, 70],
    [206, 28],
  ];
  return (
    <Svg label="Desde la base, la furgoneta va al cliente más cercano, y desde ahí al siguiente más cercano, hasta volver.">
      {P.slice(0, -1).map(([x, y], i) => {
        const s = 0.08 + i * 0.16;
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="22" fill="none" stroke={AMBER} strokeWidth="1.5" opacity="0">
              {motion && anim("r", [[0, 4], [s - 0.06, 4], [s + 0.05, 24], [1, 24]])}
              {motion && anim("opacity", [[0, 0], [s - 0.06, 0.9], [s + 0.05, 0], [1, 0]])}
            </circle>
            <line x1={x} y1={y} x2={P[i + 1][0]} y2={P[i + 1][1]} stroke={C1} strokeWidth="3" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset="0">
              {motion && anim("stroke-dashoffset", [[0, 1], [s, 1], [s + 0.12, 0], [0.92, 0], [1, 1]])}
            </line>
          </g>
        );
      })}
      <line x1={P[4][0]} y1={P[4][1]} x2={P[0][0]} y2={P[0][1]} stroke={C1} strokeWidth="2" strokeDasharray="4 5" opacity="0.5">
        {motion && anim("opacity", [[0, 0], [0.72, 0], [0.8, 0.5], [0.92, 0.5], [1, 0]])}
      </line>
      <rect x={P[0][0] - 9} y={P[0][1] - 9} width="18" height="18" rx="4" fill="#1a1203" stroke={AMBER} strokeWidth="2" />
      {P.slice(1).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="7" fill={C1} stroke={C1} strokeWidth="2">
          {motion && anim("fill", [[0, NODE], [0.2 + i * 0.16, NODE], [0.22 + i * 0.16, C1], [0.92, C1], [1, NODE]])}
        </circle>
      ))}
      <text x="120" y="134" textAnchor="middle" style={LABEL}>
        Siempre al más cercano
      </text>
    </Svg>
  );
}

/** Colonia de hormigas: muchas hormigas, y el atajo bueno acumula rastro. */
function Ants({ motion }: { motion: boolean }) {
  const id = useId().replace(/[^\w-]/g, "");
  const paths = {
    top: "M30 104 C60 18 150 6 210 40",
    mid: "M30 104 C90 84 150 62 210 40",
    low: "M30 104 C90 150 196 132 210 40",
  };
  const ants: [keyof typeof paths, number][] = [
    ["top", 0],
    ["top", -1.1],
    ["low", -0.4],
    ["low", -1.5],
    ["mid", 0],
    ["mid", -0.55],
    ["mid", -1.1],
    ["mid", -1.65],
  ];
  return (
    <Svg label="Muchas hormigas prueban caminos; el más corto acumula más rastro y atrae a las siguientes.">
      {(Object.keys(paths) as (keyof typeof paths)[]).map((k) => (
        <path
          key={k}
          id={`${id}-${k}`}
          d={paths[k]}
          fill="none"
          stroke={k === "mid" ? AMBER : MUTED}
          strokeWidth={k === "mid" ? 6 : 1.5}
          strokeLinecap="round"
          opacity={k === "mid" ? 0.9 : 0.6}
          style={k === "mid" ? { filter: `drop-shadow(0 0 6px ${AMBER})` } : undefined}
        >
          {motion && k === "mid" && anim("stroke-width", [[0, 1.5], [0.65, 6], [0.9, 6], [1, 1.5]])}
          {motion && k !== "mid" && anim("opacity", [[0, 0.6], [0.65, 0.25], [0.9, 0.25], [1, 0.6]])}
        </path>
      ))}
      {motion &&
        ants.map(([k, begin], i) => (
          <circle key={i} r="3" fill="var(--amber-2)">
            <animateMotion dur="2.2s" begin={`${begin}s`} repeatCount="indefinite">
              <mpath href={`#${id}-${k}`} />
            </animateMotion>
          </circle>
        ))}
      <rect x="21" y="95" width="18" height="18" rx="4" fill="#1a1203" stroke={AMBER} strokeWidth="2" />
      <circle cx="210" cy="40" r="8" fill={NODE} stroke={C1} strokeWidth="2.5" />
      <text x="120" y="134" textAnchor="middle" style={LABEL}>
        El atajo deja más rastro
      </text>
    </Svg>
  );
}

/** Algoritmo genético: dos planes se cruzan y el hijo hereda una mitad de cada uno. */
function Genetic({ motion }: { motion: boolean }) {
  const A = [C1, C1, C2, C2, C3, C3];
  const B = [C3, C2, C1, C1, C2, C3];
  const child = [...A.slice(0, 3), ...B.slice(3)];
  const x = (i: number) => 76 + i * 26;
  const rows = { a: 14, b: 44, child: 96 };
  return (
    <Svg label="Dos planes buenos se cruzan: el hijo toma una mitad de cada uno y a veces cambia algo al azar.">
      <text x="10" y={rows.a + 14} style={LABEL}>
        Plan A
      </text>
      <text x="10" y={rows.b + 14} style={LABEL}>
        Plan B
      </text>
      <text x="10" y={rows.child + 14} style={{ ...LABEL, fill: AMBER }}>
        Hijo
      </text>
      {A.map((c, i) => (
        <rect key={`a${i}`} x={x(i)} y={rows.a} width="23" height="20" rx="4" fill={c} opacity={i < 3 ? 1 : 0.3} />
      ))}
      {B.map((c, i) => (
        <rect key={`b${i}`} x={x(i)} y={rows.b} width="23" height="20" rx="4" fill={c} opacity={i >= 3 ? 1 : 0.3} />
      ))}
      <line x1={x(3) - 2} y1="6" x2={x(3) - 2} y2="74" stroke={AMBER} strokeWidth="2" strokeDasharray="4 4">
        {motion && anim("opacity", [[0, 0], [0.12, 1], [0.92, 1], [1, 0]])}
      </line>
      {child.map((c, i) => {
        const from = (i < 3 ? rows.a : rows.b) - rows.child;
        const s = 0.22 + i * 0.07;
        const mutated = i === 4;
        return (
          <rect key={`h${i}`} x={x(i)} y={rows.child} width="23" height="20" rx="4" fill={mutated ? AMBER : c} style={{ filter: "drop-shadow(0 0 5px rgb(0 0 0 / 0.6))" }}>
            {motion && (
              <animateTransform
                attributeName="transform"
                type="translate"
                values={`0 ${from};0 ${from};0 0;0 0`}
                keyTimes={`0;${s};${s + 0.14};1`}
                dur="6s"
                repeatCount="indefinite"
              />
            )}
            {motion && anim("opacity", [[0, 0], [s, 0], [s + 0.04, 1], [0.92, 1], [1, 0]])}
            {motion && mutated && anim("fill", [[0, c], [0.74, c], [0.78, AMBER], [1, AMBER]])}
          </rect>
        );
      })}
      <text x={x(4) + 11} y="132" textAnchor="middle" style={{ ...LABEL, fill: AMBER }}>
        Mutación
      </text>
    </Svg>
  );
}

/** Búsqueda tabú: deshace un cruce con un cambio pequeño y prohíbe volver atrás. */
function Tabu({ motion }: { motion: boolean }) {
  const base: [number, number] = [22, 68];
  const TL: [number, number] = [64, 26];
  const TR: [number, number] = [134, 26];
  const BR: [number, number] = [134, 108];
  const BL: [number, number] = [64, 108];
  const seg = (a: [number, number], b: [number, number]) => ({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
  return (
    <Svg label="Un cambio pequeño deshace el cruce de la ruta; el movimiento contrario queda prohibido un tiempo.">
      {[seg(base, TL), seg(TR, BR), seg(BL, base)].map((s, i) => (
        <line key={i} {...s} stroke={C1} strokeWidth="3" strokeLinecap="round" />
      ))}
      {/* antes: los dos tramos que se cruzan */}
      {[seg(TL, BR), seg(TR, BL)].map((s, i) => (
        <line key={`x${i}`} {...s} stroke="var(--late)" strokeWidth="2.5" strokeDasharray="5 5" opacity="0.3">
          {motion && anim("opacity", [[0, 1], [0.35, 1], [0.5, 0.3], [0.92, 0.3], [1, 1]])}
        </line>
      ))}
      {/* después: sin cruce */}
      {[seg(TL, TR), seg(BR, BL)].map((s, i) => (
        <line key={`n${i}`} {...s} stroke={C1} strokeWidth="3" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset="0">
          {motion && anim("stroke-dashoffset", [[0, 1], [0.48, 1], [0.66, 0], [0.92, 0], [1, 1]])}
        </line>
      ))}
      <rect x={base[0] - 9} y={base[1] - 9} width="18" height="18" rx="4" fill="#1a1203" stroke={AMBER} strokeWidth="2" />
      {[TL, TR, BR, BL].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="7" fill={NODE} stroke={C1} strokeWidth="2.5" />
      ))}
      <g>
        {motion && anim("opacity", [[0, 0], [0.66, 0], [0.74, 1], [0.92, 1], [1, 0]])}
        <rect x="156" y="44" width="76" height="46" rx="8" fill="#1f0d10" stroke="var(--late)" strokeWidth="1.5" />
        <path d="M168 66v-4a5 5 0 0 1 10 0v4" fill="none" stroke="var(--late)" strokeWidth="2" />
        <rect x="165" y="66" width="16" height="12" rx="2" fill="var(--late)" />
        <text x="208" y="72" textAnchor="middle" style={{ ...LABEL, fill: "var(--late)" }}>
          Tabú
        </text>
      </g>
      <text x="120" y="134" textAnchor="middle" style={LABEL}>
        Sin volver atrás
      </text>
    </Svg>
  );
}

/** LLM directo: lee el problema y escribe el plan de una sola vez. */
export function DirectIdea({ motion }: { motion: boolean }) {
  const lines = [70, 92, 56, 84, 64];
  return (
    <Svg label="El modelo lee el problema y escribe el plan entero de una vez, sin calcular aparte.">
      <rect x="14" y="12" width="118" height="104" rx="10" fill="#0c1729" stroke="var(--line-2)" strokeWidth="1.5" />
      {lines.map((w, i) => (
        <rect key={i} x="28" y={28 + i * 16} width={w} height="7" rx="3.5" fill={i === 4 ? AMBER : "rgb(185 197 216 / 0.55)"}>
          {motion && anim("width", [[0, 0], [0.08 + i * 0.1, 0], [0.16 + i * 0.1, w], [0.92, w], [1, 0]])}
        </rect>
      ))}
      <path d="M142 64h20m-7-7 7 7-7 7" fill="none" stroke={AMBER} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <g>
        {motion && anim("opacity", [[0, 0], [0.62, 0], [0.7, 1], [0.92, 1], [1, 0]])}
        <path d="M178 96 L196 40 L226 70 Z" fill="none" stroke={C2} strokeWidth="2.5" strokeLinejoin="round" />
        <rect x="170" y="88" width="16" height="16" rx="4" fill="#1a1203" stroke={AMBER} strokeWidth="2" />
        <circle cx="196" cy="40" r="6" fill={NODE} stroke={C2} strokeWidth="2.5" />
        <circle cx="226" cy="70" r="6" fill={NODE} stroke={C2} strokeWidth="2.5" />
      </g>
      <text x="120" y="134" textAnchor="middle" style={LABEL}>
        Todo de una vez
      </text>
    </Svg>
  );
}

/** Agente: lanza herramientas (métodos y evaluador), mira el resultado y decide. */
export function AgentIdea({ motion }: { motion: boolean }) {
  const id = useId().replace(/[^\w-]/g, "");
  const loop = "M92 62 C104 16 144 16 156 62 C144 108 104 108 92 62 Z";
  return (
    <Svg label="El modelo lanza los métodos y el evaluador como herramientas, mira el resultado y vuelve a probar antes de entregar.">
      <path id={`${id}-loop`} d={loop} fill="none" stroke="rgb(255 181 71 / 0.45)" strokeWidth="2" strokeDasharray="4 5" />
      {motion &&
        [0, -1.2].map((begin) => (
          <circle key={begin} r="4.5" fill={AMBER} style={{ filter: `drop-shadow(0 0 5px ${AMBER})` }}>
            <animateMotion dur="2.4s" begin={`${begin}s`} repeatCount="indefinite">
              <mpath href={`#${id}-loop`} />
            </animateMotion>
          </circle>
        ))}
      <rect x="8" y="40" width="84" height="44" rx="10" fill="#0c1729" stroke={C3} strokeWidth="2" />
      <text x="50" y="67" textAnchor="middle" style={{ ...LABEL, fill: "var(--fg)" }}>
        Modelo
      </text>
      <rect x="156" y="40" width="78" height="44" rx="10" fill="#0c1729" stroke={C1} strokeWidth="2" />
      <text x="195" y="60" textAnchor="middle" style={{ ...LABEL, fill: "var(--fg)" }}>
        Métodos
      </text>
      <text x="195" y="76" textAnchor="middle" style={{ ...LABEL, fill: "var(--fg)" }}>
        Evaluar
      </text>
      <text x="124" y="16" textAnchor="middle" style={LABEL}>
        Lanza
      </text>
      <text x="124" y="118" textAnchor="middle" style={LABEL}>
        Mira
      </text>
      <text x="120" y="136" textAnchor="middle" style={LABEL}>
        Prueba y corrige
      </text>
    </Svg>
  );
}

export const METHOD_IDEAS: Record<string, (props: { motion: boolean }) => ReactNode> = {
  heuristic: Heuristic,
  aco: Ants,
  ga: Genetic,
  tabu: Tabu,
};
