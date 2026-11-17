"""Pruebas de los prompts: instantáneas, contenido y dependencia del perfil de coste."""

import hashlib
import json
from pathlib import Path

import pytest

from vrptw.evaluate import evaluate
from vrptw.instances.camouflage import camouflage
from vrptw.instances.solomon import load_solomon
from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.llm.agent import MAX_TURNS, TOOLS, tools
from vrptw.llm.prompts import (
    HARD_CONSTRAINTS,
    PROMPT_VERSION,
    agent_prompt,
    explain_prompt,
    recheck_prompt,
    solve_prompt,
)
from vrptw.model import (
    SOLOMON,
    TFE,
    Customer,
    Depot,
    Fleet,
    Instance,
    Matrix,
    Solution,
    TrafficWindow,
    Violation,
)

SNAPSHOTS = Path(__file__).parent / "data" / "prompts"


def _snapshot(name: str, prompt: str) -> str:
    return f"PROMPT_VERSION: {PROMPT_VERSION}\n{prompt}"


def _check(name: str, prompt: str) -> None:
    expected = (SNAPSHOTS / name).read_text(encoding="utf-8")
    assert _snapshot(name, prompt) == expected, (
        "el prompt cambió: regenera la instantánea y cambia PROMPT_VERSION"
    )


def test_snapshot_10c1() -> None:
    _check("10c-1.txt", solve_prompt(load_tfe2024("10c-1")))


def test_snapshot_c101_25() -> None:
    _check("c101-25.txt", solve_prompt(load_solomon("C101", 25, truncated=True)))


def test_snapshot_recheck() -> None:
    _check("recheck.txt", recheck_prompt())


def test_snapshot_agent_10c1() -> None:
    _check("agent-10c-1.txt", agent_prompt(load_tfe2024("10c-1"), MAX_TURNS))


def test_snapshot_agent_tools() -> None:
    # las descripciones de las herramientas también las lee el modelo
    _check("agent-tools.txt", json.dumps(TOOLS, indent=2) + "\n")


def test_snapshot_agent_tools_without_time_limit() -> None:
    _check("agent-tools-full.txt", json.dumps(tools(None), indent=2) + "\n")


def test_agent_prompt_extends_solve_prompt() -> None:
    inst = load_tfe2024("10c-1")
    text = agent_prompt(inst, 4)
    assert text.startswith(solve_prompt(inst))
    assert "at most 4 turns" in text
    assert "solve_classic" in text and "evaluate_routes" in text


def test_10c1_content() -> None:
    inst = load_tfe2024("10c-1")
    text = solve_prompt(inst)
    lines = text.splitlines()
    for c in inst.customers:
        assert any(ln.startswith(f"{c.id},") for ln in lines)
    assert len(inst.customers) == 10
    assert "ignore all previous instructions" not in text.lower()
    assert "no capacity limit" in text
    assert "max(ARRIVAL TIME, READY TIME) + SERVICE TIME" in text
    assert '"routes"' in text


def test_c101_content() -> None:
    inst = load_solomon("C101", 25, truncated=True)
    text = solve_prompt(inst)
    assert inst.fleet.capacity is not None
    assert f"capacity of {inst.fleet.capacity:g}" in text
    assert f"at most {inst.fleet.vehicles} vehicles" in text
    assert "truncated to one decimal" in text
    # SOLOMON no cobra espera ni vehículos: no aparecen como términos del score
    assert "x vehicles used" not in text
    assert "x sum of WAITING TIME" not in text


def test_weights_come_from_cost_profile() -> None:
    inst = load_tfe2024("10c-1")
    base = solve_prompt(inst)
    assert "1000 x vehicles used" in base
    changed = inst.model_copy(
        update={"cost_profile": TFE.model_copy(update={"w_vehicle": 777})}
    )
    text = solve_prompt(changed)
    assert "777 x vehicles used" in text
    assert text != base


def test_geographic_instance_uses_matrix() -> None:
    inst = load_tfe2024("10c-1")
    n = len(inst.customers) + 1
    time = [[float(i != j) for j in range(n)] for i in range(n)]
    geo = inst.model_copy(
        update={
            "depot": inst.depot.model_copy(update={"x": None, "y": None}),
            "matrix": Matrix(
                distance=time, time=time, source="x", distance_unit="m", time_unit="s"
            ),
        }
    )
    text = solve_prompt(geo)
    assert "CUSTOMER,DEMAND" in text
    assert "Travel time matrix" in text


