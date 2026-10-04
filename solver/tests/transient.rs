//! Transient analysis checked against closed-form solutions.
//!
//! Every circuit here has a textbook analytical answer (RC and RL first-order
//! responses, an underdamped RLC step response, an ideal LC oscillator), so
//! the simulation is compared with exact values rather than with another
//! simulator. The convergence tests also check *how* the error shrinks with
//! the step size, which is what distinguishes a correct first-order method
//! (backward Euler) from a correct second-order one (trapezoidal).

use schematica_solver::{
    Integration, Netlist, SolverError, TransientOptions, TransientSolution, parse_netlist, solve,
    solve_transient, solve_transient_json,
};
use serde_json::{Value, json};

fn netlist(components: Value) -> Netlist {
    parse_netlist(&json!({ "version": 1, "ground": "gnd", "components": components }).to_string())
        .unwrap()
}

fn run(
    netlist: &Netlist,
    stop_time: f64,
    time_step: f64,
    method: Integration,
) -> TransientSolution {
    solve_transient(
        netlist,
        &TransientOptions {
            stop_time,
            time_step,
            method,
        },
    )
    .unwrap()
}

/// Largest |simulated - exact| over all samples of one signal.
fn max_error(time: &[f64], simulated: &[f64], exact: impl Fn(f64) -> f64) -> f64 {
    time.iter()
        .zip(simulated)
        .map(|(&t, &y)| (y - exact(t)).abs())
        .fold(0.0, f64::max)
}

const TAU: f64 = 1e-3;

/// 5 V step into R = 1 kΩ and C = 1 µF (τ = RC = 1 ms), capacitor uncharged.
fn rc_charging() -> Netlist {
    netlist(json!([
        { "id": "V1", "type": "voltage_source", "pos": "in", "neg": "gnd", "value": 5 },
        { "id": "R1", "type": "resistor", "a": "in", "b": "out", "value": 1000 },
        { "id": "C1", "type": "capacitor", "a": "out", "b": "gnd", "value": 1e-6 }
    ]))
}

fn rc_exact(t: f64) -> f64 {
    5.0 * (1.0 - (-t / TAU).exp())
}

#[test]
fn rc_charging_matches_exponential() {
    for (method, tolerance) in [
        (Integration::Trapezoidal, 5e-5),
        (Integration::BackwardEuler, 2e-2),
    ] {
        let out = run(&rc_charging(), 5.0 * TAU, TAU / 100.0, method);
        let err = max_error(&out.time, &out.node_voltages["out"], rc_exact);
        assert!(err < tolerance, "{method:?}: max error {err} V");

        // Capacitor current i = C dv/dt = (5 V / 1 kΩ) e^(-t/τ).
        let i_err = max_error(&out.time, &out.branch_currents["C1"], |t| {
            5e-3 * (-t / TAU).exp()
        });
        assert!(
            i_err < tolerance * 1e-3 * 4.0,
            "{method:?}: current error {i_err} A"
        );
    }
}

#[test]
fn error_shrinks_at_the_expected_order() {
    // Halving the step should halve backward Euler's error (first order) and
    // quarter the trapezoidal rule's error (second order).
    for (method, expected_ratio) in [
        (Integration::BackwardEuler, 2.0),
        (Integration::Trapezoidal, 4.0),
    ] {
        let err = |h: f64| {
            let out = run(&rc_charging(), 5.0 * TAU, h, method);
            max_error(&out.time, &out.node_voltages["out"], rc_exact)
        };
        let ratio = err(TAU / 50.0) / err(TAU / 100.0);
        assert!(
            (ratio - expected_ratio).abs() < 0.15 * expected_ratio,
            "{method:?}: error ratio {ratio}, expected about {expected_ratio}"
        );
    }
}

#[test]
fn rc_discharge_from_initial_voltage() {
    // A capacitor charged to 10 V discharging through 1 kΩ: v = 10 e^(-t/τ).
    let circuit = netlist(json!([
        { "id": "C1", "type": "capacitor", "a": "n", "b": "gnd", "value": 1e-6, "initial_voltage": 10 },
        { "id": "R1", "type": "resistor", "a": "n", "b": "gnd", "value": 1000 }
    ]));
    let out = run(&circuit, 5.0 * TAU, TAU / 200.0, Integration::Trapezoidal);
    assert_eq!(
        out.node_voltages["n"][0], 10.0,
        "starts at the initial voltage"
    );
    let err = max_error(&out.time, &out.node_voltages["n"], |t| {
        10.0 * (-t / TAU).exp()
    });
    assert!(err < 5e-5, "max error {err} V");
}

