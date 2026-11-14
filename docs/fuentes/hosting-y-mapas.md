# Hosting y servicios de mapas gratuitos: fuentes verificadas

Fecha de consulta de todas las filas: 2026-11-14. Cada dato procede de la página oficial indicada en la fila, abierta en esta sesión. Lo que no se pudo verificar figura como "PENDIENTE DE CONFIRMAR". Las cifras marcadas "(cálculo propio)" se derivan de fórmulas oficiales y no aparecen literalmente en ninguna página.

Requisitos del caso: FastAPI con numpy, hasta 100 clientes, peticiones de segundos a un par de minutos, matriz hasta 101 x 101 (10 201 celdas), app pública sin cuentas, tráfico bajo.

## Avisos de políticas desfavorables al uso desde una app pública

| Servicio | Aviso | Fuente |
|---|---|---|
| Vercel Hobby | "You shall only use the Services under a Hobby plan for your personal or non-commercial use." Un portfolio personal encaja; cualquier uso comercial no. | https://vercel.com/legal/terms |
| Nominatim público | Prohíbe implementar autocompletado en el cliente; las peticiones periódicas desde apps se consideran geocodificación masiva y están "strongly discouraged"; las apps deben poder cambiar de servicio a petición de OSMF; uso por usuarios finales solo "provided that your number of users is moderate". | https://operations.osmfoundation.org/policies/nominatim/ |
| Servidor demo OSRM | Restringido a "reasonable, non-commercial use-cases", sin garantías de disponibilidad, latencia ni datos. | https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server |
| OpenRouteService (API alojada) | "an API key must not be used client-side in an application": la clave solo puede ir en el backend. Una clave pertenece a una persona. | https://giscience.github.io/openrouteservice/frequently-asked-questions |
| Teselas de tile.openstreetmap.org | Permitidas con condiciones (atribución, User-Agent propio, Referer, caché), pero sin SLA y pueden bloquear "without notice". Prohibido el uso offline y la descarga anticipada. | https://operations.osmfoundation.org/policies/tiles/ |
| Photon público (photon.komoot.io) | Uso permitido mientras las peticiones sean "reasonable"; el uso extensivo se limita o se prohíbe; sin garantías. | https://github.com/komoot/photon |
| Hugging Face Spaces | Los Spaces Docker y Gradio requieren plan de pago para crearlos; no sirve como opción gratuita para FastAPI. | https://huggingface.co/docs/hub/spaces-overview |

## 1. Hosting gratuito del servicio FastAPI

