// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { testSolver } from './test/solver'

afterEach(cleanup)

/**
 * End-to-end through the UI: real reducer, real netlist derivation, real
 * WASM solver. The app opens on the voltage divider (10 V, 1 kΩ over 2 kΩ).
 */
function setup() {
  const user = userEvent.setup()
  render(<App solver={testSolver()} />)
  return { user }
}

const voltageRow = (node: string) =>
  within(screen.getByRole('table', { name: 'Node voltages' })).getByRole('row', { name: new RegExp(`^${node}\\b`) })

describe('App', () => {
  it('solves the starter circuit when Solve is pressed', async () => {
    const { user } = setup()
    expect(screen.queryByRole('table', { name: 'Node voltages' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Solve' }))

    expect(voltageRow('n1').textContent).toContain('10.0 V')
    expect(voltageRow('n2').textContent).toContain('6.67 V')
    expect(screen.getByTestId('solve-status').textContent).toMatch(/Solved 2 nodes in/)
  })

  it('shows current and its direction when hovering a part', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Solve' }))

    await user.hover(screen.getByTestId('part-R1'))

    expect(screen.getByRole('tooltip').textContent).toContain('R1: 3.33 mA')
    expect(screen.getByRole('tooltip').textContent).toContain('across: 3.33 V')
    expect(screen.getByTestId('current-arrow')).toBeTruthy()
  })

  it('shows the node voltage when hovering a wire', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Solve' }))

    await user.hover(screen.getByTestId('wire-W4'))

    expect(screen.getByRole('tooltip').textContent).toContain('6.67 V')
  })

  it('re-solves when a value is typed in engineering notation', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Solve' }))
    await user.click(screen.getByTestId('part-R2'))

    const input = screen.getByLabelText(/Value/)
    await user.clear(input)
    await user.type(input, '14k{Enter}')

    // 10 V × 14k / (1k + 14k)
    expect(voltageRow('n2').textContent).toContain('9.33 V')
  })

  it('re-solves live as the slider moves', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Solve' }))
    await user.click(screen.getByTestId('part-R2'))

    // The slider spans 0.1× to 10× of 2 kΩ; the top end is 20 kΩ.
    // jsdom cannot drag a range input, so set its position directly.
    fireEvent.change(screen.getByRole('slider'), { target: { value: '1' } })

    // 10 V × 20k / 21k
    expect(voltageRow('n2').textContent).toContain('9.52 V')
  })

  it('rejects a value it cannot read', async () => {
    const { user } = setup()
    await user.click(screen.getByTestId('part-R1'))
    const input = screen.getByLabelText(/Value/)
    await user.clear(input)
    await user.type(input, '4.7x{Enter}')

    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText(/Couldn’t read/)).toBeTruthy()
  })

  it('reverses a source and the solution follows', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Solve' }))
    await user.click(screen.getByTestId('part-V1'))
    await user.click(screen.getByRole('button', { name: 'Reverse polarity' }))

    expect(voltageRow('n1').textContent).toContain('-10.0 V')
    expect(voltageRow('n2').textContent).toContain('-6.67 V')
  })

  it('explains a missing ground instead of failing silently', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Solve' }))
    await user.click(screen.getByTestId('ground-G1'))
    await user.keyboard('{Delete}')

    expect(screen.getByRole('alert').textContent).toMatch(/Add a ground symbol/)
  })

  it('loads an example circuit', async () => {
    const { user } = setup()
    await user.selectOptions(screen.getByLabelText('Load an example circuit'), 'Wheatstone bridge')
    await user.click(screen.getByRole('button', { name: 'Solve' }))

    const currents = screen.getByRole('table', { name: 'Branch currents' })
    // Bridge current through R5 is 10/7 mA (fixture wheatstone_unbalanced).
    expect(within(currents).getByRole('row', { name: /^R5/ }).textContent).toContain('1.43 mA')
  })

  it('switches tools with keyboard shortcuts', async () => {
    const { user } = setup()
    await user.keyboard('w')
    expect(screen.getByRole('button', { name: /Wire/, pressed: true })).toBeTruthy()
    await user.keyboard('1')
    expect(screen.getByRole('button', { name: /Resistor/, pressed: true })).toBeTruthy()
  })
})