#[test]
fn rl_current_rises_exponentially() {
    // 10 V into R = 10 Ω and L = 10 mH (τ = L/R = 1 ms): i = 1 A (1 - e^(-t/τ)).
    let circuit = netlist(json!([
        { "id": "V1", "type": "voltage_source", "pos": "in", "neg": "gnd", "value": 10 },
        { "id": "R1", "type": "resistor", "a": "in", "b": "n", "value": 10 },
        { "id": "L1", "type": "inductor", "a": "n", "b": "gnd", "value": 10e-3 }
    ]));
    let out = run(&circuit, 5.0 * TAU, TAU / 100.0, Integration::Trapezoidal);
    let err = max_error(&out.time, &out.branch_currents["L1"], |t| {
        1.0 - (-t / TAU).exp()
    });
    assert!(err < 2e-5, "max error {err} A");
    // At t = 0 the inductor blocks current, so all 10 V appear across it.
    assert!((out.node_voltages["n"][0] - 10.0).abs() < 1e-12);
}

#[test]
fn underdamped_rlc_step_response() {
    // Series RLC with R = 10 Ω, L = 1 mH, C = 1 µF driven by a 1 V step.
    // α = R/2L = 5000 /s, ω0 = 1/√(LC) ≈ 31 623 rad/s, ωd = √(ω0² − α²).
    // v_C(t) = 1 − e^(−αt) (cos ωd t + (α/ωd) sin ωd t).
    let circuit = netlist(json!([
        { "id": "V1", "type": "voltage_source", "pos": "in", "neg": "gnd", "value": 1 },
        { "id": "R1", "type": "resistor", "a": "in", "b": "x", "value": 10 },
        { "id": "L1", "type": "inductor", "a": "x", "b": "y", "value": 1e-3 },
        { "id": "C1", "type": "capacitor", "a": "y", "b": "gnd", "value": 1e-6 }
    ]));
    let alpha: f64 = 5000.0;
    let wd = (1e9 - alpha * alpha).sqrt();
    let exact = |t: f64| 1.0 - (-alpha * t).exp() * ((wd * t).cos() + alpha / wd * (wd * t).sin());

    let out = run(&circuit, 1e-3, 1e-7, Integration::Trapezoidal);
    let err = max_error(&out.time, &out.node_voltages["y"], exact);
    assert!(err < 1e-4, "max error {err} V");

    // It really is underdamped: the first peak overshoots 1 V by about
    // e^(−απ/ωd) ≈ 60%.
    let peak = out.node_voltages["y"]
        .iter()
        .cloned()
        .fold(f64::MIN, f64::max);
    let overshoot = (-alpha * std::f64::consts::PI / wd).exp();
    assert!((peak - (1.0 + overshoot)).abs() < 1e-3, "peak {peak}");
}

#[test]
fn trapezoidal_conserves_lc_energy_and_backward_euler_damps_it() {
    // An ideal LC tank (1 mH, 1 µF) starting with 1 V on the capacitor has
    // no resistance, so its energy ½Cv² + ½Li² should stay constant. The
    // trapezoidal rule preserves it exactly for linear circuits; backward
    // Euler adds numerical damping and the oscillation dies away. This is why
    // SPICE defaults to the trapezoidal rule.
    let circuit = netlist(json!([
        { "id": "C1", "type": "capacitor", "a": "n", "b": "gnd", "value": 1e-6, "initial_voltage": 1 },
        { "id": "L1", "type": "inductor", "a": "n", "b": "gnd", "value": 1e-3 }
    ]));
    let period = 2.0 * std::f64::consts::PI * (1e-3_f64 * 1e-6).sqrt();
    let energy = |out: &TransientSolution, k: usize| {
        let v = out.node_voltages["n"][k];
        let i = out.branch_currents["L1"][k];
        0.5 * 1e-6 * v * v + 0.5 * 1e-3 * i * i
    };

    let tr = run(
        &circuit,
        10.0 * period,
        period / 100.0,
        Integration::Trapezoidal,
    );
    let e0 = energy(&tr, 0);
    for k in 0..tr.time.len() {
        assert!(
            (energy(&tr, k) - e0).abs() < 1e-9 * e0,
            "energy drifted at step {k}"
        );
    }

    let be = run(
        &circuit,
        10.0 * period,
        period / 100.0,
        Integration::BackwardEuler,
    );
    let last = be.time.len() - 1;
    assert!(
        energy(&be, last) < 0.1 * e0,
        "backward Euler should lose most of the energy"
    );
}