| Opción | Plan gratis sin tarjeta | Memoria y CPU | Tiempo máx. por petición | Reposo y arranque en frío | Cuota mensual | Despliegue | Restricciones | URL (consulta 2026-11-14) |
|---|---|---|---|---|---|---|---|---|
| Render, web service Free | PENDIENTE DE CONFIRMAR (la página no exige método de pago para crear el servicio; solo lo menciona para excesos de ancho de banda) | PENDIENTE DE CONFIRMAR (la página no da RAM ni CPU del plan Free) | "Render web services allow HTTP responses to take up to 100 minutes" (página de comparativa de Render, no de la página Free; PENDIENTE DE CONFIRMAR en la página de límites) | Se detiene tras 15 min sin tráfico entrante; reactivar tarda "about one minute" | 750 instance hours por workspace y mes; sin ellas, suspensión hasta el mes siguiente | Repo Git enlazado, URL de repo público o imagen Docker | Una sola instancia; sin discos persistentes; sistema de ficheros efímero; puertos SMTP salientes bloqueados; puede reiniciar o suspender el servicio en cualquier momento | https://render.com/docs/free ; https://render.com/docs/web-services ; https://render.com/docs/render-vs-vercel-comparison |
| FastAPI como funciones Python en Vercel (Hobby) | Hobby es gratuito; si pide tarjeta: PENDIENTE DE CONFIRMAR | 2 GB y 1 vCPU (fijo en Hobby) | 300 s por defecto y máximo en Hobby (con Fluid compute). La comparativa de Render dice "Up to 1 minute" en Hobby, discrepa y es anterior; se toma la página de límites de Vercel (actualizada 2026-08-24) | Funciones serverless; arranque en frío: PENDIENTE DE CONFIRMAR (no se midió ni aparece cifra) | 4 CPU-hrs de Active CPU, 360 GB-hrs de memoria aprovisionada y 1 000 000 de invocaciones al mes. Con 4 CPU-hrs, peticiones CPU-bound de 2 min dan unas 120 ejecuciones al mes (cálculo propio) | Desde repo Git; detecta FastAPI con `app` en `app.py`, `index.py`, `main.py`, etc.; sin Dockerfile | Bundle máx. 500 MB sin comprimir en Python; cuerpo de petición o respuesta máx. 4.5 MB; Python 3.12 (por defecto), 3.13, 3.14; superar los límites Hobby obliga a esperar 30 días | https://vercel.com/docs/functions/limitations ; https://vercel.com/docs/functions/runtimes/python ; https://vercel.com/docs/plans/hobby |
| Google Cloud Run | No: "A Google Cloud billing account is required"; con prueba gratuita se exige método de pago | 512 MiB por defecto, configurable hasta 32 GiB; CPU por defecto no indicada: PENDIENTE DE CONFIRMAR | Por defecto 300 s, ampliable a 3 600 s | Con instancias mínimas a 0 se eliminan las inactivas; arranque lento al escalar desde cero (sin cifra oficial: PENDIENTE DE CONFIRMAR) | Capa gratuita: 2 millones de peticiones, 360 000 GB-s y 180 000 vCPU-s, 1 GB de salida (Norteamérica) al mes | Desde código fuente con buildpacks sin Dockerfile, o contenedor | Cuota por cuenta de facturación | https://docs.cloud.google.com/free/docs/free-cloud-features ; https://docs.cloud.google.com/run/docs/configuring/request-timeout ; https://docs.cloud.google.com/run/docs/deploying-source-code ; https://docs.cloud.google.com/run/docs/configuring/services/memory-limits ; https://docs.cloud.google.com/run/docs/configuring/min-instances |
| Koyeb | No: exige tarjeta ("We require a credit card to prevent fraud and abuse"), con retención de 29 USD que se cancela | 512 MB de RAM y 0,1 vCPU, 2 GB de SSD | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR (la página no dice si el servicio gratuito escala a cero) | Un servicio web gratuito por organización | PENDIENTE DE CONFIRMAR | Regiones Fráncfort o Washington; 0,1 vCPU es insuficiente para el solver | https://www.koyeb.com/docs/faqs/pricing |
| Fly.io | No hay plan gratuito para organizaciones nuevas; crédito de prueba de 1 USD durante 7 días; tarjeta obligatoria después | Máquina más barata: shared-cpu-1x 256 MB a 2,19 USD por 30 días | No aplica | No aplica | Se condona la factura mensual inferior a 5 USD (cuentas personales) | No aplica | No es gratuito de forma sostenida | https://docs.fly.io/about/pricing |
| Hugging Face Spaces (CPU Basic) | No: los Spaces Docker y Gradio exigen plan de pago para crearse | 2 vCPU y 16 GB | PENDIENTE DE CONFIRMAR | Se duerme por inactividad en hardware gratuito | Sin cuota horaria publicada para CPU Basic | Repo Git | Descartado por el requisito de plan de pago | https://huggingface.co/docs/hub/spaces-overview |

Recomendación (hosting): **Render Free** como primera opción, porque desacopla el backend del frontend y admite peticiones largas, a falta de confirmar si pide tarjeta y cuánta CPU da; **Vercel Python** como alternativa de despliegue único si todas las peticiones caben en 300 s y el presupuesto de 4 CPU-hrs mensuales basta para la demo. Cloud Run es técnicamente el más cómodo (3 600 s, buildpacks) pero exige tarjeta. Descartados: Fly.io, Koyeb y Hugging Face.

## 2. Plan gratuito de Vercel para la interfaz Next.js

| Aspecto | Dato oficial | URL (consulta 2026-11-14) |
|---|---|---|
| Precio y ciclo | Hobby es gratuito; sin ciclos de facturación; al excederse hay que esperar 30 días | https://vercel.com/docs/plans/hobby |
| Transferencia | 100 GB de Fast Data Transfer, 10 GB de Fast Origin Transfer, 1 000 000 de peticiones CDN al mes | https://vercel.com/docs/plans/hobby |
| Funciones | 1 000 000 de invocaciones, 4 CPU-hrs, 360 GB-hrs al mes | https://vercel.com/docs/plans/hobby |
| Proyectos y despliegues | 200 proyectos; 100 despliegues al día; 50 dominios por proyecto | https://vercel.com/docs/plans/hobby |
| Uso permitido | "You shall only use the Services under a Hobby plan for your personal or non-commercial use." | https://vercel.com/legal/terms |
| Uso justo | Eludir o usar mal los límites es una violación de las directrices de uso justo | https://vercel.com/docs/limits/fair-use-guidelines |

Recomendación (frontend): **Vercel Hobby**, porque una demo de portfolio personal sin monetización cumple la condición de uso personal o no comercial y los topes sobran para tráfico bajo. La interpretación de que un portfolio es "personal" es mía; la cláusula no lo define.

## 3. Geocodificación sobre datos de OpenStreetMap

