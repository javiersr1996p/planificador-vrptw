"""Regresión estadística del modo `legado` de ACO, GA y tabú contra 2024.

En 2024 no había semilla, así que no se puede comparar ejecución a ejecución:
se compara la distribución de costes del port con las 30 ejecuciones publicadas
de cada instancia (tests/data/tfe2024_reference.json).

Criterio:

- Por instancia, prueba de permutación sobre el estadístico D de
  Kolmogorov-Smirnov, con 10 000 permutaciones y semilla fija. Los costes se
  redondean al céntimo en ambos lados: los xlsx de ACO y GA ya lo están y sin
  redondear no habría empates (en ACO 10c-3 las 30 referencias son iguales).
- Un método pasa si ninguna de las 12 instancias tiene p < 0.05/12 y como mucho
  2 tienen p < 0.05.
- Anclas exactas por método y control negativo: la misma prueba debe rechazar
  (p < 0.05/12) el tabú y el GA actuales.

Las muestras de ACO y GA cuestan minutos y llevan además el marcador `lento`,
que `uv run pytest` excluye por defecto (`addopts` en pyproject.toml). Como la
opción `-m` de la línea de comandos sustituye a la de `addopts`,
`uv run pytest -m legado` ejecuta la regresión completa. El tabú `legado` tarda
segundos y se ejecuta siempre.

Cada muestra se calcula una vez por sesión (`_samples` memoiza) y las lentas se
reparten entre procesos: el GA usa el generador global bajo un cerrojo, así que
los hilos no lo aceleran.

El control usa 10 semillas. Con 30 referencias y 10 ejecuciones la prueba
rechaza al nivel 0.05/12 a partir de D de alrededor de 0.65, y los métodos
actuales dan D = 1 (ninguna ejecución actual cae dentro del rango de
costes de 2024), así que más semillas solo añadirían tiempo.
"""

import json
from concurrent.futures import ProcessPoolExecutor
from functools import cache
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from vrptw.evaluate import evaluate, score
from vrptw.instances.tfe2024 import TFE2024_USED, load_tfe2024
from vrptw.model import Instance
from vrptw.solvers import aco, ga, tabu

pytestmark = pytest.mark.legado
lento = pytest.mark.lento

REFERENCE = Path(__file__).parent / "data" / "tfe2024_reference.json"
PUBLISHED = json.loads(REFERENCE.read_text(encoding="utf-8"))["costs"]

PERMUTATIONS = 10_000
ALPHA = 0.05
BONFERRONI = ALPHA / len(TFE2024_USED)
MAX_BELOW_ALPHA = 2
LABELS_20 = tuple(label for label in TFE2024_USED if label.startswith("20c"))

SOLVERS = {"aco": aco.solve, "ga": ga.solve, "tabu": tabu.solve}
# muestra: (método, parámetros, número de semillas, instancias)
SAMPLES: dict[str, tuple[str, dict[str, Any], int, tuple[str, ...]]] = {
    "aco": ("aco", {}, 30, TFE2024_USED),
    "ga": ("ga", {"legacy": True}, 30, TFE2024_USED),
    "tabu": ("tabu", {"iterations": 0}, 1000, TFE2024_USED),
    "tabu_actual": ("tabu", {}, 10, TFE2024_USED),
    "ga_actual": ("ga", {}, 10, LABELS_20),
}

Run = tuple[float, int, int]  # coste al céntimo, vehículos usados, no atendidos


@cache
def _instance(label: str) -> Instance:
    return load_tfe2024(label)


def _run(job: tuple[str, str, int]) -> Run:
    sample, label, seed = job
    method, params, _, _ = SAMPLES[sample]
    instance = _instance(label)
    solution = SOLVERS[method](instance, seed, **params)
    evaluation = evaluate(instance, solution)
    cost = round(score(instance, solution.routes), 2)
    return cost, evaluation.vehicles_used, evaluation.unserved


