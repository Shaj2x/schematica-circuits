import { describe, expect, it } from 'vitest'
import type { Netlist } from '../solver'
import { testSolver } from '../test/solver'
import { diagnose } from './diagnose'

const net = (components: Netlist['components']): Netlist => ({ version: 1, ground: 'gnd', components })
const V1 = { id: 'V1', type: 'voltage_source', pos: 'a', neg: 'gnd', value: 5 } as const

/** Diagnoses real errors from the WASM solver, so message logic tracks the contract. */
describe('diagnose', () => {
  it('explains a capacitor directly across a source at t = 0 and highlights it', () => {
    const result = testSolver().solveTransient(
      net([V1, { id: 'C1', type: 'capacitor', a: 'a', b: 'gnd', value: 1e-6 }]),
      { stop_time: 1e-3, time_step: 1e-5 },
    )
    if (result.ok) throw new Error('expected an error')
    const d = diagnose(result.error)
    expect(d.message).toMatch(/At t = 0, C1 .* charge instantly/)
    expect([...d.partIds]).toEqual(['C1'])
  })

  it('highlights the inductor that shorts a source at DC', () => {
    const result = testSolver().solve(net([V1, { id: 'L1', type: 'inductor', a: 'a', b: 'gnd', value: 1e-3 }]))
    if (result.ok) throw new Error('expected an error')
    const d = diagnose(result.error)
    expect(d.message).toContain('inductor counts as a 0 V source')
    expect([...d.partIds]).toEqual(['L1'])
  })

  it('reports invalid transient settings', () => {
    const result = testSolver().solveTransient(net([V1, { id: 'R1', type: 'resistor', a: 'a', b: 'gnd', value: 1 }]), {
      stop_time: 1e-3,
      time_step: 1,
    })
    if (result.ok) throw new Error('expected an error')
    expect(diagnose(result.error).message).toMatch(/^Transient settings: time step \(1 s\) is longer than the stop time \(0.001 s\)\.$/)
  })

  it('highlights nodes that float at DC because only a capacitor reaches them', () => {
    const result = testSolver().solve(
      net([
        V1,
        { id: 'C1', type: 'capacitor', a: 'a', b: 'x', value: 1e-6 },
        { id: 'R1', type: 'resistor', a: 'x', b: 'y', value: 1 },
      ]),
    )
    if (result.ok) throw new Error('expected an error')
    expect([...diagnose(result.error).nodes]).toEqual(['x', 'y'])
  })
})
