import pytest

from vrptw.model import TFE, Customer, Depot, Fleet, Instance, Matrix, TrafficWindow
from vrptw.travel import Stop, next_stop, traffic_factor, travel_time

TIME = [
    [0.0, 8.0, 12.0],
    [8.0, 0.0, 6.0],
    [12.0, 6.0, 0.0],
]


def make_instance(
    profile: list[TrafficWindow] | None = None, with_matrix: bool = True
) -> Instance:
    matrix = Matrix(
        distance=TIME, time=TIME, source="test", distance_unit="u", time_unit="u"
    )
    return Instance(
        id="t",
        name="travel",
        source="real",
        depot=Depot(ready=0),
        customers=[
            Customer(id=7, demand=1, ready=10, due=20, service=2),
            Customer(id=9, demand=1, ready=0, due=5, service=3),
        ],
        fleet=Fleet(vehicles=1),
        matrix=matrix if with_matrix else None,
        traffic_profile=profile,
        cost_profile=TFE,
    )


def window(start: float, end: float, factor: float) -> TrafficWindow:
    return TrafficWindow(from_=start, to=end, factor=factor)


def test_no_profile_uses_matrix() -> None:
    inst = make_instance()
    assert traffic_factor(None, 123.0) == 1.0
    for i in range(3):
        for j in range(3):
            assert travel_time(inst, i, j, 7.0) == TIME[i][j]


def test_factor_one_reproduces_matrix() -> None:
    inst = make_instance([window(0, 10, 1.0), window(10, 1000, 1.0)])
    for t in (0.0, 5.0, 10.0, 999.0, 2000.0):
        for i in range(3):
            for j in range(3):
                assert travel_time(inst, i, j, t) == TIME[i][j]


def test_departure_on_window_edge() -> None:
    profile = [window(0, 10, 1.5), window(10, 20, 2.0)]
    assert traffic_factor(profile, 0.0) == 1.5  # `from` is inclusive
    assert traffic_factor(profile, 9.999) == 1.5
    assert traffic_factor(profile, 10.0) == 2.0  # shared edge: the later window
    assert traffic_factor(profile, 20.0) == 1.0  # `to` is exclusive: no window
    assert traffic_factor(profile, -1.0) == 1.0
    inst = make_instance(profile)
    assert travel_time(inst, 0, 1, 9.0) == 12.0
    assert travel_time(inst, 0, 1, 10.0) == 16.0
    assert travel_time(inst, 0, 1, 20.0) == 8.0


def test_next_stop_waits_until_ready() -> None:
    # Depot -> position 1 (id 7) leaving at 0: arrives 8, ready 10.
    stop = next_stop(make_instance(), 0, 0.0, 1)
    assert stop == Stop(arrival=8.0, start=10.0, wait=2.0, late=0.0, departure=12.0)


def test_next_stop_late() -> None:
    # Position 1 -> position 2 (id 9) leaving at 12: arrives 18, due 5.
    stop = next_stop(make_instance(), 1, 12.0, 2)
    assert stop == Stop(arrival=18.0, start=18.0, wait=0.0, late=13.0, departure=21.0)


def test_next_stop_applies_departure_traffic() -> None:
    # Leaving at 0 inside a 0.5 window: 8 x 0.5 = 4, so it waits 6.
    stop = next_stop(make_instance([window(0, 10, 0.5)]), 0, 0.0, 1)
    assert stop == Stop(arrival=4.0, start=10.0, wait=6.0, late=0.0, departure=12.0)


def test_missing_matrix_raises() -> None:
    with pytest.raises(ValueError, match="matrix"):
        travel_time(make_instance(with_matrix=False), 0, 1, 0.0)
