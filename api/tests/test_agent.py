"""El LLM como agente con herramientas, siempre con el proveedor `fake`."""

import itertools
import json
import logging
from typing import Any

import pytest

from vrptw.evaluate import evaluate
from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.llm import agent
from vrptw.llm.agent import (
    MAX_TOOL_TIME_S,
    MAX_TURNS,
    MIN_CALL_TOKENS,
    TOOLS,
    solve_agent,
)
from vrptw.llm.prompts import PROMPT_VERSION, agent_prompt
from vrptw.llm.providers import (
    PROVIDERS,
    LLMResponse,
    ProviderError,
    Script,
    ToolCall,
    make_fake,
)
from vrptw.model import RunRecord, Solution
from vrptw.solvers.registry import SOLVERS

KEY = "sk-ant-centinela-03"
INSTANCE = load_tfe2024("10c-1")
HEURISTIC = SOLVERS["heuristic"](INSTANCE).routes
_ids = itertools.count(1)

Messages = list[dict[str, Any]]


def tool(name: str, **arguments: Any) -> ToolCall:
    return ToolCall(f"toolu_{next(_ids):02d}", name, arguments)


def turn(*calls: ToolCall) -> LLMResponse:
    """Un turno del modelo que solo pide herramientas."""
    return LLMResponse(
        text="", tool_calls=calls, stop_reason="tool_use", tokens_in=100, tokens_out=10
    )


def answer(routes: list[list[int]], score: float = 1.0) -> LLMResponse:
    text = f"Solución final:\n{json.dumps({'routes': routes, 'score': score})}"
    return LLMResponse(text=text, tokens_in=300, tokens_out=40)


def run(script: Script, monkeypatch: pytest.MonkeyPatch, **kwargs: Any) -> RunRecord:
    monkeypatch.setitem(PROVIDERS, "fake", make_fake(script))
    return solve_agent(INSTANCE, "fake", "fake-model", KEY, 4000, **kwargs)


def trace(record: RunRecord) -> list[dict[str, Any]]:
    assert record.tool_calls is not None
    return record.tool_calls


def roles(record: RunRecord) -> list[str]:
    assert record.messages is not None
    return [m["role"] for m in record.messages]


def spy_solver(received: list[dict[str, Any]]) -> Any:
    """Solver falso que anota los argumentos con nombre que recibe."""

    def spy(instance: Any, **kwargs: Any) -> Solution:
        received.append(kwargs)
        return Solution(routes=HEURISTIC)

    return spy


def test_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    def decide(messages: Messages, tools: Messages) -> LLMResponse:
        assert tools == TOOLS
        if len(messages) == 1:
            return turn(tool("solve_classic", method="heuristic", time_limit_s=5))
        return answer(json.loads(messages[-1]["content"])["routes"], score=7.5)

    record = run(decide, monkeypatch)
    expected = evaluate(INSTANCE, Solution(routes=HEURISTIC))

    assert record.parse_status == "ok" and record.role == "llm_agent"
    assert record.solution == Solution(routes=HEURISTIC)
    assert record.evaluation == expected
    assert record.self_reported_score == 7.5
    assert (record.tokens_in, record.tokens_out) == (400, 50)
    assert record.prompt_version == PROMPT_VERSION and record.seed == 0
    assert record.params == {
        "max_tokens": 4000,
        "max_turns": MAX_TURNS,
        "max_tool_time_s": MAX_TOOL_TIME_S,
    }
    assert roles(record) == ["user", "assistant", "tool", "assistant"]
    assert record.messages is not None
    assert record.messages[0]["content"] == agent_prompt(INSTANCE, MAX_TURNS)

    result = record.messages[2]
    assert result["is_error"] is False and " " not in result["content"]
    assert json.loads(result["content"]) == {
        "routes": HEURISTIC,
        "score": expected.score,
        "distance": expected.distance,
        "vehicles_used": expected.vehicles_used,
        "unserved": expected.unserved,
        "feasible": expected.feasible,
        "violations": {},
    }
    [entry] = trace(record)
    assert entry["name"] == "solve_classic" and entry["is_error"] is False
    assert entry["arguments"] == {"method": "heuristic", "time_limit_s": 5}
    assert entry["result"]["score"] == expected.score and entry["time_s"] >= 0


