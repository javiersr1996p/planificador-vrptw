from datetime import UTC, datetime
from typing import Any

import pytest
from pydantic import ValidationError

from vrptw.model import (
    SOLOMON,
    TFE,
    Customer,
    Depot,
    Evaluation,
    Fleet,
    Instance,
    Matrix,
    RunRecord,
    Solution,
    StopEvaluation,
)


def customer(cid: int, **kw: Any) -> Customer:
    base: dict[str, Any] = {
        "id": cid,
        "x": cid,
        "y": 0,
        "demand": 1,
        "ready": 0,
        "due": 100,
        "service": 1,
    }
    return Customer(**(base | kw))


def make_instance(**kw: Any) -> Instance:
    base: dict[str, Any] = {
        "id": "i1",
        "name": "demo",
        "source": "tfe2024",
        "depot": Depot(x=0, y=0, ready=0),
        "customers": [customer(1), customer(2)],
        "fleet": Fleet(vehicles=2),
        "cost_profile": TFE,
    }
    return Instance(**(base | kw))


def test_hash_stable_after_roundtrip() -> None:
    inst = make_instance()
    reloaded = Instance.model_validate_json(inst.model_dump_json())
    assert reloaded.content_hash() == inst.content_hash()
    assert len(inst.content_hash()) == 64


def test_hash_ignores_name_and_id() -> None:
    assert (
        make_instance(name="otro", id="i2").content_hash()
        == make_instance().content_hash()
    )


def test_hash_changes_with_cost_weight() -> None:
    other = TFE.model_copy(update={"w_wait": 11})
    assert (
        make_instance(cost_profile=other).content_hash()
        != make_instance().content_hash()
    )
    assert (
        make_instance(cost_profile=SOLOMON).content_hash()
        != make_instance().content_hash()
    )


def test_hash_changes_with_content() -> None:
    changed = make_instance(customers=[customer(1), customer(2, demand=5)])
    assert changed.content_hash() != make_instance().content_hash()


def test_no_customers_rejected() -> None:
    with pytest.raises(ValidationError):
        make_instance(customers=[])


def test_more_than_100_customers_rejected() -> None:
    assert make_instance(customers=[customer(i) for i in range(1, 101)])
    with pytest.raises(ValidationError):
        make_instance(customers=[customer(i) for i in range(1, 102)])


def test_ready_after_due_rejected() -> None:
    with pytest.raises(ValidationError):
        make_instance(customers=[customer(1, ready=50, due=10)])


def test_duplicate_customer_ids_rejected() -> None:
    with pytest.raises(ValidationError):
        make_instance(customers=[customer(1), customer(1)])


def test_customer_id_zero_rejected() -> None:
    with pytest.raises(ValidationError):
        make_instance(customers=[customer(0), customer(1)])


def test_matrix_dimensions() -> None:
    def matrix(n: int) -> Matrix:
        rows = [[0.0] * n for _ in range(n)]
        return Matrix(
            distance=rows,
            time=rows,
            source="euclidean",
            distance_unit="u",
            time_unit="u",
        )

    assert make_instance(matrix=matrix(3)).matrix is not None
    with pytest.raises(ValidationError):
        make_instance(matrix=matrix(2))


def test_depot_without_due_and_fleet_without_capacity() -> None:
    inst = make_instance()
    assert inst.depot.due is None
    assert inst.fleet.capacity is None


def test_run_record_classic_roundtrip() -> None:
    evaluation = Evaluation(
        stops=[
            [
                StopEvaluation(customer=1, arrival=1, start=1, wait=0, late=0, load=1),
                StopEvaluation(customer=2, arrival=3, start=3, wait=0, late=0, load=2),
            ]
        ],
        distance=4,
        total_wait=0,
        total_late=0,
        vehicles_used=1,
        unserved=0,
        overload=0,
        score=1004,
        violations=[],
        feasible=True,
    )
    inst = make_instance()
    record = RunRecord(
        run_id="r1",
        date=datetime(2026, 11, 14, 12, 0, tzinfo=UTC),
        git_sha="abc123",
        hardware="test",
        instance_id=inst.id,
        instance_hash=inst.content_hash(),
        method="heuristic",
        role="classic",
        seed=0,
        params={"time_limit_s": 1.5},
        wall_time_s=0.2,
        solution=Solution(routes=[[1, 2]]),
        evaluation=evaluation,
        parse_status="ok",
    )
    reloaded = RunRecord.model_validate_json(record.model_dump_json())
    assert reloaded == record
