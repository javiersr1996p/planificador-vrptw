"""Casos reales de ejemplo en Madrid (`web/public/data/cases/`), precalculados.

Se prueban sin red: el visitante los ve sin depender de servicios externos.
"""

import json
import os
import socket
import statistics
from pathlib import Path
from typing import Any

import pytest

from vrptw import geo
from vrptw.api.main import check_public
from vrptw.evaluate import evaluate
from vrptw.model import Instance
from vrptw.solvers.heuristic import solve

ROOT = Path(__file__).resolve().parents[2]
CASES = ROOT / "web" / "public" / "data" / "cases"
SIZES = {"madrid-12": 12, "madrid-25": 25}
LAT_RANGE = (40.30, 40.56)
LON_RANGE = (-3.84, -3.52)
KEY_DIRS = (
    ROOT / "web" / "public" / "data",
    ROOT / "api" / "data",
    ROOT / "api" / "tests" / "data" / "geo",
)


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("la prueba no debe abrir sockets")

    monkeypatch.setattr(socket, "socket", refuse)


def load(case: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(
        (CASES / f"{case}.json").read_text(encoding="utf-8")
    )
    return data


def instance(case: str) -> Instance:
    return Instance.model_validate(load(case)["instance"])


@pytest.mark.parametrize("case", SIZES)
def test_instance_shape(case: str) -> None:
    data = load(case)
    inst = instance(case)
    assert inst.id == case
    assert inst.source == "real"
    assert len(inst.customers) == SIZES[case]
    assert inst.matrix is not None
    assert inst.matrix.source == "openrouteservice"
    assert (inst.matrix.distance_unit, inst.matrix.time_unit) == ("km", "min")
    assert {r["method"] for r in data["runs"]} <= {"heuristic", "aco", "ga", "tabu"}
    assert {"built_on", "attribution", "note"} <= data.keys()
    assert "Geoapify" in data["attribution"]
    assert "openrouteservice" in data["attribution"]
    assert "OpenStreetMap" in data["attribution"]
    assert "CC BY-SA 4.0" in data["attribution"]


@pytest.mark.parametrize("case", SIZES)
def test_road_distances_are_plausible(case: str) -> None:
    """Ninguna fila ni columna tiene una mediana carretera/recta mayor de 2,5."""
    inst = instance(case)
    assert inst.matrix is not None
    points = [(s.lat, s.lon) for s in [inst.depot, *inst.customers]]
    straight = geo.haversine_matrix(points).distance
    n = len(points)
    for k in range(n):
        for name, pairs in (
            ("fila", [(k, i) for i in range(n) if i != k]),
            ("columna", [(i, k) for i in range(n) if i != k]),
        ):
            ratios = [
                inst.matrix.distance[a][b] / straight[a][b]
                for a, b in pairs
                if straight[a][b] >= 0.3
            ]
            assert statistics.median(ratios) <= 2.5, f"{name} {k} de {case}"


@pytest.mark.parametrize("case", SIZES)
def test_windows_and_coordinates(case: str) -> None:
    inst = instance(case)
    stops = [inst.depot, *inst.customers]
    for stop in stops:
        assert stop.lat is not None and stop.lon is not None
        assert LAT_RANGE[0] <= stop.lat <= LAT_RANGE[1]
        assert LON_RANGE[0] <= stop.lon <= LON_RANGE[1]
        assert stop.address
    for c in inst.customers:
        assert 0 <= c.ready <= c.due <= 1440
    assert inst.depot.due is not None
    assert 0 <= inst.depot.ready <= inst.depot.due <= 1440


@pytest.mark.parametrize("case", SIZES)
def test_heuristic_solves_it(case: str) -> None:
    inst = instance(case)
    result = evaluate(inst, solve(inst))
    assert result.unserved == 0
    assert result.feasible


@pytest.mark.parametrize("case", SIZES)
def test_public_limits(case: str) -> None:
    check_public(instance(case))


def test_api_keys_not_in_data_files() -> None:
    keys = [
        os.environ[name].encode()
        for name in ("GEOAPIFY_API_KEY", "ORS_API_KEY")
        if os.environ.get(name)
    ]
    for directory in KEY_DIRS:
        for path in directory.rglob("*"):
            if path.is_file():
                content = path.read_bytes()
                for key in keys:
                    assert key not in content, f"clave en {path.relative_to(ROOT)}"
