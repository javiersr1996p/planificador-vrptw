"""Estimación del coste en API del benchmark LLM, sin ninguna llamada de red.

Recorre los escalones LLM (`LLM_TIERS`, que reutilizará el runner de la tarea
3.7), construye el prompt real de cada ejecución (`solve_prompt` en `llm_direct`;
`agent_prompt` más `TOOLS` en `llm_agent`; sin el prompt de comprobación, por la
decisión D5) y valora cada llamada con `call_cost`. Así los precios, el tipo de
cambio y el tramo caro de Haiku 5.5 (más de 100 000 tokens de entrada en una
petición) salen solo de `pricing.py` y `data/models.json`.

Todo lo demás es supuesto; `ASSUMPTIONS` lo imprime `vrptw bench estimate`:

- Entrada: no hay contador de tokens sin red, así que se cuentan los bytes UTF-8
  del texto. Escenario bajo: 2,69 bytes por token (3,5 / 1,3: el glosario de
  Anthropic da unos 3,5 caracteres en inglés por token en los modelos anteriores
  a Claude 4.7, y el tokenizador de 4.7 y posteriores produce un 30 % más de
  tokens). Escenario alto: 1 byte por token (supuesto propio: ningún token cubre
  menos de un byte; los prompts son ASCII).
- Herramientas: 286 tokens de prompt de sistema por llamada del agente en los tres
  modelos (tabla de precios de Anthropic), más el JSON de `TOOLS`.
- Razonamiento reenviado: se cobra como entrada. Haiku 5.5, Sonnet 5.5 y Opus 5.5
  conservan el razonamiento de todos los turnos previos y lo facturan como
  entrada (página "Thinking" de Anthropic).
- Esfuerzo `medium` en los tres modelos (`providers.EFFORT`), y el agente con un
  presupuesto de salida por ejecución igual a `max_tokens` (`solve_agent`,
  `output_budget`).
- Salida, escenario alto (cota superior): la llamada directa agota `max_tokens`.
  El agente usa sus `MAX_TURNS` llamadas y agota su presupuesto: la primera gasta
  todo menos `MIN_CALL_TOKENS`, que así se reenvía como entrada en las cinco
  siguientes, y la última gasta el resto; con cuatro resultados de
  `solve_classic` por turno con herramientas.
- Salida, escenario bajo (supuesto propio): `LOW_OUTPUT` por modelo y tamaño en
  `llm_direct`; el agente hace tres llamadas (la mitad de esa salida y dos de
  `AGENT_FOLLOWUP_TOKENS`, dentro del presupuesto) con un resultado de
  `solve_classic` por turno.
- Casos reales: aún no existen; se sustituyen por R101 recortado a 12 y 25
  clientes, sin coordenadas y con la matriz euclídea en el prompt.
- Sin caché: toda la entrada a precio base (si la API cachea, cuesta menos).
"""

import json
import math
from typing import NamedTuple

from vrptw.bench.run import TIERS
from vrptw.instances.solomon import coordinates, euclidean_matrix, load_solomon
from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.llm.agent import MAX_TURNS, MIN_CALL_TOKENS, TOOLS, _run_tool
from vrptw.llm.pricing import USD_PER_EUR, call_cost
from vrptw.llm.prompts import agent_prompt, solve_prompt
from vrptw.llm.providers import EFFORT, ToolCall
from vrptw.model import SOLOMON, Instance

MODELS = ("claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5")
ROLES = ("llm_direct", "llm_agent")
SCENARIOS = ("bajo", "alto")


class LLMTier(NamedTuple):
    name: str
    # (nombre, n) como en `run.TIERS`; ("real", n) es un caso real de n paradas
    instances: tuple[tuple[str, int | None], ...]
    reps: int
    cap_eur: float


