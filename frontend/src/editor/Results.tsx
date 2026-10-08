import type { Simulation } from './useSimulation'
import type { Diagnosis } from './diagnose'
import type { Hover } from './Canvas'
import { formatValue } from '../units'
import { GROUND_NODE } from '../schematic/netlist'

interface ResultsProps {
  live: boolean
  simulation: Simulation
  diagnosis?: Diagnosis
  onHover: (hover: Hover | undefined) => void
}

/** Browsers coarsen timers to about 0.1 ms, so smaller values read as "< 0.1 ms". */
function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '—'
  return ms < 0.1 ? '< 0.1 ms' : `${ms.toFixed(1)} ms`
}

/**
 * The status line and full results tables. Hover readouts on the canvas are
 * the quick way to read values; this panel lists all of them, which also
 * makes results reachable without a mouse.
 */
export function Results({ live, simulation, diagnosis, onHover }: ResultsProps) {
  const { result, solveMs, connectivity } = simulation

  if (!live) {
    return (
      <p className="text-sm leading-relaxed text-slate-400">
        Press <b className="font-medium text-slate-200">Solve</b> to simulate. Results then update live as you edit.
      </p>
    )
  }
  if (connectivity.netlist.components.length === 0) {
    return <p className="text-sm text-slate-400">Add some components to simulate.</p>
  }
  if (!result) return null

  if (!result.ok) {
    return (
      <div role="alert" className="ui-enter rounded-lg bg-red-500/10 p-3 text-sm text-red-200 ring-1 ring-red-400/30 ring-inset">
        <p className="font-semibold">Can’t solve this circuit</p>
        <p className="mt-1">{diagnosis?.message ?? result.error.message}</p>
      </div>
    )
  }

  const { node_voltages, branch_currents } = result.solution
  const nodes = Object.keys(node_voltages)
    .filter((n) => n !== GROUND_NODE)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))

  return (
    <div className="space-y-4 text-sm">
      <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300 ring-1 ring-emerald-400/30 ring-inset" data-testid="solve-status">
        <svg viewBox="0 0 12 12" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path d="M2.5 6.5 5 9l4.5-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Solved {nodes.length} node{nodes.length === 1 ? '' : 's'} in {formatMs(solveMs)}
      </p>

      <table className="w-full">
        <caption className="mb-1.5 text-left text-[11px] font-semibold tracking-[0.06em] text-slate-400 uppercase">Node voltages</caption>
        <tbody>
          {nodes.map((node) => (
            <tr
              key={node}
              className="transition-colors duration-150 hover:bg-white/[0.04] [&>*]:py-1 [&>*:first-child]:rounded-l-md [&>*:first-child]:pl-2 [&>*:last-child]:rounded-r-md [&>*:last-child]:pr-2"
              onMouseEnter={() => onHover({ kind: 'node', node })}
              onMouseLeave={() => onHover(undefined)}
            >
              <th scope="row" className="text-left font-normal text-slate-300">
                {node}
              </th>
              <td className="readout text-right text-white">{formatValue(node_voltages[node]!, 'V')}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="w-full">
        <caption className="mb-1.5 text-left text-[11px] font-semibold tracking-[0.06em] text-slate-400 uppercase">Branch currents</caption>
        <tbody>
          {connectivity.netlist.components.map(({ id }) => (
            <tr
              key={id}
              className="transition-colors duration-150 hover:bg-white/[0.04] [&>*]:py-1 [&>*:first-child]:rounded-l-md [&>*:first-child]:pl-2 [&>*:last-child]:rounded-r-md [&>*:last-child]:pr-2"
              onMouseEnter={() => onHover({ kind: 'part', id })}
              onMouseLeave={() => onHover(undefined)}
            >
              <th scope="row" className="text-left font-normal text-slate-300">
                {id}
              </th>
              <td className="readout text-right text-white">{formatValue(branch_currents[id]!, 'A')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs leading-relaxed text-slate-500">
        Currents are positive from a part’s first terminal to its second (+ to − for voltage sources, along the
        arrow for current sources). Hover a row to see the direction on the circuit.
      </p>
    </div>
  )
}
