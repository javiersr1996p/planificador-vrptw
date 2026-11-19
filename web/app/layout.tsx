import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Instrument_Sans, Martian_Mono } from "next/font/google";
import { Header } from "@/components/layout/Header";
import "./globals.css";

// Big Shoulders con su eje de tamaño óptico: globals.css fija opsz 72, el corte "Display".
// Next no tiene sus métricas para ajustar una fuente de reserva: sin ajuste y con la reserva a mano
// (sin `fallback`, Turbopack busca esas métricas igualmente y avisa al compilar).
const display = Big_Shoulders({
  variable: "--ff-display",
  subsets: ["latin"],
  axes: ["opsz"],
  adjustFontFallback: false,
  fallback: ["Arial Narrow", "sans-serif"],
});
const body = Instrument_Sans({ variable: "--ff-body", subsets: ["latin"] });
const mono = Martian_Mono({ variable: "--ff-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Planificador VRPTW: rutas de reparto con métodos clásicos y LLM",
  description:
    "Compara heurística, colonia de hormigas, algoritmo genético, búsqueda tabú y modelos de lenguaje en problemas de rutas con ventanas horarias.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#04070d",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable} ${mono.variable} antialiased`}>
      <body>
        <div className="shell">
          <Header />
          {children}
        </div>
      </body>
    </html>
  );
}
