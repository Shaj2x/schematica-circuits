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

## Errors

The solver rejects netlists it cannot solve, with a specific reason:

| Error | Cause |
|-------|-------|
| `Parse` | Malformed JSON, unknown `type`, missing field |
| `UnsupportedVersion` | `version` is not 1 |
| `EmptyCircuit` | No components |
| `EmptyId`, `EmptyNodeName`, `DuplicateId` | Bad identifiers |
| `InvalidValue` | Non-finite value, or resistance ≤ 0 |
| `ShortedComponent` | Both terminals on the same node (almost always a wiring mistake) |
| `MissingGround` | No component touches the ground node |
| `FloatingNodes` | Nodes with no path to ground through resistors or voltage sources (includes current sources in series) |
| `VoltageSourceLoop` | Voltage sources forming a closed loop (includes two in parallel) |
| `SingularMatrix` | Numerically degenerate input the structural checks cannot see |

Errors serialize as JSON tagged by `kind` (snake_case) with the variant's
fields, so a client can highlight what is wrong, for example
`{"kind": "floating_nodes", "nodes": ["x", "y"]}` or
`{"kind": "voltage_source_loop", "id": "V2"}`. The WebAssembly wrapper adds a
human-readable `message` and returns `{"ok": false, "error": {...}}`.

## Example netlists

`solver/tests/fixtures/*.json` holds 13 textbook circuits, each wrapping a
netlist with a description, a hand derivation and the expected output.