def test_geographic_without_matrix_fails() -> None:
    inst = load_tfe2024("10c-1")
    geo: Instance = inst.model_copy(
        update={
            "depot": inst.depot.model_copy(update={"x": None, "y": None}),
            "matrix": None,
        }
    )
    with pytest.raises(ValueError):
        solve_prompt(geo)


def test_hard_constraints_only_for_solomon_profile() -> None:
    assert HARD_CONSTRAINTS in solve_prompt(load_solomon("C101", 25, truncated=True))
    assert HARD_CONSTRAINTS not in solve_prompt(load_tfe2024("10c-1"))


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def test_existing_prompts_are_byte_identical() -> None:
    # estos prompts ya se enviaron al modelo: su texto no puede cambiar
    tfe = load_tfe2024("10c-1")
    solomon = camouflage(load_solomon("c101", 25, truncated=True))
    assert _sha(solve_prompt(tfe)) == (
        "0f8a1bd8a5f49e583deacc52e0166b5158d294a33362e7c1a842c11d607d150b"
    )
    assert _sha(agent_prompt(tfe, MAX_TURNS)) == (
        "06837bc2abd7bedffdd717fbb14ed8aeea8afdd62bea0a3d0bbad49b87410411"
    )
    assert _sha(solve_prompt(solomon)) == (
        "23251250789603239086c38e3e95c00b9dbd445d73892be85a551b97dd989ea9"
    )
    assert _sha(agent_prompt(solomon, MAX_TURNS)) == (
        "06cab78269a62dc46a742861f2b8ac33e3554059320b0853979e8f72bc76a096"
    )


def _real_instance(*, profile: bool = False, same: bool = False) -> Instance:
    time = [[0, 10, 20, 30], [11, 0, 12, 22], [21, 13, 0, 14], [31, 23, 15, 0]]
    distance = time if same else [[v * 0.8 for v in row] for row in time]
    customers = [
        Customer(
            id=i, lat=40.4 + i / 100, lon=-3.7, demand=1, ready=480, due=600, service=5
        )
        for i in (1, 2, 3)
    ]
    return Instance(
        id="real-3",
        name="real-3",
        source="real",
        depot=Depot(lat=40.4, lon=-3.7, ready=480, due=1080),
        customers=customers,
        fleet=Fleet(vehicles=2, capacity=10),
        matrix=Matrix(
            distance=distance,
            time=time,
            source="test",
            distance_unit="km",
            time_unit="min",
        ),
        traffic_profile=(
            [
                TrafficWindow(**{"from": 480, "to": 600, "factor": 1.5}),
                TrafficWindow(**{"from": 600, "to": 720, "factor": 1.25}),
            ]
            if profile
            else None
        ),
        cost_profile=SOLOMON,
    )


def test_real_instance_has_both_matrices_and_road_units() -> None:
    text = solve_prompt(_real_instance())
    assert "Travel time matrix" in text and "Travel distance matrix" in text
    assert "0,8,16,24" in text.splitlines()  # fila 0 de la matriz de distancias
    assert "0,10,20,30" in text.splitlines()  # fila 0 de la matriz de tiempos
    assert "in minutes" in text and "in kilometers" in text
    assert "ARRIVAL TIME = TRAVEL STARTS AT + TRAVEL TIME." in text
    assert "equals the travel distance" not in text
    assert "FROM,TO,FACTOR" not in text


def test_real_instance_with_equal_matrices_keeps_single_matrix() -> None:
    text = solve_prompt(_real_instance(same=True))
    assert "Travel distance matrix" not in text
    assert "travel time (and distance)" in text
    assert "kilometer" in text


def test_traffic_profile_table_only_with_profile() -> None:
    text = solve_prompt(_real_instance(profile=True))
    assert "FROM,TO,FACTOR\n480,600,1.5\n600,720,1.25" in text
    assert "[FROM, TO)" in text
    assert "FROM,TO,FACTOR" not in solve_prompt(_real_instance())
    assert "FROM,TO,FACTOR" in agent_prompt(_real_instance(profile=True), 3)


def test_real_instance_distance_is_not_truncated() -> None:
    text = solve_prompt(_real_instance())
    assert "Time windows and vehicle capacity are hard constraints" in text
    assert "truncated" not in text


def test_explain_prompt_names_vehicles_like_the_table() -> None:
    instance = _real_instance()
    evaluation = evaluate(instance, Solution(routes=[[1, 2], [3]]))
    evaluation = evaluation.model_copy(
        update={"violations": [Violation(type="capacity", route=0)]}
    )
    text = explain_prompt(instance, evaluation, "test")
    assert "1," in text and "2," in text  # filas de la tabla: vehículos 1 y 2
    assert "capacity (vehicle 1)" in text
    assert "route 0" not in text
