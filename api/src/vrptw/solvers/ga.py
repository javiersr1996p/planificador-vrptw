"""Algoritmo genético con DEAP, portado de GA.ipynb (2024) y actualizado.

El individuo es una lista de rutas de `customer.id`. El bucle equivale a
`eaSimple` (torneo de 3 y `varAnd`, mismo orden de llamadas al generador). Si se
agota `time_limit_s`, se deja de crear la población inicial (siempre hay al menos
un individuo) o se descarta la generación en curso antes del siguiente cruce, y
se devuelve el mejor individuo evaluado. La aptitud es `score`, o infinito si
algún cliente aparece dos veces. La mutación es la de 2024 tal cual.

Modo actual (por defecto), siempre con `fleet.vehicles` rutas (vacías o no):

- Inicialización: permutación aleatoria de clientes; cada uno se añade al final
  de la primera ruta no vacía que lo admite según `feasible_stop` o, si no, de
  una ruta vacía. Si no cabe en ninguna, se inserta en la posición que menos
  sube el score (con retraso o exceso de carga, como atendía el GA de 2024), y
  solo queda sin atender si eso sale más caro que no atenderlo.
- Cruce: un único corte común a los dos padres, así no crece el número de rutas.
- Reparación: quita las repeticiones (se queda la primera aparición) y reinserta
  los clientes que faltan con la regla de la inicialización.

Con `legacy=True` se reproducen las piezas de 2024: reparto en módulo 5 fijo
(como en 2024, supone al menos 5 vehículos si hay más clientes que vehículos),
cruce con dos cortes independientes y `correct_duplicates`, que solo actúa si
faltan clientes, cambia uno al azar por ruta y no quita repeticiones.

DEAP usa el generador global `random`; cada ejecución lo siembra con `seed` y se
hace bajo un cerrojo, así que las ejecuciones simultáneas se serializan.
"""

import math
import random
import threading
import time
from typing import Any

from deap import algorithms, base, creator, tools

from vrptw.evaluate import score
from vrptw.model import Instance, Solution
from vrptw.travel import feasible_stop, next_stop

creator.create("GaFitness", base.Fitness, weights=(-1.0,))
creator.create("GaIndividual", list, fitness=creator.GaFitness)

_LOCK = threading.Lock()


class _Expired(Exception):
    """Se agotó el plazo a mitad de una generación."""


def _end(
    instance: Instance, nodes: dict[int, int], route: list[int]
) -> tuple[int, float, float]:
    """Último nodo, hora de salida y carga al final de la ruta."""
    prev, t, load = 0, instance.depot.ready, 0.0
    for cid in route:
        node = nodes[cid]
        t = next_stop(instance, prev, t, node).departure
        prev, load = node, load + instance.customers[node - 1].demand
    return prev, t, load


def _cheapest(
    instance: Instance,
    cache: dict[tuple[int, ...], float],
    routes: list[list[int]],
    cid: int,
) -> tuple[int, int] | None:
    """Ruta y posición donde insertar `cid` sube menos el score, o None.

    Puntuada sola, la ruta con `cid` cuenta un no atendido menos que sin él, así
    que la diferencia es la del score total frente a dejarlo sin atender: si no
    es negativa, o no hay rutas, devuelve None.
    """
    best: tuple[float, int, int] | None = None
    tried_empty = False
    for r, route in enumerate(routes):
        if not route:
            if tried_empty:
                continue
            tried_empty = True
        base = score(instance, [route], cache)
        for k in range(len(route) + 1):
            delta = score(instance, [route[:k] + [cid] + route[k:]], cache) - base
            if best is None or delta < best[0]:
                best = (delta, r, k)
    if best is None or best[0] >= 0:
        return None
    return best[1], best[2]


def _insert(
    instance: Instance,
    nodes: dict[int, int],
    cache: dict[tuple[int, ...], float],
    routes: list[list[int]],
    customers: list[int],
) -> None:
    """Añade cada cliente al final de la primera ruta que lo admite o, si no
    cabe en ninguna, donde menos sube el score."""
    ends = [_end(instance, nodes, route) for route in routes]
    for cid in customers:
        node = nodes[cid]
        for r in sorted(range(len(routes)), key=lambda i: not routes[i]):
            prev, t, load = ends[r]
            stop = feasible_stop(instance, prev, t, load, node)
            if stop is not None:
                routes[r].append(cid)
                demand = instance.customers[node - 1].demand
                ends[r] = (node, stop.departure, load + demand)
                break
        else:
            slot = _cheapest(instance, cache, routes, cid)
            if slot is not None:
                r, k = slot
                routes[r].insert(k, cid)
                ends[r] = _end(instance, nodes, routes[r])


