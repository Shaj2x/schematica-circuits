/**
 * Pure helpers for transient analysis in the editor: default settings, and
 * slicing a time-series result for display.
 */

import type { Schematic } from '../schematic/model'
import type { Integration, Solution, TransientSolution } from '../solver'

export interface TransientSettings {
  /** Seconds. */
  stopTime: number
  /** Seconds. */
  timeStep: number
  method: Integration
}

/** Samples per run when settings are suggested: smooth curves, instant solves. */
const SUGGESTED_STEPS = 1000

/**
 * Suggests a stop time of about five of the circuit's slowest time
 * constants, so the response visibly settles.
 *
 * Exact time constants need the circuit's Thevenin resistances, which is
 * itself an analysis. This uses cheap estimates from component values
 * instead: RC with the largest resistance, L/R with the smallest, and the LC
 * oscillation period 2π√(LC). It only picks a starting point that the user
 * can change, so an overestimate is harmless.
 */
export function suggestSettings(schematic: Schematic): TransientSettings {
  const values = (kind: string) => schematic.parts.filter((p) => p.kind === kind).map((p) => Math.abs(p.value))
  const [rs, cs, ls] = [values('resistor'), values('capacitor'), values('inductor')]
  const candidates: number[] = []
  if (rs.length) {
    const [rMin, rMax] = [Math.min(...rs), Math.max(...rs)]
    for (const c of cs) candidates.push(c * rMax)
    for (const l of ls) candidates.push(l / rMin)
  }
  for (const l of ls) for (const c of cs) candidates.push(2 * Math.PI * Math.sqrt(l * c))
  const slowest = candidates.filter((t) => t > 0 && Number.isFinite(t))
  const stopTime = niceCeil(5 * (slowest.length ? Math.max(...slowest) : 1e-3))
  return { stopTime, timeStep: stopTime / SUGGESTED_STEPS, method: 'trapezoidal' }
}

/** Rounds up to 1, 2 or 5 times a power of ten. */
export function niceCeil(x: number): number {
  const power = 10 ** Math.floor(Math.log10(x))
  const scaled = x / power
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10
  // Multiply then round to strip floating-point noise like 5.000000000000001e-3.
  return Number((nice * power).toPrecision(12))
}

/** The solution at one sample, in the same shape as a DC solution. */
export function sampleAt(solution: TransientSolution, index: number): Solution {
  const pick = (series: Record<string, number[]>) =>
    Object.fromEntries(Object.entries(series).map(([key, values]) => [key, values[index] ?? Number.NaN]))
  return { node_voltages: pick(solution.node_voltages), branch_currents: pick(solution.branch_currents) }
}

/** Index of the sample nearest to time `t` (binary search; times are sorted). */
export function nearestIndex(time: number[], t: number): number {
  let lo = 0
  let hi = time.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (time[mid]! <= t) lo = mid
    else hi = mid
  }
  return Math.abs(time[hi]! - t) < Math.abs(time[lo]! - t) ? hi : lo
}

/**
 * Reduces a series to at most about `maxPoints` points for drawing, keeping
 * the minimum and maximum of each bucket so peaks and ringing survive.
 * Plain striding (every k-th sample) could skip exactly the overshoot a
 * student is looking for.
 */
export function decimate(time: number[], values: number[], maxPoints: number): { t: number; y: number }[] {
  const n = Math.min(time.length, values.length)
  if (n <= maxPoints) return Array.from({ length: n }, (_, i) => ({ t: time[i]!, y: values[i]! }))
  const buckets = Math.max(1, Math.floor(maxPoints / 2))
  const size = n / buckets
  const points: { t: number; y: number }[] = []
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * size)
    const end = Math.min(n, Math.floor((b + 1) * size))
    let iMin = start
    let iMax = start
    for (let i = start; i < end; i++) {
      if (values[i]! < values[iMin]!) iMin = i
      if (values[i]! > values[iMax]!) iMax = i
    }
    // Emit the two extremes in time order so the line does not double back.
    for (const i of iMin <= iMax ? [iMin, iMax] : [iMax, iMin]) {
      if (points.at(-1)?.t !== time[i]) points.push({ t: time[i]!, y: values[i]! })
    }
  }
  // Always keep the final sample so the line reaches the stop time.
  if (points.at(-1)?.t !== time[n - 1]) points.push({ t: time[n - 1]!, y: values[n - 1]! })
  return points
}
