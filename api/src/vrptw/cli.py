"""Línea de comandos: `vrptw solve` resuelve una instancia y guarda un RunRecord en JSON."""

import argparse
import json
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


def run_method(instance: Instance, method: str, seed: int) -> RunRecord:
    """Resuelve, evalúa con `evaluate` y devuelve el RunRecord (sin escribirlo)."""
    start = time.perf_counter()
    solution = SOLVERS[method](instance, seed=seed)
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
        params={},
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
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))
