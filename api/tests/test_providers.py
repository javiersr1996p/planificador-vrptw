"""Capa de proveedores sin red: el transporte HTTP del SDK se sustituye por un
`MockTransport` que devuelve respuestas con la forma documentada de la API."""

import json
import logging
from collections.abc import Callable
from typing import Any

import anthropic
import httpx2
import pytest

from vrptw.llm import providers
from vrptw.llm.providers import (
    PROVIDERS,
    LLMResponse,
    ProviderError,
    ToolCall,
    call_anthropic,
    make_fake,
)

KEY = "sk-ant-centinela-01"
MODEL = "claude-sonnet-5-5"
TOOLS = [
    {
        "name": "solve_classic",
        "description": "Resuelve la instancia con un método clásico.",
        "parameters": {
            "type": "object",
            "properties": {"method": {"type": "string"}},
            "required": ["method"],
        },
    }
]
Handler = Callable[[httpx2.Request], httpx2.Response]


class Network:
    """Peticiones recibidas y clientes creados durante la prueba."""

    def __init__(self) -> None:
        self.requests: list[httpx2.Request] = []
        self.clients: list[anthropic.Anthropic] = []

    def bodies(self) -> list[dict[str, Any]]:
        return [json.loads(r.content) for r in self.requests]


def use_network(monkeypatch: pytest.MonkeyPatch, handler: Handler) -> Network:
    net = Network()
    real = anthropic.Anthropic

    def record(request: httpx2.Request) -> httpx2.Response:
        net.requests.append(request)
        return handler(request)

    def client(**kwargs: Any) -> anthropic.Anthropic:
        transport = httpx2.MockTransport(record)
        c = real(
            http_client=anthropic.DefaultHttpxClient(transport=transport), **kwargs
        )
        net.clients.append(c)
        return c

    monkeypatch.setattr(anthropic, "Anthropic", client)
    return net


def api_message(content: list[dict[str, Any]], stop_reason: str) -> dict[str, Any]:
    return {
        "id": "msg_01",
        "type": "message",
        "role": "assistant",
        "model": MODEL,
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 1200, "output_tokens": 345},
    }


def reply(body: dict[str, Any]) -> Handler:
    return lambda request: httpx2.Response(200, json=body)


THINKING = {"type": "thinking", "thinking": "", "signature": "firma-opaca-123"}
TOOL_USE = {
    "type": "tool_use",
    "id": "toolu_01",
    "name": "solve_classic",
    "input": {"method": "heuristic"},
}


def test_text_response_is_normalized(monkeypatch: pytest.MonkeyPatch) -> None:
    text = '{"routes": [[1, 2], [3]]}'
    net = use_network(
        monkeypatch,
        reply(api_message([THINKING, {"type": "text", "text": text}], "end_turn")),
    )
    messages = [
        {"role": "system", "content": "Eres un planificador."},
        {"role": "user", "content": "Resuelve la instancia."},
    ]
    resp = call_anthropic(messages, [], MODEL, KEY, 2000)

    assert resp.text == text
    assert resp.tool_calls == ()
    assert (resp.stop_reason, resp.tokens_in, resp.tokens_out) == (
        "end_turn",
        1200,
        345,
    )
    assert resp.model == MODEL
    [request] = net.requests
    assert request.url.host == "api.anthropic.com"
    body = net.bodies()[0]
    assert body["model"] == MODEL and body["max_tokens"] == 2000
    assert body["system"] == "Eres un planificador."
    assert body["messages"] == [{"role": "user", "content": "Resuelve la instancia."}]
    assert "tools" not in body
    assert all(c.is_closed for c in net.clients)


