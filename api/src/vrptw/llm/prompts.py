"""Prompts con los que un LLM resuelve instancias VRPTW.

Adaptados del prompt definitivo del TFE de 2024 (p. 75 a 78) y de su segundo
prompt de comprobación (p. 79). Los textos son en inglés, como los de 2024. Las
diferencias respecto a 2024 están en `docs/prompts.md`.
"""

from vrptw.model import SOLOMON, Evaluation, Instance

# Cualquier cambio en el texto de los prompts (o en las descripciones de las
# herramientas del agente, en `agent.py`) exige cambiar esta cadena.
PROMPT_VERSION = "vrptw-prompt-3"

# Frase que se añade con el perfil SOLOMON: ventanas y capacidad son restricciones duras.
HARD_CONSTRAINTS = (
    "Time windows and vehicle capacity are hard constraints: the delivery must "
    "start no later than DUE TIME, and the load of each vehicle cannot exceed its "
    "capacity. A solution with any late arrival or any excess load is infeasible, "
    "and the penalty weights above only discourage that, they do not make it "
    "acceptable. Among feasible solutions, the best one is the one with the "
    "smallest total distance (truncated to one decimal)."
)

_FIELDS = "CUSTOMER,X,Y,DEMAND,READY_TIME,DUE_TIME,SERVICE_TIME"
_FIELDS_NO_XY = "CUSTOMER,DEMAND,READY_TIME,DUE_TIME,SERVICE_TIME"


def _n(value: float) -> str:
    return format(value, ".10g")


def _table(instance: Instance) -> str:
    """Tabla CSV de clientes, sin el depósito. Sin coordenadas cartesianas se omiten X e Y."""
    cartesian = instance.depot.x is not None
    rows = [_FIELDS if cartesian else _FIELDS_NO_XY]
    for c in instance.customers:
        xy = (
            [_n(c.x), _n(c.y)]
            if cartesian and c.x is not None and c.y is not None
            else []
        )
        rest = [_n(c.demand), _n(c.ready), _n(c.due), _n(c.service)]
        rows.append(",".join([str(c.id), *xy, *rest]))
    return "\n".join(rows)


def _matrix(instance: Instance, *, distance: bool = False) -> str:
    """Matriz de tiempos (o de distancias) de viaje para instancias sin coordenadas."""
    if instance.matrix is None:
        raise ValueError(f"instance {instance.id}: no coordinates and no travel matrix")
    values = instance.matrix.distance if distance else instance.matrix.time
    return "\n".join(",".join(_n(v) for v in row) for row in values)


def _traffic_table(instance: Instance) -> str:
    """Tabla CSV de las franjas del perfil de tráfico."""
    rows = ["FROM,TO,FACTOR"]
    for w in instance.traffic_profile or ():
        rows.append(f"{_n(w.from_)},{_n(w.to)},{_n(w.factor)}")
    return "\n".join(rows)


def _score_rule(instance: Instance, dist_unit: str, time_unit: str) -> str:
    """Descripción del score a partir de los pesos del perfil de coste de la instancia."""
    p = instance.cost_profile
    capacity = instance.fleet.capacity
    terms = [f"{_n(p.w_unserved)} x unattended customers"]
    free = []
    if p.w_vehicle:
        terms.append(f"{_n(p.w_vehicle)} x vehicles used")
    else:
        free.append("the number of vehicles used")
    terms.append("sum of the ACCUMULATED DISTANCE of each vehicle")
    if p.w_wait:
        terms.append(f"{_n(p.w_wait)} x sum of WAITING TIME")
    else:
        free.append("WAITING TIME")
    if p.w_late:
        terms.append(f"{_n(p.w_late)} x sum of LATE ARRIVAL TIME")
    else:
        free.append("LATE ARRIVAL TIME")
    if capacity is not None:
        if p.w_overload:
            terms.append(
                f"{_n(p.w_overload)} x units of load above the vehicle capacity"
            )
        else:
            free.append("load above the vehicle capacity")
    text = (
        "Give the Score of the solution. Final score = "
        + " + ".join(terms)
        + ". As you see, for calculating the score, the most heavily penalized "
        "items are the ones with the largest weights above."
    )
    if free:
        text += f" These items have no cost in the score: {', '.join(free)}."
    if instance.matrix is not None and instance.matrix.source == "euclidean_truncated":
        text += (
            f" Distances are Euclidean distances truncated to one decimal: each leg "
            f"between two points measures floor(10 x d) / 10 {dist_unit}s, where d is "
            f"the exact Euclidean distance. Use these truncated leg distances in every "
            f"calculation."
        )
    return text


