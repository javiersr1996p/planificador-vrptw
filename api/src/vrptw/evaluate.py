"""Función de coste única y validador.

Los métodos entregan solo rutas; aquí se calculan horarios, coste y factibilidad.
Las entradas mal formadas no lanzan excepción: se marcan y se evalúa lo demás.

- Identificador desconocido: violación `unknown_customer`; se salta al recorrer
  la ruta, así que no suma viaje, servicio ni demanda.
- Cliente repetido: violación `duplicate` en cada aparición tras la primera; se
  recorre cada vez que aparece (viaje, espera, retraso, servicio y demanda).
- Ruta sin clientes conocidos: no se recorre ni cuenta como vehículo.

El score se suma por rutas para que `score` y `evaluate` den el mismo número.
"""

from collections.abc import Sequence
from typing import NamedTuple

from vrptw.model import Evaluation, Instance, Solution, StopEvaluation, Violation
from vrptw.travel import Stop, next_stop, travel_time

TOLERANCE = 1e-9


class _Walk(NamedTuple):
    stops: list[tuple[int, Stop, float]]  # (customer id, stop, accumulated load)
    distance: float
    wait: float
    late: float  # customers plus depot
    load: float
    depot_arrival: float


def _distance_matrix(instance: Instance) -> list[list[float]]:
    if instance.matrix is None:
        raise ValueError(f"instance {instance.id} has no matrix")
    return instance.matrix.distance


def _positions(instance: Instance) -> dict[int, int]:
    return {c.id: i for i, c in enumerate(instance.customers, start=1)}


def _walk(
    instance: Instance,
    dist: list[list[float]],
    positions: dict[int, int],
    route: Sequence[int],
) -> _Walk:
    stops: list[tuple[int, Stop, float]] = []
    distance = wait = late = load = 0.0
    prev, t = 0, instance.depot.ready
    for cid in route:
        node = positions.get(cid)
        if node is None:
            continue
        stop = next_stop(instance, prev, t, node)
        load += instance.customers[node - 1].demand
        stops.append((cid, stop, load))
        distance += dist[prev][node]
        wait += stop.wait
        late += stop.late
        prev, t = node, stop.departure
    if not stops:
        return _Walk(stops, 0.0, 0.0, 0.0, 0.0, t)
    arrival = t + travel_time(instance, prev, 0, t)
    distance += dist[prev][0]
    if instance.depot.due is not None:
        late += max(0.0, arrival - instance.depot.due)
    return _Walk(stops, distance, wait, late, load, arrival)


def _overload(instance: Instance, load: float) -> float:
    capacity = instance.fleet.capacity
    return 0.0 if capacity is None else max(0.0, load - capacity)


def _route_cost(instance: Instance, walk: _Walk) -> float:
    if not walk.stops:
        return 0.0
    p = instance.cost_profile
    return (
        walk.distance
        + p.w_wait * walk.wait
        + p.w_late * walk.late
        + p.w_vehicle
        + p.w_overload * _overload(instance, walk.load)
    )


def _total(instance: Instance, route_costs: list[float], unserved: int) -> float:
    return sum(route_costs) + instance.cost_profile.w_unserved * unserved


def evaluate(instance: Instance, solution: Solution) -> Evaluation:
    dist = _distance_matrix(instance)
    positions = _positions(instance)
    capacity = instance.fleet.capacity
    depot_due = instance.depot.due
    walks = [_walk(instance, dist, positions, route) for route in solution.routes]

    violations: list[Violation] = []
    seen: set[int] = set()
    for r, (route, walk) in enumerate(zip(solution.routes, walks, strict=True)):
        for cid in route:
            if cid not in positions:
                violations.append(
                    Violation(type="unknown_customer", route=r, customer=cid)
                )
            elif cid in seen:
                violations.append(Violation(type="duplicate", route=r, customer=cid))
            seen.add(cid)
        for cid, stop, _ in walk.stops:
            if stop.late > TOLERANCE:
                violations.append(Violation(type="late", route=r, customer=cid))
        if capacity is not None and walk.load > capacity:
            violations.append(Violation(type="capacity", route=r))
        if (
            depot_due is not None
            and walk.stops
            and walk.depot_arrival > depot_due + TOLERANCE
        ):
            violations.append(Violation(type="depot_due", route=r))

    used = [r for r, walk in enumerate(walks) if walk.stops]
    violations += [
        Violation(type="fleet_exceeded", route=r)
        for r in used[instance.fleet.vehicles :]
    ]
    unserved = [c.id for c in instance.customers if c.id not in seen]
    violations += [Violation(type="unserved", customer=cid) for cid in unserved]

    return Evaluation(
        stops=[
            [
                StopEvaluation(
                    customer=cid,
                    arrival=s.arrival,
                    start=s.start,
                    wait=s.wait,
                    late=s.late,
                    load=load,
                )
                for cid, s, load in walk.stops
            ]
            for walk in walks
        ],
        distance=sum(walk.distance for walk in walks),
        total_wait=sum(walk.wait for walk in walks),
        total_late=sum(walk.late for walk in walks),
        vehicles_used=len(used),
        unserved=len(unserved),
        overload=sum(_overload(instance, walk.load) for walk in walks),
        score=_total(
            instance, [_route_cost(instance, walk) for walk in walks], len(unserved)
        ),
        violations=violations,
        feasible=not violations,
    )


def score(
    instance: Instance,
    routes: Sequence[Sequence[int]],
    cache: dict[tuple[int, ...], float] | None = None,
) -> float:
    """Igual que `evaluate(instance, Solution(routes=routes)).score`, sin detalle.

    `cache` guarda el coste de cada ruta ya vista; solo es válida para una misma
    instancia, porque la clave es la ruta y no incluye la instancia.
    """
    dist = _distance_matrix(instance)
    positions = _positions(instance)
    if cache is None:
        cache = {}
    costs: list[float] = []
    for route in routes:
        key = tuple(route)
        cost = cache.get(key)
        if cost is None:
            cost = _route_cost(instance, _walk(instance, dist, positions, key))
            cache[key] = cost
        costs.append(cost)
    served = {cid for route in routes for cid in route}
    unserved = sum(1 for c in instance.customers if c.id not in served)
    return _total(instance, costs, unserved)
