# Fuentes de los ficheros de Solomon

Fecha de descarga y comprobación: 2026-11-14.

## Instancias de 100 clientes

Origen de la descarga: copia de respaldo de SINTEF (proyecto TOP), fichero
`solomon-100.zip`, descargado de
<https://www.sintef.no/globalassets/project/top/vrptw/solomon/solomon-100.zip>
(cabecera `Last-Modified: Mon, 17 Nov 2014 14:40:01 GMT`; SHA-256 del zip
`8a0a72cbe6b7f8f9988ace4ebde0378ec34943acaaac47f2c408915e41887747`). La página que enlaza el zip es
<https://www.sintef.no/projectweb/top/vrptw/100-customers/>. Cada fichero se ha extraído de la carpeta
`In/` del zip sin modificarlo y conserva su nombre original en minúsculas.

Los valores de cabecera y el número de filas se han leído del propio fichero con un script
(cabecera `VEHICLE / NUMBER CAPACITY`, filas numéricas de 7 columnas).

| Fichero | URL (zip + ruta interna) | Nombre en línea 1 | Vehículos K | Capacidad Q | Filas (depósito + clientes) | SHA-256 |
|---|---|---|---|---|---|---|
| `c101.txt` | `solomon-100.zip` → `In/c101.txt` | C101 | 25 | 200 | 101 (0 + 100) | `a6da75152d182d60ecd2c6f854296f5be452f92282d096adebcf5d99a7f16516` |
| `c201.txt` | `solomon-100.zip` → `In/c201.txt` | C201 | 25 | 700 | 101 (0 + 100) | `d8d9834087ae2326fa23a8510533060233dc9fb481873be60956eb26a880ad63` |
| `r101.txt` | `solomon-100.zip` → `In/r101.txt` | R101 | 25 | 200 | 101 (0 + 100) | `3f3655182bc0fe44ce5de65fdcd2ee2f9c7fb9ed055f923635151d9d6f76d3ed` |
| `r201.txt` | `solomon-100.zip` → `In/r201.txt` | R201 | 25 | 1000 | 101 (0 + 100) | `0be960ec998fff2cab0bdbcc5194c617e5ca0a79c82c5b32b1d4bd98b2cae210` |
| `rc101.txt` | `solomon-100.zip` → `In/rc101.txt` | RC101 | 25 | 200 | 101 (0 + 100) | `ef6893ffd9746ad96de8e4da6e64e2c4ba6e08a1c7eb9457276a9f1caf01ca12` |
| `rc201.txt` | `solomon-100.zip` → `In/rc201.txt` | RC201 | 25 | 1000 | 101 (0 + 100) | `288836e2d8c2ace83ebbff77e03ac8cdffc574fc134cade21ef92713f8c52d44` |

En los seis ficheros los identificadores van de 0 (depósito) a 100 sin huecos. Los ficheros usan fin de
línea CRLF.

### Comprobación cruzada con otras copias

Los seis ficheros son idénticos byte a byte a las copias de otras dos fuentes, descargadas el mismo día:

- NEO (Universidad de Málaga), `solomon_100.zip`:
  <https://neo.lcc.uma.es/vrp/wp-content/data/instances/solomon/solomon_100.zip> (nombres en mayúsculas,
  `C101.txt`, etc.).
- Controlador oficial del reto DIMACS de VRPTW, repositorio `laser-ufpb/VRPTWController`, commit
  `87de6d63eca1c8d4b5862c7a850fdc5a40595fe1`, carpeta `Instances/Solomon/`:
  <https://github.com/laser-ufpb/VRPTWController/tree/87de6d63eca1c8d4b5862c7a850fdc5a40595fe1/Instances/Solomon>.

La fuente original, la página de Solomon <http://web.cba.neu.edu/~msolomon/problems.htm>, no respondía
el 2026-11-14 (tiempo de conexión agotado). Su contenido se ha leído en la copia de Arquivo.pt del
2023-03-17:
<https://arquivo.pt/noFrame/replay/20230317121231id_/http://web.cba.neu.edu/~msolomon/problems.htm>.