LLM_TIERS: dict[int, LLMTier] = {
    0: LLMTier("Calibración", (("10c-1", None),), 1, 1.0),
    1: LLMTier(
        "Puente TFE y ejemplos",
        (*TIERS[1], ("real", 12), ("real", 25)),
        3,
        4.0,
    ),
    2: LLMTier("Solomon 25", tuple(TIERS[2]), 3, 5.0),
    3: LLMTier("Solomon 50", tuple(TIERS[3]), 2, 4.0),
    4: LLMTier("Solomon 100", tuple(TIERS[4]), 2, 4.0),
}
# Tope global duro en USD, lo que factura Anthropic (decisión del usuario: 20 USD
# hasta la minicalibración; luego 22,76 USD más de benchmark, con 25 USD de tope).
# Los topes de escalón y los subtopes por modelo en EUR quedan como referencia de
# esta estimación; el runner ya no los aplica.
GLOBAL_CAP_USD = 25.0
# Subtope por modelo (suma 18 EUR): ver `MODEL_CAPS_NOTE`.
MODEL_CAPS_EUR = {
    "claude-haiku-5-5": 0.5,
    "claude-sonnet-5-5": 6.5,
    "claude-opus-5-5": 11.0,
}
MODEL_CAPS_NOTE = (
    "Subtopes (Opus 11, Sonnet 6,5, Haiku 0,5 EUR; suma 18 EUR = "
    f"{18 * USD_PER_EUR:.2f} USD, dentro del tope global de 20 USD): se fijaron "
    "proporcionales al escenario bajo de la estimación anterior (Sonnet a "
    "esfuerzo high), para que, si el presupuesto obliga a parar, los tres "
    "modelos pierdan la misma fracción de ejecuciones, y se mantienen. Se "
    "revisan con los tokens del escalón 0."
)

# max_tokens por llamada, igual en los tres modelos para que el tope no favorezca
# a ninguno: (máximo de clientes, max_tokens). El JSON final ocupa pocos cientos de
# tokens; el resto es margen para razonar. 10 000 es lo que cabe en los 300 s de
# `providers.TIMEOUT_S` (sin streaming) al ritmo de peor caso que supone el SDK
# anthropic 2.8.0 (128 000 tokens en 3600 s, `_calculate_nonstreaming_timeout`).
MAX_TOKENS_BY_SIZE = ((25, 8_000), (100, 10_000))

BYTES_PER_TOKEN = {"bajo": 3.5 / 1.3, "alto": 1.0}
TOOL_SYSTEM_TOKENS = 286
# Escenario bajo de `llm_direct`: base + por cliente (tokens de salida). Sonnet
# con el mismo supuesto que Opus: los dos a esfuerzo medium.
LOW_OUTPUT = {
    "claude-haiku-5-5": (1_500, 40),
    "claude-sonnet-5-5": (2_000, 60),
    "claude-opus-5-5": (2_000, 60),
}
AGENT_FOLLOWUP_TOKENS = 1_000
RESULTS_PER_TOOL_TURN = {"bajo": 1, "alto": 4}