#[test]
fn settles_to_the_dc_solution() {
    // Divider with a capacitor on the output: after many time constants the
    // transient result must equal the DC operating point.
    let circuit = netlist(json!([
        { "id": "V1", "type": "voltage_source", "pos": "in", "neg": "gnd", "value": 10 },
        { "id": "R1", "type": "resistor", "a": "in", "b": "out", "value": 1000 },
        { "id": "R2", "type": "resistor", "a": "out", "b": "gnd", "value": 1000 },
        { "id": "C1", "type": "capacitor", "a": "out", "b": "gnd", "value": 1e-6 },
        { "id": "L1", "type": "inductor", "a": "out", "b": "load", "value": 1e-3 },
        { "id": "R3", "type": "resistor", "a": "load", "b": "gnd", "value": 2000 }
    ]));
    let dc = solve(&circuit).unwrap();
    let out = run(&circuit, 30e-3, 1e-6, Integration::Trapezoidal);
    let last = out.time.len() - 1;
    for (node, &v) in &dc.node_voltages {
        assert!(
            (out.node_voltages[node][last] - v).abs() < 1e-6,
            "v({node})"
        );
    }
    for (id, &i) in &dc.branch_currents {
        assert!((out.branch_currents[id][last] - i).abs() < 1e-9, "i({id})");
    }
}

#[test]
fn kcl_holds_at_every_time_step() {
    let circuit = netlist(json!([
        { "id": "V1", "type": "voltage_source", "pos": "in", "neg": "gnd", "value": 1 },
        { "id": "R1", "type": "resistor", "a": "in", "b": "x", "value": 10 },
        { "id": "L1", "type": "inductor", "a": "x", "b": "y", "value": 1e-3 },
        { "id": "C1", "type": "capacitor", "a": "y", "b": "gnd", "value": 1e-6 },
        { "id": "R2", "type": "resistor", "a": "y", "b": "gnd", "value": 500 }
    ]));
    for method in [Integration::Trapezoidal, Integration::BackwardEuler] {
        let out = run(&circuit, 1e-3, 1e-6, method);
        for k in 0..out.time.len() {
            let i = |id: &str| out.branch_currents[id][k];
            // Node x: in through R1, out through L1. Node y: in through L1,
            // out through C1 and R2.
            assert!(
                (i("R1") - i("L1")).abs() < 1e-12,
                "{method:?} KCL at x, step {k}"
            );
            assert!(
                (i("L1") - i("C1") - i("R2")).abs() < 1e-12,
                "{method:?} KCL at y, step {k}"
            );
        }
    }
}

#[test]
fn inductor_across_a_source_ramps_linearly() {
    // v = L di/dt with v fixed at 2 V: i = (2 V / 1 mH)·t = 2000 A/s · t.
    // Both methods are exact here (the current is linear in t), and at DC
    // the same circuit is a short across a source, which DC reports.
    let circuit = netlist(json!([
        { "id": "V1", "type": "voltage_source", "pos": "a", "neg": "gnd", "value": 2 },
        { "id": "L1", "type": "inductor", "a": "a", "b": "gnd", "value": 1e-3 }
    ]));
    for method in [Integration::Trapezoidal, Integration::BackwardEuler] {
        let out = run(&circuit, 1e-3, 1e-5, method);
        let err = max_error(&out.time, &out.branch_currents["L1"], |t| 2000.0 * t);
        assert!(err < 1e-9, "{method:?}: error {err}");
    }
    assert_eq!(
        solve(&circuit).unwrap_err(),
        SolverError::VoltageSourceLoop { id: "L1".into() }
    );
}

