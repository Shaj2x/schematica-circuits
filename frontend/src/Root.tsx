import { useEffect, useState } from 'react'
import App from './App.tsx'
import { type Solver, loadSolver } from './solver'

/** Loads the WebAssembly solver once, then renders the editor. */
export default function Root() {
  const [solver, setSolver] = useState<Solver>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    loadSolver().then(setSolver, (e: unknown) => setError(String(e)))
  }, [])

  if (error) return <p className="p-8 text-red-700">Could not load the solver: {error}</p>
  if (!solver) return <p className="p-8 text-slate-500">Loading solver…</p>
  // The static website build sets VITE_STATIC=1: no server behind it.
  return <App solver={solver} backend={import.meta.env.VITE_STATIC !== '1'} />
}
