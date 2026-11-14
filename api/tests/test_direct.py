"""El LLM como resolvedor directo, siempre con el proveedor `fake` guionizado."""

import json
import logging
from typing import Any

import pytest

from vrptw.evaluate import evaluate
from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.llm import direct
from vrptw.llm.direct import extract_routes, solve_direct
from vrptw.llm.prompts import PROMPT_VERSION, recheck_prompt, solve_prompt
from vrptw.llm.providers import PROVIDERS, LLMResponse, ProviderError, make_fake
from vrptw.model import Solution
from vrptw.solvers.heuristic import solve

KEY = "sk-ant-centinela-02"
INSTANCE = load_tfe2024("10c-1")
ROUTES = solve(INSTANCE).routes


def answer(routes: list[list[int]], score: float = 1.0) -> str:
    return json.dumps({"routes": routes, "score": score})


def run(
    script: list[LLMResponse], monkeypatch: pytest.MonkeyPatch, **kwargs: Any
) -> Any:
    monkeypatch.setitem(PROVIDERS, "fake", make_fake(script))
    return solve_direct(INSTANCE, "fake", "fake-model", KEY, 4000, **kwargs)


def test_solution_covers_all_customers() -> None:
    assert sorted(c for r in ROUTES for c in r) == [c.id for c in INSTANCE.customers]


def test_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    text = f"Aquí van las rutas.\n{answer(ROUTES, score=12345.6)}"
    reply = LLMResponse(text=text, tokens_in=900, tokens_out=300, model="fake-real")
    record = run([reply], monkeypatch)

    assert record.parse_status == "ok" and record.role == "llm_direct"
    assert record.solution == Solution(routes=ROUTES)
    assert record.evaluation == evaluate(INSTANCE, Solution(routes=ROUTES))
    assert record.self_reported_score == 12345.6
    assert record.evaluation is not None and record.evaluation.score != 12345.6
    assert (record.provider, record.model_requested) == ("fake", "fake-model")
    assert record.model_returned == "fake-real"
    assert record.prompt_version == PROMPT_VERSION
    assert (record.tokens_in, record.tokens_out) == (900, 300)
    assert record.api_cost is None and record.api_cost_eur is None
    assert record.price_table_version is None
    assert record.stop_reason == "end_turn" and record.raw_response == text
    assert record.messages is not None
    assert [m["role"] for m in record.messages] == ["user", "assistant"]
    assert record.messages[0]["content"] == solve_prompt(INSTANCE)
    assert record.instance_hash == INSTANCE.content_hash()


def test_text_without_json_is_unparseable(monkeypatch: pytest.MonkeyPatch) -> None:
    record = run([LLMResponse(text="No puedo darte rutas.", tokens_in=5)], monkeypatch)
    assert record.parse_status == "unparseable"
    assert record.solution is None and record.evaluation is None
    assert record.raw_response == "No puedo darte rutas."
    assert record.messages is not None and len(record.messages) == 2
    assert record.tokens_in == 5 and record.self_reported_score is None


@pytest.mark.parametrize(
    "text",
    [
        '{"routes": [[1, 2], "3"]}',
        '{"routes": [1, 2, 3]}',
        '{"routes": [[1.5]]}',
        '{"routes": [[true]]}',
        '{"routes": "1,2"}',
        '{"routes": [[1, 2]',
    ],
)
def test_wrong_shape_is_unparseable(text: str, monkeypatch: pytest.MonkeyPatch) -> None:
    assert run([LLMResponse(text=text)], monkeypatch).parse_status == "unparseable"


def test_invented_customer_is_flagged_by_evaluator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    routes = [[*ROUTES[0], 999], *ROUTES[1:]]
    record = run([LLMResponse(text=answer(routes))], monkeypatch)
    assert record.parse_status == "ok"
    assert record.evaluation is not None
    assert any(
        v.type == "unknown_customer" and v.customer == 999
        for v in record.evaluation.violations
    )
    assert not record.evaluation.feasible


def test_duplicate_customer_is_flagged_by_evaluator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    routes = [[*ROUTES[0], ROUTES[0][0]], *ROUTES[1:]]
    record = run([LLMResponse(text=answer(routes))], monkeypatch)
    assert record.parse_status == "ok" and record.evaluation is not None
    assert any(v.type == "duplicate" for v in record.evaluation.violations)


