import { describe, expect, it } from 'vitest'
import { voltageDivider } from './examples'
import { type EditorAction, type EditorState, editorReducer, initialState, nextId } from './editor'

const p = (x: number, y: number) => ({ x, y })
const run = (actions: EditorAction[], state: EditorState = initialState()) => actions.reduce(editorReducer, state)

describe('editorReducer', () => {
  it('places a horizontal part with default value and selects it', () => {
    const s = run([{ type: 'setTool', tool: 'resistor' }, { type: 'clickPoint', point: p(3, 4) }])
    expect(s.schematic.parts).toEqual([{ id: 'R1', kind: 'resistor', a: p(3, 4), b: p(5, 4), value: 1000 }])
    expect(s.selectedId).toBe('R1')
  })

  it('places vertical parts after rotating with nothing selected', () => {
    const s = run([
      { type: 'setTool', tool: 'voltage_source' },
      { type: 'rotate' },
      { type: 'clickPoint', point: p(1, 1) },
    ])
    expect(s.schematic.parts[0]).toMatchObject({ id: 'V1', a: p(1, 1), b: p(1, 3) })
  })

  it('numbers ids per prefix', () => {
    const s = run([
      { type: 'setTool', tool: 'resistor' },
      { type: 'clickPoint', point: p(0, 0) },
      { type: 'clickPoint', point: p(0, 2) },
      { type: 'setTool', tool: 'current_source' },
      { type: 'clickPoint', point: p(0, 4) },
    ])
    expect(s.schematic.parts.map((x) => x.id)).toEqual(['R1', 'R2', 'I1'])
  })

  it('draws chained wires until cancelled', () => {
    const s = run([
      { type: 'setTool', tool: 'wire' },
      { type: 'clickPoint', point: p(0, 0) },
      { type: 'clickPoint', point: p(4, 0) },
      { type: 'clickPoint', point: p(4, 3) },
      { type: 'cancel' },
    ])
    expect(s.schematic.wires).toEqual([
      { id: 'W1', a: p(0, 0), b: p(4, 0) },
      { id: 'W2', a: p(4, 0), b: p(4, 3) },
    ])
    expect(s.wireStart).toBeUndefined()
  })

  it('stops a wire when the same point is clicked twice', () => {
    const s = run([
      { type: 'setTool', tool: 'wire' },
      { type: 'clickPoint', point: p(1, 1) },
      { type: 'clickPoint', point: p(1, 1) },
    ])
    expect(s.schematic.wires).toEqual([])
    expect(s.wireStart).toBeUndefined()
  })

  it('does not stack two grounds on one point', () => {
    const s = run([
      { type: 'setTool', tool: 'ground' },
      { type: 'clickPoint', point: p(2, 2) },
      { type: 'clickPoint', point: p(2, 2) },
    ])
    expect(s.schematic.grounds).toHaveLength(1)
  })

  it('edits, flips, rotates and deletes the selected part', () => {
    let s = run([{ type: 'select', id: 'V1' }], initialState(voltageDivider.schematic))
    s = run([{ type: 'setValue', id: 'V1', value: 12 }, { type: 'flip', id: 'V1' }], s)
    expect(s.schematic.parts[0]).toMatchObject({ value: 12, a: p(2, 6), b: p(2, 4) })

    s = run([{ type: 'rotate' }], s)
    // Rotated 90° about a: the (0, -2) direction becomes (2, 0).
    expect(s.schematic.parts[0]).toMatchObject({ a: p(2, 6), b: p(4, 6) })

    s = run([{ type: 'deleteSelected' }], s)
    expect(s.schematic.parts.map((x) => x.id)).toEqual(['R1', 'R2'])
    expect(s.selectedId).toBeUndefined()
  })

  it('sets a capacitor’s initial voltage', () => {
    const s = run([
      { type: 'setTool', tool: 'capacitor' },
      { type: 'clickPoint', point: p(0, 0) },
      { type: 'setInitial', id: 'C1', value: 2.5 },
    ])
    expect(s.schematic.parts[0]).toMatchObject({ id: 'C1', kind: 'capacitor', value: 1e-6, initial: 2.5 })
  })

  it('deletes selected wires and grounds too', () => {
    const s = run(
      [{ type: 'select', id: 'W1' }, { type: 'deleteSelected' }, { type: 'select', id: 'G1' }, { type: 'deleteSelected' }],
      initialState(voltageDivider.schematic),
    )
    expect(s.schematic.wires.map((w) => w.id)).not.toContain('W1')
    expect(s.schematic.grounds).toEqual([])
  })

  it('cancel stops a wire first, then clears the selection', () => {
    let s: EditorState = { ...initialState(), selectedId: 'R1', wireStart: p(0, 0) }
    s = editorReducer(s, { type: 'cancel' })
    expect(s).toMatchObject({ selectedId: 'R1', wireStart: undefined })
    s = editorReducer(s, { type: 'cancel' })
    expect(s.selectedId).toBeUndefined()
  })

  it('does not mutate the previous state', () => {
    const before = initialState(voltageDivider.schematic)
    const snapshot = structuredClone(before)
    run([{ type: 'setValue', id: 'R1', value: 5 }, { type: 'select', id: 'R1' }, { type: 'deleteSelected' }], before)
    expect(before).toEqual(snapshot)
  })
})

describe('nextId', () => {
  it('uses one more than the largest existing number', () => {
    expect(nextId(voltageDivider.schematic, 'R')).toBe('R3')
    expect(nextId(voltageDivider.schematic, 'I')).toBe('I1')
  })
})
