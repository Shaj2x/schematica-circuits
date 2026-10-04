//! WebAssembly bindings for `schematica-solver`.
//!
//! The boundary is deliberately narrow: one function that takes the netlist
//! as a JSON string and returns a JSON string. Why strings instead of passing
//! JS objects through `serde-wasm-bindgen`:
//! - The netlist is already a JSON contract, so this adds no new format.
//! - It needs no extra dependency, and the cost of serializing a circuit with
//!   tens of components is a few microseconds.
//! - The same envelope can be returned verbatim by the backend later.
//!
//! The function never throws. Errors come back inside the envelope, so the
//! TypeScript side can handle them with an ordinary discriminated union
//! instead of try/catch around every call.

use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

/// Solves a netlist given as JSON.
///
/// Returns `{"ok": true, "solution": {...}}` on success, or
/// `{"ok": false, "error": {"kind": "...", "message": "...", ...}}` where the
/// error carries the fields of the matching `SolverError` variant plus a
/// human-readable `message`.
#[wasm_bindgen]
pub fn solve(netlist_json: &str) -> String {
    envelope(schematica_solver::solve_json(netlist_json)).to_string()
}

/// The netlist format version this build understands.
#[wasm_bindgen(js_name = netlistVersion)]
pub fn netlist_version() -> u32 {
    schematica_solver::NETLIST_VERSION
}

fn envelope(result: Result<schematica_solver::Solution, schematica_solver::SolverError>) -> Value {
    match result {
        Ok(solution) => json!({ "ok": true, "solution": solution }),
        Err(error) => {
            let mut detail = serde_json::to_value(&error).expect("errors always serialize");
            detail["message"] = Value::String(error.to_string());
            json!({ "ok": false, "error": detail })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(netlist: Value) -> Value {
        serde_json::from_str(&solve(&netlist.to_string())).unwrap()
    }

    #[test]
    fn success_envelope() {
        let out = call(json!({
            "version": 1, "ground": "gnd",
            "components": [
                { "id": "V1", "type": "voltage_source", "pos": "a", "neg": "gnd", "value": 2 },
                { "id": "R1", "type": "resistor", "a": "a", "b": "gnd", "value": 4 }
            ]
        }));
        assert_eq!(out["ok"], true);
        assert_eq!(out["solution"]["node_voltages"]["a"], 2.0);
        assert_eq!(out["solution"]["branch_currents"]["R1"], 0.5);
    }

    #[test]
    fn error_envelope_has_kind_fields_and_message() {
        let out = call(json!({
            "version": 1, "ground": "gnd",
            "components": [
                { "id": "R1", "type": "resistor", "a": "a", "b": "gnd", "value": 4 },
                { "id": "I1", "type": "current_source", "from": "a", "to": "x", "value": 1 }
            ]
        }));
        assert_eq!(out["ok"], false);
        assert_eq!(out["error"]["kind"], "floating_nodes");
        assert_eq!(out["error"]["nodes"], json!(["x"]));
        assert!(
            out["error"]["message"]
                .as_str()
                .unwrap()
                .contains("no path to ground")
        );
    }

    #[test]
    fn malformed_json_is_an_error_not_a_panic() {
        let out: Value = serde_json::from_str(&solve("not json")).unwrap();
        assert_eq!(out["error"]["kind"], "parse");
    }
}
