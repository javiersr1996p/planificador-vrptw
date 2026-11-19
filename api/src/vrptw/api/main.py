"""Servicio HTTP del planificador: instancias, mapas, métodos clásicos, evaluación y LLM.

Las rutas son funciones síncronas (FastAPI las ejecuta en su pool de hilos). Las
claves de los servicios de mapas se leen del entorno en cada petición. Los
solvers solo reciben los parámetros que declara la API, nunca libres.

La clave de API del LLM llega en la cabecera `X-LLM-Key` y se pasa como argumento:
no se asigna a nada que sobreviva a la petición. Las rutas que la usan
(`/solve/llm` y `/explain`) capturan ellas mismas cualquier excepción: un manejador
global de Starlette la vuelve a lanzar y uvicorn la registraría con su mensaje, que
podría contener la clave. Con `VRPTW_LLM_PROVIDER=fake` (modo de pruebas) responden
sin red con un proveedor falso.

Un middleware, dentro de CORS, limita el tamaño del cuerpo y convierte cualquier
otra excepción no controlada en un 500 sin detalles y con las cabeceras CORS.
"""

import json
import logging
import math
import os
import threading
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from importlib.metadata import version
from typing import Annotated, Any, Literal, NoReturn

from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from vrptw import geo
from vrptw.bench.estimate import max_tokens_for
from vrptw.cli import run_method
from vrptw.evaluate import evaluate
from vrptw.instances.camouflage import camouflage, restore_routes
from vrptw.instances.csv_io import CsvFormatError, parse_real_csv
from vrptw.instances.solomon import coordinates, euclidean_matrix
from vrptw.llm.agent import MAX_TOOL_TIME_S, solve_agent
from vrptw.llm.direct import solve_direct
from vrptw.llm.pricing import anthropic_prices, call_cost
from vrptw.llm.prompts import explain_prompt
from vrptw.llm.providers import (
    PROVIDERS,
    LLMResponse,
    Provider,
    ProviderError,
    make_fake,
)
from vrptw.model import (
    SOLOMON,
    Customer,
    Depot,
    Evaluation,
    Fleet,
    Instance,
    Matrix,
    RunRecord,
    Solution,
)
from vrptw.solvers.heuristic import solve as solve_heuristic

MAX_VEHICLES = 100
MAX_TRAFFIC_WINDOWS = 24
MAX_ERRORS = 20
MAX_ROUTES = 100
MAX_ROUTE_IDS = 200
# Una instancia de 100 clientes con sus dos matrices de 101 x 101 ocupa unos 0,37 MB
# en JSON (Solomon R101 sin truncar, medido): 2 MB dejan margen de sobra.
MAX_BODY_BYTES = 2_000_000
# Cerca del máximo de coma flotante (1e308), las sumas y productos de la evaluación
# desbordan a infinito y la respuesta lleva `null`. 1e9 sobra para cualquier caso
# (los identificadores del CSV llegan a 999 999 999).
MAX_ABS_NUMBER = 1e9
MAX_LABEL_LENGTH = 100  # `id` de la instancia, `matrix.source` y unidades
MAX_TEXT_LENGTH = 200  # nombre de la instancia y direcciones
# Topes diarios de los servicios de mapas: una fracción de la cuota gratuita
# documentada en `docs/fuentes/hosting-y-mapas.md`, para que el uso público no la
# agote y quede margen para el desarrollo. Geoapify Free da 3000 geocodificaciones
# al día: 1000 direcciones son un tercio (10 casos de 100 clientes).
# openrouteservice Standard da 500 peticiones de Matrix al día y una matriz de 101
# puntos usa hasta 3: 150 matrices gastan como mucho 450.
GEOCODE_DAILY_MAX = 1000
MATRIX_DAILY_MAX = 150
# Diferencia admitida entre la matriz de una instancia de Solomon y la euclídea
# recalculada: solo la del redondeo de otro cálculo de la misma distancia.
SOLOMON_MATRIX_TOL = 1e-9
RETRY_AFTER_S = "5"
# Supuesto propio, sin validar con un modelo real: con razonamiento activo, 2000
# tokens podrían agotarse antes de que el modelo empiece a escribir el texto.
EXPLAIN_MAX_TOKENS = 4000
FAKE_EXPLANATION = "Respuesta de prueba: el servicio está en modo de pruebas y no ha llamado a ningún modelo."

