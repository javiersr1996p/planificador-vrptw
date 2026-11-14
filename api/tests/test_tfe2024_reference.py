"""Contrasta los costes de los xlsx de 2024 con la tabla 5.1 transcrita.

Los costes (tests/data/tfe2024_reference.json) se extrajeron de la columna Cost
de cada xlsx. La tabla 5.1 (data/tfe_tables.json) se transcribió a mano del
documento. El test comprueba que Mejor, Media y Desv. est. coinciden con
tolerancia TOL, salvo las discrepancias conocidas declaradas abajo.
"""

import json
import statistics
from pathlib import Path
from typing import Any

API = Path(__file__).resolve().parents[1]
REFERENCE = API / "tests" / "data" / "tfe2024_reference.json"
TABLES = API / "data" / "tfe_tables.json"

TOL = 0.01
METHODS = ("aco", "ga", "heuristic", "tabu")
GROUP_OF_METHOD = {"aco": "ACO", "ga": "GA", "heuristic": "Heuristic", "tabu": "Tabu"}
STATS = ("Mejor", "Media", "Desv. est.")

# (método, instancia, estadístico): (valor de la tabla, valor del xlsx redondeado a 2 decimales)
KNOWN_DISCREPANCIES: dict[tuple[str, str, str], tuple[str, float]] = {
    ("aco", "20c-1", "Media"): ("8459.52", 8459.42),
    ("ga", "20c-3", "Media"): ("13420.2", 13412.20),
    ("tabu", "20c-9", "Media"): ("13822.28", 13822.18),
}
# La heurística en 20c-5 no es una discrepancia: el xlsx da 11503.136 y la tabla
# lo imprime truncado (11503.13), dentro de la tolerancia.


def _num(text: str) -> float:
    return float(text.replace(",", ""))


def _load() -> tuple[dict[str, Any], dict[str, Any]]:
    reference = json.loads(REFERENCE.read_text(encoding="utf-8"))
    table = next(
        t for t in json.loads(TABLES.read_text(encoding="utf-8")) if t["table"] == "5.1"
    )
    return reference, table


def _table_columns(table: dict[str, Any]) -> dict[tuple[str, str], int]:
    """Índice de columna de cada (método, estadístico) en la tabla 5.1."""
    columns: dict[tuple[str, str], int] = {}
    for idx, col in enumerate(table["columns"]):
        if col["group"] is None:
            continue
        for method, group in GROUP_OF_METHOD.items():
            if col["group"] == group and col["header"] in STATS:
                columns[(method, col["header"])] = idx
    return columns


def _xlsx_stats(values: list[float]) -> dict[str, float]:
    return {
        "Mejor": min(values),
        "Media": statistics.mean(values),
        "Desv. est.": statistics.stdev(values),
    }


def _comparisons() -> dict[tuple[str, str, str], tuple[str, float, float]]:
    """Todas las comparaciones: (tabla, xlsx) por (método, instancia, estadístico)."""
    reference, table = _load()
    columns = _table_columns(table)
    rows = {row[0]: row for row in table["rows"]}
    out: dict[tuple[str, str, str], tuple[str, float, float]] = {}
    for method in METHODS:
        for instance, values in reference["costs"][method].items():
            row = rows[instance]
            got = _xlsx_stats(values)
            for stat in STATS:
                text = row[columns[(method, stat)]]
                out[(method, instance, stat)] = (text, got[stat], _num(text))
    return out


def _found_discrepancies() -> dict[tuple[str, str, str], tuple[str, float]]:
    found = {}
    for key, (text, xlsx_value, table_value) in _comparisons().items():
        if abs(xlsx_value - table_value) > TOL:
            found[key] = (text, round(xlsx_value, 2))
    return found


def test_reference_structure() -> None:
    reference, table = _load()
    assert set(reference["costs"]) == set(METHODS)
    table_instances = {row[0] for row in table["rows"]}
    assert len(table_instances) == 12
    for method in METHODS:
        instances = reference["costs"][method]
        assert set(instances) == table_instances, method
        for instance, values in instances.items():
            assert len(values) == 30, (method, instance)
            assert all(isinstance(v, float) for v in values), (method, instance)


def test_stats_match_table_except_known_discrepancies() -> None:
    found = _found_discrepancies()

    unexpected = sorted(set(found) - set(KNOWN_DISCREPANCIES))
    vanished = sorted(set(KNOWN_DISCREPANCIES) - set(found))
    assert not unexpected, (
        f"discrepancias no declaradas: {[(k, found[k]) for k in unexpected]}"
    )
    assert not vanished, f"discrepancias conocidas que ya no aparecen: {vanished}"

    for key, (table_text, xlsx_value) in KNOWN_DISCREPANCIES.items():
        assert found[key] == (table_text, xlsx_value), key
