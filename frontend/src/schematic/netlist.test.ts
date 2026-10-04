import { describe, expect, it } from 'vitest'
import { testSolver } from '../test/solver'
import { examples, mixedSources, voltageDivider, wheatstoneBridge } from './examples'
import { type Schematic, emptySchematic, pointKey } from './model'
import { GROUND_NODE, buildNetlist } from './netlist'

const p = (x: number, y: number) => ({ x, y })
const nodeAt = (s: Schematic, x: number, y: number) => buildNetlist(s).nodeOfPoint.get(pointKey(p(x, y)))

describe('buildNetlist connection rules', () => {
  it('connects wire endpoints and part terminals at the same point', () => {
    const s: Schematic = {
      parts: [{ id: 'R1', kind: 'resistor', a: p(0, 0), b: p(2, 0), value: 1 }],
      wires: [{ id: 'W1', a: p(2, 0), b: p(5, 0) }],
      grounds: [],
    }
    expect(nodeAt(s, 2, 0)).toBe(nodeAt(s, 5, 0))
    expect(nodeAt(s, 0, 0)).not.toBe(nodeAt(s, 2, 0))
  })

  it('connects a point in the middle of a wire (T-junction)', () => {
    const s: Schematic = {
      parts: [{ id: 'R1', kind: 'resistor', a: p(3, 0), b: p(3, 2), value: 1 }],
      wires: [{ id: 'W1', a: p(0, 0), b: p(6, 0) }],
      grounds: [],
    }
    expect(nodeAt(s, 3, 0)).toBe(nodeAt(s, 0, 0))
    expect(buildNetlist(s).junctions).toEqual([p(3, 0)])
  })

  it('does not connect wires that only cross', () => {
    const s: Schematic = {
      parts: [],
      wires: [
        { id: 'W1', a: p(0, 2), b: p(4, 2) },
        { id: 'W2', a: p(2, 0), b: p(2, 4) },
      ],
      grounds: [],
    }
    const { nodeOfWire, junctions } = buildNetlist(s)
    expect(nodeOfWire.get('W1')).not.toBe(nodeOfWire.get('W2'))
    expect(junctions).toEqual([])
  })

  it('joins diagonal wires at interior grid points too', () => {
    const s: Schematic = {
      parts: [],
      wires: [
        { id: 'W1', a: p(0, 0), b: p(4, 4) },
        { id: 'W2', a: p(2, 2), b: p(2, 6) },
      ],
      grounds: [],
    }
    const { nodeOfWire } = buildNetlist(s)
    expect(nodeOfWire.get('W1')).toBe(nodeOfWire.get('W2'))
  })

  it('treats every ground symbol as the same node', () => {
    const s: Schematic = {
      parts: [{ id: 'R1', kind: 'resistor', a: p(0, 0), b: p(2, 0), value: 1 }],
      wires: [],
      grounds: [
        { id: 'G1', at: p(0, 0) },
        { id: 'G2', at: p(2, 0) },
      ],
    }
    const { netlist } = buildNetlist(s)
    expect(netlist.components[0]).toMatchObject({ a: GROUND_NODE, b: GROUND_NODE })
  })

  it('maps part terminals to the netlist terminal names', () => {
    const s: Schematic = {
      parts: [
        { id: 'V1', kind: 'voltage_source', a: p(0, 0), b: p(0, 2), value: 5 },
        { id: 'I1', kind: 'current_source', a: p(0, 2), b: p(0, 0), value: 1 },
      ],
      wires: [],
      grounds: [{ id: 'G1', at: p(0, 2) }],
    }
    const [v, i] = buildNetlist(s).netlist.components
    expect(v).toEqual({ id: 'V1', type: 'voltage_source', pos: 'n1', neg: 'gnd', value: 5 })
    expect(i).toEqual({ id: 'I1', type: 'current_source', from: 'gnd', to: 'n1', value: 1 })
  })

  it('names nodes in reading order', () => {
    const { netlist } = buildNetlist(voltageDivider.schematic)
    expect(netlist.components.map((c) => c.id)).toEqual(['V1', 'R1', 'R2'])
    expect(netlist.components[1]).toMatchObject({ a: 'n1', b: 'n2' })
  })

  it('reports unconnected ends and no junctions for a dangling part', () => {
    const s: Schematic = {
      parts: [{ id: 'R1', kind: 'resistor', a: p(0, 0), b: p(2, 0), value: 1 }],
      wires: [{ id: 'W1', a: p(2, 0), b: p(2, 3) }],
      grounds: [],
    }
    const { openEnds, junctions } = buildNetlist(s)
    expect(openEnds).toEqual([p(0, 0), p(2, 3)])
    expect(junctions).toEqual([])
  })

  it('has no open ends in a complete example circuit', () => {
    expect(buildNetlist(voltageDivider.schematic).openEnds).toEqual([])
  })

  it('handles an empty schematic', () => {
    expect(buildNetlist(emptySchematic).netlist.components).toEqual([])
  })
})

describe('examples solve to their hand-derived answers', () => {
  const solve = (s: Schematic) => {
    const connectivity = buildNetlist(s)
    const result = testSolver().solve(connectivity.netlist)
    if (!result.ok) throw new Error(result.error.message)
    const v = (x: number, y: number) =>
      result.solution.node_voltages[connectivity.nodeOfPoint.get(pointKey(p(x, y)))!]
    return { v, currents: result.solution.branch_currents }
  }

  it('voltage divider', () => {
    const { v, currents } = solve(voltageDivider.schematic)
    expect(v(8, 4)).toBeCloseTo(20 / 3, 9)
    expect(currents.R1).toBeCloseTo(10 / 3000, 12)
  })

  it('Wheatstone bridge', () => {
    const { v, currents } = solve(wheatstoneBridge.schematic)
    expect(v(7, 5)).toBeCloseTo(40 / 7, 9)
    expect(v(9, 5)).toBeCloseTo(30 / 7, 9)
    expect(currents.R5).toBeCloseTo(10 / 7000, 12)
  })

  it('mixed sources', () => {
    const { v, currents } = solve(mixedSources.schematic)
    expect(v(6, 4)).toBeCloseTo(9.6, 9)
    expect(currents.V1).toBeCloseTo(-0.6, 12)
  })

  it('every example solves', () => {
    for (const example of examples) expect(() => solve(example.schematic)).not.toThrow()
  })
})