def test_tool_call_round_trip_keeps_thinking(monkeypatch: pytest.MonkeyPatch) -> None:
    second = api_message([{"type": "text", "text": "Hecho."}], "end_turn")
    responses = iter([api_message([THINKING, TOOL_USE], "tool_use"), second])
    net = use_network(
        monkeypatch, lambda request: httpx2.Response(200, json=next(responses))
    )

    messages: list[dict[str, Any]] = [{"role": "user", "content": "Resuelve."}]
    resp = call_anthropic(messages, TOOLS, MODEL, KEY, 2000)
    assert resp.tool_calls == (
        ToolCall("toolu_01", "solve_classic", {"method": "heuristic"}),
    )
    assert resp.stop_reason == "tool_use" and resp.text == ""

    messages += [
        resp.message(),
        {"role": "tool", "tool_call_id": "toolu_01", "content": '{"score": 1}'},
    ]
    assert call_anthropic(messages, TOOLS, MODEL, KEY, 2000).text == "Hecho."

    first, again = net.bodies()
    assert first["tools"] == [
        {
            "name": "solve_classic",
            "description": "Resuelve la instancia con un método clásico.",
            "input_schema": TOOLS[0]["parameters"],
        }
    ]
    assert again["messages"][1] == {
        "role": "assistant",
        "content": [THINKING, TOOL_USE],
    }
    assert again["messages"][2] == {
        "role": "user",
        "content": [
            {
                "type": "tool_result",
                "tool_use_id": "toolu_01",
                "content": '{"score": 1}',
                "is_error": False,
            }
        ],
    }


def test_consecutive_tool_results_go_in_one_message() -> None:
    call = {"id": "a", "name": "solve_classic", "arguments": {}}
    messages = [
        {"role": "user", "content": "x"},
        {"role": "assistant", "content": "", "tool_calls": [call, {**call, "id": "b"}]},
        {"role": "tool", "tool_call_id": "a", "content": "1"},
        {"role": "tool", "tool_call_id": "b", "content": "2", "is_error": True},
    ]
    system, out = providers._to_anthropic(messages)
    assert system is None
    assert [m["role"] for m in out] == ["user", "assistant", "user"]
    assert [b["tool_use_id"] for b in out[2]["content"]] == ["a", "b"]
    assert out[1]["content"][0] == {
        "type": "tool_use",
        "id": "a",
        "name": "solve_classic",
        "input": {},
    }


def chain(exc: BaseException) -> list[BaseException]:
    seen: list[BaseException] = []
    todo: list[BaseException | None] = [exc]
    while todo:
        e = todo.pop()
        if e is not None and e not in seen:
            seen.append(e)
            todo += [e.__cause__, e.__context__]
    return seen


def assert_no_key(exc: ProviderError, caplog: pytest.LogCaptureFixture) -> None:
    for e in chain(exc):
        assert KEY not in str(e) and KEY not in repr(e)
        assert KEY not in repr(vars(e))
    assert exc.__cause__ is None and exc.__context__ is None
    assert KEY not in caplog.text
    sdk = ("anthropic", "httpx2", "httpcore2")
    assert not [
        r
        for r in caplog.records
        if r.name.startswith(sdk) and r.levelno < logging.WARNING
    ]


def leaky_error(status: int) -> Handler:
    """Error HTTP cuyo cuerpo y cabeceras repiten la clave."""
    body = {
        "type": "error",
        "error": {
            "type": "authentication_error",
            "message": f"invalid x-api-key: {KEY}",
        },
    }
    return lambda request: httpx2.Response(status, json=body, headers={"x-echo": KEY})


@pytest.mark.parametrize(
    ("status", "kind"),
    [
        (401, "auth"),
        (403, "auth"),
        (400, "bad_request"),
        (429, "rate_limit"),
        (529, "server"),
    ],
)
def test_http_error_hides_key(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    status: int,
    kind: str,
) -> None:
    caplog.set_level(logging.DEBUG)
    net = use_network(monkeypatch, leaky_error(status))
    with pytest.raises(ProviderError) as info:
        call_anthropic([{"role": "user", "content": "hola"}], [], MODEL, KEY, 100)
    assert info.value.kind == kind
    assert f"HTTP {status}" in str(info.value)
    assert_no_key(info.value, caplog)
    assert len(net.requests) == 1  # sin reintentos
    assert all(c.is_closed for c in net.clients)


