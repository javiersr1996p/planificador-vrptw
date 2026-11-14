import time

import pytest

from vrptw.evaluate import evaluate, score
from vrptw.instances.solomon import load_solomon
from vrptw.instances.tfe2024 import TFE2024_USED, load_tfe2024
from vrptw.model import Fleet, Instance, Matrix
from vrptw.solvers.tabu import solve

SMALL = [
    load_tfe2024("10c-1"),
    load_tfe2024("20c-3"),
    load_solomon("c101", 25, truncated=True),
]


@pytest.mark.parametrize("instance", SMALL[1:], ids=lambda i: i.id)
def test_valid_solution(instance: Instance) -> None:
    routes = solve(instance, seed=1, iterations=10).routes
    served = sorted(cid for route in routes for cid in route)
    assert served == sorted(c.id for c in instance.customers)
    assert all(routes)
    assert len(routes) <= instance.fleet.vehicles


def test_single_customer() -> None:
    full = load_tfe2024("10c-1")
    assert full.matrix is not None
    matrix = Matrix(
        distance=[row[:2] for row in full.matrix.distance[:2]],
        time=[row[:2] for row in full.matrix.time[:2]],
        source=full.matrix.source,
        distance_unit=full.matrix.distance_unit,
        time_unit=full.matrix.time_unit,
    )
    single = Instance(
        **{
            **full.model_dump(),
            "customers": full.customers[:1],
            "matrix": matrix,
            "fleet": Fleet(vehicles=2),
        }
    )
    assert solve(single).routes == [[1]]


def test_insufficient_fleet() -> None:
    instance = load_tfe2024("10c-1")
    one = instance.model_copy(update={"fleet": Fleet(vehicles=1)})
    evaluation = evaluate(one, solve(one, iterations=5))
    assert (evaluation.vehicles_used, evaluation.unserved) == (1, 0)

    none = instance.model_copy(update={"fleet": Fleet(vehicles=0)})
    solution = solve(none)
    assert solution.routes == []
    assert evaluate(none, solution).unserved == 10


def test_same_seed_same_routes() -> None:
    instance = load_tfe2024("20c-3")
    assert (
        solve(instance, seed=3, iterations=10).routes
        == solve(instance, seed=3, iterations=10).routes
    )
    assert (
        solve(instance, seed=3, iterations=0).routes
        != solve(instance, seed=4, iterations=0).routes
    )


def test_time_limit() -> None:
    instance = load_solomon("c101", 100, truncated=True)
    start = time.perf_counter()
    solve(instance, time_limit_s=0.3)  # sin límite tardaría alrededor de un minuto
    assert time.perf_counter() - start < 0.8
    assert (
        solve(instance, time_limit_s=0).routes == solve(instance, iterations=0).routes
    )


@pytest.mark.parametrize("instance", SMALL, ids=lambda i: i.id)
def test_never_worse_than_initial(instance: Instance) -> None:
    for seed in range(3):
        initial = score(instance, solve(instance, seed=seed, iterations=0).routes)
        final = score(instance, solve(instance, seed=seed, iterations=10).routes)
        assert final <= initial


def test_search_improves_initial() -> None:
    # En 2024 la búsqueda no hacía ningún movimiento
    instance = load_tfe2024("10c-1")
    initial = score(instance, solve(instance, iterations=0).routes)
    assert score(instance, solve(instance, iterations=10).routes) < initial


def test_initial_matches_notebook() -> None:
    # Comprobado contra una copia literal de generate_initial_solution
    assert solve(load_tfe2024("10c-1"), seed=0, iterations=0).routes == [
        [5, 8],
        [9, 3],
        [2, 1],
        [6, 10],
        [7, 4],
    ]


@pytest.mark.parametrize("label", TFE2024_USED)
def test_initial_uses_whole_fleet(label: str) -> None:
    instance = load_tfe2024(label)
    for seed in range(5):
        solution = solve(instance, seed=seed, iterations=0)
        evaluation = evaluate(instance, solution)
        assert (evaluation.vehicles_used, evaluation.unserved) == (
            instance.fleet.vehicles,
            0,
        )
