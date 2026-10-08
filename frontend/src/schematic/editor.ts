/**
 * Editor state and every way it can change, as a pure reducer.
 *
 * Keeping all editing logic here, outside React, means it can be tested with
 * plain function calls ("click here with the wire tool, then here...") and
 * the canvas component only translates pointer events into actions.
 */

import type { ComponentKind } from '../solver'
import { KINDS, PART_LENGTH, type Point, type Schematic, emptySchematic, samePoint } from './model'

export type Tool = 'select' | 'wire' | 'ground' | ComponentKind

export type Orientation = 'horizontal' | 'vertical'

export interface EditorState {
  schematic: Schematic
  tool: Tool
  /** Orientation for the next part placed. */
  orientation: Orientation
  /** Id of the selected part, wire or ground. */
  selectedId?: string
  /** First point of a wire being drawn. */
  wireStart?: Point
  /** Earlier drawings, most recent last, for undo. */
  past: Schematic[]
  /** Undone drawings, next first, for redo. */
  future: Schematic[]
  /**
   * What the last edit was, when consecutive edits of the same kind should
   * undo as one: every tick of a value slider, every step of one drag.
   */
  lastEdit?: string
}

/** How many steps of undo to keep. Schematics are small, so this is cheap. */
export const HISTORY_LIMIT = 200

export type EditorAction =
  | { type: 'setTool'; tool: Tool }
  | { type: 'rotate' }
  | { type: 'clickPoint'; point: Point }
  | { type: 'select'; id: string | undefined }
  | { type: 'deleteSelected' }
  | { type: 'setValue'; id: string; value: number }
  | { type: 'setInitial'; id: string; value: number }
  | { type: 'flip'; id: string }
  | { type: 'cancel' }
  | { type: 'load'; schematic: Schematic }
  /** Move a part, ground or wire by a grid offset. Steps sharing a `gesture` undo as one. */
  | { type: 'move'; id: string; dx: number; dy: number; gesture?: number }
  | { type: 'undo' }
  | { type: 'redo' }

export function initialState(schematic: Schematic = emptySchematic): EditorState {
  return { schematic, tool: 'select', orientation: 'horizontal', past: [], future: [] }
}

export const canUndo = (state: EditorState) => state.past.length > 0
export const canRedo = (state: EditorState) => state.future.length > 0

/**
 * Every action, with undo history kept around the document changes.
 *
 * History holds whole schematics rather than inverse operations: they are a
 * few kilobytes, structurally shared, and "restore the previous drawing"
 * cannot get out of step with the edit that produced it.
 */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'undo' || action.type === 'redo') return travel(state, action.type)

  const next = edit(state, action)
  if (next.schematic === state.schematic) return { ...next, lastEdit: action.type === 'select' ? state.lastEdit : undefined }

  const key = groupKey(action)
  if (key !== undefined && key === state.lastEdit) {
    // Same gesture as the last edit: the drawing before it is already saved.
    return { ...next, past: state.past, future: [], lastEdit: key }
  }
  return { ...next, past: [...state.past, state.schematic].slice(-HISTORY_LIMIT), future: [], lastEdit: key }
}

function groupKey(action: EditorAction): string | undefined {
  switch (action.type) {
    case 'setValue':
    case 'setInitial':
      return `${action.type}:${action.id}`
    case 'move':
      return action.gesture === undefined ? undefined : `move:${action.gesture}`
    default:
      return undefined
  }
}

function travel(state: EditorState, direction: 'undo' | 'redo'): EditorState {
  const [from, to] = direction === 'undo' ? [state.past, state.future] : [state.future, state.past]
  if (from.length === 0) return state
  const schematic = direction === 'undo' ? from[from.length - 1]! : from[0]!
  const rest = direction === 'undo' ? from.slice(0, -1) : from.slice(1)
  const saved = direction === 'undo' ? [state.schematic, ...to] : [...to, state.schematic]
  const exists = (id?: string) =>
    id !== undefined && [...schematic.parts, ...schematic.wires, ...schematic.grounds].some((e) => e.id === id)
  return {
    ...state,
    schematic,
    past: direction === 'undo' ? rest : saved,
    future: direction === 'undo' ? saved : rest,
    selectedId: exists(state.selectedId) ? state.selectedId : undefined,
    wireStart: undefined,
    lastEdit: undefined,
  }
}

