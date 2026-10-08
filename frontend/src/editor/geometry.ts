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
    cols: Math.max(COLS, ...points.map((p) => p.x + 1)),
    rows: Math.max(ROWS, ...points.map((p) => p.y + 1)),
  }
}
