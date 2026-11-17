"""Geocodificación (Geoapify) y matriz por carretera (openrouteservice) para casos
reales, con una matriz en línea recta como alternativa sin servicio.

Convención de casos reales: distancia en km y tiempo en minutos. Los puntos son
`(lat, lon)`; en la matriz, la posición 0 es el depósito.

Las claves de API llegan como argumento y no se guardan en nada que sobreviva a la
llamada: cada llamada crea su cliente HTTP y lo cierra, y las cachés se indexan por
dirección o por puntos, nunca por clave. Los fallos salen como `GeoError`, con un
mensaje propio que no incluye la URL (la de Geoapify lleva la clave) ni el texto
del error original, y sin encadenar la excepción original.

Rutas, parámetros, límites y atribuciones obligatorias de ambos servicios, con sus
fuentes: `docs/fuentes/hosting-y-mapas.md`, sección 6.
"""

import logging
import math
from time import monotonic, sleep
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict

from vrptw.model import Matrix

# En depuración, httpx registra la URL de cada petición (la de Geoapify lleva la
# clave en `apiKey`) y httpcore, el detalle de la conexión.
for _logger in ("httpx", "httpcore"):
    logging.getLogger(_logger).setLevel(logging.WARNING)

GEOAPIFY = "geoapify"
ORS = "openrouteservice"
GEOAPIFY_URL = "https://api.geoapify.com/v1/geocode/search"
# `api.openrouteservice.org` tenía el apagado previsto para noviembre de 2026 (anuncio del equipo de
# openrouteservice); esta es la ruta que usa el cliente oficial de Python sobre
# el dominio nuevo.
ORS_MATRIX_URL = "https://api.heigit.org/openrouteservice/v2/matrix/driving-car/json"
GEO_TIMEOUT_S = 20.0
# Plan Free de Geoapify: "Up to 5 requests/second".
GEOAPIFY_MIN_INTERVAL_S = 1 / 5
# API alojada de openrouteservice: orígenes x destinos por petición.
ORS_MAX_CELLS = 3500
# Supuesto propio, ilustrativo: velocidad media urbana para estimar tiempos cuando
# no hay matriz por carretera. No procede de ninguna fuente.
FALLBACK_SPEED_KMH = 30.0
# Radio medio volumétrico de la Tierra (NASA, Earth Fact Sheet).
EARTH_RADIUS_KM = 6371.0
# Topes de las cachés en memoria (supuestos propios): una matriz de 101 x 101 ocupa
# unos 0,7 MB en listas de Python (medido con `sys.getsizeof`); al llenarse, la
# caché se vacía entera.
GEOCODE_CACHE_MAX = 10_000
MATRIX_CACHE_MAX = 32


