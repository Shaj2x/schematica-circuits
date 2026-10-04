//! Transient (time-domain) analysis with companion models.
//!
//! # The idea
//!
//! A capacitor obeys i = C dv/dt and an inductor v = L di/dt. Approximating
//! the derivative over one time step h turns each into something MNA already
//! understands: a conductance in parallel with a current source that carries
//! the element's history (its "companion model"). Each step is then an
//! ordinary linear DC solve.
//!
//! Capacitor, with v and i the voltage across and current from a to b:
//!
//! ```text
//! backward Euler:  i₊ = (C/h)(v₊ − v)            ⇒  G = C/h,   i₊ = G·v₊ − G·v
//! trapezoidal:     (i₊ + i)/2 = C(v₊ − v)/h      ⇒  G = 2C/h,  i₊ = G·v₊ − (G·v + i)
//! ```
//!
//! Inductor:
//!
//! ```text
//! backward Euler:  v₊ = L(i₊ − i)/h              ⇒  G = h/L,   i₊ = G·v₊ + i
//! trapezoidal:     (v₊ + v)/2 = L(i₊ − i)/h      ⇒  G = h/2L,  i₊ = G·v₊ + (i + G·v)
//! ```
//!
//! In both cases i₊ = G·v₊ ± (history), where the history term is known from
//! the previous step. So each reactive element stamps a conductance G plus a
//! current source equal to the history.
//!
//! # Why a fixed step pays off
//!
//! G depends only on h and the component value, so with a fixed step the
//! matrix is identical at every step: it is LU-factored once, and each step
//! only rebuilds the right-hand side and does an O(n²) forward/back
//! substitution. A variable-step solver (as SPICE uses) would refactor
//! whenever h changes; it is the upgrade path if fast edges ever need it.
//!
//! # Initial conditions
//!
//! The run starts from the components' initial conditions (capacitor
//! voltage, inductor current; default 0), like a switch closing at t = 0.
//! The t = 0 point is solved with each capacitor as a voltage source at its
//! initial voltage and each inductor as a current source at its initial
//! current. That gives every node voltage at t = 0 and the capacitor currents
//! and inductor voltages the trapezoidal rule needs for its first step.

use std::collections::BTreeMap;

use crate::circuit::{Circuit, ElementKind};
use crate::dc::{self, CurrentFrom};
use crate::error::SolverError;
use crate::mna::{Network, Stamp, voltage};
use crate::netlist::{Integration, TransientOptions, TransientSolution};

/// Upper bound on steps per run, so a typo like a 1 ns step over 1 s cannot
/// lock up the browser or produce hundreds of megabytes of output.
pub const MAX_STEPS: usize = 100_000;

/// How one element behaves during time stepping.
#[derive(Clone, Copy)]
enum StepModel {
    Conductance {
        g: f64,
    },
    VoltageSource {
        stamp: usize,
    },
    CurrentSource {
        amps: f64,
    },
    /// `history` is the index of the element's history current-source stamp.
    Capacitor {
        g: f64,
        history: usize,
    },
    Inductor {
        g: f64,
        history: usize,
    },
}

/// Voltage across and current through a reactive element at the latest step.
#[derive(Clone, Copy, Default)]
struct State {
    v: f64,
    i: f64,
}