| Servicio | Límite de peticiones | Caché | Identificación | Usos prohibidos o desaconsejados | Nivel gratuito | URL (consulta 2026-11-14) |
|---|---|---|---|---|---|---|
| Nominatim público (OSMF) | Máximo absoluto de 1 petición por segundo; scripts de más de un día o periódicos, 4 por minuto | "Results must be cached on your side." | HTTP Referer o User-Agent válido que identifique la aplicación | Autocompletado (no debe implementarse en cliente); consultas sistemáticas; scraping de la página de detalles; reventa; las peticiones periódicas de apps se consideran masivas y se desaconsejan | Gratuito, sin clave; "heavy use" sin definir | https://operations.osmfoundation.org/policies/nominatim/ |
| Geoapify Geocoding | Hasta 30 peticiones por segundo según plan (página de geocodificación); la página de precios dice "Up to 5 requests/second" en Free (las dos páginas discrepan para Free: PENDIENTE DE CONFIRMAR) | Se pueden almacenar resultados "without restrictions or additional costs", conservando las atribuciones de la fuente | Clave de API | No se encontró prohibición específica en las páginas leídas | 3 000 créditos al día; 1 crédito por petición de geocodificación; sin tarjeta; uso comercial permitido; exige enlace a Geoapify y atribución de datos | https://www.geoapify.com/pricing/ ; https://www.geoapify.com/geocoding-api/ |
| Photon (demo de komoot) | Sin cifra: "reasonable limit"; uso extensivo limitado o prohibido | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR | Sin garantías de disponibilidad; para volumen alto, instancia propia | Gratuito, sin clave; licencia Apache 2.0 | https://github.com/komoot/photon |
| LocationIQ | 2 peticiones por segundo y 60 por minuto en Free | PENDIENTE DE CONFIRMAR | Clave de API | PENDIENTE DE CONFIRMAR | 5 000 peticiones al día; sin tarjeta; en proyectos comerciales exige enlace visible a LocationIQ | https://locationiq.com/pricing |

Recomendación (geocodificación): **Geoapify**, porque tiene cuota diaria documentada (3 000 créditos, 100 clientes caben de sobra) y permite almacenar resultados; **Nominatim** como respaldo, llamado solo desde el backend con User-Agent propio, caché y 1 petición por segundo (100 direcciones tardan unos 100 s, cálculo propio). Nunca desde el navegador ni como autocompletado.

## 4. Matriz de distancias y tiempos por carretera

| Servicio | Tamaño máximo por petición | Cuota | Condiciones | ¿101 x 101 en una petición? | URL (consulta 2026-11-14) |
|---|---|---|---|---|---|
| Servidor demo OSRM (router.project-osrm.org) | La página del demo no indica límite de tabla: PENDIENTE DE CONFIRMAR. En un OSRM propio el valor por defecto es "unlimited" | 1 petición por segundo ("Do not exceed 1 request per second") | Solo uso razonable y no comercial; perfiles de coche, a pie y bicicleta; sin garantías | PENDIENTE DE CONFIRMAR (el límite del demo no figura en página oficial) | https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server ; https://github.com/Project-OSRM/osrm-backend/blob/master/docs/nodejs/api.md |
| OpenRouteService, API alojada (Standard) | 3 500 localizaciones origen x destino por petición (ej. 50 x 50); con argumentos dinámicos, 25 | Directions: 2 000 al día y 40 por minuto. Cuota diaria y por minuto de Matrix: PENDIENTE DE CONFIRMAR (la página de planes no se pudo leer) | Clave de API gratuita; la clave no puede usarse en el cliente; una clave por persona | No: 10 201 celdas superan las 3 500. Con bloques de hasta 59 x 59 bastan 4 peticiones (cálculo propio) | https://giscience.github.io/openrouteservice/hosted-api-restrictions ; https://giscience.github.io/openrouteservice/frequently-asked-questions ; https://account.heigit.org/info/plans |
| Geoapify Route Matrix | 1 000 celdas (sources x targets) según la referencia de la API; la sección de precios habla de 1 000 localizaciones y no resuelve la discrepancia | 3 000 créditos al día; coste = max(orígenes, destinos) x min(orígenes, destinos, 10) | Clave de API; atribución | No: 10 201 celdas superan 1 000. Una matriz de 101 x 101 costaría 1 010 créditos si fuese una sola llamada, y troceada en 11 bloques de 10 x 101 sumaría unos 11 000, más de la cuota diaria (cálculo propio) | https://apidocs.geoapify.com/docs/route-matrix/ ; https://www.geoapify.com/pricing/ |

Ningún servicio gratuito verificado admite 101 x 101 en una sola petición.

