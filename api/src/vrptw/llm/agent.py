"""El LLM como agente: usa los métodos clásicos y el evaluador como herramientas.

El modelo recibe `agent_prompt` y dos herramientas (`TOOLS`):

- `solve_classic(method, time_limit_s)`: ejecuta `SOLVERS[method]` con la semilla
  de la ejecución y un tiempo acotado por `max_tool_time_s` (por defecto
  `MAX_TOOL_TIME_S`). Al método solo le llegan `seed` y `time_limit_s`: ningún
  otro parámetro (como `legacy` del GA o `iterations`) es alcanzable desde el
  modelo. Con `max_tool_time_s=None` la herramienta es `solve_classic(method)`: el
  método hace todas sus iteraciones, sin corte por tiempo, y el resultado no
  depende de la carga de la máquina.
- `evaluate_routes(routes)`: evalúa unas rutas con `evaluate`.

Las dos devuelven JSON compacto con un resumen de la evaluación, y
`solve_classic` añade las rutas. Un argumento no válido (herramienta o método
desconocidos, tipo erróneo, argumento que falta o que sobra) da un resultado con
`is_error` y el bucle sigue.

Hay como mucho `max_turns` llamadas al modelo. La respuesta final es la primera
sin llamadas a herramientas; su bloque JSON se interpreta con `extract_routes`,
como en el resolvedor directo, y la solución es la que declara el modelo, no la
última que devolvió una herramienta. Si el último turno aún pide herramientas, no
se ejecutan (el modelo ya no vería su resultado) y la ejecución queda como
`unparseable`.

Con `output_budget`, la salida de toda la ejecución (razonamiento incluido) no
pasa de ese presupuesto: cada llamada recibe como `max_tokens` lo que queda (sin
pasar de `max_tokens`). Si quedan menos de `MIN_CALL_TOKENS`, no se llama: la
ejecución termina sin respuesta final (`unparseable`, con
`params["early_stop"] = "output_budget"`), y si el turno anterior pedía
herramientas, no se ejecutan, por la misma razón que en el último turno.
"""

import json
import time
from collections import Counter
from typing import Any

from vrptw.evaluate import evaluate
from vrptw.llm.direct import (
    Parsed,
    ParseStatus,
    build_llm_record,
    extract_routes,
    is_routes,
)
from vrptw.llm.prompts import agent_prompt
from vrptw.llm.providers import (
    PROVIDERS,
    LLMResponse,
    Provider,
    ProviderError,
    ToolCall,
)
from vrptw.model import Evaluation, Instance, RunRecord, Solution
from vrptw.solvers.registry import SOLVERS

MAX_TURNS = 6
# Tope de `time_limit_s` por llamada a `solve_classic`. Sin límite, el ACO tarda
# unos 50 s con 100 clientes; con 10 s, un turno que pruebe los cuatro métodos se
# queda en unos 30 s de cálculo (la heurística es casi instantánea).
MAX_TOOL_TIME_S = 10.0
# Con presupuesto de salida, una llamada con menos de esto no se hace (supuesto
# propio): la respuesta final de 100 clientes ocupa unos 390-465 bytes de JSON (la
# heurística en C101, R101 y RC101, como mucho un token por byte), y el resto queda
# para razonar antes de contestar. 1024 era también el mínimo del antiguo
# `budget_tokens` de razonamiento.
MIN_CALL_TOKENS = 1024

_SOLVE_DESCRIPTION = (
    "Runs a classic VRPTW method on the instance of the problem and returns "
    "its routes and their evaluation, as JSON. heuristic is a fast greedy "
    "construction (nearest feasible customer); aco (ant colony), ga "
    "(genetic algorithm) and tabu (tabu search) are metaheuristics that "
)


