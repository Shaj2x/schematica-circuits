import type { Tool } from '../schematic/editor'

export const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: 'select', label: 'Select', key: 'S' },
  { tool: 'wire', label: 'Wire', key: 'W' },
  { tool: 'resistor', label: 'Resistor', key: '1' },
  { tool: 'voltage_source', label: 'Voltage source', key: '2' },
  { tool: 'current_source', label: 'Current source', key: '3' },
  { tool: 'ground', label: 'Ground', key: 'G' },
]

/** Keyboard shortcut -> tool, shared with the global key handler. */
export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(
  TOOLS.map(({ key, tool }) => [key.toLowerCase(), tool]),
)
