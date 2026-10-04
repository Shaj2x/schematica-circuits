import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { testSolver } from '../test/solver'
import type { Solver } from '.'
import type { Netlist, Solution, SolverErrorKind } from './types'

interface Fixture {
  name: string
  netlist: Netlist
  expected: Solution
}

const fixtureDir = fileURLToPath(new URL('../../../solver/tests/fixtures/', import.meta.url))
const fixtures: Fixture[] = readdirSync(fixtureDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(fixtureDir + f, 'utf8')) as Fixture)

let solver: Solver
beforeAll(() => {
  solver = testSolver()
})

/**
 * The same fixtures the Rust tests use, solved through the browser build.
 * This proves the WASM build, the JSON boundary and the TypeScript types all
 * agree with the Rust contract.
 */
describe('WASM solver matches the Rust fixtures', () => {
  it('finds the fixtures', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10)
  })

  it.each(fixtures.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const result = solver.solve(fixture.netlist)
    if (!result.ok) throw new Error(result.error.message)
    for (const [node, v] of Object.entries(fixture.expected.node_voltages)) {
      expect(result.solution.node_voltages[node]).toBeCloseTo(v, 9)
    }
    for (const [id, i] of Object.entries(fixture.expected.branch_currents)) {
      expect(result.solution.branch_currents[id]).toBeCloseTo(i, 12)
    }
  })
})

describe('WASM solver errors', () => {
  const R = (id: string, a: string, b: string, value = 100) =>
    ({ id, type: 'resistor', a, b, value }) as const
  const V = (id: string, pos: string, neg: string, value = 5) =>
    ({ id, type: 'voltage_source', pos, neg, value }) as const
  const net = (components: Netlist['components']): Netlist => ({
    version: 1,
    ground: 'gnd',
    components,
  })

  // One circuit per error kind the UI can receive from a structurally valid
  // JSON netlist. Typed as a full Record so adding a kind on the TypeScript
  // side without a case here fails type checking.
  const cases: Record<SolverErrorKind, unknown> = {
    parse: { version: 1, ground: 'gnd', components: [{ id: 'X', type: 'diode' }] },
    unsupported_version: { version: 9, ground: 'gnd', components: [] },
    empty_circuit: net([]),
    empty_id: net([R('', 'a', 'gnd')]),
    empty_node_name: net([R('R1', '', 'gnd')]),
    duplicate_id: net([R('R1', 'a', 'gnd'), R('R1', 'a', 'gnd')]),
    invalid_value: net([R('R1', 'a', 'gnd', -1)]),
    shorted_component: net([R('R1', 'a', 'a')]),
    missing_ground: net([R('R1', 'a', 'b')]),
    floating_nodes: net([R('R1', 'a', 'gnd'), R('R2', 'x', 'y')]),
    voltage_source_loop: net([V('V1', 'a', 'gnd'), V('V2', 'a', 'gnd'), R('R1', 'a', 'gnd')]),
    // 1e-300 Ω beside 1 Ω exceeds double precision (see tests/errors.rs).
    // Transient-only kinds: the netlist and options come from transientCases.
    invalid_analysis: undefined,
    undefined_initial_state: undefined,
    singular_matrix: net([
      { id: 'I1', type: 'current_source', from: 'gnd', to: 'a', value: 1 },
      R('R1', 'a', 'b', 1e-300),
      R('R2', 'b', 'gnd', 1),
    ]),
  }

  // Errors only a transient run can produce.
  const transientCases: Partial<Record<SolverErrorKind, [Netlist, unknown]>> = {
    invalid_analysis: [net([R('R1', 'a', 'gnd')]), { stop_time: -1, time_step: 1e-3 }],
    // An uncharged capacitor directly across a 5 V source.
    undefined_initial_state: [
      net([V('V1', 'a', 'gnd'), { id: 'C1', type: 'capacitor', a: 'a', b: 'gnd', value: 1e-6 }]),
      { stop_time: 1e-3, time_step: 1e-5 },
    ],
  }

  it.each(Object.entries(cases))('reports %s', (kind, netlist) => {
    const [transientNetlist, options] = transientCases[kind as SolverErrorKind] ?? []
    const result = transientNetlist
      ? solver.solveTransient(transientNetlist, options as never)
      : solver.solve(netlist as Netlist)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe(kind)
    expect(result.error.message.length).toBeGreaterThan(0)
  })

  it('nests the cause of an undefined initial state', () => {
    const [netlist, options] = transientCases.undefined_initial_state!
    expect(solver.solveTransient(netlist, options as never)).toMatchObject({
      ok: false,
      error: { kind: 'undefined_initial_state', cause: { kind: 'voltage_source_loop', id: 'C1' } },
    })
  })

  it('runs a transient analysis', () => {
    // RC discharge from 1 V with τ = 1 ms, checked at t = τ.
    const result = solver.solveTransient(
      net([
        { id: 'C1', type: 'capacitor', a: 'a', b: 'gnd', value: 1e-6, initial_voltage: 1 },
        R('R1', 'a', 'gnd', 1000),
      ]),
      { stop_time: 1e-3, time_step: 1e-6 },
    )
    if (!result.ok) throw new Error(result.error.message)
    expect(result.solution.time).toHaveLength(1001)
    expect(result.solution.node_voltages.a!.at(-1)).toBeCloseTo(Math.exp(-1), 6)
  })

  it('carries structured details for highlighting', () => {
    const result = solver.solve(net([R('R1', 'a', 'gnd'), R('R2', 'x', 'y')]))
    expect(result).toMatchObject({ ok: false, error: { kind: 'floating_nodes', nodes: ['x', 'y'] } })
  })
})
