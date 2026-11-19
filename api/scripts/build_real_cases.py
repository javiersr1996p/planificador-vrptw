"""Construye los casos reales de ejemplo en Madrid para la web.

Lee `data/cases/<id>.csv` y `<id>.fleet.json`, geocodifica con Geoapify, pide la
matriz por carretera a openrouteservice y escribe `web/public/data/cases/<id>.json`.

La geocodificación y la matriz se guardan en el propio fichero de salida y se
reutilizan mientras las direcciones del CSV no cambien: ajustar ventanas,
demandas, servicio o flota no gasta cuota. Con `--refresh` se vuelve a llamar a la
red. Las claves se leen de `GEOAPIFY_API_KEY` y `ORS_API_KEY` y nunca se imprimen.
Los registros de `runs` (los rellena `vrptw bench export`) se conservan si el hash de
la instancia no cambia.

Uso, desde `api/`:
    uv run --env-file .env python scripts/build_real_cases.py [madrid-12 ...] [--refresh]
"""

import argparse
import csv
import io
import json
import os
import statistics
import sys
from datetime import date
from pathlib import Path
from typing import Any

from vrptw import geo
from vrptw.evaluate import evaluate
from vrptw.instances.csv_io import parse_real_csv
from vrptw.model import SOLOMON, Fleet, Instance, Matrix
from vrptw.solvers.heuristic import solve

API = Path(__file__).resolve().parents[1]
CASES = API / "data" / "cases"
OUT = API.parent / "web" / "public" / "data" / "cases"
TEMPLATE = API / "data" / "plantilla_caso_real.csv"
CASE_IDS = ("madrid-12", "madrid-25")
NAMES = {
    "madrid-12": "Madrid: 12 paradas en lugares públicos",
    "madrid-25": "Madrid: 25 paradas en lugares públicos",
}
# Caja aproximada de Madrid capital.
LAT_RANGE = (40.30, 40.56)
LON_RANGE = (-3.84, -3.52)
ATTRIBUTION = (
    "Geocodificación: Powered by Geoapify (https://www.geoapify.com/). "
    "Matriz por carretera: © openrouteservice by HeiGIT | Data from OpenStreetMap, "
    "resultados bajo licencia CC BY-SA 4.0 "
    "(https://creativecommons.org/licenses/by-sa/4.0/). "
    "Datos de mapa: © OpenStreetMap contributors (https://www.openstreetmap.org/copyright)."
)
NOTE = (
    "Demandas, ventanas y flota ilustrativas; direcciones de lugares públicos "
    "geocodificadas con Geoapify; matriz por carretera de openrouteservice."
)


# Mediana máxima de distancia por carretera / distancia en línea recta por fila o
# columna; pares a menos de MIN_STRAIGHT_KM en recta se ignoran.
MAX_DETOUR = 2.5
MIN_STRAIGHT_KM = 0.3


class BuildError(Exception):
    pass


def check_detour(points: list[tuple[float, float]], matrix: Matrix, case: str) -> None:
    """Falla si la mediana carretera/recta de alguna fila o columna supera `MAX_DETOUR`.

    Un valor así indica que un punto quedó ajustado a una vía sin salidas cercanas
    (p. ej. un túnel) y distorsiona todas sus distancias.
    """
    straight = geo.haversine_matrix(points).distance
    n = len(points)
    for axis, name in ((0, "fila"), (1, "columna")):
        for k in range(n):
            pairs = [(i, k) if axis else (k, i) for i in range(n) if i != k]
            ratios = [
                matrix.distance[a][b] / straight[a][b]
                for a, b in pairs
                if straight[a][b] >= MIN_STRAIGHT_KM
            ]
            if ratios and (median := statistics.median(ratios)) > MAX_DETOUR:
                raise BuildError(
                    f"{case}: la {name} {k} de la matriz tiene una mediana "
                    f"carretera/recta de {median:.2f} (máximo {MAX_DETOUR}); "
                    "el punto probablemente está ajustado a una vía sin salidas "
                    "cercanas: elige otra dirección"
                )


def _key(name: str) -> str:
    value = os.environ.get(name, "")
    if not value:
        raise BuildError(f"falta la variable de entorno {name}")
    return value


def _geocode(addresses: list[str]) -> list[tuple[float, float]]:
    """Coordenadas de cada dirección; imprime la etiqueta devuelta para revisarla."""
    results = geo.geocode(addresses, _key("GEOAPIFY_API_KEY"))
    points: list[tuple[float, float]] = []
    for r in results:
        if not r.found or r.lat is None or r.lon is None:
            raise BuildError(f"Geoapify no encuentra la dirección: {r.address!r}")
        print(f"  {r.address}\n    -> {r.label} ({r.lat:.6f}, {r.lon:.6f})")
        if not (LAT_RANGE[0] <= r.lat <= LAT_RANGE[1]):
            raise BuildError(f"fuera de Madrid: {r.address!r} ({r.lat}, {r.lon})")
        if not (LON_RANGE[0] <= r.lon <= LON_RANGE[1]):
            raise BuildError(f"fuera de Madrid: {r.address!r} ({r.lat}, {r.lon})")
        points.append((r.lat, r.lon))
    return points


