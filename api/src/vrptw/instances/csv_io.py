"""Lectura de problemas en CSV (CUSTOMER,X,Y,DEMAND,READY_TIME,DUE_TIME,SERVICE_TIME)."""

import csv
import io
from pathlib import Path

from vrptw.model import MAX_CUSTOMERS, Customer, Depot

COLUMNS = ("CUSTOMER", "X", "Y", "DEMAND", "READY_TIME", "DUE_TIME", "SERVICE_TIME")


class CsvFormatError(ValueError):
    """El CSV no es válido; el mensaje indica la fila."""


def parse_problem_csv(text: str) -> tuple[Depot, list[Customer]]:
    """Interpreta el texto de un CSV. La fila con CUSTOMER 0 es el depósito."""
    reader = csv.DictReader(io.StringIO(text))
    missing = [c for c in COLUMNS if c not in (reader.fieldnames or [])]
    if missing:
        raise CsvFormatError(f"fila 1: faltan las columnas {missing}")

    depot: Depot | None = None
    customers: list[Customer] = []
    for row in reader:
        line = reader.line_num
        try:
            v = {c: float(row[c]) for c in COLUMNS}
        except (TypeError, ValueError):
            raise CsvFormatError(f"fila {line}: valor no numérico en {row}") from None
        if v["READY_TIME"] > v["DUE_TIME"]:
            raise CsvFormatError(
                f"fila {line}: READY_TIME {v['READY_TIME']:g} mayor que DUE_TIME {v['DUE_TIME']:g}"
            )
        ident = int(v["CUSTOMER"])
        if ident == 0:
            depot = Depot(x=v["X"], y=v["Y"], ready=v["READY_TIME"], due=v["DUE_TIME"])
            continue
        if len(customers) == MAX_CUSTOMERS:
            raise CsvFormatError(f"fila {line}: más de {MAX_CUSTOMERS} clientes")
        customers.append(
            Customer(
                id=ident,
                x=v["X"],
                y=v["Y"],
                demand=v["DEMAND"],
                ready=v["READY_TIME"],
                due=v["DUE_TIME"],
                service=v["SERVICE_TIME"],
            )
        )
    if depot is None:
        raise CsvFormatError("falta la fila del depósito (CUSTOMER 0)")
    if not customers:
        raise CsvFormatError("el CSV no contiene clientes")
    return depot, customers


def read_problem_csv(path: str | Path) -> tuple[Depot, list[Customer]]:
    """Lee un CSV desde un fichero."""
    return parse_problem_csv(Path(path).read_text(encoding="utf-8-sig"))
