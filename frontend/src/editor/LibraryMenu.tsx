import { useState } from 'react'
import type { Api, CircuitSummary } from '../api'
import type { Schematic } from '../schematic/model'
import type { Netlist } from '../solver'

interface LibraryMenuProps {
  api: Api
  schematic: Schematic
  netlist: Netlist
  onOpen: (schematic: Schematic, name: string) => void
}

/**
 * Save and open circuits on the server. Saving again after a save or an
 * open updates that circuit; "Save as new" always creates another.
 */
export function LibraryMenu({ api, schematic, netlist, onOpen }: LibraryMenuProps) {
  const [current, setCurrent] = useState<{ id: string; name: string }>()
  const [name, setName] = useState('')
  const [saved, setSaved] = useState<CircuitSummary[]>()
  const [message, setMessage] = useState<string>()

  async function save(asNew: boolean) {
    const circuitName = name.trim() || current?.name || 'Untitled circuit'
    try {
      const result = await api.saveCircuit({
        id: asNew ? undefined : current?.id,
        name: circuitName,
        netlist,
        schematic,
      })
      setCurrent({ id: result.id, name: result.name })
      setName(result.name)
      setMessage(`Saved “${result.name}”.`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  async function refresh() {
    try {
      setSaved(await api.listCircuits())
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  async function open(id: string) {
    try {
      const circuit = await api.loadCircuit(id)
      if (!circuit.schematic) {
        setMessage(`“${circuit.name}” has no drawing to open (it was saved as a netlist only).`)
        return
      }
      onOpen(circuit.schematic, circuit.name)
      setCurrent({ id: circuit.id, name: circuit.name })
      setName(circuit.name)
      setMessage(`Opened “${circuit.name}”.`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Circuit name"
        aria-label="Circuit name"
        className="w-40 rounded-md border border-slate-300 px-2 py-1"
      />
      <button type="button" onClick={() => save(false)} className="rounded-md bg-slate-800 px-3 py-1 font-medium text-white hover:bg-slate-700">
        {current ? 'Save' : 'Save to server'}
      </button>
      {current && (
        <button type="button" onClick={() => save(true)} className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100">
          Save as new
        </button>
      )}
      <select
        aria-label="Open a saved circuit"
        value=""
        onFocus={refresh}
        onMouseDown={refresh}
        onChange={(e) => e.target.value && open(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1"
      >
        <option value="" disabled>
          Open…
        </option>
        {saved?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.component_count} parts)
          </option>
        ))}
        {saved?.length === 0 && <option disabled>No saved circuits yet</option>}
      </select>
      {message && (
        <span role="status" className="text-xs text-slate-500">
          {message}
        </span>
      )}
    </div>
  )
}
