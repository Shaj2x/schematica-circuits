/** Grid geometry shared by the canvas and the symbol drawings. */

import { PART_LENGTH, type Point } from '../schematic/model'

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
