"""Estimación del coste del benchmark LLM, sin red."""

from typing import Any

import pytest

from vrptw.bench.estimate import (
    GLOBAL_CAP_EUR,
    LLM_TIERS,
    MODEL_CAPS_EUR,
    MODELS,
    ROLES,
    Row,
    estimate,
    load_llm_instance,
)
from vrptw.cli import main
from vrptw.llm.prompts import solve_prompt
from vrptw.llm.providers import PROVIDERS


@pytest.fixture(scope="module")
def rows() -> list[Row]:
    return estimate()


def tier_high(rows: list[Row], tier: int) -> float:
    return sum(r.eur[1] for r in rows if r.tier == tier)


def test_breakdown_by_tier_model_and_role(rows: list[Row]) -> None:
    keys = [(r.tier, r.model, r.role) for r in rows]
    assert sorted(keys) == sorted(
        (t, m, role) for t in LLM_TIERS for m in MODELS for role in ROLES
    )
    runs = {t: sum(r.runs for r in rows if r.tier == t) for t in LLM_TIERS}
    assert runs == {0: 6, 1: 108, 2: 108, 3: 72, 4: 36}


def test_caps_add_up_to_the_global_cap() -> None:
    assert sum(t.cap_eur for t in LLM_TIERS.values()) == GLOBAL_CAP_EUR
    assert sum(MODEL_CAPS_EUR.values()) == GLOBAL_CAP_EUR


def test_no_network_call(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*args: Any) -> Any:
        raise AssertionError("la estimación no debe llamar al proveedor")

    monkeypatch.setitem(PROVIDERS, "anthropic", fail)
    assert len(estimate()) == len(LLM_TIERS) * len(MODELS) * len(ROLES)


def test_high_is_not_below_low(rows: list[Row]) -> None:
    for r in rows:
        assert r.eur[1] >= r.eur[0] > 0
        assert r.tokens_in[1] >= r.tokens_in[0]
        assert r.tokens_out[1] >= r.tokens_out[0]
        assert r.calls[1] >= r.calls[0]


def test_tier_cost_grows_with_max_tokens() -> None:
    small, large = estimate(2_000), estimate(4_000)
    for tier in LLM_TIERS:
        assert tier_high(large, tier) > tier_high(small, tier)


def test_real_case_substitute_has_matrix_and_no_coordinates() -> None:
    instance = load_llm_instance("real", 12)
    assert len(instance.customers) == 12 and instance.source == "real"
    prompt = solve_prompt(instance)
    assert "Travel time matrix" in prompt and "CUSTOMER,X,Y" not in prompt


def test_cli_prints_totals(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["bench", "estimate"]) == 0
    out = capsys.readouterr().out
    assert "TOTAL (330 ejecuciones)" in out and "EUR" in out
    assert "Supuestos:" in out


def test_cli_rejects_non_positive_max_tokens() -> None:
    assert main(["bench", "estimate", "--max-tokens", "0"]) == 1
