import { describe, expect, it } from 'vitest'
import { emptySchematic } from '../schematic/model'
import { COLS, ROWS, canvasSize, fitView, growView } from './geometry'

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

describe('views', () => {
  const schematic = {
    parts: [{ id: 'R1', kind: 'resistor' as const, a: { x: 30, y: 30 }, b: { x: 32, y: 30 }, value: 1 }],
    wires: [],
    grounds: [],
  }

  it('centres a drawing that is far from the origin', () => {
    const view = fitView(schematic)
    expect(view.cols).toBe(COLS)
    expect(view.x + view.cols / 2).toBeCloseTo(31, 0)
  })

  it('only grows while editing, never shifts', () => {
    const view = fitView(schematic)
    expect(growView(view, schematic)).toEqual(view)
    const moved = { ...schematic, parts: [{ ...schematic.parts[0]!, b: { x: 60, y: 30 } }] }
    const grown = growView(view, moved)
    expect(grown.x).toBe(view.x)
    expect(grown.x + grown.cols).toBeGreaterThanOrEqual(62)
  })
})