def solve_prompt(instance: Instance) -> str:
    """Prompt de resolución para `instance`."""
    d_unit, t_unit = (
        ("kilometer", "minute")
        if instance.source in ("tfe2024", "real")
        else ("distance unit", "time unit")
    )
    n = len(instance.customers)
    k = instance.fleet.vehicles
    capacity = instance.fleet.capacity
    depot = instance.depot
    cartesian = depot.x is not None
    matrix = instance.matrix
    # Con matrices distintas o con perfil de tráfico, el tiempo de viaje no es la distancia.
    separate = not cartesian and matrix is not None and matrix.distance != matrix.time
    timed = separate or bool(instance.traffic_profile)
    hard = HARD_CONSTRAINTS
    if instance.source == "real":
        # Las distancias por carretera no se truncan; las de Solomon, sí.
        hard = hard.replace(" (truncated to one decimal)", "")

    if cartesian:
        where = (
            f"located with their (X,Y) coordinates, all measured in {d_unit}s from "
            f"the origin. The vehicles start from the depot (Customer 0) in the "
            f"position ({_n(depot.x or 0)},{_n(depot.y or 0)})"
        )
    else:
        where = (
            f"whose travel {'times and distances are' if separate else 'times are'} "
            f"given in {'matrices' if separate else 'a matrix'}. The vehicles start "
            f"from the depot (Customer 0)"
        )
    if capacity is None:
        cap = "There is no capacity limit for the vehicles."
    else:
        cap = (
            f"Each vehicle has a capacity of {_n(capacity)}, and each customer has a "
            f"DEMAND that is loaded in the vehicle that serves it. The sum of the "
            f"demands of the customers of one route must not exceed the capacity."
        )
    depot_due = (
        f"; they must be back at the depot no later than {_n(depot.due)}; arriving "
        f"later counts as LATE ARRIVAL TIME at the depot"
        if depot.due is not None
        else ""
    )

    lines = [
        "Don't give example, hypothetical or sample answers. The audience is academic.",
        (
            "Today you are going to be an expert in solving VRPTW problems. "
            "You need to solve a VRPTW problem."
        ),
        "Next, you have the description of the problem:",
        (
            f"We have {n} customers, {where}, and need to attend to the customers. "
            f"We can use at most {k} vehicles, all leaving the depot at time "
            f"{_n(depot.ready)}{depot_due}. {cap} The vehicles altogether must reach "
            f"all customers."
        ),
        (
            "We are looking for the optimal routes in terms of the score that the "
            "vehicles must take in order to deliver to all customers, if possible. "
            "The calculation of the score is explained later."
        ),
        (
            (
                f"The vehicles travel on the road network, so the travel time between "
                f"two points (in {t_unit}s) and the travel distance (in {d_unit}s) are "
                f"different quantities. "
                if timed
                else (
                    f"To simplify the problem, we will consider a uniform vehicle "
                    f"velocity of 1 {d_unit} per {t_unit}, so the travel time between "
                    f"two points equals the travel distance. "
                )
            )
            + f"Key concepts: The time window of the customer is "
            f"explicit in the READY TIME and DUE TIME columns, meaning that the customer "
            f"is only available for delivery between the READY TIME value and the DUE "
            f"TIME value. These values are expressed in {t_unit}s. The SERVICE TIME "
            f"column is the other critical one, it represents the time that the vehicles "
            f"need to deliver to the customer and it is also expressed in {t_unit}s. "
            f"In other words, the delivery must start between READY TIME and DUE TIME "
            f"and the delivery lasts SERVICE TIME {t_unit}s."
        ),
        (
            "If it is not possible to reach all customers, the better solution would be "
            "the one where most customers are attended."
        ),
        (
            "You can use modern approaches to solve VRPTW problem, such as: Branch and "
            "Price, Branch and Cut, Dynamic Programming with State Space Relaxation, "
            "Lagrangian Relaxation, Heuristic Search with Relaxation."
        ),
        (
            "For each vehicle, compute the visits one after another with these "
            "quantities, as floats:"
        ),
        (
            "- TRAVEL STARTS AT: the time the vehicle leaves the previous point (the "
            "depot or the previous customer)."
        ),
        *(
            [
                (
                    "- TRAVEL TIME: the time the vehicle takes from the previous point "
                    "to the customer."
                ),
                (
                    "- TRAVEL DISTANCE: the distance from the previous point to the "
                    "customer."
                ),
                "- ARRIVAL TIME = TRAVEL STARTS AT + TRAVEL TIME.",
            ]
            if timed
            else [
                (
                    "- TRAVEL DISTANCE: the distance from the previous point to the "
                    "customer."
                ),
                "- ARRIVAL TIME = TRAVEL STARTS AT + TRAVEL DISTANCE.",
            ]
        ),
        (
            "- WAITING TIME: if ARRIVAL TIME < READY TIME then READY TIME - ARRIVAL "
            "TIME, otherwise 0. The vehicle waits until READY TIME."
        ),
        (
            "- LATE ARRIVAL TIME: if ARRIVAL TIME > DUE TIME then ARRIVAL TIME - DUE "
            "TIME, otherwise 0."
        ),
        "- ENDS DELIVERY AT = max(ARRIVAL TIME, READY TIME) + SERVICE TIME.",
        "- ACCUMULATED DISTANCE: the distance travelled by the vehicle so far.",
        (
            "Remember that, for next travel, TRAVEL STARTS AT = ENDS DELIVERY AT. And "
            "all vehicles must return to the depot once they have finished the routes. "
            "This TRAVEL DISTANCE must be taken into account in the ACCUMULATED DISTANCE."
        ),
        _score_rule(instance, d_unit, t_unit),
        *([hard] if instance.cost_profile == SOLOMON else []),
        (
            "A vehicle can visit one or more than one customer, not all vehicles must "
            "visit the same number of customers, and vehicles that visit no customer "
            "are not used. Have in mind that it can be better not using all vehicles, "
            "because this could lead to a better solution than using all vehicles."
        ),
        "Read all information carefully in order to give the solution.",
        "It is mandatory for you that you dont have to provide any code.",
        (
            "It is mandatory for you to give a solution that you can afford "
            "computationally."
        ),
        "Do not give example, hypothetical or sample answers.",
        (
            "The data of the problem follows, one customer per row (the depot is "
            "Customer 0 and is not in the table):"
        ),
        _table(instance),
    ]
    if not cartesian:
        order = (
            "Row 0 is the depot and row i is the i-th customer of the table above, "
            "in the same order."
        )
        if separate:
            lines += [
                (
                    f"Travel time matrix: row i and column j give the travel time, in "
                    f"{t_unit}s, from point i to point j. {order}"
                ),
                _matrix(instance),
                (
                    f"Travel distance matrix: row i and column j give the travel "
                    f"distance, in {d_unit}s, from point i to point j, with the same "
                    f"row order."
                ),
                _matrix(instance, distance=True),
            ]
        else:
            lines += [
                (
                    "Travel time matrix: row i and column j give the travel time (and "
                    f"distance) from point i to point j. {order}"
                ),
                _matrix(instance),
            ]
    if instance.traffic_profile:
        lines += [
            (
                "The travel time of each leg is the value of the travel time matrix "
                "multiplied by a factor that depends on the time at which the vehicle "
                "leaves the previous point (TRAVEL STARTS AT): the FACTOR of the slot "
                f"[FROM, TO) that contains that time, in {t_unit}s, or 1 if it is "
                "outside all slots (if slots overlap, the first one listed applies)."
            ),
            _traffic_table(instance),
        ]
    lines += [
        "Remember the goals: vehicle route data and the score of the problem.",
        (
            "It is mandatory that your answer ends with a single JSON block, and "
            "nothing after it, with exactly this format: "
            '{"routes": [[...], ...], "score": number}. '
            '"routes" has one list per vehicle used, with the CUSTOMER numbers of the '
            "customers in the order they are visited (do not include the depot, "
            'Customer 0), and "score" is the final score of that solution.'
        ),
    ]
    return "\n".join(lines) + "\n"


