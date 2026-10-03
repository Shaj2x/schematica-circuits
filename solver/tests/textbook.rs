//! Textbook circuits with hand-derived answers. Each fixture in
//! `tests/fixtures/` carries its own derivation, and doubles as an example
//! netlist for the frontend and backend tests in later phases.

mod common;

use common::{assert_kcl, assert_matches_expected, assert_power_balance, load_fixture};

/// One `#[test]` per fixture, so a failure names the circuit. Fixtures are
/// embedded with `include_str!` so the tests work from any directory.
macro_rules! fixture_tests {
    ($($name:ident),* $(,)?) => {
        $(
            #[test]
            fn $name() {
                let fixture = load_fixture(include_str!(concat!(
                    "fixtures/",
                    stringify!($name),
                    ".json"
                )));
                assert_eq!(fixture.name, stringify!($name), "fixture name matches file name");
                let solution = schematica_solver::solve(&fixture.netlist)
                    .unwrap_or_else(|e| panic!("{} failed to solve: {e}", fixture.name));
                assert_matches_expected(&fixture, &solution);
                assert_kcl(&fixture.netlist, &solution);
                assert_power_balance(&fixture.netlist, &solution);
            }
        )*
    };
}

fixture_tests!(
    voltage_divider_equal,
    voltage_divider_unequal,
    series_parallel,
    current_divider,
    wheatstone_balanced,
    wheatstone_unbalanced,
    two_voltage_sources,
    floating_voltage_source,
    current_source_network,
    mixed_sources,
    r2r_ladder,
    two_node_two_sources,
    negative_source_values,
);

/// Reordering components must not change the physics.
/// This guards against bugs tied to node numbering or matrix layout.
#[test]
fn result_is_independent_of_component_order() {
    let fixture = load_fixture(include_str!("fixtures/two_node_two_sources.json"));
    let mut reversed = fixture.netlist.clone();
    reversed.components.reverse();
    let solution = schematica_solver::solve(&reversed).unwrap();
    assert_matches_expected(&fixture, &solution);
}

/// Netlists and solutions survive serialize -> parse bit-for-bit. This needs
/// serde_json's `float_roundtrip` feature; the default float parser can be
/// off by one unit in the last place.
#[test]
fn netlist_json_round_trips() {
    let fixture = load_fixture(include_str!("fixtures/mixed_sources.json"));
    let json = serde_json::to_string(&fixture.netlist).unwrap();
    assert_eq!(
        schematica_solver::parse_netlist(&json).unwrap(),
        fixture.netlist
    );

    let solution = schematica_solver::solve_json(&json).unwrap();
    let solution_json = serde_json::to_string(&solution).unwrap();
    let parsed: schematica_solver::Solution = serde_json::from_str(&solution_json).unwrap();
    assert_eq!(parsed, solution);
}
