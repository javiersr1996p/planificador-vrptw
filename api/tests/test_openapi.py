"""El contrato OpenAPI versionado en la web debe coincidir con el de la API."""

import json
from pathlib import Path

from vrptw.api.main import app

OPENAPI_WEB = Path(__file__).resolve().parents[2] / "web" / "openapi.json"


def test_openapi_web_coincide_con_la_api() -> None:
    publicado = json.loads(OPENAPI_WEB.read_text(encoding="utf-8"))
    assert publicado == app.openapi(), (
        "web/openapi.json está desfasado respecto a la API: "
        "ejecute `npm run gen:types` en web/ y versione los ficheros generados"
    )