def test_compares_two_methods_then_evaluates(monkeypatch: pytest.MonkeyPatch) -> None:
    def decide(messages: Messages, tools: Messages) -> LLMResponse:
        turns = sum(m["role"] == "assistant" for m in messages)
        results = [json.loads(m["content"]) for m in messages if m["role"] == "tool"]
        if turns == 0:
            return turn(
                tool("solve_classic", method="heuristic", time_limit_s=1),
                tool("solve_classic", method="tabu", time_limit_s=1),
            )
        best = min(results[:2], key=lambda r: r["score"])["routes"]
        if turns == 1:
            # prueba una variante peor: sin el último cliente de la primera ruta
            variant = [best[0][:-1], *best[1:]]
            return turn(tool("evaluate_routes", routes=variant))
        return answer(best)  # se queda con la mejor, no con la última evaluada

    record = run(decide, monkeypatch)
    entries = trace(record)
    assert [e["name"] for e in entries] == [
        "solve_classic",
        "solve_classic",
        "evaluate_routes",
    ]
    assert not any(e["is_error"] for e in entries)
    assert roles(record) == [
        "user",
        "assistant",
        "tool",
        "tool",
        "assistant",
        "tool",
        "assistant",
    ]
    heuristic, tabu, evaluated = (e["result"] for e in entries)
    best = min(heuristic, tabu, key=lambda r: r["score"])["routes"]
    assert "routes" not in evaluated and evaluated["unserved"] == 1
    assert evaluated["violations"]["unserved"] == 1
    assert record.parse_status == "ok"
    assert record.solution == Solution(routes=best)
    assert record.evaluation == evaluate(INSTANCE, Solution(routes=best))
    assert record.evaluation.unserved == 0


