# Modelos y precios para el benchmark (fecha de consulta: 2026-11-14)

Todos los datos proceden de páginas oficiales abiertas en esta sesión. Lo no verificado figura como "PENDIENTE DE CONFIRMAR". Precios en USD por millón de tokens (MTok). Nota: las páginas se leyeron mediante una herramienta que resume el contenido; los datos clave deberían recontrastarse antes de gastar presupuesto.

## Tipo de cambio

| Dato | Valor | URL | Fecha |
|---|---|---|---|
| USD por 1 EUR (referencia BCE) | 1,1052 | https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/eurofxref-graph-usd.en.html | 2026-11-13 (consulta 2026-11-14) |

Conversión: EUR = USD / 1,1052.

## Anthropic (sucesor de Claude 3.5 Sonnet)

| Dato | Valor | URL |
|---|---|---|
| Insignia | `claude-fable-5-2`: 8 USD entrada, 40 USD salida | https://platform.claude.com/docs/en/about-claude/models/overview |
| Intermedios | `claude-opus-5-5`: 4 / 20 USD; `claude-sonnet-5-5`: 2 / 10 USD | https://platform.claude.com/docs/en/about-claude/pricing |
| Más económico | `claude-haiku-5-5`: 0,10 / 0,50 USD (prompts hasta 100.000 tokens; por encima 0,50 / 2,50) | https://platform.claude.com/docs/en/about-claude/pricing |
| Versión fija o alias | Fijada: todo ID de la API es un snapshot fijo, incluidos los IDs sin fecha de la generación 4.6 en adelante | https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions |
| Modelo usado en la respuesta | La respuesta incluye el campo `model` (ejemplo con `claude-opus-5-5`); no hay texto que diga que devuelve un ID distinto del solicitado | https://platform.claude.com/docs/en/api/messages/create |
| Razonamiento | Pensamiento adaptativo; `usage.output_tokens` es el total facturable e incluye los tokens de razonamiento (`output_tokens_details.thinking_tokens` es solo desglose). En Sonnet 5.5 el pensamiento no se puede desactivar (`thinking.types.disabled.supported` = false) | https://platform.claude.com/docs/en/api/messages/create y https://platform.claude.com/docs/en/about-claude/models/overview |
| Ventana de contexto / salida máxima | 1M tokens / 128K tokens en los cuatro modelos actuales | https://platform.claude.com/docs/en/about-claude/models/overview |
| Prefijo de clave | `sk-ant-` (ejemplo `sk-ant-api03-...`) | https://platform.claude.com/docs/en/get-api-key |

### Los tres modelos de Claude usados en el benchmark (consulta 2026-11-14)

Páginas oficiales leídas en su versión Markdown completa (la misma URL terminada en `.md`). Precios base en USD/MTok; EUR = USD / 1,1052. Los tres IDs son instantáneas fijas, con contexto de 1M tokens y salida máxima de 128K tokens.

| Modelo | Entrada (USD / EUR) | Salida (USD / EUR) | Razonamiento | URL |
|---|---|---|---|---|
| `claude-haiku-5-5` | 0,10 / 0,0905 hasta 100.000 tokens de prompt; 0,50 / 0,4524 por encima | 0,50 / 0,4524; 2,50 / 2,2620 por encima de 100.000 | Adaptativo, activo por defecto; se puede desactivar con esfuerzo `high` o inferior. Esfuerzo por defecto `medium` | https://platform.claude.com/docs/en/models/haiku-5-5/overview |
| `claude-sonnet-5-5` | 2 / 1,8096 | 10 / 9,0481 | Adaptativo; `disabled` da error 400 (solo admite `between_tools`). Esfuerzo por defecto `high` | https://platform.claude.com/docs/en/models/sonnet-5-5/overview |
| `claude-opus-5-5` | 4 / 3,6193 | 20 / 18,0963 | Adaptativo y siempre activo; `disabled` da error 400. Esfuerzo por defecto `medium` | https://platform.claude.com/docs/en/models/opus-5-5/overview |
| Tabla de precios y tramo largo de Haiku 5.5 (el prompt cuenta todos los tokens de entrada, incluida la caché) | | | | https://platform.claude.com/docs/en/about-claude/pricing |
| Facturación del razonamiento: los tokens de razonamiento se cobran como salida aunque no se devuelva su texto, y cuentan para `max_tokens` | | | | https://platform.claude.com/docs/en/build-with-claude/thinking |

## OpenAI (sucesor de GPT-4o)

