import { describe, expect, it } from 'vitest'
import type { Netlist } from '../solver'
import type { Schematic } from './model'
import { buildNetlist } from './netlist'
import fixtures from './recognized.fixture.json'

/**
 * The photo pipeline (ml/schematica_vision/layout.py) has a Python copy of
 * this editor's connection rules, which it uses to check its layouts. The
 * fixture is written by the Python tests; this checks the editor derives the
 * exact same netlist from each schematic, so the two copies cannot drift.
 */
describe('recognized schematics', () => {
  for (const [name, fixture] of Object.entries(fixtures as Record<string, { schematic: Schematic; netlist: Netlist }>)) {
    it(`${name}: the editor derives the netlist the pipeline verified`, () => {
      expect(buildNetlist(fixture.schematic).netlist).toEqual(fixture.netlist)
    })
  }
})
