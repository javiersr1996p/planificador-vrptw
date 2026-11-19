import type { ComponentPropsWithoutRef } from "react";

/** Etiqueta corta en mayúsculas, en ámbar, sobre un título. */
export function Kicker({ className, ...props }: ComponentPropsWithoutRef<"span">) {
  return <span className={["kicker", className].filter(Boolean).join(" ")} {...props} />;
}
