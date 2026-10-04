//! Modified Nodal Analysis (MNA): the linear-algebra core shared by every
//! analysis.
//!
//! # The system
//!
//! With `n` non-ground nodes and `m` voltage sources, the unknowns are
//!
//! ```text
//! x = [ v_1 ... v_n | i_1 ... i_m ]
//! ```
//!
//! the node voltages followed by the current through each voltage source.
//! Plain nodal analysis only has node voltages, but an ideal voltage source's
//! current cannot be written in terms of its terminal voltages (it can be
//! anything), so MNA adds that current as an extra unknown, plus one extra
//! equation fixing the source's voltage. The system `A·x = z` has the block
//! form
//!
//! ```text
//! [ G  B ] [ v ]   [ j ]
//! [ C  0 ] [ i ] = [ e ]
//! ```
//!
//! - Rows `0..n` are KCL at each node, written as "current leaving the node
//!   through components = current injected by current sources". `G` holds
//!   conductances and `j` the injected currents.
//! - Column block `B` adds each voltage-source current to the KCL of its
//!   terminals.
//! - Rows `n..n+m` (`C`, here `C = Bᵀ`) state `v_pos - v_neg = e` for each
//!   voltage source.
//!
//! Ground has no row or column: its voltage is fixed at 0, so its KCL equation
//! is redundant (it follows from the others) and dropping it is what makes the
//! system non-singular.
//!
//! # Stamps and analyses
//!
//! Every analysis reduces the circuit to the same three linear primitives,
//! [`Stamp`]s: a conductance, a current source and a voltage source. Each
//! analysis decides how a circuit element becomes primitives:
//!
//! | Element   | DC                  | Transient, t = 0          | Transient step          |
//! |-----------|---------------------|---------------------------|-------------------------|
//! | Resistor  | conductance         | conductance               | conductance             |
//! | Capacitor | nothing (open)      | voltage source at v(0)    | conductance + source    |
//! | Inductor  | 0 V source (short)  | current source at i(0)    | conductance + source    |
//!
//! Everything below works on primitives only, so the structural checks and
//! matrix assembly are written once and every analysis gets them.

use crate::circuit::{Circuit, Node};
use crate::error::SolverError;
use crate::graph::UnionFind;
use crate::linalg::{DenseMatrix, LuFactors};

/// A linear primitive that a circuit element contributes to the system.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Stamp {
    /// Conductance `g` (siemens, > 0) between `a` and `b`.
    Conductance { a: Node, b: Node, g: f64 },
    /// Pushes `amps` from `from` to `to` through itself.
    CurrentSource { from: Node, to: Node, amps: f64 },
    /// Forces `v(pos) - v(neg) = volts`; adds one current unknown.
    VoltageSource { pos: Node, neg: Node, volts: f64 },
}

/// The linear network for one analysis: the stamps, which element each came
/// from (for error messages), and where each voltage source's current lives
/// in the unknown vector.
pub(crate) struct Network {
    node_count: usize,
    stamps: Vec<Stamp>,
    owners: Vec<usize>,
    /// For each stamp, its index in `x` if it is a voltage source.
    branch: Vec<Option<usize>>,
    size: usize,
}

impl Network {
    /// Builds a network from `(element index, stamp)` pairs and runs the
    /// structural checks, so a network that exists is known to be solvable
    /// (up to numerical conditioning).
    pub fn new(circuit: &Circuit, stamps: Vec<(usize, Stamp)>) -> Result<Self, SolverError> {
        let node_count = circuit.node_count();
        let mut branch = Vec::with_capacity(stamps.len());
        let mut next_branch = node_count;
        for (_, stamp) in &stamps {
            if matches!(stamp, Stamp::VoltageSource { .. }) {
                branch.push(Some(next_branch));
                next_branch += 1;
            } else {
                branch.push(None);
            }
        }
        let (owners, stamps) = stamps.into_iter().unzip();
        let network = Network {
            node_count,
            stamps,
            owners,
            branch,
            size: next_branch,
        };
        network.check_voltage_source_loops(circuit)?;
        network.check_floating_nodes(circuit)?;
        Ok(network)
    }

