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
}

impl Component {
    pub fn id(&self) -> &str {
        match self {
            Component::Resistor { id, .. }
            | Component::VoltageSource { id, .. }
            | Component::CurrentSource { id, .. } => id,
        }
    }

    /// The (first, second) terminals, in the order that defines the sign of
    /// the branch current.
    pub fn terminals(&self) -> (&str, &str) {
        match self {
            Component::Resistor { a, b, .. } => (a, b),
            Component::VoltageSource { pos, neg, .. } => (pos, neg),
            Component::CurrentSource { from, to, .. } => (from, to),
        }
    }

    pub fn value(&self) -> f64 {
        match self {
            Component::Resistor { value, .. }
            | Component::VoltageSource { value, .. }
            | Component::CurrentSource { value, .. } => *value,
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
