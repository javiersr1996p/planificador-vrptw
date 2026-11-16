"""Camuflaje de las instancias de Solomon que recibe el LLM."""

import json

import pytest
from test_sintef_reference import read_sintef_solution

from vrptw.bench.estimate import load_llm_instance
from vrptw.evaluate import evaluate
from vrptw.instances.camouflage import (
    Transform,
    camouflage,
    renumbering,
    restore_routes,
    transform,
)
from vrptw.instances.solomon import SOLOMON_SIZES, coordinates, load_solomon
from vrptw.llm.agent import MAX_TURNS, TOOLS
from vrptw.llm.prompts import agent_prompt
from vrptw.model import Instance, Solution
from vrptw.solvers.heuristic import solve as solve_heuristic

NAMES = ("C101", "R101", "RC101")
CASES = [(name, n) for name in NAMES for n in SOLOMON_SIZES]
# content_hash de los problemas de 2024 calculado antes de añadir el camuflaje
TFE2024_HASHES = {
    "10c-1": "80dc3fc03dd17b314d2a79eac614bd58429118e4d8e311679c093f3212587741",
    "10c-3": "261f352c623b83302de7721225164c6f31fe9f06aeea7974cc1408b929d8b583",
    "20c-1": "b53573dc0ac767502f97d2f17f21b014adf2f32d1b760d1de0967999e2ea7ea9",
    "20c-8": "24b03b62f03662d2031aea5a2ee8561368372e406c029cd1ba00864b49ff1e86",
}


def pair(name: str, n: int) -> tuple[Instance, Instance]:
    original = load_solomon(name, n, truncated=True)
    return original, camouflage(original)


def forward(original: Instance, routes: list[list[int]]) -> list[list[int]]:
    numbers = renumbering(original)
    return [[numbers[c] for c in route] for route in routes]


def references(original: Instance, name: str, n: int) -> list[list[list[int]]]:
    """La heurística y, con 100 clientes, la solución de SINTEF."""
    found = [solve_heuristic(original, seed=0).routes]
    if n == 100:
        found.append(read_sintef_solution(name.lower()))
    return found


@pytest.mark.parametrize(("name", "n"), CASES)
def test_cost_is_invariant_without_late_or_overload(name: str, n: int) -> None:
    original, camouflaged = pair(name, n)
    for routes in references(original, name, n):
        a = evaluate(original, Solution(routes=routes))
        b = evaluate(camouflaged, Solution(routes=forward(original, routes)))

        # el alcance de la invariancia exacta: sin retrasos ni exceso de carga
        assert a.total_late == 0 and a.overload == 0
        assert (b.score, b.distance, b.vehicles_used, b.feasible) == (
            a.score,
            a.distance,
            a.vehicles_used,
            a.feasible,
        )
    if n == 100:
        assert a.feasible  # la de SINTEF


@pytest.mark.parametrize(("name", "n"), CASES)
def test_invalid_solution_keeps_feasibility_and_distance(name: str, n: int) -> None:
    """Todos los clientes en un vehículo: exceso de carga y retrasos."""
    original, camouflaged = pair(name, n)
    routes = [[c.id for c in original.customers]]
    m = transform(original).m

    a = evaluate(original, Solution(routes=routes))
    b = evaluate(camouflaged, Solution(routes=forward(original, routes)))

    assert not a.feasible and not b.feasible
    assert [v.type for v in b.violations] == [v.type for v in a.violations]
    assert (b.distance, b.vehicles_used) == (a.distance, a.vehicles_used)
    assert b.overload == m * a.overload > 0
    # retrasos iguales salvo el redondeo de los tiempos retrasados k
    assert a.total_late > 0
    assert b.total_late == pytest.approx(a.total_late, rel=1e-12)
    w = original.cost_profile.w_overload
    assert b.score == pytest.approx(a.score + (m - 1) * w * a.overload, rel=1e-12)
    # traducidas de vuelta, se evalúan en la original
    assert restore_routes(original, forward(original, routes)) == routes


@pytest.mark.parametrize(("name", "n"), CASES)
def test_matrix_is_the_original_permuted(name: str, n: int) -> None:
    original, camouflaged = pair(name, n)
    assert original.matrix is not None and camouflaged.matrix is not None
    # los clientes camuflados van ordenados: el número k está en la posición k
    assert [c.id for c in camouflaged.customers] == list(range(1, n + 1))
    numbers = renumbering(original)
    pos = [0, *(numbers[c.id] for c in original.customers)]
    for kind in ("distance", "time"):
        old = getattr(original.matrix, kind)
        new = getattr(camouflaged.matrix, kind)
        assert [
            [new[pos[i]][pos[j]] for j in range(n + 1)] for i in range(n + 1)
        ] == old
    assert camouflaged.matrix.source == "euclidean_truncated"


