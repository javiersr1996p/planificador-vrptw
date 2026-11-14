"""La clave de API del visitante no queda en ningún sitio, con el SDK real.

Las pruebas de `test_direct.py` y `test_agent.py` usan el proveedor `fake`, donde
la clave nunca llega a un SDK. Aquí se ejercita el camino real: `solve_direct` y
`solve_agent` con `PROVIDERS["anthropic"]`, con el transporte HTTP del SDK
sustituido por un `MockTransport` (mismo mecanismo que `test_providers.py`). El
logging raíz va en DEBUG y se añade un manejador a la salida de error, para que
cualquier registro que contenga la clave acabe en `caplog` y en `capfd`.
"""

import json
import logging
import sys
import traceback
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import anthropic
import httpx2
import pytest

from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.llm.agent import solve_agent
from vrptw.llm.direct import solve_direct
from vrptw.llm.providers import PROVIDERS, ProviderError
from vrptw.model import RunRecord
from vrptw.solvers.heuristic import solve

KEY = "sk-ant-centinela-05"
MODEL = "claude-sonnet-5-5"
INSTANCE = load_tfe2024("10c-1")
ROUTES = solve(INSTANCE).routes
API_RUNS = Path(__file__).resolve().parents[1] / "runs"

Handler = Callable[[httpx2.Request], httpx2.Response]
Role = Callable[[], RunRecord]


class Network:
    def __init__(self) -> None:
        self.requests: list[httpx2.Request] = []


def use_network(monkeypatch: pytest.MonkeyPatch, handler: Handler) -> Network:
    """Sustituye el transporte del SDK; `call_anthropic` sigue siendo el real."""
    net = Network()
    real = anthropic.Anthropic

    def record(request: httpx2.Request) -> httpx2.Response:
        net.requests.append(request)
        return handler(request)

    def client(**kwargs: Any) -> anthropic.Anthropic:
        transport = httpx2.MockTransport(record)
        return real(
            http_client=anthropic.DefaultHttpxClient(transport=transport), **kwargs
        )

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


def ok(*bodies: dict[str, Any]) -> Handler:
    """Respuestas 200 en orden; las cabeceras de respuesta también repiten la clave."""
    pending: Iterator[dict[str, Any]] = iter(bodies)
    return lambda request: httpx2.Response(
        200, json=next(pending), headers={"x-echo": KEY}
    )


def leaky_error(status: int) -> Handler:
    """Error HTTP cuyo cuerpo y cabeceras repiten la clave."""
    body = {
        "type": "error",
        "error": {"type": "api_error", "message": f"invalid x-api-key: {KEY}"},
    }
    return lambda request: httpx2.Response(status, json=body, headers={"x-echo": KEY})


