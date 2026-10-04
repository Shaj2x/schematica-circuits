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
}

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

export function initialState(schematic: Schematic = emptySchematic): EditorState {
  return { schematic, tool: 'select', orientation: 'horizontal' }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
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
      return initialState(action.schematic)
  }
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
