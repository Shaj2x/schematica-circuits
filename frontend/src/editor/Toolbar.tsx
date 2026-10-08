import type { Dispatch } from 'react'
import type { EditorAction, Tool } from '../schematic/editor'
import { type Example, examples } from '../schematic/examples'
import { Segmented } from './Segmented'
import { GroundSymbol, PartBody } from './symbols'
import { TOOLS } from './tools'

interface ToolbarProps {
  tool: Tool
  dispatch: Dispatch<EditorAction>
  live: boolean
  onToggleLive: () => void
  mode: 'dc' | 'transient'
  onMode: (mode: 'dc' | 'transient') => void
  onLoadExample: (example: Example) => void
  onClear: () => void
}

export function Toolbar({ tool, dispatch, live, onToggleLive, mode, onMode, onLoadExample, onClear }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Tool changes are instant: they are mostly made from the keyboard,
          many times a minute, and a sliding highlight would only lag. */}
      <div role="toolbar" aria-label="Tools" className="flex shrink-0 gap-0.5 rounded-lg bg-white p-0.5 shadow-[var(--shadow-raised)]">
        {TOOLS.map(({ tool: t, label, key }) => (
          <button
            key={t}
            type="button"
            aria-pressed={tool === t}
            aria-label={label}
            title={`${label} (${key})`}
            onClick={() => dispatch({ type: 'setTool', tool: t })}
            className={`btn h-8 w-9 px-0 ${
              tool === t ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200 ring-inset' : 'btn-ghost'
            }`}
          >
            <ToolIcon tool={t} />
          </button>
        ))}
      </div>

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title="Rotate the selected part, or the next one placed (R)"
          onClick={() => dispatch({ type: 'rotate' })}
          className="btn btn-ghost px-2.5"
        >
          <svg viewBox="0 0 16 16" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
            <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.4h-2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Rotate
        </button>
        <select
          aria-label="Load an example circuit"
          value=""
          onChange={(e) => {
            const example = examples.find((x) => x.name === e.target.value)
            if (example) onLoadExample(example)
          }}
          className="field max-w-40 py-1.5"
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
        <button type="button" onClick={onClear} className="btn btn-ghost px-2.5">
          Clear
        </button>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Segmented
          label="Analysis"
          options={[
            ['dc', 'DC'],
            ['transient', 'Transient'],
          ]}
          value={mode}
          onChange={onMode}
        />
        <button
          type="button"
          onClick={onToggleLive}
          aria-pressed={live}
          title={live ? 'Stop solving on every edit' : 'Solve now, then keep solving as you edit'}
          className={`btn min-w-[5.5rem] font-semibold ${live ? 'btn-live' : 'btn-primary'}`}
        >
          {live ? (
            <>
              <span aria-hidden className="size-1.5 rounded-full bg-white shadow-[0_0_0_3px_rgb(255_255_255/0.3)]" />
              Live
            </>
          ) : (
            'Solve'
          )}
        </button>
      </div>
    </div>
  )
}

function ToolIcon({ tool }: { tool: Tool }) {
  const common = { width: 20, height: 15, fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, 'aria-hidden': true }
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