def test_sdk_debug_log_would_leak_the_key(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Control: con el registro del SDK en DEBUG la clave sí aparece, así que la
    prueba anterior detectaría una fuga."""
    caplog.set_level(logging.DEBUG, logger="anthropic")
    use_network(monkeypatch, leaky_error(401))
    with pytest.raises(ProviderError):
        call_anthropic([{"role": "user", "content": "hola"}], [], MODEL, KEY, 100)
    assert KEY in caplog.text


def raise_(error: Exception) -> Handler:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise error

    return handler


@pytest.mark.parametrize(
    ("error", "kind"),
    [
        (httpx2.ReadTimeout(f"timed out ({KEY})"), "timeout"),
        (httpx2.ConnectError(f"connection refused ({KEY})"), "network"),
    ],
)
def test_transport_error_is_readable_and_hides_key(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    error: Exception,
    kind: str,
) -> None:
    caplog.set_level(logging.DEBUG)
    net = use_network(monkeypatch, raise_(error))
    with pytest.raises(ProviderError) as info:
        call_anthropic([{"role": "user", "content": "hola"}], [], MODEL, KEY, 100)
    assert info.value.kind == kind
    assert str(info.value).startswith("anthropic: ")
    assert_no_key(info.value, caplog)
    assert len(net.requests) == 1


def test_timeout_message_names_the_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    use_network(monkeypatch, raise_(httpx2.ReadTimeout("timed out")))
    with pytest.raises(ProviderError, match=r"sin respuesta en 300 s"):
        call_anthropic([{"role": "user", "content": "hola"}], [], MODEL, KEY, 100)


def test_empty_key_is_rejected_without_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-del-servidor")
    net = use_network(monkeypatch, reply(api_message([], "end_turn")))
    with pytest.raises(ProviderError) as info:
        call_anthropic([{"role": "user", "content": "hola"}], [], MODEL, "", 100)
    assert info.value.kind == "auth"
    assert net.requests == [] and net.clients == []


def test_key_does_not_outlive_the_call(monkeypatch: pytest.MonkeyPatch) -> None:
    net = use_network(
        monkeypatch, reply(api_message([{"type": "text", "text": "ok"}], "end_turn"))
    )
    resp = call_anthropic([{"role": "user", "content": "hola"}], [], MODEL, KEY, 100)
    assert KEY not in repr(resp)
    assert KEY not in repr(vars(providers))
    assert all(c.is_closed for c in net.clients)


SCRIPT = [
    LLMResponse(text='{"routes": [[1, 2]]}', tokens_in=10, tokens_out=5),
    LLMResponse(
        text="",
        tool_calls=(ToolCall("t1", "evaluate_routes", {"routes": [[1, 2]]}),),
        stop_reason="tool_use",
    ),
    LLMResponse(text="no sé resolverlo"),
]


def test_fake_returns_script_in_order_then_fails() -> None:
    script = list(SCRIPT)
    fake = make_fake(script)
    got = [fake([{"role": "user", "content": "x"}], [], "m", "", 100) for _ in SCRIPT]
    assert got == SCRIPT
    with pytest.raises(ProviderError) as info:
        fake([], [], "m", "", 100)
    assert info.value.kind == "script"
    assert script == SCRIPT  # el guion del que llama no se toca


def test_fake_is_deterministic() -> None:
    runs = []
    for _ in range(2):
        fake = make_fake(SCRIPT)
        runs.append([fake([], TOOLS, "m", "", 100) for _ in SCRIPT])
    assert runs[0] == runs[1] == SCRIPT


def test_fake_function_decides_from_messages() -> None:
    def decide(
        messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> LLMResponse:
        if messages[-1]["role"] == "tool":
            return LLMResponse(text="listo")
        call = ToolCall("t1", tools[0]["name"], {"method": "heuristic"})
        return LLMResponse(text="", tool_calls=(call,), stop_reason="tool_use")

    fake = make_fake(decide)
    messages: list[dict[str, Any]] = [{"role": "user", "content": "x"}]
    first = fake(messages, TOOLS, "m", "", 100)
    assert first.tool_calls[0].name == "solve_classic"
    messages += [
        first.message(),
        {"role": "tool", "tool_call_id": "t1", "content": "{}"},
    ]
    assert fake(messages, TOOLS, "m", "", 100).text == "listo"


def test_registry() -> None:
    assert set(PROVIDERS) == {"anthropic", "fake"}
    echo = PROVIDERS["fake"]([{"role": "user", "content": "eco"}], [], "m", "", 100)
    assert echo == LLMResponse(text="eco")
