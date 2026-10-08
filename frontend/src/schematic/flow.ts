/**
 * Current in every wire segment, for animating current flow.
 *
 * The solver reports the current through each component, not through
 * wires. Inside one node the wires form a network of zero-resistance
 * segments, and the current in each segment follows from KCL: every
 * terminal injects (or draws) its component's current at its point, and on
 * a tree each segment carries the total injected on its far side. Wire
 * loops inside a node are electrically meaningless (any split is valid), so
 * a spanning tree is used and the extra segments carry nothing.
 *
 * Ground symbols are all one node in the netlist but separate places in the
 * drawing: a wire island holding ground symbols returns whatever it does
 * not balance through them, as if they were joined underneath.
 */

import type { Solution } from '../solver'
import { type Point, type Schematic, isStrictlyInside, pointKey } from './model'

export interface Segment {
  a: Point
  b: Point
  /** Amperes, positive when flowing from `a` to `b`. */
  current: number
}

export function wireCurrents(schematic: Schematic, solution: Solution): Segment[] {
  const points = new Map<string, Point>()
  const add = (p: Point) => points.set(pointKey(p), p)
  for (const part of schematic.parts) [part.a, part.b].forEach(add)
  for (const wire of schematic.wires) [wire.a, wire.b].forEach(add)
  for (const ground of schematic.grounds) add(ground.at)

  // Split wires at every connection point in their interior (T-junctions).
  const segments: { a: Point; b: Point }[] = []
  for (const wire of schematic.wires) {
    const inside = [...points.values()]
      .filter((p) => isStrictlyInside(p, wire.a, wire.b))
      .sort((p, q) => dist2(wire.a, p) - dist2(wire.a, q))
    const stops = [wire.a, ...inside, wire.b]
    for (let i = 0; i + 1 < stops.length; i++) segments.push({ a: stops[i]!, b: stops[i + 1]! })
  }

  // Current entering the wire network at each point.
  const injected = new Map<string, number>()
  const inject = (p: Point, amps: number) => injected.set(pointKey(p), (injected.get(pointKey(p)) ?? 0) + amps)
  for (const part of schematic.parts) {
    // i flows a -> b through the part: it leaves the wires at a, re-enters them at b.
    const i = solution.branch_currents[part.id] ?? 0
    inject(part.a, -i)
    inject(part.b, i)
  }

  const neighbours = new Map<string, { to: string; segment: number }[]>()
  for (const key of points.keys()) neighbours.set(key, [])
  segments.forEach((s, index) => {
    neighbours.get(pointKey(s.a))!.push({ to: pointKey(s.b), segment: index })
    neighbours.get(pointKey(s.b))!.push({ to: pointKey(s.a), segment: index })
  })
  const groundKeys = new Set(schematic.grounds.map((g) => pointKey(g.at)))

  const current = new Array<number>(segments.length).fill(0)
  const seen = new Set<string>()
  for (const root of points.keys()) {
    if (seen.has(root)) continue
    // Breadth-first spanning tree of this wire island.
    const order: string[] = []
    const parent = new Map<string, { from: string; segment: number }>()
    seen.add(root)
    for (let queue = [root]; queue.length > 0; ) {
      const v = queue.shift()!
      order.push(v)
      for (const { to, segment } of neighbours.get(v)!) {
        if (seen.has(to)) continue
        seen.add(to)
        parent.set(to, { from: v, segment })
        queue.push(to)
      }
    }
    // Ground symbols in the island absorb its imbalance, shared equally.
    const grounds = order.filter((k) => groundKeys.has(k))
    if (grounds.length > 0) {
      const imbalance = order.reduce((sum, k) => sum + (injected.get(k) ?? 0), 0)
      for (const g of grounds) injected.set(g, (injected.get(g) ?? 0) - imbalance / grounds.length)
    }
    // Leaves first: what a subtree injects flows out through its parent edge.
    const subtree = new Map(order.map((k) => [k, injected.get(k) ?? 0]))
    for (const v of order.slice().reverse()) {
      const edge = parent.get(v)
      if (!edge) continue
      const outflow = subtree.get(v)!
      subtree.set(edge.from, subtree.get(edge.from)! + outflow)
      const s = segments[edge.segment]!
      // Positive outflow runs from v towards its parent.
      current[edge.segment] = pointKey(s.a) === v ? outflow : -outflow
    }
  }
  return segments.map((s, i) => ({ ...s, current: current[i]! }))
}

function dist2(p: Point, q: Point): number {
  return (p.x - q.x) ** 2 + (p.y - q.y) ** 2
}
