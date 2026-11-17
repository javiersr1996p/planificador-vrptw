"""Lectura de problemas en CSV.

`parse_problem_csv`: columnas CUSTOMER,X,Y,DEMAND,READY_TIME,DUE_TIME,SERVICE_TIME.
`parse_real_csv`: plantilla de casos reales (direcciones o coordenadas, horas HH:MM).
"""

import csv
import io
import math
import re
from pathlib import Path

from vrptw.model import MAX_CUSTOMERS, Customer, Depot

COLUMNS = ("CUSTOMER", "X", "Y", "DEMAND", "READY_TIME", "DUE_TIME", "SERVICE_TIME")


REAL_COLUMNS = (
    "CUSTOMER",
    "ADDRESS",
    "LAT",
    "LON",
    "DEMAND",
    "READY_TIME",
    "DUE_TIME",
    "SERVICE_TIME",
)
_TIME = re.compile(r"(\d{1,2}):(\d{2})")


class CsvFormatError(ValueError):
    """El CSV no es válido; el mensaje indica la fila.

    `errors` lista (número de fila del fichero, mensaje); la fila 0 marca un
    error del conjunto (falta el depósito o los clientes). Vacío si el error
    se construyó solo con un mensaje.
    """

    def __init__(
        self, message: str, errors: list[tuple[int, str]] | None = None
    ) -> None:
        super().__init__(message)
        self.errors: list[tuple[int, str]] = errors if errors is not None else []


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


def _number(cell: dict[str, str], col: str, problems: list[str]) -> float | None:
    try:
        value = float(cell[col])
    except ValueError:
        value = math.nan
    if not math.isfinite(value):
        problems.append(f"{col} no es numérico ({cell[col]!r})")
        return None
    return value


def _minutes(cell: dict[str, str], col: str, problems: list[str]) -> float | None:
    """Convierte HH:MM (24 h, hasta 24:00) a minutos desde las 00:00."""
    m = _TIME.fullmatch(cell[col])
    if m:
        hours, mins = int(m[1]), int(m[2])
        if mins < 60 and (hours < 24 or (hours == 24 and mins == 0)):
            return float(hours * 60 + mins)
    problems.append(f"{col} debe tener formato HH:MM de 24 h ({cell[col]!r})")
    return None


def parse_real_csv(text: str) -> tuple[Depot, list[Customer]]:
    """Interpreta la plantilla de casos reales.

    Columnas: CUSTOMER,ADDRESS,LAT,LON,DEMAND,READY_TIME,DUE_TIME,SERVICE_TIME.
    Cada fila lleva ADDRESS o el par LAT,LON. Las horas son HH:MM (24 h) y se
    devuelven en minutos desde las 00:00. La fila CUSTOMER 0 es el depósito; su
    DEMAND y SERVICE_TIME se ignoran. El separador es la coma, o el punto y coma
    si la cabecera no tiene comas (Excel en español). Se recogen todos los errores de fila en
    `CsvFormatError.errors`.
    """
    text = text.removeprefix("\ufeff")
    header = text.splitlines()[0] if text.strip() else ""
    delimiter = ";" if ";" in header and "," not in header else ","
    reader = csv.DictReader(io.StringIO(text, newline=""), delimiter=delimiter)
    try:
        fieldnames = reader.fieldnames or []
    except csv.Error as exc:
        raise CsvFormatError(f"fila 1: {exc}", [(1, str(exc))]) from None
    missing = [c for c in REAL_COLUMNS if c not in fieldnames]
    if missing:
        msg = f"faltan las columnas {missing}"
        raise CsvFormatError(f"fila 1: {msg}", [(1, msg)])

    errors: list[tuple[int, str]] = []
    depot: Depot | None = None
    customers: list[Customer] = []
    seen: set[int] = set()
    while True:
        try:
            row = next(reader)
        except StopIteration:
            break
        except csv.Error as exc:
            raise CsvFormatError(
                f"fila {reader.line_num}: {exc}", [(reader.line_num, str(exc))]
            ) from None
        line = reader.line_num
        cell = {c: (row.get(c) or "").strip() for c in REAL_COLUMNS}
        problems: list[str] = []
        ident: int | None = None
        if re.fullmatch(r"\d{1,9}", cell["CUSTOMER"]):
            ident = int(cell["CUSTOMER"])
            if ident in seen:
                problems.append(f"identificador {ident} repetido")
            seen.add(ident)
        else:
            problems.append(
                f"CUSTOMER debe ser un entero de 0 a 999999999 ({cell['CUSTOMER']!r})"
            )
        if ident != 0 and len(customers) == MAX_CUSTOMERS:
            problems.append(f"más de {MAX_CUSTOMERS} clientes")

        address = cell["ADDRESS"] or None
        lat = lon = None
        if bool(cell["LAT"]) != bool(cell["LON"]):
            problems.append("LAT y LON deben ir juntas")
        elif cell["LAT"]:
            lat = _number(cell, "LAT", problems)
            lon = _number(cell, "LON", problems)
            if lat is not None and not -90 <= lat <= 90:
                problems.append(f"LAT {lat:g} fuera de [-90, 90]")
            if lon is not None and not -180 <= lon <= 180:
                problems.append(f"LON {lon:g} fuera de [-180, 180]")
        elif address is None:
            problems.append("falta ADDRESS o el par LAT, LON")

        ready = _minutes(cell, "READY_TIME", problems)
        due = _minutes(cell, "DUE_TIME", problems)
        if ready is not None and due is not None and ready > due:
            problems.append(
                f"READY_TIME {cell['READY_TIME']} mayor que DUE_TIME {cell['DUE_TIME']}"
            )

        demand = service = 0.0
        if ident != 0:
            d = _number(cell, "DEMAND", problems)
            s = _number(cell, "SERVICE_TIME", problems)
            if d is not None and s is not None:
                demand, service = d, s
                if demand < 0:
                    problems.append("DEMAND debe ser mayor o igual que 0")
                if service < 0:
                    problems.append("SERVICE_TIME debe ser mayor o igual que 0")

        if problems or ident is None or ready is None or due is None:
            errors.extend((line, p) for p in problems)
            continue
        if ident == 0:
            depot = Depot(address=address, lat=lat, lon=lon, ready=ready, due=due)
        else:
            customers.append(
                Customer(
                    id=ident,
                    lat=lat,
                    lon=lon,
                    address=address,
                    demand=demand,
                    ready=ready,
                    due=due,
                    service=service,
                )
            )
    if depot is None and 0 not in seen:
        errors.append((0, "falta la fila del depósito (CUSTOMER 0)"))
    if not customers and not errors:
        errors.append((0, "el CSV no contiene clientes"))
    if errors:
        raise CsvFormatError(
            "; ".join(f"fila {n}: {m}" if n else m for n, m in errors), errors
        )
    assert depot is not None
    return depot, customers
