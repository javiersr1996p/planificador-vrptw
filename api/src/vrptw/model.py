"""Modelo de datos del planificador VRPTW."""

import hashlib
import json
from datetime import datetime
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_CUSTOMERS = 100


class CostProfile(BaseModel):
    model_config = ConfigDict(frozen=True)

    w_wait: float
    w_late: float
    w_vehicle: float
    w_unserved: float
    w_overload: float


TFE = CostProfile(w_wait=10, w_late=10, w_vehicle=1000, w_unserved=10000, w_overload=0)
SOLOMON = CostProfile(
    w_wait=0, w_late=1000, w_vehicle=0, w_unserved=10000, w_overload=1000
)


class Depot(BaseModel):
    id: Literal[0] = 0
    x: float | None = None
    y: float | None = None
    lat: float | None = None
    lon: float | None = None
    ready: float
    due: float | None = None

    @model_validator(mode="after")
    def _window(self) -> Self:
        if self.due is not None and self.ready > self.due:
            raise ValueError("depot ready > due")
        return self


class Customer(BaseModel):
    id: int
    x: float | None = None
    y: float | None = None
    lat: float | None = None
    lon: float | None = None
    address: str | None = None
    demand: float
    ready: float
    due: float
    service: float

    @model_validator(mode="after")
    def _window(self) -> Self:
        if self.ready > self.due:
            raise ValueError(f"customer {self.id}: ready > due")
        return self


class Fleet(BaseModel):
    vehicles: int
    capacity: float | None = None


class Matrix(BaseModel):
    """Indexada por posición: 0 es el depósito, i es `customers[i - 1]`.

    `source` es `euclidean`, `euclidean_truncated`, `haversine_fallback` o el
    nombre de un proveedor de rutas.
    """

    distance: list[list[float]]
    time: list[list[float]]
    source: str
    distance_unit: str
    time_unit: str


class TrafficWindow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: float = Field(alias="from")
    to: float
    factor: float


class Instance(BaseModel):
    id: str
    name: str
    source: Literal["solomon", "tfe2024", "real"]
    depot: Depot
    customers: list[Customer] = Field(min_length=1, max_length=MAX_CUSTOMERS)
    fleet: Fleet
    matrix: Matrix | None = None
    traffic_profile: list[TrafficWindow] | None = None
    cost_profile: CostProfile

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        ids = [c.id for c in self.customers]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate customer ids")
        if self.depot.id in ids:
            raise ValueError("customer id collides with the depot (0)")
        if self.matrix is not None:
            n = len(ids) + 1
            for m in (self.matrix.distance, self.matrix.time):
                if len(m) != n or any(len(row) != n for row in m):
                    raise ValueError(f"matrix must be {n}x{n}")
        return self

    def content_hash(self) -> str:
        """SHA-256 del contenido canónico, sin `id` ni `name`."""
        content = self.model_dump(mode="json", exclude={"id", "name"})
        canonical = json.dumps(content, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()


class Solution(BaseModel):
    routes: list[list[int]]


class StopEvaluation(BaseModel):
    customer: int
    arrival: float
    start: float
    wait: float
    late: float
    load: float


class Violation(BaseModel):
    type: Literal[
        "capacity",
        "late",
        "unserved",
        "duplicate",
        "unknown_customer",
        "fleet_exceeded",
        "depot_due",
    ]
    route: int | None = None
    customer: int | None = None


class Evaluation(BaseModel):
    stops: list[list[StopEvaluation]]
    distance: float
    total_wait: float
    total_late: float
    vehicles_used: int
    unserved: int
    overload: float
    score: float
    violations: list[Violation]
    feasible: bool


class RunRecord(BaseModel):
    run_id: str
    date: datetime
    git_sha: str
    hardware: str
    instance_id: str
    instance_hash: str
    method: str
    role: Literal["classic", "llm_direct", "llm_agent"]
    seed: int
    params: dict[str, Any]
    # Solo LLM
    provider: str | None = None
    model_requested: str | None = None
    model_returned: str | None = None
    prompt_version: str | None = None
    messages: list[dict[str, Any]] | None = None
    raw_response: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    api_cost: float | None = None  # USD
    api_cost_eur: float | None = None
    price_table_version: str | None = None
    stop_reason: str | None = None  # de la última respuesta del modelo
    self_reported_score: float | None = None
    wall_time_s: float
    solution: Solution | None = None
    evaluation: Evaluation | None = None
    parse_status: Literal["ok", "unparseable", "timeout", "refused"]
