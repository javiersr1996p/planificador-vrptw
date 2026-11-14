"""Colonia de hormigas, portada de `ACO_VRPTW` (2024).

Cada hormiga construye las rutas vehículo a vehículo: desde el último nodo elige
un cliente factible con probabilidad proporcional a feromona^alpha * (1/d)^beta
y cierra la ruta cuando no queda ninguno. Los clientes que ninguna ruta admite
quedan sin atender. Tras cada iteración la feromona se evapora (`rho`) y las
`n_best` mejores hormigas depositan `q / score` en sus arcos. Se devuelve la
mejor solución encontrada.

Cambios respecto a 2024: generador local con semilla; si todos los candidatos
están a distancia 0 se elige uno al azar (el original dividía por cero; como
entonces, un candidato a distancia 0 tiene probabilidad 0 mientras haya otro);
factibilidad con `feasible_stop`, que añade capacidad y regreso al depósito
antes de su `due`.
"""

import math
import random
import time
from typing import Any

import numpy as np

from vrptw.evaluate import score
from vrptw.model import Instance, Solution
from vrptw.travel import Stop, feasible_stop

DEFAULTS: dict[str, Any] = {
    "iterations": 100,
    "ants": 50,
    "n_best": 10,
    "alpha": 1,
    "beta": 2,
    "rho": 0.05,
    "q": 1000,
}


def _construct(
    instance: Instance, weights: list[list[float]], rng: random.Random
) -> list[list[int]]:
    """Rutas de una hormiga como listas de nodos, sin las rutas vacías."""
    unvisited = list(range(1, len(instance.customers) + 1))
    routes: list[list[int]] = []
    for _ in range(instance.fleet.vehicles):
        route: list[int] = []
        prev, t, load = 0, instance.depot.ready, 0.0
        while unvisited:
            candidates: list[tuple[int, Stop]] = []
            for node in unvisited:
                stop = feasible_stop(instance, prev, t, load, node)
                if stop is not None:
                    candidates.append((node, stop))
            if not candidates:
                break
            row = [weights[prev][n] for n, _ in candidates]
            if any(row):
                node, stop = rng.choices(candidates, row)[0]
            else:
                node, stop = rng.choice(candidates)
            unvisited.remove(node)
            route.append(node)
            prev, t = node, stop.departure
            load += instance.customers[node - 1].demand
        if route:
            routes.append(route)
    return routes


def solve(
    instance: Instance,
    seed: int = 0,
    time_limit_s: float | None = None,
    **params: Any,
) -> Solution:
    if instance.matrix is None:
        raise ValueError(f"instance {instance.id} has no matrix")
    p = {**DEFAULTS, **params}
    dist = np.array(instance.matrix.distance)
    visibility = (
        np.where(dist > 0, 1.0 / np.where(dist > 0, dist, 1.0), 0.0) ** p["beta"]
    )
    pheromone = np.ones_like(dist)
    ids = [0, *(c.id for c in instance.customers)]
    rng = random.Random(seed)
    deadline = None if time_limit_s is None else time.perf_counter() + time_limit_s
    cache: dict[tuple[int, ...], float] = {}
    best_cost, best = math.inf, []

    for _ in range(p["iterations"]):
        weights = (pheromone ** p["alpha"] * visibility).tolist()
        ants: list[tuple[float, list[list[int]]]] = []
        expired = False
        for _ in range(p["ants"]):
            routes = _construct(instance, weights, rng)
            cost = score(instance, [[ids[n] for n in r] for r in routes], cache)
            ants.append((cost, routes))
            expired = deadline is not None and time.perf_counter() > deadline
            if expired:
                break
        cost, routes = min(ants, key=lambda ant: ant[0])
        if cost < best_cost:
            best_cost, best = cost, routes
        if expired:
            break
        pheromone *= 1 - p["rho"]
        for cost, routes in sorted(ants, key=lambda ant: ant[0])[: p["n_best"]]:
            for route in routes:
                for a, b in zip([0, *route], [*route, 0], strict=True):
                    pheromone[a, b] += p["q"] / cost

    return Solution(routes=[[ids[n] for n in r] for r in best])
