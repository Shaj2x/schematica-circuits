/**
 * The editor's document model: what the user drew, in grid coordinates.
 *
 * This is deliberately separate from the netlist. A schematic has geometry
 * (where things are, which wires exist) and no notion of nodes; the netlist
 * has nodes and no geometry. `netlist.ts` derives one from the other, the
 * same way the CV pipeline in Phase 5 will derive a netlist from a photo.
 */

import type { ComponentKind } from '../solver'

/** A point on the editor grid, in grid units (not pixels). */
export interface Point {
  x: number
  y: number
}

/**
 * A two-terminal component drawn from `a` to `b`. `a` is the first terminal
 * in netlist terms: `a` for resistors, `pos` for voltage sources and `from`
 * for current sources. Flipping a part swaps `a` and `b`.
 */
export interface Part {
  id: string
  kind: ComponentKind
  a: Point
  b: Point
  value: number
}

/** A straight wire between two grid points. */
export interface Wire {
  id: string
  a: Point
  b: Point
}

/** A ground symbol. Every ground symbol is the same node: the reference. */
export interface Ground {
  id: string
  at: Point
}

export interface Schematic {
  parts: Part[]
  wires: Wire[]
  grounds: Ground[]
}

export const emptySchematic: Schematic = { parts: [], wires: [], grounds: [] }

/** Parts span this many grid units between their terminals. */
export const PART_LENGTH = 2

export interface KindInfo {
  label: string
  idPrefix: string
  unit: string
  defaultValue: number
}

export const KINDS: Record<ComponentKind, KindInfo> = {
  resistor: { label: 'Resistor', idPrefix: 'R', unit: 'Ω', defaultValue: 1000 },
  voltage_source: { label: 'Voltage source', idPrefix: 'V', unit: 'V', defaultValue: 5 },
  current_source: { label: 'Current source', idPrefix: 'I', unit: 'A', defaultValue: 0.001 },
}

export function pointKey(p: Point): string {
  return `${p.x},${p.y}`
}

export function samePoint(p: Point, q: Point): boolean {
  return p.x === q.x && p.y === q.y
}

/**
 * True if `p` lies on segment a-b, excluding the endpoints. Exact integer
 * arithmetic (grid coordinates are integers), so there is no tolerance to
 * tune: `p` is collinear when the cross product is 0, and between the
 * endpoints when its projection is strictly inside the segment.
 */
export function isStrictlyInside(p: Point, a: Point, b: Point): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  if (cross !== 0) return false
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)
  const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  return dot > 0 && dot < lengthSquared
}
