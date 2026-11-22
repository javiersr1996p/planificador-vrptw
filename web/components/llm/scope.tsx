"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ApiError, models as fetchModels } from "@/lib/api";
import type { Pair } from "@/lib/i18n";
import type { components } from "@/lib/types";

type S = components["schemas"];

export type Role = S["SolveLlmRequest"]["role"];

export type ModelList =
  | { kind: "idle" | "loading" | "error" }
  | { kind: "ok"; models: S["ModelInfo"][] };

type LlmContextValue = {
  /** Clave del visitante tal como está en el campo. Solo vive aquí, en memoria. */
  llmKey: string;
  setLlmKey: (value: string) => void;
  /** Modelo elegido (`model_id` de `GET /models`); lo usan el panel y «Explicar». */
  model: string | null;
  setModel: (id: string) => void;
  models: ModelList;
  /** Pide `GET /models` si aún no se tiene la lista (una sola petición a la vez; tras un fallo, se puede repetir). */
  loadModels: () => Promise<void>;
  /** Campo de la clave (no controlado: su valor no pasa a un atributo del HTML). */
  keyField: RefObject<HTMLInputElement | null>;
  /** Vacía la clave del estado y del campo, y deja el foco en el campo. */
  forgetKey: () => void;
  /** Lleva el foco al campo de la clave. */
  focusKey: () => void;
};

const LlmContext = createContext<LlmContextValue | null>(null);

/**
 * Envuelve el planificador. Guarda en estado de React, y en ningún otro sitio,
 * la clave del visitante y el modelo elegido, para compartirlos entre el panel
 * «Con IA» y el botón «Explicar» del detalle. Recargar la página los borra.
 */
export function LlmScope({ children }: { children: ReactNode }) {
  const [llmKey, setLlmKey] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [models, setModels] = useState<ModelList>({ kind: "idle" });
  const keyField = useRef<HTMLInputElement | null>(null);
  const loading = useRef(false);
  const loaded = useRef(false);

  const loadModels = useCallback(async () => {
    if (loading.current || loaded.current) return;
    loading.current = true;
    setModels({ kind: "loading" });
    try {
      const res = await fetchModels();
      loaded.current = true;
      setModels({ kind: "ok", models: res.models });
      setModel((current) => current ?? res.models[0]?.model_id ?? null);
    } catch {
      setModels({ kind: "error" });
    } finally {
      loading.current = false;
    }
  }, []);

  const forgetKey = useCallback(() => {
    setLlmKey("");
    if (keyField.current) {
      keyField.current.value = "";
      keyField.current.focus();
    }
  }, []);

  const focusKey = useCallback(() => keyField.current?.focus(), []);

  const value = useMemo(
    () => ({ llmKey, setLlmKey, model, setModel, models, loadModels, keyField, forgetKey, focusKey }),
    [llmKey, model, models, loadModels, forgetKey, focusKey],
  );

  return <LlmContext.Provider value={value}>{children}</LlmContext.Provider>;
}

export function useLlm(): LlmContextValue {
  const value = useContext(LlmContext);
  if (!value) throw new Error("useLlm necesita un LlmScope");
  return value;
}

/** Aviso fijo junto al campo de la clave (dos líneas como mucho). */
export const KEY_NOTE: Pair = {
  es: "Solo viaja en tu petición; no se guarda y recargar la borra. Mejor con tope de gasto.",
  en: "It travels only with your request; it is not stored and reloading erases it. Best with a spending cap.",
};

/**
 * Una clave que se puede enviar en la cabecera: al menos 8 caracteres del
 * juego `token68` (letras, cifras y `-._~+/=`). Evita que un espacio o un
 * salto de línea pegados con la clave rompan la petición en el navegador.
 */
export function isSendableKey(key: string): boolean {
  return key.length >= 8 && /^[A-Za-z0-9._~+/=-]+$/.test(key);
}

const HIDDEN = "[clave oculta]";

/**
 * Copia de `value` sin la clave en ningún texto. El servicio nunca la devuelve;
 * si lo hiciera, no llegaría a la comparativa, al detalle ni al HTML.
 */
export function withoutKey<T>(value: T, key: string): T {
  const scrub = (v: unknown): unknown => {
    if (typeof v === "string") return v.split(key).join(HIDDEN);
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
    return v;
  };
  return scrub(value) as T;
}

/**
 * Texto de un error de `/solve/llm` o `/explain`. Siempre un texto fijo de la
 * interfaz: nunca el cuerpo ni el mensaje del servidor, que podría repetir la clave.
 */
export function llmErrorText(e: unknown): Pair {
  if (!(e instanceof ApiError)) return { es: "Algo falló. Inténtalo de nuevo.", en: "Something went wrong. Try again." };
  switch (e.kind) {
    case "auth":
      return {
        es: "Clave rechazada: Anthropic no la acepta. Revisa que esté completa y activa.",
        en: "Key rejected: Anthropic does not accept it. Check that it is complete and active.",
      };
    case "rate-limit":
      return {
        es: "Tu cuenta llegó a su límite de uso (error 429). Espera un poco o revisa el tope de gasto.",
        en: "Your account hit its usage limit (error 429). Wait a bit or check your spending cap.",
      };
    case "provider":
      return { es: "El proveedor del modelo falló (error 502). Inténtalo de nuevo.", en: "The model provider failed (error 502). Try again." };
    case "network":
      return { es: "No se pudo contactar con el servicio.", en: "Could not reach the service." };
    case "unavailable":
      return { es: "El servicio está ocupado. Inténtalo en un momento.", en: "The service is busy. Try again in a moment." };
    case "validation":
    case "csv":
      return { es: `El servicio no aceptó la petición (error ${e.status}).`, en: `The service did not accept the request (error ${e.status}).` };
    case "payload":
      return { es: "El caso es demasiado grande para el servicio.", en: "The case is too large for the service." };
    default:
      return { es: `El servicio falló (error ${e.status}). Inténtalo de nuevo.`, en: `The service failed (error ${e.status}). Try again.` };
  }
}