    /// Union-find slot for a node. Ground gets the last slot so it can take
    /// part in connectivity checks even though it has no matrix row.
    fn slot(&self, node: Node) -> usize {
        node.unwrap_or(self.node_count)
    }

    /// A loop made only of voltage sources makes the matrix singular: KVL
    /// around the loop either contradicts the source values or is redundant,
    /// and the current circulating in the loop is undetermined. We find one by
    /// adding voltage sources to a union-find one at a time; a source whose
    /// terminals are already connected closes a loop.
    fn check_voltage_source_loops(&self, circuit: &Circuit) -> Result<(), SolverError> {
        let mut uf = UnionFind::new(self.node_count + 1);
        for (stamp, &owner) in self.stamps.iter().zip(&self.owners) {
            if let Stamp::VoltageSource { pos, neg, .. } = *stamp
                && !uf.union(self.slot(pos), self.slot(neg))
            {
                return Err(SolverError::VoltageSourceLoop {
                    id: circuit.elements[owner].id.clone(),
                });
            }
        }
        Ok(())
    }

    /// Every node needs a path to ground through primitives that constrain
    /// voltage (conductances and voltage sources). Otherwise its potential is
    /// undefined and the matrix is singular. Current sources are deliberately
    /// excluded: they set a current, not a voltage. In graph terms, this
    /// rejects cut-sets made only of current sources (for example, two
    /// current sources in series).
    fn check_floating_nodes(&self, circuit: &Circuit) -> Result<(), SolverError> {
        let mut uf = UnionFind::new(self.node_count + 1);
        for stamp in &self.stamps {
            match *stamp {
                Stamp::Conductance { a, b, .. } => {
                    uf.union(self.slot(a), self.slot(b));
                }
                Stamp::VoltageSource { pos, neg, .. } => {
                    uf.union(self.slot(pos), self.slot(neg));
                }
                Stamp::CurrentSource { .. } => {}
            }
        }
        let ground = uf.find(self.slot(None));
        let floating: Vec<String> = (0..self.node_count)
            .filter(|&i| uf.find(i) != ground)
            .map(|i| circuit.node_names[i].clone())
            .collect();
        if floating.is_empty() {
            Ok(())
        } else {
            Err(SolverError::FloatingNodes { nodes: floating })
        }
    }

    /// Position of a voltage-source stamp's current in the unknown vector.
    pub fn branch_index(&self, stamp: usize) -> usize {
        self.branch[stamp].expect("stamp is a voltage source")
    }

    /// Changes a current source's value. Transient analysis uses this to
    /// update each step's history sources without touching the matrix.
    pub fn set_current(&mut self, stamp: usize, value: f64) {
        match &mut self.stamps[stamp] {
            Stamp::CurrentSource { amps, .. } => *amps = value,
            other => panic!("stamp {stamp} is not a current source: {other:?}"),
        }
    }

