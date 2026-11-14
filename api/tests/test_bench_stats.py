import math

from vrptw.bench.stats import (
    EXACT,
    HIERARCHICAL,
    compare_hierarchical,
    find_bks,
    sample_std,
    summarize,
    summarize_solomon_exact,
)
from vrptw.model import Evaluation


def make_eval(distance: float, vehicles: int = 3, feasible: bool = True) -> Evaluation:
    return Evaluation(
        stops=[],
        distance=distance,
        total_wait=0,
        total_late=0,
        vehicles_used=vehicles,
        unserved=0,
        overload=0,
        score=distance,
        violations=[],
        feasible=feasible,
    )


def test_known_list() -> None:
    s = summarize(
        [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0], n_runs=8, n_feasible=8, metric="d"
    )
    assert s["mean"] == 5.0
    assert math.isclose(s["std"], math.sqrt(32 / 7))  # n - 1, no n
    assert s["best"] == 2.0
    assert s["feasibility_rate"] == 1.0


def test_single_repetition_has_no_std() -> None:
    assert sample_std([3.0]) is None
    assert summarize([3.0], n_runs=1, n_feasible=1, metric="d")["std"] is None


def test_all_infeasible_gap_is_absent_not_zero() -> None:
    bks = find_bks("C101", 25, EXACT)
    s = summarize_solomon_exact([make_eval(200, feasible=False)] * 2, bks)
    assert s["gap_mean_pct"] is None and s["gap_best_pct"] is None
    assert s["mean"] is None and s["feasibility_rate"] == 0.0
    assert s["convention"] == EXACT


def test_gap_uses_only_feasible_runs() -> None:
    bks = find_bks("C101", 25, EXACT)
    assert bks is not None and bks["distance"] == 191.3
    s = summarize_solomon_exact(
        [make_eval(210.0), make_eval(999.0, feasible=False)], bks
    )
    assert s["n_values"] == 1 and s["feasibility_rate"] == 0.5
    assert math.isclose(s["gap_best_pct"], 100 * (210.0 - 191.3) / 191.3)


def test_missing_or_pending_bks_is_absent() -> None:
    assert find_bks("C101", 25, HIERARCHICAL) is None  # no existe a 25
    pending = [
        {
            "instance": "C101",
            "n": 25,
            "convention": EXACT,
            "distance": "PENDIENTE DE CONFIRMAR",
        }
    ]
    assert find_bks("C101", 25, EXACT, pending) is None
    assert summarize_solomon_exact([make_eval(200)], None)["gap_mean_pct"] is None


def test_secondary_only_with_same_vehicle_count() -> None:
    bks = find_bks("R101", 100, HIERARCHICAL)
    assert bks is not None and bks["vehicles"] == 19
    out = compare_hierarchical(
        [make_eval(1700.0, 19), make_eval(1600.0, 20), make_eval(1700.0, 19, False)],
        bks,
    )
    gaps = [r["gap_pct"] for r in out["runs"]]
    assert math.isclose(gaps[0], 100 * (1700.0 - bks["distance"]) / bks["distance"])
    assert gaps[1] is None and gaps[2] is None
    assert out["convention"] == HIERARCHICAL
    assert out["runs"][1]["vehicles"] == 20 and out["runs"][1]["distance"] == 1600.0
