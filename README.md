# Planificador VRPTW

Planificador de rutas con ventanas de tiempo que compara métodos clásicos y LLM. Continuación de un trabajo fin de máster de 2024.

- `api/`: backend en Python (solver, algoritmos y API).
- `web/`: frontend en Next.js.

## Origen

Los métodos clásicos (heurística, colonia de hormigas, genético y búsqueda tabú) y los 20 problemas de `api/data/tfe2024/` se han portado, con correcciones, del código original del TFE de 2024: [oscarsr96/tfm_vrptw_osr_jsr](https://github.com/oscarsr96/tfm_vrptw_osr_jsr) (commit `c3ad94c`). Las diferencias respecto a aquel código se documentan en `docs/tfe-reimplementacion.md`.
