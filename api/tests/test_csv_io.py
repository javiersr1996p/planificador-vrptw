from pathlib import Path

import pytest

from vrptw.instances.csv_io import CsvFormatError, parse_problem_csv, read_problem_csv

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
