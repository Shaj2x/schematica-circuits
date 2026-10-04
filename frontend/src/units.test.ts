import { describe, expect, it } from 'vitest'
import { formatCompact, formatTick, formatValue, parseValue } from './units'

describe('parseValue', () => {
  it.each([
    ['1000', 1000],
    ['4.7k', 4700],
    ['4.7 kΩ', 4700],
    ['4k7', 4700],
    ['2.2M', 2.2e6],
    ['1meg', 1e6],
    ['1MEG', 1e6],
    ['10m', 0.01],
    ['10mA', 0.01],
    ['100u', 1e-4],
    ['100µ', 1e-4],
    ['5V', 5],
    ['-5 V', -5],
    ['.5', 0.5],
    ['1e3', 1000],
    ['1.5e-3', 0.0015],
    ['330 ohm', 330],
    ['4.7uF', 4.7e-6],
    ['10mH', 0.01],
    ['5ms', 0.005],
    ['2 s', 2],
    ['0', 0],
  ])('%s -> %d', (text, expected) => {
    expect(parseValue(text)).toBeCloseTo(expected, 12)
  })

  it('distinguishes milli from mega by case', () => {
    expect(parseValue('1m')).toBe(0.001)
    expect(parseValue('1M')).toBe(1e6)
  })

  it.each(['', 'abc', '4.7x', 'k', '1.2k3', '--5', '1e400'])('rejects %j', (text) => {
    expect(parseValue(text)).toBeUndefined()
  })
})

describe('formatValue', () => {
  it.each([
    [4700, 'Ω', '4.70 kΩ'],
    [0.0025, 'A', '2.50 mA'],
    [5, 'V', '5.00 V'],
    [-0.0045, 'A', '-4.50 mA'],
    [1e-18, 'A', '0 A'],
    [2.2e6, 'Ω', '2.20 MΩ'],
    [999.99, 'V', '1.00 kV'],
  ])('%d %s -> %s', (value, unit, expected) => {
    expect(formatValue(value, unit)).toBe(expected)
  })
})

describe('formatTick', () => {
  it.each([
    [2e-4, 's', '200 µs'],
    [0.5, 'V', '500 mV'],
    [1e-3, 's', '1 ms'],
    [1.5, 'V', '1.5 V'],
    [-0.01, 'A', '-10 mA'],
    [0, 'V', '0 V'],
  ])('%d %s -> %s', (value, unit, expected) => expect(formatTick(value, unit)).toBe(expected))
})

describe('formatCompact', () => {
  it.each([
    [4700, '4.7k'],
    [1000, '1k'],
    [0.001, '1m'],
    [1e-6, '1u'],
    [12, '12'],
    [-5, '-5'],
  ])('%d -> %s', (value, expected) => {
    expect(formatCompact(value)).toBe(expected)
  })

  it('round-trips through parseValue', () => {
    for (const v of [4700, 0.0033, 2.2e6, -12, 150, 1e-9]) {
      expect(parseValue(formatCompact(v))).toBeCloseTo(v, 12)
    }
  })
})
