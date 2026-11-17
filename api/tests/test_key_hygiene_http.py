"""La clave de API del visitante no sale del servicio HTTP, con uvicorn real.

`test_key_hygiene.py` prueba la capa LLM sin HTTP. Aquí se arranca uvicorn en un
hilo, con su configuración de logs por defecto en nivel `trace`, y se llama con
`httpx` a `/solve/llm` (los dos papeles) y a `/explain` con la cabecera
`X-LLM-Key`. Se reutilizan de aquel módulo la red simulada del SDK, la fixture
`hygiene` y la búsqueda en ficheros, con su centinela sustituida por la de este.

En todos los escenarios la centinela no aparece en el cuerpo ni en las cabeceras
de la respuesta, ni en `caplog`, ni en `capfd` (logs de acceso y de error de
uvicorn incluidos), ni en ningún fichero de `tmp_path` o de `api/runs/`; la
petición saliente, si la hay, la lleva solo en la cabecera de autenticación.

Comprobado que la prueba muerde: con `/solve/llm` devolviendo `work()` en lugar
de `_guarded(work)`, `test_unhandled_exception_hides_key` falla en `direct` y en
`agent` (uvicorn escribe en la salida de error la traza con la clave); con el
registro del error dentro del `except` de `_guarded`, falla en los tres; sin el
silenciado de los loggers del SDK en `providers.py`, fallan
`test_success_hides_key` (el SDK registra en DEBUG las cabeceras de respuesta) y
`test_anthropic_log_debug_keeps_sdk_quiet`.
"""

import io
import logging
import os
import subprocess
import sys
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import httpx
import pytest
import test_key_hygiene as hyg
import uvicorn
from test_key_hygiene import hygiene  # noqa: F401 (fixture)

from vrptw.api import main
from vrptw.llm.providers import PROVIDERS

KEY = "sk-ant-centinela-06"
# Uno de los de `GET /models`: si no, las rutas responderían 422.
MODEL = hyg.MODEL
INSTANCE = hyg.INSTANCE.model_dump(mode="json", by_alias=True)
BODIES: dict[str, dict[str, Any]] = {
    "direct": {"instance": INSTANCE, "model": MODEL, "role": "llm_direct"},
    "agent": {"instance": INSTANCE, "model": MODEL, "role": "llm_agent"},
    "explain": {
        "instance": INSTANCE,
        "routes": hyg.ROUTES,
        "method": "heuristic",
        "model": MODEL,
    },
}
PATHS = {"direct": "/solve/llm", "agent": "/solve/llm", "explain": "/explain"}
ENDPOINTS = list(BODIES)


@pytest.fixture
def env(hygiene: Path, monkeypatch: pytest.MonkeyPatch) -> Path:  # noqa: F811
    """`hygiene`, con la centinela de este módulo y el SDK en modo depuración."""
    monkeypatch.setattr(hyg, "KEY", KEY)
    monkeypatch.setenv("ANTHROPIC_LOG", "debug")
    monkeypatch.delenv("VRPTW_LLM_PROVIDER", raising=False)
    return hygiene


@contextmanager
def serving() -> Iterator[str]:
    """uvicorn real en un hilo.

    pytest cierra y recrea los flujos de `capfd` en cada fase de la prueba: la
    configuración de uvicorn, que fija sus manejadores a `sys.stdout` y
    `sys.stderr`, se crea aquí, en la fase de llamada, y el manejador de
    `hygiene`, creado en la de preparación, se apunta a la salida de error actual.
    """
    root = logging.getLogger().handlers
    [handler] = [h for h in root if type(h) is logging.StreamHandler]
    handler.stream = sys.stderr
    config = uvicorn.Config(main.app, host="127.0.0.1", port=0, log_level="trace")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 30
        while not server.started:
            assert thread.is_alive() and time.monotonic() < deadline, "no arrancó"
            time.sleep(0.01)
        port = server.servers[0].sockets[0].getsockname()[1]
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=30)
    assert not thread.is_alive(), "uvicorn no se detuvo"


def post(endpoint: str, body: dict[str, Any] | None = None) -> httpx.Response:
    with serving() as url:
        return httpx.post(
            url + PATHS[endpoint],
            json=BODIES[endpoint] if body is None else body,
            headers={"X-LLM-Key": KEY},
            timeout=60,
        )


def replies(endpoint: str) -> list[dict[str, Any]]:
    if endpoint == "explain":
        text = {"type": "text", "text": "Explicación de prueba."}
        return [hyg.api_message([text], "end_turn")]
    return hyg.success_bodies(hyg.direct if endpoint == "direct" else hyg.agent)


