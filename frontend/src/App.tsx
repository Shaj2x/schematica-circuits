import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { type Api, type RecognitionWarning, httpApi } from './api'
import { CheckPanel, ExplainPanel } from './editor/AssistantPanels'
import { Canvas, type Hover } from './editor/Canvas'
import { diagnose } from './editor/diagnose'
import { Inspector } from './editor/Inspector'
import { LibraryMenu } from './editor/LibraryMenu'
import { PhotoImport, ReviewList } from './editor/PhotoImport'
import { Results } from './editor/Results'
import { Segmented } from './editor/Segmented'
import { type Signal, type SignalKind, defaultSignals, pruneSignals, toggleSignal } from './editor/signals'
import { ToolRail } from './editor/Toolbar'
import { TOOL_KEYS } from './editor/tools'
import { type TransientSettings, sampleAt, suggestSettings } from './editor/transient'
import { TransientPanel } from './editor/TransientPanel'
import { type Analysis, useSimulation } from './editor/useSimulation'
import { WaveformChart } from './editor/WaveformChart'
import { canRedo, canUndo, editorReducer, initialState } from './schematic/editor'
import { type Example, examples, voltageDivider } from './schematic/examples'
import { type Schematic, emptySchematic, pointKey } from './schematic/model'
import { ShareError, fromHash, fromJson, toHash, toJson } from './schematic/share'
import type { Solver } from './solver'
import { formatValue } from './units'
import { CANVAS_BG, VOLTAGE_RAMP } from './editor/palette'

type Mode = Analysis['mode']
type Panel = 'results' | 'explain' | 'check'

const PANELS = [
  ['results', 'Results'],
  ['explain', 'Explain'],
  ['check', 'Check my work'],
] as const satisfies readonly (readonly [Panel, string])[]

/** Where the hosted demo points people for the features that need the backend. */
const REPO_URL = 'https://github.com/Shaj2x/schematica-circuits'

/**
 * The editor. It receives the solver and the backend client as props instead
 * of creating them itself, so tests can pass in a solver initialized from
 * disk and a fake API, and the component never deals with async loading.
 *
 * `backend` is false on the static website (GitHub Pages), where only the
 * browser half runs: drawing, the WebAssembly solver and the plots. Features
 * that need the server say so instead of failing with a network error.
 */
