import { type Dispatch, type PointerEvent, useRef, useState } from 'react'
import type { EditorAction, EditorState } from '../schematic/editor'
import { KINDS, PART_LENGTH, type Point, pointKey } from '../schematic/model'
import { formatValue } from '../units'
import type { Solution } from '../solver'
import type { Diagnosis } from './diagnose'
import { GRID, axes, partTransform, px } from './geometry'
import { CurrentArrow, GroundSymbol, PartBody, PolarityMarks } from './symbols'
import type { Simulation } from './useSimulation'

export const COLS = 20
export const ROWS = 12

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
}

export function Canvas({ state, dispatch, simulation, diagnosis, solution, hover, onHover }: CanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [cursor, setCursor] = useState<Point>()
  const { schematic, tool, selectedId, wireStart } = state
  const { connectivity } = simulation

  /** Client (screen) coordinates -> nearest grid point, or undefined off-grid. */
  function toGrid(event: PointerEvent | React.MouseEvent): Point | undefined {
    const svg = svgRef.current
    const matrix = svg?.getScreenCTM?.()
    if (!svg || !matrix) return undefined
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    const x = Math.round(local.x / GRID)
    const y = Math.round(local.y / GRID)
    return x >= 0 && x <= COLS && y >= 0 && y <= ROWS ? { x, y } : undefined
  }

  const nodeOf = (p: Point) => connectivity.nodeOfPoint.get(pointKey(p))
  const voltage = (node: string | undefined) => (node === undefined ? undefined : solution?.node_voltages[node])
  const hoveredNode = hover?.kind === 'node' ? hover.node : undefined
  const isError = (node: string | undefined) => node !== undefined && (diagnosis?.nodes.has(node) ?? false)

  // Element handlers: in select mode, clicking an element selects it. In any
  // other mode the click falls through to the canvas, so wires and parts can
  // start or end on existing terminals.
  const selectOnClick = (id: string) => (event: React.MouseEvent) => {
    if (tool !== 'select') return
    event.stopPropagation()
    dispatch({ type: 'select', id })
  }

  const placingPart = tool !== 'select' && tool !== 'wire' && tool !== 'ground' ? tool : undefined

  return (
    <svg
      ref={svgRef}
      viewBox={`${-GRID / 2} ${-GRID / 2} ${COLS * GRID + GRID} ${ROWS * GRID + GRID}`}
      className={`h-auto w-full touch-none select-none ${tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
      style={{ ['--canvas-bg' as string]: '#ffffff' }}
      role="application"
      aria-label="Circuit editor canvas"
      onPointerMove={(e) => setCursor(toGrid(e))}
      onPointerLeave={() => setCursor(undefined)}
      onClick={(e) => {
        const point = toGrid(e)
        if (point) dispatch({ type: 'clickPoint', point })
      }}
    >
      <rect
        x={-GRID / 2}
        y={-GRID / 2}
        width={COLS * GRID + GRID}
        height={ROWS * GRID + GRID}
        fill="var(--canvas-bg)"
      />

      {/* Grid dots */}
      <g className="fill-slate-300">
        {Array.from({ length: (COLS + 1) * (ROWS + 1) }, (_, i) => (
          <circle key={i} cx={(i % (COLS + 1)) * GRID} cy={Math.floor(i / (COLS + 1)) * GRID} r={1.5} />
        ))}
      </g>

      {/* Wires */}
      {schematic.wires.map((wire) => {
        const node = connectivity.nodeOfWire.get(wire.id)
        const a = px(wire.a)
        const b = px(wire.b)
        const color = isError(node)
          ? 'stroke-red-600'
          : wire.id === selectedId
            ? 'stroke-sky-600'
            : node !== undefined && node === hoveredNode
              ? 'stroke-amber-600'
              : 'stroke-slate-800'
        return (
          <g
            key={wire.id}
            data-testid={`wire-${wire.id}`}
            onClick={selectOnClick(wire.id)}
            onPointerEnter={() => node && onHover({ kind: 'node', node, at: midpoint(wire.a, wire.b) })}
            onPointerLeave={() => onHover(undefined)}
          >
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={color} strokeWidth={2.5} strokeLinecap="round" />
            {/* Wide invisible stroke: a forgiving hover and click target. */}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} />
          </g>
        )
      })}

      {/* Junction dots */}
      <g className="fill-slate-800">
        {connectivity.junctions.map((p) => (
          <circle key={pointKey(p)} cx={p.x * GRID} cy={p.y * GRID} r={4} />
        ))}
      </g>

      {/* Grounds */}
      {schematic.grounds.map((ground) => (
        <g
          key={ground.id}
          data-testid={`ground-${ground.id}`}
          className={ground.id === selectedId ? 'stroke-sky-600' : 'stroke-slate-800'}
          strokeWidth={2.5}
          strokeLinecap="round"
          onClick={selectOnClick(ground.id)}
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
        const highlighted = diagnosis?.partIds.has(part.id)
        const color = highlighted
          ? 'stroke-red-600'
          : part.id === selectedId
            ? 'stroke-sky-600'
            : hover?.kind === 'part' && hover.id === part.id
              ? 'stroke-amber-600'
              : 'stroke-slate-800'
        return (
          <g
            key={part.id}
            data-testid={`part-${part.id}`}
            onClick={selectOnClick(part.id)}
            onPointerEnter={() => onHover({ kind: 'part', id: part.id })}
            onPointerLeave={() => onHover(undefined)}
          >
            <g transform={partTransform(part.a, part.b)} className={color} strokeWidth={2.5} strokeLinejoin="round">
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
              className="fill-slate-700 text-[12px]"
            >
              <tspan className="font-semibold">{part.id}</tspan> {formatValue(part.value, info.unit)}
            </text>
          </g>
        )
      })}

      {/* Unconnected terminals and wire ends: hollow circles, so a missing
          connection is visible before solving. */}
      <g className="fill-white stroke-slate-500" strokeWidth={1.5} pointerEvents="none">
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
          className="stroke-sky-600"
          strokeWidth={2}
          strokeDasharray="6 4"
          pointerEvents="none"
        />
      )}
      {cursor && (tool === 'wire' || tool === 'ground' || placingPart) && (
        <circle cx={cursor.x * GRID} cy={cursor.y * GRID} r={5} className="fill-sky-600/40" pointerEvents="none" />
      )}
      {cursor && placingPart && (
        <g
          transform={partTransform(
            cursor,
            state.orientation === 'horizontal'
              ? { x: cursor.x + PART_LENGTH, y: cursor.y }
              : { x: cursor.x, y: cursor.y + PART_LENGTH },
          )}
          className="stroke-sky-600 opacity-50"
          strokeWidth={2.5}
          pointerEvents="none"
        >
          <PartBody kind={placingPart} />
        </g>
      )}
      {cursor && tool === 'ground' && (
        <g className="stroke-sky-600 opacity-50" strokeWidth={2.5} pointerEvents="none">
          <GroundSymbol at={cursor} />
        </g>
      )}

      {/* Simulation readouts on hover */}
      {solution && hover?.kind === 'part' && (() => {
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
              at={{ x: mid.x * GRID + away.x * 30, y: mid.y * GRID + away.y * 30 }}
              direction={away}
              lines={[`${part.id}: ${formatValue(Math.abs(current), 'A')}`, `across: ${formatValue(across, 'V')}`]}
            />
          </g>
        )
      })()}
      {solution && hover?.kind === 'node' && (() => {
        const at = hover.at ?? firstPointOf(hover.node)
        if (!at) return null
        const v = voltage(hover.node)
        return (
          <Tooltip
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
}: {
  at: { x: number; y: number }
  lines: string[]
  direction?: { x: number; y: number }
}) {
  const width = Math.max(...lines.map((l) => l.length)) * 7.2 + 16
  const height = lines.length * 16 + 10
  const place = (anchor: number, d: number, size: number, gap: number) =>
    d > 0.5 ? anchor + gap : d < -0.5 ? anchor - size - gap : anchor - size / 2
  const [minX, maxX] = [-GRID / 2, COLS * GRID + GRID / 2 - width]
  const [minY, maxY] = [-GRID / 2, ROWS * GRID + GRID / 2 - height]
  const x = Math.min(Math.max(place(at.x, direction.x, width, 10), minX), maxX)
  const y = Math.min(Math.max(place(at.y, direction.y, height, 10), minY), maxY)
  return (
    <g pointerEvents="none" role="tooltip">
      <rect x={x} y={y} width={width} height={height} rx={6} className="fill-slate-900/90" />
      {lines.map((line, i) => (
        <text key={i} x={x + 8} y={y + 18 + i * 16} className="fill-white font-mono text-[12px]">
          {line}
        </text>
      ))}
    </g>
  )
}
