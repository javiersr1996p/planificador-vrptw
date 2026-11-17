"""API HTTP con `TestClient`, sin red: los servicios de mapas se sustituyen."""

import json
import logging
from collections.abc import Iterator
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from vrptw import geo
from vrptw.api import main
from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.model import Instance, Matrix

RUNS = Path(__file__).resolve().parents[1] / "runs"
CSV = (
    "CUSTOMER,ADDRESS,LAT,LON,DEMAND,READY_TIME,DUE_TIME,SERVICE_TIME\n"
    "0,Almacén,40.4,-3.7,0,08:00,20:00,0\n"
    "1,Calle A,40.41,-3.71,5,09:00,12:00,10\n"
    "2,Calle B,40.42,-3.69,3,10:00,14:00,10\n"
)
FLEET = {"vehicles": 2, "capacity": 50}
ORIGIN = {"Origin": "http://localhost:3000"}


@pytest.fixture
def client() -> Iterator[TestClient]:
    before = sorted(RUNS.rglob("*"))
    with TestClient(main.app) as c:
        yield c
    assert sorted(RUNS.rglob("*")) == before, "la API no debe escribir en runs/"


@pytest.fixture(scope="module")
def instance() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(
        load_tfe2024("10c-1").model_dump_json(by_alias=True)
    )
    return data