def agent_prompt(instance: Instance, max_turns: int) -> str:
    """Prompt del LLM como agente: el de resolución más el uso de las herramientas.

    Incluye `max_turns` para que el modelo sepa cuándo debe dar la respuesta final.
    """
    lines = [
        "You can use two tools on this instance:",
        (
            "- solve_classic runs one of the classic VRPTW methods of the application "
            "and returns its routes with their evaluation: score, total distance, "
            "vehicles used, unattended customers, whether the solution is feasible and "
            "the number of violations of each type."
        ),
        (
            "- evaluate_routes returns the same evaluation for the routes you give it. "
            "It is the evaluator that will judge your final answer, and it computes "
            "the score with the rule above."
        ),
        (
            "Use the tools as you see fit: for example, run several methods, compare "
            "their evaluations, try to improve the best routes and check your changes "
            "with evaluate_routes. You can call several tools in the same turn."
        ),
        (
            f"You have at most {max_turns} turns, counting the one with your final "
            "answer. A turn in which you call a tool is not a final answer, so do not "
            "call any tool in your last turn."
        ),
        (
            "Your final solution is the one in the JSON block at the end of your final "
            "answer, not the output of a tool: write in that block the routes you "
            "choose, in the format described above."
        ),
    ]
    return solve_prompt(instance) + "\n".join(lines) + "\n"


