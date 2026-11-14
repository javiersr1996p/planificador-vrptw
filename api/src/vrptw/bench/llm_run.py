"""Runner del benchmark LLM: libro de gasto, topes duros, caché y reanudación.

Cada llamada al proveedor pasa por el envoltorio de `guarded`, que el runner da a
`solve_direct` y `solve_agent` en su argumento `call`:

- Antes de enviarla calcula su peor caso. Entrada: los bytes UTF-8 de los mensajes
  y las herramientas a 1 byte por token (escenario alto de `estimate.py`), más
  `TOOL_SYSTEM_TOKENS` si hay herramientas, más la salida de las llamadas
  anteriores de la misma ejecución: el razonamiento reenviado se factura como
  entrada y por defecto llega con el texto vacío (`display: "omitted"`), así que
  no suma bytes. Salida: el `max_tokens` de la llamada (en el agente, lo que
  queda de su presupuesto de salida). Todo valorado en USD con `call_cost`. Si
  ese coste más lo gastado según el libro supera el tope del escalón, el subtope
  del modelo o el tope global, no llama y lanza `BudgetExceeded`.
- En cuanto vuelve la respuesta, añade al libro una entrada con los tokens reales
  y la escribe en disco. Un tiempo agotado, un error de red, una respuesta que no
  se puede leer (`MAYBE_BILLED`) o un Ctrl+C a la espera pudieron cobrarse sin que
  llegue el uso: esa llamada se apunta con su peor caso y `estimated: true`.

Libro (`LEDGER_PATH`, `api/runs/ledger.json`): lista JSON con una entrada por
llamada pagada (`date`, `tier`, `model`, `role`, `instance`, `rep`, `call`,
`tokens_in`, `tokens_out`, `usd`, `eur`, `estimated`). Los topes y la comprobación
van en USD, que es lo que factura Anthropic: global `GLOBAL_CAP_USD` (20 USD); los
de escalón y modelo, definidos en EUR en `estimate.py`, se convierten con
`USD_PER_EUR`. `eur` se guarda solo como dato. Lo gastado se lee siempre del
libro, así que cuenta las ejecuciones anteriores y los otros escalones. Un solo
runner a la vez: dos procesos con el mismo libro no se ven el gasto.

Configuración fija de cada ejecución: esfuerzo `EFFORT` (lo envía
`call_anthropic`) y, en el agente, un presupuesto de salida por ejecución igual
al `max_tokens` del resolvedor directo en esa instancia.

Caché: el RunRecord de una ejecución terminada se escribe en `out_dir` con un
nombre que lleva la clave (instancia y su hash, papel, modelo, `PROMPT_VERSION`,
`EFFORT`, `max_tokens` y repetición); si ya existe, no se repite. Una ejecución detenida por
tope o por un `ProviderError` no deja RunRecord: se apunta en `out_dir/failed.json`
y se reintenta al reanudar. Libro, RunRecord y `failed.json` se escriben de forma
atómica (fichero temporal, volcado a disco y `os.replace`).

La clave de API solo viaja como argumento hasta el proveedor: no se guarda en el
envoltorio ni aparece en ningún fichero ni mensaje.
"""

import json
import os
import sys
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, NamedTuple

from vrptw.bench.estimate import (
    GLOBAL_CAP_USD,
    LLM_TIERS,
    MODEL_CAPS_EUR,
    MODELS,
    ROLES,
    TOOL_SYSTEM_TOKENS,
    PromptSize,
    load_llm_instance,
    max_tokens_for,
    prompt_size,
    run_calls,
)
from vrptw.cli import API_DIR
from vrptw.llm.agent import solve_agent
from vrptw.llm.direct import solve_direct
from vrptw.llm.pricing import USD_PER_EUR, call_cost
from vrptw.llm.prompts import PROMPT_VERSION
from vrptw.llm.providers import (
    EFFORT,
    PROVIDERS,
    LLMResponse,
    Provider,
    ProviderError,
)
from vrptw.model import Instance, RunRecord

PROVIDER = "anthropic"
LEDGER_PATH = API_DIR / "runs" / "ledger.json"
DEFAULT_OUT_DIR = API_DIR / "runs" / "llm"
FAILED_NAME = "failed.json"
# La petición pudo procesarse y cobrarse sin que llegue la respuesta. Los demás
# fallos (401, 413, 429, 5xx...) son rechazos que no se facturan.
MAYBE_BILLED = ("timeout", "network", "api")
# Fallos de la cuenta, no de la petición: con ellos fallaría todo lo que queda.
FATAL = ("auth", "rate_limit")
REAL_NOTE = (
    "Casos reales omitidos: aún no existen (fase 4) y su sustituto solo sirve "
    "para estimar."
)