logger = logging.getLogger("vrptw.api")

app = FastAPI(debug=False, title="Planificador VRPTW")


@app.middleware("http")
async def _limits_and_errors(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Tamaño del cuerpo y excepciones no controladas.

    Antes de leer el cuerpo: un POST sin `Content-Length` (o troceado) responde 411,
    y uno de más de `MAX_BODY_BYTES`, 413. Una excepción que ninguna ruta ha
    controlado responde 500 `{"detail": "error interno"}`, con solo el nombre de su
    tipo en el log, que se escribe fuera del `except` por lo mismo que en `_guarded`.
    CORS se añade después, así que queda por fuera y estas respuestas también llevan
    sus cabeceras.
    """
    if request.method == "POST":
        length = request.headers.get("content-length")
        if length is None or "transfer-encoding" in request.headers:
            return JSONResponse(
                {"detail": "falta la cabecera Content-Length"}, status_code=411
            )
        if not length.isdecimal() or int(length) > MAX_BODY_BYTES:
            limit = MAX_BODY_BYTES // 1_000_000
            return JSONResponse(
                {"detail": f"el cuerpo no puede pasar de {limit} MB"}, status_code=413
            )
    unexpected: str
    try:
        return await call_next(request)
    except Exception as exc:  # noqa: BLE001 (ver el docstring)
        unexpected = type(exc).__name__
    logger.error("error interno: %s", unexpected)
    return JSONResponse({"detail": "error interno"}, status_code=500)


origins = os.environ.get("VRPTW_CORS_ORIGINS", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in origins.split(",") if o.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-LLM-Key"],
    expose_headers=["Retry-After"],
)

# Un solo cálculo a la vez: los solvers ocupan un núcleo hasta su plazo.
_SOLVE_LOCK = threading.Semaphore(1)


class _DailyQuota:
    """Contador diario en memoria, global al proceso, que vuelve a 0 al cambiar la
    fecha UTC. Cuenta todo lo que se pide, también lo que resuelve la caché de
    `geo`, así que el tope llega antes que la cuota real. Un reinicio del servicio
    también lo pone a 0: protege contra el abuso, no lleva la cuenta exacta."""

    def __init__(self, limit: int) -> None:
        self.limit = limit
        self.day = datetime.now(UTC).date()
        self.used = 0
        self._lock = threading.Lock()

    def take(self, amount: int) -> bool:
        """Suma `amount` si cabe en el tope de hoy; si no cabe, no suma y da False."""
        with self._lock:
            today = datetime.now(UTC).date()
            if today != self.day:
                self.day, self.used = today, 0
            if self.used + amount > self.limit:
                return False
            self.used += amount
            return True


_GEOCODE_QUOTA = _DailyQuota(GEOCODE_DAILY_MAX)
_MATRIX_QUOTA = _DailyQuota(MATRIX_DAILY_MAX)


def _loc(path: tuple[Any, ...]) -> str:
    return ".".join(str(p) for p in path)


@app.exception_handler(RequestValidationError)
def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """422 sin `input`, `ctx` ni `url`, que podrían devolver parte de la entrada."""
    detail = [
        {
            "loc": _loc(e["loc"][1:] if e["loc"][:1] == ("body",) else e["loc"]),
            "msg": e["msg"],
        }
        for e in exc.errors()[:MAX_ERRORS]
    ]
    return JSONResponse({"detail": detail}, status_code=422)


def _bad_numbers(value: Any, path: tuple[Any, ...]) -> list[tuple[str, str]]:
    """Posición y motivo de cada número no finito, o de valor absoluto mayor que
    `MAX_ABS_NUMBER`, dentro de un volcado de modelo."""
    if isinstance(value, float) and not math.isfinite(value):
        return [(_loc(path), "debe ser un número finito")]
    if isinstance(value, int | float) and not isinstance(value, bool):
        msg = f"debe estar entre -{MAX_ABS_NUMBER:g} y {MAX_ABS_NUMBER:g}"
        return [(_loc(path), msg)] if abs(value) > MAX_ABS_NUMBER else []
    if isinstance(value, dict):
        return [e for k, v in value.items() for e in _bad_numbers(v, (*path, k))]
    if isinstance(value, list):
        return [e for i, v in enumerate(value) for e in _bad_numbers(v, (*path, i))]
    return []


def check_public(instance: Instance) -> None:
    """422 si la instancia no cumple los límites del servicio público."""
    errors: list[dict[str, str]] = []

    def fail(path: tuple[Any, ...], msg: str) -> None:
        errors.append({"loc": _loc(("instance", *path)), "msg": msg})

    def too_long(path: tuple[Any, ...], text: str | None, limit: int) -> None:
        if text is not None and len(text) > limit:
            fail(path, f"como mucho {limit} caracteres")

    for path, msg in _bad_numbers(instance.model_dump(), ()):
        fail((path,), msg)
    too_long(("id",), instance.id, MAX_LABEL_LENGTH)
    too_long(("name",), instance.name, MAX_TEXT_LENGTH)
    too_long(("depot", "address"), instance.depot.address, MAX_TEXT_LENGTH)
    if not 1 <= instance.fleet.vehicles <= MAX_VEHICLES:
        fail(("fleet", "vehicles"), f"debe estar entre 1 y {MAX_VEHICLES}")
    capacity = instance.fleet.capacity
    if capacity is not None and not capacity > 0:
        fail(("fleet", "capacity"), "debe ser mayor que 0 o nulo")
    for name, weight in instance.cost_profile.model_dump().items():
        if not weight >= 0:
            fail(("cost_profile", name), "debe ser mayor o igual que 0")
    for i, c in enumerate(instance.customers):
        if not c.demand >= 0:
            fail(("customers", i, "demand"), "debe ser mayor o igual que 0")
        if not c.service >= 0:
            fail(("customers", i, "service"), "debe ser mayor o igual que 0")
        too_long(("customers", i, "address"), c.address, MAX_TEXT_LENGTH)
    if instance.matrix is not None:
        for name in ("distance", "time"):
            for i, row in enumerate(getattr(instance.matrix, name)):
                for j, cell in enumerate(row):
                    if not cell >= 0:
                        fail(("matrix", name, i, j), "debe ser mayor o igual que 0")
        for name in ("source", "distance_unit", "time_unit"):
            too_long(("matrix", name), getattr(instance.matrix, name), MAX_LABEL_LENGTH)
    windows = instance.traffic_profile or []
    if len(windows) > MAX_TRAFFIC_WINDOWS:
        fail(("traffic_profile",), f"como mucho {MAX_TRAFFIC_WINDOWS} franjas")
    for i, w in enumerate(windows):
        if not w.factor > 0:
            fail(("traffic_profile", i, "factor"), "debe ser mayor que 0")
        if not w.from_ < w.to:
            fail(("traffic_profile", i, "from"), "debe ser menor que `to`")
    if errors:
        raise HTTPException(422, errors[:MAX_ERRORS])


def _require_matrix(instance: Instance) -> None:
    if instance.matrix is None:
        raise HTTPException(
            422, [{"loc": "instance.matrix", "msg": "la matriz es obligatoria"}]
        )


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ParseCsvRequest(_Request):
    csv: str = Field(max_length=100_000)
    name: str = Field(max_length=MAX_TEXT_LENGTH)
    fleet: Fleet


class GeocodeRequest(_Request):
    addresses: list[Annotated[str, Field(max_length=MAX_TEXT_LENGTH)]] = Field(
        min_length=1, max_length=101
    )


class Point(_Request):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class MatrixRequest(_Request):
    points: list[Point] = Field(min_length=2, max_length=101)


class SolveRequest(_Request):
    instance: Instance
    method: Literal["heuristic", "aco", "ga", "tabu"]
    seed: int = Field(default=0, ge=0)
    time_limit_s: float = Field(default=30, gt=0, le=60)


class EvaluateRequest(_Request):
    instance: Instance
    routes: list[list[int]] = Field(max_length=MAX_ROUTES)

    @field_validator("routes")
    @classmethod
    def _total_ids(cls, routes: list[list[int]]) -> list[list[int]]:
        if sum(len(r) for r in routes) > MAX_ROUTE_IDS:
            raise ValueError(f"como mucho {MAX_ROUTE_IDS} identificadores en total")
        return routes


class SolveLlmRequest(_Request):
    instance: Instance
    model: str
    role: Literal["llm_direct", "llm_agent"]
    recheck: bool = False
    seed: int = Field(default=0, ge=0)


class ExplainRequest(EvaluateRequest):
    method: str = Field(max_length=40)
    model: str


class HealthResponse(BaseModel):
    status: str
    version: str


class ModelInfo(BaseModel):
    model_id: str
    price_in_per_mtok: float
    price_out_per_mtok: float
    currency: str
    source_url: str
    checked_on: str


class ModelsResponse(BaseModel):
    provider: str
    models: list[ModelInfo]


class GeocodeResponse(BaseModel):
    results: list[geo.GeocodeResult]


class ExplainResponse(BaseModel):
    text: str
    model_returned: str
    tokens_in: int
    tokens_out: int
    api_cost_eur: float
    stop_reason: str


class ErrorDetail(BaseModel):
    detail: str


class ValidationErrorItem(BaseModel):
    loc: str
    msg: str


class ValidationErrorResponse(BaseModel):
    detail: list[ValidationErrorItem]


class CsvErrorItem(BaseModel):
    row: int
    msg: str


class CsvErrorResponse(BaseModel):
    detail: list[CsvErrorItem]


_ERRORS: dict[int, dict[str, Any]] = {
    401: {"model": ErrorDetail, "description": "Falta X-LLM-Key o se rechaza la clave"},
    411: {"model": ErrorDetail, "description": "Falta la cabecera Content-Length"},
    413: {
        "model": ErrorDetail,
        "description": f"Cuerpo de más de {MAX_BODY_BYTES // 1_000_000} MB",
    },
    422: {"model": ValidationErrorResponse, "description": "Petición no válida"},
    429: {"model": ErrorDetail, "description": "Tope diario o límite de uso alcanzado"},
    500: {"model": ErrorDetail, "description": "Error interno"},
    502: {"model": ErrorDetail, "description": "Fallo del proveedor del LLM"},
    503: {"model": ErrorDetail, "description": "Servicio no disponible u ocupado"},
}
_POST_ERRORS = (411, 413, 422)
_LLM_ERRORS = (401, *_POST_ERRORS, 429, 502)


def _responses(*codes: int) -> dict[int | str, dict[str, Any]]:
    """Errores que declara una ruta en el OpenAPI: `codes` y el 500, que puede dar
    cualquiera. Declarar el 422 sustituye al de FastAPI, cuyo esquema no es el que
    devuelve `_validation_error`."""
    return {code: dict(_ERRORS[code]) for code in (*codes, 500)}


@app.get("/health", responses=_responses())
def health() -> HealthResponse:
    return HealthResponse(status="ok", version=version("vrptw"))


@app.get("/models", responses=_responses())
def models() -> ModelsResponse:
    keys = (
        "model_id",
        "price_in_per_mtok",
        "price_out_per_mtok",
        "currency",
        "source_url",
        "checked_on",
    )
    return ModelsResponse(
        provider="anthropic",
        models=[
            ModelInfo(**{k: m[k] for k in keys}) for m in anthropic_prices().values()
        ],
    )


@app.post(
    "/instances/parse-csv",
    responses={
        **_responses(*_POST_ERRORS),
        422: {
            "model": ValidationErrorResponse | CsvErrorResponse,
            "description": "Petición no válida (`loc`) o CSV con errores (`row`)",
        },
    },
)
def parse_csv(req: ParseCsvRequest) -> Instance:
    try:
        depot, customers = parse_real_csv(req.csv)
    except CsvFormatError as exc:
        rows = exc.errors or [(0, str(exc))]
        raise HTTPException(
            422, [{"row": row, "msg": msg} for row, msg in rows[:MAX_ERRORS]]
        ) from None
    instance = Instance(
        id="csv",
        name=req.name,
        source="real",
        depot=depot,
        customers=customers,
        fleet=req.fleet,
        cost_profile=SOLOMON,
    )
    check_public(instance)
    return instance.model_copy(update={"id": "csv-" + instance.content_hash()[:8]})


@app.post("/geocode", responses=_responses(*_POST_ERRORS, 429, 503))
def geocode(req: GeocodeRequest) -> GeocodeResponse:
    key = os.environ.get("GEOAPIFY_API_KEY", "")
    if not key:
        raise HTTPException(503, "Geocodificación no disponible: falta configurarla")
    if not _GEOCODE_QUOTA.take(len(req.addresses)):
        raise HTTPException(
            429,
            f"Tope diario de geocodificación alcanzado ({GEOCODE_DAILY_MAX} "
            "direcciones): se renueva a las 00:00 UTC. Mientras tanto, el CSV "
            "admite LAT y LON en lugar de ADDRESS",
        )
    try:
        return GeocodeResponse(results=geo.geocode(req.addresses, key))
    except geo.GeoError as exc:
        raise HTTPException(503, str(exc)) from None


@app.post("/matrix", responses=_responses(*_POST_ERRORS))
def matrix(req: MatrixRequest) -> Matrix:
    points = [(p.lat, p.lon) for p in req.points]
    key = os.environ.get("ORS_API_KEY", "")
    if key and not _MATRIX_QUOTA.take(1):
        logger.warning("tope diario de /matrix alcanzado: se usa la línea recta")
    elif key:
        try:
            return geo.road_matrix(points, key)
        except geo.GeoError as exc:
            kind = exc.kind
        logger.warning("matriz por carretera no disponible (%s): línea recta", kind)
    return geo.haversine_matrix(points)


@app.post("/solve/classic", responses=_responses(*_POST_ERRORS, 503))
def solve_classic(req: SolveRequest) -> RunRecord:
    check_public(req.instance)
    _require_matrix(req.instance)
    if not _SOLVE_LOCK.acquire(blocking=False):
        raise HTTPException(
            503, "Hay otro cálculo en curso", headers={"Retry-After": RETRY_AFTER_S}
        )
    try:
        return run_method(req.instance, req.method, req.seed, req.time_limit_s)
    finally:
        _SOLVE_LOCK.release()


@app.post("/evaluate", responses=_responses(*_POST_ERRORS))
def evaluate_routes(req: EvaluateRequest) -> Evaluation:
    check_public(req.instance)
    _require_matrix(req.instance)
    return evaluate(req.instance, Solution(routes=req.routes))


def _api_key(value: str | None) -> str:
    """La clave de la cabecera `X-LLM-Key`; 401 si falta o está vacía."""
    if not value:
        raise HTTPException(401, "falta la cabecera X-LLM-Key")
    return value


def _check_model(model: str) -> None:
    if model not in anthropic_prices():
        raise HTTPException(422, [{"loc": "model", "msg": "modelo no disponible"}])


def _check_llm_instance(instance: Instance) -> None:
    """422 si `/solve/llm` no puede enviar `instance` al modelo sin cambiar el problema.

    El prompt de una instancia con coordenadas X/Y no lleva la matriz de tiempos, así
    que no admite perfil de tráfico. Las de Solomon se camuflan (giro de coordenadas,
    clientes renumerados de 1 a n y matriz euclídea recalculada): necesitan
    coordenadas en todos los nodos, clientes numerados de 1 a n y una matriz que sea
    la euclídea de esas coordenadas, truncada si `matrix.source` lo dice, como en
    `camouflage`.
    """

    def fail(loc: str, msg: str) -> NoReturn:
        raise HTTPException(422, [{"loc": loc, "msg": msg}])

    if instance.depot.x is not None and instance.traffic_profile:
        fail(
            "instance.traffic_profile", "el tráfico solo se admite en casos sobre mapa"
        )
    if instance.source != "solomon":
        return
    nodes: list[Depot | Customer] = [instance.depot, *instance.customers]
    if any(node.x is None or node.y is None for node in nodes):
        fail(
            "instance",
            "una instancia de Solomon necesita coordenadas x, y en todos los nodos",
        )
    n = len(instance.customers)
    if sorted(c.id for c in instance.customers) != list(range(1, n + 1)):
        fail(
            "instance.customers",
            f"en una instancia de Solomon los clientes se numeran de 1 a {n}",
        )
    matrix = instance.matrix
    assert matrix is not None  # `_require_matrix`
    expected = euclidean_matrix(
        coordinates(instance.depot, instance.customers),
        truncated=matrix.source == "euclidean_truncated",
    )
    rows = [*zip(matrix.distance, expected.distance), *zip(matrix.time, expected.time)]
    if not all(
        math.isclose(a, b, rel_tol=SOLOMON_MATRIX_TOL, abs_tol=SOLOMON_MATRIX_TOL)
        for got, want in rows
        for a, b in zip(got, want)
    ):
        fail(
            "instance.matrix",
            "en una instancia de Solomon la matriz debe ser la euclídea de las "
            "coordenadas (truncada si `source` es `euclidean_truncated`)",
        )


def _provider(fake: Callable[[], LLMResponse]) -> tuple[str, Provider | None]:
    """Nombre del proveedor y su `call`; con `VRPTW_LLM_PROVIDER=fake`, uno falso."""
    if os.environ.get("VRPTW_LLM_PROVIDER", "anthropic") == "fake":
        return "fake", make_fake(lambda messages, tools: fake())
    return "anthropic", None


def _guarded[T](work: Callable[[], T]) -> T:
    """Ejecuta `work` traduciendo sus fallos a respuestas HTTP sin datos de la petición.

    `ProviderError`: 401 (`auth`), 429 (`rate_limit`) o 502, con su mensaje, ya
    saneado. Cualquier otra excepción: 500 y solo el nombre de su tipo en el log,
    nunca el mensaje ni la traza. La respuesta se lanza fuera del `except`, para no
    arrastrar la excepción original en `__context__`, y el log se escribe también
    fuera: si un manejador fallara dentro, `logging` imprimiría en la salida de
    error la excepción en curso, con su mensaje.
    """
    error: HTTPException
    unexpected: str | None = None
    try:
        return work()
    except HTTPException:
        raise
    except ProviderError as exc:
        status = {"auth": 401, "rate_limit": 429}.get(exc.kind, 502)
        error = HTTPException(status, str(exc))
    except Exception as exc:  # noqa: BLE001 (ver el docstring)
        unexpected = type(exc).__name__
        error = HTTPException(500, "error interno")
    if unexpected is not None:
        logger.error("error interno en el servicio LLM: %s", unexpected)
    raise error


@app.post("/solve/llm", responses=_responses(*_LLM_ERRORS))
def solve_llm(
    req: SolveLlmRequest, x_llm_key: Annotated[str | None, Header()] = None
) -> RunRecord:
    key = _api_key(x_llm_key)
    check_public(req.instance)
    _require_matrix(req.instance)
    _check_model(req.model)
    _check_llm_instance(req.instance)

    def work() -> RunRecord:
        original = req.instance
        sent = camouflage(original) if original.source == "solomon" else original

        def fake() -> LLMResponse:
            solution = solve_heuristic(sent)
            reply = {"routes": solution.routes, "score": evaluate(sent, solution).score}
            return LLMResponse(text=f"```json\n{json.dumps(reply)}\n```", model="fake")

        provider, call = _provider(fake)
        max_tokens = max_tokens_for(len(sent.customers))
        if req.role == "llm_direct":
            record = solve_direct(
                sent, provider, req.model, key, max_tokens, req.recheck, call
            )
        else:
            record = solve_agent(
                sent,
                provider,
                req.model,
                key,
                max_tokens,
                seed=req.seed,
                call=call,
                output_budget=max_tokens,
                max_tool_time_s=MAX_TOOL_TIME_S,
            )
        if sent is original:
            return record
        solution = None
        if record.solution is not None:
            solution = Solution(routes=restore_routes(original, record.solution.routes))
        return record.model_copy(
            update={
                "instance_id": original.id,
                "instance_hash": original.content_hash(),
                "solution": solution,
                "evaluation": evaluate(original, solution) if solution else None,
                "params": {**record.params, "camouflaged": True},
            }
        )

    return _guarded(work)


@app.post("/explain", responses=_responses(*_LLM_ERRORS))
def explain(
    req: ExplainRequest, x_llm_key: Annotated[str | None, Header()] = None
) -> ExplainResponse:
    key = _api_key(x_llm_key)
    check_public(req.instance)
    _require_matrix(req.instance)
    _check_model(req.model)

    def work() -> ExplainResponse:
        # Las cifras las calcula el servidor, no el cliente.
        evaluation = evaluate(req.instance, Solution(routes=req.routes))
        prompt = explain_prompt(req.instance, evaluation, req.method)
        provider, call = _provider(
            lambda: LLMResponse(text=FAKE_EXPLANATION, model="fake")
        )
        send: Provider = call or PROVIDERS[provider]
        response = send(
            [{"role": "user", "content": prompt}],
            [],
            req.model,
            key,
            EXPLAIN_MAX_TOKENS,
        )
        cost = call_cost(req.model, response.tokens_in, response.tokens_out)
        return ExplainResponse(
            text=response.text,
            model_returned=response.model,
            tokens_in=response.tokens_in,
            tokens_out=response.tokens_out,
            api_cost_eur=cost.eur,
            stop_reason=response.stop_reason,
        )

    return _guarded(work)
