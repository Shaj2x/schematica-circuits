/**
 * Typed client for the backend (`backend/app/routes`). Like the solver, the
 * app receives an `Api` as a value, so UI tests can pass a fake.
 */

import type { Schematic } from './schematic/model'
import type { Netlist, Solution, SolverError } from './solver'

export interface Step {
  title: string
  detail: string
  equation: string | null
}

export interface Explanation {
  source: 'template' | 'claude'
  model: string | null
  summary: string
  steps: Step[]
  /** Values with units in the text that match nothing the solver computed. */
  unverified_numbers: string[]
  note: string | null
}

export interface QuantityResult {
  kind: 'voltage' | 'current'
  name: string
  label: string
  submitted: number
  expected: number | null
  correct: boolean
  hint: string | null
}

export interface CheckResult {
  all_correct: boolean
  results: QuantityResult[]
  feedback: Explanation
}

export interface Answers {
  node_voltages: Record<string, number>
  branch_currents: Record<string, number>
}

export interface CircuitSummary {
  id: string
  name: string
  component_count: number
  updated_at: string
}

export interface SavedCircuit {
  id: string
  name: string
  netlist: Netlist
  schematic: Schematic | null
  created_at: string
  updated_at: string
}

/** One symbol the detector found in a photo. */
export interface Detection {
  label: string
  confidence: number
  /** x0, y0, x1, y1 in the photo's pixels (after the server's downscaling). */
  box: [number, number, number, number]
  /** The editor part this detection became, if it became one. */
  part_id: string | null
  /** The text read as this part's value, if any. */
  value_text: string | null
}

/** Something about a recognized circuit the user should check. */
export interface RecognitionWarning {
  code: string
  message: string
  part_ids: string[]
}

export interface Recognition {
  image: { width: number; height: number }
  schematic: Schematic
  /** What the editor will derive from `schematic`; the server checked it matches the photo's wiring. */
  netlist: Netlist
  detections: Detection[]
  warnings: RecognitionWarning[]
}

/** A failed request: a solver error the UI can highlight, or a plain message. */
export class ApiError extends Error {
  readonly status: number
  readonly solverError?: SolverError

  constructor(message: string, status: number, solverError?: SolverError) {
    super(message)
    this.status = status
    this.solverError = solverError
  }
}

export interface Api {
  explain(netlist: Netlist): Promise<{ solution: Solution; explanation: Explanation }>
  check(netlist: Netlist, answers: Answers): Promise<CheckResult>
  listCircuits(): Promise<CircuitSummary[]>
  loadCircuit(id: string): Promise<SavedCircuit>
  saveCircuit(circuit: { id?: string; name: string; netlist: Netlist; schematic: Schematic }): Promise<SavedCircuit>
  recognize(image: Blob): Promise<Recognition>
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    // A FormData body sets its own multipart Content-Type (with the boundary).
    const json = !(init?.body instanceof FormData)
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { ...(json && { 'Content-Type': 'application/json' }), ...init?.headers },
    })
  } catch {
    throw new ApiError('Could not reach the Schematica server. Is the backend running?', 0)
  }
  if (response.ok) return (await response.json()) as T
  const body = (await response.json().catch(() => ({}))) as { error?: SolverError; detail?: unknown }
  if (body.error) throw new ApiError(body.error.message, response.status, body.error)
  const detail = typeof body.detail === 'string' ? body.detail : `Request failed (${response.status})`
  throw new ApiError(detail, response.status)
}

export const httpApi: Api = {
  explain: (netlist) => request('/explain', { method: 'POST', body: JSON.stringify({ netlist }) }),
  check: (netlist, answers) => request('/check', { method: 'POST', body: JSON.stringify({ netlist, answers }) }),
  listCircuits: () => request('/circuits'),
  loadCircuit: (id) => request(`/circuits/${id}`),
  saveCircuit: ({ id, ...body }) =>
    request(id ? `/circuits/${id}` : '/circuits', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }),
  recognize: (image) => {
    const body = new FormData()
    body.append('image', image)
    return request('/recognize', { method: 'POST', body })
  },
}
