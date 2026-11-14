import time

import pytest

from vrptw.evaluate import evaluate
from vrptw.instances.solomon import coordinates, euclidean_matrix, load_solomon
from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.model import TFE, Customer, Depot, Fleet, Instance, Matrix, Solution
from vrptw.solvers import heuristic
from vrptw.solvers.aco import solve

FAST = {"iterations": 5, "ants": 10}


def _malformed(instance: Instance, solution: Solution) -> set[str]:
    kinds = {v.type for v in evaluate(instance, solution).violations}
    return kinds & {"duplicate", "unknown_customer", "fleet_exceeded"}


def test_feasible_instance_serves_everyone_once() -> None:
    instance = load_solomon("c101", 25, truncated=True)
    solution = solve(instance, **FAST)
    served = [cid for route in solution.routes for cid in route]
    assert sorted(served) == sorted(c.id for c in instance.customers)
    assert evaluate(instance, solution).feasible


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
    assert solve(single, **FAST).routes == [[1]]


def test_insufficient_fleet_leaves_unserved() -> None:
    instance = load_tfe2024("10c-1")
    instance = instance.model_copy(update={"fleet": Fleet(vehicles=1)})
    solution = solve(instance, **FAST)
    assert len(solution.routes) == 1
    assert not _malformed(instance, solution)
    assert evaluate(instance, solution).unserved > 0


def test_same_seed_same_routes() -> None:
    instance = load_tfe2024("20c-3")
    assert (
        solve(instance, seed=3, **FAST).routes == solve(instance, seed=3, **FAST).routes
    )


def test_time_limit() -> None:
    instance = load_solomon("c101", 100, truncated=True)
    start = time.perf_counter()
    solution = solve(instance, time_limit_s=0.01)
    assert time.perf_counter() - start < 1
    assert solution.routes
    assert not _malformed(instance, solution)


def test_colocated_customers_in_20c_5() -> None:
    instance = load_tfe2024("20c-5")
    assert not _malformed(instance, solve(instance, **FAST))


@pytest.mark.parametrize("point", [(0.0, 0.0), (3.0, 4.0)])
def test_all_candidates_at_distance_zero(point: tuple[float, float]) -> None:
    # En (0, 0) toda la matriz es nula; en (3, 4) solo lo es el arco entre clientes.
    x, y = point
    depot = Depot(x=0, y=0, ready=0)
    customers = [
        Customer(id=i, x=x, y=y, demand=1, ready=0, due=100, service=1) for i in (1, 2)
    ]
    instance = Instance(
        id="colocated",
        name="colocated",
        source="real",
        depot=depot,
        customers=customers,
        fleet=Fleet(vehicles=1),
        matrix=euclidean_matrix(coordinates(depot, customers)),
        cost_profile=TFE,
    )
    routes = solve(instance, **FAST).routes
    assert len(routes) == 1
    assert sorted(routes[0]) == [1, 2]


def test_never_worse_than_heuristic_on_10c_1() -> None:
    instance = load_tfe2024("10c-1")
    baseline = evaluate(instance, heuristic.solve(instance)).score
    for seed in range(5):
        assert evaluate(instance, solve(instance, seed=seed)).score <= baseline
