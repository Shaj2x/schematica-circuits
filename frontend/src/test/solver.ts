import { readFileSync } from 'node:fs'
import { createSolverSync, type Solver } from '../solver'

let solver: Solver | undefined

/** A WebAssembly solver for tests, loaded from disk instead of the network. */
export function testSolver(): Solver {
  solver ??= createSolverSync(
    readFileSync(new URL('../solver/pkg/schematica_solver_wasm_bg.wasm', import.meta.url)),
  )
  return solver
}
