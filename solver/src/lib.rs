//! # schematica-solver
//!
//! A circuit solver using Modified Nodal Analysis (MNA): DC operating point
//! and transient (time-domain) analysis of resistors, capacitors, inductors
//! and independent voltage and current sources.
//!
//! The pipeline has three stages, each in its own module:
//!
//! 1. [`netlist`]: the JSON contract (serde types for input and output).
//! 2. `circuit`: validation and compilation to integer node indices.
//! 3. `dc` and `transient`: each analysis turns elements into linear stamps.
//! 4. `mna` + `linalg`: graph checks on those stamps (which turn "singular
//!    matrix" into a useful message), assembly, and LU solve.
//!
//! ```
//! let json = r#"{
//!   "version": 1,
//!   "ground": "gnd",
//!   "components": [
//!     { "id": "V1", "type": "voltage_source", "pos": "in",  "neg": "gnd", "value": 10 },
//!     { "id": "R1", "type": "resistor",       "a":   "in",  "b":   "out", "value": 1000 },
//!     { "id": "R2", "type": "resistor",       "a":   "out", "b":   "gnd", "value": 1000 }
//!   ]
//! }"#;
//! let solution = schematica_solver::solve_json(json).unwrap();
//! assert!((solution.node_voltages["out"] - 5.0).abs() < 1e-12);
//! ```
//!
//! This crate has no WebAssembly or Python dependencies. Bindings are thin
//! wrappers in separate crates, so the browser and the backend run exactly
//! the same solver.

mod circuit;
mod dc;
pub mod envelope;
pub mod error;
mod graph;
mod linalg;
mod mna;
pub mod netlist;
mod transient;

pub use error::SolverError;
pub use netlist::{
    Component, Integration, NETLIST_VERSION, Netlist, Solution, TransientOptions, TransientSolution,
};
pub use transient::MAX_STEPS;

/// Validates and solves a netlist.
pub fn solve(netlist: &Netlist) -> Result<Solution, SolverError> {
    let circuit = circuit::Circuit::compile(netlist)?;
    dc::solve(&circuit)
}

/// Validates a netlist and simulates it over time, starting from the
/// components' initial conditions.
pub fn solve_transient(
    netlist: &Netlist,
    options: &TransientOptions,
) -> Result<TransientSolution, SolverError> {
    let circuit = circuit::Circuit::compile(netlist)?;
    transient::solve(&circuit, options)
}

/// Parses a netlist from JSON without solving it.
pub fn parse_netlist(json: &str) -> Result<Netlist, SolverError> {
    serde_json::from_str(json).map_err(|e| SolverError::Parse {
        message: e.to_string(),
    })
}

/// Parses a JSON netlist and solves it.
pub fn solve_json(json: &str) -> Result<Solution, SolverError> {
    solve(&parse_netlist(json)?)
}

/// Parses a JSON netlist and JSON transient options, and simulates.
pub fn solve_transient_json(
    netlist_json: &str,
    options_json: &str,
) -> Result<TransientSolution, SolverError> {
    let options: TransientOptions =
        serde_json::from_str(options_json).map_err(|e| SolverError::InvalidAnalysis {
            reason: e.to_string(),
        })?;
    solve_transient(&parse_netlist(netlist_json)?, &options)
}
