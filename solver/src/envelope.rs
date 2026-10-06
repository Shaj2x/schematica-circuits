//! The result envelope every binding returns across a language boundary.
//!
//! `{"ok": true, "solution": ...}` on success, or
//! `{"ok": false, "error": {"kind": "...", "message": "...", ...}}` on
//! failure, where the error carries the fields of its `SolverError` variant
//! plus a human-readable `message`.
//!
//! It lives in the core crate so the WebAssembly and Python bindings return
//! byte-for-byte the same shape: the browser and the backend can never
//! disagree about what an error looks like.

use serde::Serialize;
use serde_json::{Value, json};

use crate::SolverError;

pub fn envelope<T: Serialize>(result: Result<T, SolverError>) -> Value {
    match result {
        Ok(solution) => json!({ "ok": true, "solution": solution }),
        Err(error) => {
            let mut detail = serde_json::to_value(&error).expect("errors always serialize");
            detail["message"] = Value::String(error.to_string());
            json!({ "ok": false, "error": detail })
        }
    }
}

/// Parses and solves a DC netlist, returning the envelope as a JSON string.
pub fn solve_envelope(netlist_json: &str) -> String {
    envelope(crate::solve_json(netlist_json)).to_string()
}

/// Parses and runs a transient analysis, returning the envelope as a JSON string.
pub fn solve_transient_envelope(netlist_json: &str, options_json: &str) -> String {
    envelope(crate::solve_transient_json(netlist_json, options_json)).to_string()
}
