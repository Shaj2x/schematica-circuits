// The browser's solver: the same circuits as solver/examples/bench.rs, run
// through the WebAssembly build exactly as the editor calls it (JSON in,
// JSON out), so the times include the boundary crossing the UI pays.
//
//   cd frontend && npm run build:wasm && cd .. && node bench/wasm_speed.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initSync, solve, solveTransient } from '../frontend/src/solver/pkg/schematica_solver_wasm.js'

const pkg = new URL('../frontend/src/solver/pkg/schematica_solver_wasm_bg.wasm', import.meta.url)
initSync({ module: readFileSync(fileURLToPath(pkg)) })

function mesh(n) {
  const node = (r, c) => `n${r}_${c}`
  const components = [{ id: 'V1', type: 'voltage_source', pos: node(0, 0), neg: 'gnd', value: 10 }]
  let id = 0
  const resistor = (a, b) => ({ id: `R${++id}`, type: 'resistor', a, b, value: 1000 })
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      if (c + 1 < n) components.push(resistor(node(r, c), node(r, c + 1)))
      if (r + 1 < n) components.push(resistor(node(r, c), node(r + 1, c)))
    }
  components.push(resistor(node(n - 1, n - 1), 'gnd'))
  return { version: 1, ground: 'gnd', components }
}

function rcLadder(stages) {
  const components = [{ id: 'V1', type: 'voltage_source', pos: 'n0', neg: 'gnd', value: 5 }]
  for (let i = 0; i < stages; i++) {
    components.push({ id: `R${i}`, type: 'resistor', a: `n${i}`, b: `n${i + 1}`, value: 1000 })
    components.push({ id: `C${i}`, type: 'capacitor', a: `n${i + 1}`, b: 'gnd', value: 1e-9 })
  }
  return { version: 1, ground: 'gnd', components }
}

/** Median of repeated runs: at least 5, and at least ~300 ms of work. */
function median(run) {
  for (let i = 0; i < 3; i++) run() // warm up the JIT
  const times = []
  const start = performance.now()
  while (times.length < 5 || (performance.now() - start < 300 && times.length < 2000)) {
    const t = performance.now()
    run()
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  return times[Math.floor(times.length / 2)]
}

const fmt = (ms) => (ms < 0.1 ? `${(ms * 1000).toFixed(1)} µs` : `${ms.toFixed(2)} ms`)

console.log('DC operating point, n x n resistor mesh (WebAssembly, JSON in and out)\n')
console.log('| Nodes | Components | Median solve |')
console.log('|------:|-----------:|-------------:|')
for (const n of [3, 5, 8, 12, 16, 23, 32]) {
  const json = JSON.stringify(mesh(n))
  const t = median(() => {
    if (!JSON.parse(solve(json)).ok) throw new Error('mesh failed')
  })
  console.log(`| ${n * n + 1} | ${mesh(n).components.length} | ${fmt(t)} |`)
}

console.log('\nTransient, RC ladder, 1000 steps (WebAssembly, JSON in and out)\n')
console.log('| Nodes | Components | Median run |')
console.log('|------:|-----------:|-----------:|')
for (const stages of [1, 5, 10, 25, 50, 100, 200]) {
  const json = JSON.stringify(rcLadder(stages))
  const options = JSON.stringify({ stop_time: 1e-6 * stages, time_step: 1e-9 * stages })
  const t = median(() => {
    if (!JSON.parse(solveTransient(json, options)).ok) throw new Error('ladder failed')
  })
  console.log(`| ${stages + 2} | ${rcLadder(stages).components.length} | ${fmt(t)} |`)
}
