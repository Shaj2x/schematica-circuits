// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { type Api, ApiError, type Recognition } from '../api'
import fixtures from '../schematic/recognized.fixture.json'
import type { Schematic } from '../schematic/model'
import { testSolver } from '../test/solver'

// jsdom has no object URLs; the component only needs a string back.
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:photo')
  URL.revokeObjectURL = vi.fn()
})
afterEach(cleanup)

const divider = fixtures.divider as unknown as { schematic: Schematic; netlist: Recognition['netlist'] }
const ids = divider.schematic.parts.map((p) => p.id)

const recognition: Recognition = {
  image: { width: 600, height: 400 },
  schematic: divider.schematic,
  netlist: divider.netlist,
  detections: [
    ...divider.schematic.parts.map((p, i) => ({
      label: p.kind,
      confidence: i === 0 ? 0.31 : 0.93,
      box: [50 + i * 150, 50, 120 + i * 150, 110] as [number, number, number, number],
      part_id: p.id,
      value_text: '1k',
    })),
    { label: 'other', confidence: 0.7, box: [500, 300, 560, 360], part_id: null, value_text: null },
  ],
  warnings: [
    { code: 'low_confidence', message: 'Check these parts: the detector was unsure what they are.', part_ids: [ids[0]!] },
    { code: 'no_ground', message: 'No ground symbol was found.', part_ids: [] },
  ],
}

function fakeApi(recognize: Api['recognize']): Api {
  return { explain: vi.fn(), check: vi.fn(), listCircuits: vi.fn(async () => []), loadCircuit: vi.fn(), saveCircuit: vi.fn(), recognize }
}

async function openAndUpload(api: Api) {
  const user = userEvent.setup()
  render(<App solver={testSolver()} api={api} />)
  await user.click(screen.getByRole('button', { name: 'From photo' }))
  const photo = new File(['png'], 'circuit.png', { type: 'image/png' })
  await user.upload(screen.getByLabelText('Photo of a circuit'), photo)
  return { user, photo }
}

describe('Circuit from a photo', () => {
  it('shows what was recognized over the photo before touching the drawing', async () => {
    const recognize = vi.fn(async () => recognition)
    const { photo } = await openAndUpload(fakeApi(recognize))

    expect(recognize).toHaveBeenCalledWith(photo)
    const overlay = screen.getByRole('img', { name: 'Recognized symbols' })
    for (const id of ids) expect(within(overlay).getByTestId(`detected-${id}`)).toBeTruthy()
    expect(overlay.textContent).toContain('unsupported')
    expect(screen.getByRole('dialog').textContent).toContain(`Found ${ids.length} parts`)
    expect(screen.getByRole('dialog').textContent).toContain('No ground symbol was found.')
    // The starter circuit is still in the editor until Load is pressed.
    expect(screen.getByTestId('part-R2')).toBeTruthy()
  })

  it('loads the circuit into the editor and lists what to check', async () => {
    const { user } = await openAndUpload(fakeApi(vi.fn(async () => recognition)))
    await user.click(screen.getByRole('button', { name: 'Load into editor' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    for (const id of ids) expect(screen.getByTestId(`part-${id}`)).toBeTruthy()
    const review = screen.getByRole('region', { name: 'Check the recognized circuit' })
    expect(review.textContent).toContain('the detector was unsure')

    // Naming a part in the review selects it for editing.
    await user.click(within(review).getByRole('button', { name: ids[0]! }))
    expect(screen.getByRole('region', { name: `${ids[0]} properties` })).toBeTruthy()

    // The recognized circuit solves like any drawn one.
    await user.click(screen.getByRole('button', { name: 'Solve' }))
    expect(screen.getByTestId('solve-status').textContent).toMatch(/Solved/)

    await user.click(within(review).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('region', { name: 'Check the recognized circuit' })).toBeNull()
  })

  it('explains failures, such as no model being installed', async () => {
    const recognize = vi.fn(async () => {
      throw new ApiError('Photo recognition is not available: no trained model is installed.', 503)
    })
    await openAndUpload(fakeApi(recognize))
    expect(screen.getByRole('alert').textContent).toContain('no trained model')
    expect(screen.queryByRole('button', { name: 'Load into editor' })).toBeNull()
  })
})