def recheck_prompt() -> str:
    """Segundo prompt, que se envía tras la primera respuesta (TFE p. 79)."""
    return (
        "Do a careful re-examination of the solution. Is the score accurate? "
        "Review that all components of the score are well calculated. "
        "End your answer with a single JSON block, and nothing after it, with the "
        "final solution in the same format: "
        '{"routes": [[...], ...], "score": number}.\n'
    )


def explain_prompt(instance: Instance, evaluation: Evaluation, method: str) -> str:
    """Prompt para explicar en español una solución ya evaluada, sin la matriz."""
    d_unit, t_unit = (
        ("kilometers", "minutes")
        if instance.source in ("tfe2024", "real")
        else ("distance units", "time units")
    )
    rows = ["VEHICLE,CUSTOMER,ARRIVAL,START,WAIT,LATE,LOAD"]
    for v, stops in enumerate(evaluation.stops, start=1):
        for s in stops:
            values = [s.arrival, s.start, s.wait, s.late, s.load]
            rows.append(",".join([str(v), str(s.customer), *(_n(x) for x in values)]))
    violations = (
        "; ".join(
            f"{x.type}"
            + (f" (vehicle {x.route + 1})" if x.route is not None else "")
            + (f" (customer {x.customer})" if x.customer is not None else "")
            for x in evaluation.violations
        )
        or "none"
    )
    lines = [
        (
            f"A vehicle routing solution with time windows was computed with the method "
            f"{method!r} for {len(instance.customers)} customers and at most "
            f"{instance.fleet.vehicles} vehicles. Times are in {t_unit}, distances in "
            f"{d_unit}."
        ),
        "Stops of each vehicle, in visiting order:",
        "\n".join(rows),
        (
            f"Totals: score {_n(evaluation.score)}, distance {_n(evaluation.distance)} "
            f"{d_unit}, vehicles used {evaluation.vehicles_used}, total waiting time "
            f"{_n(evaluation.total_wait)} {t_unit}, total late time "
            f"{_n(evaluation.total_late)} {t_unit}, unattended customers "
            f"{evaluation.unserved}, load above capacity {_n(evaluation.overload)}."
        ),
        f"Feasible: {'yes' if evaluation.feasible else 'no'}. Violations: {violations}.",
        (
            "Explain this solution in Spanish, briefly, for a logistics manager: what "
            "each vehicle does, where there are waits or delays, and whether the "
            "solution is feasible. Use only the figures above."
        ),
    ]
    return "\n".join(lines) + "\n"