ASSUMPTIONS = (
    (
        "Entrada contada en bytes UTF-8 del prompt real. Bajo: 2,69 bytes/token "
        "(3,5 caracteres por token en modelos anteriores a Claude 4.7 y un 30 % más "
        "de tokens desde 4.7; https://platform.claude.com/docs/en/about-claude/glossary"
        " y https://platform.claude.com/docs/en/about-claude/pricing). Alto: 1 "
        "byte/token (supuesto propio: ningún token cubre menos de un byte). El "
        "escalón 0 medirá los tokens reales."
    ),
    (
        "Agente: 286 tokens de prompt de sistema por usar herramientas (los tres "
        "modelos, tool_choice auto; tabla de precios) más el JSON de TOOLS. El "
        "prompt de sistema del razonamiento no tiene tamaño publicado: no se cuenta."
    ),
    (
        "Agente: cada llamada reenvía la conversación entera, y el razonamiento "
        "previo se cobra como entrada: Haiku 5.5, Sonnet 5.5 y Opus 5.5 conservan el "
        "de todos los turnos (https://platform.claude.com/docs/en/build-with-claude/"
        "thinking, 'Thinking block preservation by model')."
    ),
    (
        f"Esfuerzo {EFFORT} en los tres modelos (output_config.effort; "
        "https://platform.claude.com/docs/en/build-with-claude/effort). Agente con "
        "presupuesto de salida por ejecución igual a max_tokens: cada llamada "
        "recibe lo que queda y no se llama con menos de "
        f"{MIN_CALL_TOKENS} tokens."
    ),
    (
        "Salida alta (cota superior): el directo agota max_tokens (el razonamiento "
        "cuenta para max_tokens y se factura como salida). El agente hace sus 6 "
        f"llamadas y agota el presupuesto: la 1.ª gasta todo menos {MIN_CALL_TOKENS}, "
        "que se reenvía como entrada en las 5 siguientes, y la 6.ª el resto; 4 "
        "resultados de solve_classic por turno con herramientas."
    ),
    (
        "Salida baja (supuesto propio): directo, base + k x clientes (Haiku "
        "1500+40n; Sonnet y Opus 2000+60n, los dos a esfuerzo medium), sin pasar de "
        "max_tokens; agente, 3 llamadas (la mitad de eso, 1000 y 1000, dentro del "
        "presupuesto) con 1 resultado de solve_classic por turno."
    ),
    "Resultado de solve_classic: el JSON real de la heurística en esa instancia.",
    (
        "Casos reales: sustitutos de 12 y 25 clientes (R101 recortado), sin X/Y y "
        "con la matriz de tiempos en el prompt a precisión completa (10 cifras)."
    ),
    (
        "Sin caché ni lotes: toda la entrada a precio base, como call_cost. Si la "
        "API cachea el historial del agente, el coste real es menor."
    ),
    "Sin recheck (D5). Precios y tipo de cambio solo de data/models.json y pricing.py.",
    (
        f"Tope global {GLOBAL_CAP_USD:.0f} USD (lo que factura Anthropic), el único "
        "que aplica el runner; los topes de escalón y subtopes en EUR quedan como "
        "referencia de esta estimación."
    ),
)


class Row(NamedTuple):
    tier: int
    model: str
    role: str
    runs: int
    calls: tuple[int, int]  # (bajo, alto)
    tokens_in: tuple[int, int]
    tokens_out: tuple[int, int]
    eur: tuple[float, float]


class PromptSize(NamedTuple):
    n: int
    direct_bytes: int
    agent_bytes: int  # prompt del agente más la definición de las herramientas
    result_bytes: int  # un resultado de `solve_classic`


def real_substitute(n: int) -> Instance:
    """Sustituto de un caso real de `n` paradas (n <= 25) para estimar su prompt.

    R101 recortado, sin coordenadas cartesianas, con la matriz euclídea sin
    truncar: el prompt lleva la tabla sin X ni Y y la matriz de tiempos.
    """
    base = load_solomon("R101", 25)
    customers = base.customers[:n]
    return Instance(
        id=f"real-{n}-sustituto",
        name=f"real-{n}",
        source="real",
        depot=base.depot.model_copy(update={"x": None, "y": None}),
        customers=[c.model_copy(update={"x": None, "y": None}) for c in customers],
        fleet=base.fleet,
        matrix=euclidean_matrix(coordinates(base.depot, customers)),
        cost_profile=SOLOMON,
    )


def load_llm_instance(name: str, n: int | None) -> Instance:
    """Instancia de una entrada de `LLM_TIERS`.

    `("real", n)` da, hasta la fase 4, un sustituto que solo sirve para estimar.
    """
    if name == "real":
        assert n is not None
        return real_substitute(n)
    if n is None:
        return load_tfe2024(name)
    return load_solomon(name, n, truncated=True)


def max_tokens_for(n: int) -> int:
    """max_tokens propuesto para una instancia de `n` clientes."""
    for limit, tokens in MAX_TOKENS_BY_SIZE:
        if n <= limit:
            return tokens
    raise ValueError(f"sin max_tokens para {n} clientes")


