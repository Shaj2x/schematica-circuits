/**
 * Typed wrapper around the WebAssembly solver.
 *
 * The rest of the app depends on the small `Solver` interface rather than
 * on the generated wasm-bindgen module. That keeps the JSON (de)serialization
 * in one place, and lets tests and components receive a solver as a value
 * (initialized synchronously from bytes in Node, asynchronously over the
 * network in the browser).
 */

import init, { initSync, solveTransient as wasmSolveTransient, solve as wasmSolve } from './pkg/schematica_solver_wasm.js'
import type { Netlist, SolveResult, TransientOptions, TransientResult } from './types'

export interface Solver {
  solve(netlist: Netlist): SolveResult
  solveTransient(netlist: Netlist, options: TransientOptions): TransientResult
}

function wrap(): Solver {
  return {
    solve(netlist) {
      return JSON.parse(wasmSolve(JSON.stringify(netlist))) as SolveResult
    },
    solveTransient(netlist, options) {
      return JSON.parse(wasmSolveTransient(JSON.stringify(netlist), JSON.stringify(options))) as TransientResult
    },
  }
}

/**
 * Runs a solve and measures wall-clock time, including the JSON round trip
 * across the WASM boundary. The editor shows this number, and the Phase 6
 * benchmarks use it.
 */
export function solveTimed<T>(run: () => T): { result: T; ms: number } {
  const start = performance.now()
  const result = run()
  return { result, ms: performance.now() - start }
}

let loading: Promise<Solver> | undefined

/**
 * Fetches and instantiates the WASM module once; later calls share the same
 * promise. Vite resolves the `.wasm` URL inside the generated glue code.
 */
export function loadSolver(): Promise<Solver> {
  loading ??= init().then(wrap)
  return loading
}

/** Instantiates the module from bytes already in memory (used by tests). */
export function createSolverSync(wasmBytes: BufferSource): Solver {
  initSync({ module: wasmBytes })
  return wrap()
}

export type * from './types'
