import type { ComponentPropsWithoutRef } from "react";

export type ButtonVariant = "ghost" | "primary";

/** Clases de botón, también para enlaces con aspecto de botón (`<Link className={buttonClass(...)}>`). */
export function buttonClass(variant: ButtonVariant = "ghost", className?: string): string {
  return ["btn", variant === "primary" && "btn-amber", className].filter(Boolean).join(" ");
}

type ButtonProps = ComponentPropsWithoutRef<"button"> & { variant?: ButtonVariant };

/** Botón en píldora de 44 px de alto: `ghost` (por defecto) o `primary` (ámbar). */
export function Button({ variant = "ghost", className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}
