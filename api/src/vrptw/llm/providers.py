"""Proveedores de LLM: Anthropic y uno falso, con un formato común.

Formato de `messages` (lista de diccionarios, en orden):

- `{"role": "system", "content": str}`: instrucciones; solo como primer mensaje.
- `{"role": "user", "content": str}`.
- `{"role": "assistant", "content": str, "tool_calls": [...], "raw": [...]}`: un
  turno del modelo, tal como lo da `LLMResponse.message()`. `tool_calls` es una
  lista de `{"id", "name", "arguments"}`. `raw` guarda los bloques originales de
  Anthropic, razonamiento incluido, porque la API exige recibirlos sin cambios
  mientras dura un turno con herramientas; si falta, el turno se rehace con
  `content` y `tool_calls`.
- `{"role": "tool", "tool_call_id": str, "content": str, "is_error": bool}`: el
  resultado de una herramienta (`is_error` es opcional). Los resultados seguidos
  se envían juntos, en un solo mensaje, como pide la API.

Formato de `tools`: lista de `{"name": str, "description": str, "parameters":
dict}`, con `parameters` un JSON Schema de tipo objeto. Lista vacía: sin
herramientas.

Las funciones de `PROVIDERS` se llaman por posición:
`(messages, tools, model, api_key, max_tokens) -> LLMResponse`.

La clave de API llega como argumento y no se guarda en nada que sobreviva a la
llamada: cada llamada crea su cliente y lo cierra. Los fallos del proveedor salen
como `ProviderError`, con un mensaje propio que no incluye la clave ni el texto
del error original, y sin encadenar la excepción original.
"""

import logging
from collections.abc import Callable, Sequence
from typing import Any, Final, NamedTuple, cast

import anthropic
from anthropic.types import MessageParam, TextBlock, ToolParam, ToolUseBlock

# En depuración, el SDK y su cliente HTTP registran cabeceras y cuerpos de las
# peticiones. Se silencian aunque ANTHROPIC_LOG pida otra cosa.
for _logger in ("anthropic", "httpx2", "httpcore2"):
    logging.getLogger(_logger).setLevel(logging.WARNING)

# Fija el destino: ANTHROPIC_BASE_URL no puede desviar la clave del visitante.
ANTHROPIC_URL = "https://api.anthropic.com"
TIMEOUT_S = 300.0
# Sin streaming, el SDK anthropic 2.8.0 (`_calculate_nonstreaming_timeout`) supone
# un ritmo de peor caso de 128 000 tokens de salida en 3600 s y exige streaming si
# con él una llamada pasa de 600 s, es decir, por encima de 21 333 tokens. Cada
# llamada espera lo que da ese ritmo para su `max_tokens` más un 10 % de margen
# (supuesto propio), nunca menos de `TIMEOUT_S` ni más de esos 600 s.
SDK_SECONDS_PER_TOKEN = 3600 / 128_000
SDK_STREAMING_ABOVE_S = 600.0
MAX_NONSTREAMING_TOKENS = int(SDK_STREAMING_ABOVE_S / SDK_SECONDS_PER_TOKEN)
TIMEOUT_MARGIN = 1.1
# Esfuerzo de razonamiento de todas las llamadas, el mismo en los tres modelos. Va
# en `output_config.effort` (https://platform.claude.com/docs/en/build-with-claude/
# effort; el SDK anthropic 2.8.0 lo acepta en `messages.create` como
# `output_config: OutputConfigParam`). `medium` es el valor por defecto de Opus 5.5
# y Haiku 5.5; Sonnet 5.5, sin fijarlo, usaría `high`.
EFFORT: Final = "medium"


class ToolCall(NamedTuple):
    id: str
    name: str
    arguments: dict[str, Any]


