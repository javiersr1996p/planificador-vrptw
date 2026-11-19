"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GLOSSARY, type GlossaryEntry, type GlossaryTerm } from "@/lib/glossary";

type HelpProps = {
  term: GlossaryTerm;
  /** Frase que depende del caso, tras la explicación del glosario. */
  note?: string;
  size?: "md" | "sm";
  className?: string;
};

/**
 * Botón "?" que abre un globo con la explicación del término, tomada de
 * `lib/glossary.ts`. Se cierra con Escape, con la "×" o pulsando fuera; con
 * Escape y con la "×" el foco vuelve al botón.
 */
export function Help({ term, note, size = "md", className }: HelpProps) {
  const entry: GlossaryEntry = GLOSSARY[term];
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const popId = `${id}-help`;
  const titleId = `${id}-title`;

  function closeAndFocus() {
    setOpen(false);
    buttonRef.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    const button = buttonRef.current;
    const pop = popRef.current;
    if (!open || !button || !pop) return;

    // Debajo del botón y centrado; encima si no cabe; siempre dentro de la ventana.
    function place() {
      const r = button!.getBoundingClientRect();
      const w = pop!.offsetWidth;
      const h = pop!.offsetHeight;
      const left = Math.min(window.innerWidth - w - 16, Math.max(16, r.left + r.width / 2 - w / 2));
      let top = r.bottom + 12;
      if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 12);
      pop!.style.left = `${left}px`;
      pop!.style.top = `${top}px`;
    }
    place();
    pop.querySelector("button")?.focus({ preventScroll: true });

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      button!.focus({ preventScroll: true });
    }
    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (!pop!.contains(target) && !button!.contains(target)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={["help", size === "sm" && "help-sm", className].filter(Boolean).join(" ")}
        aria-label={entry.ask}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        data-testid="help-button"
        data-help={term}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            id={popId}
            className="pop"
            role="dialog"
            aria-labelledby={titleId}
            data-testid="help-popover"
            data-help={term}
          >
            <button type="button" className="pop-close" aria-label="Cerrar" onClick={closeAndFocus}>
              <span aria-hidden="true">×</span>
            </button>
            <span className="kicker">¿Qué es?</span>
            <h3 id={titleId}>{entry.title}</h3>
            {entry.figure === "ventana" && <WindowFigure patternId={`help-wait${id.replace(/[^\w-]/g, "")}`} />}
            <p data-testid="help-text">{entry.text}</p>
            {note && <p data-testid="help-note">{note}</p>}
          </div>,
          document.body,
        )}
    </>
  );
}

/** La ventana horaria en una línea: antes se espera, dentro se entrega, después es retraso. */
function WindowFigure({ patternId }: { patternId: string }) {
  const label = { fontFamily: "var(--ff-body), sans-serif", fontSize: 13, fontWeight: 600 };
  return (
    <svg viewBox="0 0 330 104" aria-hidden="true">
      <defs>
        <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="6" style={{ fill: "var(--wait)" }} />
        </pattern>
      </defs>
      <rect x="104" y="30" width="126" height="34" rx="6" style={{ fill: "rgb(255 255 255 / 0.06)", stroke: "var(--fg-2)" }} strokeWidth="1.5" />
      <text x="167" y="22" textAnchor="middle" style={{ fill: "var(--fg)", fontFamily: "var(--ff-mono), monospace", fontSize: 12 }}>
        09:00 a 12:00
      </text>
      <line x1="12" y1="47" x2="318" y2="47" style={{ stroke: "rgb(185 197 216 / 0.35)" }} strokeWidth="1.5" />
      <rect x="46" y="43" width="58" height="8" fill={`url(#${patternId})`} />
      <circle cx="46" cy="47" r="8" style={{ fill: "var(--wait)" }} />
      <circle cx="150" cy="47" r="8" style={{ fill: "var(--ok)" }} />
      <rect x="230" y="43" width="44" height="8" style={{ fill: "var(--late)" }} />
      <circle cx="274" cy="47" r="8" style={{ fill: "var(--late)" }} />
      <text x="46" y="88" textAnchor="middle" style={{ ...label, fill: "var(--wait)" }}>
        antes: espera
      </text>
      <text x="150" y="88" textAnchor="middle" style={{ ...label, fill: "var(--ok)" }}>
        dentro: entrega
      </text>
      <text x="274" y="88" textAnchor="middle" style={{ ...label, fill: "var(--late)" }}>
        después: retraso
      </text>
    </svg>
  );
}