def test_json_in_markdown_block_with_text_after(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    text = f"Resultado:\n```json\n{answer(ROUTES, 7)}\n```\nEspero que sirva {{}}."
    record = run([LLMResponse(text=text)], monkeypatch)
    assert record.parse_status == "ok" and record.self_reported_score == 7
    assert record.solution == Solution(routes=ROUTES)


def test_last_json_block_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    text = (
        f"Primero:\n{answer([[1]], 1)}\nCorregido:\n```json\n{answer(ROUTES, 2)}\n```"
    )
    record = run([LLMResponse(text=text)], monkeypatch)
    assert record.solution == Solution(routes=ROUTES)
    assert record.self_reported_score == 2


def test_last_block_with_bad_shape_does_not_fall_back() -> None:
    text = f'{answer(ROUTES)}\n{{"routes": "ninguna"}}'
    assert extract_routes(text).routes is None


def test_refusal(monkeypatch: pytest.MonkeyPatch) -> None:
    record = run([LLMResponse(text="", stop_reason="refusal")], monkeypatch)
    assert record.parse_status == "refused"
    assert record.solution is None and record.evaluation is None
    assert record.stop_reason == "refusal"


def test_max_tokens_without_json(monkeypatch: pytest.MonkeyPatch) -> None:
    record = run(
        [LLMResponse(text="Calculando la ruta 1...", stop_reason="max_tokens")],
        monkeypatch,
    )
    assert record.parse_status == "unparseable"
    assert record.stop_reason == "max_tokens"


def failing(kind: str) -> Any:
    def decide(messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Any:
        raise ProviderError(kind, f"fake: {kind}")

    return decide


def test_timeout_returns_record(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(PROVIDERS, "fake", make_fake(failing("timeout")))
    record = solve_direct(INSTANCE, "fake", "fake-model", KEY, 4000)
    assert record.parse_status == "timeout"
    assert record.solution is None and record.evaluation is None
    assert record.messages is not None and len(record.messages) == 1
    assert record.tokens_in == 0 and record.raw_response is None


@pytest.mark.parametrize("kind", ["auth", "rate_limit", "network"])
def test_other_provider_errors_propagate(
    kind: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(PROVIDERS, "fake", make_fake(failing(kind)))
    with pytest.raises(ProviderError) as info:
        solve_direct(INSTANCE, "fake", "fake-model", KEY, 4000)
    assert info.value.kind == kind


def test_recheck_uses_second_answer_and_sums_tokens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = LLMResponse(text=answer([[1]], 1), tokens_in=1000, tokens_out=200)
    second = LLMResponse(text=answer(ROUTES, 2), tokens_in=1300, tokens_out=150)
    record = run([first, second], monkeypatch, recheck=True)

    assert record.solution == Solution(routes=ROUTES)
    assert record.self_reported_score == 2
    assert (record.tokens_in, record.tokens_out) == (2300, 350)
    assert record.raw_response == second.text
    assert record.messages is not None
    assert [m["role"] for m in record.messages] == [
        "user",
        "assistant",
        "user",
        "assistant",
    ]
    assert record.messages[2]["content"] == recheck_prompt()
    assert record.params == {"max_tokens": 4000, "recheck": True}


def test_recheck_timeout_in_second_call(monkeypatch: pytest.MonkeyPatch) -> None:
    def decide(messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Any:
        if len(messages) == 1:
            return LLMResponse(text=answer(ROUTES), tokens_in=10)
        raise ProviderError("timeout", "fake: timeout")

    monkeypatch.setitem(PROVIDERS, "fake", make_fake(decide))
    record = solve_direct(INSTANCE, "fake", "fake-model", KEY, 4000, recheck=True)
    assert record.parse_status == "timeout" and record.solution is None
    assert record.tokens_in == 10


def test_key_is_not_recorded_nor_logged(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    record = run([LLMResponse(text=answer(ROUTES))], monkeypatch)
    assert KEY not in record.model_dump_json()
    assert KEY not in caplog.text
    assert KEY not in repr(vars(direct))
