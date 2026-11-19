# Instancias de Solomon: fuentes, convenciones y BKS

Comprobado el 2026-11-14. Cada cifra de este documento se ha leído en la fuente que se cita en su fila;
no hay valores tomados de memoria. Los ficheros y sus huellas están en `api/data/solomon/FUENTES.md` y
las BKS en formato de máquina en `api/data/solomon_bks.json`.

## 1. Fuentes de los ficheros de instancia

| Fuente | URL | Estado el 2026-11-14 | Uso en el proyecto |
|---|---|---|---|
| Página original de Solomon | <http://web.cba.neu.edu/~msolomon/problems.htm> | Sin respuesta (conexión agotada) | Se ha leído su copia archivada en Arquivo.pt del 2023-03-17: <https://arquivo.pt/noFrame/replay/20230317121231id_/http://web.cba.neu.edu/~msolomon/problems.htm> |
| SINTEF, proyecto TOP | <https://www.sintef.no/projectweb/top/vrptw/100-customers/> y zip <https://www.sintef.no/globalassets/project/top/vrptw/solomon/solomon-100.zip> | Accesible | Fuente de la descarga (copia de respaldo declarada por SINTEF) |
| NEO, Universidad de Málaga | <https://neo.lcc.uma.es/vrp/vrp-instances/capacitated-vrp-with-time-windows-instances/> | Accesible | Comprobación cruzada (100 clientes idénticos byte a byte) y verificación del recorte 25/50 |
| Controlador del 12.º reto DIMACS (VRPTW) | <https://github.com/laser-ufpb/VRPTWController/tree/87de6d63eca1c8d4b5862c7a850fdc5a40595fe1/Instances/Solomon> | Accesible | Comprobación cruzada (idénticos byte a byte) y convención de cálculo |
| CVRPLIB | <http://vrp.galgos.inf.puc-rio.br/index.php/en/> | Conexión rechazada | No se ha podido verificar; no se usa ninguna cifra suya |