def tools(max_tool_time_s: float | None = MAX_TOOL_TIME_S) -> list[dict[str, Any]]:
    """Herramientas del agente; sin tope de tiempo, `solve_classic` no lo recibe.

    Las descripciones las lee el modelo: cambiarlas exige subir PROMPT_VERSION (las
    instantáneas `tests/data/prompts/agent-tools*.txt` lo comprueban). La variante
    sin tope no cambia PROMPT_VERSION: la distingue `max_tool_time_s` en `params`.
    """
    properties: dict[str, Any] = {"method": {"type": "string", "enum": sorted(SOLVERS)}}
    if max_tool_time_s is None:
        description = _SOLVE_DESCRIPTION + ("run their full number of iterations.")
    else:
        description = _SOLVE_DESCRIPTION + "stop after time_limit_s seconds or earlier."
        properties["time_limit_s"] = {
            "type": "number",
            "exclusiveMinimum": 0,
            "description": f"Time limit in seconds, capped at {max_tool_time_s:g}.",
        }
    return [
        {
            "name": "solve_classic",
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": list(properties),
                "additionalProperties": False,
            },
        },
        EVALUATE_TOOL,
    ]


EVALUATE_TOOL: dict[str, Any] = {
    "name": "evaluate_routes",
    "description": (
        "Evaluates the given routes on the instance of the problem, with the "
        "same evaluator that judges the final answer, and returns the "
        "evaluation as JSON."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "routes": {
                "type": "array",
                "items": {"type": "array", "items": {"type": "integer"}},
                "description": (
                    "One list per vehicle with the CUSTOMER numbers in the order "
                    "they are visited, without the depot (Customer 0)."
                ),
            },
        },
        "required": ["routes"],
        "additionalProperties": False,
    },
}
TOOLS = tools()


def _summary(evaluation: Evaluation) -> dict[str, Any]:
    """Resumen de la evaluación que recibe el modelo."""
    counts = Counter(v.type for v in evaluation.violations)
    return {
        "score": evaluation.score,
        "distance": evaluation.distance,
        "vehicles_used": evaluation.vehicles_used,
        "unserved": evaluation.unserved,
        "feasible": evaluation.feasible,
        "violations": dict(sorted(counts.items())),
    }


def _check_names(arguments: dict[str, Any], names: tuple[str, ...]) -> str | None:
    """Mensaje de error si sobran o faltan argumentos; None si están justos."""
    extra = sorted(str(a) for a in arguments if a not in names)
    if extra:
        return f"unexpected arguments: {', '.join(extra)}; allowed: {', '.join(names)}"
    missing = [a for a in names if a not in arguments]
    if missing:
        return f"missing arguments: {', '.join(missing)}"
    return None


def _run_tool(
    instance: Instance,
    seed: int,
    call: ToolCall,
    max_tool_time_s: float | None = MAX_TOOL_TIME_S,
) -> tuple[dict[str, Any] | str, bool]:
    """Ejecuta una llamada. Devuelve (resultado, es_error); un error es un mensaje."""
    args = call.arguments
    if call.name == "solve_classic":
        allowed = ("method",) if max_tool_time_s is None else ("method", "time_limit_s")
        error = _check_names(args, allowed)
        if error:
            return error, True
        method = args["method"]
        if not isinstance(method, str) or method not in SOLVERS:
            valid = ", ".join(sorted(SOLVERS))
            return f"unknown method {method!r}; valid methods: {valid}", True
        time_limit: float | None = None
        if max_tool_time_s is not None:
            limit = args["time_limit_s"]
            # `not limit > 0` también rechaza NaN
            if (
                not isinstance(limit, int | float)
                or isinstance(limit, bool)
                or not limit > 0
            ):
                return "time_limit_s must be a positive number", True
            # `min` antes de `float`: un entero enorme no desborda
            time_limit = float(min(limit, max_tool_time_s))
        solution = SOLVERS[method](instance, seed=seed, time_limit_s=time_limit)
        return {
            "routes": solution.routes,
            **_summary(evaluate(instance, solution)),
        }, False
    if call.name == "evaluate_routes":
        error = _check_names(args, ("routes",))
        if error:
            return error, True
        if not is_routes(args["routes"]):
            return "routes must be a list of lists of integer CUSTOMER numbers", True
        return _summary(evaluate(instance, Solution(routes=args["routes"]))), False
    names = ", ".join(t["name"] for t in TOOLS)
    return f"unknown tool {call.name!r}; available tools: {names}", True


