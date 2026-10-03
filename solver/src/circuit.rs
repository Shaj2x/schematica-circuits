//! Validation and compilation: [`Netlist`] (strings, user input) to
//! [`Circuit`] (integer node indices, known to be well-formed).
//!
//! Keeping this separate from the MNA code means the numerics only ever see a
//! circuit that has already passed every structural check, and each half can
//! be tested on its own.

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
    /// `branch` is this source's index among voltage sources; its current is
    /// unknown number `node_count + branch` in the MNA system.
    VoltageSource {
        pos: Node,
        neg: Node,
        volts: f64,
        branch: usize,
    },
    CurrentSource {
        from: Node,
        to: Node,
        amps: f64,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Element {
    pub id: String,
    pub kind: ElementKind,
}

/// A validated circuit, ready for MNA.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Circuit {
    pub ground: String,
    /// Names of the non-ground nodes; `node_names[i]` is node index `i`.
    pub node_names: Vec<String>,
    pub elements: Vec<Element>,
    pub voltage_source_count: usize,
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
            return Err(SolverError::MissingGround(ground.to_string()));
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

        let mut elements = Vec::with_capacity(netlist.components.len());
        let mut voltage_source_count = 0;
        for c in &netlist.components {
            let kind = match c {
                Component::Resistor { a, b, value, .. } => ElementKind::Resistor {
                    a: node(a),
                    b: node(b),
                    ohms: *value,
                },
                Component::VoltageSource {
                    pos, neg, value, ..
                } => {
                    voltage_source_count += 1;
                    ElementKind::VoltageSource {
                        pos: node(pos),
                        neg: node(neg),
                        volts: *value,
                        branch: voltage_source_count - 1,
                    }
                }
                Component::CurrentSource {
                    from, to, value, ..
                } => ElementKind::CurrentSource {
                    from: node(from),
                    to: node(to),
                    amps: *value,
                },
            };
            elements.push(Element {
                id: c.id().to_string(),
                kind,
            });
        }

        let circuit = Circuit {
            ground: ground.to_string(),
            node_names,
            elements,
            voltage_source_count,
        };
        circuit.check_voltage_source_loops()?;
        circuit.check_floating_nodes()?;
        Ok(circuit)
    }

    pub fn node_count(&self) -> usize {
        self.node_names.len()
    }

    /// Union-find slot for a node. Ground gets the last slot so it can take
    /// part in connectivity checks even though it has no matrix row.
    fn slot(&self, node: Node) -> usize {
        node.unwrap_or(self.node_count())
    }

    /// A loop made only of voltage sources makes the MNA matrix singular: KVL
    /// around the loop either contradicts the source values or is redundant,
    /// and the current circulating in the loop is undetermined. We find one by
    /// adding voltage sources to a union-find one at a time; a source whose
    /// terminals are already connected closes a loop.
    fn check_voltage_source_loops(&self) -> Result<(), SolverError> {
        let mut uf = UnionFind::new(self.node_count() + 1);
        for e in &self.elements {
            if let ElementKind::VoltageSource { pos, neg, .. } = e.kind
                && !uf.union(self.slot(pos), self.slot(neg))
            {
                return Err(SolverError::VoltageSourceLoop { id: e.id.clone() });
            }
        }
        Ok(())
    }

    /// Every node needs a path to ground through elements that constrain
    /// voltage (resistors and voltage sources). Otherwise its potential is
    /// undefined and the matrix is singular. Current sources are deliberately
    /// excluded: they set a current, not a voltage. In graph terms, this
    /// rejects cut-sets made only of current sources (for example, two
    /// current sources in series).
    fn check_floating_nodes(&self) -> Result<(), SolverError> {
        let mut uf = UnionFind::new(self.node_count() + 1);
        for e in &self.elements {
            match e.kind {
                ElementKind::Resistor { a, b, .. } => {
                    uf.union(self.slot(a), self.slot(b));
                }
                ElementKind::VoltageSource { pos, neg, .. } => {
                    uf.union(self.slot(pos), self.slot(neg));
                }
                ElementKind::CurrentSource { .. } => {}
            }
        }
        let ground = uf.find(self.slot(None));
        let floating: Vec<String> = (0..self.node_count())
            .filter(|&i| uf.find(i) != ground)
            .map(|i| self.node_names[i].clone())
            .collect();
        if floating.is_empty() {
            Ok(())
        } else {
            Err(SolverError::FloatingNodes { nodes: floating })
        }
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
            return Err(SolverError::DuplicateId(id.to_string()));
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
        let value = c.value();
        if !value.is_finite() {
            return Err(SolverError::InvalidValue {
                id: id.to_string(),
                reason: format!("value must be a finite number, got {value}"),
            });
        }
        if matches!(c, Component::Resistor { .. }) && value <= 0.0 {
            return Err(SolverError::InvalidValue {
                id: id.to_string(),
                reason: format!("resistance must be greater than 0 ohms, got {value}"),
            });
        }
    }
    Ok(())
}

/// Disjoint-set forest with path halving and union by size. Near-constant
/// time per operation; used for the structural graph checks above.
struct UnionFind {
    parent: Vec<usize>,
    size: Vec<usize>,
}

impl UnionFind {
    fn new(n: usize) -> Self {
        UnionFind {
            parent: (0..n).collect(),
            size: vec![1; n],
        }
    }

    fn find(&mut self, mut x: usize) -> usize {
        while self.parent[x] != x {
            self.parent[x] = self.parent[self.parent[x]];
            x = self.parent[x];
        }
        x
    }

    /// Merges the sets containing `a` and `b`. Returns `false` if they were
    /// already in the same set.
    fn union(&mut self, a: usize, b: usize) -> bool {
        let (mut ra, mut rb) = (self.find(a), self.find(b));
        if ra == rb {
            return false;
        }
        if self.size[ra] < self.size[rb] {
            std::mem::swap(&mut ra, &mut rb);
        }
        self.parent[rb] = ra;
        self.size[ra] += self.size[rb];
        true
    }
}
