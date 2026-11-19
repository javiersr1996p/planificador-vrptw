import type { Metadata } from "next";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/Button";
import { Kicker } from "@/components/ui/Kicker";
import { REPO_URL, TFE_CODE_COMMIT, TFE_CODE_URL, TFE_DOC_URL } from "@/lib/nav";

export const metadata: Metadata = {
  title: "Sobre el TFE: el trabajo de 2024, qué ha cambiado y sus limitaciones",
  description:
    "El Trabajo Fin de Estudios de 2024 del que parte este planificador: su código, lo que ha cambiado desde entonces, las limitaciones declaradas y los créditos.",
};

const CREDITS = [
  { name: "Javier Sánchez Rueda", role: "Autor" },
  { name: "Óscar Sánchez Rueda", role: "Autor" },
  { name: "María Teresa García Ordás", role: "Directora" },
  { name: "Hernán Díaz Rodríguez", role: "Codirector" },
];

/** Fuentes: README (Origen), docs/tfe-reimplementacion.md, docs/prompts.md y docs/fuentes/solomon.md. */
const CHANGES = [
  {
    title: "Métodos clásicos",
    then: "El tabú no se movía y la heurística a veces no sumaba la vuelta a la base.",
    now: "Corregidos; un modo legado reproduce los resultados de 2024.",
  },
  {
    title: "Coste",
    then: "Cada notebook calculaba el coste con su propia función.",
    now: "Los métodos solo dan rutas; un evaluador único calcula el coste.",
  },
  {
    title: "Referencia externa",
    then: "12 problemas propios; de Solomon, solo dos instancias y con un único LLM.",
    now: "Solomon con su mejor solución publicada, camuflado ante el LLM.",
  },
  {
    title: "IA generativa",
    then: "El LLM devolvía el plan como una tabla por vehículo.",
    now: "Dos papeles: resolver directo o agente que usa métodos y evaluador.",
  },
  {
    title: "Capacidad",
    then: "Sin capacidad: la demanda de los clientes no se usaba.",
    now: "Cuenta la demanda: un plan que supera la capacidad no es válido.",
  },
  {
    title: "Sobre el mapa",
    then: "Puntos en un plano, con distancias en línea recta.",
    now: "Casos reales: direcciones geocodificadas y distancias por carretera.",
  },
];

/** El perfil de tráfico es el de public/data/traffic-profiles.json. */
const LIMITS = [
  "Es una reimplementación, no el código de 2024: los resultados cambian.",
  "Los tiempos no se comparan con 2024: otro código, y aquel tabú no iteraba.",
  "Tráfico: perfil estático por franjas horarias, con factores ilustrativos.",
  "El agente usa el protocolo de herramientas propio de Anthropic.",
];

const VEHICLE_COLORS = ["var(--veh-1)", "var(--veh-2)", "var(--veh-3)", "var(--veh-4)"];

/** Enlace externo con aspecto de botón: abre en otra pestaña. */
function OutLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost")}>
      {children}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
      </svg>
    </a>
  );
}

/** Un dato de la ficha del trabajo: etiqueta y valor. */
function Fact({ term, className, children }: { term: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <dt className="kicker text-fg-3">{term}</dt>
      <dd className="mt-1.5 leading-snug">{children}</dd>
    </div>
  );
}

/** Un paso de la línea 2024 → ahora: punto en el carril, etiqueta y frase. */
function Step({ now, children }: { now?: boolean; children: ReactNode }) {
  return (
    <p className={`relative flex gap-3 leading-snug ${now ? "text-fg" : "text-fg-2"}`}>
      {/* Carril punteado del punto de 2024 al de ahora (8 px de hueco y 5 px de margen del punto). */}
      {!now && <span aria-hidden="true" className="absolute top-[17px] -bottom-[13px] left-[5.5px] border-l border-dashed border-fg-3/60" />}
      <span
        aria-hidden="true"
        className={`mt-[5px] size-3 flex-none rounded-full ${
          now ? "bg-amber shadow-[0_0_10px_rgb(255_181_71/0.8)]" : "border-2 border-fg-3 bg-ink-1"
        }`}
      />
      <span>
        <span className={`mr-2 font-mono text-[12px] font-semibold tracking-[0.14em] uppercase ${now ? "text-amber" : "text-fg-3"}`}>
          {now ? "Ahora" : "2024"}
        </span>
        {children}
      </span>
    </p>
  );
}