## Instancias de 25 y 50 clientes

No se guardan como ficheros: se construyen tomando el depósito y los 25 o 50 primeros clientes del
fichero de 100 (véase `docs/fuentes/solomon.md`). Se ha comprobado con los zips de NEO
(`solomon_25.zip` y `solomon_50.zip`, en la misma ruta que `solomon_100.zip`) que, para las seis
instancias, sus filas coinciden exactamente con las 26 o 51 primeras filas del fichero de 100 y que la
cabecera se mantiene (K = 25 y la misma Q).

## Soluciones de referencia con rutas (carpeta `soluciones_sintef/`)

Soluciones detalladas publicadas por SINTEF para la convención jerárquica en doble precisión, enlazadas
desde la tabla de <https://www.sintef.no/projectweb/top/vrptw/100-customers/>. Se guardan sin
modificar y con su nombre original (coincide con el de la instancia, por eso van en una subcarpeta).

| Fichero | URL | Last-Modified | SHA-256 |
|---|---|---|---|
| `soluciones_sintef/c101.txt` | <https://www.sintef.no/contentassets/adf48e65e3a84dd6871eb7586707675d/c101.txt> | 2016-01-14 | `7a000b23902b2ad8851d8a1752d007047c3f8ff6a27f60c6d1a3167f58433f48` |
| `soluciones_sintef/c201.txt` | <https://www.sintef.no/contentassets/adf48e65e3a84dd6871eb7586707675d/c201.txt> | 2016-01-14 | `a3a6a9b96dfd1bf8f6db553ca51c098d685361ac6934009c28725954a15afcb4` |
| `soluciones_sintef/r101.txt` | <https://www.sintef.no/contentassets/adf48e65e3a84dd6871eb7586707675d/r101.txt> | 2014-11-17 | `850da45f9e24da65ccc95c4b3f8cc060f707e5c236d8f28f25fb230d18750f83` |
| `soluciones_sintef/r201.txt` | <https://www.sintef.no/contentassets/adf48e65e3a84dd6871eb7586707675d/r201.txt> | 2016-01-14 | `8c77279a8be3ca2d07bd76ad346bbab2836b0c57bab3dca13d32eca01f20e213` |
| `soluciones_sintef/rc101.txt` | <https://www.sintef.no/contentassets/adf48e65e3a84dd6871eb7586707675d/rc101.txt> | 2016-06-22 | `d5da64b15763f850c865cd42f27a795c62d137f6f79beae3b6a6967c9a495b76` |
| `soluciones_sintef/rc201.txt` | <https://www.sintef.no/contentassets/adf48e65e3a84dd6871eb7586707675d/rc201.txt> | 2014-11-17 | `5e016034e23568321f17d972a4ce77ab88e4da5a95eaa46300ed640fa693bd1b` |

Comprobación hecha el 2026-11-14 con un script propio (no forma parte del proyecto): las seis soluciones
son factibles (capacidad, ventanas y cada cliente una sola vez) y su distancia en doble precisión
coincide, redondeada a dos decimales, con la tabla de SINTEF:

| Instancia | Rutas | Distancia doble precisión | Tabla SINTEF | Misma solución con arcos truncados a 1 decimal |
|---|---|---|---|---|
| C101 | 10 | 828.936867 | 828.94 | 827.3 |
| C201 | 3 | 591.556557 | 591.56 | 589.1 |
| R101 | 19 | 1650.799240 | 1650.80 | 1645.7 |
| R201 | 4 | 1252.371222 | 1252.37 | 1248.4 |
| RC101 | 14 | 1696.949157 | 1696.95 | 1693.2 |
| RC201 | 4 | 1406.940088 | 1406.94 | 1403.3 |

La última columna no es una BKS: solo muestra cuánto cambia la cifra de una misma solución al cambiar
de convención.
