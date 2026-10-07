import { useEffect, useMemo, useReducer, useState } from 'react'
import { type Api, httpApi } from './api'
import { CheckPanel, ExplainPanel } from './editor/AssistantPanels'
import { Canvas, type Hover } from './editor/Canvas'
import { diagnose } from './editor/diagnose'
import { Inspector } from './editor/Inspector'
import { LibraryMenu } from './editor/LibraryMenu'
import { Results } from './editor/Results'
import { type Signal, type SignalKind, defaultSignals, pruneSignals, toggleSignal } from './editor/signals'
import { Toolbar } from './editor/Toolbar'
import { TOOL_KEYS } from './editor/tools'
import { type TransientSettings, sampleAt, suggestSettings } from './editor/transient'
import { TransientPanel } from './editor/TransientPanel'
import { type Analysis, useSimulation } from './editor/useSimulation'
import { WaveformChart } from './editor/WaveformChart'
import { editorReducer, initialState } from './schematic/editor'
import { type Example, voltageDivider } from './schematic/examples'
import { emptySchematic, pointKey } from './schematic/model'
import type { Solver } from './solver'

type Mode = Analysis['mode']
type Panel = 'results' | 'explain' | 'check'

const PANELS: [Panel, string][] = [
  ['results', 'Results'],
  ['explain', 'Explain'],
  ['check', 'Check my work'],
]

/**
 * The editor. It receives the solver and the backend client as props instead
 * of creating them itself, so tests can pass in a solver initialized from
 * disk and a fake API, and the component never deals with async loading.
 */
export default function App({ solver, api = httpApi }: { solver: Solver; api?: Api }) {
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

  function loadExample(example: Example) {
    dispatch({ type: 'load', schematic: example.schematic })
    setMode(example.transient ? 'transient' : 'dc')
    if (example.transient) setSettings(example.transient)
    setChosenSignals(null)
    setCursor(undefined)
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <h1 className="text-lg font-bold tracking-tight">Schematica</h1>
          <p className="hidden text-sm text-slate-500 lg:block">
            Draw a circuit, solve it at DC or over time, and see every voltage and current.
          </p>
          <LibraryMenu
            api={api}
            schematic={state.schematic}
            netlist={connectivity.netlist}
            onOpen={(schematic) => {
              dispatch({ type: 'load', schematic })
              setChosenSignals(null)
              setCursor(undefined)
            }}
          />
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <Toolbar
            tool={state.tool}
            dispatch={dispatch}
            live={live}
            onToggleLive={() => setLive((l) => !l)}
            mode={mode}
            onMode={switchMode}
            onLoadExample={loadExample}
            onClear={() => {
              dispatch({ type: 'load', schematic: emptySchematic })
              setChosenSignals(null)
            }}
          />
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
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
            <section aria-label="Waveforms" className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
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

        <aside className="space-y-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <Inspector
            schematic={state.schematic}
            selectedId={state.selectedId}
            dispatch={dispatch}
            connectivity={simulation.connectivity}
            solution={solution}
          />
          <hr className="border-slate-200" />
          {mode === 'dc' ? (
            <div className="space-y-4">
              <div role="tablist" aria-label="Sidebar" className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
                {PANELS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={panel === id}
                    onClick={() => setPanel(id)}
                    className={`flex-1 rounded-md px-2 py-1 ${
                      panel === id ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {panel === 'results' && (
                <Results live={live} simulation={simulation} diagnosis={diagnosis} onHover={setHover} />
              )}
              {panel === 'explain' && <ExplainPanel key={netlistKey} api={api} netlist={connectivity.netlist} />}
              {panel === 'check' && (
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
        </aside>
      </main>
    </div>
  )
}