class Caps(NamedTuple):
    """Topes en USD."""

    tier: dict[int, float]
    model: dict[str, float]
    total: float


CAPS = Caps(
    {n: t.cap_eur * USD_PER_EUR for n, t in LLM_TIERS.items()},
    {m: cap * USD_PER_EUR for m, cap in MODEL_CAPS_EUR.items()},
    GLOBAL_CAP_USD,
)


class BudgetExceeded(Exception):
    """La llamada siguiente, en su peor caso, superaría los topes `caps`."""

    def __init__(self, caps: list[str], worst_usd: float) -> None:
        super().__init__(
            f"peor caso de la llamada {worst_usd:.4f} USD: superaría {', '.join(caps)}"
        )
        self.caps = caps


class Job(NamedTuple):
    """Una ejecución del escalón: instancia x modelo x papel x repetición."""

    tier: int
    instance: Instance
    model: str
    role: str
    rep: int
    max_tokens: int

    @property
    def stem(self) -> str:
        """Nombre del RunRecord, que es la clave de caché."""
        return (
            f"{self.instance.id}_{self.role}_{self.model}_{PROMPT_VERSION}_{EFFORT}"
            f"_mt{self.max_tokens}_r{self.rep}_{self.instance.content_hash()[:12]}"
        )


def _cap_names(tier: int, model: str) -> tuple[str, str, str]:
    return "global", f"escalón {tier}", f"modelo {model}"


def _spent(
    entries: list[dict[str, Any]], tier: int | None = None, model: str | None = None
) -> float:
    return float(
        sum(
            e["usd"]
            for e in entries
            if (tier is None or e["tier"] == tier)
            and (model is None or e["model"] == model)
        )
    )


def over_caps(
    entries: list[dict[str, Any]], worst_usd: float, tier: int, model: str, caps: Caps
) -> list[str]:
    """Topes (en USD) que superaría una llamada de `worst_usd` con el gasto de
    `entries`."""
    total, by_tier, by_model = _cap_names(tier, model)
    limits = [
        (total, _spent(entries), caps.total),
        (by_tier, _spent(entries, tier=tier), caps.tier[tier]),
        (by_model, _spent(entries, model=model), caps.model[model]),
    ]
    return [name for name, spent, cap in limits if spent + worst_usd > cap]


def worst_case_tokens(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    previous_out: int,
    max_tokens: int,
) -> tuple[int, int]:
    """(entrada, salida) máximas de una llamada; ver el docstring del módulo."""
    sent = len(json.dumps([messages, tools], ensure_ascii=False).encode())
    system = TOOL_SYSTEM_TOKENS if tools else 0
    return sent + system + previous_out, max_tokens


def read_ledger(path: Path) -> list[dict[str, Any]]:
    """Entradas del libro (o de `failed.json`); lista vacía si aún no existe."""
    if not path.exists():
        return []
    entries: list[dict[str, Any]] = json.loads(path.read_text(encoding="utf-8"))
    return entries


