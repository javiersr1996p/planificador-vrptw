import pytest

from vrptw.llm.pricing import anthropic_prices, call_cost

# Valores esperados calculados aparte: (tokens_in * entrada + tokens_out * salida)
# / 1e6 con los precios de la documentación (2026-11-14), y EUR = USD / 1,1052.


@pytest.mark.parametrize(
    ("model", "usd", "eur"),
    [
        ("claude-haiku-5-5", 0.0027, 0.00244299674267101),
        ("claude-sonnet-5-5", 0.054, 0.048859934853420196),
        ("claude-opus-5-5", 0.108, 0.09771986970684039),
    ],
)
def test_call_cost(model: str, usd: float, eur: float) -> None:
    cost = call_cost(model, tokens_in=12_000, tokens_out=3_000)
    assert cost.usd == pytest.approx(usd)
    assert cost.eur == pytest.approx(eur)
    assert cost.price_table_version == "2026-11-14"


def test_haiku_long_prompt_price() -> None:
    at_threshold = call_cost("claude-haiku-5-5", 100_000, 3_000)
    over = call_cost("claude-haiku-5-5", 100_001, 3_000)
    assert at_threshold.usd == pytest.approx(0.0115)
    assert over.usd == pytest.approx(0.0575005)
    assert over.eur == pytest.approx(0.05202723488961274)


def test_zero_tokens_cost_nothing() -> None:
    assert call_cost("claude-opus-5-5", 0, 0).usd == 0


@pytest.mark.parametrize("model", ["claude-desconocido-9", "gpt-6.1-sol", "fake"])
def test_unknown_model_is_a_clear_error(model: str) -> None:
    with pytest.raises(ValueError, match="modelo sin precio") as info:
        call_cost(model, 10, 10)
    assert repr(model) in str(info.value)
    assert "claude-sonnet-5-5" in str(info.value)


def test_only_anthropic_entries_are_used() -> None:
    assert set(anthropic_prices()) == {
        "claude-haiku-5-5",
        "claude-sonnet-5-5",
        "claude-opus-5-5",
    }