def assert_clean(
    response: httpx.Response,
    endpoint: str,
    net: hyg.Network,
    sent: int,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
    tmp_path: Path,
) -> None:
    """Respuesta, salida, registros, ficheros y petición saliente sin la clave."""
    assert KEY not in response.text
    assert all(KEY not in f"{k}{v}" for k, v in response.headers.multi_items())

    assert len(net.requests) == sent
    if sent:
        hyg.assert_request_carries_key(net)
    for request in net.requests:
        assert KEY not in str(request.url)
        assert KEY.encode() not in request.content
        auth = {"authorization", "x-api-key"}
        assert all(KEY not in v for k, v in request.headers.items() if k not in auth)

    out, err = capfd.readouterr()
    # Sin los logs de uvicorn, la búsqueda en `out` y `err` no probaría nada.
    request_line = f'"POST {PATHS[endpoint]} HTTP/1.1" {response.status_code}'
    assert request_line in out and "Application startup complete" in err
    assert KEY not in out and KEY not in err
    assert KEY not in caplog.text
    assert all(KEY not in r.getMessage() for r in caplog.records)
    hyg.assert_no_files_leak(tmp_path)


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_success_hides_key(
    endpoint: str,
    monkeypatch: pytest.MonkeyPatch,
    env: Path,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    """(a) Éxito con el SDK real; las cabeceras de respuesta repiten la clave."""
    bodies = replies(endpoint)
    net = hyg.use_network(monkeypatch, hyg.ok(*bodies))
    response = post(endpoint)

    assert response.status_code == 200
    if endpoint == "explain":
        assert response.json()["text"] == "Explicación de prueba."
    else:
        assert response.json()["parse_status"] == "ok"
    assert_clean(response, endpoint, net, len(bodies), caplog, capfd, env)


@pytest.mark.parametrize("endpoint", ENDPOINTS)
@pytest.mark.parametrize(("status", "sent"), [(401, 401), (500, 502)], ids=str)
def test_http_error_hides_key(
    endpoint: str,
    status: int,
    sent: int,
    monkeypatch: pytest.MonkeyPatch,
    env: Path,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    """(b) Error HTTP del proveedor cuyo cuerpo repite la clave."""
    net = hyg.use_network(monkeypatch, hyg.leaky_error(status))
    response = post(endpoint)

    assert response.status_code == sent
    assert f"HTTP {status}" in response.json()["detail"]
    assert_clean(response, endpoint, net, 1, caplog, capfd, env)


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_timeout_hides_key(
    endpoint: str,
    monkeypatch: pytest.MonkeyPatch,
    env: Path,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    """(c) Tiempo agotado con la clave en el mensaje: los papeles lo registran
    como `timeout`; `/explain` responde 502."""
    net = hyg.use_network(monkeypatch, hyg.timeout())
    response = post(endpoint)

    if endpoint == "explain":
        assert response.status_code == 502
    else:
        assert response.status_code == 200
        assert response.json()["parse_status"] == "timeout"
    assert_clean(response, endpoint, net, 1, caplog, capfd, env)


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_unhandled_exception_hides_key(
    endpoint: str,
    monkeypatch: pytest.MonkeyPatch,
    env: Path,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    """(d) El proveedor lanza una excepción no controlada que cita la clave.

    El logger del servicio lleva además un manejador roto: cuando uno falla,
    `logging` imprime en la salida de error la excepción que se esté atendiendo.
    """

    def boom(*args: Any) -> Any:
        raise RuntimeError(f"fallo del proveedor con {KEY}")

    net = hyg.use_network(monkeypatch, hyg.leaky_error(500))
    monkeypatch.setitem(PROVIDERS, "anthropic", boom)
    closed = io.StringIO()
    closed.close()
    monkeypatch.setattr(main.logger, "handlers", [logging.StreamHandler(closed)])
    response = post(endpoint)

    assert response.status_code == 500
    assert response.json() == {"detail": "error interno"}
    assert "RuntimeError" in caplog.text
    assert_clean(response, endpoint, net, 0, caplog, capfd, env)


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_invalid_body_hides_key(
    endpoint: str,
    monkeypatch: pytest.MonkeyPatch,
    env: Path,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    """(e) Cuerpo inválido con la cabecera; la clave va además en un campo que
    sobra, que el 422 de FastAPI por defecto devolvería en `input`."""
    net = hyg.use_network(monkeypatch, hyg.leaky_error(500))
    response = post(endpoint, {**BODIES[endpoint], "api_key": KEY})

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == "api_key"
    assert_clean(response, endpoint, net, 0, caplog, capfd, env)


def test_anthropic_log_debug_keeps_sdk_quiet(tmp_path: Path) -> None:
    """`ANTHROPIC_LOG` solo se lee al importar el SDK, así que fijarlo en las
    pruebas anteriores no basta: en un intérprete nuevo que arranca con
    `ANTHROPIC_LOG=debug`, los loggers del SDK quedan en WARNING al importar el
    servicio."""
    code = (
        "import logging, vrptw.api.main\n"
        "for name in ('anthropic', 'httpx2', 'httpcore2'):\n"
        "    print(logging.getLogger(name).getEffectiveLevel())"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        env={**os.environ, "ANTHROPIC_LOG": "debug"},
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=True,
    )
    assert result.stdout.split() == ["30", "30", "30"]