pub(crate) fn solve(
    circuit: &Circuit,
    options: &TransientOptions,
) -> Result<TransientSolution, SolverError> {
    let (steps, h) = step_count(options)?;
    let method = options.method;

    // --- t = 0 -----------------------------------------------------------
    let (initial_stamps, initial_currents) = initial_condition_stamps(circuit);
    let (initial, _) =
        dc::solve_with(circuit, initial_stamps, &initial_currents).map_err(|cause| {
            SolverError::UndefinedInitialState {
                cause: Box::new(cause),
            }
        })?;

    let mut states: Vec<State> = circuit
        .elements
        .iter()
        .map(|e| {
            let (a, b) = e.kind.terminals();
            let name = |n: Option<usize>| n.map_or(&circuit.ground, |i| &circuit.node_names[i]);
            State {
                v: initial.node_voltages[name(a)] - initial.node_voltages[name(b)],
                i: initial.branch_currents[&e.id],
            }
        })
        .collect();

    let mut out = Recorder::new(circuit, steps);
    out.push_named(0.0, &initial.node_voltages, &initial.branch_currents);

    // --- time stepping ---------------------------------------------------
    let (stamps, models) = step_stamps(circuit, h, method);
    let mut network = Network::new(circuit, stamps)?;
    let lu = network.factor()?;

    let mut history = vec![0.0; models.len()];
    for k in 1..=steps {
        // History sources from the previous step's state.
        for ((model, state), hist) in models.iter().zip(&states).zip(&mut history) {
            *hist = match (*model, method) {
                (StepModel::Capacitor { g, .. }, Integration::BackwardEuler) => g * state.v,
                (StepModel::Capacitor { g, .. }, Integration::Trapezoidal) => g * state.v + state.i,
                (StepModel::Inductor { .. }, Integration::BackwardEuler) => state.i,
                (StepModel::Inductor { g, .. }, Integration::Trapezoidal) => state.i + g * state.v,
                _ => continue,
            };
            if let StepModel::Capacitor { history: stamp, .. }
            | StepModel::Inductor { history: stamp, .. } = *model
            {
                network.set_current(stamp, *hist);
            }
        }

        let x = lu.solve(&network.rhs());

        let mut currents = Vec::with_capacity(models.len());
        for (((element, model), state), &hist) in circuit
            .elements
            .iter()
            .zip(&models)
            .zip(&mut states)
            .zip(&history)
        {
            let (a, b) = element.kind.terminals();
            let v = voltage(&x, a) - voltage(&x, b);
            let i = match *model {
                StepModel::Conductance { g } => g * v,
                StepModel::VoltageSource { stamp } => x[network.branch_index(stamp)],
                StepModel::CurrentSource { amps } => amps,
                // The history source injects into `a`, opposing G·v.
                StepModel::Capacitor { g, .. } => g * v - hist,
                // The history source keeps pushing from `a` to `b`.
                StepModel::Inductor { g, .. } => g * v + hist,
            };
            *state = State { v, i };
            currents.push(i);
        }
        out.push(k as f64 * h, &x, &currents);
    }

    Ok(out.finish())
}

/// Validates the options and returns (number of steps, actual step size).
/// The step is adjusted so a whole number of steps ends exactly at
/// `stop_time`, which keeps the last sample on the requested time.
fn step_count(options: &TransientOptions) -> Result<(usize, f64), SolverError> {
    let invalid = |reason: String| SolverError::InvalidAnalysis { reason };
    let TransientOptions {
        stop_time,
        time_step,
        ..
    } = *options;
    if !(stop_time.is_finite() && stop_time > 0.0) {
        return Err(invalid(format!(
            "stop time must be a positive number of seconds, got {stop_time}"
        )));
    }
    if !(time_step.is_finite() && time_step > 0.0) {
        return Err(invalid(format!(
            "time step must be a positive number of seconds, got {time_step}"
        )));
    }
    if time_step > stop_time {
        return Err(invalid(format!(
            "time step ({time_step} s) is longer than the stop time ({stop_time} s)"
        )));
    }
    let steps = (stop_time / time_step).round();
    if steps > MAX_STEPS as f64 {
        return Err(invalid(format!(
            "{steps} steps requested; the limit is {MAX_STEPS}. Use a larger time step or a shorter stop time"
        )));
    }
    let steps = (steps as usize).max(1);
    Ok((steps, stop_time / steps as f64))
}

/// The t = 0 network: capacitors held at their initial voltage, inductors
/// carrying their initial current, everything else as at DC.
fn initial_condition_stamps(circuit: &Circuit) -> (Vec<(usize, Stamp)>, Vec<CurrentFrom>) {
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
            ElementKind::Capacitor {
                a,
                b,
                initial_voltage,
                ..
            } => {
                let volts = initial_voltage;
                stamps.push((
                    i,
                    Stamp::VoltageSource {
                        pos: a,
                        neg: b,
                        volts,
                    },
                ));
                CurrentFrom::Branch(stamps.len() - 1)
            }
            ElementKind::Inductor {
                a,
                b,
                initial_current,
                ..
            } => {
                let amps = initial_current;
                stamps.push((
                    i,
                    Stamp::CurrentSource {
                        from: a,
                        to: b,
                        amps,
                    },
                ));
                CurrentFrom::Fixed(amps)
            }
        };
        currents.push(current);
    }
    (stamps, currents)
}

