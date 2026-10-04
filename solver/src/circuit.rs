//! Validation and compilation: [`Netlist`] (strings, user input) to
//! [`Circuit`] (integer node indices, known to be well-formed).
//!
//! This stage checks everything that does not depend on which analysis runs:
//! identifiers, values, and that ground is used. Structural checks (floating
//! nodes, voltage-source loops) depend on the analysis, since a capacitor is
//! an open circuit at DC but connects its nodes in a transient run, so they
//! run on the analysis's network in `mna.rs`.

use std::collections::{HashMap, HashSet};

use crate::error::SolverError;
use crate::netlist::{Component, NETLIST_VERSION, Netlist};

/// Index of a non-ground node in the MNA unknown vector, or `None` for ground.
/// Ground has no row or column in the system (its voltage is fixed at 0), so
/// representing it as `None` makes the stamping code skip it naturally.
pub(crate) type Node = Option<usize>;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ElementKind {
    Resistor {
        a: Node,
        b: Node,
        ohms: f64,
    },
    VoltageSource {
        pos: Node,
        neg: Node,
        volts: f64,
    },
    CurrentSource {
        from: Node,
        to: Node,
        amps: f64,
    },
    Capacitor {
        a: Node,
        b: Node,
        farads: f64,
        initial_voltage: f64,
    },
    Inductor {
        a: Node,
        b: Node,
        henries: f64,
        initial_current: f64,
    },
}

impl ElementKind {
    /// The (first, second) terminals, which define the sign of the current.
    pub fn terminals(&self) -> (Node, Node) {
        match *self {
            ElementKind::Resistor { a, b, .. }
            | ElementKind::Capacitor { a, b, .. }
            | ElementKind::Inductor { a, b, .. } => (a, b),
            ElementKind::VoltageSource { pos, neg, .. } => (pos, neg),
            ElementKind::CurrentSource { from, to, .. } => (from, to),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Element {
    pub id: String,
    pub kind: ElementKind,
}

/// A validated circuit with integer node indices.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Circuit {
    pub ground: String,
    /// Names of the non-ground nodes; `node_names[i]` is node index `i`.
    pub node_names: Vec<String>,
    pub elements: Vec<Element>,
}

impl Circuit {
    pub fn compile(netlist: &Netlist) -> Result<Self, SolverError> {
        if netlist.version != NETLIST_VERSION {
            return Err(SolverError::UnsupportedVersion {
                found: netlist.version,
                supported: NETLIST_VERSION,
            });
        }
        if netlist.components.is_empty() {
            return Err(SolverError::EmptyCircuit);
        }
        check_components(&netlist.components)?;

        let ground = netlist.ground.as_str();
        let touches_ground = netlist.components.iter().any(|c| {
            let (t1, t2) = c.terminals();
            t1 == ground || t2 == ground
        });
        if !touches_ground {
            return Err(SolverError::MissingGround {
                ground: ground.to_string(),
            });
        }

        // Intern node names in order of first appearance, so node numbering
        // (and therefore the matrix layout) is deterministic.
        let mut index: HashMap<String, usize> = HashMap::new();
        let mut node_names: Vec<String> = Vec::new();
        let mut node = |name: &str| -> Node {
            if name == ground {
                return None;
            }
            let next = node_names.len();
            let i = *index.entry(name.to_string()).or_insert(next);
            if i == next {
                node_names.push(name.to_string());
            }
            Some(i)
        };

        let elements = netlist
            .components
            .iter()
            .map(|c| {
                let kind = match c {
                    Component::Resistor { a, b, value, .. } => ElementKind::Resistor {
                        a: node(a),
                        b: node(b),
                        ohms: *value,
                    },
                    Component::VoltageSource {
                        pos, neg, value, ..
                    } => ElementKind::VoltageSource {
                        pos: node(pos),
                        neg: node(neg),
                        volts: *value,
                    },
                    Component::CurrentSource {
                        from, to, value, ..
                    } => ElementKind::CurrentSource {
                        from: node(from),
                        to: node(to),
                        amps: *value,
                    },
                    Component::Capacitor {
                        a,
                        b,
                        value,
                        initial_voltage,
                        ..
                    } => ElementKind::Capacitor {
                        a: node(a),
                        b: node(b),
                        farads: *value,
                        initial_voltage: *initial_voltage,
                    },
                    Component::Inductor {
                        a,
                        b,
                        value,
                        initial_current,
                        ..
                    } => ElementKind::Inductor {
                        a: node(a),
                        b: node(b),
                        henries: *value,
                        initial_current: *initial_current,
                    },
                };
                Element {
                    id: c.id().to_string(),
                    kind,
                }
            })
            .collect();

        Ok(Circuit {
            ground: ground.to_string(),
            node_names,
            elements,
        })
    }

    pub fn node_count(&self) -> usize {
        self.node_names.len()
    }
}

/// Per-component checks that need no knowledge of the rest of the circuit.
fn check_components(components: &[Component]) -> Result<(), SolverError> {
    let mut seen_ids = HashSet::new();
    for c in components {
        let id = c.id();
        if id.is_empty() {
            return Err(SolverError::EmptyId);
        }
        if !seen_ids.insert(id) {
            return Err(SolverError::DuplicateId { id: id.to_string() });
        }
        let (t1, t2) = c.terminals();
        if t1.is_empty() || t2.is_empty() {
            return Err(SolverError::EmptyNodeName { id: id.to_string() });
        }
        if t1 == t2 {
            return Err(SolverError::ShortedComponent {
                id: id.to_string(),
                node: t1.to_string(),
            });
        }
        let invalid = |reason: String| SolverError::InvalidValue {
            id: id.to_string(),
            reason,
        };
        let value = c.value();
        if !value.is_finite() {
            return Err(invalid(format!(
                "value must be a finite number, got {value}"
            )));
        }
        let positive = |quantity: &str, unit: &str| {
            if value > 0.0 {
                Ok(())
            } else {
                Err(invalid(format!(
                    "{quantity} must be greater than 0 {unit}, got {value}"
                )))
            }
        };
        match c {
            Component::Resistor { .. } => positive("resistance", "ohms")?,
            Component::Capacitor {
                initial_voltage, ..
            } => {
                positive("capacitance", "farads")?;
                if !initial_voltage.is_finite() {
                    return Err(invalid("initial voltage must be a finite number".into()));
                }
            }
            Component::Inductor {
                initial_current, ..
            } => {
                positive("inductance", "henries")?;
                if !initial_current.is_finite() {
                    return Err(invalid("initial current must be a finite number".into()));
                }
            }
            Component::VoltageSource { .. } | Component::CurrentSource { .. } => {}
        }
    }
    Ok(())
}
