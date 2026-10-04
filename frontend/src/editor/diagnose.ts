/**
 * Turns a solver error into what the editor shows: a sentence for a student
 * and the parts or nodes to highlight in red.
 */

import type { SolverError, SolverErrorDetail } from '../solver'

export interface Diagnosis {
  message: string
  partIds: Set<string>
  nodes: Set<string>
}

export function diagnose(error: SolverError | (SolverErrorDetail & { message?: string })): Diagnosis {
  const parts = (...ids: string[]) => new Set(ids)
  const none = new Set<string>()
  switch (error.kind) {
    case 'missing_ground':
      return {
        message: 'Add a ground symbol. Voltages are measured relative to ground, so the circuit needs one.',
        partIds: none,
        nodes: none,
      }
    case 'floating_nodes':
      return {
        message:
          'The highlighted wires have no path to ground that fixes their voltage, so it is undefined. Current sources never fix a voltage, and at DC neither do capacitors (they are open circuits). Connect them, or delete what is left over.',
        partIds: none,
        nodes: new Set(error.nodes),
      }
    case 'voltage_source_loop':
      return {
        message: `${error.id} closes a loop made only of voltage sources (for example, two sources in parallel; at DC an inductor counts as a 0 V source). Their voltages conflict, so the loop current is undefined.`,
        partIds: parts(error.id),
        nodes: none,
      }
    case 'shorted_component':
      return {
        message: `Both ends of ${error.id} are wired to the same node, so it is shorted out.`,
        partIds: parts(error.id),
        nodes: none,
      }
    case 'invalid_analysis':
      return { message: `Transient settings: ${error.reason}.`, partIds: none, nodes: none }
    case 'undefined_initial_state': {
      // Highlight whatever the cause points at, and explain it in terms of
      // t = 0, where capacitors act as sources of their initial voltage and
      // inductors as sources of their initial current.
      const cause = diagnose(error.cause)
      const message =
        error.cause.kind === 'voltage_source_loop'
          ? `At t = 0, ${error.cause.id} is in a loop with only voltage sources and capacitors, so it would have to charge instantly through zero resistance. Add a series resistor, or set its initial voltage to match.`
          : error.cause.kind === 'floating_nodes'
            ? 'At t = 0, the highlighted wires are reached only through inductors or current sources, so their starting voltage is undefined. Add a resistor to ground.'
            : `The state at t = 0 is undefined: ${cause.message}`
      return { ...cause, message }
    }
    case 'invalid_value':
      return { message: `${error.id}: ${error.reason}.`, partIds: parts(error.id), nodes: none }
    case 'duplicate_id':
    case 'empty_node_name':
      return { message: error.message ?? `Problem with ${error.id}.`, partIds: parts(error.id), nodes: none }
    case 'singular_matrix':
      return {
        message: 'The circuit equations cannot be solved. Check for extreme values, like resistances many orders of magnitude apart.',
        partIds: none,
        nodes: none,
      }
    default:
      return { message: error.message ?? `Can’t solve (${error.kind}).`, partIds: none, nodes: none }
  }
}
