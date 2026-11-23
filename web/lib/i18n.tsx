"use client";

import { useEffect, useSyncExternalStore } from "react";

/** Idiomas de la web. El servidor pinta siempre español; el inglés se aplica al hidratar. */
export type Lang = "es" | "en";
/** Un texto en los dos idiomas. */
export type Pair = { es: string; en: string };

export const LANG_KEY = "vrptw-lang";
const LANG_EVENT = "langchange";

/** Se ejecuta al principio de `<body>`, antes del primer pintado (app/layout.tsx): `?lang=` > `localStorage` > español. */
export const LANG_INIT_SCRIPT = `(function(){var d=document.documentElement,l="es";try{var q=new URLSearchParams(location.search).get("lang");if(q==="es"||q==="en")l=q;else{var s=localStorage.getItem("${LANG_KEY}");if(s==="es"||s==="en")l=s}}catch(e){}d.lang=l;d.dataset.lang=l;if(l==="en"){d.classList.add("i18n-pending");setTimeout(function(){d.classList.remove("i18n-pending")},1500)}})()`;

/** Idioma activo ahora mismo, leído del documento (para código que corre al evento, no al pintar). */
export function currentLang(): Lang {
  return typeof document !== "undefined" && document.documentElement.dataset.lang === "en" ? "en" : "es";
}

function subscribe(onChange: () => void) {
  document.addEventListener(LANG_EVENT, onChange);
  return () => document.removeEventListener(LANG_EVENT, onChange);
}

/** Elige el idioma: lo fija en el documento, lo recuerda y avisa a los componentes. */
export function setLang(lang: Lang): void {
  const root = document.documentElement;
  root.lang = lang;
  root.dataset.lang = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Modo privado o almacenamiento bloqueado: el idioma vale solo para esta visita.
  }
  // Con `?lang=` en la URL ese parámetro manda al recargar: se actualiza para que no contradiga la elección.
  const url = new URL(location.href);
  if (url.searchParams.has("lang")) {
    url.searchParams.set("lang", lang);
    history.replaceState(history.state, "", url);
  }
  document.dispatchEvent(new Event(LANG_EVENT));
}

/** Idioma activo y su selector. Re-pinta al cambiar. */
export function useLang(): [Lang, (lang: Lang) => void] {
  const lang = useSyncExternalStore(subscribe, currentLang, () => "es" as const);
  return [lang, setLang];
}

/** `t({ es, en })` devuelve el texto del idioma activo. Llamarla al pintar, nunca al cargar un módulo. */
export function useT(): (pair: Pair) => string {
  const [lang] = useLang();
  return (pair) => pair[lang];
}

/** Texto en los dos idiomas; pinta solo el activo. Sirve dentro de componentes de servidor. */
export function T({ es, en }: Pair) {
  const t = useT();
  return <>{t({ es, en })}</>;
}

/** Título y descripción del idioma activo (la `metadata` de Next es estática y queda en español). */
export function DocMeta({ es, en }: { es: { title: string; description?: string }; en: { title: string; description?: string } }) {
  const [lang] = useLang();
  const meta = lang === "en" ? en : es;
  useEffect(() => {
    document.title = meta.title;
    if (meta.description === undefined) return;
    let tag = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!tag) {
      tag = document.createElement("meta");
      tag.name = "description";
      document.head.appendChild(tag);
    }
    tag.content = meta.description;
  }, [meta.title, meta.description]);
  return null;
}
