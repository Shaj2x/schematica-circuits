import { useState } from 'react'
import { GROUND_NODE } from '../schematic/netlist'
import type { Solution, TransientResult } from '../solver'
import { formatCompact, formatValue, parseValue } from '../units'
import type { Diagnosis } from './diagnose'
import { SERIES_COLORS } from './palette'
import { MAX_SIGNALS_PER_CHART, type Signal, type SignalKind, signalKey } from './signals'
import type { TransientSettings } from './transient'

/** Must match `MAX_STEPS` in the Rust solver. */
const MAX_STEPS = 100_000

interface TransientPanelProps {
  live: boolean
  settings: TransientSettings
  onSettings: (settings: TransientSettings) => void
  onSuggest: () => void
  result?: TransientResult
  solveMs?: number
  diagnosis?: Diagnosis
  nodes: string[]
  partIds: string[]
  selected: Signal[]
  onToggle: (kind: SignalKind, name: string) => void
  /** Values at the cursor (or the final sample). */
  sample?: { time: number; solution: Solution }
  /** Set when the cursor has been moved off the final sample. */
  onResetCursor?: () => void
}

export function TransientPanel(props: TransientPanelProps) {
  const {
    live,
    settings,
    onSettings,
    onSuggest,
    result,
    solveMs,
    diagnosis,
    nodes,
    partIds,
    selected,
    onToggle,
    sample,
    onResetCursor,
  } = props
  const steps = Math.round(settings.stopTime / settings.timeStep)

  return (
    <div className="space-y-4 text-sm">
      <section aria-label="Transient settings" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-slate-900">Transient analysis</h2>
          <button type="button" onClick={onSuggest} className="btn btn-ghost -my-1 px-2 py-0.5 text-xs text-sky-700">
            Suggest settings
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <SecondsInput
            label="Stop time"
            value={settings.stopTime}
            onChange={(stopTime) => onSettings({ ...settings, stopTime })}
          />
          <SecondsInput
            label="Time step"
            value={settings.timeStep}
            onChange={(timeStep) => onSettings({ ...settings, timeStep })}
          />
        </div>
        <label className="flex items-center justify-between gap-2 text-slate-600">
          Method
          <select
            value={settings.method}
            onChange={(e) => onSettings({ ...settings, method: e.target.value as TransientSettings['method'] })}
            className="field py-1"
          >
            <option value="trapezoidal">Trapezoidal (2nd order)</option>
            <option value="backward_euler">Backward Euler (1st order)</option>
          </select>
        </label>
        <p className={steps > MAX_STEPS ? 'text-red-600' : 'text-slate-500'} data-testid="step-count">
          {steps.toLocaleString()} steps{steps > MAX_STEPS ? ` (limit ${MAX_STEPS.toLocaleString()})` : ''}
          {live && result?.ok && solveMs !== undefined ? ` · solved in ${solveMs.toFixed(1)} ms` : ''}
        </p>
      </section>

      {!live && <p className="text-slate-500">Press Solve to run the simulation. It re-runs live as you edit.</p>}
      {live && result && !result.ok && (
        <div role="alert" className="ui-enter rounded-lg bg-red-50 p-3 text-red-800 ring-1 ring-red-200 ring-inset">
          <p className="font-semibold">Can’t simulate this circuit</p>
          <p className="mt-1">{diagnosis?.message ?? result.error.message}</p>
        </div>
      )}

      <SignalPicker
        title="Node voltages"
        kind="voltage"
        names={nodes.filter((n) => n !== GROUND_NODE)}
        selected={selected}
        onToggle={onToggle}
      />
      <SignalPicker title="Branch currents" kind="current" names={partIds} selected={selected} onToggle={onToggle} />

      {sample && selected.length > 0 && (
        <table className="w-full" aria-label="Values at cursor">
          <caption className="mb-1.5 text-left text-[11px] font-semibold tracking-[0.06em] text-slate-500 uppercase">
            At t = {formatValue(sample.time, 's')}
            {onResetCursor && (
              <button type="button" onClick={onResetCursor} className="ml-2 text-xs font-medium tracking-normal text-sky-700 normal-case hover:underline">
                Show final values
              </button>
            )}
          </caption>
          <tbody>
            {selected.map((s) => {
              const value =
                s.kind === 'voltage' ? sample.solution.node_voltages[s.name] : sample.solution.branch_currents[s.name]
              return (
                <tr key={signalKey(s)}>
                  <th scope="row" className="py-1 text-left font-normal text-slate-600">
                    {s.kind === 'voltage' ? `v(${s.name})` : `i(${s.name})`}
                  </th>
                  <td className="readout text-right text-slate-900">
                    {value === undefined ? '—' : formatValue(value, s.kind === 'voltage' ? 'V' : 'A')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function SignalPicker({
  title,
  kind,
  names,
  selected,
  onToggle,
}: {
  title: string
  kind: SignalKind
  names: string[]
  selected: Signal[]
  onToggle: (kind: SignalKind, name: string) => void
}) {
  const chosen = selected.filter((s) => s.kind === kind)
  const full = chosen.length >= MAX_SIGNALS_PER_CHART
  if (names.length === 0) return null
  return (
    <fieldset className="space-y-1">
      <legend className="text-[11px] font-semibold tracking-[0.06em] text-slate-500 uppercase">
        {title} <span className="font-normal tracking-normal normal-case">(up to {MAX_SIGNALS_PER_CHART})</span>
      </legend>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {names.map((name) => {
          const signal = chosen.find((s) => s.name === name)
          return (
            <label key={name} className="flex items-center gap-1.5 text-slate-700">
              <input
                type="checkbox"
                checked={signal !== undefined}
                disabled={!signal && full}
                onChange={() => onToggle(kind, name)}
                className="accent-sky-600"
              />
              {signal && (
                <svg width="12" height="4" aria-hidden="true">
                  <line x1="0" y1="2" x2="12" y2="2" stroke={SERIES_COLORS[signal.slot]} strokeWidth="2" />
                </svg>
              )}
              {name}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** A seconds field that accepts engineering notation ("5m", "10us") and commits on Enter or blur. */
function SecondsInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(`${formatCompact(value)}s`)
  const [invalid, setInvalid] = useState(false)
  const [shown, setShown] = useState(value)
  // Re-sync the text when the value changes from outside (Suggest, examples).
  if (shown !== value) {
    setShown(value)
    setText(`${formatCompact(value)}s`)
    setInvalid(false)
  }
  const commit = () => {
    const parsed = parseValue(text)
    if (parsed === undefined || !(parsed > 0)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    if (parsed !== value) onChange(parsed)
  }
  return (
    <label className="space-y-1 text-slate-600">
      <span>{label}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        aria-invalid={invalid}
        className={`field readout w-full py-1 ${invalid ? '!bg-red-50 ring-1 ring-red-400' : ''}`}
      />
    </label>
  )
}
