//! Modified Nodal Analysis (MNA) for DC circuits.
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
//! # Stamps
//!
//! The matrix is built by adding each element's contribution ("stamp")
//! independently, which is why adding a new element type later (capacitors and
//! inductors in Phase 3) only means writing its stamp.

use std::collections::BTreeMap;

use crate::circuit::{Circuit, ElementKind, Node};
use crate::error::SolverError;
use crate::linalg::{DenseMatrix, LuFactors};
use crate::netlist::Solution;

/// The assembled system `A·x = z`.
pub(crate) struct MnaSystem {
    pub matrix: DenseMatrix,
    pub rhs: Vec<f64>,
}

impl MnaSystem {
    fn new(size: usize) -> Self {
        MnaSystem {
            matrix: DenseMatrix::zeros(size),
            rhs: vec![0.0; size],
        }
    }

    /// Adds to A[row][col], ignoring ground (which has no row or column).
    fn add(&mut self, row: Node, col: Node, value: f64) {
        if let (Some(r), Some(c)) = (row, col) {
            self.matrix.add(r, c, value);
        }
    }

    /// Adds to z[row], ignoring ground.
    fn add_rhs(&mut self, row: Node, value: f64) {
        if let Some(r) = row {
            self.rhs[r] += value;
        }
    }

    /// Resistor with conductance g = 1/R between nodes a and b.
    ///
    /// The current leaving node a through the resistor is g·(v_a - v_b), and
    /// the current leaving b is g·(v_b - v_a). In KCL row a that contributes
    /// +g to column a and -g to column b; row b gets the mirror image:
    ///
    /// ```text
    ///          col a  col b
    /// row a [   +g     -g  ]
    /// row b [   -g     +g  ]
    /// ```
    fn stamp_conductance(&mut self, a: Node, b: Node, g: f64) {
        self.add(a, a, g);
        self.add(b, b, g);
        self.add(a, b, -g);
        self.add(b, a, -g);
    }

    /// Current source pushing `amps` from node `from` to node `to` through
    /// itself. It draws current out of `from` and injects it into `to`. A
    /// known current has no unknowns, so it only touches the right-hand side.
    fn stamp_current_source(&mut self, from: Node, to: Node, amps: f64) {
        self.add_rhs(from, -amps);
        self.add_rhs(to, amps);
    }

    /// Voltage source enforcing v_pos - v_neg = volts, whose current is
    /// unknown `k`.
    ///
    /// `i_k` flows into the `pos` terminal, through the source, and out of
    /// `neg`. So it *leaves* node pos (+1 in KCL row pos) and *enters* node neg
    /// (-1 in KCL row neg); that is the B column. The extra row k states the
    /// constraint itself; that is the C row:
    ///
    /// ```text
    ///          col pos  col neg  col k     rhs
    /// row pos [                    +1  ]
    /// row neg [                    -1  ]
    /// row k   [   +1       -1          ] [ volts ]
    /// ```
    fn stamp_voltage_source(&mut self, pos: Node, neg: Node, k: usize, volts: f64) {
        let branch = Some(k);
        self.add(pos, branch, 1.0);
        self.add(neg, branch, -1.0);
        self.add(branch, pos, 1.0);
        self.add(branch, neg, -1.0);
        self.add_rhs(branch, volts);
    }
}

/// Builds the MNA system for a validated circuit.
pub(crate) fn assemble(circuit: &Circuit) -> MnaSystem {
    let n = circuit.node_count();
    let mut system = MnaSystem::new(n + circuit.voltage_source_count);
    for element in &circuit.elements {
        match element.kind {
            ElementKind::Resistor { a, b, ohms } => system.stamp_conductance(a, b, 1.0 / ohms),
            ElementKind::CurrentSource { from, to, amps } => {
                system.stamp_current_source(from, to, amps)
            }
            ElementKind::VoltageSource {
                pos,
                neg,
                volts,
                branch,
            } => system.stamp_voltage_source(pos, neg, n + branch, volts),
        }
    }
    system
}

/// Solves a validated circuit and maps the unknown vector back to named
/// node voltages and per-component currents.
pub(crate) fn solve(circuit: &Circuit) -> Result<Solution, SolverError> {
    let system = assemble(circuit);
    let x = LuFactors::factor(system.matrix)
        .map_err(|_| SolverError::SingularMatrix)?
        .solve(&system.rhs);

    let n = circuit.node_count();
    let voltage = |node: Node| node.map_or(0.0, |i| x[i]);

    let mut node_voltages = BTreeMap::new();
    node_voltages.insert(circuit.ground.clone(), 0.0);
    for (i, name) in circuit.node_names.iter().enumerate() {
        node_voltages.insert(name.clone(), x[i]);
    }

    let mut branch_currents = BTreeMap::new();
    for element in &circuit.elements {
        let current = match element.kind {
            // Ohm's law, positive from a to b.
            ElementKind::Resistor { a, b, ohms } => (voltage(a) - voltage(b)) / ohms,
            ElementKind::CurrentSource { amps, .. } => amps,
            // Read straight from the solution vector.
            ElementKind::VoltageSource { branch, .. } => x[n + branch],
        };
        branch_currents.insert(element.id.clone(), current);
    }

    Ok(Solution {
        node_voltages,
        branch_currents,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::netlist::{Component, Netlist};

    fn r(id: &str, a: &str, b: &str, value: f64) -> Component {
        Component::Resistor {
            id: id.into(),
            a: a.into(),
            b: b.into(),
            value,
        }
    }

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
                r("R1", "in", "out", 1.0),
                r("R2", "out", "0", 2.0),
            ],
        };
        let circuit = Circuit::compile(&netlist).unwrap();
        let system = assemble(&circuit);

        // Unknowns: [v_in, v_out, i_V1]
        let expected = [
            [1.0, -1.0, 1.0], // KCL at in:  (v_in - v_out)/1 + i_V1 = 0
            [-1.0, 1.5, 0.0], // KCL at out: (v_out - v_in)/1 + v_out/2 = 0
            [1.0, 0.0, 0.0],  // V1:         v_in = 10
        ];
        for (row, expected_row) in expected.iter().enumerate() {
            for (col, &value) in expected_row.iter().enumerate() {
                assert_eq!(system.matrix.get(row, col), value, "A[{row}][{col}]");
            }
        }
        assert_eq!(system.rhs, vec![0.0, 0.0, 10.0]);
    }
}
