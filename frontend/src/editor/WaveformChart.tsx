import { scaleLinear } from 'd3-scale'
import { line } from 'd3-shape'
import { type KeyboardEvent, type PointerEvent, useMemo, useRef } from 'react'
import { formatTick, formatValue } from '../units'
import { SERIES_COLORS } from './palette'
import { decimate, nearestIndex } from './transient'

export interface Series {
  key: string
  label: string
  /** Index into SERIES_COLORS, fixed for as long as the series is shown. */
  slot: number
  values: number[]
}

interface WaveformChartProps {
  title: string
  unit: string
  time: number[]
  series: Series[]
  /** Sample index under the crosshair, shared with the other chart and the canvas. */
  cursor?: number
  onCursor: (index: number) => void
}

const WIDTH = 760
const HEIGHT = 220
const MARGIN = { top: 12, right: 64, bottom: 28, left: 64 }
/** SVG paths beyond a few thousand points cost frame time and add nothing at this width. */
const MAX_POINTS = 1500

/**
 * A time-series line chart with one y-axis. Voltages and currents go in
 * separate charts rather than on a dual axis, so every line is read
 * against the axis it belongs to.
 */
export function WaveformChart({ title, unit, time, series, cursor, onCursor }: WaveformChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const tEnd = time.at(-1) ?? 1

  const { x, y, paths } = useMemo(() => {
    const all = series.flatMap((s) => s.values)
    let [lo, hi] = [Math.min(0, ...all), Math.max(0, ...all)]
    if (hi - lo < 1e-15) [lo, hi] = [lo - 1, hi + 1]
    const x = scaleLinear().domain([0, tEnd]).range([MARGIN.left, WIDTH - MARGIN.right])
    const y = scaleLinear().domain([lo, hi]).nice().range([HEIGHT - MARGIN.bottom, MARGIN.top])
    const path = line<{ t: number; y: number }>()
      .x((d) => x(d.t))
      .y((d) => y(d.y))
    const paths = series.map((s) => path(decimate(time, s.values, MAX_POINTS)) ?? '')
    return { x, y, paths }
  }, [series, time, tEnd])

  // End-of-line labels, nudged apart vertically so they never overlap.
  const labels = useMemo(() => {
    const placed = series
      .map((s) => ({ s, y: y(s.values.at(-1) ?? 0) }))
      .sort((a, b) => a.y - b.y)
    for (let i = 1; i < placed.length; i++) {
      placed[i]!.y = Math.max(placed[i]!.y, placed[i - 1]!.y + 14)
    }
    return placed
  }, [series, y])

  function pointerToIndex(event: PointerEvent): number | undefined {
    const matrix = svgRef.current?.getScreenCTM?.()
    if (!matrix) return undefined
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    return nearestIndex(time, x.invert(local.x))
  }

  function onKeyDown(event: KeyboardEvent) {
    const stride = Math.max(1, Math.round(time.length / 100))
    const current = cursor ?? time.length - 1
    const next =
      event.key === 'ArrowLeft'
        ? current - stride
        : event.key === 'ArrowRight'
          ? current + stride
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? time.length - 1
              : undefined
    if (next === undefined) return
    event.preventDefault()
    onCursor(Math.min(time.length - 1, Math.max(0, next)))
  }

  const xTicks = x.ticks(6)
  const yTicks = y.ticks(5)
  const active = cursor !== undefined && cursor < time.length ? cursor : undefined

  return (
    <figure className="space-y-1">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold text-slate-800">{title}</span>
        {/* Legend: a short stroke of the series color keys each label. */}
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-slate-600">
            <svg width="14" height="4" aria-hidden="true">
              <line x1="0" y1="2" x2="14" y2="2" stroke={SERIES_COLORS[s.slot]} strokeWidth="2" strokeLinecap="round" />
            </svg>
            {s.label}
          </span>
        ))}
      </figcaption>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full touch-none select-none rounded-md bg-white outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        role="img"
        aria-label={`${title} versus time. Use the arrow keys to move the time cursor.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        // The cursor stays where the pointer left the chart, so the circuit
        // readouts can be read at that moment.
        onPointerMove={(e) => {
          const index = pointerToIndex(e)
          if (index !== undefined) onCursor(index)
        }}
      >
        {/* Recessive grid and axes */}
        <g className="text-[11px]">
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#cbd5e1' : '#eef2f6'} />
              <text x={MARGIN.left - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" className="fill-slate-500">
                {formatTick(v, unit)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={HEIGHT - MARGIN.bottom + 16} textAnchor="middle" className="fill-slate-500">
              {formatTick(t, 's')}
            </text>
          ))}
        </g>

        {series.map((s, i) => (
          <path
            key={s.key}
            d={paths[i]}
            fill="none"
            stroke={SERIES_COLORS[s.slot]}
            strokeWidth={2}
            strokeLinejoin="round"
            data-testid={`series-${s.key}`}
          />
        ))}

        {/* Direct labels at the end of each line, in text ink. */}
        {labels.map(({ s, y: ly }) => (
          <text key={s.key} x={WIDTH - MARGIN.right + 6} y={ly} dominantBaseline="middle" className="fill-slate-700 text-[11px]">
            {s.label}
          </text>
        ))}

        {/* Crosshair: snaps to the nearest sample; one readout for every series. */}
        {active !== undefined && (
          <Crosshair
            x={x(time[active]!)}
            time={time[active]!}
            unit={unit}
            rows={series.map((s) => ({ s, value: s.values[active]! }))}
            dots={series.map((s) => ({ key: s.key, slot: s.slot, cy: y(s.values[active]!) }))}
          />
        )}
      </svg>
    </figure>
  )
}

function Crosshair({
  x,
  time,
  unit,
  rows,
  dots,
}: {
  x: number
  time: number
  unit: string
  rows: { s: Series; value: number }[]
  dots: { key: string; slot: number; cy: number }[]
}) {
  const boxWidth = 150
  const boxHeight = 22 + rows.length * 16
  // Flip the readout to the left of the line near the right edge.
  const boxX = x + 10 + boxWidth > WIDTH - MARGIN.right ? x - 10 - boxWidth : x + 10
  return (
    <g pointerEvents="none" data-testid="chart-crosshair">
      <line x1={x} x2={x} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke="#94a3b8" strokeWidth={1} />
      {dots.map((d) => (
        // A 2 px surface ring keeps overlapping markers distinct.
        <circle key={d.key} cx={x} cy={d.cy} r={4} fill={SERIES_COLORS[d.slot]} stroke="#ffffff" strokeWidth={2} />
      ))}
      <rect x={boxX} y={MARGIN.top} width={boxWidth} height={boxHeight} rx={6} fill="#0f172a" fillOpacity={0.92} />
      <text x={boxX + 8} y={MARGIN.top + 15} className="fill-slate-300 text-[11px]">
        t = {formatValue(time, 's')}
      </text>
      {rows.map(({ s, value }, i) => (
        <g key={s.key} transform={`translate(${boxX + 8} ${MARGIN.top + 31 + i * 16})`}>
          <line x1={0} x2={10} y1={-4} y2={-4} stroke={SERIES_COLORS[s.slot]} strokeWidth={2} strokeLinecap="round" />
          {/* Value leads (strong), label follows (secondary). */}
          <text x={16} className="fill-white font-mono text-[11px] font-semibold">
            {formatValue(value, unit)}
          </text>
          <text x={boxWidth - 16} textAnchor="end" className="fill-slate-300 text-[11px]">
            {s.label}
          </text>
        </g>
      ))}
    </g>
  )
}
