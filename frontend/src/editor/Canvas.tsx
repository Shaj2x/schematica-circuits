import { scaleLinear } from 'd3-scale'
import { type Dispatch, type PointerEvent, useMemo, useRef, useState } from 'react'
import type { EditorAction, EditorState } from '../schematic/editor'
import { wireCurrents } from '../schematic/flow'
import { KINDS, PART_LENGTH, type Point, pointKey } from '../schematic/model'
import { formatValue } from '../units'
import type { Solution } from '../solver'
import type { Diagnosis } from './diagnose'
import { GRID, type View, axes, fitView, growView, partTransform, px } from './geometry'
import { CurrentArrow, GroundSymbol, PartBody, PolarityMarks } from './symbols'
import type { Simulation } from './useSimulation'
import { CANVAS_BG, VOLTAGE_RAMP } from './palette'

const STROKE = { error: 'stroke-red-400', selected: 'stroke-cyan-300', hover: 'stroke-amber-300' } as const

/** Gap between current-flow dots, in canvas pixels. */
const DOT_SPACING = 18

let gestureCount = 0

/** What the pointer (or a row in the results table) is pointing at. */
export type Hover = { kind: 'node'; node: string; at?: Point } | { kind: 'part'; id: string }

interface CanvasProps {
  state: EditorState
  dispatch: Dispatch<EditorAction>
  simulation: Simulation
  diagnosis?: Diagnosis
  /** Values to show on hover: the DC solution, or one transient sample. */
  solution?: Solution
  hover?: Hover
  onHover: (hover: Hover | undefined) => void
  /** Animate current along the wires (on by default). */
  showFlow?: boolean
  /**
   * The current that moves dots fastest. Defaults to the largest in this
   * solution; a transient run passes its largest over the whole run, so
   * dots slow down as a capacitor charges instead of staying the same speed.
   */
  flowPeak?: number
  /** Changes whenever a different circuit is opened, to re-centre the view on it. */
  fitKey?: number
}

