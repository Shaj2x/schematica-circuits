//! DC circuit solver using Modified Nodal Analysis.

pub mod error;
pub mod netlist;

pub use error::SolverError;
pub use netlist::{Component, NETLIST_VERSION, Netlist, Solution};

#[allow(dead_code)] // wired up in the MNA commit
mod linalg;
#[allow(dead_code)] // wired up in the MNA commit
mod circuit;