def write_atomic(path: Path, text: str) -> None:
    """Escribe `text` sin dejar nunca el fichero a medias."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _append(path: Path, entry: dict[str, Any]) -> None:
    entries = read_ledger(path)
    entries.append(entry)
    write_atomic(path, json.dumps(entries, indent=2, ensure_ascii=False))


def _describe(job: Job) -> dict[str, Any]:
    return {
        "date": datetime.now(UTC).isoformat(),
        "tier": job.tier,
        "model": job.model,
        "role": job.role,
        "instance": job.instance.id,
        "rep": job.rep,
    }


def _charge(
    ledger: Path, job: Job, call: int, tokens_in: int, tokens_out: int, estimated: bool
) -> None:
    cost = call_cost(job.model, tokens_in, tokens_out)
    _append(
        ledger,
        {
            **_describe(job),
            "call": call,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "usd": cost.usd,
            "eur": cost.eur,
            "estimated": estimated,
        },
    )


def guarded(job: Job, ledger: Path, caps: Caps) -> Provider:
    """`PROVIDERS["anthropic"]` con los topes comprobados antes de cada llamada y
    cada llamada apuntada en el libro en cuanto termina."""
    send = PROVIDERS[PROVIDER]
    answered: list[LLMResponse] = []

    def call(
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        model: str,
        api_key: str,
        max_tokens: int,
    ) -> LLMResponse:
        previous_out = sum(r.tokens_out for r in answered)
        tokens = worst_case_tokens(messages, tools, previous_out, max_tokens)
        worst = call_cost(model, *tokens).usd
        over = over_caps(read_ledger(ledger), worst, job.tier, model, caps)
        if over:
            raise BudgetExceeded(over, worst)
        number = len(answered) + 1
        try:
            response = send(messages, tools, model, api_key, max_tokens)
        except ProviderError as exc:
            if exc.kind in MAYBE_BILLED:
                _charge(ledger, job, number, *tokens, estimated=True)
            raise
        except KeyboardInterrupt:  # la petición ya salió y pudo cobrarse
            _charge(ledger, job, number, *tokens, estimated=True)
            raise
        answered.append(response)
        _charge(ledger, job, number, response.tokens_in, response.tokens_out, False)
        return response

    return call


def jobs(
    tier: int, models: Sequence[str] = MODELS, roles: Sequence[str] = ROLES
) -> list[Job]:
    """Ejecuciones del escalón, repetición a repetición: si un tope lo detiene,
    las repeticiones ya hechas quedan completas. Sin los casos reales (`REAL_NOTE`).
    """
    spec = LLM_TIERS[tier]
    instances = [
        load_llm_instance(name, n) for name, n in spec.instances if name != "real"
    ]
    return [
        Job(tier, instance, model, role, rep, max_tokens_for(len(instance.customers)))
        for rep in range(spec.reps)
        for instance in instances
        for model in models
        for role in roles
    ]


def _solve(job: Job, api_key: str, call: Provider) -> RunRecord:
    if job.role == "llm_direct":
        record = solve_direct(
            job.instance, PROVIDER, job.model, api_key, job.max_tokens, call=call
        )
    else:
        record = solve_agent(
            job.instance,
            PROVIDER,
            job.model,
            api_key,
            job.max_tokens,
            seed=job.rep,
            output_budget=job.max_tokens,
            call=call,
        )
    params = {**record.params, "tier": job.tier, "rep": job.rep}
    return record.model_copy(update={"params": params})


def _progress(text: str) -> None:
    print(text, file=sys.stderr, flush=True)


def run_llm_tier(
    tier: int,
    api_key: str,
    models: Sequence[str] = MODELS,
    roles: Sequence[str] = ROLES,
    out_dir: Path = DEFAULT_OUT_DIR,
    ledger: Path = LEDGER_PATH,
    caps: Caps = CAPS,
) -> dict[str, list[str]]:
    """Lanza las ejecuciones pendientes del escalón y devuelve sus nombres por
    estado: `done`, `cached`, `failed` (tope o `ProviderError`) y `skipped` (no
    lanzadas porque chocarían con un tope ya alcanzado en esta pasada).

    Un `ProviderError` de `FATAL` se apunta en `failed.json` y se propaga.
    """
    status: dict[str, list[str]] = {
        "done": [],
        "cached": [],
        "failed": [],
        "skipped": [],
    }
    blocked: set[str] = set()
    plan = jobs(tier, models, roles)
    for i, job in enumerate(plan, 1):
        stem = job.stem
        path = out_dir / f"{stem}.json"
        tag = f"[{i}/{len(plan)}] {stem}"
        if path.exists():
            status["cached"].append(stem)
            continue
        hit = blocked.intersection(_cap_names(job.tier, job.model))
        if hit:
            status["skipped"].append(stem)
            _progress(f"{tag}: sin lanzar, tope alcanzado ({', '.join(sorted(hit))})")
            continue
        try:
            record = _solve(job, api_key, guarded(job, ledger, caps))
        except (BudgetExceeded, ProviderError) as exc:
            kind = exc.kind if isinstance(exc, ProviderError) else "budget"
            if isinstance(exc, BudgetExceeded):
                blocked.update(exc.caps)
            _append(
                out_dir / FAILED_NAME,
                {**_describe(job), "run": stem, "kind": kind, "message": str(exc)},
            )
            status["failed"].append(stem)
            _progress(f"{tag}: detenida ({kind}): {exc}")
            if kind in FATAL:
                raise
            continue
        write_atomic(path, record.model_dump_json(indent=2))
        status["done"].append(stem)
        _progress(f"{tag}: {record.parse_status}, {record.api_cost or 0:.4f} USD")
    return status


def _spend_lines(
    entries: list[dict[str, Any]], tier: int, models: Sequence[str], caps: Caps
) -> list[str]:
    rows = [
        ("global", _spent(entries), caps.total),
        (f"escalón {tier}", _spent(entries, tier=tier), caps.tier[tier]),
        *((f"modelo {m}", _spent(entries, model=m), caps.model[m]) for m in models),
    ]
    return [
        (
            "Gastado según el libro / tope (USD; escalón y modelo convertidos desde EUR "
            f"a {USD_PER_EUR}):"
        ),
        *(
            f"  {name:<24} {spent:7.4f} / {cap:5.2f} USD ({cap / USD_PER_EUR:5.2f} EUR)"
            for name, spent, cap in rows
        ),
    ]


def render_plan(
    tier: int,
    models: Sequence[str],
    roles: Sequence[str],
    out_dir: Path,
    ledger: Path,
    caps: Caps = CAPS,
) -> str:
    """Qué haría `run_llm_tier` y el peor caso de lo pendiente según `estimate.py`
    (escenario alto), sin llamar a nadie."""
    spec = LLM_TIERS[tier]
    plan = jobs(tier, models, roles)
    pending = [j for j in plan if not (out_dir / f"{j.stem}.json").exists()]
    sizes: dict[str, PromptSize] = {}
    worst: dict[tuple[str, str], list[float]] = {}
    for job in pending:
        if job.instance.id not in sizes:
            sizes[job.instance.id] = prompt_size(job.instance)
        calls = run_calls(
            sizes[job.instance.id], job.model, job.role, "alto", job.max_tokens
        )
        worst.setdefault((job.model, job.role), []).append(
            sum(call_cost(job.model, a, b).usd for a, b in calls)
        )
    instances = {j.instance.id: j for j in plan}.values()
    lines = [
        (
            f"Escalón {tier} ({spec.name}): {len(plan)} ejecuciones, "
            f"{len(plan) - len(pending)} ya hechas en {out_dir}, "
            f"{len(pending)} pendientes."
        ),
        "Instancias: "
        + ", ".join(
            f"{j.instance.id} ({len(j.instance.customers)} clientes, "
            f"max_tokens {j.max_tokens})"
            for j in instances
        )
        + f"; repeticiones: {spec.reps}; modelos: {', '.join(models)}; "
        f"papeles: {', '.join(roles)}.",
        (
            f"Esfuerzo {EFFORT}; el agente tiene como presupuesto de salida por "
            "ejecución el max_tokens de su instancia."
        ),
    ]
    if any(name == "real" for name, _ in spec.instances):
        lines.append(REAL_NOTE)
    total = sum(sum(v) for v in worst.values())
    lines += [
        "",
        "Peor caso de lo pendiente (escenario alto de estimate.py):",
        *(
            f"  {model:<18} {role:<10} {len(v):>3} ejec. {sum(v):8.2f} USD"
            for (model, role), v in worst.items()
        ),
        (
            f"  {'Total':<29} {len(pending):>3} ejec. {total:8.2f} USD "
            f"({total / USD_PER_EUR:.2f} EUR)"
        ),
        "",
        *_spend_lines(read_ledger(ledger), tier, models, caps),
        "",
        (
            "Cada llamada se comprueba antes de enviarla: si su peor caso no cabe "
            "en algún tope, no se hace y la ejecución queda detenida."
        ),
        "Sin --confirm no se ha hecho ninguna llamada.",
    ]
    return "\n".join(lines)


def render_summary(
    tier: int,
    status: dict[str, list[str]],
    models: Sequence[str],
    out_dir: Path,
    ledger: Path,
    caps: Caps = CAPS,
) -> str:
    """Resumen de una pasada de `run_llm_tier` y el gasto acumulado."""
    lines = [
        (
            f"Escalón {tier}: {len(status['done'])} terminadas ahora, "
            f"{len(status['cached'])} ya hechas, {len(status['failed'])} fallidas "
            f"o detenidas por tope, {len(status['skipped'])} sin lanzar por tope."
        )
    ]
    if status["failed"] or status["skipped"]:
        lines.append(
            f"Fallos en {out_dir / FAILED_NAME}; lo que falta se reintenta al "
            "volver a lanzar el escalón."
        )
    lines += ["", *_spend_lines(read_ledger(ledger), tier, models, caps)]
    return "\n".join(lines)
