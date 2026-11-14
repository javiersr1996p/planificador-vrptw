"""El LLM como resolvedor directo: recibe la instancia y responde con las rutas.

La conversación es nueva en cada ejecución, sin memoria (TFE p. 79). Las rutas
las evalúa siempre `evaluate`: el coste, las violaciones y los identificadores
inventados o duplicados los calcula el evaluador. El `score` que declara el
modelo solo se guarda en `self_reported_score`. Una respuesta sin JSON válido se
registra como `unparseable` y no se reintenta (TFE p. 72).

`extract_routes` y `build_llm_record` los reutiliza el agente (tarea 3.4).
"""

import json
import platform
import time
import uuid
from datetime import UTC, datetime
from typing import Any, Literal, NamedTuple

from vrptw.cli import _git_sha
from vrptw.evaluate import evaluate
from vrptw.llm.pricing import call_cost
from vrptw.llm.prompts import PROMPT_VERSION, recheck_prompt, solve_prompt
from vrptw.llm.providers import PROVIDERS, LLMResponse, ProviderError
from vrptw.model import Instance, RunRecord, Solution

ParseStatus = Literal["ok", "unparseable", "timeout", "refused"]


class Parsed(NamedTuple):
    routes: list[list[int]] | None  # None: no hay bloque o no tiene la forma pedida
    score: float | None  # el `score` declarado por el modelo, si es un número


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def is_routes(value: Any) -> bool:
    """True si `value` es una lista de listas de enteros (sin booleanos)."""
    return isinstance(value, list) and all(
        isinstance(r, list) and all(_is_int(c) for c in r) for r in value
    )


def extract_routes(text: str) -> Parsed:
    """Interpreta el ÚLTIMO objeto JSON con `routes` del texto.

    Vale suelto o dentro de un bloque de código Markdown, con texto antes o
    después. Si el último bloque con `routes` no es una lista de listas de
    enteros, `routes` es None (no se recurre a un bloque anterior).
    """
    decoder = json.JSONDecoder()
    found: dict[str, Any] | None = None
    pos = text.find("{")
    while pos != -1:
        try:
            value, end = decoder.raw_decode(text, pos)
        except ValueError:
            pos = text.find("{", pos + 1)
            continue
        if isinstance(value, dict) and "routes" in value:
            found = value
        pos = text.find("{", end)
    if found is None:
        return Parsed(None, None)

    score = found.get("score")
    reported = (
        float(score)
        if isinstance(score, int | float) and not isinstance(score, bool)
        else None
    )
    routes = found["routes"]
    if is_routes(routes):
        return Parsed(routes, reported)
    return Parsed(None, reported)


def build_llm_record(
    instance: Instance,
    *,
    role: Literal["llm_direct", "llm_agent"],
    provider: str,
    model: str,
    messages: list[dict[str, Any]],
    responses: list[LLMResponse],
    parse_status: ParseStatus,
    solution: Solution | None,
    wall_time_s: float,
    self_reported_score: float | None = None,
    params: dict[str, Any] | None = None,
    tool_calls: list[dict[str, Any]] | None = None,
    seed: int = 0,
) -> RunRecord:
    """RunRecord de una ejecución LLM.

    `messages` es la conversación completa, con las respuestas del modelo ya
    añadidas. Tokens y coste suman todas las `responses`; `raw_response` es el
    texto de la última. La evaluación sale siempre de `evaluate`. El coste solo
    se calcula con `anthropic` y un modelo con precio; si no, queda en None.
    """
    tokens_in = sum(r.tokens_in for r in responses)
    tokens_out = sum(r.tokens_out for r in responses)
    usd = eur = version = None
    if provider == "anthropic":
        try:
            usd, eur, version = call_cost(model, tokens_in, tokens_out)
        except ValueError:
            pass  # sin precio para el modelo: no se pierde el registro de la llamada
    last = responses[-1] if responses else None
    return RunRecord(
        run_id=uuid.uuid4().hex,
        date=datetime.now(UTC),
        git_sha=_git_sha(),
        hardware=platform.platform(),
        instance_id=instance.id,
        instance_hash=instance.content_hash(),
        method=role,
        role=role,
        seed=seed,
        params=params or {},
        provider=provider,
        model_requested=model,
        model_returned=last.model if last else None,
        prompt_version=PROMPT_VERSION,
        messages=messages,
        raw_response=last.text if last else None,
        tool_calls=tool_calls,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        api_cost=usd,
        api_cost_eur=eur,
        price_table_version=version,
        self_reported_score=self_reported_score,
        stop_reason=last.stop_reason if last else None,
        wall_time_s=wall_time_s,
        solution=solution,
        evaluation=evaluate(instance, solution) if solution else None,
        parse_status=parse_status,
    )


def solve_direct(
    instance: Instance,
    provider: str,
    model: str,
    api_key: str,
    max_tokens: int,
    recheck: bool = False,
) -> RunRecord:
    """Una ejecución del LLM como resolvedor directo.

    Con `recheck` se envía además el segundo prompt (TFE p. 79) y la solución sale
    de la segunda respuesta. Un `ProviderError` de tiempo agotado da
    `parse_status="timeout"`; cualquier otro se propaga.
    """
    call = PROVIDERS[provider]
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": solve_prompt(instance)}
    ]
    responses: list[LLMResponse] = []
    status: ParseStatus = "unparseable"
    parsed = Parsed(None, None)
    start = time.perf_counter()
    try:
        for turn in range(2 if recheck else 1):
            if turn:
                messages.append({"role": "user", "content": recheck_prompt()})
            response = call(messages, [], model, api_key, max_tokens)
            responses.append(response)
            messages.append(response.message())
            if response.stop_reason == "refusal":
                status, parsed = "refused", Parsed(None, None)
                break
            parsed = extract_routes(response.text)
            status = "ok" if parsed.routes is not None else "unparseable"
    except ProviderError as exc:
        if exc.kind != "timeout":
            raise
        status, parsed = "timeout", Parsed(None, None)
    wall_time = time.perf_counter() - start

    return build_llm_record(
        instance,
        role="llm_direct",
        provider=provider,
        model=model,
        messages=messages,
        responses=responses,
        parse_status=status,
        solution=Solution(routes=parsed.routes) if parsed.routes is not None else None,
        wall_time_s=wall_time,
        self_reported_score=parsed.score,
        params={"max_tokens": max_tokens, "recheck": recheck},
    )
