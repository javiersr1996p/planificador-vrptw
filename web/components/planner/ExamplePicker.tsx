"use client";

import type { CaseSummary } from "@/lib/cases";

type Props = {
  cases: CaseSummary[] | null;
  activeId: string | null;
  pendingId: string | null;
  onPick: (id: string) => void;
};

/** Nombre corto del caso: «Madrid», «Solomon C101», «TFE 2024: problema 10c-1». */
function shortName(c: CaseSummary): string {
  const name = c.name.split(",")[0];
  return c.source === "real" ? name.split(":")[0] : name;
}

/** Chips de los ejemplos precalculados: número grande, nombre y una línea. Se desplazan en horizontal. */
export function ExamplePicker({ cases, activeId, pendingId, onPick }: Props) {
  return (
    <div data-zone className="flex min-w-0 items-center gap-3">
      <span id="cases-label" className="flex-none font-mono text-[12px] leading-none font-semibold tracking-[0.16em] text-fg-3 uppercase max-[760px]:sr-only">
        Casos
      </span>
      {!cases ? (
        <ul aria-hidden="true" className="flex min-w-0 gap-2 overflow-hidden">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="h-12 w-[220px] flex-none animate-pulse rounded-hud bg-ink-2" />
          ))}
        </ul>
      ) : (
        <ul
          aria-labelledby="cases-label"
          className="-mx-[var(--gutter)] flex min-w-0 snap-x snap-mandatory scroll-px-[var(--gutter)] gap-2 overflow-x-auto px-[var(--gutter)] py-0.5 [scrollbar-width:none] min-[761px]:mx-0 min-[761px]:px-0.5 [&::-webkit-scrollbar]:hidden"
        >
          {cases.map((c) => {
            const active = c.id === activeId;
            const pending = c.id === pendingId;
            const llm = c.methods.some((m) => m.startsWith("llm_"));
            return (
              <li key={c.id} className="flex-none snap-start">
                <button
                  type="button"
                  data-testid="example-card"
                  data-case-id={c.id}
                  aria-pressed={active}
                  aria-busy={pending || undefined}
                  onClick={() => onPick(c.id)}
                  className={`flex min-h-12 items-center gap-2.5 rounded-hud border py-1.5 pr-3.5 pl-1.5 text-left transition-[border-color,background-color] duration-200 ease-[var(--ease-out)] ${
                    active
                      ? "border-amber/65 bg-[linear-gradient(135deg,rgb(255_181_71/0.16),rgb(255_181_71/0.03))]"
                      : "border-line bg-ink-2/65 [@media(hover:hover)]:hover:border-line-2 [@media(hover:hover)]:hover:bg-ink-3/80"
                  }`}
                >
                  <span
                    className={`grid h-9 min-w-[46px] place-items-center rounded-tag px-1.5 font-mono text-[16px] leading-none font-semibold ${
                      active ? "bg-amber text-amber-ink shadow-[0_0_18px_-2px_rgb(255_181_71/0.7)]" : "bg-white/5 text-fg"
                    }`}
                  >
                    {pending ? (
                      <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      c.customers
                    )}
                  </span>
                  <span className="flex flex-col gap-[3px] leading-[1.1]">
                    <b className="text-base font-semibold whitespace-nowrap text-fg">{shortName(c)}</b>
                    <small
                      className={`font-mono text-[12px] leading-none font-medium tracking-[0.08em] whitespace-nowrap uppercase ${
                        llm && !c.has_map ? "text-veh-3" : "text-fg-3"
                      }`}
                    >
                      {c.has_map ? "paradas · mapa real" : llm ? "clientes · con IA" : "clientes"}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
