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

    /// Nodes with no path to ground through resistors or voltage sources.
    /// Current sources do not count: they fix a current, not a voltage, so a
    /// node reached only through them has no defined potential. This also
    /// covers current sources in series.
    #[error(
        "node(s) {} have no path to ground through resistors or voltage sources, so their voltage is undefined",
        .nodes.join(", ")
    )]
    FloatingNodes { nodes: Vec<String> },

    /// A set of voltage sources forming a closed loop (including two sources
    /// in parallel). Their values either contradict each other or leave the
    /// loop current undefined.
    #[error(
        "voltage source \"{id}\" closes a loop made only of voltage sources, so the loop current is undefined"
    )]
    VoltageSourceLoop { id: String },

    #[error("the circuit equations are singular or too ill-conditioned to solve")]
    SingularMatrix,
}