| Dato | Valor | URL |
|---|---|---|
| Insignia | `gpt-6-astra`: 10 / 50 USD; contexto 1.050.000, salida máx. 128.000 | https://developers.openai.com/api/docs/models/gpt-6-astra |
| Intermedio | `gpt-6.1-sol`: 2 / 10 USD; contexto 1.050.000, salida máx. 128.000 ("Near-Astra performance for complex work at a lower cost") | https://developers.openai.com/api/docs/models/gpt-6.1-sol |
| Más económico de la generación actual | `gpt-6-luna`: 0,10 / 0,50 USD; contexto 1.050.000, salida máx. 128.000 | https://developers.openai.com/api/docs/models/gpt-6-luna |
| Precios (otros modelos listados) | `gpt-5-nano` 0,05 / 0,40 (modelo de generación anterior); `gpt-5.5` 5 / 30 | https://developers.openai.com/api/docs/pricing |
| Recargo contexto largo | Más de 272K tokens de entrada: 2x entrada y 1,5x salida (visto en la página de gpt-6-luna) | https://developers.openai.com/api/docs/models/gpt-6-luna |
| Versión fija o alias | PENDIENTE DE CONFIRMAR: cada página lista un único snapshot (el propio ID) sin decir si es mutable | https://developers.openai.com/api/docs/models/gpt-6.1-sol |
| Modelo usado en la respuesta | PENDIENTE DE CONFIRMAR (la referencia de la API no se pudo leer completa) | https://developers.openai.com/api/docs/api-reference/responses/object |
| Razonamiento | Los tokens de razonamiento se facturan como tokens de salida y se cuentan en `output_tokens_details.reasoning_tokens` | https://developers.openai.com/api/docs/guides/reasoning |
| Prefijo de clave | `sk-proj-` solo como marcador en un ejemplo oficial del cookbook; la documentación de claves no define el formato: PENDIENTE DE CONFIRMAR | https://developers.openai.com/cookbook/examples/agents_sdk/session_memory |

## Perplexity (sucesor del modelo por defecto, Sonar)

| Dato | Valor | URL |
|---|---|---|
| Estado de Sonar | El soporte de Sonar Chat Completions terminó el 2026-09-27; se migra a la Agent API (Sonar y Sonar Pro equivalen al nivel `fast`) | https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview |
| Modelo comparable | `perplexity/sonar` ("grounded search model"): 0,25 entrada, 2,50 salida, 0,0625 lectura de caché | https://docs.perplexity.ai/docs/getting-started/models |
| Otros modelos propios en la misma lista | `perplexity/glm-5.3` 1,40 / 4,40; `perplexity/glm-5.3-flash` 0,15 / 0,50; `perplexity/nemotron-3.5-super-120b-a12b` 0,20 / 0,50 | https://docs.perplexity.ai/docs/getting-started/models |
| Insignia / más económico | PENDIENTE DE CONFIRMAR: la página no designa un modelo por defecto ni una insignia propia (los ejemplos usan `perplexity/kimi-k3`, 3 / 15 USD) | https://docs.perplexity.ai/docs/getting-started/quickstart |
| Versión fija o alias | PENDIENTE DE CONFIRMAR | https://docs.perplexity.ai/docs/getting-started/models |
| Modelo usado en la respuesta | El ejemplo devuelve en `model` el mismo ID solicitado | https://docs.perplexity.ai/docs/getting-started/models |
| Razonamiento | Orquestador: tokens de razonamiento al precio de salida. Agent API: se facturan al precio de salida en Gemini 4 Argon/Carbon y Kimi K3; para `perplexity/sonar` PENDIENTE DE CONFIRMAR | https://docs.perplexity.ai/docs/getting-started/pricing |
| Contexto / salida máxima de `perplexity/sonar` | PENDIENTE DE CONFIRMAR | https://docs.perplexity.ai/docs/getting-started/models |
| Prefijo de clave | PENDIENTE DE CONFIRMAR (la documentación abierta usa solo marcadores como `your_api_key_here`; un resultado de búsqueda sugiere `pplx-` pero no se abrió la página que lo muestre) | https://docs.perplexity.ai/docs/getting-started/quickstart |

## Meta (sucesor de Llama 3.1 405B Instruct)

| Dato | Valor | URL |
|---|---|---|
| Versión abierta más reciente | Llama 4 (lanzada 2025-04-05): Llama 4 Scout (17B-16E) y Llama 4 Maverick (17B-128E) | https://github.com/meta-llama/llama-models |
| Más grande de la familia abierta listada | Llama 4 Maverick (Maverick-17B-128E) | https://github.com/meta-llama/llama-models |
| Aviso | Meta lista además "Muse Spark Open", un modelo de pesos abiertos de 816B que no se presenta como Llama | https://dev.meta.ai/ |
| Identificador de API, precio, contexto, salida máxima, alias o fijo, razonamiento | PENDIENTE DE CONFIRMAR (dependen del alojamiento, otra tarea; no se verificó una API de pago oficial de Meta) | https://dev.meta.ai/llama |
| Prefijo de clave | PENDIENTE DE CONFIRMAR (depende del alojamiento) | n/d |

## Recomendación para el benchmark (tope 20 EUR)

| Proveedor | Modelo | Precio (USD/MTok, entrada / salida) | En EUR (entrada / salida) | Justificación |
|---|---|---|---|---|
| Anthropic | `claude-sonnet-5-5` | 2 / 10 | 1,81 / 9,05 | Mantiene el escalón Sonnet del estudio sin pagar los 8 / 40 de la insignia; el razonamiento no desactivable infla la salida, por eso conviene fijar un tope de `max_tokens`. |
| OpenAI | `gpt-6.1-sol` | 2 / 10 | 1,81 / 9,05 | Rendimiento "cercano a Astra" a una quinta parte de su precio, dentro del presupuesto. |
| Perplexity | `perplexity/sonar` | 0,25 / 2,50 | 0,23 / 2,26 | Es el sucesor directo del modelo por defecto y el más barato del conjunto. |
| Meta | Llama 4 Maverick | PENDIENTE DE CONFIRMAR | PENDIENTE DE CONFIRMAR | Es la versión abierta más grande de la última familia; el coste depende del alojamiento. |