def _cached(path: Path, addresses: list[str]) -> Instance | None:
    """Instancia ya construida si sus direcciones coinciden con las del CSV."""
    if not path.exists():
        return None
    old = Instance.model_validate(
        json.loads(path.read_text(encoding="utf-8"))["instance"]
    )
    old_addresses = [old.depot.address] + [c.address for c in old.customers]
    return old if old_addresses == addresses and old.matrix is not None else None


def _kept_runs(path: Path, instance: Instance) -> list[Any]:
    """Registros ya exportados, si la instancia (por su hash) no ha cambiado."""
    if not path.exists():
        return []
    old = json.loads(path.read_text(encoding="utf-8"))
    same = Instance.model_validate(old["instance"]).content_hash()
    return list(old["runs"]) if same == instance.content_hash() else []


def build(case: str, refresh: bool) -> bool:
    """Construye un caso. Devuelve si ha llamado a la red."""
    print(f"== {case}")
    depot, customers = parse_real_csv(
        (CASES / f"{case}.csv").read_text(encoding="utf-8")
    )
    fleet = Fleet.model_validate_json((CASES / f"{case}.fleet.json").read_text())
    path = OUT / f"{case}.json"
    addresses = [depot.address] + [c.address for c in customers]
    old = None if refresh else _cached(path, addresses)

    if old is not None:
        print("  geocodificación y matriz reutilizadas del fichero de salida")
        points = [(old.depot.lat, old.depot.lon)] + [
            (c.lat, c.lon) for c in old.customers
        ]
        matrix = old.matrix
    else:
        if any(a is None for a in addresses):
            raise BuildError("todas las filas del caso necesitan ADDRESS")
        points = _geocode([str(a) for a in addresses])
        matrix = geo.road_matrix(points, _key("ORS_API_KEY"))
    assert matrix is not None
    if matrix.source != geo.ORS:
        raise BuildError(f"matriz con fuente {matrix.source!r}, se esperaba {geo.ORS}")
    check_detour(points, matrix, case)

    depot = depot.model_copy(update={"lat": points[0][0], "lon": points[0][1]})
    customers = [
        c.model_copy(update={"lat": lat, "lon": lon})
        for c, (lat, lon) in zip(customers, points[1:], strict=True)
    ]
    instance = Instance(
        id=case,
        name=NAMES[case],
        source="real",
        depot=depot,
        customers=customers,
        fleet=fleet,
        matrix=matrix,
        cost_profile=SOLOMON,
    )
    payload = {
        "instance": instance.model_dump(mode="json", by_alias=True),
        "runs": _kept_runs(path, instance),
        "built_on": date.today().isoformat(),
        "attribution": ATTRIBUTION,
        "note": NOTE,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    result = evaluate(instance, solve(instance))
    if result.unserved or not result.feasible:
        raise BuildError(
            f"{case}: la heurística deja {result.unserved} sin atender "
            f"(factible: {result.feasible}); ajusta ventanas, servicio o flota"
        )
    print(
        f"  heurística: {result.vehicles_used} vehículos, "
        f"{result.distance:.1f} km, factible"
    )
    return old is None


def update_template() -> None:
    """Sustituye las coordenadas de la plantilla por las que devuelve Geoapify."""
    print("== plantilla")
    text = TEMPLATE.read_text(encoding="utf-8")
    rows = list(csv.DictReader(io.StringIO(text)))
    queries = [
        r["ADDRESS"] if "España" in r["ADDRESS"] else f"{r['ADDRESS']}, España"
        for r in rows
        if r["ADDRESS"]
    ]
    points = iter(_geocode(queries))
    for r in rows:
        if not r["ADDRESS"]:
            continue
        lat, lon = next(points)
        if r["LAT"]:
            old = f"{r['LAT']},{r['LON']}"
            if old not in text:
                raise BuildError(f"no se localiza {old} en la plantilla")
            text = text.replace(old, f"{lat:.6f},{lon:.6f}")
    TEMPLATE.write_text(text, encoding="utf-8", newline="")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("cases", nargs="*", choices=CASE_IDS, default=[])
    parser.add_argument(
        "--refresh", action="store_true", help="vuelve a llamar a la red"
    )
    args = parser.parse_args()
    try:
        used_network = False
        for case in args.cases or CASE_IDS:
            used_network |= build(case, args.refresh)
        if used_network:
            update_template()
    except (BuildError, geo.GeoError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
