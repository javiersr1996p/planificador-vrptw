"use client";

import { useEffect } from "react";
import { useLang, type Lang } from "@/lib/i18n";

const OPTIONS: { lang: Lang; label: string }[] = [
  { lang: "es", label: "ES" },
  { lang: "en", label: "EN" },
];

/** Conmutador ES | EN. También destapa la página (`i18n-pending`) en cuanto React ha hidratado. */
export function LangSwitch() {
  const [lang, setLang] = useLang();
  useEffect(() => {
    // Un turno después: deja que React termine el repintado en inglés antes de mostrar el cuerpo.
    const id = setTimeout(() => document.documentElement.classList.remove("i18n-pending"), 0);
    return () => clearTimeout(id);
  }, []);
  return (
    <div role="group" aria-label="Idioma · Language" className="flex flex-none items-center rounded-full bg-white/[0.06] ring-1 ring-line-2 ring-inset">
      {OPTIONS.map((o) => (
        <button
          key={o.lang}
          type="button"
          lang={o.lang}
          aria-pressed={lang === o.lang}
          onClick={() => setLang(o.lang)}
          className="min-h-11 min-w-11 cursor-pointer rounded-full px-2 font-mono text-[12px] uppercase font-semibold tracking-[0.12em] text-fg-2 transition-colors duration-200 hover:text-fg aria-pressed:bg-amber/12 aria-pressed:text-amber aria-pressed:ring-1 aria-pressed:ring-amber/45 aria-pressed:ring-inset"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
