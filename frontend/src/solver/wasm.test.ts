import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { createSolverSync, type Solver } from '.'
import type { Netlist, Solution, SolverErrorKind } from './types'

/** Loads a WebAssembly solver for tests, without the network. */
export function testSolver(): Solver {
  const wasm = readFileSync(new URL('./pkg/schematica_solver_wasm_bg.wasm', import.meta.url))
  return createSolverSync(wasm)
}

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
    singular_matrix: net([
      { id: 'I1', type: 'current_source', from: 'gnd', to: 'a', value: 1 },
      R('R1', 'a', 'b', 1e-300),
      R('R2', 'b', 'gnd', 1),
    ]),
  }

  it.each(Object.entries(cases))('reports %s', (kind, netlist) => {
    const result = solver.solve(netlist as Netlist)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe(kind)
    expect(result.error.message.length).toBeGreaterThan(0)
  })

  it('carries structured details for highlighting', () => {
    const result = solver.solve(net([R('R1', 'a', 'gnd'), R('R2', 'x', 'y')]))
    expect(result).toMatchObject({ ok: false, error: { kind: 'floating_nodes', nodes: ['x', 'y'] } })
  })
})
