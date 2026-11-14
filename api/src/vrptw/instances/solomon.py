"""Instancias de Solomon: lectura de ficheros, recorte a n clientes y matriz euclídea."""

import math
from pathlib import Path

from vrptw.model import SOLOMON, Customer, Depot, Fleet, Instance, Matrix

SOLOMON_DIR = Path(__file__).resolve().parents[3] / "data" / "solomon"
SOLOMON_NAMES = ("c101", "c201", "r101", "r201", "rc101", "rc201")
SOLOMON_SIZES = (25, 50, 100)


class SolomonFormatError(ValueError):
    """El fichero no sigue el formato de Solomon."""


def euclidean_matrix(
    points: list[tuple[float, float]], *, truncated: bool = False
) -> Matrix:
    """Matriz de distancias y tiempos (iguales) entre puntos; el índice 0 es el depósito.

    Con `truncated` cada arco es floor(10 d) / 10 (convención de Solomon).
    """
    rows: list[list[float]] = []
    for xa, ya in points:
        row = []
        for xb, yb in points:
            d = math.hypot(xa - xb, ya - yb)
            # el épsilon evita que 12.3 calculado como 12.299999999999999 pase a 12.2
            row.append(math.floor(10 * d + 1e-9) / 10 if truncated else d)
        rows.append(row)
    return Matrix(
        distance=rows,
        time=[r[:] for r in rows],
        source="euclidean_truncated" if truncated else "euclidean",
        distance_unit="unit",
        time_unit="unit",
    )


def coordinates(depot: Depot, customers: list[Customer]) -> list[tuple[float, float]]:
    """Coordenadas (x, y) en orden de matriz: depósito y luego los clientes."""
    points: list[tuple[float, float]] = []
    nodes: list[Depot | Customer] = [depot, *customers]
    for node in nodes:
        if node.x is None or node.y is None:
            raise ValueError("todos los nodos necesitan coordenadas x, y")
        points.append((node.x, node.y))
    return points


def _ints(line: str, count: int, what: str) -> list[int]:
    try:
        values = [int(t) for t in line.split()]
    except ValueError:
        raise SolomonFormatError(f"{what}: valores no numéricos en {line!r}") from None
    if len(values) != count:
        raise SolomonFormatError(f"{what}: se esperaban {count} valores en {line!r}")
    return values


def parse_solomon(text: str) -> tuple[Fleet, Depot, list[Customer]]:
    """Interpreta el texto de un fichero de Solomon (depósito y todos sus clientes)."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    try:
        i = next(k for k, ln in enumerate(lines) if ln.upper().startswith("VEHICLE"))
        vehicles, capacity = _ints(lines[i + 2], 2, "cabecera de flota")
        j = next(k for k, ln in enumerate(lines) if ln.upper().startswith("CUST NO"))
    except (StopIteration, IndexError):
        raise SolomonFormatError(
            "cabecera rota: faltan las secciones VEHICLE o CUSTOMER"
        ) from None

    nodes = []
    for ln in lines[j + 1 :]:
        v = ln.split()
        if len(v) != 7:
            raise SolomonFormatError(f"fila de nodo con {len(v)} columnas: {ln!r}")
        try:
            nodes.append((int(v[0]), *(float(t) for t in v[1:])))
        except ValueError:
            raise SolomonFormatError(f"fila de nodo no numérica: {ln!r}") from None
    if not nodes or nodes[0][0] != 0:
        raise SolomonFormatError("falta la fila del depósito (nodo 0)")
    if [n[0] for n in nodes] != list(range(len(nodes))):
        raise SolomonFormatError("los identificadores de nodo no son 0, 1, 2, ...")

    _, x, y, _, ready, due, _ = nodes[0]
    depot = Depot(x=x, y=y, ready=ready, due=due)
    customers = [
        Customer(id=int(i), x=x, y=y, demand=d, ready=r, due=u, service=s)
        for i, x, y, d, r, u, s in nodes[1:]
    ]
    return Fleet(vehicles=vehicles, capacity=capacity), depot, customers


def load_solomon(name: str, n: int = 100, *, truncated: bool = False) -> Instance:
    """Carga una instancia de Solomon con el depósito y los primeros `n` clientes."""
    key = name.lower()
    if key not in SOLOMON_NAMES:
        raise ValueError(f"instancia de Solomon desconocida {name!r}: {SOLOMON_NAMES}")
    if n not in SOLOMON_SIZES:
        raise ValueError(f"tamaño no admitido {n}: debe ser uno de {SOLOMON_SIZES}")
    path = SOLOMON_DIR / f"{key}.txt"
    fleet, depot, customers = parse_solomon(path.read_text())
    if len(customers) < n:
        raise SolomonFormatError(
            f"{path.name}: tiene {len(customers)} clientes y se pedían {n}"
        )
    customers = customers[:n]
    points = coordinates(depot, customers)
    return Instance(
        id=f"{key}-{n}{'-trunc' if truncated else ''}",
        name=key.upper(),
        source="solomon",
        depot=depot,
        customers=customers,
        fleet=fleet,
        matrix=euclidean_matrix(points, truncated=truncated),
        cost_profile=SOLOMON,
    )
