import { describe, expect, it } from 'vitest'
import { voltageDivider } from './examples'
import { ShareError, fromHash, fromJson, toHash, toJson } from './share'

describe('sharing circuits', () => {
  const schematic = voltageDivider.schematic

  it('round-trips through a link and a file', () => {
    expect(fromHash(toHash(schematic))).toEqual(schematic)
    expect(fromJson(toJson(schematic))).toEqual(schematic)
  })

  it('makes links that are URL-safe', () => {
    expect(toHash(schematic)).toMatch(/^#c=[A-Za-z0-9_-]+$/)
  })

  it('ignores fragments that are not circuits', () => {
    expect(fromHash('')).toBeUndefined()
    expect(fromHash('#results')).toBeUndefined()
  })

  it('rejects damaged or hostile input with a readable message', () => {
    expect(() => fromHash('#c=bm90IGpzb24')).toThrow(ShareError)
    expect(() => fromJson('{"format":"other"}')).toThrow(/not a Schematica circuit/)
    const tampered = JSON.parse(toJson(schematic))
    tampered.schematic.parts[0].value = 'lots'
    expect(() => fromJson(JSON.stringify(tampered))).toThrow(/value of/)
    tampered.schematic.parts[0].value = 1
    tampered.schematic.parts[0].kind = 'transistor'
    expect(() => fromJson(JSON.stringify(tampered))).toThrow(/part V1/)
  })

  it('drops unknown fields', () => {
    const extra = JSON.parse(toJson(schematic))
    extra.schematic.parts[0].onclick = 'alert(1)'
    expect(fromJson(JSON.stringify(extra)).parts[0]).not.toHaveProperty('onclick')
  })
})
