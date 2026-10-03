//! Every error the solver can report, triggered by a minimal circuit.

use schematica_solver::{Component, Netlist, SolverError, solve, solve_json};
use serde_json::json;

fn solve_value(netlist: serde_json::Value) -> Result<schematica_solver::Solution, SolverError> {
    solve_json(&netlist.to_string())
}

fn circuit(components: serde_json::Value) -> serde_json::Value {
    json!({ "version": 1, "ground": "gnd", "components": components })
}

#[test]
fn malformed_json_is_a_parse_error() {
    assert!(matches!(
        solve_json("{ not json"),
        Err(SolverError::Parse(_))
    ));
}

#[test]
fn unknown_component_type_is_a_parse_error() {
    let err = solve_value(circuit(json!([
        { "id": "D1", "type": "diode", "a": "x", "b": "gnd", "value": 0.7 }
    ])))
    .unwrap_err();
    assert!(matches!(err, SolverError::Parse(msg) if msg.contains("diode")));
}

#[test]
fn missing_terminal_field_is_a_parse_error() {
    let err = solve_value(circuit(json!([
        { "id": "R1", "type": "resistor", "a": "x", "value": 100 }
    ])))
    .unwrap_err();
    assert!(matches!(err, SolverError::Parse(msg) if msg.contains("`b`")));
}

#[test]
fn unsupported_version() {
    let err = solve_value(json!({ "version": 2, "ground": "gnd", "components": [] })).unwrap_err();
    assert_eq!(
        err,
        SolverError::UnsupportedVersion {
            found: 2,
            supported: 1
        }
    );
}

#[test]
fn empty_circuit() {
    assert_eq!(
        solve_value(circuit(json!([]))).unwrap_err(),
        SolverError::EmptyCircuit
    );
}

#[test]
fn missing_ground() {
    let err = solve_value(circuit(json!([
        { "id": "V1", "type": "voltage_source", "pos": "a", "neg": "b", "value": 5 },
        { "id": "R1", "type": "resistor", "a": "a", "b": "b", "value": 100 }
    ])))
    .unwrap_err();
    assert_eq!(err, SolverError::MissingGround("gnd".into()));
}

#[test]
fn floating_subcircuit() {
    // x-y form a loop of resistors with no connection to the grounded part.
    let err = solve_value(circuit(json!([
        { "id": "V1", "type": "voltage_source", "pos": "a", "neg": "gnd", "value": 5 },
        { "id": "R1", "type": "resistor", "a": "a", "b": "gnd", "value": 100 },
        { "id": "R2", "type": "resistor", "a": "x", "b": "y", "value": 100 },
        { "id": "R3", "type": "resistor", "a": "y", "b": "x", "value": 100 }
    ])))
    .unwrap_err();
    assert_eq!(
        err,
        SolverError::FloatingNodes {
            nodes: vec!["x".into(), "y".into()]
        }
    );
}

#[test]
fn dangling_node_reached_only_through_a_current_source() {
    // Node "x" is connected only by I1: its voltage could be anything.
    let err = solve_value(circuit(json!([
        { "id": "R1", "type": "resistor", "a": "a", "b": "gnd", "value": 100 },
        { "id": "I1", "type": "current_source", "from": "a", "to": "x", "value": 0.01 }
    ])))
    .unwrap_err();
    assert_eq!(
        err,
        SolverError::FloatingNodes {
            nodes: vec!["x".into()]
        }
    );
}

#[test]
fn current_sources_in_series() {
    // Two current sources in series: KCL at "mid" would force 1 mA = 2 mA,
    // and mid's voltage is undefined either way.
    let err = solve_value(circuit(json!([
        { "id": "I1", "type": "current_source", "from": "gnd", "to": "mid", "value": 0.001 },
        { "id": "I2", "type": "current_source", "from": "mid", "to": "out", "value": 0.002 },
        { "id": "R1", "type": "resistor", "a": "out", "b": "gnd", "value": 1000 }
    ])))
    .unwrap_err();
    assert_eq!(
        err,
        SolverError::FloatingNodes {
            nodes: vec!["mid".into()]
        }
    );
}

#[test]
fn voltage_sources_in_parallel() {
    let err = solve_value(circuit(json!([
        { "id": "V1", "type": "voltage_source", "pos": "a", "neg": "gnd", "value": 5 },
        { "id": "V2", "type": "voltage_source", "pos": "a", "neg": "gnd", "value": 3 },
        { "id": "R1", "type": "resistor", "a": "a", "b": "gnd", "value": 100 }
    ])))
    .unwrap_err();
    assert_eq!(err, SolverError::VoltageSourceLoop { id: "V2".into() });
}

