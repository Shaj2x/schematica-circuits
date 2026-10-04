import type { Dispatch } from 'react'
import type { EditorAction, Tool } from '../schematic/editor'
import { type Example, examples } from '../schematic/examples'
import { GroundSymbol, PartBody } from './symbols'
import { TOOLS } from './tools'

interface ToolbarProps {
  tool: Tool
  dispatch: Dispatch<EditorAction>
  live: boolean
  onToggleLive: () => void
  onLoadExample: (example: Example) => void
  onClear: () => void
}

export function Toolbar({ tool, dispatch, live, onToggleLive, onLoadExample, onClear }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="toolbar" aria-label="Tools" className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {TOOLS.map(({ tool: t, label, key }) => (
          <button
            key={t}
            type="button"
            aria-pressed={tool === t}
            title={`${label} (${key})`}
            onClick={() => dispatch({ type: 'setTool', tool: t })}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
              tool === t ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ToolIcon tool={t} />
            <span className="hidden 2xl:inline">{label}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        title="Rotate the selected part, or the next one placed (R)"
        onClick={() => dispatch({ type: 'rotate' })}
        className="rounded-md px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
      >
        Rotate
      </button>

      <select
        aria-label="Load an example circuit"
        value=""
        onChange={(e) => {
          const example = examples.find((x) => x.name === e.target.value)
          if (example) onLoadExample(example)
        }}
        className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700"
      >
        <option value="" disabled>
          Examples…
        </option>
        {examples.map((x) => (
          <option key={x.name} value={x.name}>
            {x.name}
          </option>
        ))}
      </select>

      <button type="button" onClick={onClear} className="rounded-md px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
        Clear
      </button>

      <button
        type="button"
        onClick={onToggleLive}
        aria-pressed={live}
        className={`ml-auto rounded-md px-4 py-1.5 text-sm font-semibold shadow-sm transition-colors ${
          live ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-sky-600 text-white hover:bg-sky-700'
        }`}
      >
        {live ? '● Live — stop' : 'Solve'}
      </button>
    </div>
  )
}

function ToolIcon({ tool }: { tool: Tool }) {
  const common = { width: 22, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, 'aria-hidden': true }
  switch (tool) {
    case 'select':
      return (
        <svg viewBox="0 0 22 16" {...common} strokeWidth={1.6}>
          <path d="M7 2 L7 14 L10 11 L12.5 15 L14 14 L11.5 10 L15 10 Z" fill="currentColor" />
        </svg>
      )
    case 'wire':
      return (
        <svg viewBox="0 0 22 16" {...common}>
          <path d="M2 13 H11 V3 H20" />
        </svg>
      )
    case 'ground':
      return (
        <svg viewBox="-20 -6 40 32" {...common} strokeWidth={3.5}>
          <GroundSymbol at={{ x: 0, y: 0 }} />
        </svg>
      )
    default:
      return (
        <svg viewBox="-4 -22 88 44" {...common} strokeWidth={5}>
          <PartBody kind={tool} />
        </svg>
      )
  }
}