def timeout() -> Handler:
    def handler(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ReadTimeout(f"timed out ({KEY})")

    return handler


def direct() -> RunRecord:
    return solve_direct(INSTANCE, "anthropic", MODEL, KEY, 4000)


def agent() -> RunRecord:
    return solve_agent(INSTANCE, "anthropic", MODEL, KEY, 4000)


ROLES: list[Any] = [
    pytest.param(direct, id="direct"),
    pytest.param(agent, id="agent"),
]


def success_bodies(role: Role) -> list[dict[str, Any]]:
    final = {"type": "text", "text": json.dumps({"routes": ROUTES, "score": 1.0})}
    if role is direct:
        return [api_message([final], "end_turn")]
    tool_use = {
        "type": "tool_use",
        "id": "toolu_01",
        "name": "evaluate_routes",
        "input": {"routes": ROUTES},
    }
    return [api_message([tool_use], "tool_use"), api_message([final], "end_turn")]


@pytest.fixture
def hygiene(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> Iterator[Path]:
    """Logging raíz en DEBUG hacia caplog y stderr, y directorio de trabajo nuevo."""
    monkeypatch.chdir(tmp_path)
    caplog.set_level(logging.DEBUG)
    root = logging.getLogger()
    monkeypatch.setattr(root, "level", logging.DEBUG)
    handler = logging.StreamHandler(sys.stderr)
    handler.setLevel(logging.DEBUG)
    root.addHandler(handler)
    try:
        yield tmp_path
    finally:
        root.removeHandler(handler)


def written_files(*roots: Path) -> list[Path]:
    return [
        p
        for root in roots
        if root.exists()
        for p in root.rglob("*")
        if p.is_file() and "__pycache__" not in p.parts
    ]


def assert_no_files_leak(tmp_path: Path) -> None:
    for path in written_files(tmp_path, Path.cwd(), API_RUNS):
        assert KEY.encode() not in path.read_bytes(), path
        assert KEY not in path.name, path


def assert_no_output_leak(
    caplog: pytest.LogCaptureFixture, capfd: pytest.CaptureFixture[str]
) -> None:
    assert KEY not in caplog.text
    assert all(KEY not in r.getMessage() for r in caplog.records)
    out, err = capfd.readouterr()
    assert KEY not in out and KEY not in err


def assert_request_carries_key(net: Network) -> None:
    """Sin esto las demás comprobaciones estarían vacías: la clave sí viaja."""
    assert net.requests, "no hubo ninguna petición simulada"
    for request in net.requests:
        assert request.url.host == "api.anthropic.com"
        # El SDK 2.8 la envía como `Authorization: Bearer`; versiones anteriores,
        # en `x-api-key`.
        sent = {request.headers.get("x-api-key"), request.headers.get("authorization")}
        assert KEY in sent or f"Bearer {KEY}" in sent


@pytest.mark.parametrize("role", ROLES)
def test_success_leaves_no_trace(
    role: Role,
    monkeypatch: pytest.MonkeyPatch,
    hygiene: Path,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    net = use_network(monkeypatch, ok(*success_bodies(role)))
    record = role()

    assert record.parse_status == "ok" and record.provider == "anthropic"
    assert len(net.requests) == (1 if role is direct else 2)
    assert_request_carries_key(net)
    assert KEY not in record.model_dump_json()
    assert_no_output_leak(caplog, capfd)
    assert_no_files_leak(hygiene)


def chain(exc: BaseException) -> list[BaseException]:
    seen: list[BaseException] = []
    todo: list[BaseException | None] = [exc]
    while todo:
        e = todo.pop()
        if e is not None and e not in seen:
            seen.append(e)
            todo += [e.__cause__, e.__context__]
    return seen


def assert_exception_clean(exc: BaseException) -> None:
    for e in chain(exc):
        assert KEY not in str(e) and KEY not in repr(e)
        assert KEY not in repr(vars(e)) and KEY not in repr(e.args)
    assert KEY not in "".join(traceback.format_exception(exc))
    assert KEY not in "".join(traceback.format_exception(type(exc), exc, None))


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize(
    ("status", "kind"), [(401, "auth"), (500, "server")], ids=["401", "500"]
)
def test_http_error_hides_key(
    role: Role,
    status: int,
    kind: str,
    monkeypatch: pytest.MonkeyPatch,
    hygiene: Path,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    net = use_network(monkeypatch, leaky_error(status))
    with pytest.raises(ProviderError) as info:
        role()

    assert info.value.kind == kind and f"HTTP {status}" in str(info.value)
    assert len(net.requests) == 1  # sin reintentos
    assert_request_carries_key(net)
    assert_exception_clean(info.value)
    assert info.value.__cause__ is None and info.value.__context__ is None
    assert_no_output_leak(caplog, capfd)
    assert_no_files_leak(hygiene)


@pytest.mark.parametrize("role", ROLES)
def test_timeout_hides_key(
    role: Role,
    monkeypatch: pytest.MonkeyPatch,
    hygiene: Path,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    """Los dos papeles convierten el tiempo agotado en un registro `timeout`; la
    excepción del proveedor se comprueba aparte, llamando a la función real."""
    net = use_network(monkeypatch, timeout())
    record = role()
    assert record.parse_status == "timeout"
    assert KEY not in record.model_dump_json()

    with pytest.raises(ProviderError) as info:
        PROVIDERS["anthropic"]([{"role": "user", "content": "hola"}], [], MODEL, KEY, 9)
    assert info.value.kind == "timeout"
    assert_exception_clean(info.value)
    assert info.value.__cause__ is None and info.value.__context__ is None

    assert_request_carries_key(net)
    assert_no_output_leak(caplog, capfd)
    assert_no_files_leak(hygiene)


def test_control_detects_a_leak(
    monkeypatch: pytest.MonkeyPatch,
    hygiene: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Control: con el logger del SDK en DEBUG la clave sí llega a `caplog`, así que
    las pruebas anteriores detectarían una fuga por esa vía."""
    caplog.set_level(logging.DEBUG, logger="anthropic")
    use_network(monkeypatch, leaky_error(401))
    with pytest.raises(ProviderError):
        direct()
    assert KEY in caplog.text
