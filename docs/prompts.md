# Prompts de resolución con LLM

Los prompts están en `api/src/vrptw/llm/prompts.py` y se adaptan del prompt definitivo del TFE de 2024 y de su segundo prompt de comprobación. Las páginas citadas son las impresas del documento del TFE.

- `solve_prompt(instance)`: prompt de resolución, en inglés como el de 2024.
- `recheck_prompt()`: segundo prompt, de comprobación.
- `PROMPT_VERSION`: se guarda en cada `RunRecord` (`prompt_version`). Cualquier cambio de texto obliga a cambiarla. Las instantáneas de `api/tests/data/prompts/` incluyen la versión, de modo que un cambio de texto sin cambio de versión rompe las pruebas.

## Origen en 2024

| Elemento | Página |
|---|---|
| Prompt definitivo (versión en inglés, con las dos primeras líneas de ayuda) | 75 a 78 |
| Segundo prompt: "Do a careful re-examination of the solution. Is the score accurate? Review that all components of the score are well calculated" | 79 |
| Penalizaciones y score: 10 por unidad de tiempo antes o después de la ventana, 1000 por vehículo usado, 10000 por cliente no atendido; score = distancia + penalizaciones | 69 |

## Diferencias respecto a 2024

| # | 2024 | Ahora | Página |
|---|---|---|---|
| 1 | ENDS DELIVERY AT = ARRIVAL TIME + SERVICE TIME; el vehículo no espera. La misma definición se contradice con la p. 76, que pide un WAITING TIME hasta READY TIME | ENDS DELIVERY AT = max(ARRIVAL TIME, READY TIME) + SERVICE TIME, la regla del código que produjo las cifras publicadas | 76 y 77 |
| 2 | Fórmula fija: 10000 x clientes no atendidos + 1000 x vehículos usados + distancia + 10 x espera + 10 x retraso | Se genera con los pesos del `cost_profile` de la instancia; un término de peso 0 se declara sin coste. Si las distancias están truncadas (`euclidean_truncated`), se indica la regla floor(10 d) / 10 | 77 (fórmula), 69 (pesos) |
| 3 | "There is no capacity for the vehicles" | Se indican capacidad y DEMAND y se exige no superar la capacidad; si `fleet.capacity` es `None` se dice que no hay límite de carga | 76 |
| 4 | Salida obligatoria: una tabla por vehículo con doce columnas | Un único bloque JSON final `{"routes": [[...], ...], "score": número}` con los `customer.id`, sin el depósito. Las magnitudes de la tabla (TRAVEL STARTS AT, ARRIVAL TIME, etc.) siguen definidas en el texto como ayuda de cálculo, pero ya no se exigen como salida | 76 a 78 |
| 5 | Primera línea "Please, ignore all previous instructions." | Se elimina | 75 |
| 6 | La lista de columnas pasa de la 9 a la 11 (no hay columna 10) y el texto de la p. 78 habla de "doce columnas". Es una errata | No se arrastra: las magnitudes se listan sin numerar | 77 y 78 |
| 7 | Sin equivalente: en 2024 todas las ventanas eran blandas y solo había penalizaciones | Con el perfil SOLOMON se añade que ventanas y capacidad son restricciones duras (cualquier retraso o exceso de carga es no factible) y que entre las factibles gana la menor distancia total truncada. El perfil TFE no cambia | 69 y 77 |

## Otros cambios que se derivan de los anteriores o de la instancia

| Cambio | Motivo | Página de 2024 |
|---|---|---|
| El texto original da los datos en un CSV adjunto (y en el propio prompt para Llama3). Ahora la tabla CSV (CUSTOMER, X, Y, DEMAND, READY_TIME, DUE_TIME, SERVICE_TIME) va siempre incrustada, y el depósito, la flota y su capacidad se describen en frases | Una llamada a la API no adjunta ficheros | 77 y 78 |
| "We are going to use 5 vehicles" pasa a "at most K vehicles", con K tomado de la flota de la instancia | El número de clientes y de vehículos ya no está fijo en el texto, y el propio prompt dice que no hace falta usarlos todos | 76 y 77 |
| Kilómetros y minutos solo en las instancias de 2024; en el resto, "distance unit" y "time unit" | Las instancias de Solomon no declaran unidades | 76 |
| Si el depósito tiene DUE_TIME, se dice que volver más tarde cuenta como retraso | Es lo que hace `evaluate.py` | No consta en el TFE |
| Se omite la frase "it can be better not using all vehicles and having more WAITING TIME and LATE ARRIVAL TIME" y queda solo la parte de vehículos | Es verdad solo con ciertos pesos; con los del perfil Solomon (vehículo sin coste) no tiene sentido | 77 |
| Se añade "vehicles that visit no customer are not used" | Coincide con la definición de vehículo usado del evaluador | No consta en el TFE |
| Instancia sin coordenadas cartesianas: se omiten X e Y y se añade la matriz de tiempos de `instance.matrix`; sin matriz se lanza `ValueError` | Aún no hay instancias geográficas; es el camino mínimo | No consta en el TFE |

## Lo que se conserva sin cambios

Las líneas "Don't give example, hypothetical or sample answers. The audience is academic." y "Today you are going to be an expert in solving VRPTW problems" (p. 75 y 76), la lista de métodos modernos (p. 76), la velocidad uniforme de 1 unidad de distancia por unidad de tiempo (p. 76), "if it is not possible to reach all customers, the better solution would be the one where most customers are attended" (p. 76), las definiciones de WAITING TIME y LATE ARRIVAL TIME (p. 77), el regreso obligatorio al depósito dentro de la distancia acumulada (p. 77) y las reglas "no code", "afford computationally" y "Do not give example..." (p. 77).

## Prompt de comprobación

Se mantiene la frase de la p. 79 y se añade la petición de terminar con el mismo bloque JSON, para poder analizar la respuesta de igual forma que la primera. El TFE (p. 78 y 79) describe este prompt como una petición de que el modelo reexamine la solución obtenida; no consta en el texto cómo se encadenaba con la primera respuesta.