export function Canvas({ state, dispatch, simulation, diagnosis, solution, hover, onHover, showFlow = true, flowPeak, fitKey = 0 }: CanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [cursor, setCursor] = useState<Point>()
  const drag = useRef<{ id: string; last: Point; gesture: number }>(undefined)
  const [dragging, setDragging] = useState(false)
  const grabbed = useRef(false)
  const { schematic, tool, selectedId, wireStart } = state
  const { connectivity } = simulation
  // Fit the view when a circuit is opened; afterwards only grow it. (State
  // adjusted during render when the key changes, as React recommends.)
  const [fitted, setFitted] = useState<{ key: number; view: View }>(() => ({ key: fitKey, view: fitView(schematic) }))
  if (fitted.key !== fitKey) setFitted({ key: fitKey, view: fitView(schematic) })
  const view = growView(fitted.key === fitKey ? fitted.view : fitView(schematic), schematic)
  const { x: vx, y: vy, cols, rows } = view

  /** Client (screen) coordinates -> nearest grid point, or undefined off-grid. */
  function toGrid(event: PointerEvent | React.MouseEvent): Point | undefined {
    const svg = svgRef.current
    const matrix = svg?.getScreenCTM?.()
    if (!svg || !matrix) return undefined
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    const x = Math.round(local.x / GRID)
    const y = Math.round(local.y / GRID)
    return x >= 0 && x >= vx && x <= vx + cols && y >= 0 && y >= vy && y <= vy + rows ? { x, y } : undefined
  }

  const nodeOf = (p: Point) => connectivity.nodeOfPoint.get(pointKey(p))
  const voltage = (node: string | undefined) => (node === undefined ? undefined : solution?.node_voltages[node])
  const hoveredNode = hover?.kind === 'node' ? hover.node : undefined
  const isError = (node: string | undefined) => node !== undefined && (diagnosis?.nodes.has(node) ?? false)

  // Wires take the colour of their node voltage, from the lowest in the
  // circuit to the highest, once there is a solution.
  const voltageColor = useMemo(() => {
    if (!solution) return undefined
    const values = Object.values(solution.node_voltages)
    const [lo, hi] = [Math.min(...values), Math.max(...values)]
    const scale = scaleLinear<string>()
      .domain(VOLTAGE_RAMP.map((_, i) => lo + ((hi - lo) * i) / (VOLTAGE_RAMP.length - 1)))
      .range(VOLTAGE_RAMP as unknown as string[])
      .clamp(true)
    return (node: string | undefined) => {
      const v = node === undefined ? undefined : solution.node_voltages[node]
      return v === undefined || hi - lo < 1e-12 ? undefined : scale(v)
    }
  }, [solution])

  // Current flow: dots travel along each wire segment, faster for more current.
  const flow = useMemo(() => {
    if (!solution || !showFlow) return []
    const segments = wireCurrents(schematic, solution)
    const peak = flowPeak ?? Math.max(0, ...segments.map((s) => Math.abs(s.current)))
    if (peak < 1e-12) return []
    return segments
      .filter((s) => Math.abs(s.current) > peak * 0.01)
      .map((s) => {
        // Square root keeps a 1000:1 range of currents visibly different but
        // readable: the smallest still crawl rather than stop.
        const speed = 18 + 92 * Math.sqrt(Math.abs(s.current) / peak) // px per second
        const [from, to] = s.current > 0 ? [s.a, s.b] : [s.b, s.a]
        return { from: px(from), to: px(to), seconds: DOT_SPACING / speed }
      })
  }, [schematic, solution, showFlow, flowPeak])

  // Element handlers. In select mode, pressing an element selects it and
  // starts a drag; elsewhere the press falls through to the canvas, so wires
  // and parts can start or end on existing terminals.
  const grab = (id: string) => (event: PointerEvent) => {
    if (tool !== 'select' || event.button !== 0) return
    event.stopPropagation()
    dispatch({ type: 'select', id })
    const point = toGrid(event)
    if (!point) return
    drag.current = { id, last: point, gesture: ++gestureCount }
    // Capturing the pointer keeps a drag going outside the element, but it
    // also retargets the click that ends this press to the canvas, which
    // would clear the selection just made. Remember to ignore that click.
    grabbed.current = true
    svgRef.current?.setPointerCapture?.(event.pointerId)
  }
  const stopClick = (event: React.MouseEvent) => {
    if (tool === 'select') event.stopPropagation()
  }

  function onPointerMove(event: PointerEvent) {
    const point = toGrid(event)
    setCursor(point)
    const d = drag.current
    if (!d || !point) return
    const dx = point.x - d.last.x
    const dy = point.y - d.last.y
    if (dx === 0 && dy === 0) return
    dispatch({ type: 'move', id: d.id, dx, dy, gesture: d.gesture })
    d.last = point
    setDragging(true)
  }

  function onPointerUp() {
    drag.current = undefined
    setDragging(false)
  }

  const placingPart = tool !== 'select' && tool !== 'wire' && tool !== 'ground' ? tool : undefined

  return (
    <svg
      ref={svgRef}
      viewBox={`${(vx - 0.5) * GRID} ${(vy - 0.5) * GRID} ${(cols + 1) * GRID} ${(rows + 1) * GRID}`}
      preserveAspectRatio="xMidYMid meet"
      className={`block h-full w-full touch-none select-none ${
        tool === 'select' ? (dragging ? 'cursor-grabbing' : 'cursor-default') : 'cursor-crosshair'
      }`}
      style={{ ['--canvas-bg' as string]: CANVAS_BG }}
      role="application"
      aria-label="Circuit editor canvas"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setCursor(undefined)}
      onClick={(e) => {
        if (grabbed.current) {
          grabbed.current = false
          return
        }
        const point = toGrid(e)
        if (point) dispatch({ type: 'clickPoint', point })
      }}
    >
      <rect x={(vx - 0.5) * GRID} y={(vy - 0.5) * GRID} width={(cols + 1) * GRID} height={(rows + 1) * GRID} fill="var(--canvas-bg)" />

      {/* Grid: dots, with a slightly stronger cross every 5 units. */}
      <g className="fill-white/[0.09]">
        {Array.from({ length: (cols + 1) * (rows + 1) }, (_, i) => {
          const x = vx + (i % (cols + 1))
          const y = vy + Math.floor(i / (cols + 1))
          if (x < 0 || y < 0) return null
          const major = x % 5 === 0 && y % 5 === 0
          return <circle key={i} cx={x * GRID} cy={y * GRID} r={major ? 1.8 : 1.1} className={major ? 'fill-white/20' : undefined} />
        })}
      </g>

      {/* Wires */}
      {schematic.wires.map((wire) => {
        const node = connectivity.nodeOfWire.get(wire.id)
        const a = px(wire.a)
        const b = px(wire.b)
        const state = isError(node) ? 'error' : wire.id === selectedId ? 'selected' : node !== undefined && node === hoveredNode ? 'hover' : undefined
        return (
          <g
            key={wire.id}
            data-testid={`wire-${wire.id}`}
            onPointerDown={grab(wire.id)}
            onClick={stopClick}
            onPointerEnter={() => node && onHover({ kind: 'node', node, at: midpoint(wire.a, wire.b) })}
            onPointerLeave={() => onHover(undefined)}
            className={tool === 'select' ? 'cursor-grab' : undefined}
          >
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={`${state ? STROKE[state] : 'stroke-slate-300'} transition-[stroke] duration-150 ${state === 'selected' ? 'glow' : ''}`}
              style={state ? undefined : { stroke: voltageColor?.(node) }}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            {/* Wide invisible stroke: a forgiving hover and click target. */}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} />
          </g>
        )
      })}

      {/* Current flow */}
      <g pointerEvents="none" className="stroke-amber-300" strokeWidth={4.5} strokeLinecap="round" data-testid="current-flow">
        {flow.map((f, i) => (
          <line
            key={i}
            x1={f.from.x}
            y1={f.from.y}
            x2={f.to.x}
            y2={f.to.y}
            className="flow-dots"
            strokeDasharray={`0 ${DOT_SPACING}`}
            style={{ animationDuration: `${f.seconds.toFixed(3)}s` }}
          />
        ))}
      </g>

      {/* Junction dots */}
      <g className="fill-slate-200">
        {connectivity.junctions.map((p) => (
          <circle key={pointKey(p)} cx={p.x * GRID} cy={p.y * GRID} r={4} style={{ fill: voltageColor?.(nodeOf(p)) }} />
        ))}
      </g>

      {/* Grounds */}
      {schematic.grounds.map((ground) => (
        <g
          key={ground.id}
          data-testid={`ground-${ground.id}`}
          className={`${ground.id === selectedId ? `${STROKE.selected} glow` : 'stroke-slate-300'} ${tool === 'select' ? 'cursor-grab' : ''}`}
          strokeWidth={2.5}
          strokeLinecap="round"
          onPointerDown={grab(ground.id)}
          onClick={stopClick}
          onPointerEnter={() => onHover({ kind: 'node', node: nodeOf(ground.at) ?? '', at: ground.at })}
          onPointerLeave={() => onHover(undefined)}
        >
          <GroundSymbol at={ground.at} />
          <rect x={ground.at.x * GRID - 14} y={ground.at.y * GRID} width={28} height={26} fill="transparent" stroke="none" />
        </g>
      ))}

      {/* Parts */}
      {schematic.parts.map((part) => {
        const info = KINDS[part.kind]
        const { normal } = axes(part.a, part.b)
        const mid = midpoint(part.a, part.b)
        const label = { x: mid.x * GRID + normal.x * 26, y: mid.y * GRID + normal.y * 26 }
        const vertical = Math.abs(normal.x) > Math.abs(normal.y)
        const state = diagnosis?.partIds.has(part.id)
          ? 'error'
          : part.id === selectedId
            ? 'selected'
            : hover?.kind === 'part' && hover.id === part.id
              ? 'hover'
              : undefined
        const color = state ? STROKE[state] : 'stroke-slate-100'
        return (
          <g
            key={part.id}
            data-testid={`part-${part.id}`}
            onPointerDown={grab(part.id)}
            onClick={stopClick}
            onPointerEnter={() => onHover({ kind: 'part', id: part.id })}
            onPointerLeave={() => onHover(undefined)}
            className={tool === 'select' ? 'cursor-grab' : undefined}
          >
            <g
              transform={partTransform(part.a, part.b)}
              className={`${color} transition-[stroke] duration-150 ${state === 'selected' ? 'glow' : ''}`}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            >
              <PartBody kind={part.kind} />
              <rect x={0} y={-20} width={GRID * PART_LENGTH} height={40} fill="transparent" stroke="none" />
            </g>
            {part.kind === 'voltage_source' && (
              <g className={color}>
                <PolarityMarks a={part.a} b={part.b} />
              </g>
            )}
            <text
              x={label.x}
              y={label.y}
              textAnchor={vertical ? 'start' : 'middle'}
              dominantBaseline="middle"
              className="text-[12px]"
            >
              <tspan className={`font-semibold ${state === 'selected' ? 'fill-cyan-200' : 'fill-slate-100'}`}>{part.id}</tspan>
              <tspan className="readout fill-slate-400" dx={5}>
                {formatValue(part.value, info.unit)}
              </tspan>
            </text>
          </g>
        )
      })}

      {/* Unconnected terminals and wire ends: hollow circles, so a missing
          connection is visible before solving. */}
      <g className="stroke-amber-400/80" strokeWidth={1.5} pointerEvents="none" fill="var(--canvas-bg)">
        {connectivity.openEnds.map((p) => (
          <circle key={pointKey(p)} cx={p.x * GRID} cy={p.y * GRID} r={3.5} />
        ))}
      </g>

      {/* Previews of what the next click will create */}
      {cursor && tool === 'wire' && wireStart && (
        <line
          x1={wireStart.x * GRID}
          y1={wireStart.y * GRID}
          x2={cursor.x * GRID}
          y2={cursor.y * GRID}
          className="stroke-cyan-300"
          strokeWidth={2}
          strokeDasharray="6 4"
          pointerEvents="none"
        />
      )}
      {cursor && (tool === 'wire' || tool === 'ground' || placingPart) && (
        <circle cx={cursor.x * GRID} cy={cursor.y * GRID} r={5} className="fill-cyan-300/40" pointerEvents="none" />
      )}
      {cursor && placingPart && (
        <g
          transform={partTransform(
            cursor,
            state.orientation === 'horizontal'
              ? { x: cursor.x + PART_LENGTH, y: cursor.y }
              : { x: cursor.x, y: cursor.y + PART_LENGTH },
          )}
          className="stroke-cyan-300 opacity-60"
          strokeWidth={2.5}
          pointerEvents="none"
        >
          <PartBody kind={placingPart} />
        </g>
      )}
      {cursor && tool === 'ground' && (
        <g className="stroke-cyan-300 opacity-60" strokeWidth={2.5} pointerEvents="none">
          <GroundSymbol at={cursor} />
        </g>
      )}

      {/* Simulation readouts on hover */}
      {solution && hover?.kind === 'part' && !dragging && (() => {
        const part = schematic.parts.find((p) => p.id === hover.id)
        const current = part && solution.branch_currents[part.id]
        if (!part || current === undefined) return null
        const across = (voltage(nodeOf(part.a)) ?? 0) - (voltage(nodeOf(part.b)) ?? 0)
        const mid = midpoint(part.a, part.b)
        // The label sits on the `normal` side; put the readout on the other
        // side, beyond the current arrow, so neither covers the other.
        const { normal } = axes(part.a, part.b)
        const away = { x: -normal.x, y: -normal.y }
        return (
          <g pointerEvents="none">
            {Math.abs(current) > 1e-15 && <CurrentArrow a={part.a} b={part.b} forward={current > 0} />}
            <Tooltip
              bounds={view}
              at={{ x: mid.x * GRID + away.x * 30, y: mid.y * GRID + away.y * 30 }}
              direction={away}
              lines={[`${part.id}: ${formatValue(Math.abs(current), 'A')}`, `across: ${formatValue(across, 'V')}`]}
            />
          </g>
        )
      })()}
      {solution && hover?.kind === 'node' && !dragging && (() => {
        const at = hover.at ?? firstPointOf(hover.node)
        if (!at) return null
        const v = voltage(hover.node)
        return (
          <Tooltip
            bounds={view}
            at={{ x: at.x * GRID, y: at.y * GRID }}
            lines={[v === undefined ? 'not connected to anything' : `${formatValue(v, 'V')}`]}
          />
        )
      })()}
    </svg>
  )

  function firstPointOf(node: string): Point | undefined {
    for (const [key, name] of connectivity.nodeOfPoint) {
      if (name === node) {
        const [x = 0, y = 0] = key.split(',').map(Number)
        return { x, y }
      }
    }
    return undefined
  }
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * A small label box anchored at a point. It extends from the point in
 * `direction` (default: up and to the right) and is clamped inside the canvas.
 */
