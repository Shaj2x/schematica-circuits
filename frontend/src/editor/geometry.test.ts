import { describe, expect, it } from 'vitest'
import { emptySchematic } from '../schematic/model'
import { COLS, ROWS, canvasSize } from './geometry'

describe('canvasSize', () => {
  it('is the default grid for small drawings', () => {
    expect(canvasSize(emptySchematic)).toEqual({ cols: COLS, rows: ROWS })
  })

  it('grows to fit a large drawing, with room under grounds', () => {
    const schematic = {
      parts: [{ id: 'R1', kind: 'resistor' as const, a: { x: 24, y: 1 }, b: { x: 26, y: 1 }, value: 1 }],
      wires: [],
      grounds: [{ id: 'G1', at: { x: 1, y: 15 } }],
    }
    expect(canvasSize(schematic)).toEqual({ cols: 28, rows: 17 })
  })
})