function edit(state: EditorState, action: Exclude<EditorAction, { type: 'undo' } | { type: 'redo' }>): EditorState {
  switch (action.type) {
    case 'setTool':
      return { ...state, tool: action.tool, wireStart: undefined }

    case 'rotate': {
      // With a part selected, rotate it 90° about its first terminal;
      // otherwise toggle the orientation for the next placement.
      const part = state.schematic.parts.find((p) => p.id === state.selectedId)
      if (part) {
        const dx = part.b.x - part.a.x
        const dy = part.b.y - part.a.y
        const b = { x: part.a.x - dy, y: part.a.y + dx }
        return updateParts(state, part.id, { b })
      }
      return { ...state, orientation: state.orientation === 'horizontal' ? 'vertical' : 'horizontal' }
    }

    case 'clickPoint':
      return clickPoint(state, action.point)

    case 'select':
      return { ...state, selectedId: action.id }

    case 'deleteSelected': {
      const id = state.selectedId
      if (!id) return state
      const { parts, wires, grounds } = state.schematic
      return {
        ...state,
        selectedId: undefined,
        schematic: {
          parts: parts.filter((p) => p.id !== id),
          wires: wires.filter((w) => w.id !== id),
          grounds: grounds.filter((g) => g.id !== id),
        },
      }
    }

    case 'setValue':
      return updateParts(state, action.id, { value: action.value })

    case 'setInitial':
      return updateParts(state, action.id, { initial: action.value })

    case 'flip': {
      const part = state.schematic.parts.find((p) => p.id === action.id)
      return part ? updateParts(state, part.id, { a: part.b, b: part.a }) : state
    }

    case 'cancel':
      return state.wireStart ? { ...state, wireStart: undefined } : { ...state, selectedId: undefined }

    case 'load':
      // Loading is an edit too: undo brings back what was there before.
      return { ...initialState(action.schematic), past: state.past, future: state.future }

    case 'move':
      return move(state, action.id, action.dx, action.dy)
  }
}

/**
 * Moves an element. Wires ending on a moved part's terminal (or a moved
 * ground) stretch to follow it, so moving a part keeps it connected. A move
 * that would leave the canvas (negative coordinates) is ignored.
 */
function move(state: EditorState, id: string, dx: number, dy: number): EditorState {
  if (dx === 0 && dy === 0) return state
  const { parts, wires, grounds } = state.schematic
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy })
  const part = parts.find((p) => p.id === id)
  const ground = grounds.find((g) => g.id === id)
  const wire = wires.find((w) => w.id === id)

  let schematic: Schematic
  if (part || ground) {
    const anchors = part ? [part.a, part.b] : [ground!.at]
    const follows = (p: Point) => anchors.some((q) => samePoint(p, q))
    schematic = {
      parts: parts.map((p) => (p.id === id ? { ...p, a: shift(p.a), b: shift(p.b) } : p)),
      grounds: grounds.map((g) => (g.id === id ? { ...g, at: shift(g.at) } : g)),
      wires: wires.map((w) =>
        follows(w.a) || follows(w.b) ? { ...w, a: follows(w.a) ? shift(w.a) : w.a, b: follows(w.b) ? shift(w.b) : w.b } : w,
      ),
    }
  } else if (wire) {
    schematic = { ...state.schematic, wires: wires.map((w) => (w.id === id ? { ...w, a: shift(w.a), b: shift(w.b) } : w)) }
  } else {
    return state
  }
  const points = [
    ...schematic.parts.flatMap((p) => [p.a, p.b]),
    ...schematic.wires.flatMap((w) => [w.a, w.b]),
    ...schematic.grounds.map((g) => g.at),
  ]
  if (points.some((p) => p.x < 0 || p.y < 0)) return state
  return { ...state, schematic }
}

function clickPoint(state: EditorState, point: Point): EditorState {
  const { schematic, tool } = state
  switch (tool) {
    case 'select':
      // Clicking empty canvas clears the selection. Clicks on elements are
      // dispatched as `select` by the canvas instead.
      return { ...state, selectedId: undefined }

    case 'wire': {
      if (!state.wireStart) return { ...state, wireStart: point }
      if (samePoint(state.wireStart, point)) return { ...state, wireStart: undefined }
      const wire = { id: nextId(schematic, 'W'), a: state.wireStart, b: point }
      // Keep drawing from the end of this wire, so paths with corners are a
      // series of clicks. Escape (or clicking the same point twice) stops.
      return { ...state, wireStart: point, schematic: { ...schematic, wires: [...schematic.wires, wire] } }
    }

    case 'ground': {
      if (schematic.grounds.some((g) => samePoint(g.at, point))) return state
      const ground = { id: nextId(schematic, 'G'), at: point }
      return { ...state, schematic: { ...schematic, grounds: [...schematic.grounds, ground] } }
    }

    default: {
      const info = KINDS[tool]
      const b =
        state.orientation === 'horizontal'
          ? { x: point.x + PART_LENGTH, y: point.y }
          : { x: point.x, y: point.y + PART_LENGTH }
      const part = { id: nextId(schematic, info.idPrefix), kind: tool, a: point, b, value: info.defaultValue }
      return {
        ...state,
        selectedId: part.id,
        schematic: { ...schematic, parts: [...schematic.parts, part] },
      }
    }
  }
}

function updateParts(state: EditorState, id: string, patch: Partial<Schematic['parts'][number]>): EditorState {
  return {
    ...state,
    schematic: {
      ...state.schematic,
      parts: state.schematic.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    },
  }
}

/** The next free id with this prefix: one more than the largest in use. */
export function nextId(schematic: Schematic, prefix: string): string {
  const ids = [...schematic.parts, ...schematic.wires, ...schematic.grounds].map((e) => e.id)
  const used = ids
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length)))
    .filter(Number.isInteger)
  return `${prefix}${Math.max(0, ...used) + 1}`
}
