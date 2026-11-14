"""Runner: método x instancia x semillas, un RunRecord por ejecución y el resumen."""

from pathlib import Path
from typing import Any

from vrptw.bench.stats import (
    EXACT,
    HIERARCHICAL,
    compare_hierarchical,
    find_bks,
    load_bks,
    mean,
    summarize_solomon_exact,
    summarize_tfe,
)
from vrptw.cli import API_DIR, run_method
from vrptw.evaluate import evaluate
from vrptw.instances.solomon import load_solomon
from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.model import Evaluation, Instance, RunRecord
from vrptw.solvers.registry import SOLVERS

# (nombre, n): n es None en las instancias de 2024
_SOLOMON6 = ("C101", "C201", "R101", "R201", "RC101", "RC201")
TIERS: dict[int, list[tuple[str, int | None]]] = {
    1: [(label, None) for label in ("10c-1", "10c-3", "20c-1", "20c-8")],
    2: [(name, 25) for name in _SOLOMON6],
    3: [(name, 50) for name in _SOLOMON6],
    4: [(name, 100) for name in ("C101", "R101", "RC101")],
}
DEFAULT_OUT_DIR = API_DIR / "runs"


def _load(name: str, n: int | None) -> Instance:
    if n is None:
        return load_tfe2024(name)
    return load_solomon(name, n, truncated=True)


def _bench_instance(
    name: str,
    n: int | None,
    method: str,
    reps: int,
    out_dir: Path,
    bks_entries: list[dict[str, Any]],
) -> dict[str, Any]:
    instance = _load(name, n)
    records: list[RunRecord] = [
        run_method(instance, method, seed) for seed in range(reps)
    ]
    for record in records:
        path = (
            out_dir
            / f"{record.instance_id}_{method}_s{record.seed}_{record.run_id}.json"
        )
        path.write_text(record.model_dump_json(indent=2), encoding="utf-8")
    evals: list[Evaluation] = [r.evaluation for r in records if r.evaluation]

    entry: dict[str, Any] = {"instance": name, "n": n, "method": method, "reps": reps}
    if n is None:
        entry["primary"] = summarize_tfe(evals)
    else:
        bks = find_bks(name, n, EXACT, bks_entries)
        entry["primary"] = summarize_solomon_exact(evals, bks)
    if n == 100:
        # las mismas rutas, sin volver a resolver, con la matriz en doble precisión
        double = load_solomon(name, n, truncated=False)
        double_evals = [
            evaluate(double, r.solution) for r in records if r.solution is not None
        ]
        bks_h = find_bks(name, n, HIERARCHICAL, bks_entries)
        entry["secondary"] = compare_hierarchical(double_evals, bks_h)
    walls = [r.wall_time_s for r in records]
    entry["timing"] = {"wall_time_mean_s": mean(walls), "wall_time_total_s": sum(walls)}
    return entry


def run_tier(
    tier: int,
    reps: int,
    methods: list[str] | None = None,
    out_dir: Path = DEFAULT_OUT_DIR,
) -> dict[str, Any]:
    """Ejecuta el escalón con las semillas 0..reps-1 y devuelve el resumen.

    Cada entrada lleva su `timing` aparte: el resto es reproducible.
    """
    methods = sorted(SOLVERS) if methods is None else methods
    out_dir.mkdir(parents=True, exist_ok=True)
    bks_entries = load_bks()
    results = [
        _bench_instance(name, n, method, reps, out_dir, bks_entries)
        for name, n in TIERS[tier]
        for method in methods
    ]
    return {"tier": tier, "reps": reps, "results": results}
