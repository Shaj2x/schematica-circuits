import { describe, expect, it } from 'vitest'
import { rcCharging, seriesRlc } from '../schematic/examples'
import { buildNetlist } from '../schematic/netlist'
import { type Signal, defaultSignals, pruneSignals, toggleSignal } from './signals'

describe('toggleSignal', () => {
  it('takes the lowest free slot and keeps survivors’ colors', () => {
    let s: Signal[] = []
    s = toggleSignal(s, 'voltage', 'n1')
    s = toggleSignal(s, 'voltage', 'n2')
    s = toggleSignal(s, 'voltage', 'n3')
    s = toggleSignal(s, 'voltage', 'n1') // off
    expect(s).toEqual([
      { kind: 'voltage', name: 'n2', slot: 1 },
      { kind: 'voltage', name: 'n3', slot: 2 },
    ])
    // A new signal fills the freed slot 0; n2 and n3 are not repainted.
    s = toggleSignal(s, 'voltage', 'n4')
    expect(s.find((x) => x.name === 'n4')?.slot).toBe(0)
  })

  it('numbers voltage and current slots independently', () => {
    const s = toggleSignal(toggleSignal([], 'voltage', 'n1'), 'current', 'R1')
    expect(s.map((x) => x.slot)).toEqual([0, 0])
  })

  it('refuses a fifth line on a full chart', () => {
    let s: Signal[] = []
    for (const n of ['a', 'b', 'c', 'd']) s = toggleSignal(s, 'voltage', n)
    expect(toggleSignal(s, 'voltage', 'e')).toBe(s)
  })
})

describe('defaultSignals', () => {
  it('shows the capacitor voltage for an RC circuit', () => {
    const connectivity = buildNetlist(rcCharging.schematic)
    expect(defaultSignals(rcCharging.schematic, connectivity)).toEqual([{ kind: 'voltage', name: 'n2', slot: 0 }])
  })

  it('shows reactive node voltages and the inductor current for RLC', () => {
    const connectivity = buildNetlist(seriesRlc.schematic)
    const s = defaultSignals(seriesRlc.schematic, connectivity)
    expect(s.filter((x) => x.kind === 'voltage').map((x) => x.name)).toEqual(['n2', 'n3'])
    expect(s.filter((x) => x.kind === 'current').map((x) => x.name)).toEqual(['L1'])
  })
})

describe('pruneSignals', () => {
  it('drops signals that no longer exist and keeps identity when nothing changes', () => {
    const s: Signal[] = [
      { kind: 'voltage', name: 'n1', slot: 0 },
      { kind: 'current', name: 'C1', slot: 0 },
    ]
    expect(pruneSignals(s, new Set(['n1']), new Set(['C1']))).toBe(s)
    expect(pruneSignals(s, new Set(['n1']), new Set())).toEqual([s[0]])
  })
})
