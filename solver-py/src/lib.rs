//! Python bindings for `schematica-solver`, so the backend computes the
//! numbers it explains with exactly the code the browser runs.
//!
//! Like the WebAssembly binding, the boundary is JSON strings in and the
//! shared result envelope out (`schematica_solver::envelope`). The typed
//! Python API lives in `python/schematica_solver/__init__.py`.

use pyo3::prelude::*;
use schematica_solver::envelope;

/// Solves a DC netlist given as JSON; returns the result envelope as JSON.
///
/// The solve releases the GIL, so other Python threads (other requests in a
/// threaded web server) keep running while it computes.
#[pyfunction]
fn solve(py: Python<'_>, netlist_json: &str) -> String {
    py.detach(|| envelope::solve_envelope(netlist_json))
}

/// Runs a transient analysis; returns the result envelope as JSON.
#[pyfunction]
fn solve_transient(py: Python<'_>, netlist_json: &str, options_json: &str) -> String {
    py.detach(|| envelope::solve_transient_envelope(netlist_json, options_json))
}

/// The netlist format version this build understands.
#[pyfunction]
fn netlist_version() -> u32 {
    schematica_solver::NETLIST_VERSION
}

#[pymodule]
fn _native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(solve, m)?)?;
    m.add_function(wrap_pyfunction!(solve_transient, m)?)?;
    m.add_function(wrap_pyfunction!(netlist_version, m)?)?;
    Ok(())
}