class GeoError(Exception):
    """Fallo de un servicio de mapas. `kind`: `auth`, `rate_limit`, `timeout`,
    `network`, `api` o `unroutable` (dos puntos sin ruta por carretera)."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind


class GeocodeResult(BaseModel):
    """Una dirección geocodificada. Sin coincidencias: `found = False` y el resto,
    `None`. `label` es la dirección completa que devuelve el servicio."""

    model_config = ConfigDict(frozen=True)

    address: str
    found: bool
    lat: float | None = None
    lon: float | None = None
    label: str | None = None


Point = tuple[float, float]

_GEOCODE_CACHE: dict[str, GeocodeResult] = {}
_MATRIX_CACHE: dict[tuple[Point, ...], Matrix] = {}


def _status_error(service: str, status: int) -> GeoError:
    if status == 429 or (service == ORS and status == 403):
        # openrouteservice responde 403 al agotar la cuota diaria y 429 al superar
        # la de un minuto.
        return GeoError(
            "rate_limit", f"{service}: límite de uso alcanzado (HTTP {status})"
        )
    if status in (401, 403):
        return GeoError(
            "auth", f"{service}: clave de API no válida o sin permiso (HTTP {status})"
        )
    return GeoError("api", f"{service}: error del servicio (HTTP {status})")


def _send(
    client: httpx.Client, service: str, method: str, url: str, **kwargs: Any
) -> Any:
    """Cuerpo JSON de una respuesta 200; cualquier otra cosa es `GeoError`."""
    try:
        response = client.request(method, url, **kwargs)
        if response.status_code == 200:
            return response.json()
        error = _status_error(service, response.status_code)
    except httpx.TimeoutException:
        error = GeoError("timeout", f"{service}: sin respuesta en {GEO_TIMEOUT_S:g} s")
    except httpx.HTTPError:
        error = GeoError("network", f"{service}: error de red")
    except ValueError:  # cuerpo que no es JSON
        error = GeoError("api", f"{service}: respuesta ilegible")
    # Fuera del `except`: así no arrastra la excepción original en `__context__`.
    raise error


def _normalize(address: str) -> str:
    return " ".join(address.lower().split())


def _geocode_result(data: Any, address: str) -> GeocodeResult:
    """Primer resultado de una respuesta de Geoapify con `format=json`."""
    result: GeocodeResult | None = None
    try:
        results = data["results"]
        if not results:
            result = GeocodeResult(address=address, found=False)
        else:
            first = results[0]
            result = GeocodeResult(
                address=address,
                found=True,
                lat=float(first["lat"]),
                lon=float(first["lon"]),
                label=first.get("formatted"),
            )
    except (KeyError, IndexError, TypeError, ValueError):
        pass
    if result is None:
        raise GeoError("api", f"{GEOAPIFY}: respuesta ilegible")
    return result


def geocode(
    addresses: list[str],
    api_key: str,
    transport: httpx.BaseTransport | None = None,
) -> list[GeocodeResult]:
    """Geocodifica cada dirección con Geoapify, en el orden recibido.

    Una petición por dirección no vista antes, a no más de 5 por segundo (plan
    Free), con el texto normalizado (minúsculas y espacios colapsados), que es
    también la clave de la caché. Una dirección sin coincidencias es un resultado
    con `found = False`, y también se guarda. `transport` sustituye al de httpx
    (pruebas). Clave vacía, error HTTP, tiempo agotado o respuesta ilegible:
    `GeoError`; los resultados obtenidos antes del fallo quedan en la caché.
    """
    if not api_key:
        raise GeoError("auth", f"{GEOAPIFY}: falta la clave de API")
    results: list[GeocodeResult] = []
    last_sent: float | None = None
    with httpx.Client(transport=transport, timeout=GEO_TIMEOUT_S) as client:
        for address in addresses:
            text = _normalize(address)
            result = _GEOCODE_CACHE.get(text)
            if result is None and not text:
                result = GeocodeResult(address=text, found=False)
            elif result is None:
                if last_sent is not None:
                    sleep(max(0.0, last_sent + GEOAPIFY_MIN_INTERVAL_S - monotonic()))
                last_sent = monotonic()
                params = {"text": text, "format": "json", "limit": 1, "apiKey": api_key}
                data = _send(client, GEOAPIFY, "GET", GEOAPIFY_URL, params=params)
                result = _geocode_result(data, text)
                if len(_GEOCODE_CACHE) >= GEOCODE_CACHE_MAX:
                    _GEOCODE_CACHE.clear()
                _GEOCODE_CACHE[text] = result
            results.append(result.model_copy(update={"address": address}))
    return results


def _table(
    data: Any, key: str, sources: range, n: int, divisor: float
) -> list[list[float]]:
    """Filas `sources` de la tabla `key` de openrouteservice, divididas por
    `divisor`. Una celda nula es un par de puntos sin ruta."""
    rows: list[list[float]] | None = None
    missing: tuple[int, int] | None = None
    try:
        table = data[key]
        if len(table) == len(sources) and all(len(row) == n for row in table):
            missing = next(
                (
                    (i, j)
                    for i, row in zip(sources, table, strict=True)
                    for j, value in enumerate(row)
                    if value is None
                ),
                None,
            )
            if missing is None:
                rows = [[float(value) / divisor for value in row] for row in table]
    except (KeyError, TypeError, ValueError):
        pass
    if missing is not None:
        i, j = missing
        raise GeoError(
            "unroutable", f"{ORS}: no hay ruta por carretera del punto {i} al {j}"
        )
    if rows is None:
        raise GeoError("api", f"{ORS}: respuesta ilegible")
    return rows


def _fetch_road_matrix(
    points: tuple[Point, ...], api_key: str, transport: httpx.BaseTransport | None
) -> Matrix:
    n = len(points)
    block = ORS_MAX_CELLS // n
    locations = [[lon, lat] for lat, lon in points]  # openrouteservice: [lon, lat]
    distance: list[list[float]] = []
    time: list[list[float]] = []
    with httpx.Client(transport=transport, timeout=GEO_TIMEOUT_S) as client:
        for start in range(0, n, block):
            sources = range(start, min(start + block, n))
            body = {
                "locations": locations,
                "sources": list(sources),
                "metrics": ["distance", "duration"],
                "units": "m",
            }
            data = _send(
                client,
                ORS,
                "POST",
                ORS_MATRIX_URL,
                json=body,
                headers={"Authorization": api_key},
            )
            distance += _table(data, "distances", sources, n, 1000)  # m a km
            time += _table(data, "durations", sources, n, 60)  # s a min
    return Matrix(
        distance=distance, time=time, source=ORS, distance_unit="km", time_unit="min"
    )


def road_matrix(
    points: list[Point],
    api_key: str,
    transport: httpx.BaseTransport | None = None,
) -> Matrix:
    """Matriz de distancias (km) y tiempos (min) en coche entre `points` (`(lat,
    lon)`), con openrouteservice.

    Bloques de `ORS_MAX_CELLS // n` orígenes contra los n destinos (101 puntos: 34
    filas, 3 peticiones). Si falla cualquier bloque se descarta todo, sin mezclar
    fuentes ni guardar nada en la caché, que se indexa por la tupla de puntos.
    Clave vacía, error HTTP, tiempo agotado, respuesta ilegible o una celda nula
    (`unroutable`): `GeoError`. Menos de 2 puntos o más de `ORS_MAX_CELLS`:
    `ValueError`. `transport` sustituye al de httpx (pruebas).
    """
    if not api_key:
        raise GeoError("auth", f"{ORS}: falta la clave de API")
    n = len(points)
    if not 2 <= n <= ORS_MAX_CELLS:
        raise ValueError(f"road_matrix admite de 2 a {ORS_MAX_CELLS} puntos, no {n}")
    key = tuple((float(lat), float(lon)) for lat, lon in points)
    matrix = _MATRIX_CACHE.get(key)
    if matrix is None:
        matrix = _fetch_road_matrix(key, api_key, transport)
        if len(_MATRIX_CACHE) >= MATRIX_CACHE_MAX:
            _MATRIX_CACHE.clear()
        _MATRIX_CACHE[key] = matrix
    return matrix.model_copy(deep=True)


def _haversine_km(a: Point, b: Point) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(min(1.0, h)))


def haversine_matrix(points: list[Point]) -> Matrix:
    """Distancia en línea recta (km) entre `points` (`(lat, lon)`) y tiempo a
    `FALLBACK_SPEED_KMH` (min). Simétrica y con diagonal 0."""
    n = len(points)
    distance = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            distance[i][j] = distance[j][i] = _haversine_km(points[i], points[j])
    time = [[d / FALLBACK_SPEED_KMH * 60 for d in row] for row in distance]
    return Matrix(
        distance=distance,
        time=time,
        source="haversine_fallback",
        distance_unit="km",
        time_unit="min",
    )
