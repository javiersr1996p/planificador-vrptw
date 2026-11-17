"""Pruebas de los prompts: instantáneas, contenido y dependencia del perfil de coste."""

import json
from pathlib import Path

import pytest

from vrptw.instances.solomon import load_solomon
from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.llm.agent import MAX_TURNS, TOOLS, tools
from vrptw.llm.prompts import (
    HARD_CONSTRAINTS,
    PROMPT_VERSION,
    agent_prompt,
    recheck_prompt,
    solve_prompt,
)
from vrptw.model import TFE, Instance, Matrix

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