#[test]
fn loop_of_three_voltage_sources() {
    let err = solve_value(circuit(json!([
        { "id": "V1", "type": "voltage_source", "pos": "a", "neg": "gnd", "value": 1 },
        { "id": "V2", "type": "voltage_source", "pos": "b", "neg": "a", "value": 1 },
        { "id": "R1", "type": "resistor", "a": "b", "b": "gnd", "value": 100 },
        { "id": "V3", "type": "voltage_source", "pos": "b", "neg": "gnd", "value": 2 }
    ])))
    .unwrap_err();
    assert_eq!(err, SolverError::VoltageSourceLoop { id: "V3".into() });
}

#[test]
fn shorted_component() {
    let err = solve_value(circuit(json!([
        { "id": "V1", "type": "voltage_source", "pos": "a", "neg": "gnd", "value": 5 },
        { "id": "R1", "type": "resistor", "a": "a", "b": "a", "value": 100 }
    ])))
    .unwrap_err();
    assert_eq!(
        err,
        SolverError::ShortedComponent {
            id: "R1".into(),
            node: "a".into()
        }
    );
}

#[test]
fn duplicate_ids() {
    let err = solve_value(circuit(json!([
        { "id": "R1", "type": "resistor", "a": "a", "b": "gnd", "value": 100 },
        { "id": "R1", "type": "resistor", "a": "a", "b": "gnd", "value": 200 }
    ])))
    .unwrap_err();
    assert_eq!(err, SolverError::DuplicateId("R1".into()));
}

#[test]
fn empty_id_and_node_names() {
    let err = solve_value(circuit(json!([
        { "id": "", "type": "resistor", "a": "a", "b": "gnd", "value": 100 }
    ])))
    .unwrap_err();
    assert_eq!(err, SolverError::EmptyId);

    let err = solve_value(circuit(json!([
        { "id": "R1", "type": "resistor", "a": "", "b": "gnd", "value": 100 }
    ])))
    .unwrap_err();
    assert_eq!(err, SolverError::EmptyNodeName { id: "R1".into() });
}

#[test]
fn non_positive_resistance() {
    for value in [0.0, -10.0] {
        let err = solve_value(circuit(json!([
            { "id": "R1", "type": "resistor", "a": "a", "b": "gnd", "value": value }
        ])))
        .unwrap_err();
        assert!(matches!(err, SolverError::InvalidValue { id, .. } if id == "R1"));
    }
}

#[test]
fn non_finite_value() {
    // JSON cannot express NaN or infinity, but Rust callers (and the WASM
    // wrapper) can construct one directly.
    let netlist = Netlist {
        version: 1,
        ground: "gnd".into(),
        components: vec![
            Component::VoltageSource {
                id: "V1".into(),
                pos: "a".into(),
                neg: "gnd".into(),
                value: f64::NAN,
            },
            Component::Resistor {
                id: "R1".into(),
                a: "a".into(),
                b: "gnd".into(),
                value: 1.0,
            },
        ],
    };
    assert!(matches!(solve(&netlist), Err(SolverError::InvalidValue { id, .. }) if id == "V1"));
}

#[test]
fn ill_conditioned_matrix_is_reported_not_returned_as_garbage() {
    // Structurally fine, but 1e-300 Ω next to 1 Ω makes the conductances span
    // 300 orders of magnitude, far beyond double precision. Elimination
    // cancels R2's conductance completely, leaving a zero pivot. The solver
    // must fail cleanly rather than return infinities or NaNs.
    let err = solve_value(circuit(json!([
        { "id": "I1", "type": "current_source", "from": "gnd", "to": "a", "value": 1 },
        { "id": "R1", "type": "resistor", "a": "a", "b": "b", "value": 1e-300 },
        { "id": "R2", "type": "resistor", "a": "b", "b": "gnd", "value": 1 }
    ])))
    .unwrap_err();
    assert_eq!(err, SolverError::SingularMatrix);
}

#[test]
fn error_messages_name_the_problem() {
    let err = SolverError::FloatingNodes {
        nodes: vec!["x".into(), "y".into()],
    };
    assert_eq!(
        err.to_string(),
        "node(s) x, y have no path to ground through resistors or voltage sources, so their voltage is undefined"
    );
}
