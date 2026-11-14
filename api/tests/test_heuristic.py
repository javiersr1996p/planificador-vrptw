from vrptw.evaluate import evaluate
from vrptw.instances.solomon import load_solomon
from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.model import Fleet, Instance, Matrix
from vrptw.solvers.heuristic import solve
from vrptw.solvers.registry import SOLVERS


def test_10c_1_routes() -> None:
    assert solve(load_tfe2024("10c-1")).routes == [
        [9, 2],
        [3, 8, 10],
        [7, 5],
        [4, 6],
        [1],
    ]


def test_deterministic_and_registered() -> None:
    instance = load_tfe2024("20c-3")
    assert solve(instance).routes == solve(instance, seed=7, time_limit_s=1).routes
    assert SOLVERS["heuristic"](instance).routes == solve(instance).routes


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


def test_insufficient_fleet_leaves_unserved() -> None:
    instance = load_tfe2024("10c-1")
    instance = instance.model_copy(update={"fleet": Fleet(vehicles=1)})
    solution = solve(instance)
    assert solution.routes == [[9, 2]]
    assert evaluate(instance, solution).unserved == 8


def test_solomon_capacity_and_depot_due() -> None:
    instance = load_solomon("c101", 25, truncated=True)
    solution = solve(instance)
    kinds = {v.type for v in evaluate(instance, solution).violations}
    assert not kinds & {"capacity", "depot_due", "late"}
    assert sum(map(len, solution.routes)) > 0
