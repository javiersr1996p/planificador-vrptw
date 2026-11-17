from pathlib import Path

import pytest

from vrptw.instances.csv_io import (
    CsvFormatError,
    parse_problem_csv,
    parse_real_csv,
    read_problem_csv,
)

HEAD = "CUSTOMER,X,Y,DEMAND,READY_TIME,DUE_TIME,SERVICE_TIME\n"
DEPOT = "0,0,0,0,0,0,0\n"


def test_parse_text_and_file(tmp_path: Path) -> None:
    text = HEAD + DEPOT + "1,5,6,2,10,50,3\n"
    depot, customers = parse_problem_csv(text)
    assert (depot.x, depot.y, depot.ready, depot.due) == (0, 0, 0, 0)
    assert customers[0].id == 1 and customers[0].due == 50
    f = tmp_path / "p.csv"
    f.write_text(text)
    assert read_problem_csv(f) == (depot, customers)


def test_missing_column() -> None:
    with pytest.raises(CsvFormatError, match="DUE_TIME"):
        parse_problem_csv("CUSTOMER,X,Y,DEMAND,READY_TIME,SERVICE_TIME\n0,0,0,0,0,0\n")


def test_non_numeric() -> None:
    with pytest.raises(CsvFormatError, match="fila 3.*no numérico"):
        parse_problem_csv(HEAD + DEPOT + "1,a,6,2,10,50,3\n")


def test_ready_after_due() -> None:
    with pytest.raises(CsvFormatError, match="fila 3.*READY_TIME"):
        parse_problem_csv(HEAD + DEPOT + "1,5,6,2,60,50,3\n")


def test_too_many_customers() -> None:
    rows = "".join(f"{i},1,1,1,0,10,1\n" for i in range(1, 102))
    with pytest.raises(CsvFormatError, match="más de 100"):
        parse_problem_csv(HEAD + DEPOT + rows)
    parse_problem_csv(HEAD + DEPOT + rows.rsplit("\n", 2)[0] + "\n")  # 100 sí


def test_missing_depot_and_empty() -> None:
    with pytest.raises(CsvFormatError, match="depósito"):
        parse_problem_csv(HEAD + "1,5,6,2,10,50,3\n")
    with pytest.raises(CsvFormatError, match="sin clientes|no contiene clientes"):
        parse_problem_csv(HEAD + DEPOT)


REAL_HEAD = "CUSTOMER,ADDRESS,LAT,LON,DEMAND,READY_TIME,DUE_TIME,SERVICE_TIME\n"
REAL_DEPOT = "0,Calle Mayor 1,,,0,08:00,18:00,0\n"
TEMPLATE = Path(__file__).parents[1] / "data" / "plantilla_caso_real.csv"


def test_real_template_valid() -> None:
    depot, customers = parse_real_csv(TEMPLATE.read_text(encoding="utf-8"))
    assert (depot.ready, depot.due) == (480, 1080)
    assert depot.address and depot.lat is None
    assert [c.id for c in customers] == [1, 2, 3]
    assert (customers[0].ready, customers[0].due, customers[0].service) == (
        540,
        720,
        15,
    )
    assert customers[0].address and customers[0].lat is not None
    assert customers[2].address is None and customers[2].lon is not None


def test_real_bom_and_24h() -> None:
    text = "\ufeff" + REAL_HEAD + REAL_DEPOT + "1,,40.4,-3.7,1,00:00,24:00,0\n"
    _, customers = parse_real_csv(text)
    assert (customers[0].ready, customers[0].due) == (0, 1440)


def test_real_depot_only_address_kept() -> None:
    depot, _ = parse_real_csv(REAL_HEAD + REAL_DEPOT + "1,Plaza 1,,,1,09:00,10:00,5\n")
    assert depot.address == "Calle Mayor 1"


def test_real_collects_all_row_errors() -> None:
    text = (
        REAL_HEAD
        + REAL_DEPOT
        + "1,Plaza 1,,,1,9h,10:00,5\n"  # fila 3: hora mal formada
        + "2,Plaza 2,,,1,11:00,10:00,5\n"  # fila 4: ready > due
        + "3,,95,-3.7,1,09:00,10:00,5\n"  # fila 5: lat fuera de rango
        + "4,Plaza 4,,,1,09:00,10:00,5\n"
    )
    with pytest.raises(CsvFormatError) as exc:
        parse_real_csv(text)
    assert [n for n, _ in exc.value.errors] == [3, 4, 5]
    assert "READY_TIME" in exc.value.errors[1][1]
    assert "fila 5" in str(exc.value)


