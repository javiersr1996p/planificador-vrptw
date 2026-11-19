import type { NextConfig } from "next";

// Sin esta variable, `lib/api.ts` llama a 127.0.0.1:8000, es decir, al equipo del
// visitante (con su clave en X-LLM-Key). En Vercel el build falla antes que publicar eso.
if (process.env.VERCEL && !process.env.NEXT_PUBLIC_API_URL) {
  throw new Error("Falta NEXT_PUBLIC_API_URL: la URL pública del servicio Python.");
}

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
