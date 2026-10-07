// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { type Api, ApiError, type CheckResult, type Explanation } from '../api'
import { testSolver } from '../test/solver'

afterEach(cleanup)

const explanation: Explanation = {
  source: 'template',
  model: null,
  summary: 'Nodal analysis with 2 unknown node voltages.',
  steps: [{ title: 'KCL at node n2', detail: 'Currents leaving sum to zero.', equation: '(v(n2) − 10 V) / 1 kΩ + v(n2) / 2 kΩ = 0' }],
  unverified_numbers: [],
  note: null,
}

function fakeApi(overrides: Partial<Api> = {}): Api {
  return {
    explain: vi.fn(async () => ({ solution: { node_voltages: {}, branch_currents: {} }, explanation })),
    check: vi.fn(),
    listCircuits: vi.fn(async () => []),
    loadCircuit: vi.fn(),
    saveCircuit: vi.fn(),
    ...overrides,
  } as Api
}

function setup(api: Api) {
  const user = userEvent.setup()
  render(<App solver={testSolver()} api={api} />)
  return { user }
}

describe('Explain tab', () => {
  it('requests an explanation for the drawn circuit and shows the steps', async () => {
    const api = fakeApi()
    const { user } = setup(api)
    await user.click(screen.getByRole('tab', { name: 'Explain' }))
    await user.click(screen.getByRole('button', { name: 'Explain step by step' }))

    const panel = screen.getByRole('region', { name: 'Explanation' })
    expect(within(panel).getByText('1. KCL at node n2')).toBeTruthy()
    expect(within(panel).getByText('(v(n2) − 10 V) / 1 kΩ + v(n2) / 2 kΩ = 0')).toBeTruthy()
    expect(within(panel).getByText('Standard working')).toBeTruthy()
    // The netlist sent is the one derived from the starter divider.
    const [netlist] = vi.mocked(api.explain).mock.calls[0]!
    expect(netlist.components.map((c) => c.id)).toEqual(['V1', 'R1', 'R2'])
  })

  it('flags unverified numbers from a model-written explanation', async () => {
    const api = fakeApi({
      explain: vi.fn(async () => ({
        solution: { node_voltages: {}, branch_currents: {} },
        explanation: { ...explanation, source: 'claude' as const, unverified_numbers: ['6.5 V'] },
      })),
    })
    const { user } = setup(api)
    await user.click(screen.getByRole('tab', { name: 'Explain' }))
    await user.click(screen.getByRole('button', { name: 'Explain step by step' }))
    expect(screen.getByText('Written by Claude')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('6.5 V')
  })

  it('explains when the server cannot be reached', async () => {
    const api = fakeApi({
      explain: vi.fn(async () => {
        throw new ApiError('Could not reach the Schematica server. Is the backend running?', 0)
      }),
    })
    const { user } = setup(api)
    await user.click(screen.getByRole('tab', { name: 'Explain' }))
    await user.click(screen.getByRole('button', { name: 'Explain step by step' }))
    expect(screen.getByRole('alert').textContent).toMatch(/backend running/)
  })
})

describe('Check my work tab', () => {
  it('sends parsed answers and shows hints for the wrong ones', async () => {
    const result: CheckResult = {
      all_correct: false,
      results: [
        { kind: 'voltage', name: 'n2', label: 'v(n2)', submitted: 6.67, expected: 6.667, correct: true, hint: null },
        { kind: 'current', name: 'R1', label: 'i(R1)', submitted: 3.33, expected: 0.00333, correct: false, hint: 'Off by a factor of 10^3.' },
      ],
      feedback: { ...explanation, summary: '1 of 2 answers are correct.', steps: [] },
    }
    const api = fakeApi({ check: vi.fn(async () => result) })
    const { user } = setup(api)
    await user.click(screen.getByRole('tab', { name: 'Check my work' }))
    await user.type(screen.getByLabelText('Your value for v(n2)'), '6.67')
    await user.type(screen.getByLabelText('Your value for i(R1)'), '3.33')
    await user.click(screen.getByRole('button', { name: 'Check my answers' }))

    const [, answers] = vi.mocked(api.check).mock.calls[0]!
    expect(answers).toEqual({ node_voltages: { n2: 6.67 }, branch_currents: { R1: 3.33 } })
    expect(screen.getByLabelText('correct')).toBeTruthy()
    expect(screen.getByLabelText('incorrect')).toBeTruthy()
    expect(screen.getByText(/Off by a factor of 10\^3/)).toBeTruthy()
    expect(screen.getByText('1 of 2 answers are correct.')).toBeTruthy()
  })

  it('rejects unreadable values before calling the server', async () => {
    const api = fakeApi()
    const { user } = setup(api)
    await user.click(screen.getByRole('tab', { name: 'Check my work' }))
    await user.type(screen.getByLabelText('Your value for v(n2)'), 'six')
    await user.click(screen.getByRole('button', { name: 'Check my answers' }))
    expect(screen.getByLabelText('Your value for v(n2)').getAttribute('aria-invalid')).toBe('true')
    expect(api.check).not.toHaveBeenCalled()
  })
})

describe('Save and open', () => {
  it('saves the drawing with its netlist, then updates the same circuit', async () => {
    const saveCircuit = vi.fn(async (c: Parameters<Api['saveCircuit']>[0]) => ({
      id: 'c1',
      name: c.name,
      netlist: c.netlist,
      schematic: c.schematic,
      created_at: '',
      updated_at: '',
    }))
    const api = fakeApi({ saveCircuit })
    const { user } = setup(api)
    await user.type(screen.getByLabelText('Circuit name'), 'My divider')
    await user.click(screen.getByRole('button', { name: 'Save to server' }))
    expect(screen.getByRole('status').textContent).toBe('Saved “My divider”.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    const [first, second] = saveCircuit.mock.calls.map(([c]) => c)
    expect(first).toMatchObject({ id: undefined, name: 'My divider' })
    expect(first!.schematic.parts.map((p) => p.id)).toEqual(['V1', 'R1', 'R2'])
    expect(first!.netlist.components).toHaveLength(3)
    expect(second).toMatchObject({ id: 'c1' })
  })

  it('opens a saved circuit into the editor', async () => {
    const schematic = {
      parts: [{ id: 'R9', kind: 'resistor' as const, a: { x: 1, y: 1 }, b: { x: 3, y: 1 }, value: 220 }],
      wires: [],
      grounds: [],
    }
    const api = fakeApi({
      listCircuits: vi.fn(async () => [{ id: 'c9', name: 'Saved one', component_count: 1, updated_at: '' }]),
      loadCircuit: vi.fn(async () => ({
        id: 'c9',
        name: 'Saved one',
        netlist: { version: 1 as const, ground: 'gnd', components: [] },
        schematic,
        created_at: '',
        updated_at: '',
      })),
    })
    const { user } = setup(api)
    const select = screen.getByLabelText('Open a saved circuit')
    await user.click(select)
    await screen.findByRole('option', { name: 'Saved one (1 parts)' })
    await user.selectOptions(select, 'c9')
    expect(await screen.findByTestId('part-R9')).toBeTruthy()
    expect(screen.queryByTestId('part-V1')).toBeNull()
  })
})
