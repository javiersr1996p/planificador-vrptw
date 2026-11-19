# Tipografías de la web: fuentes verificadas

Fecha de consulta de todas las filas: 2026-11-17. Cada dato procede de la página o fichero indicado en la fila, consultado en esa fecha.

## Familias y licencias

| Familia | Uso en la web | Licencia | Autoría | Fuente |
|---|---|---|---|---|
| Big Shoulders (corte Display) | Titulares, marca y cifras grandes | SIL Open Font License 1.1 | Patric King; "Copyright 2019 The Big Shoulders Project Authors" | https://github.com/google/fonts/blob/main/ofl/bigshoulders/METADATA.pb ; https://github.com/google/fonts/blob/main/ofl/bigshoulders/OFL.txt ; https://github.com/xotypeco/big_shoulders |
| Instrument Sans | Texto de cuerpo y botones | SIL Open Font License 1.1 | Rodrigo Fuenzalida, Jordan Egstad; "Copyright 2022 The Instrument Sans Project Authors" | https://github.com/google/fonts/blob/main/ofl/instrumentsans/METADATA.pb ; https://github.com/google/fonts/blob/main/ofl/instrumentsans/OFL.txt |
| Martian Mono | Cifras tabulares, horas y etiquetas en mayúsculas | SIL Open Font License 1.1 | Roman Shamin, Evil Martians; "Copyright 2021 The Martian Mono Project Authors" | https://github.com/google/fonts/blob/main/ofl/martianmono/METADATA.pb ; https://github.com/google/fonts/blob/main/ofl/martianmono/OFL.txt |

## Big Shoulders Display con `next/font/google`

- `next/font/google` de Next.js 16.4.6 no trae una familia "Big Shoulders Display"; trae "Big Shoulders", variable, con los ejes `opsz` (10 a 72) y `wght` (100 a 900) (`node_modules/next/dist/compiled/@next/font/dist/google/font-data.json`).
- El repositorio de la familia define en su tabla STAT el eje "Optical size" con dos valores con nombre: "Text" = 10 y "Display" = 72 (https://github.com/xotypeco/big_shoulders/blob/master/Big-Shoulders/fonts/variable/BigShoulders%5Bopsz,wght%5D.ttf.stat.yaml). Su README reparte la familia estática en "Big Shoulders Text" y "Big Shoulders Display", y llama "Big Shoulders" a la variable (https://github.com/xotypeco/big_shoulders).
- Equivalencia aplicada: se carga "Big Shoulders" con `axes: ["opsz"]` y `app/globals.css` fija `font-variation-settings: "opsz" 72` en los titulares y en la utilidad `font-display`. Una prueba e2e comprueba que el fichero servido trae el eje (la anchura del texto cambia entre opsz 10 y 72) y que los titulares usan opsz 72.

## Cómo se sirven

`next/font/google` descarga los ficheros al compilar y los sirve desde el propio dominio: "no requests are sent to Google by the browser when the user visits your site" (guía `01-app/01-getting-started/13-fonts.md` de Next.js 16.4.6). La compilación sí contacta con Google Fonts. Una prueba e2e comprueba que el navegador no pide nada a `fonts.googleapis.com` ni a `fonts.gstatic.com`.
