# Planificador VRPTW

Planificador de rutas con ventanas de tiempo que compara métodos clásicos y LLM. Continuación de un trabajo fin de máster de 2024.

- `api/`: backend en Python (solver, algoritmos y API).
- `web/`: frontend en Next.js.

## Origen

Los métodos clásicos (heurística, colonia de hormigas, genético y búsqueda tabú) y los 20 problemas de `api/data/tfe2024/` se han portado, con correcciones, del código original del TFE de 2024: [oscarsr96/tfm_vrptw_osr_jsr](https://github.com/oscarsr96/tfm_vrptw_osr_jsr) (commit `c3ad94c`). Las diferencias respecto a aquel código se documentan en `docs/tfe-reimplementacion.md`.

## Servicio

API HTTP: lectura de CSV, geocodificación, matriz de distancias, métodos clásicos, evaluación de rutas y dos rutas con LLM (`/solve/llm` y `/explain`). Desde `api/`:

```
uv run --env-file .env uvicorn vrptw.api.main:app
```

| Variable | Uso |
|---|---|
| `VRPTW_CORS_ORIGINS` | Orígenes permitidos, separados por comas (por defecto `http://localhost:3000`). |
| `GEOAPIFY_API_KEY` | Geocodificación (`/geocode`). Sin ella, responde 503. |
| `ORS_API_KEY` | Matriz por carretera (`/matrix`). Sin ella, con el tope diario agotado o si el servicio falla, devuelve distancias en línea recta (`source` = `haversine_fallback`). |
| `VRPTW_LLM_PROVIDER` | `anthropic` (por defecto) o `fake`: modo de pruebas, ver abajo. Se lee en cada petición. |

Rutas: `GET /health`, `GET /models`, `POST /instances/parse-csv`, `POST /geocode`, `POST /matrix`, `POST /solve/classic`, `POST /evaluate`, `POST /solve/llm`, `POST /explain`.

Rutas con LLM: la clave de Anthropic del usuario llega en la cabecera `X-LLM-Key` (sin ella o vacía, 401), se usa solo durante la petición y no se guarda ni se registra.

- `POST /solve/llm`: `{instance, model, role, recheck, seed}`, con `role` `llm_direct` o `llm_agent`, `recheck` falso por defecto y `seed` mayor o igual que 0. `model` debe ser uno de `GET /models` (si no, 422). Devuelve el `RunRecord` evaluado, sin escribirlo en disco. Las instancias de Solomon se envían al modelo camufladas (`params.camouflaged`); `messages` y `tool_calls` conservan la numeración camuflada, y `solution` y `evaluation` van en la de la instancia original. Para camuflarla, una instancia de Solomon necesita coordenadas X/Y en todos los nodos, clientes numerados de 1 a n y una matriz que sea la euclídea de sus coordenadas (truncada si `matrix.source` es `euclidean_truncated`); si no, 422. También responde 422 una instancia con coordenadas X/Y y perfil de tráfico: el tráfico solo se admite en casos sobre mapa (`/solve/classic` y `/evaluate` sí la aceptan).
- `POST /explain`: `{instance, routes, method, model}` (`method` de hasta 40 caracteres). El servidor reevalúa las rutas y pide al modelo, en una sola llamada, una explicación breve en español. Devuelve `{text, model_returned, tokens_in, tokens_out, api_cost_eur, stop_reason}`.

Errores del proveedor: clave rechazada, 401; límite de uso, 429; cualquier otro, 502. Un tiempo agotado en `/solve/llm` es un registro con `parse_status` `timeout`. Cualquier otro fallo interno responde 500 `{"detail": "error interno"}`, sin mensaje ni traza.

**Modo de pruebas.** Con `VRPTW_LLM_PROVIDER=fake` las dos rutas responden sin red y sin coste: `/solve/llm` devuelve las rutas de la heurística, sin llamar a herramientas, y `/explain` un texto fijo que dice que es una respuesta de prueba. La cabecera `X-LLM-Key` sigue siendo obligatoria (cualquier valor).

Límites: cuerpo de hasta 2 MB (más, 413; un POST sin `Content-Length` o troceado, 411); 100 clientes y 100 vehículos como máximo; CSV de hasta 100 000 caracteres; 101 direcciones o puntos por petición; `time_limit_s` hasta 60 s; 100 rutas y 200 identificadores en `/evaluate`; todos los números finitos, de valor absoluto no mayor que 1e9 y no negativos donde corresponde (pesos de `cost_profile` incluidos); `id`, `matrix.source` y unidades de hasta 100 caracteres, y nombre y direcciones de hasta 200. Un solo cálculo clásico a la vez: si hay otro en curso, `/solve/classic` responde 503 con `Retry-After: 5`. Ese semáforo no cubre `/solve/llm`: las herramientas del agente ejecutan los métodos clásicos sin pasar por él. La geocodificación funciona mejor con direcciones completas (calle, ciudad y país), porque Geoapify sesga los resultados por la ubicación del servidor.

Topes diarios de los servicios de mapas: 1000 direcciones en `/geocode` (al superarlo, 429) y 150 peticiones de `/matrix` con `ORS_API_KEY` (al superarlo, línea recta). Son un tercio de las 3000 geocodificaciones diarias del plan gratuito de Geoapify y, a hasta 3 llamadas por matriz, 450 de las 500 peticiones diarias de Matrix de openrouteservice (`docs/fuentes/hosting-y-mapas.md`). Los contadores son globales y en memoria: vuelven a 0 al cambiar la fecha UTC o al reiniciar el servicio, y cuentan también lo que resuelve la caché. No hay límite por IP; queda para la plataforma de despliegue.

Errores: el cuerpo es `{"detail": "texto"}`, salvo en 422, que es `{"detail": [{"loc", "msg"}]}` (`loc`, la ruta del campo con puntos, p. ej. `instance.customers.3.due`) o, para las filas de un CSV, `{"detail": [{"row", "msg"}]}`. Códigos: 401 (falta `X-LLM-Key` o el proveedor rechaza la clave), 411, 413, 422, 429 (tope diario o límite del proveedor), 500 (error interno, sin mensaje ni traza), 502 (fallo del proveedor del LLM) y 503 (geocodificación no disponible u otro cálculo en curso). Con un origen permitido, todas las respuestas de error, 500 incluido, llevan las cabeceras CORS. El OpenAPI declara en cada ruta los que puede devolver.
