import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSolverSync, type Solver } from '../solver'

let solver: Solver | undefined

/**
 * A WebAssembly solver for tests, loaded from disk instead of the network.
 * The path is resolved from the project root (Vitest's working directory)
 * because under jsdom `import.meta.url` is not a file URL.
 */
export function testSolver(): Solver {
  solver ??= createSolverSync(readFileSync(resolve('src/solver/pkg/schematica_solver_wasm_bg.wasm')))
  return solver
}
