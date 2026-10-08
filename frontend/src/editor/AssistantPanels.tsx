import { useState } from 'react'
import type { Api, CheckResult, Explanation } from '../api'
import { GROUND_NODE } from '../schematic/netlist'
import type { Netlist } from '../solver'
import { formatValue, parseValue } from '../units'
import { ExplanationView } from './ExplanationView'

type Status<T> = { state: 'idle' } | { state: 'loading' } | { state: 'done'; value: T } | { state: 'error'; message: string }

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Asks the backend to explain the current circuit step by step. The
 * explanation is for the circuit as it was when requested; the parent keys
 * this component by the netlist, so editing the circuit clears it.
 */
export function ExplainPanel({ api, netlist }: { api: Api; netlist: Netlist }) {
  const [status, setStatus] = useState<Status<Explanation>>({ state: 'idle' })

  async function run() {
    setStatus({ state: 'loading' })
    try {
      setStatus({ state: 'done', value: (await api.explain(netlist)).explanation })
    } catch (e) {
      setStatus({ state: 'error', message: errorMessage(e) })
    }
  }

  return (
    <section aria-label="Explanation" className="space-y-3">
      <p className="text-sm text-slate-600">
        See how nodal analysis gets the answer: which nodes are fixed, the KCL equation at each node, and the solution.
      </p>
      <button
        type="button"
        onClick={run}
        disabled={status.state === 'loading'}
        className="btn btn-primary font-semibold"
      >
        {status.state === 'loading' ? 'Explaining…' : 'Explain step by step'}
      </button>
      {status.state === 'error' && <ErrorBox message={status.message} />}
      {status.state === 'done' && <ExplanationView explanation={status.value} />}
    </section>
  )
}

/**
 * The student enters the values they worked out by hand; the backend says
 * which are right and, for wrong ones, the most likely mistake.
 */
export function CheckPanel({
  api,
  netlist,
  nodes,
  partIds,
}: {
  api: Api
  netlist: Netlist
  nodes: string[]
  partIds: string[]
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<Status<CheckResult>>({ state: 'idle' })
  const [invalid, setInvalid] = useState<string[]>([])

  const fields = [
    ...nodes.filter((n) => n !== GROUND_NODE).map((n) => ({ key: `v:${n}`, label: `v(${n})`, unit: 'V' })),
    ...partIds.map((id) => ({ key: `i:${id}`, label: `i(${id})`, unit: 'A' })),
  ]

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const answers = { node_voltages: {} as Record<string, number>, branch_currents: {} as Record<string, number> }
    const bad: string[] = []
    for (const { key } of fields) {
      const text = inputs[key]?.trim()
      if (!text) continue
      const value = parseValue(text)
      if (value === undefined) {
        bad.push(key)
        continue
      }
      const name = key.slice(2)
      if (key.startsWith('v:')) answers.node_voltages[name] = value
      else answers.branch_currents[name] = value
    }
    setInvalid(bad)
    if (bad.length > 0) return
    if (Object.keys(answers.node_voltages).length + Object.keys(answers.branch_currents).length === 0) {
      setStatus({ state: 'error', message: 'Enter at least one value to check.' })
      return
    }
    setStatus({ state: 'loading' })
    try {
      setStatus({ state: 'done', value: await api.check(netlist, answers) })
    } catch (e) {
      setStatus({ state: 'error', message: errorMessage(e) })
    }
  }

  const resultFor = (key: string) =>
    status.state === 'done'
      ? status.value.results.find((r) => `${r.kind === 'voltage' ? 'v' : 'i'}:${r.name}` === key)
      : undefined

  return (
    <section aria-label="Check my work" className="space-y-3 text-sm">
      <p className="text-slate-600">
        Solve the circuit by hand, enter any values you found (for example 6.67 or 3.33m), and check them. Currents are
        positive from a part’s first terminal to its second.
      </p>
      <form onSubmit={submit} className="space-y-2">
        {fields.map(({ key, label, unit }) => {
          const result = resultFor(key)
          return (
            <label key={key} className="flex items-center gap-2">
              <span className="readout w-16 text-slate-700">{label}</span>
              <input
                value={inputs[key] ?? ''}
                onChange={(e) => setInputs({ ...inputs, [key]: e.target.value })}
                aria-invalid={invalid.includes(key)}
                aria-label={`Your value for ${label}`}
                placeholder={unit}
                className={`field readout w-full py-1 ${invalid.includes(key) ? '!bg-red-50 ring-1 ring-red-400' : ''}`}
              />
              <span
                aria-label={result ? (result.correct ? 'correct' : 'incorrect') : undefined}
                className={`w-4 text-center font-semibold ${result?.correct ? 'text-emerald-600' : 'text-red-600'} ${result ? 'tooltip-pop' : ''}`}
              >
                {result ? (result.correct ? '✓' : '✗') : ''}
              </span>
            </label>
          )
        })}
        {invalid.length > 0 && <p className="text-xs text-red-600">Some values could not be read. Try 6.67, 3.33m or 2.2k.</p>}
        <button
          type="submit"
          disabled={status.state === 'loading'}
          className="btn btn-primary font-semibold"
        >
          {status.state === 'loading' ? 'Checking…' : 'Check my answers'}
        </button>
      </form>
      {status.state === 'error' && <ErrorBox message={status.message} />}
      {status.state === 'done' && (
        <div className="ui-enter space-y-3">
          <ul className="ui-stagger space-y-2">
            {status.value.results
              .filter((r) => !r.correct)
              .map((r) => (
                <li key={r.label} className="rounded-lg bg-red-50 p-2.5 text-red-900 ring-1 ring-red-200 ring-inset">
                  <span className="font-mono font-semibold">{r.label}</span>: you wrote{' '}
                  {formatValue(r.submitted, r.kind === 'voltage' ? 'V' : 'A')}. {r.hint}
                  {r.expected !== null && ` The correct value is ${formatValue(r.expected, r.kind === 'voltage' ? 'V' : 'A')}.`}
                </li>
              ))}
          </ul>
          {/* The list above already states every mistake. Template feedback
              would only repeat it, so show just its summary; feedback written
              by Claude rewords it and is shown in full. */}
          {status.value.feedback.source === 'claude' ? (
            <ExplanationView explanation={status.value.feedback} />
          ) : (
            <p className="font-medium text-slate-800">{status.value.feedback.summary}</p>
          )}
        </div>
      )}
    </section>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p role="alert" className="ui-enter rounded-lg bg-red-50 p-2.5 text-sm text-red-800 ring-1 ring-red-200 ring-inset">
      {message}
    </p>
  )
}
