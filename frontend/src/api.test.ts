import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, httpApi } from './api'
import type { Netlist } from './solver'

const netlist: Netlist = { version: 1, ground: 'gnd', components: [] }

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('httpApi', () => {
  it('posts the netlist to /api/explain', async () => {
    const fetchMock = mockFetch(200, { solution: {}, explanation: { steps: [] } })
    await httpApi.explain(netlist)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/explain')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ netlist })
  })

  it('creates with POST and updates with PUT', async () => {
    const fetchMock = mockFetch(200, {})
    const schematic = { parts: [], wires: [], grounds: [] }
    await httpApi.saveCircuit({ name: 'A', netlist, schematic })
    await httpApi.saveCircuit({ id: 'abc', name: 'A', netlist, schematic })
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['/api/circuits', 'POST'],
      ['/api/circuits/abc', 'PUT'],
    ])
  })

  it('turns a 422 solver error into an ApiError carrying the structured error', async () => {
    const error = { kind: 'missing_ground', ground: 'gnd', message: 'no ground' }
    mockFetch(422, { error })
    await expect(httpApi.explain(netlist)).rejects.toMatchObject({ status: 422, solverError: error, message: 'no ground' })
  })

  it('reports an unreachable server clearly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const promise = httpApi.listCircuits()
    await expect(promise).rejects.toBeInstanceOf(ApiError)
    await expect(promise).rejects.toThrow(/backend running/)
  })

  it('uploads a photo as multipart form data', async () => {
    const fetchMock = mockFetch(200, { schematic: {}, detections: [], warnings: [] })
    const photo = new Blob(['png bytes'], { type: 'image/png' })
    await httpApi.recognize(photo)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/recognize')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('image')).toBeInstanceOf(Blob)
    // The browser must set the multipart boundary itself.
    expect(init.headers['Content-Type']).toBeUndefined()
  })

  it('passes through FastAPI error details', async () => {
    mockFetch(404, { detail: 'circuit not found' })
    await expect(httpApi.loadCircuit('x')).rejects.toThrow('circuit not found')
  })
})
