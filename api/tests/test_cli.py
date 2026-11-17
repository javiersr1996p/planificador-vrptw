import os
import subprocess
import sys
from pathlib import Path

import pytest

from vrptw.cli import main, run_method
from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.model import RunRecord


def test_solomon_c101_writes_valid_record(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "c101.json"
    code = main(
        [
            "solve",
            "--instance",
            "C101",
            "--n",
            "25",
            "--method",
            "heuristic",
            "--out",
            str(out),
        ]
    )
    assert code == 0
    record = RunRecord.model_validate_json(out.read_text(encoding="utf-8"))
    assert record.instance_id == "c101-25-trunc"
    assert record.role == "classic" and record.parse_status == "ok"
    assert record.evaluation is not None
    assert "score:" in capsys.readouterr().out


def test_tfe2024_runs(tmp_path: Path) -> None:
    out = tmp_path / "tfe.json"
    code = main(
        [
            "solve",
            "--instance",
            "tfe2024-10c-1",
            "--method",
            "heuristic",
            "--out",
            str(out),
        ]
    )
    assert code == 0
    record = RunRecord.model_validate_json(out.read_text(encoding="utf-8"))
    assert record.instance_id == "tfe2024-10c-1"


def test_unknown_instance_is_readable(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(
        [
            "solve",
            "--instance",
            "noexiste",
            "--method",
            "heuristic",
            "--out",
            str(tmp_path / "x.json"),
        ]
    )
    err = capsys.readouterr().err
    assert code != 0
    assert "desconocida" in err and "Traceback" not in err


def test_unknown_method_is_readable(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(
        [
            "solve",
            "--instance",
            "C101",
            "--n",
            "25",
            "--method",
            "nope",
            "--out",
            str(tmp_path / "x.json"),
        ]
    )
    err = capsys.readouterr().err
    assert code != 0
    assert "método desconocido" in err and "Traceback" not in err


@pytest.mark.parametrize(
    ("options", "message"),
    [
        (["--tier", "0", "--max-tokens", "1023"], "entre 1024"),
        (["--tier", "0", "--max-tokens", "21334"], "21333 (máximo sin streaming)"),
        (["--tier", "0", "--reps", "0"], "--reps debe ser al menos 1"),
        (["--tier", "0", "--instances", "10c-1", "C101"], "use una de ['10c-1']"),
        (["--tier", "1", "--instances", "real"], "'real' fuera del escalón 1"),
    ],
)
def test_bench_llm_rejects_bad_options(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    options: list[str],
    message: str,
) -> None:
    code = main(["bench", "llm", *options, "--out-dir", str(tmp_path)])
    err = capsys.readouterr().err
    assert code == 1
    assert message in err and "Traceback" not in err
    assert list(tmp_path.iterdir()) == []


def test_unsupported_n_exits_with_usage_error() -> None:
    with pytest.raises(SystemExit) as exc:
        main(["solve", "--instance", "C101", "--n", "10", "--method", "heuristic"])
    assert exc.value.code != 0


def test_run_method_records_time_limit() -> None:
    instance = load_tfe2024("10c-1")
    assert run_method(instance, "heuristic", 0, time_limit_s=5).params == {
        "time_limit_s": 5
    }
    assert run_method(instance, "heuristic", 0).params == {}


def test_solve_output_is_utf8_when_piped(tmp_path: Path) -> None:
    env = {k: v for k, v in os.environ.items() if k != "PYTHONIOENCODING"}
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; from vrptw.cli import main; sys.exit(main())",
            "solve",
            "--instance",
            "tfe2024-10c-1",
            "--method",
            "heuristic",
            "--out",
            str(tmp_path / "x.json"),
        ],
        capture_output=True,
        env=env,
        check=True,
    )
    assert "método" in result.stdout.decode("utf-8")
