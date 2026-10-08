import type { Explanation } from '../api'

/**
 * A step-by-step explanation, from the template or from Claude. Numbers the
 * server could not match to the solution are called out above the steps, so
 * a student never takes an unverified value as fact.
 */
export function ExplanationView({ explanation }: { explanation: Explanation }) {
  const { source, summary, steps, unverified_numbers: unverified, note } = explanation
  return (
    <div className="ui-enter space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            source === 'claude' ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-700'
          }`}
        >
          {source === 'claude' ? 'Written by Claude' : 'Standard working'}
        </span>
      </div>
      {note && <p className="text-xs text-slate-500">{note}</p>}
      {unverified.length > 0 && (
        <p role="alert" className="rounded-lg bg-amber-50 p-2.5 text-amber-900 ring-1 ring-amber-200 ring-inset">
          These values do not match anything the solver computed, so double-check them:{' '}
          <span className="font-mono">{unverified.join(', ')}</span>
        </p>
      )}
      <p className="font-medium text-slate-800">{summary}</p>
      {steps.length > 0 && (
        <ol className="ui-stagger space-y-3 border-l border-slate-200 pl-3">
          {steps.map((step, i) => (
            <li key={i} className="space-y-1">
              <p className="font-semibold text-slate-900">
                <span className="readout mr-1.5 text-xs text-slate-400">{String(i + 1).padStart(2, '0')}</span>
                {step.title}
              </p>
              <p className="text-slate-600">{step.detail}</p>
              {step.equation && (
                <p className="readout overflow-x-auto rounded-md bg-slate-900/[0.03] px-2.5 py-1.5 text-xs whitespace-pre-wrap text-slate-800 ring-1 ring-slate-900/[0.05] ring-inset">
                  {step.equation}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
