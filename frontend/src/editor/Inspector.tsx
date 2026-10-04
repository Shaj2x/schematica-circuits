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
        <h2 className="font-semibold text-slate-800">
          {selectedId} <span className="font-normal text-slate-500">· {isWire ? 'Wire' : 'Ground'}</span>
        </h2>
        <DeleteButton dispatch={dispatch} />
      </section>
    )
  }

  return (
    <section aria-label="Help" className="space-y-2 text-sm text-slate-600">
      <h2 className="font-semibold text-slate-800">Build a circuit</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Pick a part (1, 2, 3) and click the grid to place it. R rotates.</li>
        <li>Wire tool (W): click point to point. Esc, or clicking the last point again, ends the wire.</li>
        <li>Add a ground (G). Every circuit needs one.</li>
        <li>Press <b>Solve</b>, then hover wires and parts to read voltages and currents.</li>
        <li>Select a part to edit its value; the slider re-solves as you drag.</li>
      </ul>
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
      <h2 className="font-semibold text-slate-800">
        {part.id} <span className="font-normal text-slate-500">· {info.label}</span>
      </h2>

      <div className="space-y-1">
        <label htmlFor="part-value" className="text-sm text-slate-600">
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
          className={`w-full rounded-md border px-2.5 py-1.5 font-mono text-sm ${
            invalid ? 'border-red-500 bg-red-50' : 'border-slate-300'
          }`}
        />
        {invalid && (
          <p id="part-value-error" className="text-xs text-red-600">
            Couldn’t read “{text}”. Try 4.7k, 10m, 2.2M or 1e-3.
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="part-slider" className="flex justify-between text-sm text-slate-600">
          <span>Adjust</span>
          <span className="font-mono">{formatValue(part.value, info.unit)}</span>
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
          className="w-full accent-sky-600"
        />
        <div className="flex justify-between font-mono text-[11px] text-slate-400">
          <span>{formatValue(sign * magnitude / 10, info.unit)}</span>
          <span>{formatValue(sign * magnitude * 10, info.unit)}</span>
        </div>
      </div>

      {current !== undefined && va !== undefined && vb !== undefined && (
        <dl className="grid grid-cols-2 gap-y-1 rounded-md bg-slate-50 p-3 text-sm">
          <dt className="text-slate-500">Current</dt>
          <dd className="text-right font-mono">{formatValue(current, 'A')}</dd>
          <dt className="text-slate-500">Voltage across</dt>
          <dd className="text-right font-mono">{formatValue(va - vb, 'V')}</dd>
          <dt className="text-slate-500">Power absorbed</dt>
          <dd className="text-right font-mono">{formatValue((va - vb) * current, 'W')}</dd>
        </dl>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => dispatch({ type: 'flip', id: part.id })}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50"
        >
          {flipLabel}
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'rotate' })}
          className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50"
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
      className="rounded-md border border-red-200 px-2.5 py-1.5 text-sm text-red-700 hover:bg-red-50"
    >
      Delete
    </button>
  )
}