#[test]
fn dc_treats_capacitors_as_open_and_inductors_as_short() {
    let circuit = netlist(json!([
        { "id": "V1", "type": "voltage_source", "pos": "in", "neg": "gnd", "value": 12 },
        { "id": "R1", "type": "resistor", "a": "in", "b": "a", "value": 1000 },
        { "id": "C1", "type": "capacitor", "a": "a", "b": "gnd", "value": 1e-6 },
        { "id": "L1", "type": "inductor", "a": "a", "b": "b", "value": 1e-3 },
        { "id": "R2", "type": "resistor", "a": "b", "b": "gnd", "value": 2000 }
    ]));
    let dc = solve(&circuit).unwrap();
    assert_eq!(dc.branch_currents["C1"], 0.0);
    // L1 shorts a to b, so R1 and R2 form a divider: 12 × 2/3 = 8 V.
    assert!((dc.node_voltages["a"] - 8.0).abs() < 1e-12);
    assert!((dc.node_voltages["b"] - 8.0).abs() < 1e-12);
    assert!((dc.branch_currents["L1"] - 4e-3).abs() < 1e-15);
}

#[test]
fn node_reached_only_through_a_capacitor_floats_at_dc_but_not_in_transient() {
    let circuit = netlist(json!([
        { "id": "V1", "type": "voltage_source", "pos": "in", "neg": "gnd", "value": 5 },
        { "id": "C1", "type": "capacitor", "a": "in", "b": "x", "value": 1e-6 },
        { "id": "C2", "type": "capacitor", "a": "x", "b": "gnd", "value": 1e-6 }
    ]));
    assert_eq!(
        solve(&circuit).unwrap_err(),
        SolverError::FloatingNodes {
            nodes: vec!["x".into()]
        }
    );
    // In a transient run the two capacitors form a divider, but the t = 0
    // state is undefined: an uncharged capacitor sits directly across the
    // source path (C1 and C2 together with V1 form a loop of sources).
    let err = solve_transient(
        &circuit,
        &TransientOptions {
            stop_time: 1e-3,
            time_step: 1e-5,
            method: Integration::Trapezoidal,
        },
    )
    .unwrap_err();
    assert_eq!(
        err,
        SolverError::UndefinedInitialState {
            cause: Box::new(SolverError::VoltageSourceLoop { id: "C2".into() })
        }
    );
}

#[test]
fn rejects_invalid_options() {
    let circuit = rc_charging();
    let cases = [
        (0.0, 1e-6, "stop time"),
        (1e-3, -1e-6, "time step"),
        (1e-3, f64::NAN, "time step"),
        (1e-3, 2e-3, "longer than the stop time"),
        (1.0, 1e-9, "the limit is 100000"),
    ];
    for (stop_time, time_step, expected) in cases {
        let err = solve_transient(
            &circuit,
            &TransientOptions {
                stop_time,
                time_step,
                method: Integration::Trapezoidal,
            },
        )
        .unwrap_err();
        match err {
            SolverError::InvalidAnalysis { reason } => {
                assert!(reason.contains(expected), "{reason}")
            }
            other => panic!("expected InvalidAnalysis, got {other:?}"),
        }
    }
}

#[test]
fn rejects_invalid_reactive_values() {
    for component in [
        json!({ "id": "C1", "type": "capacitor", "a": "a", "b": "gnd", "value": 0 }),
        json!({ "id": "C1", "type": "inductor", "a": "a", "b": "gnd", "value": -1e-3 }),
    ] {
        let circuit = netlist(json!([
            { "id": "R1", "type": "resistor", "a": "a", "b": "gnd", "value": 1 },
            component
        ]));
        assert!(matches!(solve(&circuit), Err(SolverError::InvalidValue { id, .. }) if id == "C1"));
    }
}

#[test]
fn step_is_adjusted_to_land_on_the_stop_time() {
    // 1 ms / 0.3 ms rounds to 3 steps of 1/3 ms.
    let out = run(&rc_charging(), 1e-3, 3e-4, Integration::Trapezoidal);
    assert_eq!(out.time.len(), 4);
    assert_eq!(*out.time.last().unwrap(), 1e-3);
    assert_eq!(out.node_voltages["gnd"], vec![0.0; 4]);
}

#[test]
fn json_api_defaults_to_trapezoidal() {
    let netlist_json = serde_json::to_string(&rc_charging()).unwrap();
    let options = json!({ "stop_time": 5e-3, "time_step": 1e-5 }).to_string();
    let out = solve_transient_json(&netlist_json, &options).unwrap();
    let err = max_error(&out.time, &out.node_voltages["out"], rc_exact);
    assert!(err < 5e-5, "trapezoidal accuracy expected, got error {err}");

    let bad = solve_transient_json(&netlist_json, r#"{ "stop_time": 1 }"#).unwrap_err();
    assert!(matches!(bad, SolverError::InvalidAnalysis { reason } if reason.contains("time_step")));
}
