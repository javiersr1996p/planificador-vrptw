import math
import random
from typing import Any

import pytest

from vrptw.evaluate import evaluate, score
from vrptw.model import (
    SOLOMON,
    TFE,
    CostProfile,
    Customer,
    Depot,
    Evaluation,
    Fleet,
    Instance,
    Matrix,
    Solution,
    StopEvaluation,
    TrafficWindow,
    Violation,
)

# Hand-computed case. Customer ids differ from matrix positions on purpose:
#   id 10 -> position 1: demand 2, ready 0,  due 10, service 2
#   id 20 -> position 2: demand 3, ready 20, due 30, service 3
#   id 30 -> position 3: demand 4, ready 0,  due 5,  service 1
# Depot ready 0. Travel time is twice the distance. Routes [[10, 20], [30]].
#
# Route 0:
#   depot -> 10: leave 0,  +8  -> arrive 8,  start 8,  wait 0, late 0, leave 10, load 2
#   10 -> 20:    leave 10, +6  -> arrive 16, start 20, wait 4, late 0, leave 23, load 5
#   20 -> depot: leave 23, +12 -> arrive 35
#   distance 4 + 3 + 6 = 13
# Route 1:
#   depot -> 30: leave 0,  +10 -> arrive 10, start 10, wait 0, late 5, leave 11, load 4
#   30 -> depot: leave 11, +10 -> arrive 21
#   distance 5 + 5 = 10
# Totals: distance 23, wait 4, late 5, vehicles 2, unserved 0, overload 0.
#   TFE:     23 + 10 x 4 + 10 x 5   + 1000 x 2 + 10000 x 0 + 0 x 0    = 2113
#   SOLOMON: 23 + 0 x 4  + 1000 x 5 + 0 x 2    + 10000 x 0 + 1000 x 0 = 5023
DIST = [
    [0.0, 4.0, 6.0, 5.0],
    [4.0, 0.0, 3.0, 7.0],
    [6.0, 3.0, 0.0, 8.0],
    [5.0, 7.0, 8.0, 0.0],
]
TIME = [[2 * d for d in row] for row in DIST]
HAND = [[10, 20], [30]]


def customers(due_30: float = 5) -> list[Customer]:
    return [
        Customer(id=10, demand=2, ready=0, due=10, service=2),
        Customer(id=20, demand=3, ready=20, due=30, service=3),
        Customer(id=30, demand=4, ready=0, due=due_30, service=1),
    ]


def make_instance(**kw: Any) -> Instance:
    base: dict[str, Any] = {
        "id": "hand3",
        "name": "hand",
        "source": "tfe2024",
        "depot": Depot(ready=0),
        "customers": customers(),
        "fleet": Fleet(vehicles=2),
        "matrix": Matrix(
            distance=DIST, time=TIME, source="test", distance_unit="u", time_unit="u"
        ),
        "cost_profile": TFE,
    }
    return Instance(**(base | kw))


def run(routes: list[list[int]], **kw: Any) -> Evaluation:
    return evaluate(make_instance(**kw), Solution(routes=routes))


def late(route: int, customer: int) -> Violation:
    return Violation(type="late", route=route, customer=customer)


def test_hand_computed_tfe() -> None:
    ev = run(HAND)
    assert ev.stops == [
        [
            StopEvaluation(customer=10, arrival=8, start=8, wait=0, late=0, load=2),
            StopEvaluation(customer=20, arrival=16, start=20, wait=4, late=0, load=5),
        ],
        [StopEvaluation(customer=30, arrival=10, start=10, wait=0, late=5, load=4)],
    ]
    assert ev.distance == 23
    assert ev.total_wait == 4
    assert ev.total_late == 5
    assert ev.vehicles_used == 2
    assert ev.unserved == 0
    assert ev.overload == 0
    assert ev.score == 2113
    assert ev.depot_arrival == [35, 21]
    # Waiting at 20 is not a violation; the only one is the late start at 30.
    assert ev.violations == [late(1, 30)]
    assert not ev.feasible
    assert score(make_instance(), HAND) == 2113


def test_hand_computed_solomon() -> None:
    assert run(HAND, cost_profile=SOLOMON).score == 5023
    assert score(make_instance(cost_profile=SOLOMON), HAND) == 5023


def test_start_exactly_at_due_is_feasible() -> None:
    ev = run(HAND, customers=customers(due_30=10))
    assert ev.violations == []
    assert ev.feasible
    assert ev.score == 23 + 10 * 4 + 1000 * 2


def test_late_tolerance() -> None:
    within = run(HAND, customers=customers(due_30=10 - 1e-10))
    assert within.feasible
    # The tolerance belongs to the validator; the score still charges it.
    assert within.total_late > 0
    assert within.score == pytest.approx(2063, abs=1e-6)
    beyond = run(HAND, customers=customers(due_30=10 - 1e-6))
    assert beyond.violations == [late(1, 30)]


