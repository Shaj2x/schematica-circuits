import { useEffect, useMemo, useReducer, useState } from 'react'
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
import { Toolbar } from './editor/Toolbar'
import { TOOL_KEYS } from './editor/tools'
import { type TransientSettings, sampleAt, suggestSettings } from './editor/transient'
import { TransientPanel } from './editor/TransientPanel'
import { type Analysis, useSimulation } from './editor/useSimulation'
import { WaveformChart } from './editor/WaveformChart'
import { editorReducer, initialState } from './schematic/editor'
import { type Example, voltageDivider } from './schematic/examples'
import { type Schematic, emptySchematic, pointKey } from './schematic/model'
import type { Solver } from './solver'

type Mode = Analysis['mode']
type Panel = 'results' | 'explain' | 'check'

const PANELS = [
  ['results', 'Results'],
  ['explain', 'Explain'],
  ['check', 'Check my work'],
] as const satisfies readonly (readonly [Panel, string])[]

/**
 * The editor. It receives the solver and the backend client as props instead
 * of creating them itself, so tests can pass in a solver initialized from
 * disk and a fake API, and the component never deals with async loading.
 */
/** Where the hosted demo points people for the features that need the backend. */
const REPO_URL = 'https://github.com/Shaj2x/schematica-circuits'

/**
 * `backend` is false on the static website (GitHub Pages), where only the
 * browser half runs: drawing, the WebAssembly solver and the plots. Features
 * that need the server say so instead of failing with a network error.
 */
