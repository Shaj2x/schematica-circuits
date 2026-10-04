//! DC (steady-state) analysis.
//!
//! With constant sources, nothing changes over time, so dv/dt = di/dt = 0:
//! a capacitor carries no current (open circuit) and an inductor has no
//! voltage across it (short circuit, modelled as a 0 V source so that its
//! current is still an unknown we can report).

use std::collections::BTreeMap;

use crate::circuit::{Circuit, ElementKind};
use crate::error::SolverError;
use crate::mna::{Network, Stamp, voltage};
use crate::netlist::Solution;

/// Where an element's current comes from once the system is solved.
#[derive(Debug, Clone, Copy)]
pub(crate) enum CurrentFrom {
    /// The current unknown of the voltage-source stamp at this index.
    Branch(usize),
    /// Ohm's law across the element's terminals.
    Conductance(f64),
    /// A known constant.
    Fixed(f64),
}

/// The DC stamps for each element, plus how to read back each element's
/// current.
pub(crate) fn stamps(circuit: &Circuit) -> (Vec<(usize, Stamp)>, Vec<CurrentFrom>) {
    let mut stamps = Vec::new();
    let mut currents = Vec::new();
    for (i, element) in circuit.elements.iter().enumerate() {
        let current = match element.kind {
            ElementKind::Resistor { a, b, ohms } => {
                let g = 1.0 / ohms;
                stamps.push((i, Stamp::Conductance { a, b, g }));
                CurrentFrom::Conductance(g)
            }
            ElementKind::VoltageSource { pos, neg, volts } => {
                stamps.push((i, Stamp::VoltageSource { pos, neg, volts }));
                CurrentFrom::Branch(stamps.len() - 1)
            }
            ElementKind::CurrentSource { from, to, amps } => {
                stamps.push((i, Stamp::CurrentSource { from, to, amps }));
                CurrentFrom::Fixed(amps)
            }
            // Open circuit: contributes nothing.
            ElementKind::Capacitor { .. } => CurrentFrom::Fixed(0.0),
            // Short circuit: a 0 V source between its terminals.
            ElementKind::Inductor { a, b, .. } => {
                stamps.push((
                    i,
                    Stamp::VoltageSource {
                        pos: a,
                        neg: b,
                        volts: 0.0,
                    },
                ));
                CurrentFrom::Branch(stamps.len() - 1)
            }
        };
        currents.push(current);
    }
    (stamps, currents)
}

/// Solves a circuit once with the given stamps and maps the unknown vector
/// back to named node voltages and per-element currents. Shared by DC
/// analysis and by the t = 0 point of a transient run.
pub(crate) fn solve_with(
    circuit: &Circuit,
    stamps: Vec<(usize, Stamp)>,
    currents: &[CurrentFrom],
) -> Result<(Solution, Vec<f64>), SolverError> {
    let network = Network::new(circuit, stamps)?;
    let x = network.factor()?.solve(&network.rhs());

    let mut node_voltages = BTreeMap::new();
    node_voltages.insert(circuit.ground.clone(), 0.0);
    for (i, name) in circuit.node_names.iter().enumerate() {
        node_voltages.insert(name.clone(), x[i]);
    }

    let mut branch_currents = BTreeMap::new();
    for (element, how) in circuit.elements.iter().zip(currents) {
        let (a, b) = element.kind.terminals();
        let current = match *how {
            CurrentFrom::Branch(stamp) => x[network.branch_index(stamp)],
            CurrentFrom::Conductance(g) => g * (voltage(&x, a) - voltage(&x, b)),
            CurrentFrom::Fixed(amps) => amps,
        };
        branch_currents.insert(element.id.clone(), current);
    }

    Ok((
        Solution {
            node_voltages,
            branch_currents,
        },
        x,
    ))
}

pub(crate) fn solve(circuit: &Circuit) -> Result<Solution, SolverError> {
    let (stamps, currents) = stamps(circuit);
    solve_with(circuit, stamps, &currents).map(|(solution, _)| solution)
}
