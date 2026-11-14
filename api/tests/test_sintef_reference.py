"""Contrasta el evaluador con las soluciones de referencia de SINTEF (100 clientes).

Rutas en data/solomon/soluciones_sintef/. Vehículos y distancia publicados por SINTEF
en data/solomon_bks.json (convención hierarchical_double); los recálculos de cada
solución en las dos aritméticas solo están en docs/fuentes/solomon.md, sección 6.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from vrptw.evaluate import evaluate, score
from vrptw.instances.solomon import SOLOMON_DIR, SOLOMON_NAMES, load_solomon
from vrptw.model import SOLOMON, Evaluation, Instance, Solution, Violation

BKS = Path(__file__).resolve().parents[1] / "data" / "solomon_bks.json"
SOLUTIONS = SOLOMON_DIR / "soluciones_sintef"

# docs/fuentes/solomon.md, sección 6 ("Soluciones de referencia con rutas"), columna
# "Doble precisión": SINTEF publica la cifra redondeada a dos decimales, así que la
# tolerancia de 1e-5 se aplica a este recálculo de seis decimales.
DOUBLE_DISTANCE = {
    "c101": 828.936867,
    "c201": 591.556557,
    "r101": 1650.799240,
    "r201": 1252.371222,
    "rc101": 1696.949157,
    "rc201": 1406.940088,
}
# docs/fuentes/solomon.md, sección 6, columna "Misma solución, arcos truncados".
TRUNCATED_DISTANCE = {
    "c101": 827.3,
    "c201": 589.1,
    "r101": 1645.7,
    "r201": 1248.4,
    "rc101": 1693.2,
    "rc201": 1403.3,
}


def read_sintef_solution(name: str) -> list[list[int]]:
    """Rutas del fichero: una línea `Route k : i j ...` por ruta, sin el depósito."""
    lines = (SOLUTIONS / f"{name}.txt").read_text(encoding="utf-8").splitlines()
    header, value = lines[0].split(":", 1)
    assert header.strip() == "Instance name" and value.strip().lower() == name
    return [
        [int(t) for t in line.split(":", 1)[1].split()]
        for line in lines
        if line.startswith("Route")
    ]


def hierarchical_bks(name: str) -> dict[str, Any]:
    entries = json.loads(BKS.read_text(encoding="utf-8"))
    return next(
        e
        for e in entries
        if e["instance"] == name.upper()
        and e["n"] == 100
        and e["convention"] == "hierarchical_double"
    )


def evaluate_reference(
    name: str, *, truncated: bool
) -> tuple[Instance, list[list[int]], Evaluation]:
    instance = load_solomon(name, truncated=truncated)
    routes = read_sintef_solution(name)
    return instance, routes, evaluate(instance, Solution(routes=routes))


@pytest.mark.parametrize("name", SOLOMON_NAMES)
def test_double_precision_matches_sintef(name: str) -> None:
    _, _, ev = evaluate_reference(name, truncated=False)
    bks = hierarchical_bks(name)

    assert ev.violations == [] and ev.feasible
    assert ev.vehicles_used == bks["vehicles"]
    assert round(ev.distance, 2) == bks["distance"]
    assert ev.distance == pytest.approx(DOUBLE_DISTANCE[name], abs=1e-5)


@pytest.mark.parametrize("name", SOLOMON_NAMES)
def test_truncated_matches_documented(name: str) -> None:
    _, _, ev = evaluate_reference(name, truncated=True)

    assert ev.violations == [] and ev.feasible
    assert ev.distance == pytest.approx(TRUNCATED_DISTANCE[name], abs=1e-6)


@pytest.mark.parametrize("truncated", [False, True])
@pytest.mark.parametrize("name", SOLOMON_NAMES)
def test_score_is_distance(name: str, truncated: bool) -> None:
    instance, routes, ev = evaluate_reference(name, truncated=truncated)

    assert instance.cost_profile == SOLOMON
    assert ev.score == ev.distance
    assert score(instance, routes) == ev.score


def test_removed_customer_is_unserved() -> None:
    instance, routes, _ = evaluate_reference("r101", truncated=False)
    removed = routes[0].pop(0)

    ev = evaluate(instance, Solution(routes=routes))

    assert not ev.feasible
    assert ev.violations == [Violation(type="unserved", customer=removed)]


def test_swapped_customers_are_late() -> None:
    instance, routes, _ = evaluate_reference("r101", truncated=False)
    first, last = routes[0][0], routes[0][-1]
    customers = {c.id: c for c in instance.customers}
    # Tras el intercambio, `first` se sirve después de `last`: empieza como pronto en
    # ready + service de `last`, y eso ya supera su due.
    assert customers[last].ready + customers[last].service > customers[first].due
    routes[0][0], routes[0][-1] = last, first

    ev = evaluate(instance, Solution(routes=routes))

    assert not ev.feasible
    assert Violation(type="late", route=0, customer=first) in ev.violations


def test_repeated_customer_is_duplicate() -> None:
    instance, routes, _ = evaluate_reference("r101", truncated=False)
    repeated = routes[0][0]
    routes[1].append(repeated)

    ev = evaluate(instance, Solution(routes=routes))

    assert not ev.feasible
    assert Violation(type="duplicate", route=1, customer=repeated) in ev.violations
