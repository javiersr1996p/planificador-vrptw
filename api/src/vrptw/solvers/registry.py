"""Métodos de resolución por nombre."""

from collections.abc import Callable

from vrptw.model import Solution
from vrptw.solvers.aco import solve as solve_aco
from vrptw.solvers.ga import solve as solve_ga
from vrptw.solvers.heuristic import solve as solve_heuristic
from vrptw.solvers.tabu import solve as solve_tabu

SOLVERS: dict[str, Callable[..., Solution]] = {
    "heuristic": solve_heuristic,
    "aco": solve_aco,
    "ga": solve_ga,
    "tabu": solve_tabu,
}
