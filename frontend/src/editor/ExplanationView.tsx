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
            source === 'claude' ? 'bg-violet-400/15 text-violet-200' : 'bg-white/[0.05] text-slate-200'
          }`}
        >
          {source === 'claude' ? 'Written by Claude' : 'Standard working'}
        </span>
      </div>
      {note && <p className="text-xs text-slate-400">{note}</p>}
      {unverified.length > 0 && (
        <p role="alert" className="rounded-lg bg-amber-400/10 p-2.5 text-amber-100 ring-1 ring-amber-400/25 ring-inset">
          These values do not match anything the solver computed, so double-check them:{' '}
          <span className="font-mono">{unverified.join(', ')}</span>
        </p>
      )}
      <p className="font-medium text-slate-100">{summary}</p>
      {steps.length > 0 && (
        <ol className="ui-stagger space-y-3 border-l border-white/10 pl-3">
          {steps.map((step, i) => (
            <li key={i} className="space-y-1">
              <p className="font-semibold text-white">
                <span className="readout mr-1.5 text-xs text-slate-500">{String(i + 1).padStart(2, '0')}</span>
                {step.title}
              </p>
              <p className="text-slate-300">{step.detail}</p>
              {step.equation && (
                <p className="readout overflow-x-auto rounded-md bg-white/[0.03] px-2.5 py-1.5 text-xs whitespace-pre-wrap text-slate-100 ring-1 ring-white/[0.06] ring-inset">
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
