/**
 * TypeScript mirror of the netlist contract defined in Rust
 * (`solver/src/netlist.rs` and `solver/src/error.rs`, documented in
 * `docs/netlist-format.md`).
 *
 * These types are hand-written rather than generated. The contract is small,
 * and `wasm.test.ts` runs the Rust test fixtures and every error kind through
 * the real WASM module, so drift between the two sides fails a test.
 */

export type ComponentKind = 'resistor' | 'voltage_source' | 'current_source'

export type Component =
  | { id: string; type: 'resistor'; a: string; b: string; value: number }
  | { id: string; type: 'voltage_source'; pos: string; neg: string; value: number }
  | { id: string; type: 'current_source'; from: string; to: string; value: number }

export interface Netlist {
  version: 1
  ground: string
  components: Component[]
}

export interface Solution {
  /** Volts relative to ground, keyed by node name (ground included). */
  node_voltages: Record<string, number>
  /** Amperes keyed by component id, positive from first terminal to second. */
  branch_currents: Record<string, number>
}

/** Fields shared by every error, added by the WASM wrapper. */
interface ErrorBase {
  message: string
}

export type SolverError = ErrorBase &
  (
    | { kind: 'parse' }
    | { kind: 'unsupported_version'; found: number; supported: number }
    | { kind: 'empty_circuit' }
    | { kind: 'empty_id' }
    | { kind: 'empty_node_name'; id: string }
    | { kind: 'duplicate_id'; id: string }
    | { kind: 'invalid_value'; id: string; reason: string }
    | { kind: 'shorted_component'; id: string; node: string }
    | { kind: 'missing_ground'; ground: string }
    | { kind: 'floating_nodes'; nodes: string[] }
    | { kind: 'voltage_source_loop'; id: string }
    | { kind: 'singular_matrix' }
  )

export type SolverErrorKind = SolverError['kind']

export type SolveResult = { ok: true; solution: Solution } | { ok: false; error: SolverError }
