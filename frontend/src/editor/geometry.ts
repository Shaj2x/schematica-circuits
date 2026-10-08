/** Grid geometry shared by the canvas and the symbol drawings. */

import { PART_LENGTH, type Point, type Schematic } from '../schematic/model'

export const GRID = 40
export const PART_PX = PART_LENGTH * GRID

export const px = (p: Point) => ({ x: p.x * GRID, y: p.y * GRID })

/** The transform that maps local symbol coordinates onto segment a-b. */
export function partTransform(a: Point, b: Point): string {
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
  return `translate(${a.x * GRID} ${a.y * GRID}) rotate(${angle})`
}

/** Unit vector from a to b, and the perpendicular pointing "up/right" for labels. */
export function axes(a: Point, b: Point) {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
  // Perpendicular, chosen so labels sit above horizontal parts and to the
  // right of vertical ones regardless of which way the part was drawn.
  let normal = { x: along.y, y: -along.x }
  if (normal.y > 0 || (normal.y === 0 && normal.x < 0)) normal = { x: -normal.x, y: -normal.y }
  return { along, normal }
}

export const COLS = 20
export const ROWS = 12

/**
 * Grid size: the default 20 x 12, grown to fit whatever is drawn, so a
 * circuit recognized from a photo is never cut off at the edge.
 */
export function canvasSize(schematic: Schematic): { cols: number; rows: number } {
  const points = [
    ...schematic.parts.flatMap((p) => [p.a, p.b]),
    ...schematic.wires.flatMap((w) => [w.a, w.b]),
    ...schematic.grounds.map((g) => ({ x: g.at.x, y: g.at.y + 1 })), // room for the symbol below
  ]
  return {
    cols: Math.max(COLS, ...points.map((p) => p.x + 2)), // labels sit right of vertical parts
    rows: Math.max(ROWS, ...points.map((p) => p.y + 1)),
  }
}

/** The visible part of the grid, in grid units. */
export interface View {
  x: number
  y: number
  cols: number
  rows: number
}

function bounds(schematic: Schematic) {
  const points = [
    ...schematic.parts.flatMap((p) => [p.a, p.b]),
    ...schematic.wires.flatMap((w) => [w.a, w.b]),
    ...schematic.grounds.flatMap((g) => [g.at, { x: g.at.x, y: g.at.y + 1 }]), // the symbol hangs below
  ]
  if (points.length === 0) return undefined
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

/**
 * A view centred on the drawing, with room around it, at least the default
 * 20 x 12. Used when a circuit is opened; while editing, `growView` only
 * ever enlarges it, so the canvas never shifts under the pointer.
 */
export function fitView(schematic: Schematic): View {
  const b = bounds(schematic)
  if (!b) return { x: 0, y: 0, cols: COLS, rows: ROWS }
  const margin = 3
  const cols = Math.max(COLS, b.x1 - b.x0 + 2 * margin)
  const rows = Math.max(ROWS, b.y1 - b.y0 + 2 * margin)
  // Centre the drawing. Near the origin that shows a strip of negative
  // coordinates, which is drawn without grid dots: nothing can go there.
  const x = Math.floor((b.x0 + b.x1) / 2 - cols / 2)
  const y = Math.floor((b.y0 + b.y1) / 2 - rows / 2)
  return { x, y, cols, rows }
}

/** The view, enlarged if the drawing now reaches past it (plus a unit of room). */
export function growView(view: View, schematic: Schematic): View {
  const b = bounds(schematic)
  if (!b) return view
  const x = Math.min(view.x, b.x0 - 1)
  const y = Math.min(view.y, b.y0 - 1)
  const right = Math.max(view.x + view.cols, b.x1 + 2) // + room for labels right of vertical parts
  const bottom = Math.max(view.y + view.rows, b.y1 + 1)
  return { x, y, cols: right - x, rows: bottom - y }
}