def test_health_and_models(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    body = client.get("/models").json()
    assert body["provider"] == "anthropic"
    assert {"model_id", "price_in_per_mtok", "checked_on"} <= set(body["models"][0])


def test_parse_csv(client: TestClient) -> None:
    r = client.post(
        "/instances/parse-csv", json={"csv": CSV, "name": "x", "fleet": FLEET}
    )
    assert r.status_code == 200
    body = r.json()
    inst = Instance.model_validate(body)
    assert inst.matrix is None and inst.source == "real"
    assert body["id"] == "csv-" + inst.content_hash()[:8]
    assert body["customers"][0]["ready"] == 540


def test_parse_csv_errors(client: TestClient) -> None:
    bad = CSV + "3,,,,x,09:00,10:00,1\n4,,40.4,-3.7,1,11:00,10:00,1\n"
    r = client.post(
        "/instances/parse-csv", json={"csv": bad, "name": "x", "fleet": FLEET}
    )
    assert r.status_code == 422
    rows = r.json()["detail"]
    assert sorted({d["row"] for d in rows}) == [5, 6] and all(d["msg"] for d in rows)


def test_parse_csv_limits(client: TestClient) -> None:
    body = {"csv": CSV, "name": "x", "fleet": {"vehicles": 10**9, "capacity": 5}}
    assert client.post("/instances/parse-csv", json=body).status_code == 422
    body = {"csv": "x" * 100_001, "name": "x", "fleet": FLEET}
    assert client.post("/instances/parse-csv", json=body).status_code == 422


def fake_geocode(addresses: list[str], key: str) -> list[geo.GeocodeResult]:
    return [
        geo.GeocodeResult(address=a, found=True, lat=1.0, lon=2.0, label=a)
        for a in addresses
    ]


def test_geocode(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GEOAPIFY_API_KEY", raising=False)
    assert client.post("/geocode", json={"addresses": ["a"]}).status_code == 503
    monkeypatch.setenv("GEOAPIFY_API_KEY", "k")
    monkeypatch.setattr(geo, "geocode", fake_geocode)
    r = client.post("/geocode", json={"addresses": ["Calle Mayor 1, Madrid, España"]})
    assert r.status_code == 200 and r.json()["results"][0]["lat"] == 1.0
    assert client.post("/geocode", json={"addresses": []}).status_code == 422
    assert client.post("/geocode", json={"addresses": ["a"] * 102}).status_code == 422

    def boom(addresses: list[str], key: str) -> list[geo.GeocodeResult]:
        raise geo.GeoError("auth", "geoapify: clave rechazada")

    monkeypatch.setattr(geo, "geocode", boom)
    r = client.post("/geocode", json={"addresses": ["a"]})
    assert r.status_code == 503 and r.json()["detail"] == "geoapify: clave rechazada"


def test_geocode_daily_cap(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEOAPIFY_API_KEY", "k")
    calls: list[list[str]] = []

    def counted(addresses: list[str], key: str) -> list[geo.GeocodeResult]:
        calls.append(addresses)
        return fake_geocode(addresses, key)

    monkeypatch.setattr(geo, "geocode", counted)
    quota = main._GEOCODE_QUOTA
    monkeypatch.setattr(quota, "day", datetime.now(UTC).date())
    monkeypatch.setattr(quota, "used", main.GEOCODE_DAILY_MAX - 1)
    assert client.post("/geocode", json={"addresses": ["a", "b"]}).status_code == 429
    assert client.post("/geocode", json={"addresses": ["a"]}).status_code == 200
    r = client.post("/geocode", json={"addresses": ["b"]})
    assert r.status_code == 429 and "Tope diario" in r.json()["detail"]
    assert calls == [["a"]]
    monkeypatch.setattr(quota, "day", date(2000, 1, 1))  # otro día UTC: vuelve a 0
    assert client.post("/geocode", json={"addresses": ["b"]}).status_code == 200
    assert quota.used == 1


POINTS = {"points": [{"lat": 40.4, "lon": -3.7}, {"lat": 40.5, "lon": -3.6}]}


def test_matrix_fallback_without_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ORS_API_KEY", raising=False)
    r = client.post("/matrix", json=POINTS)
    assert r.status_code == 200 and r.json()["source"] == "haversine_fallback"


def road(points: list[geo.Point], key: str) -> Matrix:
    return geo.haversine_matrix(points).model_copy(
        update={"source": "openrouteservice"}
    )


def test_matrix_geo_error_and_road(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setenv("ORS_API_KEY", "k")

    def boom(points: list[geo.Point], key: str) -> Matrix:
        raise geo.GeoError("timeout", "openrouteservice: tiempo agotado")

    monkeypatch.setattr(geo, "road_matrix", boom)
    with caplog.at_level(logging.WARNING, logger="vrptw.api"):
        r = client.post("/matrix", json=POINTS)
    assert r.json()["source"] == "haversine_fallback"
    assert "timeout" in caplog.text and "tiempo agotado" not in caplog.text
    monkeypatch.setattr(geo, "road_matrix", road)
    assert client.post("/matrix", json=POINTS).json()["source"] == "openrouteservice"


def test_matrix_daily_cap(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ORS_API_KEY", "k")
    calls: list[list[geo.Point]] = []

    def counted(points: list[geo.Point], key: str) -> Matrix:
        calls.append(points)
        return road(points, key)

    monkeypatch.setattr(geo, "road_matrix", counted)
    quota = main._MATRIX_QUOTA
    monkeypatch.setattr(quota, "day", datetime.now(UTC).date())
    monkeypatch.setattr(quota, "used", main.MATRIX_DAILY_MAX - 1)
    assert client.post("/matrix", json=POINTS).json()["source"] == "openrouteservice"
    r = client.post("/matrix", json=POINTS)
    assert r.status_code == 200 and r.json()["source"] == "haversine_fallback"
    assert len(calls) == 1


def test_matrix_validation(client: TestClient) -> None:
    assert (
        client.post("/matrix", json={"points": POINTS["points"][:1]}).status_code == 422
    )
    bad = {"points": [{"lat": 91, "lon": 0}, {"lat": 0, "lon": 0}]}
    assert client.post("/matrix", json=bad).status_code == 422
    assert (
        client.post(
            "/matrix", json={"points": [{"lat": 0, "lon": 0}] * 102}
        ).status_code
        == 422
    )


def test_solve_classic(client: TestClient, instance: dict[str, Any]) -> None:
    r = client.post(
        "/solve/classic",
        json={"instance": instance, "method": "heuristic", "time_limit_s": 2},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "classic" and body["evaluation"]["feasible"] is not None
    assert body["params"] == {"time_limit_s": 2}


def test_solve_rejects_free_params(
    client: TestClient, instance: dict[str, Any]
) -> None:
    base = {"instance": instance, "method": "heuristic"}
    for extra in ({"legacy": True}, {"iterations": 0}, {"params": {"legacy": True}}):
        assert client.post("/solve/classic", json={**base, **extra}).status_code == 422
    assert (
        client.post("/solve/classic", json={**base, "time_limit_s": 61}).status_code
        == 422
    )
    assert (
        client.post("/solve/classic", json={**base, "time_limit_s": 0}).status_code
        == 422
    )
    assert client.post("/solve/classic", json={**base, "seed": -1}).status_code == 422
    assert (
        client.post("/solve/classic", json={**base, "method": "x"}).status_code == 422
    )


def test_solve_busy(client: TestClient, instance: dict[str, Any]) -> None:
    assert main._SOLVE_LOCK.acquire(blocking=False)
    try:
        r = client.post(
            "/solve/classic", json={"instance": instance, "method": "heuristic"}
        )
    finally:
        main._SOLVE_LOCK.release()
    assert r.status_code == 503 and r.headers["Retry-After"] == "5"


def test_evaluate(client: TestClient, instance: dict[str, Any]) -> None:
    ids = [c["id"] for c in instance["customers"]]
    r = client.post("/evaluate", json={"instance": instance, "routes": [ids]})
    assert r.status_code == 200 and "score" in r.json()
    too_many = {"instance": instance, "routes": [[1]] * 101}
    assert client.post("/evaluate", json=too_many).status_code == 422
    too_long = {"instance": instance, "routes": [[1] * 100] * 3}
    assert client.post("/evaluate", json=too_long).status_code == 422


def test_matrix_required(client: TestClient, instance: dict[str, Any]) -> None:
    no_matrix = {**instance, "matrix": None}
    r = client.post("/evaluate", json={"instance": no_matrix, "routes": [[1]]})
    assert r.status_code == 422 and r.json()["detail"][0]["loc"] == "instance.matrix"
    r = client.post("/solve/classic", json={"instance": no_matrix, "method": "tabu"})
    assert r.status_code == 422


def test_invalid_instance_has_readable_loc(
    client: TestClient, instance: dict[str, Any]
) -> None:
    bad = json.loads(json.dumps(instance))
    del bad["customers"][3]["due"]
    r = client.post("/evaluate", json={"instance": bad, "routes": []})
    assert r.status_code == 422
    assert r.json()["detail"] == [
        {"loc": "instance.customers.3.due", "msg": "Field required"}
    ]


def test_too_many_customers(client: TestClient, instance: dict[str, Any]) -> None:
    big = json.loads(json.dumps(instance))
    big["customers"] = [{**big["customers"][0], "id": i + 1} for i in range(101)]
    r = client.post("/evaluate", json={"instance": big, "routes": []})
    assert r.status_code == 422
    assert "customers" in r.json()["detail"][0]["loc"]


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("fleet", "vehicles"), 10**9),
        (("fleet", "vehicles"), 0),
        (("fleet", "capacity"), 0),
        (("customers", 0, "demand"), -1),
        (("customers", 0, "service"), -1),
        (("matrix", "distance", 0, 1), -1),
        (("cost_profile", "w_late"), -1),
        (("customers", 0, "demand"), 1e308),
        (("matrix", "time", 1, 0), 1e308),
        (("customers", 0, "id"), 10**10),
        (("id",), "x" * 101),
        (("name",), "x" * 201),
        (("depot", "address"), "x" * 201),
        (("customers", 0, "address"), "x" * 201),
        (("matrix", "source"), "x" * 101),
        (("matrix", "distance_unit"), "x" * 101),
        (("matrix", "time_unit"), "x" * 101),
    ],
)
def test_public_limits(
    client: TestClient, instance: dict[str, Any], path: tuple[Any, ...], value: Any
) -> None:
    bad = json.loads(json.dumps(instance))
    target = bad
    for p in path[:-1]:
        target = target[p]
    target[path[-1]] = value
    r = client.post("/evaluate", json={"instance": bad, "routes": []})
    assert r.status_code == 422, path
    [error] = r.json()["detail"]
    assert set(error) == {"loc", "msg"}
    assert error["loc"] == ".".join(map(str, ("instance", *path)))


def test_traffic_profile_limits(client: TestClient, instance: dict[str, Any]) -> None:
    for profile in (
        [{"from": 0, "to": 10, "factor": 0}],
        [{"from": 10, "to": 10, "factor": 1}],
        [{"from": i, "to": i + 1, "factor": 1} for i in range(25)],
    ):
        bad = {**instance, "traffic_profile": profile}
        r = client.post("/evaluate", json={"instance": bad, "routes": []})
        assert r.status_code == 422, profile
    ok = {**instance, "traffic_profile": [{"from": 0, "to": 10, "factor": 1.5}]}
    assert (
        client.post("/evaluate", json={"instance": ok, "routes": []}).status_code == 200
    )


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_non_finite_rejected(
    client: TestClient, instance: dict[str, Any], literal: str
) -> None:
    bad = json.loads(json.dumps(instance))
    bad["matrix"]["distance"][0][1] = "@@"
    raw = json.dumps({"instance": bad, "routes": []}).replace('"@@"', literal)
    r = client.post(
        "/evaluate", content=raw, headers={"Content-Type": "application/json"}
    )
    assert r.status_code == 422
    assert "matrix.distance.0.1" in r.json()["detail"][0]["loc"]


def test_body_size_limits(client: TestClient, instance: dict[str, Any]) -> None:
    big = {"instance": instance, "routes": [], "pad": "x" * main.MAX_BODY_BYTES}
    r = client.post("/evaluate", json=big, headers=ORIGIN)
    assert r.status_code == 413 and "2 MB" in r.json()["detail"]
    assert r.headers["access-control-allow-origin"] == ORIGIN["Origin"]
    chunked = client.post(  # sin Content-Length: httpx lo envía troceado
        "/evaluate",
        content=iter([json.dumps({"instance": instance, "routes": []}).encode()]),
        headers={"Content-Type": "application/json"},
    )
    assert chunked.status_code == 411 and chunked.json()["detail"]


def test_unexpected_error_is_500_with_cors(
    client: TestClient,
    instance: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def boom(*args: Any) -> Any:
        raise RuntimeError("detalle que no debe salir")

    monkeypatch.setattr(main, "evaluate", boom)
    with caplog.at_level(logging.DEBUG):
        r = client.post(
            "/evaluate", json={"instance": instance, "routes": []}, headers=ORIGIN
        )
    assert r.status_code == 500 and r.json() == {"detail": "error interno"}
    assert r.headers["access-control-allow-origin"] == ORIGIN["Origin"]
    assert "RuntimeError" in caplog.text and "detalle" not in caplog.text


def test_cors_preflight(client: TestClient) -> None:
    def preflight(origin: str) -> Any:
        return client.options(
            "/solve/classic",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-llm-key",
            },
        )

    ok = preflight("http://localhost:3000")
    assert ok.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "access-control-allow-credentials" not in ok.headers
    assert "access-control-allow-origin" not in preflight("http://evil.example").headers
