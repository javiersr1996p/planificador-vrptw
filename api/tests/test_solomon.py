import math

import pytest

from vrptw.instances.solomon import (
    SOLOMON_DIR,
    SolomonFormatError,
    euclidean_matrix,
    load_solomon,
    parse_solomon,
)
from vrptw.model import SOLOMON


def test_c101_full() -> None:
    inst = load_solomon("C101")
    assert len(inst.customers) == 100
    assert inst.fleet.vehicles == 25 and inst.fleet.capacity == 200
    assert inst.source == "solomon" and inst.cost_profile == SOLOMON
    assert inst.depot.due == 1236
    assert inst.matrix is not None and inst.matrix.source == "euclidean"

    rows = (SOLOMON_DIR / "c101.txt").read_text().splitlines()
    first = next(r.split() for r in rows if r.split()[:1] == ["1"])
    c = inst.customers[0]
    assert [c.id, c.x, c.y, c.demand, c.ready, c.due, c.service] == [
        float(t) if i else int(t) for i, t in enumerate(first)
    ]


@pytest.mark.parametrize("n", [25, 50])
def test_cut(n: int) -> None:
    full = load_solomon("r101")
    inst = load_solomon("r101", n)
    assert len(inst.customers) == n
    assert inst.customers == full.customers[:n]
    assert inst.fleet == full.fleet and inst.depot == full.depot
    assert inst.matrix is not None and len(inst.matrix.distance) == n + 1


@pytest.mark.parametrize("n", [0, 10, 75, 101])
def test_unsupported_size(n: int) -> None:
    with pytest.raises(ValueError, match="tamaño no admitido"):
        load_solomon("c101", n)


def test_unknown_name() -> None:
    with pytest.raises(ValueError, match="desconocida"):
        load_solomon("c999")


def test_truncated_file() -> None:
    text = (SOLOMON_DIR / "c101.txt").read_text()
    with pytest.raises(SolomonFormatError):
        parse_solomon("\n".join(text.splitlines()[:6]))  # sin sección CUSTOMER
    fleet, _, customers = parse_solomon("\n".join(text.splitlines()[:15]))
    assert fleet.vehicles == 25 and len(customers) == 5  # recortado pero válido


def test_broken_header() -> None:
    text = (SOLOMON_DIR / "c101.txt").read_text().replace("25         200", "x y")
    with pytest.raises(SolomonFormatError, match="cabecera"):
        parse_solomon(text)
    with pytest.raises(SolomonFormatError, match="columnas"):
        parse_solomon(text.replace("x y", "25 200").replace("  10        912", "  10"))


def test_arc_distances() -> None:
    exact = load_solomon("c101", 25)
    trunc = load_solomon("c101", 25, truncated=True)
    assert exact.matrix is not None and trunc.matrix is not None
    assert trunc.matrix.source == "euclidean_truncated"
    a, b = exact.customers[0], exact.customers[2]
    d = math.hypot(a.x - b.x, a.y - b.y)  # type: ignore[operator]
    assert exact.matrix.distance[1][3] == d
    assert trunc.matrix.distance[1][3] == math.floor(10 * d) / 10
    assert exact.matrix.time == exact.matrix.distance


def test_truncation_float_error() -> None:
    # 12.3 = sqrt(151.29) puede salir como 12.299999999999999
    m = euclidean_matrix([(0, 0), (12.3, 0)], truncated=True)
    assert m.distance[0][1] == 12.3
    m = euclidean_matrix([(0, 0), (3, 4)], truncated=True)
    assert m.distance[0][1] == 5.0
