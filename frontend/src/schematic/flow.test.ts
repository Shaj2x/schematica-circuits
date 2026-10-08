import { describe, expect, it } from 'vitest'
import { testSolver } from '../test/solver'
import { examples, voltageDivider } from './examples'
import { type Point, type Schematic, pointKey } from './model'
import { wireCurrents } from './flow'
import { buildNetlist } from './netlist'

const solver = testSolver()

function solve(schematic: Schematic) {
  const result = solver.solve(buildNetlist(schematic).netlist)
  if (!result.ok) throw new Error(result.error.message)
  return result.solution
}

/** Net current leaving each point through wire segments. */
function outflow(segments: ReturnType<typeof wireCurrents>) {
  const out = new Map<string, number>()
  const add = (p: Point, amps: number) => out.set(pointKey(p), (out.get(pointKey(p)) ?? 0) + amps)
  for (const s of segments) {
    add(s.a, s.current)
    add(s.b, -s.current)
  }
  return out
}

describe('wireCurrents', () => {
  it('carries the loop current around a voltage divider, out of the + terminal', () => {
    const { schematic } = voltageDivider
    const segments = wireCurrents(schematic, solve(schematic))
    const v1 = schematic.parts.find((p) => p.id === 'V1')!
    const fromPlus = segments.filter((s) => pointKey(s.a) === pointKey(v1.a) || pointKey(s.b) === pointKey(v1.a))
    expect(fromPlus).toHaveLength(1)
    const leaving = pointKey(fromPlus[0]!.a) === pointKey(v1.a) ? fromPlus[0]!.current : -fromPlus[0]!.current
    expect(leaving).toBeCloseTo(10 / 3000, 9)
    for (const s of segments) expect(Math.abs(s.current)).toBeCloseTo(10 / 3000, 9)
  })

  it('satisfies KCL at every terminal of every example', () => {
    for (const example of examples.filter((e) => !e.transient)) {
      const { schematic } = example
      const solution = solve(schematic)
      const out = outflow(wireCurrents(schematic, solution))
      // At each part terminal, the wires carry away exactly what the part delivers.
      const expected = new Map<string, number>()
      const add = (p: Point, amps: number) => expected.set(pointKey(p), (expected.get(pointKey(p)) ?? 0) + amps)
      for (const part of schematic.parts) {
        const i = solution.branch_currents[part.id]!
        add(part.a, -i)
        add(part.b, i)
      }
      const grounds = new Set(schematic.grounds.map((g) => pointKey(g.at)))
      for (const [key, amps] of expected) {
        if (grounds.has(key)) continue // ground points also exchange current with "ground"
        expect(out.get(key) ?? 0, `${example.name} at ${key}`).toBeCloseTo(amps, 9)
      }
    }
  })
})
