/**
 * Starter circuits, so the editor never opens empty. Each mirrors a
 * hand-solved fixture from `solver/tests/fixtures/`, and `examples.test.ts`
 * checks the editor -> netlist -> WASM path reproduces those answers.
 */

import type { Part, Point, Schematic, Wire } from './model'

const p = (x: number, y: number): Point => ({ x, y })

function wires(...segments: [number, number, number, number][]): Wire[] {
  return segments.map(([x1, y1, x2, y2], i) => ({ id: `W${i + 1}`, a: p(x1, y1), b: p(x2, y2) }))
}

const R = (id: string, a: Point, b: Point, value: number): Part => ({ id, kind: 'resistor', a, b, value })

export interface Example {
  name: string
  description: string
  schematic: Schematic
}

export const voltageDivider: Example = {
  name: 'Voltage divider',
  description: '10 V across 1 kΩ and 2 kΩ: the output is 10 × 2/3 ≈ 6.67 V.',
  schematic: {
    parts: [
      { id: 'V1', kind: 'voltage_source', a: p(2, 4), b: p(2, 6), value: 10 },
      R('R1', p(4, 2), p(6, 2), 1000),
      R('R2', p(8, 4), p(8, 6), 2000),
    ],
    wires: wires([2, 4, 2, 2], [2, 2, 4, 2], [6, 2, 8, 2], [8, 2, 8, 4], [2, 6, 2, 8], [2, 8, 8, 8], [8, 8, 8, 6]),
    grounds: [{ id: 'G1', at: p(5, 8) }],
  },
}

export const wheatstoneBridge: Example = {
  name: 'Wheatstone bridge',
  description: 'Unbalanced bridge (fixture wheatstone_unbalanced): v_a = 40/7 V, v_b = 30/7 V.',
  schematic: {
    parts: [
      { id: 'V1', kind: 'voltage_source', a: p(2, 5), b: p(2, 7), value: 10 },
      R('R1', p(6, 2), p(6, 4), 1000),
      R('R2', p(6, 6), p(6, 8), 2000),
      R('R3', p(10, 2), p(10, 4), 2000),
      R('R4', p(10, 6), p(10, 8), 1000),
      R('R5', p(7, 5), p(9, 5), 1000),
    ],
    wires: wires(
      [2, 5, 2, 2],
      [2, 2, 10, 2],
      [6, 4, 6, 6],
      [10, 4, 10, 6],
      [6, 5, 7, 5],
      [9, 5, 10, 5],
      [2, 7, 2, 8],
      [2, 8, 10, 8],
    ),
    grounds: [{ id: 'G1', at: p(4, 8) }],
  },
}

export const mixedSources: Example = {
  name: 'Mixed sources',
  description: '12 V source and 1 A current source (fixture mixed_sources): the right node sits at 9.6 V.',
  schematic: {
    parts: [
      { id: 'V1', kind: 'voltage_source', a: p(2, 4), b: p(2, 6), value: 12 },
      R('R1', p(2, 2), p(4, 2), 4),
      R('R2', p(6, 4), p(6, 6), 6),
      // Drawn bottom to top: current flows from ground ("from") up into the node ("to").
      { id: 'I1', kind: 'current_source', a: p(9, 6), b: p(9, 4), value: 1 },
    ],
    wires: wires([2, 4, 2, 2], [4, 2, 9, 2], [6, 2, 6, 4], [9, 4, 9, 2], [2, 6, 9, 6]),
    grounds: [{ id: 'G1', at: p(4, 6) }],
  },
}

export const examples: Example[] = [voltageDivider, wheatstoneBridge, mixedSources]
