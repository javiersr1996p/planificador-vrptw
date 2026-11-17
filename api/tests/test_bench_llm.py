"""Runner del benchmark LLM: topes, libro de gasto, caché y reanudación.

Siempre sin red: `PROVIDERS["anthropic"]` se sustituye por `FakeAPI`, que da
tokens conocidos y cuenta las llamadas, así que `call_cost` valora los
identificadores reales de los modelos. Escalón 0: una instancia de 10 clientes
(max_tokens 8000, que es también el presupuesto de salida del agente), tres
modelos, dos papeles y una repetición. Topes y gasto, en USD.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from vrptw.bench import llm_run
from vrptw.bench.estimate import TOOL_SYSTEM_TOKENS
from vrptw.bench.llm_run import (
    CAPS,
    FAILED_NAME,
    BudgetExceeded,
    guarded,
    run_llm_tier,
    worst_case_tokens,
)
from vrptw.cli import main
from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.llm.pricing import call_cost
from vrptw.llm.providers import PROVIDERS, LLMResponse, ProviderError, ToolCall
from vrptw.model import RunRecord
from vrptw.solvers.heuristic import solve

KEY = "sk-ant-centinela-07"
HAIKU, SONNET, OPUS = "claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"
ROUTES = solve(load_tfe2024("10c-1")).routes
AGENT_CALLS = 3  # dos turnos con herramientas y la respuesta final
TIER_CALLS = 3 * (1 + AGENT_CALLS)  # tres modelos, directo y agente

Entries = list[dict[str, Any]]


class FakeAPI:
    """Sustituto de `PROVIDERS["anthropic"]`: 1000 tokens de entrada y
    `tokens_out` de salida por llamada (sin pasar de su `max_tokens`, que anota en
    `limits`). `fail[n]` es el tipo de `ProviderError` de la llamada n."""

    def __init__(self) -> None:
        self.calls = 0
        self.fail: dict[int, str] = {}
        self.tokens_out = 500
        self.limits: list[int] = []

    def __call__(
        self,
        messages: Entries,
        tools: Entries,
        model: str,
        api_key: str,
        max_tokens: int,
    ) -> LLMResponse:
        assert api_key == KEY  # la clave sí llega al proveedor
        self.calls += 1
        self.limits.append(max_tokens)
        if self.fail.get(self.calls) == "ctrl+c":
            raise KeyboardInterrupt
        if self.calls in self.fail:
            raise ProviderError(self.fail[self.calls], "fake: fallo simulado")
        usage: dict[str, Any] = {
            "tokens_in": 1000,
            "tokens_out": min(self.tokens_out, max_tokens),
            "model": model,
        }
        turns = sum(m["role"] == "assistant" for m in messages)
        if tools and turns < AGENT_CALLS - 1:
            tool = ToolCall(
                f"toolu_{self.calls}", "evaluate_routes", {"routes": ROUTES}
            )
            return LLMResponse("", (tool,), "tool_use", **usage)
        return LLMResponse(json.dumps({"routes": ROUTES, "score": 1.0}), **usage)


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch) -> FakeAPI:
    fake = FakeAPI()
    monkeypatch.setitem(PROVIDERS, "anthropic", fake)
    return fake


def run(tmp_path: Path, **kwargs: Any) -> dict[str, list[str]]:
    return run_llm_tier(
        0, KEY, out_dir=tmp_path / "out", ledger=tmp_path / "ledger.json", **kwargs
    )


def ledger(tmp_path: Path) -> Entries:
    return llm_run.read_ledger(tmp_path / "ledger.json")


def failed(tmp_path: Path) -> Entries:
    return llm_run.read_ledger(tmp_path / "out" / FAILED_NAME)


def records(tmp_path: Path) -> list[RunRecord]:
    return [
        RunRecord.model_validate_json(p.read_text(encoding="utf-8"))
        for p in (tmp_path / "out").glob("tfe2024-*.json")
    ]


def spent(entries: Entries, **match: Any) -> float:
    return sum(e["usd"] for e in entries if all(e[k] == v for k, v in match.items()))


def previous_spend(tmp_path: Path, tier: int, model: str, usd: float) -> None:
    """Gasto de otra pasada (otro escalón) ya apuntado en el libro."""
    entry = {"tier": tier, "model": model, "usd": usd, "estimated": False}
    (tmp_path / "ledger.json").write_text(json.dumps([entry]), encoding="utf-8")


def test_tier_cap_stops_without_calling(api: FakeAPI, tmp_path: Path) -> None:
    status = run(tmp_path, caps=CAPS._replace(tier={0: 0.05}))
    # Haiku cabe. La primera llamada de Sonnet costaría de verdad 0,007 USD, pero
    # su peor caso pasa de 0,05 USD solo por los 8000 tokens de salida a 10 USD
    # por millón: no se hace, y nada más del escalón se lanza.
    assert api.calls == 1 + AGENT_CALLS
    entries = ledger(tmp_path)
    assert {e["model"] for e in entries} == {HAIKU}
    assert spent(entries) <= 0.05
    [stop] = failed(tmp_path)
    assert stop["kind"] == "budget" and stop["role"] == "llm_direct"
    assert stop["model"] == SONNET and stop["message"].endswith("superaría escalón 0")
    assert [len(status[k]) for k in ("done", "failed", "skipped")] == [2, 1, 3]
    assert len(records(tmp_path)) == 2


def test_model_cap_reads_other_tiers_and_stops_only_that_model(
    api: FakeAPI, tmp_path: Path
) -> None:
    # subtope de Haiku de 0,5526 USD; su peor caso pasa de 0,004 USD
    caps = CAPS._replace(model={HAIKU: 0.5526})
    before = caps.model[HAIKU] - 0.001
    previous_spend(tmp_path, tier=3, model=HAIKU, usd=before)
    status = run(tmp_path, caps=caps)
    assert api.calls == 2 * (1 + AGENT_CALLS)  # Sonnet y Opus, ninguna de Haiku
    assert spent(ledger(tmp_path), model=HAIKU) == before
    [stop] = failed(tmp_path)
    assert stop["kind"] == "budget" and stop["role"] == "llm_direct"
    assert stop["model"] == HAIKU and stop["message"].endswith(
        f"superaría modelo {HAIKU}"
    )
    assert [len(status[k]) for k in ("done", "failed", "skipped")] == [4, 1, 1]
    assert HAIKU in status["skipped"][0]


def test_global_cap_counts_previous_spend(api: FakeAPI, tmp_path: Path) -> None:
    previous_spend(tmp_path, tier=2, model=SONNET, usd=3.0)
    status = run(tmp_path, caps=CAPS._replace(total=3.05))
    assert api.calls == 1 + AGENT_CALLS  # solo Haiku cabe
    assert spent(ledger(tmp_path)) <= 3.05
    [stop] = failed(tmp_path)
    assert stop["model"] == SONNET and stop["message"].endswith("superaría global")
    assert [len(status[k]) for k in ("done", "failed", "skipped")] == [2, 1, 3]


def test_default_caps_are_only_the_global_one() -> None:
    assert CAPS == (({}, {}, 40.0))


def test_guard_counts_previous_output_as_input(api: FakeAPI, tmp_path: Path) -> None:
    """La salida de la llamada anterior vuelve como entrada (el razonamiento
    reenviado llega con el texto vacío y no suma bytes). Con el tope del escalón a
    medio camino entre contarla y no contarla, la segunda llamada no se hace."""
    api.tokens_out = 6000
    [job] = llm_run.jobs(0, [OPUS], ["llm_agent"])
    msgs: Entries = [{"role": "user", "content": "hola"}]
    tools: Entries = [{"name": "t"}]
    paid = call_cost(OPUS, 1000, 6000).usd
    without, counted = (
        call_cost(OPUS, *worst_case_tokens(msgs, tools, previous, 2000)).usd
        for previous in (0, 6000)
    )
    caps = CAPS._replace(tier={0: paid + (without + counted) / 2})
    call = guarded(job, tmp_path / "ledger.json", caps)
    call(msgs, tools, OPUS, KEY, 8000)
    with pytest.raises(BudgetExceeded):
        call(msgs, tools, OPUS, KEY, 2000)
    assert api.calls == 1 and spent(ledger(tmp_path)) == pytest.approx(paid)


def test_ledger_has_one_entry_per_call(api: FakeAPI, tmp_path: Path) -> None:
    run(tmp_path)
    entries = ledger(tmp_path)
    assert len(entries) == api.calls == TIER_CALLS
    agent = [e["call"] for e in entries if e["model"] == HAIKU]
    assert agent == [1, 1, 2, 3]  # directo y luego las tres del agente
    for e in entries:
        assert (e["tier"], e["rep"], e["instance"]) == (0, 0, "tfe2024-10c-1")
        assert (e["tokens_in"], e["tokens_out"], e["estimated"]) == (1000, 500, False)
    # el libro y los RunRecord suman lo mismo
    total = sum(r.api_cost or 0 for r in records(tmp_path))
    assert spent(entries) == pytest.approx(total)
    assert sum(e["eur"] for e in entries) == pytest.approx(total / 1.1052)
    # el agente recibe en cada llamada lo que queda de sus 8000 de presupuesto
    assert api.limits[:4] == [8000, 8000, 7500, 7000]


def test_resume_does_not_repeat(
    api: FakeAPI, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = run(tmp_path)
    assert len(first["done"]) == 6 and api.calls == TIER_CALLS
    before = ledger(tmp_path)

    second = run(tmp_path)
    assert api.calls == TIER_CALLS  # ninguna llamada nueva
    assert second["cached"] == first["done"] and not second["done"]
    assert ledger(tmp_path) == before
    rs = records(tmp_path)
    assert len(rs) == 6 and all(r.parse_status == "ok" for r in rs)
    assert all((r.params["tier"], r.params["rep"]) == (0, 0) for r in rs)
    assert all(r.params["effort"] == "medium" for r in rs)
    assert [r.params.get("output_budget") for r in rs if r.role == "llm_agent"] == [
        8000
    ] * 3
    assert not list(tmp_path.rglob("*.tmp"))

    # otra versión del prompt es otra clave: se vuelve a ejecutar
    monkeypatch.setattr(llm_run, "PROMPT_VERSION", "vrptw-prompt-otra")
    assert len(run(tmp_path)["done"]) == 6 and api.calls == 2 * TIER_CALLS


def test_max_tokens_override_is_another_cache_key(api: FakeAPI, tmp_path: Path) -> None:
    """Lo hecho con los 8000 del escalón 0 no cuenta como hecho con 16000: las
    seis ejecuciones se repiten, con 16000 en el directo y como presupuesto de
    salida del agente, y una tercera pasada con 16000 ya no llama."""
    first = run(tmp_path)
    second = run(tmp_path, max_tokens=16000)
    assert not second["cached"] and len(second["done"]) == 6
    assert api.calls == 2 * TIER_CALLS
    assert all("_mt8000_" in s for s in first["done"])
    assert all("_mt16000_" in s for s in second["done"])
    assert api.limits[TIER_CALLS : TIER_CALLS + 4] == [16000, 16000, 15500, 15000]
    budgets = [
        r.params["output_budget"] for r in records(tmp_path) if r.role == "llm_agent"
    ]
    assert sorted(budgets) == [8000] * 3 + [16000] * 3
    third = run(tmp_path, max_tokens=16000)
    assert third["cached"] == second["done"] and api.calls == 2 * TIER_CALLS


def test_tool_time_limit_is_another_cache_key_only_for_the_agent(
    api: FakeAPI, tmp_path: Path
) -> None:
    """Sin corte por tiempo solo se repiten las tres ejecuciones del agente; el
    directo y las claves de siempre no cambian."""
    first = run(tmp_path)
    second = run(tmp_path, max_tool_time_s=None)
    assert sorted(second["cached"]) == sorted(
        s for s in first["done"] if "_llm_direct_" in s
    )
    assert len(second["done"]) == 3
    assert all("_llm_agent_" in s and "_mt8000_ttfull_r0_" in s for s in second["done"])
    assert not any("_tt" in s for s in first["done"])
    assert api.calls == TIER_CALLS + 3 * AGENT_CALLS
    agents = [r for r in records(tmp_path) if r.role == "llm_agent"]
    assert sorted(str(r.params["max_tool_time_s"]) for r in agents) == (
        ["10.0"] * 3 + ["None"] * 3
    )


def test_jobs_select_instances_reps_and_max_tokens() -> None:
    default = llm_run.jobs(4)
    assert len(default) == 3 * 2 * 3 * 2  # instancias, repeticiones, modelos, papeles
    assert {j.max_tokens for j in default} == {10000}
    chosen = llm_run.jobs(4, instances=["C101"], reps=1, max_tokens=16000)
    assert len(chosen) == 3 * 2
    assert {(j.instance.id, j.rep, j.max_tokens) for j in chosen} == {
        ("c101-100-trunc-cam", 0, 16000)
    }
    # sin `instances`, los casos reales siguen fuera
    assert {j.instance.source for j in llm_run.jobs(1, reps=1)} == {"tfe2024"}


@pytest.mark.parametrize(("kind", "estimated"), [("network", 1), ("bad_request", 0)])
def test_provider_error_mid_agent_is_kept_and_retried(
    kind: str, estimated: int, api: FakeAPI, tmp_path: Path
) -> None:
    only: dict[str, Any] = {"models": [HAIKU], "roles": ["llm_agent"]}
    api.fail = {AGENT_CALLS: kind}  # la última llamada de la ejecución
    status = run(tmp_path, **only)
    assert api.calls == AGENT_CALLS and status["failed"] and not status["done"]
    entries = ledger(tmp_path)
    # las dos llamadas pagadas y, si la petición pudo cobrarse (red), la fallida
    # con su peor caso
    assert [e["call"] for e in entries] == [1, 2, 3][: 2 + estimated]
    assert sum(e["estimated"] for e in entries) == estimated
    # su salida máxima es lo que quedaba del presupuesto: 8000 - 2 x 500
    assert all(e["tokens_out"] == 7000 for e in entries if e["estimated"])
    [failure] = failed(tmp_path)
    assert failure["kind"] == kind and failure["run"] == status["failed"][0]
    assert records(tmp_path) == []

    status = run(tmp_path, **only)  # reanudar
    assert api.calls == 2 * AGENT_CALLS and len(status["done"]) == 1
    assert ledger(tmp_path)[: len(entries)] == entries


def test_rate_limit_stops_the_tier(api: FakeAPI, tmp_path: Path) -> None:
    api.fail = {1: "rate_limit"}
    with pytest.raises(ProviderError):
        run(tmp_path)
    assert api.calls == 1 and failed(tmp_path)[0]["kind"] == "rate_limit"
    assert ledger(tmp_path) == []


def test_timeout_is_charged_at_worst_case(api: FakeAPI, tmp_path: Path) -> None:
    api.fail = {1: "timeout"}
    status = run(tmp_path, models=[HAIKU], roles=["llm_direct"])
    [record] = records(tmp_path)
    assert record.parse_status == "timeout" and len(status["done"]) == 1
    [entry] = ledger(tmp_path)
    assert entry["estimated"] and entry["tokens_out"] == 8000


def test_ctrl_c_during_a_call_is_charged(api: FakeAPI, tmp_path: Path) -> None:
    api.fail = {2: "ctrl+c"}  # primera llamada del agente de Haiku
    with pytest.raises(KeyboardInterrupt):
        run(tmp_path, models=[HAIKU])
    paid, interrupted = ledger(tmp_path)
    assert not paid["estimated"] and paid["role"] == "llm_direct"
    assert interrupted["estimated"] and interrupted["role"] == "llm_agent"
    assert len(records(tmp_path)) == 1


def test_worst_case_tokens() -> None:
    messages = [{"role": "user", "content": "ñ" * 100}]
    tokens_in, tokens_out = worst_case_tokens(messages, [], 0, 8000)
    assert tokens_in >= 200 and tokens_out == 8000  # 2 bytes por "ñ"
    tools = [{"name": "t"}]
    with_tools, _ = worst_case_tokens(messages, tools, 700, 8000)
    tool_bytes = len('{"name": "t"}')
    assert with_tools >= tokens_in + tool_bytes + TOOL_SYSTEM_TOKENS + 700


def cli(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *args: str) -> int:
    monkeypatch.setattr(llm_run, "LEDGER_PATH", tmp_path / "ledger.json")
    out = ["--out-dir", str(tmp_path / "out")]
    return main(["bench", "llm", "--tier", "0", *out, *args])


def test_cli_without_confirm_makes_no_call(
    api: FakeAPI,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", KEY)
    assert cli(tmp_path, monkeypatch) == 0
    out = capsys.readouterr().out
    assert api.calls == 0 and list(tmp_path.iterdir()) == []
    assert "6 pendientes" in out and "Peor caso" in out and "Total" in out


def test_cli_plan_applies_instances_reps_and_max_tokens(
    api: FakeAPI,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    run(tmp_path)  # el escalón 0 ya hecho con sus 8000
    calls, files = api.calls, sorted(tmp_path.rglob("*"))
    capsys.readouterr()
    args = ("--instances", "10c-1", "--reps", "2", "--max-tokens", "16000")
    assert cli(tmp_path, monkeypatch, *args) == 0
    out = capsys.readouterr().out
    assert api.calls == calls and sorted(tmp_path.rglob("*")) == files
    assert "12 ejecuciones, 0 ya hechas" in out and "12 pendientes" in out
    assert "max_tokens 16000" in out and "repeticiones: 2" in out
    assert "con un tope de 10 s" in out


def test_cli_plan_without_tool_time_limit(
    api: FakeAPI,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    run(tmp_path)  # el escalón 0 ya hecho con el tope de siempre
    capsys.readouterr()
    assert cli(tmp_path, monkeypatch, "--no-tool-time-limit") == 0
    out = capsys.readouterr().out
    assert "6 ejecuciones, 3 ya hechas" in out and "3 pendientes" in out
    assert "sin corte por tiempo" in out


def test_cli_without_key_exits_1(
    api: FakeAPI,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert cli(tmp_path, monkeypatch, "--confirm") == 1
    err = capsys.readouterr().err
    assert "ANTHROPIC_API_KEY" in err and "Traceback" not in err
    assert api.calls == 0 and list(tmp_path.iterdir()) == []


def test_cli_rejects_unknown_model(
    api: FakeAPI, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    assert cli(tmp_path, monkeypatch, "--models", "gpt-5") == 1


def test_key_is_not_written_nor_printed(
    api: FakeAPI,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capfd: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", KEY)
    api.fail = {2: "network", 3: "bad_request"}  # para que haya failed.json
    assert cli(tmp_path, monkeypatch, "--confirm") == 0
    out, err = capfd.readouterr()
    assert api.calls > 0 and "terminadas ahora" in out
    files = [p for p in tmp_path.rglob("*") if p.is_file()]
    names = {p.name for p in files}
    assert {"ledger.json", FAILED_NAME} <= names and len(records(tmp_path)) == 4
    for path in files:
        assert KEY.encode() not in path.read_bytes(), path
    assert KEY not in out and KEY not in err


def test_write_atomic_retries_a_locked_destination(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """En Windows, otro proceso leyendo el libro hace fallar `os.replace` con
    PermissionError: se reintenta y la anotación no se pierde."""
    real = llm_run.os.replace
    failures = iter([True, True, True])

    def flaky(src: Any, dst: Any) -> None:
        if next(failures, False):
            raise PermissionError(13, "Acceso denegado")
        real(src, dst)

    monkeypatch.setattr(llm_run.os, "replace", flaky)
    monkeypatch.setattr(llm_run.time, "sleep", lambda s: None)
    path = tmp_path / "ledger.json"
    llm_run.write_atomic(path, "[]")
    assert path.read_text(encoding="utf-8") == "[]"

    failures = iter([True] * llm_run.REPLACE_ATTEMPTS)
    with pytest.raises(PermissionError):
        llm_run.write_atomic(path, "[1]")