Cita bibliográfica de las instancias, tal como la da la página del reto DIMACS
(<https://dimacs.rutgers.edu/programs/implementation-challenges/vehicle-routing/implementation-challenge-vehicle-routing/vrp-with-time-windows>):
M. M. Solomon, "Algorithms for the vehicle routing and scheduling problems with time window
constraints", *Operations Research*, 35(2):254-265, 1987.

### Licencia y condiciones de uso

- Ninguna de las páginas leídas (Solomon en Arquivo.pt, SINTEF, NEO) publica una licencia ni condiciones
  de uso para los ficheros de instancia. SINTEF solo pide que se le comuniquen nuevas BKS.
- El repositorio del controlador DIMACS se distribuye con licencia MIT
  (<https://github.com/laser-ufpb/VRPTWController/blob/87de6d63eca1c8d4b5862c7a850fdc5a40595fe1/LICENSE>), pero el texto
  se refiere al software y no aclara si cubre los datos de Solomon que incluye.
- Conclusión: no hay licencia explícita. La práctica de la literatura es usarlas libremente con fines de
  investigación citando a Solomon (1987) y la fuente de descarga. Si la publicación exige una licencia
  formal para redistribuir los ficheros: PENDIENTE DE CONFIRMAR (no se ha encontrado ninguna). Para no
  depender de ello basta con no redistribuir los ficheros y citar las URL de descarga.

## 2. Instancias de 25 y 50 clientes

- La página de Solomon (copia de Arquivo.pt citada arriba) dice que, para cada problema de 100 clientes,
  los problemas menores se crearon considerando solo los 25 o 50 primeros clientes.
- Las páginas de SINTEF de 25 y 50 clientes dicen lo mismo: las instancias contienen los 25 (o 50)
  primeros clientes de las de 100
  (<https://www.sintef.no/projectweb/top/vrptw/25-customers/>,
  <https://www.sintef.no/projectweb/top/vrptw/50-customers/>).
- Comprobación hecha con un script sobre los ficheros de 25 y 50 de NEO
  (<https://neo.lcc.uma.es/vrp/wp-content/data/instances/solomon/solomon_25.zip> y `solomon_50.zip`): en las
  seis instancias, las filas coinciden exactamente con las filas 0 a 25 (o 0 a 50) del fichero de 100.
  La cabecera no cambia (K = 25 y la misma Q) y el depósito conserva su instante límite original.

Regla para el código: instancia de tamaño n = depósito (cliente 0) más los clientes 1..n del fichero de
100, con K y Q de la cabecera sin cambios. Los nombres usados en la literatura son `C101.25`, `C101.50`, etc.

## 3. Definición de los campos del fichero

Fuentes: página de documentación de SINTEF (<https://www.sintef.no/projectweb/top/vrptw/documentation2/>),
descripción de NEO (<https://neo.lcc.uma.es/vrp/vrp-instances/description-for-files-of-solomons-instances/>)
y página del reto DIMACS citada arriba.

| Campo del fichero | Símbolo | Significado |
|---|---|---|
| Línea 1 | | Nombre de la instancia |
| `VEHICLE / NUMBER` | K | Número máximo de vehículos (25 en las seis instancias) |
| `VEHICLE / CAPACITY` | Q | Capacidad de cada vehículo (flota homogénea) |
| `CUST NO.` | i | Número de nodo; el 0 es el depósito, donde empiezan y terminan todas las rutas |
| `XCOORD.`, `YCOORD.` | x, y | Coordenadas en el plano |
| `DEMAND` | q | Demanda del cliente (0 en el depósito) |
| `READY TIME` | e | Instante más temprano en que puede empezar el servicio |
| `DUE DATE` | l | Instante más tardío en que puede empezar el servicio; en el depósito es el horizonte, hora límite de regreso |
| `SERVICE TIME` | s | Duración del servicio (0 en el depósito) |

SINTEF indica que todas las constantes del fichero son enteras. Un vehículo puede llegar antes de `READY
TIME` y esperar; no puede empezar el servicio después de `DUE DATE` (página DIMACS).

### Distancia y tiempo de viaje

- Distancia euclídea entre coordenadas; el tiempo de viaje es igual a la distancia, es decir, velocidad
  unitaria (página de Solomon: problemas euclídeos con tiempos de viaje iguales a las distancias; SINTEF:
  el valor del tiempo de viaje es igual al de la distancia).
- La precisión depende de la convención (sección 4). Lo que cambia es el valor de cada arco, y como el
  tiempo de viaje es el mismo número, también cambia qué soluciones son factibles.

Recurrencia de tiempos (la que aplica el controlador DIMACS en `src/dSolution.cpp`): inicio de servicio en
j = max(inicio en i + s_i + t_ij, e_j), con inicio ≤ l_j en cada cliente y llegada al depósito ≤ l_0.

## 4. Las dos convenciones

| | (a) `exact_truncated` | (b) `hierarchical_double` |
|---|---|---|
| Objetivo | Solo distancia total; K es una cota, sin premio por usar menos vehículos | Jerárquico: primero minimizar vehículos, después distancia |
| Distancia por arco | Euclídea truncada a un decimal: floor(10·d)/10 | Euclídea en doble precisión |
| Tiempo de viaje | El mismo valor truncado | El mismo valor en doble precisión |
| Cifra publicada | Un decimal | Redondeada a dos decimales |
| Dónde se usa | Métodos exactos; 25 y 50 clientes; reto DIMACS 2021-2022 | Tablas de SINTEF de mejores heurísticas, 100 clientes |
| Fuente de la definición | Página DIMACS: distancia euclídea "truncated to one decimal place"; código `src/dSolution.h` (`(int)(value*10)/10`) | Página de SINTEF del benchmark de Solomon: <https://www.sintef.no/projectweb/top/vrptw/solomon-benchmark/> |

SINTEF advierte que los métodos exactos usan un objetivo de distancia total y cálculos enteros o de baja
precisión, por lo que sus resultados no son directamente comparables con su tabla.

Sobre la fuente de 25 y 50 clientes: el informe IMM-TR-2001-9 no escribe la palabra "truncado"; indica que
los costes c_ij se suponen enteros (p. 5), lo que equivale a trabajar con décimas. Se asigna a la
convención (a) porque sus seis valores de 100 clientes coinciden exactamente con los que el controlador
DIMACS, que trunca explícitamente, marca como óptimos.

## 5. Tabla de BKS

Siglas de fuente:

- **IMM**: B. Kallehauge, J. Larsen y O. B. G. Madsen, "Lagrangean duality applied on vehicle routing
  with time windows. Experimental results", Technical Report IMM-TR-2001-9, Informatics and Mathematical
  Modelling, Technical University of Denmark, 2001. PDF:
  <https://optimization-online.org/wp-content/uploads/2001/11/401.pdf>. Columnas `IPopt` (óptimo entero) y
  `veh`.
- **DIMACS**: controlador oficial del 12.º reto DIMACS de VRPTW, fichero `genScript1.sh`, commit
  `87de6d6`, argumento "Instance BKS" con la marca de óptimo a 1:
  <https://github.com/laser-ufpb/VRPTWController/blob/87de6d63eca1c8d4b5862c7a850fdc5a40595fe1/genScript1.sh>. No da
  número de vehículos.
- **SINTEF**: tabla de 100 clientes, <https://www.sintef.no/projectweb/top/vrptw/100-customers/>. Las
  siglas de autor (RT, H, HG, TBGGP, MBD) son las de esa página.

### 25 clientes (convención a)

| Instancia | Vehículos | Distancia | Convención | Cita |
|---|---|---|---|---|
| C101.25 | 3 | 191.3 | exact_truncated | IMM, Tabla 3, p. 20 |
| C201.25 | 2 | 214.7 | exact_truncated | IMM, Tabla 6, p. 25 |
| R101.25 | 8 | 617.1 | exact_truncated | IMM, Tabla 2, p. 17 |
| R201.25 | 4 | 463.3 | exact_truncated | IMM, Tabla 5, p. 22 |
| RC101.25 | 4 | 461.1 | exact_truncated | IMM, Tabla 4, p. 21 |
| RC201.25 | 3 | 360.2 | exact_truncated | IMM, Tabla 7, p. 28 |

### 50 clientes (convención a)

| Instancia | Vehículos | Distancia | Convención | Cita |
|---|---|---|---|---|
| C101.50 | 5 | 362.4 | exact_truncated | IMM, Tabla 3, p. 20 |
| C201.50 | 3 | 360.2 | exact_truncated | IMM, Tabla 6, p. 25 |
| R101.50 | 12 | 1044.0 | exact_truncated | IMM, Tabla 2, p. 17 |
| R201.50 | 6 | 791.9 | exact_truncated | IMM, Tabla 5, p. 22 |
| RC101.50 | 8 | 944.0 | exact_truncated | IMM, Tabla 4, p. 21 |
| RC201.50 | 5 | 684.8 | exact_truncated | IMM, Tabla 7, p. 28 |

### 100 clientes (las dos convenciones)

| Instancia | Vehículos | Distancia | Convención | Cita |
|---|---|---|---|---|
| C101 | 10 | 827.3 | exact_truncated | IMM, Tabla 3, p. 20; DIMACS, línea 1 |
| C101 | 10 | 828.94 | hierarchical_double | SINTEF, RT (Rochat y Taillard, 1995) |
| C201 | 3 | 589.1 | exact_truncated | IMM, Tabla 6, p. 25; DIMACS, línea 10 |
| C201 | 3 | 591.56 | hierarchical_double | SINTEF, RT (Rochat y Taillard, 1995) |
| R101 | 20 | 1637.7 | exact_truncated | IMM, Tabla 2, p. 17; DIMACS, línea 18 |
| R101 | 19 | 1650.80 | hierarchical_double | SINTEF, H (Homberger, 2000), valor corregido en doble precisión |
| R201 | 8 | 1143.2 | exact_truncated | IMM, Tabla 5, p. 22; DIMACS, línea 30 |
| R201 | 4 | 1252.37 | hierarchical_double | SINTEF, HG (Homberger y Gehring, 1999) |
| RC101 | 15 | 1619.8 | exact_truncated | IMM, Tabla 4, p. 21; DIMACS, línea 41 |
| RC101 | 14 | 1696.95 | hierarchical_double | SINTEF, TBGGP (Taillard et al., 1997) |
| RC201 | 9 | 1261.8 | exact_truncated | IMM, Tabla 7, p. 28; DIMACS, línea 49 |
| RC201 | 4 | 1406.94 | hierarchical_double | SINTEF, MBD (Mester, Bräysy y Dullaert, 2005), valor corregido en doble precisión |

Las dos convenciones no son dos medidas de la misma solución: son óptimos de problemas distintos. Con
objetivo de distancia, R101 usa 20 vehículos frente a 19 y R201 usa 8 frente a 4.

No existe una tabla de BKS jerárquicas para 25 y 50 clientes: SINTEF remite para esos tamaños a la página
de Solomon, que solo publica soluciones óptimas (convención a).

### Grado de confirmación

- 100 clientes, convención (a): confirmado por dos fuentes independientes (IMM y DIMACS) con el mismo valor.
- 100 clientes, convención (b): confirmado en SINTEF y recalculado a partir de las rutas publicadas
  (sección 6).
- 25 y 50 clientes: una fuente primaria leída (IMM). Diez de las doce cifras coinciden con la Tabla 6 de
  un artículo de 2024 en acceso abierto (abajo). Las páginas de soluciones óptimas de Solomon, que serían
  la cita canónica, tienen copias en el Wayback Machine pero no se han podido leer al consultar las fuentes (la
  herramienta devolvía error 429):
  - <http://web.archive.org/web/20210731183659/http://web.cba.neu.edu/~msolomon/c1c2solu.htm>
  - <http://web.archive.org/web/20210731193817/http://web.cba.neu.edu/~msolomon/r1r2solu.htm>
  - <http://web.archive.org/web/20210731183114/http://web.cba.neu.edu/~msolomon/rc12solu.htm>

  Contrastar las doce cifras con estas páginas antes de publicar queda PENDIENTE DE CONFIRMAR.

### Discrepancias encontradas

Fuente secundaria: "A novel optimization method for hazardous materials vehicle routing with
temperature-based time windows", *PeerJ Computer Science* 10:e2586, 2024, doi:10.7717/peerj-cs.2586, CC BY
4.0, Tabla 6: <https://pmc.ncbi.nlm.nih.gov/articles/PMC11784799/>. Esa tabla mezcla convenciones y
fuentes en una misma columna "BKS":

| Instancia | IMM / SINTEF | PeerJ CS 2024, Tabla 6 | Explicación |
|---|---|---|---|
| R201.50 | 6; 791.9 (IMM, óptimo) | 6; 800.7 (AUREN 2006) | La cifra de PeerJ es peor que el óptimo publicado; parece una solución heurística de la web "The VRP Web", no un óptimo. Se mantiene 791.9 |
| RC101.50 | 8; 944.0 (IMM, óptimo) | 9; 957.9 (AUREN 2006) | Igual que la anterior. Se mantiene 944.0 |
| C201 (100) | 3; 591.56 (SINTEF) | 3; 591.58 (Tan, Chew y Lee 2006) | Diferencia de 0.02, compatible con otra precisión de cálculo; no verificado |
| R101 (100) | 19; 1650.80 (SINTEF) | 19; 1648.08 (Wu et al. 2024) | No verificado. SINTEF advierte que para R101 se publicaron antes valores algo menores obtenidos con aritmética de menor precisión |
| R201 (100) | 4; 1252.37 (SINTEF) y 8; 1143.2 (IMM) | 5; 1206.42 (Tan, Chew y Lee 2006) | No es BKS en ninguna de las dos convenciones |
| RC201 (100) | 4; 1406.94 (SINTEF) y 9; 1261.8 (IMM) | 6; 1302.81 (Lin et al. 2023) | No es BKS en ninguna de las dos convenciones |

Lección para el trabajo: no se deben copiar columnas "BKS" de artículos secundarios sin comprobar su
convención.

Otra discrepancia, documentada por la propia SINTEF: para RC101 los autores originales (TBGGP) publicaron
1696.94; SINTEF da 1696.95 y atribuye la diferencia a un error de redondeo. El recálculo propio
da 1696.949157, que redondea a 1696.95.

## 6. Soluciones de referencia con rutas

SINTEF publica las rutas de la solución de cada fila de su tabla. Las seis necesarias se han guardado sin
modificar en `api/data/solomon/soluciones_sintef/` (URL por fichero en `FUENTES.md`). Formato: cabecera
con nombre, autores, fecha y referencia, y una línea `Route k : i j ...` por ruta, sin el depósito.
Especificación del formato:
<https://www.sintef.no/contentassets/f598ba958c834072a3d02c4535125ac3/solution_format.txt> (enlazada desde
<https://www.sintef.no/projectweb/top/vrptw/>; no se ha descargado).

Se han evaluado con un script propio contra las instancias: las seis son factibles y su distancia en doble
precisión coincide con SINTEF.

| Instancia | Rutas | Doble precisión | SINTEF | Misma solución, arcos truncados |
|---|---|---|---|---|
| C101 | 10 | 828.936867 | 828.94 | 827.3 |
| C201 | 3 | 591.556557 | 591.56 | 589.1 |
| R101 | 19 | 1650.799240 | 1650.80 | 1645.7 |
| R201 | 4 | 1252.371222 | 1252.37 | 1248.4 |
| RC101 | 14 | 1696.949157 | 1696.95 | 1693.2 |
| RC201 | 4 | 1406.940088 | 1406.94 | 1403.3 |

Sirven como casos de prueba del evaluador en las dos convenciones: con doble precisión debe reproducir la
columna "Doble precisión" y con truncado la última columna. En C101 y C201 la solución truncada (827.3 y
589.1) coincide con el óptimo de la convención (a).

No se ha encontrado en abierto ninguna solución con rutas para la convención (a) ni para 25 o 50 clientes.
El informe IMM solo dibuja las rutas de R201.100 y RC201.100 en figuras, sin listarlas. La página DIMACS
muestra como ejemplo una solución de R108, que no es una de nuestras instancias.

## 7. Recomendación para el evaluador

1. **25 y 50 clientes: convención (a), `exact_truncated`.** Es la única con BKS publicadas, y además son
   óptimos probados. El evaluador debe truncar cada arco a un decimal, usar ese mismo valor como tiempo de
   viaje, comprobar la factibilidad con esos tiempos, respetar K = 25 y comparar solo la distancia total.
   El número de vehículos se informa, pero no se usa para ordenar.
2. **100 clientes: convención (a) como métrica principal y (b) como métrica secundaria.**
   - Con (a) el benchmark usa un solo objetivo y una sola aritmética en los tres tamaños, de modo que las
     brechas de 25, 50 y 100 se pueden comparar entre sí. Además las BKS son óptimos confirmados por dos
     fuentes, y es la convención del reto DIMACS, la más reciente y explícita.
   - Si algún método minimiza primero vehículos (objetivo jerárquico), su comparación justa es (b):
     recalcular la misma solución en doble precisión, comprobar su factibilidad en doble precisión y
     compararla con SINTEF, ordenando primero por vehículos y después por distancia.
3. **No mezclar convenciones al calcular una brecha.** Medir en doble precisión y comparar con un óptimo
   truncado añade un sesgo, calculado sobre las seis soluciones de SINTEF, de entre 0.20 % (C101: 828.94
   frente a 827.3 para la misma solución) y 0.42 % (C201). Una solución factible con tiempos truncados puede no serlo en doble precisión,
   porque truncar acorta los tiempos de viaje.
4. Guardar en cada resultado la convención usada (`convention`) junto a la cifra, igual que en
   `solomon_bks.json`.