    /// Builds the matrix `A`. It depends only on conductances and on where
    /// voltage sources connect, never on source values.
    pub fn matrix(&self) -> DenseMatrix {
        let mut a = DenseMatrix::zeros(self.size);
        let mut add = |row: Node, col: Node, value: f64| {
            if let (Some(r), Some(c)) = (row, col) {
                a.add(r, c, value);
            }
        };
        for (i, stamp) in self.stamps.iter().enumerate() {
            match *stamp {
                // Resistor-like conductance g between a and b. The current
                // leaving node a through it is g·(v_a - v_b), and the current
                // leaving b is g·(v_b - v_a). In KCL row a that contributes
                // +g to column a and -g to column b; row b gets the mirror
                // image:
                //
                //          col a  col b
                // row a [   +g     -g  ]
                // row b [   -g     +g  ]
                Stamp::Conductance { a: na, b: nb, g } => {
                    add(na, na, g);
                    add(nb, nb, g);
                    add(na, nb, -g);
                    add(nb, na, -g);
                }
                // A known current has no unknowns: right-hand side only.
                Stamp::CurrentSource { .. } => {}
                // Source current i_k flows into `pos`, through the source and
                // out of `neg`. It *leaves* node pos (+1 in KCL row pos) and
                // *enters* node neg (-1 in KCL row neg); that is the B
                // column. Row k states the constraint v_pos - v_neg = volts;
                // that is the C row:
                //
                //          col pos  col neg  col k
                // row pos [                    +1  ]
                // row neg [                    -1  ]
                // row k   [   +1       -1          ]
                Stamp::VoltageSource { pos, neg, .. } => {
                    let k = Some(self.branch_index(i));
                    add(pos, k, 1.0);
                    add(neg, k, -1.0);
                    add(k, pos, 1.0);
                    add(k, neg, -1.0);
                }
            }
        }
        a
    }

    /// Builds the right-hand side `z` from source values.
    pub fn rhs(&self) -> Vec<f64> {
        let mut z = vec![0.0; self.size];
        let mut add = |row: Node, value: f64| {
            if let Some(r) = row {
                z[r] += value;
            }
        };
        for (i, stamp) in self.stamps.iter().enumerate() {
            match *stamp {
                Stamp::Conductance { .. } => {}
                // The source draws current out of `from` and injects it into `to`.
                Stamp::CurrentSource { from, to, amps } => {
                    add(from, -amps);
                    add(to, amps);
                }
                Stamp::VoltageSource { volts, .. } => add(Some(self.branch_index(i)), volts),
            }
        }
        z
    }

    pub fn factor(&self) -> Result<LuFactors, SolverError> {
        LuFactors::factor(self.matrix()).map_err(|_| SolverError::SingularMatrix)
    }
}

/// Voltage of a node in a solution vector (ground is 0).
pub(crate) fn voltage(x: &[f64], node: Node) -> f64 {
    node.map_or(0.0, |i| x[i])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::netlist::{Component, Netlist};

    /// Checks the assembled matrix entry by entry against a hand-written MNA
    /// system, so a wrong sign in a stamp is caught here rather than only as a
    /// wrong final answer.
    #[test]
    fn assembles_expected_matrix_for_divider() {
        // V1 (10 V) at node "in", R1 = 1 Ω from in to out, R2 = 2 Ω from out to ground.
        let netlist = Netlist {
            version: 1,
            ground: "0".into(),
            components: vec![
                Component::VoltageSource {
                    id: "V1".into(),
                    pos: "in".into(),
                    neg: "0".into(),
                    value: 10.0,
                },
                Component::Resistor {
                    id: "R1".into(),
                    a: "in".into(),
                    b: "out".into(),
                    value: 1.0,
                },
                Component::Resistor {
                    id: "R2".into(),
                    a: "out".into(),
                    b: "0".into(),
                    value: 2.0,
                },
            ],
        };
        let circuit = Circuit::compile(&netlist).unwrap();
        let network = Network::new(&circuit, crate::dc::stamps(&circuit).0).unwrap();
        let a = network.matrix();

        // Unknowns: [v_in, v_out, i_V1]
        let expected = [
            [1.0, -1.0, 1.0], // KCL at in:  (v_in - v_out)/1 + i_V1 = 0
            [-1.0, 1.5, 0.0], // KCL at out: (v_out - v_in)/1 + v_out/2 = 0
            [1.0, 0.0, 0.0],  // V1:         v_in = 10
        ];
        for (row, expected_row) in expected.iter().enumerate() {
            for (col, &value) in expected_row.iter().enumerate() {
                assert_eq!(a.get(row, col), value, "A[{row}][{col}]");
            }
        }
        assert_eq!(network.rhs(), vec![0.0, 0.0, 10.0]);
    }
}
