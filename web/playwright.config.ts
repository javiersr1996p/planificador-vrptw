import { defineConfig } from "@playwright/test";

const WEB_PORT = 3100;
const API_PORT = 8010;

// Puertos propios y servidores nuevos en cada ejecución: nunca se reutiliza un
// servicio ya arrancado (podría tener claves reales). El servicio de pruebas
// arranca sin --env-file, con las claves vacías y el proveedor de pruebas.
export default defineConfig({
  testDir: "e2e",
  // Cada trabajador abre Chromium con el mapa en WebGL por software: con la mitad de los
  // procesadores lógicos (lo habitual) la máquina se satura y una página tarda más que las
  // esperas de 5 s en cargar. Con un cuarto, los tiempos son estables.
  workers: "25%",
  // Si además corren otros servidores o navegadores, una página puede pasar de 5 s en
  // cargar: el doble de margen. Un fallo real sigue fallando, solo tarda más en verse.
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
  },
  projects: [
    {
      name: "mobile-390",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "desktop-1440",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: [
    {
      command: `uv run uvicorn vrptw.api.main:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: "../api",
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VRPTW_LLM_PROVIDER: "fake",
        VRPTW_CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
        GEOAPIFY_API_KEY: "",
        ORS_API_KEY: "",
        ANTHROPIC_API_KEY: "",
      },
    },
    {
      command: `npm run build && npm run start -- --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        NEXT_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
