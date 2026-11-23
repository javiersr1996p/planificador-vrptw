"""Regresión contra los costes publicados en 2024.

`calculate_route_details` (Heuristics.ipynb) suma el regreso al depósito solo si
`route and customer_idx`, y `customer_idx` es el índice interno del último
cliente (0 para el cliente 1 del CSV): una ruta que termina en el cliente 1 no
paga el regreso. Las rutas no cambian; el test resta ese tramo al score.
"""

import json
from pathlib import Path

import pytest

from vrptw.evaluate import score
from vrptw.instances.tfe2024 import TFE2024_USED, load_tfe2024
from vrptw.model import Instance
from vrptw.solvers.heuristic import solve

REFERENCE = Path(__file__).parent / "data" / "tfe2024_reference.json"
PUBLISHED = json.loads(REFERENCE.read_text(encoding="utf-8"))["costs"]["heuristic"]

# Score del port sin ajuste (coste actual)
EXPECTED_SCORE = {
    "10c-1": 6107.44,
    "10c-3": 15899.12,
    "10c-4": 6156.81,
    "10c-5": 4928.61,
    "10c-8": 5926.57,
    "10c-9": 5987.48,
    "20c-1": 10437.33,
    "20c-3": 9584.47,
    "20c-5": 11568.88,
    "20c-8": 21213.69,
    "20c-9": 7871.71,
    "20c-10": 8621.66,
}


def _routes(instance: Instance) -> list[list[int]]:
    return solve(instance).routes


def _legacy_score(instance: Instance, routes: list[list[int]]) -> float:
    assert instance.matrix is not None
    skipped = sum(instance.matrix.distance[1][0] for r in routes if r[-1] == 1)
    return score(instance, routes) - skipped


@pytest.mark.legado
@pytest.mark.parametrize("label", TFE2024_USED)
def test_matches_published_cost(label: str) -> None:
    instance = load_tfe2024(label)
    assert _legacy_score(instance, _routes(instance)) == pytest.approx(
        PUBLISHED[label][0], abs=0.01
    )


@pytest.mark.legado
@pytest.mark.parametrize("label", TFE2024_USED)
def test_current_score_regression(label: str) -> None:
    instance = load_tfe2024(label)
    assert score(instance, _routes(instance)) == pytest.approx(
        EXPECTED_SCORE[label], abs=0.01
    )
