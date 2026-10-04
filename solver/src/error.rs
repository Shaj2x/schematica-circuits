use serde::Serialize;
use thiserror::Error;

/// Everything that can go wrong between receiving a netlist and returning a
/// solution.
///
/// Structural problems (floating nodes, voltage-source loops, ...) are
/// detected by graph checks *before* any matrix is built, so the user gets a
/// message naming the offending nodes or components instead of a bare
/// "singular matrix". [`SolverError::SingularMatrix`] is only the fallback for
/// numerically degenerate input the graph checks cannot see.
///
/// Errors serialize as JSON tagged by `kind` (for example
/// `{"kind": "floating_nodes", "nodes": ["x"]}`), so the editor can
/// highlight the offending nodes or components rather than only show text.
/// Every variant has named fields because serde's internally tagged format
/// cannot represent tuple variants.
#[derive(Debug, Clone, PartialEq, Error, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SolverError {
    #[error("invalid netlist JSON: {message}")]
    Parse { message: String },

    #[error("unsupported netlist version {found} (this solver supports version {supported})")]
    UnsupportedVersion { found: u32, supported: u32 },

    #[error("the circuit has no components")]
    EmptyCircuit,

    #[error("a component has an empty id")]
    EmptyId,

    #[error("component \"{id}\" has a terminal with an empty node name")]
    EmptyNodeName { id: String },

    #[error("more than one component has the id \"{id}\"")]
    DuplicateId { id: String },

    #[error("component \"{id}\": {reason}")]
    InvalidValue { id: String, reason: String },

    /// Both terminals on one node. A shorted resistor is harmless physically,
    /// but in a drawn or photographed circuit it almost always means a wiring
    /// mistake, so it is reported rather than silently accepted.
    #[error("component \"{id}\" has both terminals on node \"{node}\", so it is shorted out")]
    ShortedComponent { id: String, node: String },

    #[error("the ground node \"{ground}\" is not connected to any component")]
    MissingGround { ground: String },

    /// Nodes with no path to ground through elements that fix a voltage
    /// difference (resistors, voltage sources, and in transient analysis
    /// capacitors and inductors). Current sources never count: they fix a
    /// current, not a voltage, so a node reached only through them has no
    /// defined potential. This also covers current sources in series, and,
    /// at DC, nodes reached only through capacitors (open circuits).
    #[error(
        "node(s) {} have no path to ground that fixes their voltage (current sources never do, and capacitors don't at DC), so their voltage is undefined",
        .nodes.join(", ")
    )]
    FloatingNodes { nodes: Vec<String> },

    /// A closed loop made only of elements that force a voltage: voltage
    /// sources, plus inductors at DC (0 V shorts) and capacitors at t = 0
    /// (sources of their initial voltage). Their values either contradict
    /// each other or leave the loop current undefined. Two sources in
    /// parallel is the smallest case.
    #[error(
        "\"{id}\" closes a loop made only of voltage sources (at DC an inductor counts as a 0 V source), so the loop current is undefined"
    )]
    VoltageSourceLoop { id: String },

    /// Transient settings that cannot be simulated.
    #[error("invalid transient settings: {reason}")]
    InvalidAnalysis { reason: String },

    /// The circuit at t = 0, with every capacitor held at its initial voltage
    /// and every inductor carrying its initial current, has no unique
    /// solution. Typically a capacitor sits directly across a voltage source
    /// (it would charge through zero resistance), or a node is reached only
    /// through inductors. `cause` says which elements or nodes.
    #[error("the circuit's state at t = 0 is undefined: {cause}")]
    UndefinedInitialState { cause: Box<SolverError> },

    #[error("the circuit equations are singular or too ill-conditioned to solve")]
    SingularMatrix,
}