def test_duplicate_is_traversed_each_time() -> None:
    # Route 0 = 10, 20, 10: the hand case, then 20 -> 10 leaving at 23, +6 ->
    # arrive 29, late 29 - 10 = 19, leave 31, load 7; 10 -> depot +8.
    # Distance 4 + 3 + 3 + 4 = 14. Totals: distance 24, wait 4, late 19 + 5.
    # TFE: 24 + 10 x 4 + 10 x 24 + 1000 x 2 = 2304.
    ev = run([[10, 20, 10], [30]])
    assert [s.customer for s in ev.stops[0]] == [10, 20, 10]
    assert ev.stops[0][2].load == 7
    assert ev.distance == 24
    assert ev.total_late == 24
    assert ev.score == 2304
    assert ev.violations == [
        Violation(type="duplicate", route=0, customer=10),
        late(0, 10),
        late(1, 30),
    ]
    across = run([[10, 20], [30, 10]])
    assert Violation(type="duplicate", route=1, customer=10) in across.violations
    assert across.unserved == 0


def test_omitted_customer_adds_w_unserved() -> None:
    # Only route 0 of the hand case: 13 + 10 x 4 + 1000 x 1 + 10000 x 1.
    ev = run([[10, 20]])
    assert ev.unserved == 1
    assert ev.vehicles_used == 1
    assert ev.violations == [Violation(type="unserved", customer=30)]
    assert ev.score == 11053
    assert run([[10, 20]], cost_profile=SOLOMON).score == 13 + 10000


def test_unknown_customer_is_skipped() -> None:
    ev = run([[10, 99, 20], [30]])
    assert [s.customer for s in ev.stops[0]] == [10, 20]
    assert ev.score == 2113
    assert ev.violations == [
        Violation(type="unknown_customer", route=0, customer=99),
        late(1, 30),
    ]
    # A route with only unknown ids is not traversed and is not a vehicle.
    only_unknown = run([[10, 20], [30], [99]])
    assert only_unknown.stops[2] == []
    assert only_unknown.vehicles_used == 2
    assert only_unknown.score == 2113
    assert only_unknown.violations == [
        late(1, 30),
        Violation(type="unknown_customer", route=2, customer=99),
    ]


def test_empty_route_is_not_a_vehicle() -> None:
    ev = run([[10, 20], [], [30]])
    assert ev.stops[1] == []
    assert ev.depot_arrival == [35, 0, 21]  # an empty route reports depot.ready
    assert ev.vehicles_used == 2
    assert ev.score == 2113
    assert ev.violations == [late(2, 30)]


def test_capacity_none_versus_exceeded() -> None:
    unlimited = run(HAND, cost_profile=SOLOMON)
    assert unlimited.overload == 0
    assert all(v.type != "capacity" for v in unlimited.violations)

    at_limit = run(HAND, fleet=Fleet(vehicles=2, capacity=5))
    assert at_limit.overload == 0
    assert all(v.type != "capacity" for v in at_limit.violations)

    # Route 0 carries 5 against 4: overload 1, charged only in SOLOMON.
    over = run(HAND, fleet=Fleet(vehicles=2, capacity=4), cost_profile=SOLOMON)
    assert over.overload == 1
    assert Violation(type="capacity", route=0) in over.violations
    assert over.score == 5023 + 1000
    over_tfe = run(HAND, fleet=Fleet(vehicles=2, capacity=4))
    assert over_tfe.score == 2113
    assert not over_tfe.feasible


def test_depot_due() -> None:
    assert all(v.type != "depot_due" for v in run(HAND).violations)

    # Route 0 returns exactly at 35.
    at_due = run(HAND, depot=Depot(ready=0, due=35))
    assert all(v.type != "depot_due" for v in at_due.violations)
    assert at_due.score == 2113

    # Route 0 returns 5 late: violation and 5 more units of lateness.
    early_due = run(HAND, depot=Depot(ready=0, due=30))
    assert early_due.violations == [
        Violation(type="depot_due", route=0),
        late(1, 30),
    ]
    assert early_due.total_late == 10
    assert early_due.score == 2113 + 10 * 5
    solomon = run(HAND, depot=Depot(ready=0, due=30), cost_profile=SOLOMON)
    assert solomon.score == 5023 + 1000 * 5


def test_more_routes_than_vehicles() -> None:
    one_vehicle = run(HAND, fleet=Fleet(vehicles=1))
    assert Violation(type="fleet_exceeded", route=1) in one_vehicle.violations
    assert one_vehicle.score == 2113

    three_routes = run([[10], [20], [30]])
    fleet = [v for v in three_routes.violations if v.type == "fleet_exceeded"]
    assert fleet == [Violation(type="fleet_exceeded", route=2)]


