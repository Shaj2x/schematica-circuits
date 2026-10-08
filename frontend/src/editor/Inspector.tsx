import { type Dispatch, useState } from 'react'
import type { EditorAction } from '../schematic/editor'
import { KINDS, type Part, type Schematic } from '../schematic/model'
import type { Connectivity } from '../schematic/netlist'
import { pointKey } from '../schematic/model'
import type { Solution } from '../solver'
import { formatCompact, formatValue, parseValue } from '../units'

interface InspectorProps {
  schematic: Schematic
  selectedId?: string
  dispatch: Dispatch<EditorAction>
  connectivity: Connectivity
  solution?: Solution
}

export function Inspector({ schematic, selectedId, dispatch, connectivity, solution }: InspectorProps) {
  const part = schematic.parts.find((p) => p.id === selectedId)
  if (part) {
    // Keyed by id so local input state resets when the selection changes.
    return (
      <PartInspector key={part.id} part={part} dispatch={dispatch} connectivity={connectivity} solution={solution} />
    )
  }

  if (selectedId) {
    const isWire = schematic.wires.some((w) => w.id === selectedId)
    return (
      <section aria-label="Selection" className="space-y-3">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-white">
          {selectedId} <span className="font-normal text-slate-400">· {isWire ? 'Wire' : 'Ground'}</span>
        </h2>
        <DeleteButton dispatch={dispatch} />
      </section>
    )
  }

  return (
    <section aria-label="Help" className="space-y-3 text-sm text-slate-300">
      <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-white">Build a circuit</h2>
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-2">
        <dt className="flex gap-1">
          <kbd>1</kbd>–<kbd>5</kbd>
        </dt>
        <dd>Place a resistor, source, capacitor or inductor. <kbd>R</kbd> rotates.</dd>
        <dt>
          <kbd>W</kbd>
        </dt>
        <dd>Wire point to point. <kbd>Esc</kbd> or the last point again ends it.</dd>
        <dt>
          <kbd>G</kbd>
        </dt>
        <dd>Ground. Every circuit needs one.</dd>
        <dt>
          <kbd>S</kbd>
        </dt>
        <dd>Select a part to edit its value; the slider re-solves as you drag.</dd>
      </dl>
      <p className="text-xs leading-relaxed text-slate-400">
        Press <b className="font-medium text-slate-200">Solve</b>, then hover wires and parts to read voltages and
        currents. <b className="font-medium text-slate-200">Transient</b> plots capacitors and inductors over time.
      </p>
    </section>
  )
}

/**
 * Value editing for one part: a text box that accepts engineering notation,
 * and a logarithmic slider.
 *
 * Why logarithmic: component values span decades (10 Ω to 1 MΩ), and a
 * linear slider over that range would make every value below ~10 kΩ
 * unreachable. The slider covers one decade either side of the value it was
 * centred on, and re-centres when released, so it can travel any distance
 * in a few drags while staying precise.
 */
