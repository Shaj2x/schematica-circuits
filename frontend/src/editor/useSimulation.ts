import { useMemo } from 'react'
import { type Connectivity, buildNetlist } from '../schematic/netlist'
import type { Schematic } from '../schematic/model'
import { type SolveResult, type Solver, type TransientResult, solveTimed } from '../solver'
import type { TransientSettings } from './transient'

export type Analysis = { mode: 'dc' } | { mode: 'transient'; settings: TransientSettings }

export interface Simulation {
  connectivity: Connectivity
  /** DC result. Undefined until simulation is on, in transient mode, or with nothing to solve. */
  result?: SolveResult
  /** Transient result, in transient mode. */
  transient?: TransientResult
  /** Wall-clock time of the solve call, including the JSON round trip. */
  solveMs?: number
}

/**
 * Derives the netlist from the schematic and, while `live`, solves it on
 * every change.
 *
 * Re-solving synchronously on each edit (and each slider tick) is a
 * deliberate choice: a WASM DC solve of an editor-sized circuit takes about
 * 0.02 ms, and a 1000-step transient run about 2 ms (mostly JSON across the
 * WASM boundary; the solve itself is ~0.15 ms), both inside one 16 ms frame. Debouncing or a Web Worker would add complexity without
 * a visible benefit. The measured time is shown in the UI so that claim
 * stays checkable.
 */
export function useSimulation(solver: Solver, schematic: Schematic, live: boolean, analysis: Analysis): Simulation {
  const connectivity = useMemo(() => buildNetlist(schematic), [schematic])
  return useMemo(() => {
    if (!live || connectivity.netlist.components.length === 0) return { connectivity }
    if (analysis.mode === 'transient') {
      const { stopTime, timeStep, method } = analysis.settings
      const { result, ms } = solveTimed(() =>
        solver.solveTransient(connectivity.netlist, { stop_time: stopTime, time_step: timeStep, method }),
      )
      return { connectivity, transient: result, solveMs: ms }
    }
    const { result, ms } = solveTimed(() => solver.solve(connectivity.netlist))
    return { connectivity, result, solveMs: ms }
  }, [solver, connectivity, live, analysis])
}
