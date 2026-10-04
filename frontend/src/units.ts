/**
 * Engineering notation: "4.7k" <-> 4700.
 *
 * The netlist stores plain SI numbers, so converting from and to the way
 * engineers write values happens here, at the edge of the system (and later
 * in the OCR step for photographed circuits).
 */

const PREFIXES: Record<string, number> = {
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  meg: 1e6,
  G: 1e9,
}

/**
 * Parses values like "4.7k", "10 mA", "2.2MΩ", "4.7uF", "5ms", "1e3", "-5V" or "4k7"
 * (the resistor-code style where the prefix replaces the decimal point).
 * Returns `undefined` for anything it cannot read.
 *
 * Case matters for exactly one ambiguity: "m" is milli and "M" is mega, as in
 * SI. SPICE's case-insensitive "meg" is accepted too.
 */
export function parseValue(text: string): number | undefined {
  const s = text.trim().replace(/\s+/g, '')
  // number | optional prefix | optional "4k7"-style digits | optional unit.
  // Case-sensitive on purpose so that "m" (milli) and "M" (mega) differ.
  const match =
    /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(meg|MEG|Meg|[pnuµmkKMG])?(\d*)(Ω|[oO]hms?|[vV]|[aA]|s|F|H)?$/.exec(s)
  if (!match) return undefined
  const [, numberPart = '', rawPrefix, trailingDigits = ''] = match
  const prefix = rawPrefix?.toLowerCase() === 'meg' ? 'meg' : rawPrefix
  const multiplier = prefix === undefined ? 1 : PREFIXES[prefix]
  if (multiplier === undefined) return undefined

  let digits = numberPart
  if (trailingDigits) {
    // "4k7" style: only valid when the prefix sits where a decimal point would.
    if (prefix === undefined || numberPart.includes('.') || /e/i.test(numberPart)) return undefined
    digits = `${numberPart}.${trailingDigits}`
  }
  const value = Number(digits) * multiplier
  return Number.isFinite(value) ? value : undefined
}

const FORMAT_PREFIXES: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
]

/**
 * Formats a value with an SI prefix and three significant figures:
 * 4700 -> "4.70 kΩ", 0.0025 -> "2.50 mA". Values that are zero up to
 * floating-point noise print as 0.
 */
export function formatValue(value: number, unit: string, digits = 3): string {
  if (!Number.isFinite(value)) return `— ${unit}`
  if (Math.abs(value) < 1e-15) return `0 ${unit}`
  const magnitude = Math.abs(value)
  const [scale, prefix] = FORMAT_PREFIXES.find(([s]) => magnitude >= s * 0.9995) ?? [1e-12, 'p']
  return `${(value / scale).toPrecision(digits)} ${prefix}${unit}`
}

/**
 * Axis tick labels: an SI prefix with no forced trailing digits, so
 * 0.0002 s reads "200 µs" rather than "2.0e+2 µs" or "200.0 µs".
 */
export function formatTick(value: number, unit: string): string {
  if (Math.abs(value) < 1e-15) return `0 ${unit}`
  const [scale, prefix] = FORMAT_PREFIXES.find(([s]) => Math.abs(value) >= s * 0.9995) ?? [1e-12, 'p']
  return `${Number((value / scale).toPrecision(3))} ${prefix}${unit}`
}

/** A compact form for inputs and labels: 4700 -> "4.7k". */
export function formatCompact(value: number): string {
  if (value === 0) return '0'
  const magnitude = Math.abs(value)
  const [scale, prefix] = FORMAT_PREFIXES.find(([s]) => magnitude >= s * 0.9995) ?? [1e-12, 'p']
  const scaled = Number((value / scale).toPrecision(4))
  return `${scaled}${prefix === 'µ' ? 'u' : prefix}`
}
