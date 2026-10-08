import { type Dispatch, Fragment } from 'react'
import type { EditorAction, Tool } from '../schematic/editor'
import { GroundSymbol, PartBody } from './symbols'
import { TOOLS } from './tools'

interface ToolRailProps {
  tool: Tool
  dispatch: Dispatch<EditorAction>
  hasSelection: boolean
}

/**
 * The vertical tool palette. Tool changes are instant: they are mostly made
 * from the keyboard, many times a minute, and a sliding highlight would
 * only lag. Each tool's name and shortcut show in a delayed tooltip.
 */
export function ToolRail({ tool, dispatch, hasSelection }: ToolRailProps) {
  return (
    <div className="panel flex shrink-0 gap-1 p-1.5 lg:flex-col" style={{ ["--canvas-bg" as string]: "transparent" }} role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {TOOLS.map(({ tool: t, label, key }, i) => (
        <Fragment key={t}>
          {(i === 2 || i === 7) && <span aria-hidden className="m-1 bg-white/[0.08] max-lg:w-px lg:h-px" />}
          <button
            type="button"
            aria-pressed={tool === t}
            aria-label={label}
            data-tip={`${label}  ${key}`}
            onClick={() => dispatch({ type: 'setTool', tool: t })}
            className={`rail-tip btn btn-icon h-9 w-9 ${
              tool === t
                ? 'bg-cyan-400/15 text-cyan-200 shadow-[inset_0_0_0_1px_rgb(34_211_238/0.35)]'
                : 'btn-ghost'
            }`}
          >
            <ToolIcon tool={t} />
          </button>
        </Fragment>
      ))}
      <span aria-hidden className="m-1 bg-white/[0.08] max-lg:w-px lg:h-px" />
      <button
        type="button"
        aria-label="Rotate"
        data-tip="Rotate  R"
        onClick={() => dispatch({ type: 'rotate' })}
        className="rail-tip btn btn-ghost btn-icon h-9 w-9"
      >
        <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
          <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.4h-2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Delete selected"
        data-tip="Delete  ⌫"
        disabled={!hasSelection}
        onClick={() => dispatch({ type: 'deleteSelected' })}
        className="rail-tip btn btn-ghost btn-icon h-9 w-9"
      >
        <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
          <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  )
}

function ToolIcon({ tool }: { tool: Tool }) {
  const common = { width: 24, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, 'aria-hidden': true }
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
