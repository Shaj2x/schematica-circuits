import { describe, expect, it } from 'vitest'
import type { Schematic } from '../schematic/model'
import { decimate, nearestIndex, niceCeil, sampleAt, suggestSettings } from './transient'

const part = (id: string, kind: Schematic['parts'][number]['kind'], value: number) => ({
  id,
  kind,
  value,
  a: { x: 0, y: 0 },
  b: { x: 2, y: 0 },
})
const schematic = (...parts: Schematic['parts']): Schematic => ({ parts, wires: [], grounds: [] })

describe('suggestSettings', () => {
  it('uses five RC time constants', () => {
    const s = suggestSettings(schematic(part('R1', 'resistor', 1000), part('C1', 'capacitor', 1e-6)))
    expect(s).toEqual({ stopTime: 5e-3, timeStep: 5e-6, method: 'trapezoidal' })
  })

  it('uses the LC period when it is the slowest scale', () => {
    // 2π√(1 mH · 1 µF) ≈ 0.199 ms, so 5× ≈ 0.99 ms, rounded up to 1 ms.
    const s = suggestSettings(
      schematic(part('R1', 'resistor', 10), part('L1', 'inductor', 1e-3), part('C1', 'capacitor', 1e-6)),
    )
    expect(s.stopTime).toBe(1e-3)
  })

  it('falls back to 1 ms × 5 without reactive parts', () => {
    expect(suggestSettings(schematic(part('R1', 'resistor', 1))).stopTime).toBe(5e-3)
  })
})

describe('niceCeil', () => {
  it.each([
    [0.0042, 0.005],
    [0.005, 0.005],
    [0.0051, 0.01],
    [1.5, 2],
    [17, 20],
    [1e-7, 1e-7],
  ])('%d -> %d', (x, expected) => expect(niceCeil(x)).toBe(expected))
})

describe('sampleAt and nearestIndex', () => {
  const solution = {
    time: [0, 1, 2, 3],
    node_voltages: { a: [0, 10, 20, 30] },
    branch_currents: { R1: [1, 2, 3, 4] },
  }

  it('slices one time step into a DC-shaped solution', () => {
    expect(sampleAt(solution, 2)).toEqual({ node_voltages: { a: 20 }, branch_currents: { R1: 3 } })
  })

  it.each([
    [-5, 0],
    [0.4, 0],
    [0.6, 1],
    [2.5, 2],
    [99, 3],
  ])('nearest sample to t = %d is %d', (t, index) => {
    expect(nearestIndex(solution.time, t)).toBe(index)
  })
})

describe('decimate', () => {
  it('returns short series unchanged', () => {
    expect(decimate([0, 1, 2], [5, 6, 7], 10)).toEqual([
      { t: 0, y: 5 },
      { t: 1, y: 6 },
      { t: 2, y: 7 },
    ])
  })

  it('keeps a one-sample spike that striding would miss', () => {
    const n = 10_000
    const time = Array.from({ length: n }, (_, i) => i)
    const values = time.map((i) => (i === 4321 ? 100 : 0))
    const points = decimate(time, values, 200)
    expect(points.length).toBeLessThanOrEqual(202)
    expect(points.some((p) => p.y === 100 && p.t === 4321)).toBe(true)
    expect(points.at(-1)).toEqual({ t: n - 1, y: 0 })
  })

  it('keeps points in time order', () => {
    const time = Array.from({ length: 5000 }, (_, i) => i)
    const points = decimate(time, time.map((t) => Math.sin(t / 50)), 300)
    for (let i = 1; i < points.length; i++) expect(points[i]!.t).toBeGreaterThan(points[i - 1]!.t)
  })
})
