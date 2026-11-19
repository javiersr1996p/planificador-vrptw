"""Exportación de los casos de ejemplo de la web a `web/public/data/`.

Escribe, para cada caso de `EXAMPLE_CASES`:

- `cases/<id>.json` con `{instance, runs, built_on, attribution, note}`;
- `index.json` con la lista de casos;
- `plantilla_caso_real.csv`, copia de la plantilla de `api/data/`.

No llama a ninguna API ni a la red: los registros LLM se leen de `api/runs/llm/` y los
clásicos se calculan en local con la semilla 0, sin límite de tiempo. Un clásico ya
exportado se reutiliza si el hash de la instancia no ha cambiado; así, exportar dos
veces no cambia ningún byte. Los casos de Madrid se construyen con
`scripts/build_real_cases.py` y aquí solo se rellena `runs`.

Registros LLM (solo en los casos del benchmark): por cada papel y modelo, el de la
repetición 0 con `max_tokens` 16000 y el corte de herramienta del servicio en vivo
(`MAX_TOOL_TIME_S`). En Solomon el registro es de la instancia camuflada: sus rutas se
traducen con `restore_routes`, se reevalúan en la original y `params` lleva
`camouflaged: true`, como hace `/solve/llm`; `tool_calls` conserva la numeración
camuflada; `instance_id` e `instance_hash` son los de la instancia original. Se quita `messages` (el prompt completo sigue en `api/runs/llm/`, localizable
por `run_id`).
"""

import json
import shutil
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

from vrptw.bench.estimate import MODELS, ROLES
from vrptw.bench.llm_run import DEFAULT_OUT_DIR, Job
from vrptw.cli import API_DIR, run_method
from vrptw.evaluate import evaluate
from vrptw.instances.camouflage import camouflage, restore_routes
from vrptw.instances.solomon import load_solomon
from vrptw.instances.tfe2024 import load_tfe2024
from vrptw.llm.agent import MAX_TOOL_TIME_S
from vrptw.model import Customer, Depot, Instance, RunRecord, Solution
from vrptw.solvers.registry import SOLVERS

DEFAULT_OUT = API_DIR.parent / "web" / "public" / "data"
TEMPLATE = API_DIR / "data" / "plantilla_caso_real.csv"
EXAMPLE_CASES = (
    "madrid-12",
    "madrid-25",
    "tfe2024-10c-1",
    "c101-25-trunc",
    "r101-100-trunc",
)
DEFAULT_CASE = "madrid-12"
REAL_CASES = ("madrid-12", "madrid-25")
LLM_MAX_TOKENS = 16_000
SEED = 0

SOLOMON_ATTRIBUTION = (
    "Instancias de Solomon: M. M. Solomon (1987), Algorithms for the vehicle routing "
    "and scheduling problems with time window constraints, Operations Research, "
    "35(2):254-265. Ficheros de SINTEF (proyecto TOP): "
    "https://www.sintef.no/projectweb/top/vrptw/100-customers/"
)
TFE_ATTRIBUTION = (
    "Problemas del trabajo de 2024 sobre VRPTW (repositorio público "
    "https://github.com/oscarsr96/tfm_vrptw_osr_jsr/)."
)


def _solomon(name: str, n: int) -> Callable[[], tuple[Instance, str, str]]:
    def build() -> tuple[Instance, str, str]:
        note = (
            f"Instancia {name} de Solomon (1987) recortada a los {n} primeros clientes, "
            "con distancias euclídeas truncadas a un decimal (descarga de SINTEF: "
            "https://www.sintef.no/globalassets/project/top/vrptw/solomon/solomon-100.zip)."
            " Los resultados LLM se obtuvieron sobre una versión camuflada de la "
            "instancia; las rutas se traducen y se evalúan sobre esta."
        )
        instance = load_solomon(name, n, truncated=True)
        instance = instance.model_copy(update={"name": f"Solomon {name}, {n} clientes"})
        return instance, SOLOMON_ATTRIBUTION, note

    return build


def _tfe(label: str) -> Callable[[], tuple[Instance, str, str]]:
    def build() -> tuple[Instance, str, str]:
        note = (
            f"Problema {label} del trabajo de 2024, con distancias euclídeas y el "
            "perfil de coste de aquel trabajo."
        )
        instance = load_tfe2024(label).model_copy(
            update={"name": f"TFE 2024: problema {label}"}
        )
        return instance, TFE_ATTRIBUTION, note

    return build


# Casos que no son de Madrid: id -> (instancia, atribución, nota)
BUILDERS: dict[str, Callable[[], tuple[Instance, str, str]]] = {
    "tfe2024-10c-1": _tfe("10c-1"),
    "c101-25-trunc": _solomon("C101", 25),
    "r101-100-trunc": _solomon("R101", 100),
}
# Casos con registros LLM guardados
LLM_CASES = tuple(BUILDERS)


