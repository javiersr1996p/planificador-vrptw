"""Rutas `/solve/llm` y `/explain` con `TestClient`: sin red y sin gasto.

El proveedor `anthropic` se sustituye por uno falso con `make_fake`; la clave es
siempre una centinela que no debe aparecer en ninguna respuesta ni registro.
"""

import json
import logging
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from vrptw.api import main
from vrptw.evaluate import evaluate
from vrptw.instances.camouflage import camouflage, restore_routes
from vrptw.instances.solomon import load_solomon
from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.llm.providers import (
    PROVIDERS,
    LLMResponse,
    ProviderError,
    ToolCall,
    make_fake,
)
from vrptw.model import Instance, Solution, TrafficWindow
from vrptw.solvers.heuristic import solve

KEY = "sk-ant-centinela-07"
HEADERS = {"X-LLM-Key": KEY}
MODEL = "claude-sonnet-5-5"
INSTANCE = load_tfe2024("10c-1")
ROUTES = solve(INSTANCE).routes


def dump(instance: Instance) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(instance.model_dump_json(by_alias=True))
    return data


def answer(routes: list[list[int]]) -> LLMResponse:
    return LLMResponse(text=f'```json\n{{"routes": {routes}, "score": 1}}\n```')


def body(instance: Instance = INSTANCE, **extra: Any) -> dict[str, Any]:
    return {
        "instance": dump(instance),
        "model": MODEL,
        "role": "llm_direct",
        **extra,
    }


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(main.app) as c:
        yield c


def use_fake(
    monkeypatch: pytest.MonkeyPatch, script: Any
) -> list[list[dict[str, Any]]]:
    """Instala el falso como `anthropic`; devuelve los `messages` de cada llamada."""
    seen: list[list[dict[str, Any]]] = []
    inner = make_fake(script)

    def call(
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        model: str,
        api_key: str,
        max_tokens: int,
    ) -> LLMResponse:
        seen.append([dict(m) for m in messages])
        return inner(messages, tools, model, api_key, max_tokens)

    monkeypatch.setitem(PROVIDERS, "anthropic", call)
    return seen


