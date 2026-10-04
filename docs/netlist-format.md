# Netlist format (version 1)

The netlist is the contract between every part of Schematica: the editor
produces it, the CV pipeline produces it from a photo, the backend stores it,
and the solver consumes it. This document is the specification. The Rust types
in `solver/src/netlist.rs` implement it.

## Input

```json
{
  "version": 1,
  "ground": "gnd",
  "components": [
    { "id": "V1", "type": "voltage_source", "pos": "in",  "neg": "gnd", "value": 10 },
    { "id": "R1", "type": "resistor",       "a":   "in",  "b":   "out", "value": 1000 },
    { "id": "R2", "type": "resistor",       "a":   "out", "b":   "gnd", "value": 1000 },
    { "id": "I1", "type": "current_source", "from": "gnd", "to": "out", "value": 0.001 }
  ]
}
```

| Field        | Type   | Meaning |
|--------------|--------|---------|
| `version`    | int    | Format version. Must be `1`. |
| `ground`     | string | Name of the 0 V reference node. At least one component must touch it. |
| `components` | array  | At least one component (below). |

### Components

Every component has a unique, non-empty `id`, a `type`, two terminals and a
`value`. Terminal values are node names: any non-empty string. A node exists
because a terminal names it, so there is no separate node list.

| `type`           | Terminals     | `value` (SI)       | Constraint |
|------------------|---------------|--------------------|------------|
| `resistor`       | `a`, `b`      | ohms, must be > 0  | Ohm's law |
| `voltage_source` | `pos`, `neg`  | volts, any sign    | v(pos) − v(neg) = value |
| `current_source` | `from`, `to`  | amperes, any sign  | pushes `value` A from `from` to `to` through the source |
| `capacitor`      | `a`, `b`      | farads, must be > 0  | i = C dv/dt; open circuit at DC |
| `inductor`       | `a`, `b`      | henries, must be > 0 | v = L di/dt; short circuit at DC |

Capacitors take an optional `initial_voltage` (v(a) − v(b) at t = 0) and
inductors an optional `initial_current` (from `a` to `b` at t = 0). Both
default to 0 and only affect transient analysis. They were added without
bumping `version`: every version-1 netlist written before them is still valid
and means the same thing.

Values are plain JSON numbers in base units: `4700`, not `"4.7k"`. Converting
engineering notation is the job of whatever produces the netlist (the editor
and OCR).

### Why terminals have names

An anonymous `"nodes": ["a", "b"]` array would be more uniform, but polarity
is where students and code both go wrong. With named terminals the meaning of
a current source's sign is in the JSON itself, and swapping two terminals is a
visible, reviewable change.

## Output

```json
{
  "node_voltages":   { "gnd": 0.0, "in": 10.0, "out": 5.5 },
  "branch_currents": { "I1": 0.001, "R1": 0.0045, "R2": 0.0055, "V1": -0.0045 }
}
```

- `node_voltages`: every node, ground included, in volts relative to ground.
- `branch_currents`: every component, in amperes. **Sign convention:** positive
  means current flows from the component's first terminal to its second
  *through the component* (`a`→`b`, `pos`→`neg`, `from`→`to`).

For a voltage source this is the SPICE convention: a source that is supplying
power reports a **negative** current, because conventional current leaves its
`pos` terminal into the circuit rather than entering it. With this convention,
`(v_first − v_second) × current` is the power a component *absorbs* for every
component type, so the absorbed powers of the whole circuit sum to zero
(Tellegen's theorem). The test suite checks this for every fixture.

Keys are emitted in sorted order, so output is deterministic and diffable.

## Transient analysis

A transient run takes the netlist plus separate options. The netlist describes
the circuit, and the options describe the question being asked about it:

```json
{ "stop_time": 0.005, "time_step": 5e-6, "method": "trapezoidal" }
```

| Field | Meaning |
|-------|---------|
| `stop_time` | Simulate from t = 0 to this time, in seconds (> 0). |
| `time_step` | Requested fixed step in seconds. It is adjusted slightly so that a whole number of steps ends exactly at `stop_time`. At most 100 000 steps. |
| `method` | `"trapezoidal"` (default, second order) or `"backward_euler"` (first order, strongly damped). |

The run starts from the initial conditions above, like a switch closing at
t = 0, rather than from a DC operating point. The output is stored by column:
one time axis and one array per signal, with the same sign conventions as DC.

```json
{
  "time": [0, 5e-6, 1e-5],
  "node_voltages": { "gnd": [0, 0, 0], "out": [0, 0.0249, 0.0497] },
  "branch_currents": { "C1": [0.005, 0.00498, 0.00495], "R1": [0.005, 0.00498, 0.00495] }
}
```

## Errors

The solver rejects netlists it cannot solve, with a specific reason:

| Error | Cause |
|-------|-------|
| `Parse` | Malformed JSON, unknown `type`, missing field |
| `UnsupportedVersion` | `version` is not 1 |
| `EmptyCircuit` | No components |
| `EmptyId`, `EmptyNodeName`, `DuplicateId` | Bad identifiers |
| `InvalidValue` | Non-finite value or initial condition, or R, C or L ≤ 0 |
| `ShortedComponent` | Both terminals on the same node (almost always a wiring mistake) |
| `MissingGround` | No component touches the ground node |
| `FloatingNodes` | Nodes with no path to ground that fixes their voltage (includes current sources in series, and at DC nodes reached only through capacitors) |
| `VoltageSourceLoop` | Voltage sources forming a closed loop (includes two in parallel, and at DC an inductor across a source) |
| `InvalidAnalysis` | Bad transient options (non-positive times, step longer than stop time, too many steps) |
| `UndefinedInitialState` | The t = 0 state has no unique solution, for example an uncharged capacitor directly across a source. Carries the underlying error as `cause`. |
| `SingularMatrix` | Numerically degenerate input the structural checks cannot see |

Errors serialize as JSON tagged by `kind` (snake_case) with the variant's
fields, so a client can highlight what is wrong, for example
`{"kind": "floating_nodes", "nodes": ["x", "y"]}` or
`{"kind": "voltage_source_loop", "id": "V2"}`. The WebAssembly wrapper adds a
human-readable `message` and returns `{"ok": false, "error": {...}}`.

## Example netlists

`solver/tests/fixtures/*.json` holds 13 textbook circuits, each wrapping a
netlist with a description, a hand derivation and the expected output.
