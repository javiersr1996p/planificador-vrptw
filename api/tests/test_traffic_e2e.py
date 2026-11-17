"""Tráfico de extremo a extremo: perfiles horarios del JSON público vía HTTP."""

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from vrptw.api.main import app, check_public
from vrptw.model import Instance

PROFILES_JSON = (
    Path(__file__).resolve().parents[2] / "web/public/data/traffic-profiles.json"
)
ROUTES = [[1, 2], [3, 4]]


def _profiles() -> dict[str, dict[str, Any]]:
    data = json.loads(PROFILES_JSON.read_text(encoding="utf-8"))
    return {p["id"]: p for p in data["profiles"]}


def _matrix() -> dict[str, Any]:
    time = [
        [0, 20, 40, 30, 50],
        [20, 0, 20, 30, 40],
        [40, 20, 0, 25, 30],
        [30, 30, 25, 0, 20],
        [50, 40, 30, 20, 0],
    ]
    distance = [[v / 2 for v in row] for row in time]
    return {
        "distance": distance,
        "time": time,
        "source": "haversine_fallback",
        "distance_unit": "km",
        "time_unit": "min",
    }


def _instance(profile: str, depot_ready: float = 420) -> dict[str, Any]:
    customers = [
        {
            "id": i,
            "lat": 40.40 + 0.01 * i,
            "lon": -3.70 + 0.01 * i,
            "demand": 5,
            "ready": 400,
            "due": 1200,
            "service": 15,
        }
        for i in range(1, 5)
    ]
    return {
        "id": f"traffic-{profile}",
        "name": "Tráfico",
        "source": "real",
        "depot": {"lat": 40.40, "lon": -3.70, "ready": depot_ready, "due": 1300},
        "customers": customers,
        "fleet": {"vehicles": 2, "capacity": 50},
        "matrix": _matrix(),
        "traffic_profile": _profiles()[profile]["windows"],
        "cost_profile": {
            "w_wait": 0,
            "w_late": 1000,
            "w_vehicle": 0,
            "w_unserved": 10000,
            "w_overload": 1000,
        },
    }


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def _evaluate(client: TestClient, instance: dict[str, Any]) -> dict[str, Any]:
    r = client.post("/evaluate", json={"instance": instance, "routes": ROUTES})
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def test_mismas_rutas_misma_distancia_y_llegadas_distintas(client: TestClient) -> None:
    plano = _evaluate(client, _instance("plano"))
    punta = _evaluate(client, _instance("horas-punta"))
    assert plano["distance"] == punta["distance"]
    llegadas_plano = [s["arrival"] for route in plano["stops"] for s in route]
    llegadas_punta = [s["arrival"] for route in punta["stops"] for s in route]
    assert llegadas_plano != llegadas_punta
    # Sale a las 07:00 (fuera de franja) y llega al cliente 1 a las 07:20, igual.
    assert plano["stops"][0][0]["arrival"] == punta["stops"][0][0]["arrival"] == 440
    # Sale del cliente 1 a las 07:35 (dentro de [450, 570)): 20 min pasan a 30.
    assert plano["stops"][0][1]["arrival"] == 475
    assert punta["stops"][0][1]["arrival"] == 485


def test_solve_classic_coincide_con_evaluate(client: TestClient) -> None:
    instance = _instance("horas-punta")
    r = client.post(
        "/solve/classic",
        json={"instance": instance, "method": "heuristic", "seed": 0},
    )
    assert r.status_code == 200, r.text
    record = r.json()
    routes = record["solution"]["routes"]
    assert routes
    assert record["evaluation"] == _evaluate_routes(client, instance, routes)


def _evaluate_routes(
    client: TestClient, instance: dict[str, Any], routes: list[list[int]]
) -> dict[str, Any]:
    r = client.post("/evaluate", json={"instance": instance, "routes": routes})
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def test_salida_exacta_en_to_usa_factor_uno(client: TestClient) -> None:
    # El depósito sale en 570 = `to` de la franja [450, 570): factor 1.
    en_to = _evaluate(client, _instance("horas-punta", depot_ready=570))
    assert en_to["stops"][0][0]["arrival"] == 570 + 20
    # Un minuto antes sigue dentro de la franja: 20 * 1.5 = 30.
    dentro = _evaluate(client, _instance("horas-punta", depot_ready=569))
    assert dentro["stops"][0][0]["arrival"] == 569 + 30


@pytest.mark.parametrize("profile_id", ["plano", "horas-punta"])
def test_perfiles_del_json_pasan_check_public_y_tienen_nota(profile_id: str) -> None:
    profile = _profiles()[profile_id]
    assert profile["note"].strip()
    check_public(Instance.model_validate(_instance(profile_id)))