def test_direct_returns_evaluated_record(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    use_fake(monkeypatch, [answer(ROUTES)])
    r = client.post("/solve/llm", json=body(), headers=HEADERS)
    assert r.status_code == 200
    rec = r.json()
    assert rec["role"] == "llm_direct" and rec["parse_status"] == "ok"
    assert rec["solution"]["routes"] == ROUTES
    assert rec["evaluation"]["feasible"] is True
    assert rec["instance_hash"] == INSTANCE.content_hash()
    assert KEY not in r.text


def test_agent_returns_evaluated_record(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    tool = LLMResponse(
        text="",
        tool_calls=(
            ToolCall("t1", "solve_classic", {"method": "heuristic", "time_limit_s": 1}),
        ),
        stop_reason="tool_use",
    )
    use_fake(monkeypatch, [tool, answer(ROUTES)])
    r = client.post("/solve/llm", json=body(role="llm_agent", seed=3), headers=HEADERS)
    rec = r.json()
    assert r.status_code == 200 and rec["role"] == "llm_agent"
    assert rec["seed"] == 3 and rec["parse_status"] == "ok"
    assert rec["tool_calls"][0]["is_error"] is False
    assert rec["params"]["output_budget"] == rec["params"]["max_tokens"]
    assert rec["evaluation"]["feasible"] is True


def test_agent_cannot_pass_legacy(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    args = {"method": "ga", "time_limit_s": 1, "legacy": True}
    tool = LLMResponse(
        text="",
        tool_calls=(ToolCall("t1", "solve_classic", args),),
        stop_reason="tool_use",
    )
    use_fake(monkeypatch, [tool, answer(ROUTES)])
    r = client.post("/solve/llm", json=body(role="llm_agent"), headers=HEADERS)
    assert r.json()["tool_calls"][0]["is_error"] is True


@pytest.mark.parametrize("headers", [{}, {"X-LLM-Key": ""}])
def test_missing_or_empty_key_is_401(
    client: TestClient, headers: dict[str, str]
) -> None:
    assert client.post("/solve/llm", json=body(), headers=headers).status_code == 401
    explain = {
        "instance": dump(INSTANCE),
        "routes": ROUTES,
        "method": "x",
        "model": MODEL,
    }
    assert client.post("/explain", json=explain, headers=headers).status_code == 401


def test_unknown_model_is_422(client: TestClient) -> None:
    r = client.post("/solve/llm", json=body(model="gpt-x"), headers=HEADERS)
    assert r.status_code == 422


def test_extra_field_and_negative_seed_are_422(client: TestClient) -> None:
    assert client.post("/solve/llm", json=body(x=1), headers=HEADERS).status_code == 422
    r = client.post("/solve/llm", json=body(seed=-1), headers=HEADERS)
    assert r.status_code == 422


def test_matrix_is_required(client: TestClient) -> None:
    data = body()
    data["instance"]["matrix"] = None
    assert client.post("/solve/llm", json=data, headers=HEADERS).status_code == 422


def test_recheck_makes_two_calls(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen = use_fake(monkeypatch, [answer([]), answer(ROUTES)])
    r = client.post("/solve/llm", json=body(recheck=True), headers=HEADERS)
    assert r.status_code == 200 and len(seen) == 2
    assert r.json()["solution"]["routes"] == ROUTES


def test_solomon_is_camouflaged(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = load_solomon("c101", 25, truncated=True)
    camo = camouflage(original)
    camo_routes = solve(camo).routes
    seen = use_fake(monkeypatch, [answer(camo_routes)])
    r = client.post("/solve/llm", json=body(original), headers=HEADERS)
    assert r.status_code == 200
    rec = r.json()
    assert original.id not in seen[0][0]["content"]
    assert rec["params"]["camouflaged"] is True
    assert rec["instance_id"] == original.id
    assert rec["instance_hash"] == original.content_hash()
    restored = restore_routes(original, camo_routes)
    assert rec["solution"]["routes"] == restored
    expected = evaluate(original, Solution(routes=restored))
    assert rec["evaluation"] == json.loads(expected.model_dump_json())


def test_solomon_with_traffic_profile_is_422(client: TestClient) -> None:
    original = load_solomon("c101", 25, truncated=True).model_copy(
        update={
            "traffic_profile": [TrafficWindow(**{"from": 0, "to": 100, "factor": 1.5})]
        }
    )
    r = client.post("/solve/llm", json=body(original), headers=HEADERS)
    assert r.status_code == 422


def shift_ids(data: dict[str, Any]) -> None:
    for c in data["customers"]:
        c["id"] += 2


@pytest.mark.parametrize(
    ("change", "loc"),
    [
        (lambda d: d["depot"].update(x=None, y=None), "instance"),
        (lambda d: d["customers"][3].update(y=None), "instance"),
        (shift_ids, "instance.customers"),
        (lambda d: d["matrix"]["distance"][0].__setitem__(1, 99.0), "instance.matrix"),
        (lambda d: d["matrix"]["time"][2].__setitem__(1, 0.0), "instance.matrix"),
        (lambda d: d["matrix"].update(source="euclidean"), "instance.matrix"),
    ],
    ids=[
        "sin-xy-deposito",
        "sin-y-cliente",
        "ids-3-a-n+2",
        "distancia",
        "tiempo",
        "sin-truncar",
    ],
)
def test_solomon_that_cannot_be_camouflaged_is_422(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, change: Any, loc: str
) -> None:
    seen = use_fake(monkeypatch, [answer(ROUTES)])
    data = body(load_solomon("c101", 25, truncated=True))
    change(data["instance"])
    r = client.post("/solve/llm", json=data, headers=HEADERS)
    assert r.status_code == 422 and r.json()["detail"][0]["loc"] == loc
    assert seen == []


def test_cartesian_with_traffic_is_422_only_in_llm(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen = use_fake(monkeypatch, [answer(ROUTES)])
    data = body()
    data["instance"]["traffic_profile"] = [{"from": 0, "to": 100, "factor": 1.5}]
    r = client.post("/solve/llm", json=data, headers=HEADERS)
    assert r.status_code == 422 and seen == []
    assert r.json()["detail"] == [
        {
            "loc": "instance.traffic_profile",
            "msg": "el tráfico solo se admite en casos sobre mapa",
        }
    ]
    evaluated = {"instance": data["instance"], "routes": ROUTES}
    assert client.post("/evaluate", json=evaluated).status_code == 200


@pytest.mark.parametrize(
    ("kind", "status"),
    [("auth", 401), ("rate_limit", 429), ("timeout", 502), ("server", 502)],
)
def test_provider_errors(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, kind: str, status: int
) -> None:
    def fail(
        messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> LLMResponse:
        raise ProviderError(kind, f"anthropic: {kind}")

    use_fake(monkeypatch, fail)
    path, payload = (
        "/explain",
        {
            "instance": dump(INSTANCE),
            "routes": ROUTES,
            "method": "x",
            "model": MODEL,
        },
    )
    assert client.post(path, json=payload, headers=HEADERS).status_code == status
    if kind != "timeout":  # en /solve/llm, el tiempo agotado es un registro
        r = client.post("/solve/llm", json=body(), headers=HEADERS)
        assert r.status_code == status and r.json() == {"detail": f"anthropic: {kind}"}


def test_timeout_is_a_record(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(
        messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> LLMResponse:
        raise ProviderError("timeout", "anthropic: sin respuesta")

    use_fake(monkeypatch, fail)
    r = client.post("/solve/llm", json=body(), headers=HEADERS)
    assert r.status_code == 200 and r.json()["parse_status"] == "timeout"


def test_unhandled_exception_is_500_without_leaks(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    def boom(
        messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> LLMResponse:
        raise RuntimeError(f"fallo con {KEY} dentro")

    use_fake(monkeypatch, boom)
    explain = {
        "instance": dump(INSTANCE),
        "routes": ROUTES,
        "method": "x",
        "model": MODEL,
    }
    with caplog.at_level(logging.DEBUG):
        for path, payload in (("/solve/llm", body()), ("/explain", explain)):
            r = client.post(path, json=payload, headers=HEADERS)
            assert r.status_code == 500 and r.json() == {"detail": "error interno"}
            assert KEY not in r.text
    assert KEY not in caplog.text
    assert "RuntimeError" in caplog.text


def test_explain_uses_server_evaluation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    reply = LLMResponse(text="Explicación de prueba", tokens_in=1000, tokens_out=500)
    seen = use_fake(monkeypatch, [reply])
    payload = {
        "instance": dump(INSTANCE),
        "routes": ROUTES,
        "method": "heuristic",
        "model": MODEL,
    }
    r = client.post("/explain", json=payload, headers=HEADERS)
    assert r.status_code == 200
    out = r.json()
    assert out["text"] == "Explicación de prueba"
    assert out["tokens_in"] == 1000 and out["api_cost_eur"] > 0
    assert set(out) == {
        "text",
        "model_returned",
        "tokens_in",
        "tokens_out",
        "api_cost_eur",
        "stop_reason",
    }
    prompt = seen[0][0]["content"]
    evaluation = evaluate(INSTANCE, Solution(routes=ROUTES))
    first = evaluation.stops[0][0]
    assert f"1,{first.customer},{first.arrival:.10g}" in prompt
    assert "heuristic" in prompt and "Spanish" in prompt


def test_explain_asks_for_the_language(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen = use_fake(monkeypatch, [LLMResponse(text="x"), LLMResponse(text="x")])
    base = {"instance": dump(INSTANCE), "routes": ROUTES, "method": "x", "model": MODEL}
    for extra in ({"lang": "en"}, {}):
        assert (
            client.post("/explain", json={**base, **extra}, headers=HEADERS).status_code
            == 200
        )
    assert "in English" in seen[0][0]["content"]
    assert "in Spanish" in seen[1][0]["content"]  # sin `lang`, español como hasta ahora
    bad = {**base, "lang": "fr"}
    assert client.post("/explain", json=bad, headers=HEADERS).status_code == 422


def test_fake_explanation_follows_the_language(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("VRPTW_LLM_PROVIDER", "fake")
    base = {"instance": dump(INSTANCE), "routes": ROUTES, "method": "x", "model": MODEL}
    es = client.post("/explain", json=base, headers=HEADERS).json()["text"]
    en = client.post("/explain", json={**base, "lang": "en"}, headers=HEADERS).json()[
        "text"
    ]
    assert es.startswith("Respuesta de prueba") and en.startswith("Test answer")


def test_explain_method_too_long_is_422(client: TestClient) -> None:
    payload = {
        "instance": dump(INSTANCE),
        "routes": ROUTES,
        "method": "m" * 41,
        "model": MODEL,
    }
    assert client.post("/explain", json=payload, headers=HEADERS).status_code == 422


@pytest.mark.parametrize("role", ["llm_direct", "llm_agent"])
def test_fake_mode_solves(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, role: str
) -> None:
    monkeypatch.setenv("VRPTW_LLM_PROVIDER", "fake")
    r = client.post("/solve/llm", json=body(role=role), headers=HEADERS)
    assert r.status_code == 200
    rec = r.json()
    assert rec["provider"] == "fake" and rec["parse_status"] == "ok"
    assert rec["evaluation"]["feasible"] is True
    assert client.post("/solve/llm", json=body(role=role)).status_code == 401


def test_fake_mode_explains(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("VRPTW_LLM_PROVIDER", "fake")
    payload = {
        "instance": dump(INSTANCE),
        "routes": ROUTES,
        "method": "heuristic",
        "model": MODEL,
    }
    r = client.post("/explain", json=payload, headers=HEADERS)
    assert r.status_code == 200 and "prueba" in r.json()["text"]