@cache
def _samples(sample: str) -> dict[str, list[Run]]:
    """Ejecuciones de una muestra por instancia, con semillas 0, 1, 2..."""
    _, _, seeds, labels = SAMPLES[sample]
    jobs = [(sample, label, seed) for label in labels for seed in range(seeds)]
    if sample == "tabu":  # microsegundos por ejecución: no compensa otro proceso
        runs = [_run(job) for job in jobs]
    else:
        with ProcessPoolExecutor() as pool:
            runs = list(pool.map(_run, jobs, chunksize=4))
    return {label: runs[i * seeds : (i + 1) * seeds] for i, label in enumerate(labels)}


def _ks_permutation_p(reference: list[float], sample: list[float]) -> float:
    """p-valor de permutación del estadístico D de Kolmogorov-Smirnov.

    Los costes se sustituyen por su posición entre los valores distintos, así
    los empates caen en el mismo escalón de las dos funciones de distribución.
    """
    pooled = np.round(np.array([*reference, *sample]), 2)
    codes = np.unique(pooled, return_inverse=True)[1]
    n, m, k = len(reference), len(sample), int(codes.max()) + 1
    total = np.cumsum(np.bincount(codes, minlength=k))

    def statistic(first: np.ndarray) -> np.ndarray:
        """D de cada fila; una fila son los códigos del primer grupo."""
        rows = len(first)
        flat = (np.arange(rows)[:, None] * k + first).ravel()
        cum = np.cumsum(np.bincount(flat, minlength=rows * k).reshape(rows, k), axis=1)
        return np.abs(cum / n - (total - cum) / m).max(axis=1)

    observed = statistic(codes[None, :n])[0]
    rng = np.random.default_rng(0)
    extreme = 0
    for _ in range(10):  # por bloques, para no guardar todas las permutaciones
        block = np.tile(codes, (PERMUTATIONS // 10, 1))
        shuffled = rng.permuted(block, axis=1)[:, :n]
        extreme += np.count_nonzero(statistic(shuffled) >= observed - 1e-12)
    return (1 + extreme) / (1 + PERMUTATIONS)


def _p_values(sample: str) -> dict[str, float]:
    method = SAMPLES[sample][0]
    p_values = {
        label: _ks_permutation_p(PUBLISHED[method][label], [run[0] for run in runs])
        for label, runs in _samples(sample).items()
    }
    for label, p in p_values.items():  # visible con `pytest -rP`
        print(f"{sample} {label}: p = {p:.4f}")
    return p_values


@pytest.mark.parametrize(
    "sample",
    [pytest.param("aco", marks=lento), pytest.param("ga", marks=lento), "tabu"],
)
def test_distribution_matches_2024(sample: str) -> None:
    p_values = _p_values(sample)
    rejected = {label: p for label, p in p_values.items() if p < BONFERRONI}
    below_alpha = {label: p for label, p in p_values.items() if p < ALPHA}
    assert not rejected, f"p < 0.05/12: {rejected}"
    assert len(below_alpha) <= MAX_BELOW_ALPHA, f"p < 0.05: {below_alpha}"


@lento
@pytest.mark.parametrize("label", ["10c-1", "10c-3", "10c-8", "10c-9", "20c-9"])
def test_aco_best_matches_published_best(label: str) -> None:
    best = min(cost for cost, _, _ in _samples("aco")[label])
    assert best == round(min(PUBLISHED["aco"][label]), 2)


@lento
@pytest.mark.parametrize("label", TFE2024_USED)
def test_ga_uses_five_vehicles_and_serves_everyone(label: str) -> None:
    assert {run[1:] for run in _samples("ga")[label]} == {(5, 0)}


@pytest.mark.parametrize("label", TFE2024_USED)
def test_tabu_uses_whole_fleet_and_serves_everyone(label: str) -> None:
    fleet = _instance(label).fleet.vehicles
    assert {run[1:] for run in _samples("tabu")[label]} == {(fleet, 0)}


@lento
@pytest.mark.parametrize(
    ("sample", "min_rejected"), [("tabu_actual", 10), ("ga_actual", 5)]
)
def test_negative_control_is_rejected(sample: str, min_rejected: int) -> None:
    p_values = _p_values(sample)
    rejected = [label for label, p in p_values.items() if p < BONFERRONI]
    assert len(rejected) >= min_rejected, p_values