class LLMResponse(NamedTuple):
    """Respuesta normalizada. `stop_reason` usa los valores de Anthropic:
    `end_turn`, `tool_use`, `max_tokens`, `refusal`, etc.

    `tokens_in` es el total de tokens de entrada y `tokens_out` incluye los de
    razonamiento: ambos son los que se facturan.
    """

    text: str
    tool_calls: tuple[ToolCall, ...] = ()
    stop_reason: str = "end_turn"
    tokens_in: int = 0
    tokens_out: int = 0
    model: str = "fake"
    raw: list[dict[str, Any]] | None = None

    def message(self) -> dict[str, Any]:
        """El turno en el formato común, listo para añadirlo a `messages`."""
        return {
            "role": "assistant",
            "content": self.text,
            "tool_calls": [call._asdict() for call in self.tool_calls],
            "raw": self.raw,
        }


Provider = Callable[
    [list[dict[str, Any]], list[dict[str, Any]], str, str, int], LLMResponse
]


class ProviderError(Exception):
    """Fallo del proveedor. `kind`: `auth`, `rate_limit`, `timeout`, `network`,
    `bad_request`, `server`, `api` o `script` (guion del falso agotado)."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind


_STATUS: dict[int, tuple[str, str]] = {
    400: ("bad_request", "petición rechazada"),
    401: ("auth", "clave de API no válida"),
    403: ("auth", "la clave de API no tiene permiso"),
    404: ("bad_request", "modelo o recurso no encontrado"),
    413: ("bad_request", "petición demasiado grande"),
    429: ("rate_limit", "límite de uso o de gasto alcanzado"),
}


def _status_error(status: int) -> ProviderError:
    default = ("server", "error del servidor") if status >= 500 else ("api", "error")
    kind, text = _STATUS.get(status, default)
    return ProviderError(kind, f"anthropic: {text} (HTTP {status})")


def _to_anthropic(
    messages: Sequence[dict[str, Any]],
) -> tuple[str | None, list[dict[str, Any]]]:
    """Formato común a (system, messages) de la API de Anthropic."""
    system: str | None = None
    out: list[dict[str, Any]] = []
    for i, m in enumerate(messages):
        role = m["role"]
        if role == "system" and i == 0:
            system = m["content"]
        elif role == "user":
            out.append({"role": "user", "content": m["content"]})
        elif role == "assistant":
            blocks = [{"type": "text", "text": m["content"]}] if m["content"] else []
            blocks += [
                {
                    "type": "tool_use",
                    "id": c["id"],
                    "name": c["name"],
                    "input": c["arguments"],
                }
                for c in m.get("tool_calls", [])
            ]
            out.append({"role": "assistant", "content": m.get("raw") or blocks})
        elif role == "tool":
            block = {
                "type": "tool_result",
                "tool_use_id": m["tool_call_id"],
                "content": m["content"],
                "is_error": m.get("is_error", False),
            }
            if i > 0 and messages[i - 1]["role"] == "tool":
                out[-1]["content"].append(block)
            else:
                out.append({"role": "user", "content": [block]})
        else:
            raise ValueError(f"mensaje {i}: rol no admitido aquí: {role!r}")
    return system, out


def _from_anthropic(message: anthropic.types.Message) -> LLMResponse:
    usage = message.usage
    return LLMResponse(
        text="".join(b.text for b in message.content if isinstance(b, TextBlock)),
        tool_calls=tuple(
            ToolCall(b.id, b.name, dict(b.input))
            for b in message.content
            if isinstance(b, ToolUseBlock)
        ),
        stop_reason=message.stop_reason or "",
        tokens_in=usage.input_tokens
        + (usage.cache_creation_input_tokens or 0)
        + (usage.cache_read_input_tokens or 0),
        tokens_out=usage.output_tokens,
        model=message.model,
        raw=[b.to_dict(mode="json") for b in message.content],
    )


def timeout_for(max_tokens: int) -> float:
    """Segundos de espera de una llamada sin streaming de `max_tokens` tokens de
    salida (ver `TIMEOUT_MARGIN`). Por encima de `MAX_NONSTREAMING_TOKENS`, que el
    SDK solo admite con streaming, lanza `ValueError`."""
    if max_tokens > MAX_NONSTREAMING_TOKENS:
        raise ValueError(
            f"max_tokens {max_tokens} exige streaming: el máximo sin él es "
            f"{MAX_NONSTREAMING_TOKENS}"
        )
    expected = max_tokens * SDK_SECONDS_PER_TOKEN * TIMEOUT_MARGIN
    return min(max(TIMEOUT_S, expected), SDK_STREAMING_ABOVE_S)


def call_anthropic(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    model: str,
    api_key: str,
    max_tokens: int,
) -> LLMResponse:
    """Una llamada a la API de mensajes de Anthropic, sin streaming.

    Tiempo de espera de `timeout_for(max_tokens)` segundos (al menos `TIMEOUT_S`;
    `ValueError`, sin llamar, si `max_tokens` exige streaming) y sin reintentos
    (`max_retries=0`): un 429 o un corte de red llegan a quien llama como
    `ProviderError`, y es quien llama el que decide si repite. El esfuerzo es
    siempre `EFFORT`; `thinking` no se fija y cada modelo usa su valor por defecto.
    """
    if not api_key:
        raise ProviderError("auth", "anthropic: falta la clave de API")
    timeout = timeout_for(max_tokens)
    system, api_messages = _to_anthropic(messages)
    api_tools = [
        {
            "name": t["name"],
            "description": t["description"],
            "input_schema": t["parameters"],
        }
        for t in tools
    ]
    try:
        with anthropic.Anthropic(
            api_key=api_key,
            base_url=ANTHROPIC_URL,
            timeout=timeout,
            max_retries=0,
        ) as client:
            return _from_anthropic(
                client.messages.create(
                    model=model,
                    max_tokens=max_tokens,
                    messages=cast(list[MessageParam], api_messages),
                    system=anthropic.omit if system is None else system,
                    tools=cast(list[ToolParam], api_tools)
                    if api_tools
                    else anthropic.omit,
                    output_config={"effort": EFFORT},
                )
            )
    except anthropic.APITimeoutError:
        error = ProviderError("timeout", f"anthropic: sin respuesta en {timeout:g} s")
    except anthropic.APIConnectionError:
        error = ProviderError("network", "anthropic: error de red")
    except anthropic.APIStatusError as exc:
        error = _status_error(exc.status_code)
    except anthropic.AnthropicError:
        error = ProviderError("api", "anthropic: respuesta no válida")
    except Exception:  # noqa: BLE001 (ver el comentario)
        # Una respuesta 200 que el SDK no sabe leer (cuerpo que no es JSON o con
        # otra forma) pudo cobrarse: como `api`, quien llama la apunta con su
        # peor caso. Sin el mensaje original, que podría citar la petición.
        error = ProviderError("api", "anthropic: respuesta ilegible")
    # Fuera del `except`: así no arrastra la excepción original en `__context__`.
    raise error


Script = (
    Sequence[LLMResponse]
    | Callable[[list[dict[str, Any]], list[dict[str, Any]]], LLMResponse]
)


def make_fake(script: Script) -> Provider:
    """Proveedor falso: sin red, sin clave y determinista.

    `script` es una lista de respuestas, que se devuelven en orden (agotada, da
    `ProviderError` de tipo `script`), o una función `(messages, tools) ->
    LLMResponse` que decide según la conversación. `model`, `api_key` y
    `max_tokens` se ignoran. Con una lista, cada proveedor creado tiene su propia
    copia del guion.
    """
    if callable(script):
        decide = script
        return lambda messages, tools, model, api_key, max_tokens: decide(
            messages, tools
        )
    pending = list(script)

    def call_fake(
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        model: str,
        api_key: str,
        max_tokens: int,
    ) -> LLMResponse:
        if not pending:
            raise ProviderError("script", "fake: no quedan respuestas en el guion")
        return pending.pop(0)

    return call_fake


def _echo(messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> LLMResponse:
    """Repite el contenido del último mensaje."""
    return LLMResponse(text=str(messages[-1]["content"]) if messages else "")


PROVIDERS: dict[str, Provider] = {
    "anthropic": call_anthropic,
    "fake": make_fake(_echo),
}
