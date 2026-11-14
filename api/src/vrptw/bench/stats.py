"""Estadísticas de varias ejecuciones de un método sobre una instancia.

Las BKS salen de `data/solomon_bks.json`. Una BKS ausente o sin distancia numérica
(pendiente de confirmar) deja la diferencia en `None`, nunca en 0.
"""

import json
import math
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from vrptw.model import Evaluation

BKS_PATH = Path(__file__).resolve().parents[3] / "data" / "solomon_bks.json"
EXACT = "exact_truncated"
HIERARCHICAL = "hierarchical_double"


def load_bks() -> list[dict[str, Any]]:
    data: list[dict[str, Any]] = json.loads(BKS_PATH.read_text(encoding="utf-8"))
    return data


def find_bks(
    name: str, n: int, convention: str, entries: list[dict[str, Any]] | None = None
) -> dict[str, Any] | None:
    """BKS de la instancia en esa convención, o `None` si falta o está pendiente."""
    for entry in load_bks() if entries is None else entries:
        if (
            entry["instance"].upper() == name.upper()
            and entry["n"] == n
            and entry["convention"] == convention
        ):
            distance = entry.get("distance")
            numeric = isinstance(distance, int | float) and not isinstance(
                distance, bool
            )
            return entry if numeric else None
    return None


def mean(values: Sequence[float]) -> float | None:
    return math.fsum(values) / len(values) if values else None


def sample_std(values: Sequence[float]) -> float | None:
    """Desviación muestral (n - 1); `None` con menos de dos valores."""
    if len(values) < 2:
        return None
    m = math.fsum(values) / len(values)
    return math.sqrt(math.fsum((v - m) ** 2 for v in values) / (len(values) - 1))


def gap_pct(value: float | None, bks: float | None) -> float | None:
    if value is None or bks is None:
        return None
    return 100.0 * (value - bks) / bks


def summarize(
    values: Sequence[float],
    *,
    n_runs: int,
    n_feasible: int,
    metric: str,
    convention: str | None = None,
    bks: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Resumen de `values` (ya filtrados por el llamador) sobre `n_runs` ejecuciones."""
    best = min(values) if values else None
    bks_distance = None if bks is None else float(bks["distance"])
    return {
        "metric": metric,
        "convention": convention,
        "n_runs": n_runs,
        "n_values": len(values),
        "feasibility_rate": n_feasible / n_runs if n_runs else None,
        "mean": mean(values),
        "std": sample_std(values),
        "best": best,
        "bks": bks_distance,
        "bks_reference": None if bks is None else bks["reference"],
        "gap_mean_pct": gap_pct(mean(values), bks_distance),
        "gap_best_pct": gap_pct(best, bks_distance),
    }


def summarize_solomon_exact(
    evals: Sequence[Evaluation], bks: dict[str, Any] | None
) -> dict[str, Any]:
    """Principal: distancia truncada, solo de las soluciones factibles."""
    feasible = [e.distance for e in evals if e.feasible]
    return summarize(
        feasible,
        n_runs=len(evals),
        n_feasible=len(feasible),
        metric="distance",
        convention=EXACT,
        bks=bks,
    )


def summarize_tfe(evals: Sequence[Evaluation]) -> dict[str, Any]:
    """Instancias de 2024: estadísticas del `score` de todas las ejecuciones, sin BKS."""
    return summarize(
        [e.score for e in evals],
        n_runs=len(evals),
        n_feasible=sum(e.feasible for e in evals),
        metric="score",
    )


def compare_hierarchical(
    evals: Sequence[Evaluation], bks: dict[str, Any] | None
) -> dict[str, Any]:
    """Secundaria: las mismas rutas en doble precisión frente a la BKS de SINTEF.

    El porcentaje solo se calcula en las ejecuciones factibles con el mismo número
    de vehículos que la BKS.
    """
    bks_vehicles = None if bks is None else bks["vehicles"]
    bks_distance = None if bks is None else float(bks["distance"])
    runs = [
        {
            "vehicles": e.vehicles_used,
            "distance": e.distance,
            "feasible": e.feasible,
            "gap_pct": (
                gap_pct(e.distance, bks_distance)
                if e.feasible and e.vehicles_used == bks_vehicles
                else None
            ),
        }
        for e in evals
    ]
    gaps = [r["gap_pct"] for r in runs if r["gap_pct"] is not None]
    return {
        "convention": HIERARCHICAL,
        "bks_vehicles": bks_vehicles,
        "bks_distance": bks_distance,
        "bks_reference": None if bks is None else bks["reference"],
        "feasibility_rate": sum(e.feasible for e in evals) / len(evals),
        "runs": runs,
        "gap_mean_pct": mean(gaps),
        "gap_best_pct": min(gaps) if gaps else None,
    }
