"""Tiempo de viaje con perfil horario y recurrencia de una parada.

Los nodos son posiciones de la matriz: 0 es el depósito e i es `customers[i - 1]`.
"""

from typing import NamedTuple

from vrptw.model import Instance, TrafficWindow


class Stop(NamedTuple):
    arrival: float
    start: float
    wait: float
    late: float
    departure: float


def traffic_factor(profile: list[TrafficWindow] | None, t: float) -> float:
    """Factor de la franja [from, to) que contiene `t`.

    Fuera de toda franja, o sin perfil, vale 1. Si las franjas se solapan, gana
    la primera de la lista.
    """
    for window in profile or ():
        if window.from_ <= t < window.to:
            return window.factor
    return 1.0


def travel_time(instance: Instance, i: int, j: int, depart: float) -> float:
    """Tiempo de i a j saliendo en `depart`, con el factor de esa franja."""
    if instance.matrix is None:
        raise ValueError(f"instance {instance.id} has no matrix")
    factor = traffic_factor(instance.traffic_profile, depart)
    return instance.matrix.time[i][j] * factor


def next_stop(instance: Instance, prev: int, depart: float, node: int) -> Stop:
    """Sale de `prev` en `depart`, llega a `node`, espera hasta `ready` y sirve."""
    customer = instance.customers[node - 1]
    arrival = depart + travel_time(instance, prev, node, depart)
    start = max(arrival, customer.ready)
    return Stop(
        arrival=arrival,
        start=start,
        wait=start - arrival,
        late=max(0.0, start - customer.due),
        departure=start + customer.service,
    )


def feasible_stop(
    instance: Instance, prev: int, depart: float, load: float, node: int
) -> Stop | None:
    """Parada en `node` si se puede añadir al construir una ruta; si no, None.

    Regla compartida por los constructores: la llegada no supera `due`, la carga
    no supera la capacidad y se puede volver al depósito antes de su `due`.
    """
    customer = instance.customers[node - 1]
    capacity = instance.fleet.capacity
    if capacity is not None and load + customer.demand > capacity:
        return None
    stop = next_stop(instance, prev, depart, node)
    if stop.arrival > customer.due:
        return None
    depot_due = instance.depot.due
    if (
        depot_due is not None
        and stop.departure + travel_time(instance, node, 0, stop.departure) > depot_due
    ):
        return None
    return stop
