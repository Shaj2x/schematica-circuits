//! The netlist JSON format: the contract shared by the editor, the CV
//! pipeline, the backend and this solver. The full specification, with
//! examples, lives in `docs/netlist-format.md`.
//!
//! Conventions used throughout:
//! - All values are plain numbers in SI base units (ohms, volts, amperes).
//!   Parsing text like "4.7k" belongs to the edges (UI, OCR), never here.
//! - Nodes are named by strings. A node exists because some terminal names it;
//!   there is no separate node list to keep in sync.
//! - Every component reports one branch current, positive when current flows
//!   from its first terminal to its second *through the component*.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The netlist format version this solver understands.
pub const NETLIST_VERSION: u32 = 1;

/// A circuit description: what the solver takes as input.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Netlist {
    /// Format version, so old saved circuits fail loudly instead of being
    /// misread if the format ever changes.
    pub version: u32,
    /// Name of the reference node (0 V). It must be explicit: guessing ground
    /// would silently change every reported voltage.
    pub ground: String,
    pub components: Vec<Component>,
}

/// One circuit element. Terminals are named per kind (`a`/`b`, `pos`/`neg`,
/// `from`/`to`) rather than stored in an anonymous array, so polarity can be
/// read straight off the JSON.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Component {
    /// A linear resistor, `value` in ohms (must be > 0).
    /// Branch current is positive flowing from `a` to `b`.
    Resistor {
        id: String,
        a: String,
        b: String,
        value: f64,
    },
    /// An ideal independent voltage source enforcing `v(pos) - v(neg) = value`.
    /// Branch current is positive flowing from `pos` to `neg` *through the
    /// source* (the SPICE convention), so a source that is delivering power
    /// reports a negative current.
    VoltageSource {
        id: String,
        pos: String,
        neg: String,
        value: f64,
    },
    /// An ideal independent current source pushing `value` amperes from
    /// `from` to `to` through the source: it draws current out of node `from`
    /// and injects it into node `to`.
    CurrentSource {
        id: String,
        from: String,
        to: String,
        value: f64,
    },
    /// A linear capacitor, `value` in farads (must be > 0). Open circuit in
    /// DC analysis. `initial_voltage` is v(a) - v(b) at t = 0 in a transient
    /// run, defaulting to 0 (uncharged). Branch current is positive from `a`
    /// to `b`.
    Capacitor {
        id: String,
        a: String,
        b: String,
        value: f64,
        #[serde(default)]
        initial_voltage: f64,
    },
    /// A linear inductor, `value` in henries (must be > 0). Short circuit in
    /// DC analysis. `initial_current` is the current from `a` to `b` at t = 0
    /// in a transient run, defaulting to 0. Branch current is positive from
    /// `a` to `b`.
    Inductor {
        id: String,
        a: String,
        b: String,
        value: f64,
        #[serde(default)]
        initial_current: f64,
    },
}

impl Component {
    pub fn id(&self) -> &str {
        match self {
            Component::Resistor { id, .. }
            | Component::VoltageSource { id, .. }
            | Component::CurrentSource { id, .. }
            | Component::Capacitor { id, .. }
            | Component::Inductor { id, .. } => id,
        }
    }

    /// The (first, second) terminals, in the order that defines the sign of
    /// the branch current.
    pub fn terminals(&self) -> (&str, &str) {
        match self {
            Component::Resistor { a, b, .. }
            | Component::Capacitor { a, b, .. }
            | Component::Inductor { a, b, .. } => (a, b),
            Component::VoltageSource { pos, neg, .. } => (pos, neg),
            Component::CurrentSource { from, to, .. } => (from, to),
        }
    }

    pub fn value(&self) -> f64 {
        match self {
            Component::Resistor { value, .. }
            | Component::VoltageSource { value, .. }
            | Component::CurrentSource { value, .. }
            | Component::Capacitor { value, .. }
            | Component::Inductor { value, .. } => *value,
        }
    }
}

/// The solver's output. `BTreeMap` keeps the JSON key order deterministic,
/// which makes results diffable and snapshot-testable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Solution {
    /// Voltage of every node relative to ground, in volts (ground included, at 0).
    pub node_voltages: BTreeMap<String, f64>,
    /// Current through every component by id, in amperes, signed per the
    /// component's terminal order (see [`Component`]).
    pub branch_currents: BTreeMap<String, f64>,
}

/// Settings for a transient (time-domain) analysis. Kept separate from the
/// netlist: the netlist describes the circuit, this describes the question
/// being asked about it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransientOptions {
    /// Simulate from t = 0 to this time, in seconds.
    pub stop_time: f64,
    /// Requested step, in seconds. The solver uses a fixed step, adjusted
    /// slightly so that a whole number of steps lands exactly on `stop_time`.
    pub time_step: f64,
    #[serde(default)]
    pub method: Integration,
}

/// How each time step approximates the derivatives in i = C dv/dt and
/// v = L di/dt.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Integration {
    /// Backward Euler: first-order accurate and strongly damped. Errors shrink
    /// in proportion to the time step, and oscillations die out faster than
    /// they should.
    BackwardEuler,
    /// Trapezoidal rule: second-order accurate and does not add artificial
    /// damping, so LC oscillations keep their amplitude. The SPICE default.
    #[default]
    Trapezoidal,
}

/// The result of a transient analysis, stored by column: one shared time
/// axis plus one array per signal, which is the shape a plot needs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransientSolution {
    /// Sample times in seconds, from 0 to `stop_time` inclusive.
    pub time: Vec<f64>,
    /// Voltage of every node at each sample time (ground included).
    pub node_voltages: BTreeMap<String, Vec<f64>>,
    /// Current through every component at each sample time, signed as in
    /// [`Solution::branch_currents`].
    pub branch_currents: BTreeMap<String, Vec<f64>>,
}
