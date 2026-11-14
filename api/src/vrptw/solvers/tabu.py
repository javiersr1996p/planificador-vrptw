"""Búsqueda tabú, portada de `tabu_search` (TabuSearch.ipynb, 2024) y corregida.

La solución inicial es `generate_initial_solution` tal cual: una permutación
aleatoria de los clientes se reparte en turno rotatorio entre todos los vehículos
y cada ruta se ordena por vecino más cercano desde el depósito, sin mirar
ventanas ni capacidad. Con `iterations=0` se devuelve esa solución (modo legado).

Correcciones frente a 2024:
- El vecindario se genera desde la solución actual, que pasa a ser el mejor
  vecino no tabú aunque empeore; la mejor global se guarda aparte.
- Al intercambio entre rutas y la recolocación dentro de una ruta se añade la
  recolocación de un cliente en otra ruta, que puede vaciar o estrenar un vehículo.
- Sin `validate_solution` ni `calculate_solution_cost`: cada vecino se puntúa
  con `evaluate.score`.

La lista tabú guarda las últimas `tabu_size` soluciones completas, como en 2024.
"""

import math
import random
import time
from collections import deque
from collections.abc import Iterator
from typing import Any

from vrptw.evaluate import score
from vrptw.model import Instance, Solution

Routes = tuple[tuple[int, ...], ...]


def _initial(instance: Instance, rng: random.Random) -> Routes:
    """`generate_initial_solution`: reparto rotatorio y vecino más cercano."""
    if instance.matrix is None:
        raise ValueError(f"instance {instance.id} has no matrix")
    dist = instance.matrix.distance
    vehicles = instance.fleet.vehicles
    nodes = list(range(1, len(instance.customers) + 1))
    rng.shuffle(nodes)
    buckets: list[list[int]] = [[] for _ in range(vehicles)]
    for i, node in enumerate(nodes):
        buckets[i % vehicles].append(node)
    routes = []
    for bucket in buckets:
        current = 0
        ordered: list[int] = []
        while bucket:
            # como `min` del original: en empate gana el primero de la lista
            current = min(bucket, key=dist[current].__getitem__)
            ordered.append(current)
            bucket.remove(current)
        routes.append(tuple(instance.customers[node - 1].id for node in ordered))
    return tuple(routes)


def _neighbors(routes: Routes) -> Iterator[list[tuple[int, ...]]]:
    """Intercambio entre rutas, recolocación dentro de una ruta y entre rutas.

    Los dos primeros siguen el orden de `generate_neighborhood`.
    """
    n = len(routes)
    for i in range(n):
        for j in range(i + 1, n):
            ri, rj = routes[i], routes[j]
            for k, a in enumerate(ri):
                for p, b in enumerate(rj):
                    new = list(routes)
                    new[i] = (*ri[:k], b, *ri[k + 1 :])
                    new[j] = (*rj[:p], a, *rj[p + 1 :])
                    yield new
    for i, r in enumerate(routes):
        for k, a in enumerate(r):
            rest = r[:k] + r[k + 1 :]
            for p in range(len(r)):
                if p != k:
                    new = list(routes)
                    new[i] = (*rest[:p], a, *rest[p:])
                    yield new
    for i, ri in enumerate(routes):
        for k, a in enumerate(ri):
            rest = ri[:k] + ri[k + 1 :]
            for j, rj in enumerate(routes):
                if j == i:
                    continue
                for p in range(len(rj) + 1):
                    new = list(routes)
                    new[i] = rest
                    new[j] = (*rj[:p], a, *rj[p:])
                    yield new


def solve(
    instance: Instance,
    seed: int = 0,
    time_limit_s: float | None = None,
    **params: Any,
) -> Solution:
    iterations = int(params.get("iterations", 100))
    tabu_size = int(params.get("tabu_size", 50))
    if instance.fleet.vehicles < 1:
        return Solution(routes=[])
    deadline = None if time_limit_s is None else time.perf_counter() + time_limit_s
    cache: dict[tuple[int, ...], float] = {}
    current = best = _initial(instance, random.Random(seed))
    best_cost = score(instance, best, cache)
    tabu: deque[Routes] = deque(maxlen=tabu_size)

    for _ in range(iterations):
        chosen: Routes | None = None
        chosen_cost = math.inf
        for neighbor in _neighbors(current):
            if deadline is not None and time.perf_counter() > deadline:
                return Solution(routes=[list(r) for r in best if r])
            cost = score(instance, neighbor, cache)
            if cost < chosen_cost and (candidate := tuple(neighbor)) not in tabu:
                chosen, chosen_cost = candidate, cost
        if chosen is None:
            break
        current = chosen
        tabu.append(current)
        if chosen_cost < best_cost:
            best, best_cost = current, chosen_cost

    return Solution(routes=[list(r) for r in best if r])