export default function App({ solver, api = httpApi, backend = true }: { solver: Solver; api?: Api; backend?: boolean }) {
  // A shared link (#c=...) opens that circuit; anything else opens the starter.
  const [linkError] = useState(() => {
    try {
      fromHash(window.location.hash)
      return undefined
    } catch (e) {
      return e instanceof ShareError ? e.message : String(e)
    }
  })
  const [state, dispatch] = useReducer(editorReducer, undefined, () => {
    let shared: Schematic | undefined
    try {
      shared = fromHash(window.location.hash)
    } catch {
      shared = undefined
    }
    return initialState(shared ?? voltageDivider.schematic)
  })
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | undefined>(
    linkError ? { text: linkError, tone: 'error' } : undefined,
  )
  const [live, setLive] = useState(false)
  const [hover, setHover] = useState<Hover>()
  const [mode, setMode] = useState<Mode>('dc')
  const [settings, setSettings] = useState<TransientSettings>(() => suggestSettings(state.schematic))
  // null means "not chosen yet": show sensible defaults for the circuit.
  const [chosenSignals, setChosenSignals] = useState<Signal[] | null>(null)
  // Sample index under the plot crosshair; undefined shows the final sample.
  const [cursor, setCursor] = useState<number>()
  const [panel, setPanel] = useState<Panel>('results')
  const [photoOpen, setPhotoOpen] = useState(false)
  // What to check after loading a circuit recognized from a photo.
  const [review, setReview] = useState<RecognitionWarning[]>()
  // Bumped whenever a different circuit is opened, so the canvas re-centres on it.
  const [fitKey, setFitKey] = useState(0)

  const analysis = useMemo<Analysis>(() => (mode === 'dc' ? { mode } : { mode, settings }), [mode, settings])
  const simulation = useSimulation(solver, state.schematic, live, analysis)
  const { connectivity } = simulation
  // Explanations and checks belong to the circuit they were made for; keying
  // the panels by the netlist clears them as soon as the circuit changes.
  const netlistKey = useMemo(() => JSON.stringify(connectivity.netlist), [connectivity])

  const failed = simulation.result?.ok === false ? simulation.result : simulation.transient?.ok === false ? simulation.transient : undefined
  const diagnosis = failed && !failed.ok ? diagnose(failed.error) : undefined
  const transient = simulation.transient?.ok ? simulation.transient.solution : undefined

  // Nodes that some part connects to, and part ids, for the signal pickers.
  const { nodes, partIds } = useMemo(() => {
    const parts = state.schematic.parts
    const names = parts.flatMap((p) => [p.a, p.b].map((t) => connectivity.nodeOfPoint.get(pointKey(t))!))
    const nodes = [...new Set(names)].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    return { nodes, partIds: parts.map((p) => p.id) }
  }, [state.schematic, connectivity])

  const signals = pruneSignals(
    chosenSignals ?? defaultSignals(state.schematic, connectivity),
    new Set(nodes),
    new Set(partIds),
  )
  const toggle = (kind: SignalKind, name: string) => setChosenSignals(toggleSignal(signals, kind, name))

  const sampleIndex = transient ? Math.min(cursor ?? transient.time.length - 1, transient.time.length - 1) : undefined
  const sample =
    transient && sampleIndex !== undefined
      ? { time: transient.time[sampleIndex]!, solution: sampleAt(transient, sampleIndex) }
      : undefined
  const solution = mode === 'dc' ? (simulation.result?.ok ? simulation.result.solution : undefined) : sample?.solution

  function switchMode(next: Mode) {
    if (next === mode) return
    if (next === 'transient') setSettings(suggestSettings(state.schematic))
    setMode(next)
    setChosenSignals(null)
    setCursor(undefined)
  }

  /** Replaces the drawing, resetting everything that belonged to the old one. */
  function replaceDrawing(schematic: Schematic) {
    dispatch({ type: 'load', schematic })
    setFitKey((k) => k + 1)
    setChosenSignals(null)
    setCursor(undefined)
    setReview(undefined)
  }

  function loadExample(example: Example) {
    replaceDrawing(example.schematic)
    setMode(example.transient ? 'transient' : 'dc')
    if (example.transient) setSettings(example.transient)
  }

  const series = (kind: SignalKind) =>
    transient
      ? signals
          .filter((s) => s.kind === kind)
          .map((s) => ({
            key: `${kind}:${s.name}`,
            label: kind === 'voltage' ? `v(${s.name})` : `i(${s.name})`,
            slot: s.slot,
            values: (kind === 'voltage' ? transient.node_voltages : transient.branch_currents)[s.name] ?? [],
          }))
      : []
  const voltageSeries = series('voltage')
  const currentSeries = series('current')

  // Notices (link copied, import failed) fade out on their own.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(undefined), notice.tone === 'ok' ? 2200 : 6000)
    return () => clearTimeout(timer)
  }, [notice])

  // The key handler is registered once; it reads the selection through a ref.
  const selectedRef = useRef(state.selectedId)
  useEffect(() => {
    selectedRef.current = state.selectedId
  }, [state.selectedId])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (target.closest('input, select, textarea')) return
      const key = event.key.toLowerCase()
      const command = event.metaKey || event.ctrlKey
      if (command && key === 'z') dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
      else if (command && key === 'y') dispatch({ type: 'redo' })
      else if (command || event.altKey) return
      else if (event.key === 'Escape') dispatch({ type: 'cancel' })
      else if (event.key === 'Delete' || event.key === 'Backspace') dispatch({ type: 'deleteSelected' })
      else if (key === 'r') dispatch({ type: 'rotate' })
      else if (key in TOOL_KEYS) dispatch({ type: 'setTool', tool: TOOL_KEYS[key]! })
      else if (event.key.startsWith('Arrow') && selectedRef.current) {
        const [dx, dy] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key] ?? [0, 0]
        dispatch({ type: 'move', id: selectedRef.current, dx: dx!, dy: dy! })
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  async function share() {
    const url = `${window.location.origin}${window.location.pathname}${toHash(state.schematic)}`
    window.history.replaceState(null, '', toHash(state.schematic))
    try {
      await navigator.clipboard.writeText(url)
      setNotice({ text: 'Link copied. Anyone with it sees this circuit.', tone: 'ok' })
    } catch {
      setNotice({ text: 'The link is in the address bar: copy it from there.', tone: 'ok' })
    }
  }

  function exportFile() {
    const blob = new Blob([toJson(state.schematic)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'circuit.schematica.json'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  async function importFile(file: File | undefined) {
    if (!file) return
    try {
      replaceDrawing(fromJson(await file.text()))
      setNotice({ text: `Opened ${file.name}.`, tone: 'ok' })
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : String(e), tone: 'error' })
    }
  }

  // Legend for the voltage colours on the wires.
  const voltageRange = solution ? extent(Object.values(solution.node_voltages)) : undefined
  // Over a transient run, dot speed is relative to the largest current at any time.
  const flowPeak = useMemo(
    () => (transient ? Math.max(0, ...Object.values(transient.branch_currents).flat().map(Math.abs)) : undefined),
    [transient],
  )
  const isEmpty = state.schematic.parts.length === 0 && state.schematic.wires.length === 0

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      {/* Top bar: translucent chrome over the page. */}
      <header className="sticky top-0 z-20 flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.06] bg-ink-950/70 px-3 py-2 backdrop-blur-xl backdrop-saturate-150">
        <div className="mr-2 flex items-center gap-2.5">
          <LogoMark />
          <div className="leading-tight">
            <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-white">Schematica</h1>
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <IconButton label="Undo" shortcut="⌘Z" disabled={!canUndo(state)} onClick={() => dispatch({ type: 'undo' })}>
            <path d="M5.5 4 2.5 7l3 3M3 7h7a3.5 3.5 0 0 1 0 7H8" />
          </IconButton>
          <IconButton label="Redo" shortcut="⇧⌘Z" disabled={!canRedo(state)} onClick={() => dispatch({ type: 'redo' })}>
            <path d="M10.5 4l3 3-3 3M13 7H6a3.5 3.5 0 0 0 0 7h2" />
          </IconButton>
        </div>
        <span aria-hidden className="h-5 w-px bg-white/10" />

        <select
          aria-label="Load an example circuit"
          value=""
          onChange={(e) => {
            const example = examples.find((x) => x.name === e.target.value)
            if (example) loadExample(example)
          }}
          className="field max-w-40 py-1"
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
        <button type="button" onClick={() => replaceDrawing(emptySchematic)} className="btn btn-ghost">
          Clear
        </button>
        <button type="button" onClick={share} className="btn btn-ghost" title="Copy a link to this circuit">
          <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
            <path d="M6.5 9.5 9.5 6.5M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1" strokeLinecap="round" />
          </svg>
          Share
        </button>
        <button type="button" onClick={exportFile} className="btn btn-ghost" title="Download this circuit as a file" aria-label="Export">
          <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M8 2.5v7.5M5 7l3 3 3-3M3 12.5h10" />
          </svg>
          <span className="hidden 2xl:inline">Export</span>
        </button>
        <label className="btn btn-ghost cursor-pointer" title="Open a circuit file">
          <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M8 10.5V3M5 6l3-3 3 3M3 12.5h10" />
          </svg>
          <span className="hidden 2xl:inline">Import</span>
          <input
            type="file"
            accept=".json,application/json"
            aria-label="Import a circuit file"
            className="sr-only"
            onChange={(e) => {
              void importFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
        {notice && (
          <span
            role="status"
            className={`ui-enter rounded-full px-2.5 py-0.5 text-xs ${
              notice.tone === 'ok' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-500/10 text-red-300'
            }`}
          >
            {notice.text}
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {backend ? (
            <>
              <button
                type="button"
                onClick={() => setPhotoOpen((open) => !open)}
                aria-expanded={photoOpen}
                className={`btn ${photoOpen ? 'bg-cyan-400/15 text-cyan-200 shadow-[inset_0_0_0_1px_rgb(34_211_238/0.35)]' : 'btn-secondary'}`}
              >
                <svg viewBox="0 0 16 16" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                  <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h1.3l1-1.5h4.4l1 1.5h1.3A1.5 1.5 0 0 1 14 5.5v6A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z" strokeLinejoin="round" />
                  <circle cx="8" cy="8.3" r="2.4" />
                </svg>
                From photo
              </button>
              <LibraryMenu api={api} schematic={state.schematic} netlist={connectivity.netlist} onOpen={replaceDrawing} />
            </>
          ) : (
            <p className="flex items-center gap-2 text-xs text-slate-400">
              <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 font-medium text-cyan-300 ring-1 ring-cyan-400/30 ring-inset">
                Browser demo
              </span>
              <a href={REPO_URL} className="font-medium text-slate-300 underline-offset-2 hover:text-white hover:underline">
                Source on GitHub
              </a>
            </p>
          )}
          <span aria-hidden className="h-5 w-px bg-white/10" />
          <Segmented
            label="Analysis"
            options={[
              ['dc', 'DC'],
              ['transient', 'Transient'],
            ]}
            value={mode}
            onChange={switchMode}
          />
          <button
            type="button"
            onClick={() => setLive((l) => !l)}
            aria-pressed={live}
            title={live ? 'Stop solving on every edit' : 'Solve now, then keep solving as you edit'}
            className={`btn min-w-[5.5rem] ${live ? 'btn-live' : 'btn-primary'}`}
          >
            {live ? (
              <>
                <span aria-hidden className="size-1.5 rounded-full bg-ink-950" />
                Live
              </>
            ) : (
              'Solve'
            )}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
        <ToolRail tool={state.tool} dispatch={dispatch} hasSelection={state.selectedId !== undefined} />

        <main className="flex min-w-0 flex-1 flex-col gap-3">
          {photoOpen && (
            <PhotoImport
              api={api}
              onClose={() => setPhotoOpen(false)}
              onLoad={(schematic, warnings) => {
                replaceDrawing(schematic)
                switchMode('dc')
                setReview(warnings)
                setPhotoOpen(false)
              }}
            />
          )}
          {review && (
            <ReviewList
              warnings={review}
              onSelect={(id) => {
                dispatch({ type: 'setTool', tool: 'select' })
                dispatch({ type: 'select', id })
              }}
              onDismiss={() => setReview(undefined)}
            />
          )}

          <section
            aria-label="Schematic"
            className="panel relative h-[62vh] min-h-[320px] overflow-hidden lg:h-auto lg:flex-1"
            style={{ background: CANVAS_BG }}
          >
            <Canvas
              state={state}
              dispatch={dispatch}
              simulation={simulation}
              diagnosis={diagnosis}
              solution={solution}
              hover={hover}
              onHover={setHover}
              flowPeak={flowPeak}
              fitKey={fitKey}
            />
            {isEmpty && (
              <div className="ui-enter pointer-events-none absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-200">An empty canvas</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Pick a part from the rail (or press <kbd>1</kbd>–<kbd>5</kbd>) and click the grid to place it.
                  </p>
                </div>
              </div>
            )}
            {/* Status, bottom left: what the solver is doing. */}
            <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-ink-950/80 px-3 py-1 text-[11px] text-slate-400 shadow-[var(--shadow-float)] backdrop-blur">
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${diagnosis ? 'bg-red-400' : live ? 'bg-emerald-400 shadow-[0_0_8px_rgb(52_211_153)]' : 'bg-slate-600'}`}
              />
              {diagnosis ? 'Can’t solve' : live ? `Live · ${mode === 'dc' ? 'DC' : 'Transient'}` : 'Idle — press Solve'}
              {live && !diagnosis && simulation.solveMs !== undefined && (
                <span className="readout text-slate-500">{simulation.solveMs < 0.1 ? '<0.1' : simulation.solveMs.toFixed(1)} ms</span>
              )}
            </div>
            {/* Voltage legend, bottom right, whenever wires are coloured by voltage. */}
            {voltageRange && voltageRange[1] - voltageRange[0] > 1e-12 && (
              <div className="ui-enter pointer-events-none absolute right-3 bottom-3 flex items-center gap-2 rounded-full bg-ink-950/80 px-3 py-1 text-[11px] text-slate-400 shadow-[var(--shadow-float)] backdrop-blur">
                <span className="readout">{formatValue(voltageRange[0], 'V')}</span>
                <span aria-hidden className="h-1.5 w-20 rounded-full" style={{ background: `linear-gradient(90deg, ${VOLTAGE_RAMP.join(', ')})` }} />
                <span className="readout">{formatValue(voltageRange[1], 'V')}</span>
                <span className="ml-1 flex items-center gap-1">
                  <span aria-hidden className="size-1.5 rounded-full bg-amber-300" /> current
                </span>
              </div>
            )}
          </section>

          {mode === 'transient' && transient && (
            <section aria-label="Waveforms" className="panel ui-enter shrink-0 space-y-4 p-4 lg:max-h-[42vh] lg:overflow-y-auto">
              {voltageSeries.length === 0 && currentSeries.length === 0 && (
                <p className="text-sm text-slate-400">Choose node voltages or branch currents to plot.</p>
              )}
              {voltageSeries.length > 0 && (
                <WaveformChart title="Voltage" unit="V" time={transient.time} series={voltageSeries} cursor={cursor} onCursor={setCursor} />
              )}
              {currentSeries.length > 0 && (
                <WaveformChart title="Current" unit="A" time={transient.time} series={currentSeries} cursor={cursor} onCursor={setCursor} />
              )}
            </section>
          )}
        </main>

        <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[22rem] lg:overflow-y-auto">
          <div className="panel p-4">
            <Inspector
              schematic={state.schematic}
              selectedId={state.selectedId}
              dispatch={dispatch}
              connectivity={simulation.connectivity}
              solution={solution}
            />
          </div>
          <div className="panel p-4">
            {mode === 'dc' ? (
              <div className="space-y-4">
                <Segmented kind="tabs" label="Sidebar" options={PANELS} value={panel} onChange={setPanel} />
                {panel === 'results' && (
                  <Results live={live} simulation={simulation} diagnosis={diagnosis} onHover={setHover} />
                )}
                {panel !== 'results' && !backend && (
                  <NeedsBackend feature={panel === 'explain' ? 'Step-by-step explanations' : 'Checking your answers'} />
                )}
                {panel === 'explain' && backend && <ExplainPanel key={netlistKey} api={api} netlist={connectivity.netlist} />}
                {panel === 'check' && backend && (
                  <CheckPanel key={netlistKey} api={api} netlist={connectivity.netlist} nodes={nodes} partIds={partIds} />
                )}
              </div>
            ) : (
              <TransientPanel
                live={live}
                settings={settings}
                onSettings={setSettings}
                onSuggest={() => setSettings(suggestSettings(state.schematic))}
                result={simulation.transient}
                solveMs={simulation.solveMs}
                diagnosis={diagnosis}
                nodes={nodes}
                partIds={partIds}
                selected={signals}
                onToggle={toggle}
                sample={sample}
                onResetCursor={cursor === undefined ? undefined : () => setCursor(undefined)}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function extent(values: number[]): [number, number] | undefined {
  return values.length === 0 ? undefined : [Math.min(...values), Math.max(...values)]
}

function IconButton({
  label,
  shortcut,
  disabled,
  onClick,
  children,
}: {
  label: string
  shortcut: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button type="button" aria-label={label} title={`${label} (${shortcut})`} disabled={disabled} onClick={onClick} className="btn btn-ghost btn-icon">
      <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  )
}

function NeedsBackend({ feature }: { feature: string }) {
  return (
    <div className="ui-enter space-y-2 text-sm text-slate-400">
      <p>
        <b className="font-medium text-slate-100">{feature}</b> come from the Schematica server, which this browser-only
        demo doesn’t include. Everything else (drawing, solving and the plots) works here.
      </p>
      <p>
        To try it, run the app locally:{' '}
        <a href={`${REPO_URL}#running-it`} className="font-medium text-cyan-300 underline-offset-2 hover:underline">
          setup instructions
        </a>
        .
      </p>
    </div>
  )
}

/** A resistor zigzag on an accent tile: the product in one glyph. */
function LogoMark() {
  return (
    <svg viewBox="0 0 32 32" width={30} height={30} aria-hidden className="shrink-0 drop-shadow-[0_0_12px_rgb(34_211_238/0.35)]">
      <defs>
        <linearGradient id="logo-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#logo-tile)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="white" strokeOpacity="0.25" />
      <path d="M4 16h5l2-5 3 10 3-10 3 10 2-5h6" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
