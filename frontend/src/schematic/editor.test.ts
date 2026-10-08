import { describe, expect, it } from 'vitest'
import { voltageDivider } from './examples'
import { type EditorAction, type EditorState, type Tool, canRedo, editorReducer, initialState, nextId } from './editor'
import { type Schematic, emptySchematic } from './model'

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

describe('undo and redo', () => {
  const place = (state: EditorState, tool: Tool, x: number, y: number) =>
    editorReducer(editorReducer(state, { type: 'setTool', tool }), { type: 'clickPoint', point: { x, y } })

  it('undoes and redoes edits, and a new edit clears redo', () => {
    let s = place(initialState(), 'resistor', 1, 1)
    s = place(s, 'resistor', 1, 3)
    expect(s.schematic.parts.map((p) => p.id)).toEqual(['R1', 'R2'])
    s = editorReducer(s, { type: 'undo' })
    expect(s.schematic.parts.map((p) => p.id)).toEqual(['R1'])
    expect(canRedo(s)).toBe(true)
    s = editorReducer(s, { type: 'redo' })
    expect(s.schematic.parts.map((p) => p.id)).toEqual(['R1', 'R2'])
    s = editorReducer(s, { type: 'undo' })
    s = place(s, 'capacitor', 4, 4)
    expect(canRedo(s)).toBe(false)
  })

  it('groups a slider drag into one step', () => {
    let s = place(initialState(), 'resistor', 1, 1)
    for (const value of [1100, 1200, 1300, 1500]) s = editorReducer(s, { type: 'setValue', id: 'R1', value })
    s = editorReducer(s, { type: 'undo' })
    expect(s.schematic.parts[0]!.value).toBe(1000)
  })

  it('groups the steps of one drag, but not separate drags', () => {
    let s = place(initialState(), 'resistor', 1, 1)
    s = editorReducer(s, { type: 'move', id: 'R1', dx: 1, dy: 0, gesture: 1 })
    s = editorReducer(s, { type: 'move', id: 'R1', dx: 1, dy: 0, gesture: 1 })
    s = editorReducer(s, { type: 'move', id: 'R1', dx: 0, dy: 1, gesture: 2 })
    expect(s.schematic.parts[0]!.a).toEqual({ x: 3, y: 2 })
    s = editorReducer(s, { type: 'undo' })
    expect(s.schematic.parts[0]!.a).toEqual({ x: 3, y: 1 })
    s = editorReducer(s, { type: 'undo' })
    expect(s.schematic.parts[0]!.a).toEqual({ x: 1, y: 1 })
  })

  it('makes loading a circuit undoable', () => {
    let s = place(initialState(), 'resistor', 1, 1)
    s = editorReducer(s, { type: 'load', schematic: emptySchematic })
    s = editorReducer(s, { type: 'undo' })
    expect(s.schematic.parts).toHaveLength(1)
  })
})

describe('moving', () => {
  it('drags attached wire ends along with a part', () => {
    const schematic: Schematic = {
      parts: [{ id: 'R1', kind: 'resistor', a: { x: 2, y: 2 }, b: { x: 4, y: 2 }, value: 1 }],
      wires: [
        { id: 'W1', a: { x: 0, y: 2 }, b: { x: 2, y: 2 } },
        { id: 'W2', a: { x: 4, y: 2 }, b: { x: 6, y: 2 } },
        { id: 'W3', a: { x: 0, y: 5 }, b: { x: 6, y: 5 } },
      ],
      grounds: [],
    }
    const s = editorReducer(initialState(schematic), { type: 'move', id: 'R1', dx: 0, dy: 1 })
    expect(s.schematic.wires.map((w) => [w.a, w.b])).toEqual([
      [{ x: 0, y: 2 }, { x: 2, y: 3 }],
      [{ x: 4, y: 3 }, { x: 6, y: 2 }],
      [{ x: 0, y: 5 }, { x: 6, y: 5 }],
    ])
  })

  it('refuses to move off the canvas', () => {
    const schematic: Schematic = { parts: [], wires: [], grounds: [{ id: 'G1', at: { x: 0, y: 3 } }] }
    const s0 = initialState(schematic)
    expect(editorReducer(s0, { type: 'move', id: 'G1', dx: -1, dy: 0 })).toEqual({ ...s0, lastEdit: undefined })
  })
})