def test_traffic_changes_times_not_distance() -> None:
    # Departures in [0, 1) take twice as long; only the legs leaving the depot.
    # Route 0: depot -> 10 +16 -> start 16, late 6, leave 18; 10 -> 20 +6 ->
    # arrive 24, no wait. Route 1: depot -> 30 +20 -> late 15.
    # TFE: 23 + 10 x 0 + 10 x 21 + 1000 x 2 = 2233.
    profile = [TrafficWindow(from_=0, to=1, factor=2)]
    ev = run(HAND, traffic_profile=profile)
    assert [[s.arrival for s in r] for r in ev.stops] == [[16, 24], [20]]
    assert ev.distance == 23
    assert ev.total_wait == 0
    assert ev.total_late == 21
    assert ev.score == 2233
    # Return legs depart at 27 and 21, outside the traffic window: factor 1.
    assert ev.depot_arrival == [39, 31]


def test_missing_matrix_raises() -> None:
    inst = make_instance(matrix=None)
    with pytest.raises(ValueError, match="matrix"):
        evaluate(inst, Solution(routes=HAND))
    with pytest.raises(ValueError, match="matrix"):
        score(inst, HAND)


def random_instance(cost_profile: CostProfile, tight: bool) -> Instance:
    rng = random.Random(2024)
    n = 8
    points = [(50.0, 50.0)] + [
        (rng.uniform(0, 100), rng.uniform(0, 100)) for _ in range(n)
    ]
    dist = [[math.dist(p, q) for q in points] for p in points]
    custs = []
    for i in range(1, n + 1):
        ready = rng.uniform(0, 100)
        custs.append(
            Customer(
                id=100 + i,
                demand=rng.randint(1, 9),
                ready=ready,
                due=ready + rng.uniform(5, 40) if tight else 1e6,
                service=rng.uniform(1, 10),
            )
        )
    return Instance(
        id="rand8",
        name="random",
        source="real",
        depot=Depot(ready=0, due=250 if tight else None),
        customers=custs,
        fleet=Fleet(vehicles=3 if tight else n, capacity=15 if tight else 1000),
        matrix=Matrix(
            distance=dist, time=dist, source="test", distance_unit="u", time_unit="u"
        ),
        traffic_profile=(
            [
                TrafficWindow(from_=0, to=60, factor=1.5),
                TrafficWindow(from_=60, to=120, factor=0.8),
            ]
            if tight
            else None
        ),
        cost_profile=cost_profile,
    )


def test_solomon_feasible_complete_score_equals_distance() -> None:
    inst = random_instance(SOLOMON, tight=False)
    ids = [c.id for c in inst.customers]
    rng = random.Random(1)
    waited = 0
    for _ in range(100):
        perm = ids[:]
        rng.shuffle(perm)
        k = rng.randint(1, len(ids))
        routes: list[list[int]] = [[] for _ in range(k)]
        for cid in perm:
            routes[rng.randrange(k)].append(cid)
        ev = evaluate(inst, Solution(routes=routes))
        assert ev.feasible
        assert ev.score == ev.distance
        assert score(inst, routes) == ev.distance
        if ev.total_wait > 0:
            waited += 1
    # Waiting happens and is free, so the property is not trivially true.
    assert waited > 0


def random_routes(rng: random.Random, ids: list[int]) -> list[list[int]]:
    served = [cid for cid in ids if rng.random() < 0.8]
    rng.shuffle(served)
    k = rng.randint(1, 5)
    routes: list[list[int]] = [[] for _ in range(k)]
    for cid in served:
        routes[rng.randrange(k)].append(cid)
    if rng.random() < 0.1:
        routes[0].append(rng.choice(ids))
    if rng.random() < 0.1:
        routes[-1].insert(0, 999)
    return routes


@pytest.mark.parametrize("profile", [TFE, SOLOMON], ids=["tfe", "solomon"])
def test_cached_score_matches_evaluate(profile: CostProfile) -> None:
    inst = random_instance(profile, tight=True)
    ids = [c.id for c in inst.customers]
    rng = random.Random(42)
    cache: dict[tuple[int, ...], float] = {}
    with_unserved = 0
    for _ in range(200):
        routes = random_routes(rng, ids)
        ev = evaluate(inst, Solution(routes=routes))
        assert score(inst, routes, cache) == ev.score
        assert score(inst, routes, cache) == ev.score  # every route now cached
        assert score(inst, routes) == ev.score
        if ev.unserved > 0:
            with_unserved += 1
    assert with_unserved > 0
    assert cache