def _individual(
    instance: Instance,
    nodes: dict[int, int],
    cache: dict[tuple[int, ...], float],
    legacy: bool,
) -> Any:
    customers = list(nodes)
    random.shuffle(customers)
    routes: list[list[int]] = [[] for _ in range(instance.fleet.vehicles)]
    if legacy:
        for i, customer in enumerate(customers):
            routes[i % 5].append(customer)
    else:
        _insert(instance, nodes, cache, routes, customers)
    return creator.GaIndividual(routes)


def _repair(
    instance: Instance,
    nodes: dict[int, int],
    cache: dict[tuple[int, ...], float],
    legacy: bool,
    routes: list[list[int]],
) -> list[list[int]]:
    if legacy:
        all_customers = set(nodes)
        flat = [cid for route in routes for cid in route]
        if len(set(flat)) < len(all_customers):
            missing = list(all_customers - set(flat))
            for route in routes:
                if len(route) > 0 and missing:
                    route.remove(random.choice(route))
                    route.append(missing.pop())
        return routes
    seen: set[int] = set()
    for route in routes:
        kept = []
        for cid in route:
            if cid not in seen:
                seen.add(cid)
                kept.append(cid)
        route[:] = kept
    _insert(instance, nodes, cache, routes, [cid for cid in nodes if cid not in seen])
    return routes


def _crossover(
    instance: Instance,
    nodes: dict[int, int],
    cache: dict[tuple[int, ...], float],
    legacy: bool,
    deadline: float,
    ind1: Any,
    ind2: Any,
) -> tuple[Any, Any]:
    if time.perf_counter() > deadline:
        raise _Expired
    if legacy:
        split1 = random.randint(1, len(ind1) - 1)
        split2 = random.randint(1, len(ind2) - 1)
        child1 = ind1[:split1] + ind2[split2:]
        child2 = ind2[:split2] + ind1[split1:]
    elif len(ind1) < 2:
        return ind1, ind2
    else:
        cut = random.randint(1, len(ind1) - 1)
        child1 = ind1[:cut] + ind2[cut:]
        child2 = ind2[:cut] + ind1[cut:]
    child1 = _repair(instance, nodes, cache, legacy, child1)
    child2 = _repair(instance, nodes, cache, legacy, child2)
    return creator.GaIndividual(child1), creator.GaIndividual(child2)


def _mutate(individual: Any) -> tuple[Any]:
    if len(individual) > 1:
        vehicle1, vehicle2 = random.sample(range(len(individual)), 2)
        if len(individual[vehicle1]) > 0 and len(individual[vehicle2]) > 0:
            cust1 = random.choice(individual[vehicle1])
            cust2 = random.choice(individual[vehicle2])
            individual[vehicle1].remove(cust1)
            individual[vehicle2].remove(cust2)
            individual[vehicle1].append(cust2)
            individual[vehicle2].append(cust1)
    return (individual,)


def _fitness(
    instance: Instance, cache: dict[tuple[int, ...], float], individual: Any
) -> tuple[float]:
    flat = [cid for route in individual for cid in route]
    if len(flat) != len(set(flat)):
        return (math.inf,)
    return (score(instance, individual, cache),)


def solve(
    instance: Instance,
    seed: int = 0,
    time_limit_s: float | None = None,
    **params: Any,
) -> Solution:
    size = params.get("population", 100)
    cxpb = params.get("cxpb", 0.7)
    mutpb = params.get("mutpb", 0.01)
    generations = params.get("generations", 100)
    legacy = params.get("legacy", False)
    nodes = {c.id: i for i, c in enumerate(instance.customers, start=1)}
    cache: dict[tuple[int, ...], float] = {}

    toolbox = base.Toolbox()
    toolbox.register("mutate", _mutate)

    with _LOCK:
        deadline = (
            math.inf if time_limit_s is None else time.perf_counter() + time_limit_s
        )
        toolbox.register("mate", _crossover, instance, nodes, cache, legacy, deadline)
        random.seed(seed)
        population: list[Any] = []
        for _ in range(size):
            if population and time.perf_counter() > deadline:
                break
            population.append(_individual(instance, nodes, cache, legacy))
        best = tools.HallOfFame(1)
        for generation in range(generations + 1):
            if generation:
                if time.perf_counter() > deadline:
                    break
                offspring = tools.selTournament(population, len(population), 3)
                try:
                    population = algorithms.varAnd(offspring, toolbox, cxpb, mutpb)
                except _Expired:
                    break
            for individual in population:
                if not individual.fitness.valid:
                    individual.fitness.values = _fitness(instance, cache, individual)
            best.update(population)
    return Solution(routes=[list(route) for route in best[0] if route])