/// The stamps used at every time step, and each element's step model.
fn step_stamps(
    circuit: &Circuit,
    h: f64,
    method: Integration,
) -> (Vec<(usize, Stamp)>, Vec<StepModel>) {
    let mut stamps = Vec::new();
    let mut models = Vec::new();
    for (i, element) in circuit.elements.iter().enumerate() {
        let model = match element.kind {
            ElementKind::Resistor { a, b, ohms } => {
                let g = 1.0 / ohms;
                stamps.push((i, Stamp::Conductance { a, b, g }));
                StepModel::Conductance { g }
            }
            ElementKind::VoltageSource { pos, neg, volts } => {
                stamps.push((i, Stamp::VoltageSource { pos, neg, volts }));
                StepModel::VoltageSource {
                    stamp: stamps.len() - 1,
                }
            }
            ElementKind::CurrentSource { from, to, amps } => {
                stamps.push((i, Stamp::CurrentSource { from, to, amps }));
                StepModel::CurrentSource { amps }
            }
            ElementKind::Capacitor { a, b, farads, .. } => {
                let g = match method {
                    Integration::BackwardEuler => farads / h,
                    Integration::Trapezoidal => 2.0 * farads / h,
                };
                stamps.push((i, Stamp::Conductance { a, b, g }));
                // History injects into `a`: a source pushing from b to a.
                stamps.push((
                    i,
                    Stamp::CurrentSource {
                        from: b,
                        to: a,
                        amps: 0.0,
                    },
                ));
                StepModel::Capacitor {
                    g,
                    history: stamps.len() - 1,
                }
            }
            ElementKind::Inductor { a, b, henries, .. } => {
                let g = match method {
                    Integration::BackwardEuler => h / henries,
                    Integration::Trapezoidal => h / (2.0 * henries),
                };
                stamps.push((i, Stamp::Conductance { a, b, g }));
                // History keeps flowing from a to b.
                stamps.push((
                    i,
                    Stamp::CurrentSource {
                        from: a,
                        to: b,
                        amps: 0.0,
                    },
                ));
                StepModel::Inductor {
                    g,
                    history: stamps.len() - 1,
                }
            }
        };
        models.push(model);
    }
    (stamps, models)
}

/// Collects samples into the column-oriented output.
struct Recorder<'c> {
    circuit: &'c Circuit,
    time: Vec<f64>,
    nodes: Vec<Vec<f64>>,
    currents: Vec<Vec<f64>>,
}

impl<'c> Recorder<'c> {
    fn new(circuit: &'c Circuit, steps: usize) -> Self {
        let column = || Vec::with_capacity(steps + 1);
        Recorder {
            circuit,
            time: column(),
            nodes: (0..circuit.node_count()).map(|_| column()).collect(),
            currents: (0..circuit.elements.len()).map(|_| column()).collect(),
        }
    }

    fn push(&mut self, t: f64, x: &[f64], currents: &[f64]) {
        self.time.push(t);
        for (column, &v) in self.nodes.iter_mut().zip(x) {
            column.push(v);
        }
        for (column, &i) in self.currents.iter_mut().zip(currents) {
            column.push(i);
        }
    }

    fn push_named(
        &mut self,
        t: f64,
        voltages: &BTreeMap<String, f64>,
        currents: &BTreeMap<String, f64>,
    ) {
        let x: Vec<f64> = self
            .circuit
            .node_names
            .iter()
            .map(|n| voltages[n])
            .collect();
        let i: Vec<f64> = self
            .circuit
            .elements
            .iter()
            .map(|e| currents[&e.id])
            .collect();
        self.push(t, &x, &i);
    }

    fn finish(self) -> TransientSolution {
        let mut node_voltages: BTreeMap<String, Vec<f64>> = self
            .circuit
            .node_names
            .iter()
            .cloned()
            .zip(self.nodes)
            .collect();
        node_voltages.insert(self.circuit.ground.clone(), vec![0.0; self.time.len()]);
        let branch_currents = self
            .circuit
            .elements
            .iter()
            .map(|e| e.id.clone())
            .zip(self.currents)
            .collect();
        TransientSolution {
            time: self.time,
            node_voltages,
            branch_currents,
        }
    }
}
