"""Camuflaje de las instancias de Solomon que recibe el LLM.

Un modelo puede reconocer una instancia de Solomon y dar su óptimo publicado de
memoria en lugar de resolverla. `camouflage` da una instancia equivalente que no
se parece a la publicada:

- Los clientes se renumeran de 1 a n con una permutación determinista y la lista
  se ordena por el número nuevo, para que tampoco el orden de las ventanas delate
  la instancia.
- Todas las coordenadas, depósito incluido, se giran 90° y se desplazan:
  (x, y) -> (100 - y + dx, x + dy), con dx y dy enteros de 1 a 100. Las de
  Solomon son enteras de 0 a 100, así que siguen siendo enteras y no negativas.
- Las ventanas (`ready` y `due`) del depósito y de los clientes se retrasan k,
  un entero de 50 a 500, para que el horizonte no delate la instancia.
- Demandas y capacidad se multiplican por m, un entero de 2 a 9.
- El id lleva el sufijo `-cam` y el nombre es neutro.

Servicio, flota y perfil de coste no cambian. La permutación, dx, dy, k y m
salen de SHA-256 del id de la instancia, así que son los mismos en cualquier
proceso (`hash()` cambia de uno a otro).

La matriz se recalcula con `euclidean_matrix`, con el mismo truncamiento que la
original. Con coordenadas enteras, el giro solo intercambia las diferencias de
coordenadas y cambia el signo de una, y esas diferencias son exactas en coma
flotante: la matriz sale idéntica a la original permutada, y la distancia de
cualquier solución es la misma en las dos instancias.

La evaluación sale del depósito en `depot.ready` y solo usa diferencias de
tiempo (espera, retraso, vuelta al depósito); solo el perfil de tráfico mira el
tiempo absoluto, y en Solomon no existe (`camouflage` rechaza una instancia que
lo tenga). Retrasar todo k solo cambia los tiempos en el redondeo de coma
flotante. Multiplicar la carga por m conserva la factibilidad de carga, pero
multiplica por m el exceso absoluto y su término del score.

Así, distancia y violaciones son las mismas en las dos instancias, y el score
también si no hay retrasos ni exceso de carga (con retrasos, salvo el
redondeo): el óptimo publicado sigue valiendo como referencia. El score de una
solución inválida en la escala original se obtiene evaluando en la original las
rutas traducidas con `restore_routes`.
"""

import hashlib
from typing import NamedTuple, TypeVar

from vrptw.instances.solomon import coordinates, euclidean_matrix
from vrptw.model import Customer, Depot, Instance

SUFFIX = "-cam"
NAME = "camuflada"
SIDE = 100  # las coordenadas de Solomon van de 0 a SIDE; dx y dy, de 1 a SIDE

_Node = TypeVar("_Node", Depot, Customer)


class Transform(NamedTuple):
    dx: int
    dy: int
    k: int  # retraso de las ventanas
    m: int  # factor de demandas y capacidad


def _draw(instance: Instance, label: str) -> int:
    """Entero de 64 bits que sale de SHA-256 de `<id de la instancia>/<label>`."""
    digest = hashlib.sha256(f"{instance.id}/{label}".encode()).digest()
    return int.from_bytes(digest[:8], "big")


def transform(instance: Instance) -> Transform:
    """Desplazamiento, retraso y factor de carga del camuflaje de `instance`."""
    return Transform(
        dx=1 + _draw(instance, "dx") % SIDE,
        dy=1 + _draw(instance, "dy") % SIDE,
        k=50 + _draw(instance, "k") % 451,
        m=2 + _draw(instance, "m") % 8,
    )


def renumbering(instance: Instance) -> dict[int, int]:
    """Número nuevo (de 1 a n) de cada cliente de `instance`, por su número original."""
    order = sorted(instance.customers, key=lambda c: _draw(instance, str(c.id)))
    return {c.id: new for new, c in enumerate(order, start=1)}


def camouflage(instance: Instance) -> Instance:
    """Instancia equivalente a `instance` (de Solomon) que no se parece a ella."""
    if instance.traffic_profile is not None:
        raise ValueError("el camuflaje no retrasa perfiles de tráfico")
    numbers = renumbering(instance)
    dx, dy, k, m = transform(instance)

    def turn(node: _Node) -> _Node:
        assert node.x is not None and node.y is not None
        return node.model_copy(update={"x": SIDE - node.y + dx, "y": node.x + dy})

    due = instance.depot.due
    depot = turn(instance.depot).model_copy(
        update={
            "ready": instance.depot.ready + k,
            "due": None if due is None else due + k,
        }
    )
    customers = sorted(
        (
            turn(c).model_copy(
                update={
                    "id": numbers[c.id],
                    "ready": c.ready + k,
                    "due": c.due + k,
                    "demand": c.demand * m,
                }
            )
            for c in instance.customers
        ),
        key=lambda c: c.id,
    )
    capacity = instance.fleet.capacity
    assert instance.matrix is not None
    truncated = instance.matrix.source == "euclidean_truncated"
    return instance.model_copy(
        update={
            "id": instance.id + SUFFIX,
            "name": NAME,
            "depot": depot,
            "customers": customers,
            "fleet": instance.fleet.model_copy(
                update={"capacity": None if capacity is None else capacity * m}
            ),
            "matrix": euclidean_matrix(
                coordinates(depot, customers), truncated=truncated
            ),
        }
    )


def restore_routes(instance: Instance, routes: list[list[int]]) -> list[list[int]]:
    """Rutas de `camouflage(instance)` con los números de cliente de `instance`.

    Un número que no es de ningún cliente se queda igual. En Solomon los números
    de las dos instancias son 1..n, así que sigue sin serlo: evaluadas en
    `instance`, las rutas traducidas tienen las mismas violaciones que las
    camufladas en la camuflada, y el score en la escala original.
    """
    original = {new: old for old, new in renumbering(instance).items()}
    return [[original.get(c, c) for c in route] for route in routes]
