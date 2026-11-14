import json
from pathlib import Path

import pytest

from vrptw.instances.tfe2024 import (
    TFE2024_LABELS,
    TFE2024_USED,
    is_used_in_2024,
    load_tfe2024,
)
from vrptw.model import TFE

TABLES = Path(__file__).resolve().parents[1] / "data" / "tfe_tables.json"


def test_all_twenty_load() -> None:
    assert len(TFE2024_LABELS) == 20
    for label in TFE2024_LABELS:
        inst = load_tfe2024(label)
        assert inst.source == "tfe2024" and inst.cost_profile == TFE
        assert inst.matrix is not None and inst.matrix.source == "euclidean"
        assert inst.matrix.time == inst.matrix.distance
        assert len(inst.customers) == int(label.split("c")[0])


def test_used_match_table_5_1() -> None:
    tables = json.loads(TABLES.read_text())
    table = next(t for t in tables if t["table"] == "5.1")
    assert set(TFE2024_USED) == {r[0] for r in table["rows"]}
    assert sum(is_used_in_2024(label) for label in TFE2024_LABELS) == 12


@pytest.mark.parametrize(("label", "vehicles"), [("10c-2", 5), ("20c-2", 10)])
def test_fleet(label: str, vehicles: int) -> None:
    inst = load_tfe2024(label)
    assert inst.fleet.vehicles == vehicles
    assert inst.fleet.capacity is None


def test_depot_without_due() -> None:
    inst = load_tfe2024("10c-1")
    assert inst.depot.due is None
    assert (inst.depot.x, inst.depot.y) == (0, 0)


def test_unknown_label() -> None:
    for bad in ("10c-11", "15c-1", "foo"):
        with pytest.raises(ValueError, match="etiqueta desconocida"):
            load_tfe2024(bad)
