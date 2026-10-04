import { useEffect, useReducer, useState } from 'react'
import { Canvas, type Hover } from './editor/Canvas'
import { diagnose } from './editor/diagnose'
import { Inspector } from './editor/Inspector'
import { Results } from './editor/Results'
import { Toolbar } from './editor/Toolbar'
import { TOOL_KEYS } from './editor/tools'
import { useSimulation } from './editor/useSimulation'
import { editorReducer, initialState } from './schematic/editor'
import { voltageDivider } from './schematic/examples'
import { emptySchematic } from './schematic/model'
import type { Solver } from './solver'

/**
 * The editor. It receives the solver as a prop instead of loading it itself,
 * so tests can pass in one initialized from disk and the component never
 * deals with async loading.
 */
export default function App({ solver }: { solver: Solver }) {
  const [state, dispatch] = useReducer(editorReducer, voltageDivider.schematic, initialState)
  const [live, setLive] = useState(false)
  const [hover, setHover] = useState<Hover>()
  const simulation = useSimulation(solver, state.schematic, live)
  const diagnosis = simulation.result && !simulation.result.ok ? diagnose(simulation.result.error) : undefined
  const solution = simulation.result?.ok ? simulation.result.solution : undefined

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
        <div className="mx-auto flex max-w-7xl items-baseline gap-3 px-4 py-3">
          <h1 className="text-lg font-bold tracking-tight">Schematica</h1>
          <p className="hidden text-sm text-slate-500 sm:block">Draw a DC circuit, solve it, and see every voltage and current.</p>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <Toolbar
            tool={state.tool}
            dispatch={dispatch}
            live={live}
            onToggleLive={() => setLive((l) => !l)}
            onLoadExample={(example) => dispatch({ type: 'load', schematic: example.schematic })}
            onClear={() => dispatch({ type: 'load', schematic: emptySchematic })}
          />
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <Canvas
              state={state}
              dispatch={dispatch}
              simulation={simulation}
              diagnosis={diagnosis}
              hover={hover}
              onHover={setHover}
            />
          </div>
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
          <Results live={live} simulation={simulation} diagnosis={diagnosis} onHover={setHover} />
        </aside>
      </main>
    </div>
  )
}