def solve_agent(
    instance: Instance,
    provider: str,
    model: str,
    api_key: str,
    max_tokens: int,
    seed: int = 0,
    max_turns: int = MAX_TURNS,
    call: Provider | None = None,
    output_budget: int | None = None,
    max_tool_time_s: float | None = MAX_TOOL_TIME_S,
) -> RunRecord:
    """Una ejecución del LLM como agente con los métodos clásicos como herramientas.

    `seed` es la semilla de los métodos que ejecuta `solve_classic`, y
    `max_tool_time_s` su tope de tiempo (`None`: sin corte). El registro
    guarda la conversación completa y, en `tool_calls`, una entrada por llamada
    ejecutada (`id`, `name`, `arguments`, `is_error`, `result` y `time_s`). Una
    negativa da `parse_status="refused"` y un `ProviderError` de tiempo agotado,
    `timeout`; cualquier otro se propaga. `call`, si se da, hace cada llamada en
    lugar de `PROVIDERS[provider]`, como en `solve_direct`. `output_budget` es el
    presupuesto de salida de la ejecución (ver el docstring del módulo); sin él,
    cada llamada recibe `max_tokens`.
    """
    if call is None:
        call = PROVIDERS[provider]
    agent_tools = tools(max_tool_time_s)
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": agent_prompt(instance, max_turns)}
    ]
    responses: list[LLMResponse] = []
    trace: list[dict[str, Any]] = []
    status: ParseStatus = "unparseable"
    parsed = Parsed(None, None)
    early_stop: str | None = None

    def next_max_tokens() -> int:
        if output_budget is None:
            return max_tokens
        return min(max_tokens, output_budget - sum(r.tokens_out for r in responses))

    def out_of_budget() -> bool:
        return output_budget is not None and next_max_tokens() < MIN_CALL_TOKENS

    start = time.perf_counter()
    try:
        while len(responses) < max_turns:
            if out_of_budget():
                early_stop = "output_budget"
                break
            response = call(messages, agent_tools, model, api_key, next_max_tokens())
            responses.append(response)
            messages.append(response.message())
            if response.stop_reason == "refusal":
                status = "refused"
                break
            if not response.tool_calls:
                parsed = extract_routes(response.text)
                status = "ok" if parsed.routes is not None else "unparseable"
                break
            if len(responses) == max_turns:
                break  # no hay turno siguiente: nadie leería los resultados
            if out_of_budget():
                early_stop = "output_budget"
                break  # tampoco hay turno siguiente
            for tool_call in response.tool_calls:
                tool_start = time.perf_counter()
                result, is_error = _run_tool(instance, seed, tool_call, max_tool_time_s)
                tool_time = time.perf_counter() - tool_start
                content = (
                    result
                    if isinstance(result, str)
                    else json.dumps(result, separators=(",", ":"))
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "content": content,
                        "is_error": is_error,
                    }
                )
                trace.append(
                    {
                        "id": tool_call.id,
                        "name": tool_call.name,
                        "arguments": tool_call.arguments,
                        "is_error": is_error,
                        "result": result,
                        "time_s": tool_time,
                    }
                )
    except ProviderError as exc:
        if exc.kind != "timeout":
            raise
        status, parsed = "timeout", Parsed(None, None)
    wall_time = time.perf_counter() - start
    params: dict[str, Any] = {
        "max_tokens": max_tokens,
        "max_turns": max_turns,
        "max_tool_time_s": max_tool_time_s,
    }
    if output_budget is not None:
        params["output_budget"] = output_budget
    if early_stop is not None:
        params["early_stop"] = early_stop

    return build_llm_record(
        instance,
        role="llm_agent",
        provider=provider,
        model=model,
        messages=messages,
        responses=responses,
        parse_status=status,
        solution=Solution(routes=parsed.routes) if parsed.routes is not None else None,
        wall_time_s=wall_time,
        self_reported_score=parsed.score,
        params=params,
        tool_calls=trace,
        seed=seed,
    )
