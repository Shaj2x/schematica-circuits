/**
 * SVG drawings of circuit symbols.
 *
 * Two-terminal symbols are drawn once in local coordinates, lying along the
 * x-axis from (0, 0) to (PART_PX, 0), and then rotated into place. That way
 * a part at any orientation uses the same drawing. Glyphs that must stay
 * upright (the + and − of a voltage source, labels) are positioned in world
 * coordinates instead, so they are never drawn sideways.
 */

import type { ComponentKind } from '../solver'
import type { Point } from '../schematic/model'
import { GRID, axes, px } from './geometry'

/** Local-coordinate drawing of a part body (no transform applied). */
export function PartBody({ kind }: { kind: ComponentKind }) {
  switch (kind) {
    case 'resistor':
      // Leads of 20 px, then a zigzag across the middle 40 px.
      return <path d="M0 0 H20 l3.33 -8 l6.67 16 l6.67 -16 l6.67 16 l6.67 -16 l6.67 16 l3.33 -8 H80" fill="none" />
    case 'voltage_source':
      return (
        <>
          <path d="M0 0 H22 M58 0 H80" />
          <circle cx={40} cy={0} r={18} fill="var(--canvas-bg)" />
        </>
      )
    case 'capacitor':
      // Two plates 8 px apart across the middle.
      return <path d="M0 0 H36 M36 -13 V13 M44 -13 V13 M44 0 H80" fill="none" />
    case 'inductor':
      // Four half-turn coils across the middle 48 px.
      return <path d="M0 0 H16 a6 6 0 0 1 12 0 a6 6 0 0 1 12 0 a6 6 0 0 1 12 0 a6 6 0 0 1 12 0 H80" fill="none" />
    case 'current_source':
      // The arrow points from the "from" terminal (a) to the "to" terminal (b).
      return (
        <>
          <path d="M0 0 H22 M58 0 H80" />
          <circle cx={40} cy={0} r={18} fill="var(--canvas-bg)" />
          <path d="M29 0 H50 M44 -6 L51 0 L44 6" fill="none" />
        </>
      )
  }
}

/** The + and − marks of a voltage source, kept upright in world coordinates. */
export function PolarityMarks({ a, b }: { a: Point; b: Point }) {
  const { along } = axes(a, b)
  const at = (distance: number) => ({
    x: a.x * GRID + along.x * distance,
    y: a.y * GRID + along.y * distance,
  })
  const plus = at(30)
  const minus = at(50)
  return (
    <g strokeWidth={1.6}>
      <path d={`M${plus.x - 4} ${plus.y} h8 M${plus.x} ${plus.y - 4} v8`} />
      <path d={`M${minus.x - 4} ${minus.y} h8`} />
    </g>
  )
}

export function GroundSymbol({ at }: { at: Point }) {
  const { x, y } = px(at)
  return (
    <path
      d={`M${x} ${y} v12 M${x - 12} ${y + 12} h24 M${x - 7.5} ${y + 17} h15 M${x - 3} ${y + 22} h6`}
      fill="none"
    />
  )
}

/** An arrow drawn beside a part showing the actual direction of current. */
export function CurrentArrow({ a, b, forward }: { a: Point; b: Point; forward: boolean }) {
  const { along, normal } = axes(a, b)
  const mid = { x: ((a.x + b.x) / 2) * GRID, y: ((a.y + b.y) / 2) * GRID }
  const dir = forward ? along : { x: -along.x, y: -along.y }
  const offset = 16
  const cx = mid.x - normal.x * offset
  const cy = mid.y - normal.y * offset
  const tail = { x: cx - dir.x * 14, y: cy - dir.y * 14 }
  const head = { x: cx + dir.x * 14, y: cy + dir.y * 14 }
  // Arrowhead: two short strokes back from the head, at ±35° to the shaft.
  const back = (angle: number) => {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return {
      x: head.x - 7 * (dir.x * cos - dir.y * sin),
      y: head.y - 7 * (dir.x * sin + dir.y * cos),
    }
  }
  const [left, right] = [back(0.6), back(-0.6)]
  return (
    <path
      d={`M${tail.x} ${tail.y} L${head.x} ${head.y} M${left.x} ${left.y} L${head.x} ${head.y} L${right.x} ${right.y}`}
      fill="none"
      className="stroke-amber-600"
      strokeWidth={2}
      data-testid="current-arrow"
    />
  )
}