/** «Sobre el TFE»: el trabajo de 2024, qué ha cambiado, sus limitaciones y los créditos. Página estática. */
export default function AboutPage() {
  return (
    <main className="wrap flex flex-1 flex-col gap-6 pt-2 pb-8 lg:gap-8 lg:pt-3">
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-2">
        <div className="min-w-0">
          <Kicker>Sobre el TFE</Kicker>
          <h1 className="mt-2 text-[28px] font-extrabold sm:text-[clamp(30px,2.8vw,40px)]">Del TFE de 2024 a este planificador</h1>
        </div>
        <p className="max-w-[38rem] text-lg leading-snug text-fg-2">
          Continuación de un Trabajo Fin de Estudios de 2024: el original, lo que ha cambiado y sus límites.
        </p>
      </div>

      <section
        data-testid="about-work"
        aria-labelledby="about-title"
        className="panel grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-10 lg:p-8"
      >
        <div className="flex min-w-0 flex-col items-start gap-4">
          <Kicker>Trabajo Fin de Estudios</Kicker>
          <h2 id="about-title" className="-mt-1 text-[24px] font-bold text-balance lg:text-[28px]">
            «Comparativa de soluciones en problemas VRPTW empleando métodos tradicionales e Inteligencia Artificial Generativa»
          </h2>
          <dl className="grid w-full grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Fact term="Universidad" className="max-sm:col-span-2">
              Universidad Internacional de La Rioja (UNIR)
            </Fact>
            <Fact term="Titulación">Máster en Inteligencia Artificial</Fact>
            <Fact term="Fecha">
              <time dateTime="2024-09-11">11 de septiembre de 2024</time>
            </Fact>
          </dl>
          <div className="flex flex-wrap gap-2">
            <OutLink href={TFE_CODE_URL}>
              Código de 2024 <span className="font-mono text-fg-3">{TFE_CODE_COMMIT}</span>
            </OutLink>
            <OutLink href={REPO_URL}>Este repositorio</OutLink>
            {TFE_DOC_URL && <OutLink href={TFE_DOC_URL}>Documento del TFE</OutLink>}
          </div>
        </div>

        <div className="min-w-0 border-line lg:border-l lg:pl-10">
          <h3 className="kicker">Créditos</h3>
          {/* En móvil, papel y nombre en la misma fila; desde 640 px, el papel encima. */}
          <ul className="mt-4 grid gap-x-4 gap-y-2.5 sm:grid-cols-2 sm:gap-y-4 lg:grid-cols-1 xl:grid-cols-2">
            {CREDITS.map((c, i) => (
              <li
                key={c.name}
                data-testid="credit"
                className="border-l-2 pl-3 max-sm:flex max-sm:items-baseline max-sm:gap-2.5"
                style={{ borderColor: VEHICLE_COLORS[i] }}
              >
                <span data-testid="credit-role" className="kicker text-fg-3 max-sm:w-[104px] max-sm:flex-none">
                  {c.role}
                </span>
                <span className="block text-[18px] leading-snug font-semibold sm:mt-1.5">{c.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="about-changes">
        <h2 id="about-changes" className="text-[clamp(26px,2.4vw,34px)] font-extrabold">
          Qué ha cambiado desde 2024
        </h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-2 lg:gap-4 xl:grid-cols-3">
          {CHANGES.map((c, i) => (
            <li key={c.title} data-testid="about-change" className="panel">
              <h3 className="flex items-baseline gap-3 text-[22px] font-bold">
                <span aria-hidden="true" className="text-[30px] leading-none font-extrabold text-amber [text-shadow:0_0_24px_rgb(255_181_71/0.5)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {c.title}
              </h3>
              <div className="mt-3 grid gap-2">
                <Step>{c.then}</Step>
                <Step now>{c.now}</Step>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="about-limits" className="panel">
        <h2 id="about-limits" className="text-[clamp(26px,2.4vw,34px)] font-extrabold">
          Limitaciones
        </h2>
        <ul className="mt-3 grid gap-2">
          {LIMITS.map((text) => (
            <li key={text} data-testid="about-limit" className="flex gap-3">
              <svg viewBox="0 0 20 20" className="mt-[3px] size-5 flex-none text-amber" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 2.5 18.5 17h-17z" />
                <path d="M10 8v4" strokeLinecap="round" />
                <circle cx="10" cy="14.4" r="0.6" fill="currentColor" />
              </svg>
              <p className="leading-snug text-fg-2">{text}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