function PartInspector({
  part,
  dispatch,
  connectivity,
  solution,
}: {
  part: Part
  dispatch: Dispatch<EditorAction>
  connectivity: Connectivity
  solution?: Solution
}) {
  const info = KINDS[part.kind]
  const [text, setText] = useState(formatCompact(part.value))
  const [invalid, setInvalid] = useState(false)
  const [center, setCenter] = useState(part.value === 0 ? info.defaultValue : part.value)

  const setValue = (value: number) => dispatch({ type: 'setValue', id: part.id, value })

  const commitText = () => {
    const value = parseValue(text)
    if (value === undefined) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setValue(value)
    setCenter(value === 0 ? info.defaultValue : value)
    setText(formatCompact(value))
  }

  // Slider position t in [-1, 1] <-> value = center * 10^t (sign preserved).
  const magnitude = Math.abs(center)
  const sign = Math.sign(center) || 1
  const t = part.value === 0 ? -1 : Math.log10(Math.abs(part.value) / magnitude)
  const fromSlider = (position: number) => sign * Number((magnitude * 10 ** position).toPrecision(3))
  const recenter = () => setCenter(part.value === 0 ? info.defaultValue : part.value)

  const v = (p: Part['a']) => solution?.node_voltages[connectivity.nodeOfPoint.get(pointKey(p)) ?? '']
  const current = solution?.branch_currents[part.id]
  const va = v(part.a)
  const vb = v(part.b)

  const flipLabel = part.kind === 'voltage_source' ? 'Reverse polarity' : part.kind === 'current_source' ? 'Reverse direction' : 'Swap ends'

  return (
    <section aria-label={`${part.id} properties`} className="space-y-4">
      <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-white">
        {part.id} <span className="font-normal text-slate-400">· {info.label}</span>
      </h2>

      <div className="space-y-1">
        <label htmlFor="part-value" className="text-sm text-slate-300">
          Value ({info.unit})
        </label>
        <input
          id="part-value"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setInvalid(false)
          }}
          onBlur={commitText}
          onKeyDown={(e) => e.key === 'Enter' && commitText()}
          aria-invalid={invalid}
          aria-describedby={invalid ? 'part-value-error' : undefined}
          className={`field readout w-full ${
            invalid ? '!bg-red-500/10 ring-1 ring-red-400' : ''
          }`}
        />
        {invalid && (
          <p id="part-value-error" className="text-xs text-red-400">
            Couldn’t read “{text}”. Try 4.7k, 10m, 2.2M or 1e-3.
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="part-slider" className="flex justify-between text-sm text-slate-300">
          <span>Adjust</span>
          <span className="readout text-white">{formatValue(part.value, info.unit)}</span>
        </label>
        <input
          id="part-slider"
          type="range"
          min={-1}
          max={1}
          step={0.005}
          value={Math.max(-1, Math.min(1, t))}
          onChange={(e) => {
            const value = fromSlider(Number(e.target.value))
            setValue(value)
            setText(formatCompact(value))
          }}
          onPointerUp={recenter}
          onKeyUp={recenter}
          className="w-full accent-cyan-400"
        />
        <div className="flex justify-between font-mono text-[11px] text-slate-500">
          <span>{formatValue(sign * magnitude / 10, info.unit)}</span>
          <span>{formatValue(sign * magnitude * 10, info.unit)}</span>
        </div>
      </div>

      {current !== undefined && va !== undefined && vb !== undefined && (
        <dl className="ui-enter grid grid-cols-2 gap-y-1.5 rounded-lg bg-white/[0.03] p-3 text-sm ring-1 ring-white/[0.06] ring-inset">
          <dt className="text-slate-400">Current</dt>
          <dd className="readout text-right text-white">{formatValue(current, 'A')}</dd>
          <dt className="text-slate-400">Voltage across</dt>
          <dd className="readout text-right text-white">{formatValue(va - vb, 'V')}</dd>
          <dt className="text-slate-400">Power absorbed</dt>
          <dd className="readout text-right text-white">{formatValue((va - vb) * current, 'W')}</dd>
        </dl>
      )}

      {(part.kind === 'capacitor' || part.kind === 'inductor') && (
        <InitialCondition part={part} dispatch={dispatch} />
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => dispatch({ type: 'flip', id: part.id })}
          className="btn btn-secondary"
        >
          {flipLabel}
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'rotate' })}
          className="btn btn-secondary"
        >
          Rotate
        </button>
        <DeleteButton dispatch={dispatch} />
      </div>
    </section>
  )
}

function DeleteButton({ dispatch }: { dispatch: Dispatch<EditorAction> }) {
  return (
    <button
      type="button"
      onClick={() => dispatch({ type: 'deleteSelected' })}
      className="btn btn-ghost text-red-300 hover:!bg-red-500/10 hover:!text-red-200"
    >
      Delete
    </button>
  )
}

/**
 * The starting state for a transient run: a capacitor's voltage or an
 * inductor's current at t = 0. DC analysis ignores it.
 */
function InitialCondition({ part, dispatch }: { part: Part; dispatch: Dispatch<EditorAction> }) {
  const isCapacitor = part.kind === 'capacitor'
  const [text, setText] = useState(formatCompact(part.initial ?? 0))
  const [invalid, setInvalid] = useState(false)
  const commit = () => {
    const value = parseValue(text)
    setInvalid(value === undefined)
    if (value !== undefined) {
      dispatch({ type: 'setInitial', id: part.id, value })
      setText(formatCompact(value))
    }
  }
  return (
    <div className="space-y-1">
      <label htmlFor="part-initial" className="text-sm text-slate-300">
        {isCapacitor ? 'Initial voltage (V)' : 'Initial current (A)'}
      </label>
      <input
        id="part-initial"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setInvalid(false)
        }}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        aria-invalid={invalid}
        className={`field readout w-full ${
          invalid ? '!bg-red-500/10 ring-1 ring-red-400' : ''
        }`}
      />
      <p className="text-xs text-slate-500">
        {isCapacitor ? 'v(first terminal) − v(second) at t = 0.' : 'From the first terminal to the second at t = 0.'}{' '}
        Used by transient analysis only.
      </p>
    </div>
  )
}
