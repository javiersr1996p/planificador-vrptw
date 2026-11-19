"""Línea de comandos: `vrptw solve` resuelve una instancia y guarda un RunRecord en JSON."""

import argparse
import json
import os
import platform
import subprocess
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

from vrptw.evaluate import evaluate
from vrptw.instances.solomon import SOLOMON_SIZES, load_solomon
from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.model import Instance, RunRecord
from vrptw.solvers.registry import SOLVERS

API_DIR = Path(__file__).resolve().parents[2]
TFE_PREFIX = "tfe2024-"


def _load(name: str, n: int) -> Instance:
    if name.lower().startswith(TFE_PREFIX):
        return load_tfe2024(name[len(TFE_PREFIX) :])
    return load_solomon(name, n, truncated=True)


def _git_sha() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=API_DIR,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return "unknown"
    return result.stdout.strip() if result.returncode == 0 else "unknown"


def run_method(
    instance: Instance, method: str, seed: int, time_limit_s: float | None = None
) -> RunRecord:
    """Resuelve, evalúa con `evaluate` y devuelve el RunRecord (sin escribirlo).

    Con `time_limit_s` el solver recibe ese plazo y el registro lo guarda en
    `params`; sin él, `params` queda vacío.
    """
    limit = {} if time_limit_s is None else {"time_limit_s": time_limit_s}
    start = time.perf_counter()
    solution = SOLVERS[method](instance, seed=seed, **limit)
    wall_time = time.perf_counter() - start
    return RunRecord(
        run_id=uuid.uuid4().hex,
        date=datetime.now(UTC),
        git_sha=_git_sha(),
        hardware=platform.platform(),
        instance_id=instance.id,
        instance_hash=instance.content_hash(),
        method=method,
        role="classic",
        seed=seed,
        params=limit,
        wall_time_s=wall_time,
        solution=solution,
        evaluation=evaluate(instance, solution),
        parse_status="ok",
    )


def _solve(args: argparse.Namespace) -> int:
    if args.method not in SOLVERS:
        print(
            f"error: método desconocido {args.method!r}: use uno de {sorted(SOLVERS)}",
            file=sys.stderr,
        )
        return 1
    try:
        instance = _load(args.instance, args.n)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    record = run_method(instance, args.method, args.seed)
    evaluation = record.evaluation
    assert evaluation is not None
    out = Path(args.out) if args.out else API_DIR / "runs" / f"{record.run_id}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(record.model_dump_json(indent=2), encoding="utf-8")

    print(f"instancia: {instance.id}")
    print(f"método: {args.method}")
    print(f"score: {evaluation.score:.2f}")
    print(f"distancia: {evaluation.distance:.2f}")
    print(f"vehículos usados: {evaluation.vehicles_used}")
    print(f"clientes no atendidos: {evaluation.unserved}")
    print(f"factible: {'sí' if evaluation.feasible else 'no'}")
    print(f"registro: {out}")
    return 0


def _bench_classic(args: argparse.Namespace) -> int:
    if args.reps < 1:
        print("error: --reps debe ser al menos 1", file=sys.stderr)
        return 1
    from vrptw.bench.run import run_tier  # import tardío: bench.run importa este módulo

    methods = args.methods or sorted(SOLVERS)
    unknown = [m for m in methods if m not in SOLVERS]
    if unknown:
        print(
            f"error: método desconocido {unknown[0]!r}: use uno de {sorted(SOLVERS)}",
            file=sys.stderr,
        )
        return 1
    out_dir = Path(args.out_dir) if args.out_dir else API_DIR / "runs"
    summary = run_tier(args.tier, args.reps, methods, out_dir)
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    print(f"registros: {out_dir}", file=sys.stderr)
    return 0


def _bench_estimate(args: argparse.Namespace) -> int:
    if args.max_tokens is not None and args.max_tokens < 1:
        print("error: --max-tokens debe ser al menos 1", file=sys.stderr)
        return 1
    from vrptw.bench.estimate import estimate, render  # import tardío, como bench.run

    print(render(estimate(args.max_tokens), args.max_tokens))
    return 0


def _bench_llm(args: argparse.Namespace) -> int:
    from vrptw.bench import llm_run  # import tardío, como bench.run
    from vrptw.bench.estimate import LLM_TIERS, MODELS, ROLES
    from vrptw.llm.agent import MAX_TOOL_TIME_S, MIN_CALL_TOKENS
    from vrptw.llm.providers import MAX_NONSTREAMING_TOKENS, ProviderError

    models = args.models or list(MODELS)
    roles = args.roles or list(ROLES)
    for kind, values, valid in (("modelo", models, MODELS), ("papel", roles, ROLES)):
        unknown = [v for v in values if v not in valid]
        if unknown:
            print(
                f"error: {kind} desconocido {unknown[0]!r}: use uno de {list(valid)}",
                file=sys.stderr,
            )
            return 1
    if args.max_tokens is not None and not (
        MIN_CALL_TOKENS <= args.max_tokens <= MAX_NONSTREAMING_TOKENS
    ):
        print(
            f"error: --max-tokens debe estar entre {MIN_CALL_TOKENS} (mínimo por "
            f"llamada del agente) y {MAX_NONSTREAMING_TOKENS} (máximo sin streaming)",
            file=sys.stderr,
        )
        return 1
    if args.reps is not None and args.reps < 1:
        print("error: --reps debe ser al menos 1", file=sys.stderr)
        return 1
    # los casos reales no se ejecutan (llm_run.REAL_NOTE)
    labels = [name for name, _ in LLM_TIERS[args.tier].instances if name != "real"]
    unknown = [i for i in args.instances or [] if i not in labels]
    if unknown:
        print(
            f"error: instancia {unknown[0]!r} fuera del escalón {args.tier}: use una "
            f"de {labels}",
            file=sys.stderr,
        )
        return 1
    out_dir = Path(args.out_dir) if args.out_dir else llm_run.DEFAULT_OUT_DIR
    ledger = llm_run.LEDGER_PATH
    tool_time = None if args.no_tool_time_limit else MAX_TOOL_TIME_S
    if not args.confirm:
        print(
            llm_run.render_plan(
                args.tier,
                models,
                roles,
                out_dir,
                ledger,
                instances=args.instances,
                reps=args.reps,
                max_tokens=args.max_tokens,
                max_tool_time_s=tool_time,
            )
        )
        return 0
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print(
            "error: falta la variable de entorno ANTHROPIC_API_KEY; por ejemplo: "
            "uv run --env-file .env vrptw bench llm --tier N --confirm",
            file=sys.stderr,
        )
        return 1
    try:
        status = llm_run.run_llm_tier(
            args.tier,
            api_key,
            models,
            roles,
            out_dir,
            ledger,
            instances=args.instances,
            reps=args.reps,
            max_tokens=args.max_tokens,
            max_tool_time_s=tool_time,
        )
    except ProviderError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(llm_run.render_summary(args.tier, status, models, out_dir, ledger))
    return 0