@pytest.mark.parametrize("kwargs", [{}, {"max_turns": 2}])
def test_runs_out_of_turns(
    kwargs: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = 0

    def decide(messages: Messages, tools: Messages) -> LLMResponse:
        nonlocal calls
        calls += 1
        return turn(tool("evaluate_routes", routes=HEURISTIC))

    record = run(decide, monkeypatch, **kwargs)
    max_turns = kwargs.get("max_turns", 6)
    assert calls == max_turns
    assert record.parse_status == "unparseable" and record.stop_reason == "tool_use"
    assert record.solution is None and record.evaluation is None
    # las llamadas del último turno no se ejecutan: el modelo ya no las vería
    assert len(trace(record)) == max_turns - 1
    assert record.messages is not None and record.messages[-1]["tool_calls"]
    assert record.tokens_in == 100 * max_turns


def test_final_answer_without_json_is_unparseable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = run([LLMResponse(text="No sé resolverlo.")], monkeypatch)
    assert record.parse_status == "unparseable" and record.solution is None
    assert trace(record) == [] and roles(record) == ["user", "assistant"]


def test_unknown_method_lets_the_model_correct_itself(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    script = [
        turn(tool("solve_classic", method="simplex", time_limit_s=1)),
        turn(tool("solve_classic", method="heuristic", time_limit_s=1)),
        answer(HEURISTIC),
    ]
    record = run(script, monkeypatch)
    first, second = trace(record)
    assert first["is_error"] is True and second["is_error"] is False
    assert all(m in first["result"] for m in SOLVERS)
    assert record.messages is not None and record.messages[2]["is_error"] is True
    assert record.parse_status == "ok"
    assert record.solution == Solution(routes=HEURISTIC)


@pytest.mark.parametrize(
    ("name", "arguments"),
    [
        ("solve_classic", {"method": 3, "time_limit_s": 1}),
        ("solve_classic", {"method": "heuristic"}),
        ("solve_classic", {"method": "heuristic", "time_limit_s": "5"}),
        ("solve_classic", {"method": "heuristic", "time_limit_s": 0}),
        ("solve_classic", {"method": "heuristic", "time_limit_s": -1}),
        ("solve_classic", {"method": "heuristic", "time_limit_s": True}),
        ("solve_classic", {"method": "heuristic", "time_limit_s": float("nan")}),
        ("solve_classic", {"method": "ga", "time_limit_s": 1, "params": {"x": 1}}),
        ("evaluate_routes", {"routes": [[1, "2"]]}),
        ("evaluate_routes", {"routes": "1,2"}),
        ("evaluate_routes", {"routes": [[1.5]]}),
        ("evaluate_routes", {}),
        ("evaluate_routes", {"routes": [[1]], "extra": 1}),
        ("run_python", {"code": "print(1)"}),
    ],
)
def test_invalid_arguments_are_tool_errors(
    name: str, arguments: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    record = run([turn(tool(name, **arguments)), answer(HEURISTIC)], monkeypatch)
    [entry] = trace(record)
    assert entry["is_error"] is True and isinstance(entry["result"], str)
    assert record.messages is not None and record.messages[2]["is_error"] is True
    assert record.parse_status == "ok"


def test_solver_params_are_not_reachable(monkeypatch: pytest.MonkeyPatch) -> None:
    received: list[dict[str, Any]] = []
    monkeypatch.setitem(SOLVERS, "ga", spy_solver(received))
    monkeypatch.setitem(SOLVERS, "tabu", spy_solver(received))
    script = [
        turn(
            tool("solve_classic", method="ga", time_limit_s=1, legacy=True),
            tool("solve_classic", method="tabu", time_limit_s=1, iterations=10**6),
        ),
        turn(tool("solve_classic", method="ga", time_limit_s=1)),
        answer(HEURISTIC),
    ]
    record = run(script, monkeypatch)
    legacy, iterations, valid = trace(record)
    assert legacy["is_error"] and "legacy" in legacy["result"]
    assert iterations["is_error"] and "iterations" in iterations["result"]
    assert not valid["is_error"]
    # el único solver ejecutado recibe solo la semilla y el tiempo
    assert received == [{"seed": 0, "time_limit_s": 1.0}]


@pytest.mark.parametrize(
    ("limit", "expected"),
    [
        (0.5, 0.5),
        (10**6, MAX_TOOL_TIME_S),
        (1e308, MAX_TOOL_TIME_S),
        (10**400, MAX_TOOL_TIME_S),
    ],
)
def test_time_limit_is_capped(
    limit: float, expected: float, monkeypatch: pytest.MonkeyPatch
) -> None:
    received: list[dict[str, Any]] = []
    monkeypatch.setitem(SOLVERS, "aco", spy_solver(received))
    script = [
        turn(tool("solve_classic", method="aco", time_limit_s=limit)),
        answer(HEURISTIC),
    ]
    record = run(script, monkeypatch, seed=7)
    assert received == [{"seed": 7, "time_limit_s": expected}]
    assert record.seed == 7 and not trace(record)[0]["is_error"]


def test_without_time_limit_solvers_run_to_completion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    received: list[dict[str, Any]] = []
    monkeypatch.setitem(SOLVERS, "tabu", spy_solver(received))
    offered: list[Messages] = []

    def decide(messages: Messages, tools: Messages) -> LLMResponse:
        offered.append(tools)
        if len(messages) == 1:
            return turn(
                tool("solve_classic", method="tabu", time_limit_s=10),
                tool("solve_classic", method="tabu"),
            )
        return answer(HEURISTIC)

    record = run(decide, monkeypatch, seed=3, max_tool_time_s=None)
    with_limit, without = trace(record)
    # la herramienta ya no admite tiempo, y el método no recibe tope
    assert with_limit["is_error"] and "time_limit_s" in with_limit["result"]
    assert not without["is_error"]
    assert received == [{"seed": 3, "time_limit_s": None}]
    schema = offered[0][0]["parameters"]
    assert schema["required"] == ["method"] and "time_limit_s" not in str(offered[0])
    assert offered[0] != TOOLS and all(t == offered[0] for t in offered)
    assert record.params["max_tool_time_s"] is None


def test_refusal_after_a_tool_turn(monkeypatch: pytest.MonkeyPatch) -> None:
    refusal = LLMResponse(text="", stop_reason="refusal", tokens_in=50)
    script = [turn(tool("solve_classic", method="heuristic", time_limit_s=1)), refusal]
    record = run(script, monkeypatch)
    assert record.parse_status == "refused" and record.stop_reason == "refusal"
    assert record.solution is None and record.evaluation is None
    assert len(trace(record)) == 1 and record.tokens_in == 150


def test_timeout_returns_record(monkeypatch: pytest.MonkeyPatch) -> None:
    def decide(messages: Messages, tools: Messages) -> LLMResponse:
        if len(messages) == 1:
            return turn(tool("solve_classic", method="heuristic", time_limit_s=1))
        raise ProviderError("timeout", "fake: sin respuesta")

    record = run(decide, monkeypatch)
    assert record.parse_status == "timeout" and record.solution is None
    assert roles(record) == ["user", "assistant", "tool"]
    assert len(trace(record)) == 1 and record.tokens_in == 100


def test_auth_error_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    def decide(messages: Messages, tools: Messages) -> LLMResponse:
        raise ProviderError("auth", "anthropic: clave de API no válida (HTTP 401)")

    with pytest.raises(ProviderError) as info:
        run(decide, monkeypatch)
    assert info.value.kind == "auth"
    assert KEY not in str(info.value)


def budgeted(out: int, limits: list[int]) -> Any:
    """Proveedor que anota el `max_tokens` de cada llamada, gasta `out` tokens de
    salida (sin pasar de él) y siempre pide una herramienta."""

    def call(
        messages: Messages, tools: Messages, model: str, api_key: str, max_tokens: int
    ) -> LLMResponse:
        limits.append(max_tokens)
        calls = (tool("evaluate_routes", routes=HEURISTIC),)
        return LLMResponse("", calls, "tool_use", tokens_out=min(out, max_tokens))

    return call


def test_output_budget_shrinks_each_call_and_stops() -> None:
    limits: list[int] = []
    record = solve_agent(
        INSTANCE,
        "fake",
        "fake-model",
        KEY,
        8000,
        call=budgeted(3000, limits),
        output_budget=8000,
    )
    # quedan 8000, 5000 y 2000; tras la tercera, 0 < MIN_CALL_TOKENS
    assert limits == [8000, 5000, 2000] and record.tokens_out == 8000
    assert record.parse_status == "unparseable" and record.solution is None
    assert record.params["output_budget"] == 8000
    assert record.params["early_stop"] == "output_budget"
    assert len(trace(record)) == 2  # las herramientas de la tercera no se ejecutan


def test_output_budget_below_minimum_makes_no_call() -> None:
    limits: list[int] = []
    record = solve_agent(
        INSTANCE,
        "fake",
        "fake-model",
        KEY,
        8000,
        call=budgeted(0, limits),
        output_budget=MIN_CALL_TOKENS - 1,
    )
    assert limits == [] and roles(record) == ["user"]
    assert record.parse_status == "unparseable"
    assert record.params["early_stop"] == "output_budget"


def test_without_budget_every_call_gets_max_tokens() -> None:
    limits: list[int] = []
    record = solve_agent(
        INSTANCE, "fake", "fake-model", KEY, 4000, call=budgeted(3000, limits)
    )
    assert limits == [4000] * MAX_TURNS
    assert "output_budget" not in record.params
    assert "early_stop" not in record.params


def test_key_is_not_recorded_nor_logged(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    script = [
        turn(tool("solve_classic", method="heuristic", time_limit_s=1)),
        turn(tool("evaluate_routes", routes=HEURISTIC), tool("unknown", x=1)),
        answer(HEURISTIC),
    ]
    record = run(script, monkeypatch)
    assert record.parse_status == "ok"
    assert KEY not in record.model_dump_json()
    assert KEY not in caplog.text
    assert KEY not in repr(vars(agent))
