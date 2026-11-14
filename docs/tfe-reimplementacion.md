**EL CÓDIGO ORIGINAL ESTÁ DISPONIBLE.** El anexo del TFE (p. 93) enlaza un repositorio público de GitHub (https://github.com/oscarsr96/tfm_vrptw_osr_jsr/) con los cinco notebooks de Python (generación de problemas y los cuatro métodos), los 20 CSV de problemas y los resultados de cada ejecución. El plan cambia: ya no hay que reimplementar a partir del texto, sino portar ese código y decidir qué defectos se corrigen (sección 1).

# Reimplementación de los métodos clásicos del TFE (2024)

## 0. Fuentes y convenciones

- **TFE**: `tfe.pdf`. Se cita la página impresa del documento, que es la del PDF menos 8. Páginas leídas: 23 a 44 (cap. 4), 67 a 84 (cap. 5) y 85 a 94 (conclusiones, bibliografía y anexos; el documento acaba en la p. 94).
- **Código**: repositorio `oscarsr96/tfm_vrptw_osr_jsr`, último commit `c3ad94c` (11/09/2024, "upload results"). Los notebooks están en `python_notebooks/`. El código se cita por fichero y función.
- **Tipo de afirmación** en las tablas "Consta en el TFE":
  - **Lit.**: descripción general del método en el cap. 4, apoyada en la literatura. No dice que el código de los autores lo hiciera.
  - **Autores**: el texto afirma qué hizo su implementación (cap. 5 y anexos).
- **NO CONSTA EN EL TFE**: el texto no lo dice. Debajo de cada laguna se indica qué hace el código original (**Código**) y la **Propuesta** por defecto. "A CONFIRMAR" marca las decisiones que quedan abiertas.

## 1. Qué cambia en el plan

- **El repositorio contiene el código que produjo los resultados publicados.** Con un script propio que replica la lógica de `Heuristics.ipynb` (sin ejecutar el notebook) sobre los 12 CSV salen los 12 valores "Heuristic Mejor" de la Tabla 5.1 (p. 80). La única diferencia es 20c-5 (11503,14 frente a 11503,13), que es de redondeo.
- **Ningún notebook fija una semilla.** Los resultados de ACO, GA y tabú solo se pueden reproducir en distribución, no valor a valor. Según el anexo (p. 94), los 48 xlsx de `results/traditional_algos/` guardan las 30 ejecuciones de cada método en cada instancia, y sirven como referencia.
- **El código tiene defectos que cambian resultados publicados** (secciones 3 a 6 y 8): el tabú no hace ningún movimiento, la heurística a veces no suma el regreso al depósito y el genético no respeta el número máximo de vehículos. Decisión pendiente (A CONFIRMAR):
  1. Port fiel con los defectos: reproduce la Tabla 5.1, pero arrastra los errores.
  2. Port corregido: métodos correctos, con resultados distintos de los del TFE.
  3. **Recomendada**: port corregido más un modo `legado` que reproduce los defectos y solo se usa en las pruebas de regresión contra la Tabla 5.1.
- **Licencia**: el repositorio no muestra ninguna, y su README lo atribuye a los dos autores del TFE. Si se copia código literal, conviene contar con el visto bueno del coautor.

## 2. Modelo común: coste, tiempos y restricciones

### Consta en el TFE

| Afirmación | Página | Tipo |
|---|---|---|
| 12 problemas: 6 de 10 clientes y 6 de 20 | 68 | Autores |
| Como máximo 5 vehículos para 10 clientes y 10 vehículos para 20 | 68 | Autores |
| Ventanas blandas: se multiplica por 10 el total de minutos que se llega antes o después de la ventana | 69 | Autores |
| Penalizaciones: 10 por unidad de tiempo antes o después de la ventana, 1000 por vehículo usado y 10000 por cliente no atendido | 69 | Autores |
| Score = distancia recorrida + todas las penalizaciones | 69 | Autores |
| "Respecto al código programado, se ha adaptado para que contemple las penalizaciones" | 69 | Autores |
| Velocidad de 1 km/min; READY TIME, DUE TIME y SERVICE TIME en minutos; depósito = Customer 0 en (0,0); "There is no capacity for the vehicles" | 76 | Autores (prompt para los LLM) |
| Los vehículos vuelven al depósito y ese tramo cuenta en la distancia | 77 | Autores (prompt para los LLM) |
| Distancias euclídeas (aparecen al hablar de los errores de los LLM) | 81 | Autores |
| 30 ejecuciones independientes de cada problema con cada modelo tradicional | 79 | Autores |

### NO CONSTA EN EL TFE

- **Espera ante una llegada temprana.** Código: en los cuatro notebooks el servicio empieza en `max(llegada, READY_TIME)` y además se penaliza la espera ×10. El prompt de la p. 77 hace lo contrario (ver sección 8). Propuesta: como el código.
- **Ventanas duras durante la construcción.** Código: el ACO y la heurística solo aceptan candidatos con llegada ≤ DUE_TIME, pero el coste trata las ventanas como blandas. El GA no filtra nada. El tabú filtra con una función defectuosa (sección 6). Propuesta: como el código.
- **Distancia y tiempo.** Código: distancia euclídea en coma flotante, sin redondear, y tiempo de viaje igual a la distancia. Propuesta: igual.
- **Capacidad.** Código: el CSV trae `DEMAND` (de 1 a 10), pero ningún método la usa. Propuesta: ignorarla, como el código. A CONFIRMAR si el planificador necesita capacidad.
- **Vehículo usado.** Código: cualquier ruta con al menos un cliente. Propuesta: igual.
- **Ventana del depósito.** Código: en todos los CSV la fila 0 tiene READY_TIME = DUE_TIME = 0. Solo el tabú la trata como ventana, y eso lo rompe (sección 6). Propuesta: el depósito no tiene ventana.
- **Función de coste.** Código: cada notebook tiene su propia función, y difieren en sus defectos. Propuesta: una sola función común para los cuatro métodos, equivalente a `calculate_routes_cost` de `ACO.ipynb`. Las diferencias del original quedan solo en el modo `legado`.

## 3. Colonia de hormigas (ACO)

### Consta en el TFE

| Afirmación | Página | Tipo |
|---|---|---|
| Rastros de feromona e información heurística guían la búsqueda de soluciones | 39 | Lit. |
| Conceptos: representación, actualización de feromonas, construcción de rutas y búsqueda local | 39 | Lit. |
| Las hormigas depositan feromona, y la cantidad influye en la probabilidad de que otras elijan ese camino | 39 y 40 | Lit. |
| Hay reglas de actualización local (refuerzo por depósito) y global (evaporación en todos los caminos) después de cada iteración | 40 | Lit. |
| Información heurística "como la distancia o el tiempo" | 40 | Lit. |
| En VRPTW la solución incluye la secuencia de nodos y los tiempos de llegada | 40 | Lit. |
| Fig. 4.4: matriz vehículo-parada y matriz parada-parada [30] | 41 | Lit. |
| La actualización puede tener en cuenta los tiempos de viaje y servicio; se puede añadir búsqueda local | 41 | Lit. |
| Parámetros clave: evaporación, alfa, beta y nivel inicial de feromona | 41 | Lit. |
| Implementado "únicamente" con "librerías nativas como numpy" | 70 | Autores |
| Iteraciones 100; hormigas 50; "Número de rutas para actualizar feromonas: 50"; alpha 1; beta 2; rho 0,05; q 1000 ("cantidad de feromonas añadida por las mejores rutas") | 70 | Autores |
| Es el más lento de los métodos iterativos y su desviación típica queda por debajo de 50 | 79 y 80 | Autores |

### NO CONSTA EN EL TFE

1. **Regla de transición.** Código (`construct_solutions`): p(c) ∝ τ[i][c]^α · (1/d(i,c))^β, normalizada sobre los candidatos factibles y muestreada con `np.random.choice`. No hay regla pseudoaleatoria proporcional (q0) como en ACS. Propuesta: igual.
2. **Visibilidad.** Código: η = 1/d, solo la distancia y sin ningún término de ventanas. Si d = 0 la probabilidad vale 0, y si todos los candidatos están a distancia 0 la normalización divide por cero. Propuesta: igual, con protección para d = 0.
3. **Construcción con varios vehículos.** Código: cada hormiga llena los vehículos de uno en uno. El vehículo k sale en t = 0 y va añadiendo clientes mientras quede alguno al que llegue antes de su DUE_TIME. Cuando no queda ninguno, vuelve al depósito y arranca el k+1. Reloj: `t = max(t + d, READY) + SERVICE`. Los clientes que siguen sin visitar después del último vehículo cuentan como no atendidos. Propuesta: igual.
4. **Factibilidad.** Código: solo se exige llegada ≤ DUE_TIME; no hay capacidad. Propuesta: igual.
5. **Feromona inicial.** Código: τ0 = 1 en toda la matriz de (n+1)×(n+1). Propuesta: igual.
6. **Actualización.** Código (`update_pheromone`): primero evapora todo, τ ← (1 − ρ)·τ. Después, las `n_best` mejores soluciones de la iteración (ordenadas por coste total penalizado) depositan q/coste en cada arco (i, i+1) de sus rutas. La matriz es asimétrica, porque los arcos son dirigidos. No hay actualización local ni depósito extra de la mejor global. Propuesta: igual.
7. **`n_best`.** El TFE dice 50 (p. 70); el código usa `n_best = 10`. Propuesta: 10, porque es el valor del código que generó los resultados. A CONFIRMAR.
8. **Solución devuelta y parada.** Código: la mejor de todas las iteraciones, tras 100 iteraciones fijas. No hay búsqueda local. Propuesta: igual.

**Frente al punto de partida**: llamarlo "Ant System estándar" no es exacto. En AS depositan todas las hormigas, y aquí solo las 10 mejores de cada iteración. La visibilidad 1/d sí coincide.

## 4. Algoritmo genético (GA)

### Consta en el TFE

| Afirmación | Página | Tipo |
|---|---|---|
| Selección, cruce, mutación y herencia; la aptitud fija la probabilidad de reproducirse | 27 | Lit. |
| Los nuevos individuos sustituyen a los menos aptos; el ciclo se repite hasta un criterio de terminación | 28 | Lit. |
| Rutas codificadas como cadenas de enteros (clientes) con caracteres separadores de ruta | 28 y 29 | Lit. |
| Representación como lista de prioridades con la ruta más corta de Dijkstra [30] | 29 | Lit. |
| Inicialización aleatoria; se mencionan cuatro enfoques de inicialización [30] | 29 y 30 | Lit. |
| Codificaciones por valor, por dimensión y por secuencia | 30 | Lit. |
| Fig. 4.1: el VRP como un conjunto de vehículos, cada uno con su lista ordenada de pedidos (un TSP por vehículo) | 31 | Lit. |
| La función de aptitud es clave, pero no se da ninguna fórmula | 31 | Lit. |
| Selección probabilística según la aptitud; enfoque paralelo con subpoblaciones | 31 y 32 | Lit. |
| Cruces que respetan la permutación; cruce uniforme (UX) | 32 | Lit. |
| Mutación de intercambio: cambiar de posición dos clientes de dos rutas diferentes. Fig. 4.2: swap node y swap sequence | 33 | Lit. |
| El tamaño de la población y el número de generaciones son parámetros clave | 34 | Lit. |
| Librería DEAP | 70 | Autores |
| Población 100; probabilidad de cruce 0,7; probabilidad de mutación 0,01; 100 generaciones | 70 y 71 | Autores |
| Desviación típica elevada | 80 | Autores |

### NO CONSTA EN EL TFE

1. **Codificación.** Código: cada individuo es una lista de `N_VEHICLES` listas, una ruta por vehículo con los clientes en orden de visita. El depósito va implícito al principio y al final. Coincide con la Fig. 4.1 (p. 31); no es una permutación. Propuesta: igual.
2. **Inicialización.** Código (`generate_individual`): reparte una permutación aleatoria en turno rotatorio con `routes[i % 5]`, con el 5 fijo. Con 10 vehículos (problemas de 20 clientes) solo se llenan las 5 primeras rutas. Propuesta: `i % N_VEHICLES` en el modo corregido.
3. **Aptitud.** Código (`evaluate`, que minimiza): distancia (con el regreso) + 10·(espera + retraso) + 1000 por vehículo no vacío + 10000 por cliente no atendido. Un cliente repetido da aptitud infinita. Propuesta: la función común.
4. **Selección.** Código: `tools.selTournament` con `tournsize=3`. Propuesta: igual (coincide con el punto de partida).
5. **Cruce.** Código (`crossover`): corta la lista de rutas en dos puntos independientes, c1 y c2. Hijo 1 = rutas[:c1] del padre 1 + rutas[c2:] del padre 2; hijo 2 = rutas[:c2] del padre 2 + rutas[c1:] del padre 1. Después pasa por `correct_duplicates`. Consecuencias:
   - El hijo puede tener entre 2 y 8 rutas con 5 vehículos, y entre 2 y 18 con 10, así que no respeta el máximo de la p. 68.
   - `correct_duplicates` cambia un cliente al azar de cada ruta por uno que falta, lo que puede perder clientes, y no quita los duplicados. Esos hijos acaban con aptitud infinita.

   Propuesta para el modo corregido: el mismo cruce por rutas, pero con un único punto de corte común para que siempre haya N rutas, y una reparación que quite los duplicados (se queda la primera aparición) y añada los clientes que falten al final de rutas elegidas al azar. A CONFIRMAR.
6. **Mutación.** Código (`mutate`): elige dos rutas distintas y, si las dos tienen clientes, saca uno al azar de cada una y lo añade al final de la otra. Coincide con la p. 33 (intercambio entre dos rutas), salvo que no se conserva la posición. En `eaSimple`, `mutpb=0.01` es la probabilidad de aplicar una mutación (un intercambio) a cada individuo, no a cada gen. Propuesta: igual.
7. **Esquema evolutivo.** Código: `algorithms.eaSimple` es generacional: la descendencia sustituye a toda la población, sin elitismo dentro de ella. `HallOfFame(1)` guarda el mejor individuo, y la parada es a las 100 generaciones. Propuesta: igual.

**Frente al punto de partida**: el código no usa permutación, ni cruce ordenado (OX), ni mutación por intercambio de índices. Usa lista de rutas, cruce por rutas con reparación e intercambio de clientes entre rutas. Solo el torneo coincide.

## 5. Heurística constructiva

### Consta en el TFE

| Afirmación | Página | Tipo |
|---|---|---|
| Tres tipos: heurísticas constructivas, heurísticas de mejora y metaheurísticas | 42 y 43 | Lit. |
| Constructiva básica: desde el depósito se elige un cliente y se va construyendo su ruta; solo se inserta si es factible en capacidad y ventanas; dónde se inserta depende de un criterio | 43 | Lit. |
| Variantes: inserción secuencial (en un orden determinado), inserción simultánea de un grupo, criterio de McCormick (mínimo aumento del coste del vehículo) y ahorros de Clarke-Wright | 43 | Lit. |
| Las rutas se crean insertando clientes en rutas existentes o abriendo una nueva; los criterios deciden qué cliente y dónde | 43 y 44 | Lit. |
| "Para el modelo heurístico se ha importado la librería torch" | 70 | Autores |
| "El modelo heurístico no tiene hiperparámetros" | 71 | Autores |
| No es iterativo y es el más rápido | 79 | Autores |
| Desviación 0, porque "encuentra siempre la misma solución, no realiza exploraciones aleatorias" | 80 | Autores |

### NO CONSTA EN EL TFE

El texto no dice cuál de las variantes de la p. 43 se programó.

1. **Algoritmo.** Código (`greedy_heuristic_solution`): es un vecino más cercano secuencial, no una inserción. Cada vehículo sale del depósito en t = 0 y, entre los clientes pendientes con llegada ≤ DUE_TIME, elige el más cercano y lo pone al final de la ruta. Reloj: `t = max(t + d, READY) + SERVICE`. Cuando no queda ningún cliente factible, pasa al siguiente vehículo. Nunca inserta en posiciones intermedias. Propuesta: igual.
2. **Empates.** Código: decide el orden de recorrido del `set` de pendientes más una ordenación estable. Propuesta: desempatar explícitamente por índice de cliente.
3. **Clientes sin asignar.** Código: los que quedan al acabar los vehículos cuentan como no atendidos (10000 cada uno). Propuesta: igual.
4. **Uso de torch.** Código: solo como contenedor (`torch.utils.data.Dataset`). Importa `nn` y `optim` pero no los usa, y no entrena nada. Propuesta: Python puro sin torch, como en el punto de partida.
5. **Defecto en el coste.** Código (`calculate_route_details`): la condición `if route and customer_idx:` hace que no se sume el regreso al depósito cuando el último cliente de una ruta es el cliente 1 del CSV (índice interno 0). Esto cambia 4 de los 12 valores publicados (sección 8). Propuesta: corregirlo, y conservarlo solo en el modo `legado`.

**Frente al punto de partida**: el código no hace inserción secuencial de mínimo incremento de coste. Hace vecino más cercano factible, ruta a ruta. Lo de "Python puro sin torch" sí vale.

## 6. Búsqueda tabú

### Consta en el TFE

| Afirmación | Página | Tipo |
|---|---|---|
| Vecindario: mover un cliente o un grupo de clientes entre rutas, o cambiar el orden dentro de una ruta [29] | 25 | Lit. |
| Se pasa de una solución a otra de su vecindad; la memoria es una lista de atributos prohibidos ("características tabú") | 36 | Lit. |
| La lista tabú restringe atributos de la solución actual durante un número de iteraciones | 37 | Lit. |
| Fig. 4.3, pseudocódigo [42]: S inicial; S* = S; repetir: S1 = mejor solución admisible de la vecindad de S; si f(S1) > f(S*), S* = S1; S = S1; actualizar la lista tabú; hasta el criterio de parada | 37 | Lit. |
| Componentes: mecanismos de movimiento, estructuras de memoria y criterios de terminación | 37 y 38 | Lit. |
| Movimientos básicos: añadir o quitar vértices de una ruta o cambiar su orden. La lista tabú, de longitud fija, impide mover un vértice a otra ruta durante un número de iteraciones después de transferirlo | 38 | Lit. |
| Sin librerías específicas, solo "librerías nativas como collections" | 70 | Autores |
| 100 iteraciones; lista tabú de tamaño 50 | 71 | Autores |
| Es el más rápido de los métodos iterativos y tiene desviación elevada | 79 y 80 | Autores |

### NO CONSTA EN EL TFE

1. **Solución inicial.** Código (`generate_initial_solution`): reparte una permutación aleatoria en turno rotatorio entre todos los vehículos, así que siempre usa los 5 o los 10. Después ordena cada ruta por vecino más cercano desde el depósito. Propuesta (A CONFIRMAR):
   - (a) **Recomendada**: la del código, que mantiene la variabilidad entre ejecuciones con la que el TFE compara (p. 79).
   - (b) Partir de la heurística, como en el punto de partida. Así el tabú pasa a ser determinista.
2. **Vecindario.** Código (`generate_neighborhood`): explora todos los vecinos de dos tipos:
   - (i) intercambio de dos clientes entre dos rutas distintas;
   - (ii) recolocación de un cliente dentro de su propia ruta.

   No hay recolocación entre rutas, de modo que nunca cambia cuántos clientes tiene cada ruta ni cuántos vehículos se usan. Propuesta: (i) + (ii) + recolocación entre rutas, que es el movimiento básico de las p. 25 y 38 y permite reducir vehículos. A CONFIRMAR.
3. **Validación de vecinos (defecto grave).** Código (`validate_solution`): exige llegada ≤ DUE_TIME en todos los nodos, también en el regreso al depósito, y en todos los CSV el DUE_TIME del depósito es 0. Así, cualquier ruta con clientes es inválida, el vecindario se queda vacío y `tabu_search` sale en la primera iteración con la solución inicial. **El tabú publicado no hace ningún movimiento.** Lo he comprobado de dos formas:
   - Con un script propio que replica la lógica: en 200 soluciones iniciales aleatorias de 10c-1, ninguno de los 50 vecinos candidatos es válido.
   - Simulando 20000 soluciones iniciales sale media 7242,83 y desviación 690,59 en 10c-1, y 14550,20 y 626,12 en 20c-1. La Tabla 5.1 (p. 80) da 7410,09 y 861,27, y 14599,64 y 623,63. Encaja con que la columna Tabu publique la solución inicial.

   Propuesta: el depósito sin ventana y, como las ventanas son blandas, aceptar vecinos no factibles y puntuarlos con el coste penalizado. A CONFIRMAR.
4. **Función objetivo interna.** Código (`calculate_solution_cost`): no coincide con el coste que se publica.
   - La espera siempre penaliza 0, porque asigna `time = READY` antes de calcular `READY - time`.
   - No suma el regreso al depósito.
   - No avanza el reloj con el tiempo de servicio.
   - Cobra 1000 por cada ruta, aunque esté vacía.
   - No penaliza los clientes no atendidos.

   Propuesta: la función común.
5. **Solución actual frente a la mejor.** Código: el vecindario se genera siempre desde `best_solution`, así que nunca acepta un movimiento que empeore. Va en contra de la Fig. 4.3 (p. 37). Propuesta: seguir la Fig. 4.3 (S = mejor vecino admisible aunque empeore; S* guarda la mejor).
6. **Lista tabú.** Código: `deque(maxlen=50)` con soluciones completas, no atributos. Propuesta: igual, que concuerda con el "tamaño 50" de la p. 71. Una lista de atributos (cliente, ruta) de longitud 50 bloquearía casi todos los movimientos con 10 clientes y 5 rutas.
7. **Aspiración.** No aparece ni en el TFE ni en el código. Propuesta: no hace falta con una lista de soluciones completas, porque una solución ya visitada no puede mejorar la mejor global. Solo habría que añadir la aspiración por mejor global si se pasa a atributos.
8. **Parada y coste publicado.** Código: 100 iteraciones o vecindario vacío. `generate_route_details_and_cost` no suma la penalización por no atendidos, aunque con el reparto inicial siempre vale 0. Propuesta: la función común.

**Frente al punto de partida**:
- El vecindario del código es intercambio entre rutas más recolocación dentro de la ruta; no hay recolocación entre rutas.
- El inicio es aleatorio, no la heurística.
- No hay aspiración.
- Además, el original no itera.

## 7. Generación de los problemas de 10 y 20 clientes

### Consta en el TFE

| Afirmación | Página |
|---|---|
| Los problemas se crearon para este trabajo y no están en la literatura | 68 |
| Se generaron con un script en Python y datos aleatorios "que permitan alcanzar soluciones factibles"; el enlace está en el anexo | 68 |
| 6 problemas de 10 clientes (hasta 5 vehículos) y 6 de 20 (10 vehículos) | 68 |
| Ejemplo del primer prompt: 10 clientes con coordenadas enteras como (98, 11) y ventanas como [2,99]; depósito en (0,0); 1 unidad de tiempo por unidad de distancia; 10 minutos de servicio | 72 y 73 |
| Prompt final: X e Y en km desde el depósito; 5 vehículos; depósito = Customer 0 en (0,0); sin capacidad; 1 km/min; tiempos en minutos; datos en CSV | 76 y 78 |
| Ficheros usados: `vrptw_10_customers_problem_{1,3,4,5,8,9}.csv`, `vrptw_20_customers_problem_{1,3,5,8,9,10}.csv` y "c101 repositorio Solomon" | 93 y 94 |
| C101 y C102 de Solomon, con demanda y capacidad, solo se usan con Claude | 84 |

### NO CONSTA EN EL TFE (lo que hace `VRPTW problem generation.ipynb`)

| Dato | Código (N = número de clientes) |
|---|---|
| Coordenadas | X e Y enteros con `randint(0, 100)` |
| READY_TIME | `randint(1, 50·N/10)`: de 1 a 50 con 10 clientes y de 1 a 100 con 20 |
| DUE_TIME | `randint(max(READY, ⌊d0⌋), 100·N/10 + ⌊d0⌋)`, con d0 = distancia euclídea al depósito: hasta 100 + ⌊d0⌋ con 10 clientes y hasta 200 + ⌊d0⌋ con 20 |
| SERVICE_TIME | `randint(10, 50)` (las constantes se llaman, mal, `MIN/MAX_CLIENT_TIME_WINDOW`). Los "10 minutos" de la p. 73 solo valen para el ejemplo |
| DEMAND | `randint(1, 10)`; ningún método la usa |
| Capacidad | No hay |
| Depósito | Fila 0 con todos los campos a 0 (DUE_TIME = 0 incluido) |
| Número de problemas | 10 por tamaño (`N_PROBLEMS = 10`); el repositorio tiene los 20 CSV. Por qué se eligieron esos 6: NO CONSTA (tampoco en el código) |
| Factibilidad | El script no la comprueba, aunque la p. 68 lo diga. Lo único que garantiza es DUE ≥ ⌊d0⌋ |
| Semilla | No hay. La primera fila de la salida guardada en el notebook coincide con `vrptw_20_customers_problem_1.csv` |

Propuesta: no regenerar nada y usar los 20 CSV del repositorio como datos fijos. Para generar más problemas, portar el script con enteros y con semilla, porque `50 * N_CLIENTS/10` es un float y `random.randint` con floats da TypeError desde Python 3.12.

## 8. Enlaces a código o datos

| Texto literal | Página | Comprobación (14/11/2026) | Contenido |
|---|---|---|---|
| "https://github.com/oscarsr96/tfm_vrptw_osr_jsr/" | 93 | Responde (WebFetch de la página y del árbol en la API de GitHub; descarga en bruto de notebooks y CSV). Público, 5 commits, todos del 11/09/2024 | `python_notebooks/` (ACO.ipynb, GA.ipynb, Heuristics.ipynb, TabuSearch.ipynb, VRPTW problem generation.ipynb); `vrptw_problems/` (20 CSV, 10 por tamaño); `results/traditional_algos/` (48 xlsx: 4 métodos × 12 instancias); `results/gen_ai/` (Llama3: 18 docx y 18 png; `results_comparison.docx`); `sintef_problems/c101.html`; `.idea/`; README |
| "Se adjunta un enlace al código en el anexo final." | 68 | Remite al anterior | |

- La bibliografía (p. 87 a 92) solo enlaza artículos (arXiv, core.ac.uk, DOI) y webs de divulgación. No hay ningún enlace a código ni a datos.
- Las instancias de Solomon (p. 84 y 94) se citan sin URL; el repositorio incluye `sintef_problems/c101.html`.

## 9. Erratas e incoherencias que afectan a la reimplementación

1. **`n_best`**: la p. 70 dice 50 rutas para actualizar feromonas, y el código usa 10.
2. **El tabú no itera**: las 100 iteraciones de la p. 71 no llegan a ejecutarse (sección 6). La columna Tabu de la Tabla 5.1 (p. 80) y la afirmación de la p. 79 de que el tabú es el método iterativo más rápido reflejan solo la solución inicial aleatoria.
3. **Heurística sin regreso al depósito**: cambia 4 valores publicados. Valores calculados con un script propio:

   | Instancia | Tabla 5.1 (p. 80) | Corregido |
   |---|---|---|
   | 10c-1 | 6008.83 | 6107.44 |
   | 10c-4 | 6077.17 | 6156.81 |
   | 10c-5 | 4822.2 | 4928.61 |
   | 20c-5 | 11503.13 | 11568.88 |

4. **El GA no respeta el máximo de vehículos de la p. 68**: el cruce cambia el número de rutas, y la inicialización usa 5 rutas aunque haya 10 vehículos.
5. **Prompt de la p. 77 frente al código**: el prompt define ENDS DELIVERY AT = ARRIVAL TIME + SERVICE TIME, sin esperar a READY TIME, mientras que el código espera. Por eso la misma ruta puede puntuar distinto en un LLM y en un método clásico. Además, la lista de columnas se salta la 10 y la p. 78 habla de "doce columnas".
6. **El ejemplo de las p. 72 y 73 no coincide con `vrptw_10_customers_problem_1.csv`**: el cliente 9 tiene ventana [3,18] en el TFE y [3,35] en el CSV; la demanda del cliente 10 es 10 en el TFE y 5 en el CSV; el servicio es de 10 minutos fijos en el TFE y variable (de 11 a 48) en el CSV.
7. **Capacidad**: la p. 24 (Lit.) y el prompt de la p. 73 ("respetando las restricciones de capacidad") la mencionan, pero la p. 76 dice que no hay capacidad, y el código ignora `DEMAND`.
8. **Librerías (p. 70)**:
   - El ACO usa también pandas y matplotlib.
   - El tabú usa scipy (`cdist`), numpy y pandas.
   - La heurística solo usa torch como `Dataset`; no hay red neuronal.
9. **Fig. 4.3 (p. 37)**: "if f(S1) > f(S*)" es una condición de maximización, y el problema minimiza.
10. **p. 40**: llama "local" al depósito de refuerzo y "global" a la evaporación. Eso no coincide con ACS (la local reduce feromona al pasar y la global deposita sobre la mejor solución) ni con el código (evaporación global más depósito de las 10 mejores, sin actualización local).
11. **Tabla 5.4 (p. 82)**: el título dice "10 clientes" y la cabecera Llama3, pero las filas son 20c-* y los valores son los mismos que los de la Tabla 5.5 (ACO frente a Claude). No sirve como referencia para la comparación con LLM en 10 clientes.
12. **Sin semillas**: los resultados estocásticos solo se pueden comparar en distribución (sección 1).
