//! Shared helpers for the integration tests.

use std::collections::{BTreeMap, HashMap};

use schematica_solver::{Netlist, Solution};
use serde::Deserialize;

/// A textbook circuit with hand-derived expected results.
#[derive(Debug, Deserialize)]
pub struct Fixture {
    pub name: String,
    #[allow(dead_code)]
    pub description: String,
    #[allow(dead_code)]
    pub derivation: String,
    pub netlist: Netlist,
    pub expected: Solution,
}

pub fn load_fixture(json: &str) -> Fixture {
    serde_json::from_str(json).expect("fixture JSON should parse")
}

/// Absolute tolerance plus a relative one, so the check is meaningful for
/// both milliamp currents and multi-volt node voltages.
pub fn assert_close(what: &str, actual: f64, expected: f64) {
    let tolerance = 1e-12 + 1e-9 * expected.abs();
    assert!(
        (actual - expected).abs() <= tolerance,
        "{what}: got {actual}, expected {expected}"
    );
}

/// Compares every expected value and also checks that the solver reports
/// exactly the expected set of nodes and components, no more and no fewer.
pub fn assert_matches_expected(fixture: &Fixture, solution: &Solution) {
    let keys = |m: &BTreeMap<String, f64>| m.keys().cloned().collect::<Vec<_>>();
    assert_eq!(
        keys(&solution.node_voltages),
        keys(&fixture.expected.node_voltages),
        "{}: node set differs",
        fixture.name
    );
    assert_eq!(
        keys(&solution.branch_currents),
        keys(&fixture.expected.branch_currents),
        "{}: component set differs",
        fixture.name
    );
    for (node, &expected) in &fixture.expected.node_voltages {
        assert_close(
            &format!("{}: v({node})", fixture.name),
            solution.node_voltages[node],
            expected,
        );
    }
    for (id, &expected) in &fixture.expected.branch_currents {
        assert_close(
            &format!("{}: i({id})", fixture.name),
            solution.branch_currents[id],
            expected,
        );
    }
}

/// Kirchhoff's current law: the currents leaving each node sum to zero.
/// A component with current I (first terminal to second, through the
/// component) takes I out of its first node and puts I into its second.
pub fn assert_kcl(netlist: &Netlist, solution: &Solution) {
    let mut leaving: HashMap<&str, f64> = HashMap::new();
    let mut scale: HashMap<&str, f64> = HashMap::new();
    for c in &netlist.components {
        let (t1, t2) = c.terminals();
        let i = solution.branch_currents[c.id()];
        *leaving.entry(t1).or_default() += i;
        *leaving.entry(t2).or_default() -= i;
        *scale.entry(t1).or_default() += i.abs();
        *scale.entry(t2).or_default() += i.abs();
    }
    for (node, sum) in leaving {
        assert!(
            sum.abs() <= 1e-12 + 1e-9 * scale[node],
            "KCL violated at node {node}: net current {sum}"
        );
    }
}

/// Tellegen's theorem: with the passive sign convention, the power absorbed
/// by all components sums to zero (sources supply exactly what the
/// resistors dissipate).
pub fn assert_power_balance(netlist: &Netlist, solution: &Solution) {
    let mut total = 0.0;
    let mut scale = 0.0;
    for c in &netlist.components {
        let (t1, t2) = c.terminals();
        let v = solution.node_voltages[t1] - solution.node_voltages[t2];
        let p = v * solution.branch_currents[c.id()];
        total += p;
        scale += p.abs();
    }
    assert!(
        total.abs() <= 1e-12 + 1e-9 * scale,
        "power does not balance: net {total} W"
    );
}
