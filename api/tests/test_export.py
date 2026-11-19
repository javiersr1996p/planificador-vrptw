"""Exportación de los casos de ejemplo (`vrptw bench export`), sin red."""

import json
import re
import shutil
import socket
from pathlib import Path
from typing import Any

import pytest

from vrptw.api.main import check_public
from vrptw.bench.export import (
    DEFAULT_OUT,
    EXAMPLE_CASES,
    LLM_CASES,
    TEMPLATE,
    export,
    llm_runs,
)
from vrptw.bench.llm_run import DEFAULT_OUT_DIR
from vrptw.cli import main
from vrptw.evaluate import evaluate
from vrptw.instances.camouflage import camouflage
from vrptw.model import Instance, RunRecord, TrafficWindow
from vrptw.travel import travel_time

CLASSIC = ["heuristic", "aco", "ga", "tabu"]
MAX_BYTES = 500 * 1024
KEY = re.compile(rb"sk-ant-[A-Za-z0-9_-]{20,}")


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("la prueba no debe abrir sockets")

    monkeypatch.setattr(socket, "socket", refuse)


def load(case: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(
        (DEFAULT_OUT / "cases" / f"{case}.json").read_text(encoding="utf-8")
    )
    return data


def runs_of(case: str) -> list[RunRecord]:
    return [RunRecord.model_validate(r) for r in load(case)["runs"]]


def origin_record(sent_id: str, run_id: str) -> dict[str, Any]:
    """Registro de `api/runs/llm/` del que sale `run_id`."""
    for path in DEFAULT_OUT_DIR.glob(f"{sent_id}_*.json"):
        data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        if data["run_id"] == run_id:
            return data
    raise AssertionError(f"sin registro de origen para {run_id}")


def has_key(value: Any, name: str) -> bool:
    if isinstance(value, dict):
        return name in value or any(has_key(v, name) for v in value.values())
    if isinstance(value, list):
        return any(has_key(v, name) for v in value)
    return False


@pytest.mark.parametrize("case", EXAMPLE_CASES)
def test_files_validate(case: str) -> None:
    data = load(case)
    assert {"instance", "runs", "built_on", "attribution", "note"} <= data.keys()
    instance = Instance.model_validate(data["instance"])
    assert instance.id == case
    assert instance.matrix is not None
    check_public(instance)
    runs_of(case)


@pytest.mark.parametrize("case", EXAMPLE_CASES)
def test_run_counts(case: str) -> None:
    records = runs_of(case)
    classic = [r for r in records if r.role == "classic"]
    llm = [r for r in records if r.role != "classic"]
    assert [r.method for r in classic] == CLASSIC
    assert all(r.seed == 0 and r.parse_status == "ok" for r in classic)
    assert len(llm) == (6 if case in LLM_CASES else 0)
    assert len({(r.role, r.model_requested) for r in llm}) == len(llm)


@pytest.mark.parametrize("case", LLM_CASES)
def test_llm_runs_match_instance_and_evaluation(case: str) -> None:
    instance = Instance.model_validate(load(case)["instance"])
    sent = camouflage(instance) if instance.source == "solomon" else instance
    for record in (r for r in runs_of(case) if r.role != "classic"):
        assert record.instance_id == instance.id
        assert record.instance_hash == instance.content_hash()
        origin = origin_record(sent.id, record.run_id)
        assert origin["instance_hash"] == sent.content_hash()
        assert record.params.get("camouflaged", False) is (instance.source == "solomon")
        assert record.messages is None
        if record.solution is None:
            assert record.evaluation is None
        else:
            assert record.evaluation == evaluate(instance, record.solution)


@pytest.mark.parametrize("case", EXAMPLE_CASES)
def test_every_evaluation_has_depot_arrival(case: str) -> None:
    for record in runs_of(case):
        if record.evaluation is not None:
            assert record.evaluation.depot_arrival is not None
            assert len(record.evaluation.depot_arrival) == len(record.evaluation.stops)


@pytest.mark.parametrize(
    "traffic", [None, [TrafficWindow(from_=480, to=1080, factor=1.5)]]
)
def test_madrid_12_depot_arrival_is_last_departure_plus_trip(
    traffic: list[TrafficWindow] | None,
) -> None:
    instance = Instance.model_validate(load("madrid-12")["instance"])
    instance = instance.model_copy(update={"traffic_profile": traffic})
    for record in runs_of("madrid-12"):
        assert record.solution is not None
        ev = evaluate(instance, record.solution)
        assert ev.depot_arrival is not None
        positions = {c.id: i for i, c in enumerate(instance.customers, start=1)}
        for route, stops, back in zip(
            record.solution.routes, ev.stops, ev.depot_arrival, strict=True
        ):
            assert route and stops
            last = stops[-1]
            node = positions[last.customer]
            leave = last.start + instance.customers[node - 1].service
            assert back == pytest.approx(leave + travel_time(instance, node, 0, leave))
            assert back > leave


def test_old_records_without_the_field_validate() -> None:
    record = runs_of("madrid-12")[0]
    data = record.model_dump(mode="json", by_alias=True)
    del data["evaluation"]["depot_arrival"]
    assert RunRecord.model_validate(data).evaluation.depot_arrival is None  # type: ignore[union-attr]


def test_all_run_records_validate() -> None:
    paths = sorted(DEFAULT_OUT_DIR.parent.rglob("*.json"))
    assert paths
    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and "run_id" in data:
            RunRecord.model_validate(data)


def test_tfe2024_has_infeasible_and_unparseable_runs() -> None:
    llm = [r for r in runs_of("tfe2024-10c-1") if r.role != "classic"]
    assert any(r.evaluation is not None and not r.evaluation.feasible for r in llm)
    assert any(r.parse_status == "unparseable" for r in llm)


def test_no_keys_and_no_messages() -> None:
    files = [p for p in DEFAULT_OUT.rglob("*") if p.is_file()]
    assert files
    for path in files:
        assert not KEY.search(path.read_bytes()), path.name
        if path.suffix == ".json":
            assert not has_key(json.loads(path.read_text(encoding="utf-8")), "messages")


def test_sizes_and_template() -> None:
    for path in DEFAULT_OUT.rglob("*.json"):
        assert path.stat().st_size <= MAX_BYTES, path.name
    assert (DEFAULT_OUT / TEMPLATE.name).read_bytes() == TEMPLATE.read_bytes()


def test_index() -> None:
    index = json.loads((DEFAULT_OUT / "index.json").read_text(encoding="utf-8"))
    cases = index["cases"]
    assert [c["id"] for c in cases] == list(EXAMPLE_CASES)
    assert [c["id"] for c in cases if c["default"]] == ["madrid-12"]
    for c in cases:
        instance = Instance.model_validate(load(c["id"])["instance"])
        assert c["customers"] == len(instance.customers)
        assert c["vehicles"] == instance.fleet.vehicles
        assert c["has_map"] is (instance.source == "real")
        assert c["methods"][:4] == CLASSIC
        assert (c["methods"][4:] == []) is (c["id"] not in LLM_CASES)


def snapshot(directory: Path) -> dict[str, bytes]:
    return {
        str(p.relative_to(directory)): p.read_bytes()
        for p in directory.rglob("*")
        if p.is_file()
    }


def test_export_is_idempotent(tmp_path: Path) -> None:
    """Con los clásicos ya exportados, exportar de nuevo no cambia ningún byte."""
    shutil.copytree(DEFAULT_OUT, tmp_path / "data")
    out = tmp_path / "data"
    before = snapshot(out)
    export(out)
    assert snapshot(out) == before
    assert main(["bench", "export", "--out", str(out)]) == 0
    assert snapshot(out) == before


def test_export_reuses_only_classics_of_the_same_instance(tmp_path: Path) -> None:
    """Un clásico de otra instancia (otro hash) no se reutiliza."""
    out = tmp_path / "data"
    shutil.copytree(DEFAULT_OUT, out)
    path = out / "cases" / "tfe2024-10c-1.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["runs"][0]["instance_hash"] = "0" * 64
    data["runs"][0]["run_id"] = "viejo"
    path.write_text(json.dumps(data), encoding="utf-8")
    export(out)
    runs = json.loads(path.read_text(encoding="utf-8"))["runs"]
    assert runs[0]["run_id"] != "viejo"
    assert (
        runs[0]["instance_hash"]
        == Instance.model_validate(data["instance"]).content_hash()
    )


def test_missing_llm_record_is_an_error(tmp_path: Path) -> None:
    instance = Instance.model_validate(load("tfe2024-10c-1")["instance"])
    with pytest.raises(FileNotFoundError, match="falta el registro LLM"):
        llm_runs(instance, tmp_path)