Recomendación (matriz): **OpenRouteService** troceando en 4 peticiones desde el backend, porque su límite de 3 500 celdas está documentado y la clave se queda en el servidor; confirmar antes la cuota diaria de Matrix en la página de planes. **OSRM demo** solo como respaldo de desarrollo: no es comercial, sin garantías y con límite de tabla sin documentar. Si ninguna cuota alcanza, la alternativa es un OSRM propio (límite por defecto ilimitado), cuyo coste de alojamiento no se ha evaluado aquí.

## 5. Teselas y biblioteca de mapas para React

### Teselas

| Servicio | Política de uso | Clave o límites | Atribución obligatoria | URL (consulta 2026-11-14) |
|---|---|---|---|---|
| tile.openstreetmap.org (OSMF) | Permitido con User-Agent propio (no el de la librería ni el de un navegador suplantado), Referer válido, sin cabeceras no-cache, caché mínima de 7 días si no se respetan las cabeceras; prohibidos el uso offline y la descarga anticipada; sin SLA, puede bloquear sin aviso | Sin clave; sin cuota numérica publicada | Mostrar la atribución de licencia de OpenStreetMap de forma clara, normalmente abajo a la derecha, sin ocultarla | https://operations.osmfoundation.org/policies/tiles/ |
| OpenFreeMap | Gratuito, sin registro, sin claves ni cookies; "no limits on the number of map views or requests"; uso comercial permitido | Sin claves; descargas offline de máximo 3 000 teselas o 50 MB | MapLibre la añade automáticamente. Texto: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (la parte de OpenFreeMap es opcional) | https://openfreemap.org/ ; https://openfreemap.org/quick_start/ |

Texto de atribución de OpenStreetMap: debe citar "OpenStreetMap", y siguen siendo válidas las formas "© OpenStreetMap contributors" y "© OpenStreetMap"; ha de enlazar a https://www.openstreetmap.org/copyright para dejar claro que los datos están bajo la Open Database License, en una esquina del mapa (https://osmfoundation.org/wiki/Licence/Attribution_Guidelines ; https://www.openstreetmap.org/copyright, consultas 2026-11-14).

### Bibliotecas

| Biblioteca | Datos oficiales | URL (consulta 2026-11-14) |
|---|---|---|
| MapLibre GL JS | Biblioteca TypeScript de mapas vectoriales con WebGL; licencia BSD de 3 cláusulas | https://github.com/maplibre/maplibre-gl-js ; https://maplibre.org/maplibre-gl-js/docs/ |
| react-map-gl | "a suite of React components for mapbox-gl, maplibre-gl or compatible libraries"; licencia y versiones de React: PENDIENTE DE CONFIRMAR | https://visgl.github.io/react-map-gl/docs |
| Leaflet | Unos 40 KB de JS; la portada anuncia Leaflet 2.0 beta 4; versión estable y licencia: PENDIENTE DE CONFIRMAR | https://leafletjs.com/ |
| react-leaflet | Licencia declarada en el README: "Hippocratic License", poco habitual, revisar antes de adoptar; compatibilidad con Next.js y versiones de React: PENDIENTE DE CONFIRMAR | https://github.com/PaulLeCam/react-leaflet ; https://react-leaflet.js.org/docs/start-installation/ |

Recomendación (teselas): **OpenFreeMap**, porque no tiene límites ni claves, permite el despliegue en una app pública y su atribución la gestiona MapLibre. Las teselas de OSMF quedan como respaldo, sin cumplir el requisito de no ser un servicio de mejor esfuerzo.
Recomendación (biblioteca): **MapLibre GL JS con react-map-gl**, porque tiene licencia BSD verificada y consume directamente el estilo vectorial de OpenFreeMap; antes de fijarlo, confirmar la licencia de react-map-gl y su compatibilidad con la versión de React usada.

## Pendiente de confirmar (resumen)

- Render Free: tarjeta, RAM y CPU, y el tiempo máximo de petición en la página oficial de límites (los 100 min proceden de una página comparativa de Render).
- Vercel Hobby: si exige tarjeta, y el arranque en frío de funciones Python; discrepancia 300 s (página de límites) frente a 1 min (comparativa de Render).
- Cloud Run: CPU por defecto y duración del arranque en frío.
- Koyeb: tiempo máximo, reposo y método de despliegue.
- OpenRouteService: cuotas diarias y por minuto de Matrix y Geocoding en el plan Standard (la página de planes no se pudo leer).
- OSRM demo: límite de tamaño de tabla (101 x 101).
- Geoapify: tasa real en Free (5 frente a 30 peticiones por segundo) y significado exacto del límite de 1 000.
- Photon y LocationIQ: política de caché e identificación del cliente; LocationIQ no indica si tiene API de matriz.
- react-map-gl: licencia y versiones de React; Leaflet: versión estable y licencia; react-leaflet: soporte de Next.js.
