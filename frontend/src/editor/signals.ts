/**
 * Which signals the transient plots show, and which color each one wears.
 *
 * A signal keeps its color slot for as long as it is selected: turning
 * another signal off never repaints the survivors, so a color always means
 * the same thing while the user is looking at it.
 */

import type { Schematic } from '../schematic/model'
import { type Connectivity, GROUND_NODE } from '../schematic/netlist'
import { pointKey } from '../schematic/model'
import { SERIES_COLORS } from './palette'

export type SignalKind = 'voltage' | 'current'

export interface Signal {
  kind: SignalKind
  /** Node name for a voltage, component id for a current. */
  name: string
  /** Color slot, unique among selected signals of the same kind. */
  slot: number
}

/** One chart per kind, with at most this many lines each. */
export const MAX_SIGNALS_PER_CHART = SERIES_COLORS.length

export const signalKey = (s: Pick<Signal, 'kind' | 'name'>) => `${s.kind}:${s.name}`

/**
 * Turns a signal on (taking the lowest free color slot of its chart) or off.
 * Returns the selection unchanged if that chart is already full.
 */
export function toggleSignal(selected: Signal[], kind: SignalKind, name: string): Signal[] {
  if (selected.some((s) => s.kind === kind && s.name === name)) {
    return selected.filter((s) => !(s.kind === kind && s.name === name))
  }
  const used = new Set(selected.filter((s) => s.kind === kind).map((s) => s.slot))
  const slot = SERIES_COLORS.findIndex((_, i) => !used.has(i))
  return slot === -1 ? selected : [...selected, { kind, name, slot }]
}

/**
 * A useful first view: the voltage at the non-ground end of every capacitor
 * and inductor (where the interesting dynamics are), and inductor currents.
 */
export function defaultSignals(schematic: Schematic, connectivity: Connectivity): Signal[] {
  let selected: Signal[] = []
  for (const part of schematic.parts) {
    if (part.kind !== 'capacitor' && part.kind !== 'inductor') continue
    for (const terminal of [part.a, part.b]) {
      const node = connectivity.nodeOfPoint.get(pointKey(terminal))
      if (node && node !== GROUND_NODE && !selected.some((s) => s.kind === 'voltage' && s.name === node)) {
        selected = toggleSignal(selected, 'voltage', node)
      }
    }
    if (part.kind === 'inductor') selected = toggleSignal(selected, 'current', part.id)
  }
  return selected
}

/** Drops signals whose node or component no longer exists after an edit. */
export function pruneSignals(selected: Signal[], nodes: Set<string>, parts: Set<string>): Signal[] {
  const kept = selected.filter((s) => (s.kind === 'voltage' ? nodes.has(s.name) : parts.has(s.name)))
  return kept.length === selected.length ? selected : kept
}