@pytest.mark.parametrize(
    ("row", "fragment"),
    [
        ("1,,,,1,09:00,10:00,5", "falta ADDRESS"),
        ("1,,40.4,,1,09:00,10:00,5", "LAT y LON"),
        ("1,,40.4,-200,1,09:00,10:00,5", "LON"),
        ("1,P,,,x,09:00,10:00,5", "DEMAND no es numérico"),
        ("1,P,,,-1,09:00,10:00,5", "DEMAND debe ser"),
        ("1,P,,,1,09:00,25:00,5", "DUE_TIME"),
        ("1,P,,,1,09:00,10:00,-5", "SERVICE_TIME debe ser"),
        ("0,P,,,0,09:00,10:00,0", "repetido"),
    ],
)
def test_real_row_errors(row: str, fragment: str) -> None:
    with pytest.raises(CsvFormatError, match=fragment) as exc:
        parse_real_csv(REAL_HEAD + REAL_DEPOT + row + "\n")
    assert exc.value.errors[0][0] == 3


def test_real_duplicate_id() -> None:
    row = "1,P,,,1,09:00,10:00,5\n"
    with pytest.raises(CsvFormatError, match="repetido") as exc:
        parse_real_csv(REAL_HEAD + REAL_DEPOT + row + row)
    assert exc.value.errors == [(4, "identificador 1 repetido")]


def test_real_missing_column_depot_and_empty() -> None:
    with pytest.raises(CsvFormatError, match="ADDRESS") as exc:
        parse_real_csv("CUSTOMER,LAT,LON\n")
    assert exc.value.errors[0][0] == 1
    with pytest.raises(CsvFormatError, match="depósito"):
        parse_real_csv(REAL_HEAD + "1,P,,,1,09:00,10:00,5\n")
    with pytest.raises(CsvFormatError, match="no contiene clientes"):
        parse_real_csv(REAL_HEAD + REAL_DEPOT)


def test_real_too_many_customers() -> None:
    rows = "".join(f"{i},P,,,1,09:00,10:00,5\n" for i in range(1, 102))
    with pytest.raises(CsvFormatError, match="más de 100") as exc:
        parse_real_csv(REAL_HEAD + REAL_DEPOT + rows)
    assert exc.value.errors == [(103, "más de 100 clientes")]
    parse_real_csv(REAL_HEAD + REAL_DEPOT + rows.rsplit("\n", 2)[0] + "\n")


def test_csv_format_error_default_errors() -> None:
    assert CsvFormatError("x").errors == []


@pytest.mark.parametrize("eol", ["\n", "\r\n", "\r"])
def test_real_line_endings(eol: str) -> None:
    text = (REAL_HEAD + REAL_DEPOT + "1,Plaza 1,,,1,09:00,10:00,5\n").replace("\n", eol)
    _, customers = parse_real_csv(text)
    assert [c.id for c in customers] == [1]


def test_real_long_customer_is_row_error() -> None:
    row = "1" * 5000 + ",Plaza 1,,,1,09:00,10:00,5\n"
    with pytest.raises(CsvFormatError, match="fila 3: CUSTOMER"):
        parse_real_csv(REAL_HEAD + REAL_DEPOT + row)


def test_real_semicolon_separator() -> None:
    text = (REAL_HEAD + REAL_DEPOT + "1,Plaza 1,,,1,09:00,10:00,5\n").replace(",", ";")
    depot, customers = parse_real_csv(text)
    assert depot.address == "Calle Mayor 1" and customers[0].service == 5


def test_real_csv_error_is_format_error() -> None:
    with pytest.raises(CsvFormatError, match="fila 2"):
        parse_real_csv(REAL_HEAD + '0,"sin cerrar\x00,,,0,08:00,18:00,0\n')


def test_real_template_addresses_include_country() -> None:
    _, customers = parse_real_csv(TEMPLATE.read_text(encoding="utf-8"))
    addresses = [c.address for c in customers if c.address]
    assert addresses and all(a.endswith(", España") for a in addresses)
