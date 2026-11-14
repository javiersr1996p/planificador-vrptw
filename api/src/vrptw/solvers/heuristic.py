"""Vecino más cercano factible, portado de `greedy_heuristic_solution` (2024).

Las rutas se construyen vehículo a vehículo. Cada vehículo sale del depósito en
`depot.ready` y añade el cliente factible de menor tiempo de viaje (empate: id
menor) hasta que no queda ninguno; entonces se pasa al siguiente vehículo. Los
clientes que ninguna ruta admite quedan sin atender.
"""

from typing import Any

from vrptw.model import Instance, Solution
from vrptw.travel import feasible_stop, travel_time


def solve(
    instance: Instance,
    seed: int = 0,
    time_limit_s: float | None = None,
    **params: Any,
) -> Solution:
    remaining = {i: c for i, c in enumerate(instance.customers, start=1)}
    routes: list[list[int]] = []

    for _ in range(instance.fleet.vehicles):
        route: list[int] = []
        prev, t, load = 0, instance.depot.ready, 0.0
        while remaining:
            best: tuple[float, int] | None = None
            for node, customer in remaining.items():
                stop = feasible_stop(instance, prev, t, load, node)
                if stop is None:
                    continue
                key = (travel_time(instance, prev, node, t), customer.id)
                if best is None or key < best:
                    best = key
                    chosen, chosen_stop = node, stop
            if best is None:
                break
            customer = remaining.pop(chosen)
            route.append(customer.id)
            prev, t, load = chosen, chosen_stop.departure, load + customer.demand
        if route:
            routes.append(route)
    return Solution(routes=routes)