def _json(value: Any, indent: str = "") -> str:
    """JSON con sangría de 2 y las listas de números en una sola línea."""
    inner = indent + "  "
    if isinstance(value, dict) and value:
        items = [
            f"{inner}{json.dumps(k, ensure_ascii=False)}: {_json(v, inner)}"
            for k, v in value.items()
        ]
        return "{\n" + ",\n".join(items) + f"\n{indent}}}"
    if isinstance(value, list) and value:
        if all(isinstance(v, int | float) and not isinstance(v, bool) for v in value):
            return json.dumps(value)
        items = [inner + _json(v, inner) for v in value]
        return "[\n" + ",\n".join(items) + f"\n{indent}]"
    return json.dumps(value, ensure_ascii=False)


def _dump(data: Any) -> bytes:
    return (_json(data) + "\n").encode("utf-8")


def _read(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return data


def classic_runs(instance: Instance, previous: list[dict[str, Any]]) -> list[RunRecord]:
    """Un registro por método clásico, reutilizando los ya exportados si valen.

    Del reutilizado solo se recalcula la evaluación, para que lleve todos los campos
    actuales; ruta, `run_id` y el resto no cambian.
    """
    digest = instance.content_hash()
    kept = {
        r["method"]: r
        for r in previous
        if r["role"] == "classic"
        and r["seed"] == SEED
        and r["instance_hash"] == digest
        and r["params"] == {}
    }
    return [
        _reevaluated(instance, RunRecord.model_validate(kept[m]))
        if m in kept
        else run_method(instance, m, SEED)
        for m in SOLVERS
    ]


def _reevaluated(instance: Instance, record: RunRecord) -> RunRecord:
    if record.solution is None:
        return record
    return record.model_copy(update={"evaluation": evaluate(instance, record.solution)})


def llm_runs(original: Instance, runs_dir: Path) -> list[RunRecord]:
    """Los seis registros LLM de un caso del benchmark, listos para exportar."""
    camouflaged = original.source == "solomon"
    sent = camouflage(original) if camouflaged else original
    records: list[RunRecord] = []
    for role in ROLES:
        for model in MODELS:
            job = Job(0, sent, model, role, 0, LLM_MAX_TOKENS, MAX_TOOL_TIME_S)
            path = runs_dir / f"{job.stem}.json"
            if not path.exists():
                raise FileNotFoundError(f"falta el registro LLM {path.name}")
            record = RunRecord.model_validate_json(path.read_text(encoding="utf-8"))
            if record.instance_hash != sent.content_hash():
                raise ValueError(f"{path.name}: el hash no es el de la instancia")
            solution = record.solution
            if solution is not None and camouflaged:
                solution = Solution(routes=restore_routes(original, solution.routes))
            records.append(
                record.model_copy(
                    update={
                        "instance_id": original.id,
                        "instance_hash": original.content_hash(),
                        "solution": solution,
                        "evaluation": (
                            None if solution is None else evaluate(original, solution)
                        ),
                        "params": (
                            {**record.params, "camouflaged": True}
                            if camouflaged
                            else record.params
                        ),
                    }
                )
            )
    return records


def _run_json(record: RunRecord) -> dict[str, Any]:
    return record.model_dump(mode="json", by_alias=True, exclude={"messages"})


def _has_map(instance: Instance) -> bool:
    nodes: list[Depot | Customer] = [instance.depot, *instance.customers]
    return all(n.lat is not None and n.lon is not None for n in nodes)


def _case_payload(
    case: str, out: Path, runs_dir: Path
) -> tuple[dict[str, Any], Instance]:
    path = out / "cases" / f"{case}.json"
    previous = _read(path)
    if case in REAL_CASES:
        if previous is None:
            raise FileNotFoundError(
                f"falta {path.name}: constrúyelo antes con scripts/build_real_cases.py"
            )
        payload = previous
        instance = Instance.model_validate(payload["instance"])
    else:
        instance, attribution, note = BUILDERS[case]()
        payload = {
            "instance": instance.model_dump(mode="json", by_alias=True),
            "runs": [],
            "built_on": previous["built_on"] if previous else date.today().isoformat(),
            "attribution": attribution,
            "note": note,
        }
    records = classic_runs(instance, previous["runs"] if previous else [])
    if case in LLM_CASES:
        records += llm_runs(instance, runs_dir)
    payload["runs"] = [_run_json(r) for r in records]
    return payload, instance


def export(out: Path = DEFAULT_OUT, runs_dir: Path = DEFAULT_OUT_DIR) -> list[Path]:
    """Escribe los ficheros de la web en `out` y devuelve sus rutas."""
    (out / "cases").mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    index: list[dict[str, Any]] = []
    for case in EXAMPLE_CASES:
        payload, instance = _case_payload(case, out, runs_dir)
        path = out / "cases" / f"{case}.json"
        path.write_bytes(_dump(payload))
        written.append(path)
        index.append(
            {
                "id": instance.id,
                "name": instance.name,
                "source": instance.source,
                "customers": len(instance.customers),
                "vehicles": instance.fleet.vehicles,
                "has_map": _has_map(instance),
                "methods": list(dict.fromkeys(r["method"] for r in payload["runs"])),
                "default": case == DEFAULT_CASE,
            }
        )
    index_path = out / "index.json"
    index_path.write_bytes(_dump({"cases": index}))
    template = out / TEMPLATE.name
    shutil.copyfile(TEMPLATE, template)
    return [index_path, *written, template]
