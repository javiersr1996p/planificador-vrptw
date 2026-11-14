"""Coste de una llamada a un modelo de Anthropic, en USD y en EUR.

Los precios salen de `data/models.json` (solo las entradas con
`provider == "anthropic"`): aquí no se repite ninguno. `tokens_in` es el total de
tokens de entrada de la llamada y `tokens_out` incluye los de razonamiento, que
Anthropic factura como salida. No se contemplan precios de caché ni de lotes: esta
capa no los usa.
"""

import json
from pathlib import Path
from typing import Any, NamedTuple

MODELS_PATH = Path(__file__).resolve().parents[3] / "data" / "models.json"
# Referencia del BCE del 2026-11-13, consultada el 2026-11-14; documentada en
# docs/fuentes/modelos-y-precios.md. Fuente:
# https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/eurofxref-graph-usd.en.html
USD_PER_EUR = 1.1052


class Cost(NamedTuple):
    usd: float
    eur: float
    price_table_version: str  # fecha de consulta de los precios (`checked_on`)


def anthropic_prices() -> dict[str, dict[str, Any]]:
    """Entradas de Anthropic de `models.json`, por `model_id`."""
    entries: list[dict[str, Any]] = json.loads(MODELS_PATH.read_text(encoding="utf-8"))
    return {e["model_id"]: e for e in entries if e["provider"] == "anthropic"}


def call_cost(model: str, tokens_in: int, tokens_out: int) -> Cost:
    """Coste de una llamada; `ValueError` si el modelo no tiene precio.

    Si la entrada tiene `long_prompt_threshold_tokens` (Haiku 5.5) y el prompt lo
    supera, se aplican los precios `*_long_prompt` a toda la llamada.
    """
    prices = anthropic_prices()
    entry = prices.get(model)
    if entry is None:
        known = ", ".join(sorted(prices))
        raise ValueError(
            f"modelo sin precio en {MODELS_PATH.name}: {model!r} (con precio: {known})"
        )
    threshold = entry.get("long_prompt_threshold_tokens")
    suffix = "_long_prompt" if threshold is not None and tokens_in > threshold else ""
    usd = (
        tokens_in * entry["price_in_per_mtok" + suffix]
        + tokens_out * entry["price_out_per_mtok" + suffix]
    ) / 1_000_000
    return Cost(usd, usd / USD_PER_EUR, entry["checked_on"])
