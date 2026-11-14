import json
from pathlib import Path
from typing import Any

import pytest

from vrptw.bench.run import TIERS, run_tier
from vrptw.cli import main
from vrptw.instances.solomon import SOLOMON_DIR
from vrptw.model import RunRecord


def test_tier2_files_exist() -> None:
    present = {p.stem.upper() for p in SOLOMON_DIR.glob("*.txt")}
    assert {name for name, _ in TIERS[2]} == present


def strip_timing(summary: dict[str, Any]) -> list[dict[str, Any]]:
    return [{k: v for k, v in r.items() if k != "timing"} for r in summary["results"]]


def test_cli_tier2_summary_and_records(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(
        ["bench", "classic", "--tier", "2", "--reps", "3", "--methods", "heuristic"]
        + ["--out-dir", str(tmp_path)]
    )
    assert code == 0
    summary = json.loads(capsys.readouterr().out)
    assert len(summary["results"]) == 6  # seis instancias, un método
    for r in summary["results"]:
        assert r["primary"]["convention"] == "exact_truncated"
        assert r["primary"]["n_runs"] == 3
        assert "secondary" not in r
    files = sorted(tmp_path.glob("*.json"))
    assert len(files) == 18
    record = RunRecord.model_validate_json(files[0].read_text(encoding="utf-8"))
    assert record.role == "classic" and record.evaluation is not None


def test_reproducible_except_timing(tmp_path: Path) -> None:
    a = run_tier(1, 2, ["heuristic"], out_dir=tmp_path / "a")
    b = run_tier(1, 2, ["heuristic"], out_dir=tmp_path / "b")
    assert strip_timing(a) == strip_timing(b)
    assert all("convention" in r["primary"] for r in a["results"])
    assert a["results"][0]["primary"]["metric"] == "score"


def test_unknown_method_fails(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(
        [
            "bench",
            "classic",
            "--tier",
            "1",
            "--reps",
            "1",
            "--methods",
            "nope",
            "--out-dir",
            str(tmp_path),
        ]
    )
    assert code != 0 and "método desconocido" in capsys.readouterr().err


def test_reps_must_be_positive(tmp_path: Path) -> None:
    args = [
        "bench",
        "classic",
        "--tier",
        "2",
        "--reps",
        "0",
        "--out-dir",
        str(tmp_path),
    ]
    assert main(args) == 1
