//! # schematica-solver
//!
//! A DC circuit solver using Modified Nodal Analysis (MNA), supporting
//! resistors and independent voltage and current sources.
//!
//! The pipeline has three stages, each in its own module:
//!
//! 1. [`netlist`]: the JSON contract (serde types for input and output).
//! 2. `circuit`: validation and compilation to integer node indices, including
//!    the graph checks that turn "singular matrix" into a useful message.
//! 3. `mna` + `linalg`: assemble the MNA system and solve it with LU.
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
pub mod error;
mod linalg;
mod mna;
pub mod netlist;

pub use error::SolverError;
pub use netlist::{Component, NETLIST_VERSION, Netlist, Solution};

/// Validates and solves a netlist.
pub fn solve(netlist: &Netlist) -> Result<Solution, SolverError> {
    let circuit = circuit::Circuit::compile(netlist)?;
    mna::solve(&circuit)
}

/// Parses a netlist from JSON without solving it.
pub fn parse_netlist(json: &str) -> Result<Netlist, SolverError> {
    serde_json::from_str(json).map_err(|e| SolverError::Parse(e.to_string()))
}

/// Parses a JSON netlist and solves it.
pub fn solve_json(json: &str) -> Result<Solution, SolverError> {
    solve(&parse_netlist(json)?)
}
