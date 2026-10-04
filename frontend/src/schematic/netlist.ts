/**
 * Schematic -> netlist: figuring out which points are electrically the same
 * node.
 *
 * Connection rules (the usual schematic conventions):
 * 1. A wire connects its two endpoints.
 * 2. A wire also connects to any *connection point* lying in its interior,
 *    meaning a part terminal, a ground or another wire's endpoint. This is a
 *    T-junction.
 * 3. Two wires that merely cross, with neither ending on the other, are NOT
 *    connected. On paper that is what a junction dot distinguishes.
 * 4. Every ground symbol is the same node.
 *
 * Implementation: union-find over connection points, then one netlist node
 * per resulting set.
 */

import type { Component, Netlist } from '../solver'
import { type Point, type Schematic, isStrictlyInside, pointKey } from './model'

export const GROUND_NODE = 'gnd'

export interface Connectivity {
  netlist: Netlist
  /** Node name of every connection point, by `pointKey`. */
  nodeOfPoint: Map<string, string>
  /** Node name of every wire, by wire id. */
  nodeOfWire: Map<string, string>
  /** Connection points where three or more connections meet (drawn as dots). */
  junctions: Point[]
  /** Connection points with only one connection: unconnected terminals and wire ends. */
  openEnds: Point[]
}

export function buildNetlist(schematic: Schematic): Connectivity {
  const { parts, wires, grounds } = schematic

  // Every point where something attaches, with how many attachments it has.
  const points = new Map<string, Point>()
  const degree = new Map<string, number>()
  const attach = (p: Point) => {
    const key = pointKey(p)
    points.set(key, p)
    degree.set(key, (degree.get(key) ?? 0) + 1)
  }
  for (const part of parts) {
    attach(part.a)
    attach(part.b)
  }
  for (const wire of wires) {
    attach(wire.a)
    attach(wire.b)
  }
  for (const ground of grounds) attach(ground.at)

  const uf = new UnionFind<string>()
  for (const key of points.keys()) uf.add(key)

  for (const wire of wires) {
    const a = pointKey(wire.a)
    uf.union(a, pointKey(wire.b))
    for (const [key, p] of points) {
      if (isStrictlyInside(p, wire.a, wire.b)) {
        uf.union(a, key)
        // The wire passes through, so it adds two branches at that point.
        degree.set(key, (degree.get(key) ?? 0) + 2)
      }
    }
  }

  const groundRoots = new Set(grounds.map((g) => uf.find(pointKey(g.at))))

  // Name non-ground nodes n1, n2, ... in reading order (top to bottom, left
  // to right) of their top-left point, so names are deterministic.
  const firstPoint = new Map<string, Point>()
  for (const [key, p] of points) {
    const root = uf.find(key)
    const current = firstPoint.get(root)
    if (!current || p.y < current.y || (p.y === current.y && p.x < current.x)) {
      firstPoint.set(root, p)
    }
  }
  const rootName = new Map<string, string>()
  const ordered = [...firstPoint.entries()]
    .filter(([root]) => !groundRoots.has(root))
    .sort(([, p], [, q]) => p.y - q.y || p.x - q.x)
  ordered.forEach(([root], i) => rootName.set(root, `n${i + 1}`))
  for (const root of groundRoots) rootName.set(root, GROUND_NODE)

  const nodeOfPoint = new Map<string, string>()
  for (const key of points.keys()) nodeOfPoint.set(key, rootName.get(uf.find(key))!)
  const node = (p: Point) => nodeOfPoint.get(pointKey(p))!

  const nodeOfWire = new Map(wires.map((w) => [w.id, node(w.a)]))

  const components: Component[] = parts.map((part): Component => {
    const [first, second] = [node(part.a), node(part.b)]
    switch (part.kind) {
      case 'resistor':
        return { id: part.id, type: 'resistor', a: first, b: second, value: part.value }
      case 'voltage_source':
        return { id: part.id, type: 'voltage_source', pos: first, neg: second, value: part.value }
      case 'current_source':
        return { id: part.id, type: 'current_source', from: first, to: second, value: part.value }
      case 'capacitor':
        return { id: part.id, type: 'capacitor', a: first, b: second, value: part.value, initial_voltage: part.initial ?? 0 }
      case 'inductor':
        return { id: part.id, type: 'inductor', a: first, b: second, value: part.value, initial_current: part.initial ?? 0 }
    }
  })

  const withDegree = (test: (d: number) => boolean) =>
    [...points.entries()].filter(([key]) => test(degree.get(key) ?? 0)).map(([, p]) => p)

  return {
    netlist: { version: 1, ground: GROUND_NODE, components },
    nodeOfPoint,
    nodeOfWire,
    junctions: withDegree((d) => d >= 3),
    openEnds: withDegree((d) => d === 1),
  }
}

/** Union-find keyed by arbitrary values, with path halving. */
class UnionFind<T> {
  private parent = new Map<T, T>()

  add(x: T) {
    if (!this.parent.has(x)) this.parent.set(x, x)
  }

  find(x: T): T {
    let node = x
    let parent = this.parent.get(node)!
    while (parent !== node) {
      const grandparent = this.parent.get(parent)!
      this.parent.set(node, grandparent)
      node = grandparent
      parent = this.parent.get(node)!
    }
    return node
  }

  union(a: T, b: T) {
    const [ra, rb] = [this.find(a), this.find(b)]
    if (ra !== rb) this.parent.set(rb, ra)
  }
}
