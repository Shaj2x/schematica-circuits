import { useMemo } from 'react'
import { type Connectivity, buildNetlist } from '../schematic/netlist'
import type { Schematic } from '../schematic/model'
import { type SolveResult, type Solver, solveTimed } from '../solver'

export interface Simulation {
  connectivity: Connectivity
  /** Undefined until the user turns simulation on, or when there is nothing to solve. */
  result?: SolveResult
  /** Wall-clock time of the solve call, including the JSON round trip. */
  solveMs?: number
}

/**
 * Derives the netlist from the schematic and, while `live`, solves it on
 * every change.
 *
 * Re-solving synchronously on each edit (and each slider tick) is a
 * deliberate choice: a WASM solve of an editor-sized circuit takes well under
 * a millisecond, far below one 16 ms frame, so debouncing or a Web Worker
 * would add complexity without a visible benefit. The measured time is shown
 * in the UI so that claim stays checkable.
 */
export function useSimulation(solver: Solver, schematic: Schematic, live: boolean): Simulation {
  const connectivity = useMemo(() => buildNetlist(schematic), [schematic])
  return useMemo(() => {
    if (!live || connectivity.netlist.components.length === 0) return { connectivity }
    const { result, ms } = solveTimed(solver, connectivity.netlist)
    return { connectivity, result, solveMs: ms }
  }, [solver, connectivity, live])
}
