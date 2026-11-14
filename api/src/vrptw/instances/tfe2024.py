"""Problemas del trabajo de 2024 (CSV en data/tfe2024) como instancias."""

from pathlib import Path

from vrptw.instances.csv_io import read_problem_csv
from vrptw.instances.solomon import coordinates, euclidean_matrix
from vrptw.model import TFE, Fleet, Instance

TFE2024_DIR = Path(__file__).resolve().parents[3] / "data" / "tfe2024"
TFE2024_LABELS = tuple(f"{n}c-{k}" for n in (10, 20) for k in range(1, 11))
# Instancias de la tabla 5.1 (data/tfe_tables.json)
TFE2024_USED = (
    "10c-1",
    "10c-3",
    "10c-4",
    "10c-5",
    "10c-8",
    "10c-9",
    "20c-1",
    "20c-3",
    "20c-5",
    "20c-8",
    "20c-9",
    "20c-10",
)
_VEHICLES = {10: 5, 20: 10}


def is_used_in_2024(label: str) -> bool:
    return label in TFE2024_USED


def load_tfe2024(label: str) -> Instance:
    """Carga un problema de 2024 por etiqueta (`10c-1` ... `20c-10`)."""
    if label not in TFE2024_LABELS:
        raise ValueError(f"etiqueta desconocida {label!r}: use una de {TFE2024_LABELS}")
    size, number = label.split("c-")
    depot, customers = read_problem_csv(
        TFE2024_DIR / f"vrptw_{size}_customers_problem_{number}.csv"
    )
    # el 0 de DUE_TIME del depósito en el CSV no es un límite real
    depot = depot.model_copy(update={"due": None})
    points = coordinates(depot, customers)
    return Instance(
        id=f"tfe2024-{label}",
        name=label,
        source="tfe2024",
        depot=depot,
        customers=customers,
        fleet=Fleet(vehicles=_VEHICLES[int(size)], capacity=None),
        matrix=euclidean_matrix(points),
        cost_profile=TFE,
    )