@pytest.mark.parametrize(("name", "n"), CASES)
def test_transformed_data(name: str, n: int) -> None:
    original, camouflaged = pair(name, n)
    numbers = renumbering(original)
    assert sorted(numbers) == sorted(numbers.values()) == list(range(1, n + 1))
    assert any(old != new for old, new in numbers.items())

    dx, dy, k, m = transform(original)
    assert 1 <= dx <= 100 and 1 <= dy <= 100 and 50 <= k <= 500 and 2 <= m <= 9
    by_number = {c.id: c for c in camouflaged.customers}
    for c in original.customers:
        new = by_number[numbers[c.id]]
        assert (new.ready, new.due, new.service) == (c.ready + k, c.due + k, c.service)
        assert new.demand == c.demand * m
    assert original.depot.due is not None
    assert (camouflaged.depot.ready, camouflaged.depot.due) == (
        original.depot.ready + k,
        original.depot.due + k,
    )
    assert original.fleet.capacity is not None
    assert camouflaged.fleet.capacity == original.fleet.capacity * m
    assert camouflaged.fleet.vehicles == original.fleet.vehicles

    nodes = [(original.depot, camouflaged.depot)] + [
        (c, by_number[numbers[c.id]]) for c in original.customers
    ]
    for old, new in nodes:
        assert old.x is not None and old.y is not None
        assert (new.x, new.y) == (100 - old.y + dx, old.x + dy)
        assert new.x == int(new.x) >= 0 and new.y == int(new.y) >= 0
    assert coordinates(original.depot, original.customers) != coordinates(
        camouflaged.depot, camouflaged.customers
    )

    # sin perfil de tráfico, el retraso k no cambia ningún tiempo de viaje
    assert original.traffic_profile is None and camouflaged.traffic_profile is None
    same = {"source", "cost_profile"}
    assert camouflaged.model_dump(include=same) == original.model_dump(include=same)
    assert camouflaged.id == f"{original.id}-cam"
    assert not any(label.lower() in camouflaged.name.lower() for label in NAMES)


def test_deterministic() -> None:
    original = load_solomon("C101", 100, truncated=True)
    assert camouflage(original) == camouflage(load_solomon("C101", 100, truncated=True))
    # fijado: sale de SHA-256, así que es el mismo en cualquier proceso; cambiarlo
    # invalidaría la caché de las ejecuciones LLM ya hechas
    assert transform(original) == Transform(dx=60, dy=43, k=241, m=5)
    assert (
        camouflage(original).content_hash()
        == "a8a459bec9db41fdd79308672ee695526018c0fd42637028f6fedc9b49d9bd56"
    )


def test_route_translation_round_trip() -> None:
    original, camouflaged = pair("R101", 25)
    routes = [[c.id for c in original.customers[:10]], [], [25, 11, 12]]
    moved = forward(original, routes)
    assert moved != routes
    assert restore_routes(original, moved) == routes

    # números que no son de ningún cliente y repetidos: las mismas violaciones
    odd = [[0, moved[0][0], 26], [moved[0][0], -1]]
    restored = restore_routes(original, odd)
    assert restored == [[0, routes[0][0], 26], [routes[0][0], -1]]
    a = evaluate(camouflaged, Solution(routes=odd))
    b = evaluate(original, Solution(routes=restored))
    assert [v.type for v in a.violations] == [v.type for v in b.violations]
    assert (a.score, a.distance) == (b.score, b.distance)


def test_traffic_profile_is_rejected() -> None:
    original = load_solomon("C101", 25, truncated=True)
    timed = original.model_copy(
        update={"traffic_profile": [{"from": 0, "to": 100, "factor": 1.5}]}
    )
    with pytest.raises(ValueError, match="tráfico"):
        camouflage(timed)


@pytest.mark.parametrize(("name", "n"), CASES)
def test_llm_gets_the_camouflaged_instance(name: str, n: int) -> None:
    original = load_solomon(name, n, truncated=True)
    instance = load_llm_instance(name, n)
    assert instance == camouflage(original)
    # lo que ve el modelo: el prompt del agente (el directo es su comienzo) y las
    # herramientas
    prompt = agent_prompt(instance, MAX_TURNS)
    seen = (prompt + json.dumps(TOOLS)).lower()
    for word in (*(x.lower() for x in NAMES), "solomon", instance.id, instance.name):
        assert word not in seen
    # ni el horizonte original (1236, 230 o 240) ni la capacidad 200
    assert original.depot.due is not None and original.fleet.capacity is not None
    for value, phrase in (
        (original.depot.due, "no later than {:g};"),
        (original.fleet.capacity, "capacity of {:g},"),
    ):
        assert phrase.format(value) not in prompt
    assert instance.depot.due is not None and instance.fleet.capacity is not None
    assert f"no later than {instance.depot.due:g};" in prompt
    assert f"capacity of {instance.fleet.capacity:g}," in prompt


@pytest.mark.parametrize(("label", "digest"), TFE2024_HASHES.items())
def test_tfe2024_problems_unchanged(label: str, digest: str) -> None:
    instance = load_llm_instance(label, None)
    assert instance.id == f"tfe2024-{label}"
    assert instance.content_hash() == digest


def test_real_case_substitute_unchanged() -> None:
    assert load_llm_instance("real", 12).id == "real-12-sustituto"