def prompt_size(instance: Instance) -> PromptSize:
    tools = json.dumps(TOOLS, ensure_ascii=False)
    result, _ = _run_tool(
        instance,
        0,
        ToolCall(
            "estimate", "solve_classic", {"method": "heuristic", "time_limit_s": 1}
        ),
    )
    return PromptSize(
        n=len(instance.customers),
        direct_bytes=len(solve_prompt(instance).encode()),
        agent_bytes=len((agent_prompt(instance, MAX_TURNS) + tools).encode()),
        result_bytes=len(json.dumps(result, separators=(",", ":")).encode()),
    )


def within_budget(outputs: list[int], budget: int) -> list[int]:
    """Las salidas que deja hacer el presupuesto del agente, como `solve_agent`:
    cada llamada recibe lo que queda y no se llama con menos de `MIN_CALL_TOKENS`."""
    done: list[int] = []
    for out in outputs:
        left = budget - sum(done)
        if left < MIN_CALL_TOKENS:
            break
        done.append(min(out, left))
    return done


def run_calls(
    size: PromptSize, model: str, role: str, scenario: str, max_tokens: int
) -> list[tuple[int, int]]:
    """(tokens de entrada, tokens de salida) de cada llamada de una ejecución. El
    agente tiene un presupuesto de salida por ejecución igual a `max_tokens`."""

    def tokens(n_bytes: int) -> int:
        return math.ceil(n_bytes / BYTES_PER_TOKEN[scenario])

    base, per_customer = LOW_OUTPUT[model]
    low = min(base + per_customer * size.n, max_tokens)
    if role == "llm_direct":
        return [(tokens(size.direct_bytes), low if scenario == "bajo" else max_tokens)]

    if scenario == "bajo":
        wanted = [low // 2] + [AGENT_FOLLOWUP_TOKENS] * 2
    else:
        # cota superior: lo gastado pronto se reenvía en todas las llamadas que
        # siguen, y la última aún necesita `MIN_CALL_TOKENS`
        first = max(max_tokens - MIN_CALL_TOKENS, 0)
        wanted = [first] + [0] * (MAX_TURNS - 2) + [MIN_CALL_TOKENS]
    outputs = within_budget(wanted, max_tokens)
    results = RESULTS_PER_TOOL_TURN[scenario] * tokens(size.result_bytes)
    history = tokens(size.agent_bytes) + TOOL_SYSTEM_TOKENS
    calls = []
    for out in outputs:
        calls.append((history, out))
        history += out + results  # lo generado y los resultados vuelven a entrar
    return calls


def estimate(max_tokens: int | None = None) -> list[Row]:
    """Una fila por escalón, modelo y papel. `max_tokens` fija el mismo valor para
    todas las llamadas; por defecto, el propuesto por tamaño (`max_tokens_for`)."""
    sizes: dict[tuple[str, int | None], PromptSize] = {}
    rows = []
    for number, tier in LLM_TIERS.items():
        for key in tier.instances:
            if key not in sizes:
                sizes[key] = prompt_size(load_llm_instance(*key))
        for model in MODELS:
            for role in ROLES:
                calls, t_in, t_out = [0, 0], [0, 0], [0, 0]
                eur = [0.0, 0.0]
                for key in tier.instances:
                    size = sizes[key]
                    cap = max_tokens or max_tokens_for(size.n)
                    for i, scenario in enumerate(SCENARIOS):
                        run = run_calls(size, model, role, scenario, cap)
                        calls[i] += tier.reps * len(run)
                        t_in[i] += tier.reps * sum(c[0] for c in run)
                        t_out[i] += tier.reps * sum(c[1] for c in run)
                        eur[i] += tier.reps * sum(
                            call_cost(model, a, b).eur for a, b in run
                        )
                rows.append(
                    Row(
                        number,
                        model,
                        role,
                        len(tier.instances) * tier.reps,
                        (calls[0], calls[1]),
                        (t_in[0], t_in[1]),
                        (t_out[0], t_out[1]),
                        (eur[0], eur[1]),
                    )
                )
    return rows


def _total(rows: list[Row]) -> tuple[float, float]:
    return sum(r.eur[0] for r in rows), sum(r.eur[1] for r in rows)


def _check(value: float, cap: float) -> str:
    return "cabe" if value <= cap else "NO cabe"


def render(rows: list[Row], max_tokens: int | None = None) -> str:
    """Tabla por escalón, modelo y papel, subtotales frente a sus topes y supuestos."""
    k = 1000
    lines = [
        (
            "Estimación del benchmark LLM (sin llamadas a la API). EUR = USD / "
            f"{USD_PER_EUR} (BCE)."
        ),
        f"Esfuerzo {EFFORT} en los tres modelos. max_tokens por llamada del directo "
        "y presupuesto de salida por ejecución del agente: "
        + (
            f"{max_tokens} en todas"
            if max_tokens
            else ", ".join(f"{t} hasta {n} clientes" for n, t in MAX_TOKENS_BY_SIZE)
        ),
        "",
        (
            f"{'Esc':>3} {'Modelo':<18} {'Papel':<10} {'Ejec':>4} {'Llamadas':>9} "
            f"{'Entrada ktok':>14} {'Salida ktok':>13} {'EUR bajo':>9} {'EUR alto':>9}"
        ),
    ]
    for r in rows:
        lines.append(
            f"{r.tier:>3} {r.model:<18} {r.role:<10} {r.runs:>4} "
            f"{r.calls[0]:>4}/{r.calls[1]:<4} "
            f"{r.tokens_in[0] / k:>6.0f}/{r.tokens_in[1] / k:<7.0f} "
            f"{r.tokens_out[0] / k:>5.0f}/{r.tokens_out[1] / k:<7.0f} "
            f"{r.eur[0]:>9.2f} {r.eur[1]:>9.2f}"
        )

    lines += ["", "Por escalón (EUR; tope del escalón; alto también en USD):"]
    for number, tier in LLM_TIERS.items():
        low, high = _total([r for r in rows if r.tier == number])
        runs = sum(r.runs for r in rows if r.tier == number)
        lines.append(
            f"  {number} {tier.name:<22} {runs:>4} ejec.  bajo {low:7.2f}  "
            f"alto {high:8.2f} ({high * USD_PER_EUR:6.2f} USD)  "
            f"tope {tier.cap_eur:5.2f}  "
            f"bajo {_check(low, tier.cap_eur)}, alto {_check(high, tier.cap_eur)}"
        )
    lines += ["", "Por modelo (EUR; subtope):"]
    for model in MODELS:
        low, high = _total([r for r in rows if r.model == model])
        cap = MODEL_CAPS_EUR[model]
        lines.append(
            f"  {model:<18} bajo {low:7.2f}  alto {high:8.2f}  subtope {cap:5.2f}  "
            f"bajo {_check(low, cap)}, alto {_check(high, cap)}"
        )
    lines += ["", "Por papel:"]
    for role in ROLES:
        low, high = _total([r for r in rows if r.role == role])
        lines.append(f"  {role:<10} bajo {low:7.2f}  alto {high:8.2f}")
    low, high = _total(rows)
    # call_cost da eur = usd / USD_PER_EUR: el paso a USD es exacto
    low_usd, high_usd = low * USD_PER_EUR, high * USD_PER_EUR
    lines += [
        "",
        (
            f"TOTAL ({sum(r.runs for r in rows)} ejecuciones): bajo {low:.2f} EUR "
            f"= {low_usd:.2f} USD, alto {high:.2f} EUR = {high_usd:.2f} USD. Tope "
            f"global {GLOBAL_CAP_USD:.0f} USD: bajo "
            f"{_check(low_usd, GLOBAL_CAP_USD)}, alto "
            f"{_check(high_usd, GLOBAL_CAP_USD)}."
        ),
        "",
        MODEL_CAPS_NOTE,
        "",
        "Supuestos:",
        *(f"- {a}" for a in ASSUMPTIONS),
    ]
    return "\n".join(lines)
