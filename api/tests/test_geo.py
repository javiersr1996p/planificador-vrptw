"""Geocodificación y matriz por carretera sin red: el transporte de httpx se
sustituye por un `MockTransport` que devuelve cuerpos con la forma documentada
(`tests/data/geo/`). Las pruebas de higiene ponen el logging raíz en DEBUG con un
manejador a la salida de error, como `test_key_hygiene.py`, para que cualquier
registro con la clave acabe en `caplog` y en `capfd`."""

import json
import logging
import math
import sys
import traceback
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest

from vrptw import geo
from vrptw.geo import GeocodeResult, GeoError

KEY = "geo-centinela-01"
DATA = Path(__file__).parent / "data" / "geo"
ADDRESS = "1313 Broadway, Tacoma, WA 98402, United States of America"
POINTS = [(40.416705, -3.703582), (40.406842, -3.689499), (40.419992, -3.692127)]

Handler = Callable[[httpx.Request], httpx.Response]


def body(name: str) -> Any:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


class Network:
    """Transporte simulado que guarda las peticiones recibidas."""

    def __init__(self, handler: Handler) -> None:
        self.requests: list[httpx.Request] = []
        self.handler = handler
        self.transport = httpx.MockTransport(self.record)

    def record(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.handler(request)

    def bodies(self) -> list[dict[str, Any]]:
        return [json.loads(r.content) for r in self.requests]


def ok(name: str) -> Handler:
    data = body(name)
    return lambda request: httpx.Response(200, json=data)


@pytest.fixture(autouse=True)
def clean(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[float]]:
    """Cachés vacías y pausas entre peticiones registradas, sin esperar."""
    pauses: list[float] = []
    monkeypatch.setattr(geo, "sleep", pauses.append)
    geo._GEOCODE_CACHE.clear()
    geo._MATRIX_CACHE.clear()
    yield pauses
    geo._GEOCODE_CACHE.clear()
    geo._MATRIX_CACHE.clear()


# --- geocode ---------------------------------------------------------------


def test_geocode_happy_path() -> None:
    net = Network(ok("geoapify_found.json"))
    [result] = geo.geocode([f"  {ADDRESS.upper()} "], KEY, transport=net.transport)

    assert result == GeocodeResult(
        address=f"  {ADDRESS.upper()} ",
        found=True,
        lat=47.25094496732003,
        lon=-122.43941302945888,
        label=ADDRESS,
    )
    [request] = net.requests
    assert request.method == "GET"
    assert str(request.url).startswith(geo.GEOAPIFY_URL + "?")
    assert dict(request.url.params) == {
        "text": ADDRESS.lower(),
        "format": "json",
        "limit": "1",
        "apiKey": KEY,
    }


def test_geocode_not_found_is_a_result() -> None:
    net = Network(ok("geoapify_not_found.json"))
    [result] = geo.geocode(["zzqx wvvq 99999"], KEY, transport=net.transport)
    assert result == GeocodeResult(address="zzqx wvvq 99999", found=False)
    assert result.lat is None and result.lon is None and result.label is None


def test_geocode_blank_address_needs_no_request() -> None:
    net = Network(ok("geoapify_found.json"))
    [result] = geo.geocode(["   "], KEY, transport=net.transport)
    assert result == GeocodeResult(address="   ", found=False)
    assert net.requests == []


def test_geocode_cache_by_normalized_address() -> None:
    net = Network(ok("geoapify_found.json"))
    same = [ADDRESS, f"  {ADDRESS.upper()}  ", ADDRESS.replace(" ", "   ")]
    first = geo.geocode(same, KEY, transport=net.transport)
    assert len(net.requests) == 1  # las tres normalizan igual
    assert [r.address for r in first] == same  # cada una conserva su texto
    assert {(r.lat, r.lon, r.label) for r in first} == {
        (47.25094496732003, -122.43941302945888, ADDRESS)
    }

    second = geo.geocode(same, KEY, transport=net.transport)
    assert second == first and len(net.requests) == 1
    assert KEY not in repr(geo._GEOCODE_CACHE)


def test_geocode_respects_free_rate(clean: list[float]) -> None:
    net = Network(ok("geoapify_not_found.json"))
    geo.geocode(["a 1", "b 2", "c 3", "a  1"], KEY, transport=net.transport)
    assert len(net.requests) == 3
    # Una pausa antes de cada petición salvo la primera, nunca mayor que 1/5 s.
    assert len(clean) == 2
    assert all(0 < p <= geo.GEOAPIFY_MIN_INTERVAL_S for p in clean)


# --- road_matrix -----------------------------------------------------------


def test_road_matrix_happy_path() -> None:
    net = Network(ok("ors_matrix_3.json"))
    m = geo.road_matrix(POINTS, KEY, transport=net.transport)

    assert m.source == "openrouteservice"
    assert (m.distance_unit, m.time_unit) == ("km", "min")
    distance = [[0, 1.60934, 2.5005], [1.6502, 0, 1.2], [2.6, 1.18075, 0]]
    time = [[0, 5, 7.5], [310 / 60, 0, 4], [460 / 60, 230.5 / 60, 0]]
    for got, expected in zip(m.distance + m.time, distance + time, strict=True):
        assert got == pytest.approx(expected)
    [request] = net.requests
    assert request.method == "POST" and str(request.url) == geo.ORS_MATRIX_URL
    assert request.headers["authorization"] == KEY
    assert net.bodies() == [
        {
            "locations": [[lon, lat] for lat, lon in POINTS],
            "sources": [0, 1, 2],
            "metrics": ["distance", "duration"],
            "units": "m",
        }
    ]


def synthetic(request: httpx.Request) -> httpx.Response:
    """Respuesta 200 para cualquier bloque: distancia (m) = 1000 i + j y duración
    (s) = 60 (1000 i + j), con i el origen y j el destino."""
    data = json.loads(request.content)
    n = len(data["locations"])
    cells = [[1000 * i + j for j in range(n)] for i in data["sources"]]
    return httpx.Response(
        200,
        json={
            "distances": cells,
            "durations": [[60 * c for c in row] for row in cells],
        },
    )


def grid(n: int) -> list[tuple[float, float]]:
    return [(40 + i / 1000, -3 - i / 1000) for i in range(n)]


def test_road_matrix_101_points_in_3_blocks() -> None:
    net = Network(synthetic)
    m = geo.road_matrix(grid(101), KEY, transport=net.transport)

    assert [b["sources"] for b in net.bodies()] == [
        list(range(34)),
        list(range(34, 68)),
        list(range(68, 101)),
    ]
    assert all(len(b["locations"]) == 101 for b in net.bodies())
    assert all("destinations" not in b for b in net.bodies())  # todos, por defecto
    assert len(m.distance) == len(m.time) == 101
    assert all(len(row) == 101 for row in m.distance + m.time)
    for i in (0, 33, 34, 67, 68, 100):
        for j in (0, 50, 100):
            assert m.distance[i][j] == pytest.approx(i + j / 1000)
            assert m.time[i][j] == pytest.approx(1000 * i + j)


def test_road_matrix_cache_by_points() -> None:
    net = Network(ok("ors_matrix_3.json"))
    first = geo.road_matrix(POINTS, KEY, transport=net.transport)
    first.distance[0][1] = 999.0  # lo que devuelve no es la copia de la caché
    second = geo.road_matrix(POINTS, KEY, transport=net.transport)

    assert len(net.requests) == 1
    assert second.distance[0][1] == pytest.approx(1.60934)
    assert KEY not in repr(geo._MATRIX_CACHE)

    geo.road_matrix(POINTS[::-1], KEY, transport=net.transport)
    assert len(net.requests) == 2  # otro orden, otra matriz


def test_road_matrix_null_cell_is_unroutable() -> None:
    net = Network(ok("ors_matrix_3_null.json"))
    with pytest.raises(GeoError) as info:
        geo.road_matrix(POINTS, KEY, transport=net.transport)
    assert info.value.kind == "unroutable"
    assert "del punto 0 al 2" in str(info.value)
    assert geo._MATRIX_CACHE == {}


def test_road_matrix_failed_block_discards_everything() -> None:
    def second_block_fails(request: httpx.Request) -> httpx.Response:
        if json.loads(request.content)["sources"][0] == 34:
            return httpx.Response(500)
        return synthetic(request)

    net = Network(second_block_fails)
    with pytest.raises(GeoError) as info:
        geo.road_matrix(grid(101), KEY, transport=net.transport)
    assert info.value.kind == "api" and "HTTP 500" in str(info.value)
    assert len(net.requests) == 2  # el tercer bloque ya no se pide
    assert geo._MATRIX_CACHE == {}

    retry = Network(synthetic)
    geo.road_matrix(grid(101), KEY, transport=retry.transport)
    assert len(retry.requests) == 3  # nada del intento fallido se reutiliza


def test_road_matrix_rejects_wrong_shape() -> None:
    bad = {"distances": [[0, 1]], "durations": [[0, 1]]}  # 1 fila de 3
    net = Network(lambda request: httpx.Response(200, json=bad))
    with pytest.raises(GeoError) as info:
        geo.road_matrix(POINTS, KEY, transport=net.transport)
    assert info.value.kind == "api"


@pytest.mark.parametrize("n", [0, 1])
def test_road_matrix_needs_two_points(n: int) -> None:
    with pytest.raises(ValueError, match="de 2 a"):
        geo.road_matrix(grid(n), KEY)


# --- haversine_matrix ------------------------------------------------------


def test_haversine_matrix() -> None:
    # Un grado de meridiano o de ecuador mide 2 pi R / 360 km.
    degree_km = 2 * math.pi * 6371.0 / 360
    m = geo.haversine_matrix([(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (40.0, -3.0)])

    assert m.source == "haversine_fallback"
    assert (m.distance_unit, m.time_unit) == ("km", "min")
    assert m.distance[0][1] == pytest.approx(degree_km, abs=1e-9)
    assert m.distance[0][2] == pytest.approx(degree_km, abs=1e-9)
    assert degree_km == pytest.approx(111.19, abs=0.01)
    # 30 km/h: 2 minutos por km
    assert m.time[0][1] == pytest.approx(2 * degree_km)
    for table in (m.distance, m.time):
        assert all(table[i][i] == 0 for i in range(4))
        assert all(table[i][j] == table[j][i] for i in range(4) for j in range(4))


# --- fallos e higiene de la clave ------------------------------------------

Call = Callable[[httpx.BaseTransport], object]


def call_geocode(transport: httpx.BaseTransport) -> object:
    return geo.geocode([ADDRESS], KEY, transport=transport)


def call_matrix(transport: httpx.BaseTransport) -> object:
    return geo.road_matrix(POINTS, KEY, transport=transport)


def leaky_status(status: int) -> Handler:
    """Error HTTP cuyo cuerpo y cabeceras repiten la clave."""
    return lambda request: httpx.Response(
        status, json={"error": f"invalid key {KEY}"}, headers={"x-echo": KEY}
    )


def leaky_raise(exc: type[httpx.TransportError]) -> Handler:
    def handler(request: httpx.Request) -> httpx.Response:
        raise exc(f"fallo con {request.url} ({KEY})", request=request)

    return handler


def not_json(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, content=f"<html>{KEY}</html>".encode())


FAILURES: list[Any] = [
    pytest.param(leaky_status(500), "api", id="500"),
    pytest.param(leaky_status(503), "api", id="503"),
    pytest.param(leaky_status(429), "rate_limit", id="429"),
    pytest.param(leaky_status(401), "auth", id="401"),
    pytest.param(leaky_raise(httpx.ReadTimeout), "timeout", id="read-timeout"),
    pytest.param(leaky_raise(httpx.ConnectTimeout), "timeout", id="connect-timeout"),
    pytest.param(leaky_raise(httpx.ConnectError), "network", id="connect-error"),
    pytest.param(not_json, "api", id="not-json"),
]
CALLS: list[Any] = [
    pytest.param(call_geocode, id="geocode"),
    pytest.param(call_matrix, id="matrix"),
]


@pytest.fixture
def hygiene(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> Iterator[None]:
    """Logging raíz en DEBUG hacia caplog y stderr."""
    caplog.set_level(logging.DEBUG)
    root = logging.getLogger()
    monkeypatch.setattr(root, "level", logging.DEBUG)
    handler = logging.StreamHandler(sys.stderr)
    handler.setLevel(logging.DEBUG)
    root.addHandler(handler)
    try:
        yield
    finally:
        root.removeHandler(handler)


def chain(exc: BaseException) -> list[BaseException]:
    seen: list[BaseException] = []
    todo: list[BaseException | None] = [exc]
    while todo:
        e = todo.pop()
        if e is not None and e not in seen:
            seen.append(e)
            todo += [e.__cause__, e.__context__]
    return seen


def assert_clean(
    exc: GeoError, caplog: pytest.LogCaptureFixture, capfd: pytest.CaptureFixture[str]
) -> None:
    assert exc.__cause__ is None and exc.__context__ is None
    for e in chain(exc):
        assert KEY not in str(e) and KEY not in repr(e)
        assert KEY not in repr(vars(e)) and KEY not in repr(e.args)
    assert KEY not in "".join(traceback.format_exception(exc))
    assert "geoapify.com" not in str(exc) and "heigit.org" not in str(exc)  # sin URL
    assert KEY not in caplog.text
    assert all(KEY not in r.getMessage() for r in caplog.records)
    out, err = capfd.readouterr()
    assert KEY not in out and KEY not in err


def assert_key_was_sent(net: Network) -> None:
    """Sin esto las comprobaciones de higiene estarían vacías: la clave sí viaja."""
    assert net.requests
    for request in net.requests:
        sent = request.url.params.get("apiKey") or request.headers.get("authorization")
        assert sent == KEY


@pytest.mark.parametrize("call", CALLS)
@pytest.mark.parametrize(("handler", "kind"), FAILURES)
def test_failure_is_geo_error_without_key(
    call: Call,
    handler: Handler,
    kind: str,
    hygiene: None,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    net = Network(handler)
    with pytest.raises(GeoError) as info:
        call(net.transport)

    assert info.value.kind == kind
    assert len(net.requests) == 1  # sin reintentos
    assert_key_was_sent(net)
    assert_clean(info.value, caplog, capfd)
    assert geo._GEOCODE_CACHE == {} and geo._MATRIX_CACHE == {}


@pytest.mark.parametrize(
    ("call", "kind"),
    [
        pytest.param(call_geocode, "auth", id="geocode"),
        # openrouteservice responde 403 al agotar la cuota diaria
        pytest.param(call_matrix, "rate_limit", id="matrix"),
    ],
)
def test_403_by_service(call: Call, kind: str) -> None:
    with pytest.raises(GeoError) as info:
        call(Network(leaky_status(403)).transport)
    assert info.value.kind == kind and "HTTP 403" in str(info.value)


@pytest.mark.parametrize("call", ["geocode", "road_matrix"])
def test_empty_key_is_auth_without_request(call: str) -> None:
    net = Network(ok("geoapify_found.json"))
    with pytest.raises(GeoError) as info:
        if call == "geocode":
            geo.geocode([ADDRESS], "", transport=net.transport)
        else:
            geo.road_matrix(POINTS, "", transport=net.transport)
    assert info.value.kind == "auth"
    assert net.requests == []


@pytest.mark.parametrize("call", CALLS)
def test_success_leaves_no_trace(
    call: Call,
    hygiene: None,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    name = "geoapify_found.json" if call is call_geocode else "ors_matrix_3.json"
    data = body(name)
    net = Network(
        lambda request: httpx.Response(200, json=data, headers={"x-echo": KEY})
    )
    result = call(net.transport)

    assert_key_was_sent(net)
    assert KEY not in repr(result)
    assert KEY not in repr(geo._GEOCODE_CACHE) + repr(geo._MATRIX_CACHE)
    assert KEY not in caplog.text
    out, err = capfd.readouterr()
    assert KEY not in out and KEY not in err


def test_control_detects_a_leak(
    hygiene: None, caplog: pytest.LogCaptureFixture
) -> None:
    """Control: con el logger de httpx en DEBUG la URL de Geoapify, con la clave,
    sí llega a `caplog`, así que las pruebas anteriores detectarían esa fuga."""
    caplog.set_level(logging.DEBUG, logger="httpx")
    call_geocode(Network(ok("geoapify_found.json")).transport)
    assert KEY in caplog.text