def _bench_export(args: argparse.Namespace) -> int:
    from vrptw.bench.export import DEFAULT_OUT, export  # import tardío, como bench.run

    out = Path(args.out) if args.out else DEFAULT_OUT
    for path in export(out):
        print(path)
    return 0


def _openapi(args: argparse.Namespace) -> int:
    from vrptw.api.main import app  # import tardío: no cargar FastAPI en los demás

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False)
    out.write_bytes((text + "\n").encode("utf-8"))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="vrptw", description="Planificador VRPTW")
    sub = parser.add_subparsers(dest="command", required=True)
    solve = sub.add_parser("solve", help="resuelve una instancia y guarda el registro")
    solve.add_argument(
        "--instance",
        required=True,
        help="nombre de Solomon (C101, ...) o tfe2024-<etiqueta> (tfe2024-10c-1)",
    )
    solve.add_argument(
        "--n",
        type=int,
        default=100,
        choices=SOLOMON_SIZES,
        help="clientes de Solomon: 25, 50 o 100 (por defecto 100)",
    )
    solve.add_argument(
        "--method", required=True, help=f"método: {', '.join(sorted(SOLVERS))}"
    )
    solve.add_argument("--seed", type=int, default=0, help="semilla (por defecto 0)")
    solve.add_argument(
        "--out", help="ruta del JSON de salida (por defecto api/runs/<run_id>.json)"
    )
    solve.set_defaults(func=_solve)

    bench = sub.add_parser("bench", help="benchmarks").add_subparsers(
        dest="bench_command", required=True
    )
    classic = bench.add_parser(
        "classic", help="métodos clásicos sobre un escalón, con resumen en JSON"
    )
    classic.add_argument("--tier", type=int, required=True, choices=(1, 2, 3, 4))
    classic.add_argument("--reps", type=int, required=True, help="semillas 0..reps-1")
    classic.add_argument("--methods", nargs="+", help="por defecto, todos los métodos")
    classic.add_argument(
        "--out-dir", help="directorio de los RunRecord (por defecto api/runs/)"
    )
    classic.set_defaults(func=_bench_classic)
    estimate = bench.add_parser(
        "estimate", help="coste estimado del benchmark LLM, sin llamadas a la API"
    )
    estimate.add_argument(
        "--max-tokens",
        type=int,
        help="mismo max_tokens en todas las llamadas (por defecto, el propuesto)",
    )
    estimate.set_defaults(func=_bench_estimate)
    llm = bench.add_parser(
        "llm",
        help="benchmark LLM de un escalón, con topes de gasto (sin --confirm, "
        "solo el plan)",
    )
    llm.add_argument("--tier", type=int, required=True, choices=(0, 1, 2, 3, 4))
    llm.add_argument("--models", nargs="+", help="por defecto, los tres modelos")
    llm.add_argument("--roles", nargs="+", help="llm_direct, llm_agent (por defecto)")
    llm.add_argument(
        "--instances",
        nargs="+",
        help="etiquetas del escalón (10c-1, C101...); por defecto, todas",
    )
    llm.add_argument(
        "--reps", type=int, help="repeticiones (por defecto, las del escalón)"
    )
    llm.add_argument(
        "--max-tokens",
        type=int,
        help="max_tokens de todas las llamadas y presupuesto de salida del agente "
        "(por defecto, el propuesto por tamaño)",
    )
    llm.add_argument(
        "--no-tool-time-limit",
        action="store_true",
        help="el agente ejecuta los métodos clásicos sin corte por tiempo (todas sus "
        "iteraciones); por defecto, con un tope por llamada",
    )
    llm.add_argument(
        "--confirm",
        action="store_true",
        help="ejecuta de verdad (clave en ANTHROPIC_API_KEY); sin él, solo el plan",
    )
    llm.add_argument(
        "--out-dir", help="directorio de los RunRecord (por defecto api/runs/llm/)"
    )
    llm.set_defaults(func=_bench_llm)
    export = bench.add_parser(
        "export",
        help="exporta los casos de ejemplo de la web (sin red ni llamadas de pago)",
    )
    export.add_argument(
        "--out", help="directorio de salida (por defecto web/public/data)"
    )
    export.set_defaults(func=_bench_export)
    openapi = sub.add_parser(
        "openapi", help="escribe el esquema OpenAPI de la API sin arrancar el servidor"
    )
    openapi.add_argument("--out", required=True, help="ruta del JSON de salida")
    openapi.set_defaults(func=_openapi)
    return parser


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    return int(args.func(args))