function Tooltip({
  at,
  lines,
  direction = { x: 1, y: -1 },
  bounds,
}: {
  at: { x: number; y: number }
  lines: string[]
  direction?: { x: number; y: number }
  bounds: View
}) {
  const width = Math.max(...lines.map((l) => l.length)) * 7.2 + 16
  const height = lines.length * 16 + 10
  const place = (anchor: number, d: number, size: number, gap: number) =>
    d > 0.5 ? anchor + gap : d < -0.5 ? anchor - size - gap : anchor - size / 2
  const [minX, maxX] = [(bounds.x - 0.5) * GRID, (bounds.x + bounds.cols + 0.5) * GRID - width]
  const [minY, maxY] = [(bounds.y - 0.5) * GRID, (bounds.y + bounds.rows + 0.5) * GRID - height]
  const x = Math.min(Math.max(place(at.x, direction.x, width, 10), minX), maxX)
  const y = Math.min(Math.max(place(at.y, direction.y, height, 10), minY), maxY)
  return (
    <g pointerEvents="none" role="tooltip" className="tooltip-pop">
      <rect x={x} y={y} width={width} height={height} rx={7} className="fill-slate-950/90 stroke-white/15" strokeWidth={1} />
      {lines.map((line, i) => (
        <text key={i} x={x + 8} y={y + 18 + i * 16} className="readout fill-slate-50 text-[12px]">
          {line}
        </text>
      ))}
    </g>
  )
}