export default function App({ solver, api = httpApi, backend = true }: { solver: Solver; api?: Api; backend?: boolean }) {
  const [state, dispatch] = useReducer(editorReducer, voltageDivider.schematic, initialState)
  const [live, setLive] = useState(false)
  const [hover, setHover] = useState<Hover>()
  const [mode, setMode] = useState<Mode>('dc')
  const [settings, setSettings] = useState<TransientSettings>(() => suggestSettings(voltageDivider.schematic))
  // null means "not chosen yet": show sensible defaults for the circuit.
  const [chosenSignals, setChosenSignals] = useState<Signal[] | null>(null)
  // Sample index under the plot crosshair; undefined shows the final sample.
  const [cursor, setCursor] = useState<number>()
  const [panel, setPanel] = useState<Panel>('results')
  const [photoOpen, setPhotoOpen] = useState(false)
  // What to check after loading a circuit recognized from a photo.
  const [review, setReview] = useState<RecognitionWarning[]>()

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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      if (target.closest('input, select, textarea') || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (event.key === 'Escape') dispatch({ type: 'cancel' })
      else if (event.key === 'Delete' || event.key === 'Backspace') dispatch({ type: 'deleteSelected' })
      else if (key === 'r') dispatch({ type: 'rotate' })
      else if (key in TOOL_KEYS) dispatch({ type: 'setTool', tool: TOOL_KEYS[key]! })
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="min-h-screen text-slate-900">
      {/* Translucent chrome: a floating layer over the page, not an opaque strip. */}
      <header className="sticky top-0 z-20 border-b border-slate-900/[0.06] bg-white/70 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-3 px-5 py-2.5">
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <div className="leading-tight">
              <h1 className="text-[15px] font-semibold tracking-[-0.01em]">Schematica</h1>
              <p className="hidden text-xs text-slate-500 md:block">Draw it, solve it, see every voltage and current.</p>
            </div>
          </div>
          {backend ? (
            <>
              <button
                type="button"
                onClick={() => setPhotoOpen((open) => !open)}
                aria-expanded={photoOpen}
                className={`btn ml-2 ${photoOpen ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' : 'btn-secondary'}`}
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
            <p className="ml-auto flex items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700 ring-1 ring-sky-200 ring-inset">
                Browser demo
              </span>
              <span className="hidden sm:inline">The solver runs on your device in WebAssembly.</span>
              <a href={REPO_URL} className="font-medium text-slate-700 underline-offset-2 hover:underline">
                Source on GitHub
              </a>
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-[90rem] items-start gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3">
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
          <Toolbar
            tool={state.tool}
            dispatch={dispatch}
            live={live}
            onToggleLive={() => setLive((l) => !l)}
            mode={mode}
            onMode={switchMode}
            onLoadExample={loadExample}
            onClear={() => replaceDrawing(emptySchematic)}
          />
          <div className="relative overflow-hidden rounded-xl bg-white shadow-[var(--shadow-card)]">
            {state.schematic.parts.length === 0 && state.schematic.wires.length === 0 && (
              <p className="ui-enter pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-slate-400">
                Pick a part from the toolbar (or press <kbd>1</kbd>–<kbd>5</kbd>) and click the grid to place it.
              </p>
            )}
            <Canvas
              state={state}
              dispatch={dispatch}
              simulation={simulation}
              diagnosis={diagnosis}
              solution={solution}
              hover={hover}
              onHover={setHover}
            />
          </div>

          {mode === 'transient' && transient && (
            <section aria-label="Waveforms" className="ui-enter space-y-4 rounded-xl bg-white p-4 shadow-[var(--shadow-card)]">
              {voltageSeries.length === 0 && currentSeries.length === 0 && (
                <p className="text-sm text-slate-500">Choose node voltages or branch currents to plot.</p>
              )}
              {voltageSeries.length > 0 && (
                <WaveformChart
                  title="Voltage"
                  unit="V"
                  time={transient.time}
                  series={voltageSeries}
                  cursor={cursor}
                  onCursor={setCursor}
                />
              )}
              {currentSeries.length > 0 && (
                <WaveformChart
                  title="Current"
                  unit="A"
                  time={transient.time}
                  series={currentSeries}
                  cursor={cursor}
                  onCursor={setCursor}
                />
              )}
            </section>
          )}
        </div>

        <aside className="space-y-3">
          <div className="rounded-xl bg-white p-4 shadow-[var(--shadow-card)]">
            <Inspector
              schematic={state.schematic}
              selectedId={state.selectedId}
              dispatch={dispatch}
              connectivity={simulation.connectivity}
              solution={solution}
            />
          </div>
          <div className="rounded-xl bg-white p-4 shadow-[var(--shadow-card)]">
          {mode === 'dc' ? (
            <div className="space-y-4">
              <Segmented kind="tabs" label="Sidebar" options={PANELS} value={panel} onChange={setPanel} />
              {panel === 'results' && (
                <Results live={live} simulation={simulation} diagnosis={diagnosis} onHover={setHover} />
              )}
              {panel !== 'results' && !backend && <NeedsBackend feature={panel === 'explain' ? 'Step-by-step explanations' : 'Checking your answers'} />}
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
      </main>
    </div>
  )
}

/** A resistor zigzag on an accent tile: the product in one glyph. */
function LogoMark() {
  return (
    <svg viewBox="0 0 32 32" width={30} height={30} aria-hidden className="shrink-0">
      <defs>
        <linearGradient id="logo-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0ea5e9" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#logo-tile)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" fill="none" stroke="white" strokeOpacity="0.2" />
      <path
        d="M4 16h5l2-5 3 10 3-10 3 10 2-5h6"
        fill="none"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function NeedsBackend({ feature }: { feature: string }) {
  return (
    <div className="ui-enter space-y-2 text-sm text-slate-600">
      <p>
        <b className="font-medium text-slate-800">{feature}</b> come from the Schematica server, which this browser-only
        demo doesn’t include. Everything else (drawing, solving and the plots) works here.
      </p>
      <p>
        To try it, run the app locally:{' '}
        <a href={`${REPO_URL}#running-it`} className="font-medium text-sky-700 underline-offset-2 hover:underline">
          setup instructions
        </a>
        .
      </p>
    </div>
  )
}
