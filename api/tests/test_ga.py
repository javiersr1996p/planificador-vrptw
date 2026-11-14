import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from vrptw.evaluate import evaluate
from vrptw.instances.solomon import load_solomon
from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.model import Fleet, Instance, Matrix, Solution
from vrptw.solvers.ga import solve

FAST = {"population": 20, "generations": 20}


def _ids(solution: Solution) -> list[int]:
    return [cid for route in solution.routes for cid in route]


def test_feasible_instance_serves_each_customer_once() -> None:
    # En el perfil `tfe` el retraso es blando y puede compensar ahorrar un
    # vehículo; la factibilidad se comprueba en Solomon, donde pesa 1000.
    instance = load_tfe2024("10c-1")
    solution = solve(instance)
    assert sorted(_ids(solution)) == sorted(c.id for c in instance.customers)
    assert all(solution.routes)
    solomon = load_solomon("C101", 25, truncated=True)
    assert evaluate(solomon, solve(solomon, **FAST)).feasible


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


@pytest.mark.parametrize("vehicles", [0, 1])
def test_insufficient_fleet_without_exception(vehicles: int) -> None:
    # Sin vehículos todos quedan sin atender; con uno, en perfil `tfe`, atender
    # con retraso cuesta menos que 10000 por cliente.
    instance = load_tfe2024("10c-1")
    instance = instance.model_copy(update={"fleet": Fleet(vehicles=vehicles)})
    solution = solve(instance, **FAST)
    assert len(solution.routes) <= vehicles
    assert len(_ids(solution)) == len(set(_ids(solution)))
    unserved = evaluate(instance, solution).unserved
    assert unserved == 10 - len(_ids(solution))
    assert unserved == (10 if vehicles == 0 else 0)


def test_same_seed_same_routes() -> None:
    instance = load_tfe2024("20c-1")
    routes = solve(instance, seed=5, **FAST).routes
    assert solve(instance, seed=5, **FAST).routes == routes
    assert solve(instance, seed=6, **FAST).routes != routes


def test_time_limit() -> None:
    instance = load_tfe2024("10c-1")
    start = time.perf_counter()
    solution = solve(instance, time_limit_s=0.3, generations=10**6)
    assert time.perf_counter() - start < 1.0
    assert solution.routes


@pytest.mark.parametrize(
    "instance",
    [load_tfe2024("20c-1"), load_solomon("c101", 25, truncated=True)],
    ids=["20c-1", "c101-25"],
)
def test_corrected_respects_fleet_without_repeats(instance: Instance) -> None:
    known = {c.id for c in instance.customers}
    for seed in range(20):
        solution = solve(instance, seed=seed, **FAST)
        ids = _ids(solution)
        assert len(solution.routes) <= instance.fleet.vehicles, seed
        assert len(ids) == len(set(ids)), seed
        assert set(ids) <= known, seed
        assert all(solution.routes), seed


def test_threads_match_sequential() -> None:
    instance = load_tfe2024("20c-1")
    seeds = [1, 2, 3, 4]
    # 40 generaciones para que las ejecuciones se solapen y, sin cerrojo, difieran
    params = {**FAST, "generations": 40}
    sequential = [solve(instance, seed=s, **params).routes for s in seeds]
    with ThreadPoolExecutor(max_workers=len(seeds)) as pool:
        threaded = list(
            pool.map(lambda s: solve(instance, seed=s, **params).routes, seeds)
        )
    assert threaded == sequential


def test_legacy_10_customers_five_routes_all_served() -> None:
    instance = load_tfe2024("10c-1")
    evaluation = evaluate(instance, solve(instance, legacy=True))
    assert evaluation.vehicles_used == 5
    assert evaluation.unserved == 0


@pytest.mark.parametrize("label", ["10c-3", "20c-8"])
def test_corrected_serves_customers_without_feasible_slot(label: str) -> None:
    # En 20c-8 el cliente 9 no puede llegar a tiempo desde el depósito; en 2024
    # el GA lo atendía con retraso. El corregido también, en lugar de dejarlo fuera.
    instance = load_tfe2024(label)
    for seed in range(3):
        solution = solve(instance, seed=seed, population=20, generations=5)
        assert evaluate(instance, solution).unserved == 0
