# Formato CSV de casos reales

Plantilla: [`api/data/plantilla_caso_real.csv`](../api/data/plantilla_caso_real.csv). Codificación UTF-8 (se admite BOM), separador coma; los campos con comas van entre comillas. Si la cabecera no contiene comas y sí punto y coma (Excel en español guarda así), se usa `;` como separador. Los finales de línea pueden ser LF, CRLF o CR.

## Columnas

| Columna | Contenido |
|---|---|
| `CUSTOMER` | Identificador entero de 1 a 9 dígitos, único. `0` es el depósito. |
| `ADDRESS` | Dirección postal. |
| `LAT`, `LON` | Coordenadas en grados decimales (LAT en [-90, 90], LON en [-180, 180]). |
| `DEMAND` | Carga a entregar, mayor o igual que 0. |
| `READY_TIME`, `DUE_TIME` | Ventana horaria en `HH:MM` de 24 h (`24:00` admitido); `READY_TIME` no puede superar `DUE_TIME`. |
| `SERVICE_TIME` | Duración del servicio en minutos, mayor o igual que 0. |

- Cada fila lleva `ADDRESS` o el par `LAT`,`LON` (pueden ir ambos). Una sola de las dos coordenadas no vale.
- Internamente las horas pasan a minutos desde las 00:00.
- En la fila del depósito, `DEMAND` y `SERVICE_TIME` se ignoran; sus horas son la jornada de la flota.
- La flota (número de vehículos y capacidad) no va en el CSV.
- Máximo 100 clientes (sin contar el depósito).

## Ejemplo

```csv
CUSTOMER,ADDRESS,LAT,LON,DEMAND,READY_TIME,DUE_TIME,SERVICE_TIME
0,"Matadero Madrid, Paseo de la Chopera 14, Madrid, España",,,0,08:00,18:00,0
1,"Museo del Prado, Calle de Ruiz de Alarcón 23, Madrid, España",40.413567,-3.691351,4,09:00,12:00,15
```

## Errores

Se informan todos los errores de fila a la vez, cada uno con su número de fila del fichero (la cabecera es la fila 1):

- faltan columnas de la cabecera;
- `CUSTOMER` no entero, de más de 9 dígitos o repetido;
- valor no numérico en `LAT`, `LON`, `DEMAND` o `SERVICE_TIME`, o `DEMAND`/`SERVICE_TIME` negativos;
- hora mal formada, o `READY_TIME` mayor que `DUE_TIME`;
- `LAT` o `LON` fuera de rango, o solo una de las dos;
- fila sin dirección ni coordenadas;
- más de 100 clientes;
- falta el depósito (`CUSTOMER` 0) o no hay clientes (error general, sin fila).
