//! Solve time against circuit size, for docs/benchmarks.md.
//!
//!     cargo run --release -p schematica-solver --example bench
//!
//! DC: an n x n resistor mesh driven at one corner (n² + 1 nodes). Transient:
//! an RC ladder of n stages over 1000 steps. Each case is solved repeatedly
//! and the median time is reported, so one slow run (a page fault, a
//! scheduler hiccup) does not move the number.

use std::time::{Duration, Instant};

use schematica_solver::{Netlist, TransientOptions, parse_netlist, solve, solve_transient};
use serde_json::{Value, json};

fn mesh(n: usize) -> Netlist {
    let node = |r: usize, c: usize| format!("n{r}_{c}");
    let mut components = vec![
        json!({"id": "V1", "type": "voltage_source", "pos": node(0, 0), "neg": "gnd", "value": 10.0}),
    ];
    let mut id = 0;
    let mut resistor = |a: String, b: String, value: f64| {
        id += 1;
        json!({"id": format!("R{id}"), "type": "resistor", "a": a, "b": b, "value": value})
    };
    for r in 0..n {
        for c in 0..n {
            if c + 1 < n {
                components.push(resistor(node(r, c), node(r, c + 1), 1000.0));
            }
            if r + 1 < n {
                components.push(resistor(node(r, c), node(r + 1, c), 1000.0));
            }
        }
    }
    components.push(resistor(node(n - 1, n - 1), "gnd".into(), 1000.0));
    parse(json!({"version": 1, "ground": "gnd", "components": components}))
}

fn rc_ladder(stages: usize) -> Netlist {
    let mut components = vec![
        json!({"id": "V1", "type": "voltage_source", "pos": "n0", "neg": "gnd", "value": 5.0}),
    ];
    for i in 0..stages {
        components.push(json!({"id": format!("R{i}"), "type": "resistor", "a": format!("n{i}"), "b": format!("n{}", i + 1), "value": 1000.0}));
        components.push(json!({"id": format!("C{i}"), "type": "capacitor", "a": format!("n{}", i + 1), "b": "gnd", "value": 1e-9}));
    }
    parse(json!({"version": 1, "ground": "gnd", "components": components}))
}

fn parse(value: Value) -> Netlist {
    parse_netlist(&value.to_string()).expect("generated netlist is valid")
}

/// Median of repeated runs: at least 5, and at least ~300 ms of work.
fn median(mut run: impl FnMut()) -> Duration {
    let mut times = Vec::new();
    let started = Instant::now();
    while times.len() < 5 || (started.elapsed() < Duration::from_millis(300) && times.len() < 2000)
    {
        let t = Instant::now();
        run();
        times.push(t.elapsed());
    }
    times.sort();
    times[times.len() / 2]
}

fn ms(d: Duration) -> String {
    let ms = d.as_secs_f64() * 1e3;
    if ms < 0.1 {
        format!("{:.1} µs", ms * 1e3)
    } else {
        format!("{ms:.2} ms")
    }
}

fn main() {
    println!("DC operating point, n x n resistor mesh\n");
    println!("| Nodes | Components | Median solve |");
    println!("|------:|-----------:|-------------:|");
    for n in [3, 5, 8, 12, 16, 23, 32] {
        let netlist = mesh(n);
        let t = median(|| {
            solve(&netlist).expect("mesh solves");
        });
        println!(
            "| {} | {} | {} |",
            n * n + 1,
            netlist.components.len(),
            ms(t)
        );
    }

    println!("\nTransient, RC ladder, 1000 steps (trapezoidal)\n");
    println!("| Nodes | Components | Median run | Per step |");
    println!("|------:|-----------:|-----------:|---------:|");
    for stages in [1, 5, 10, 25, 50, 100, 200] {
        let netlist = rc_ladder(stages);
        let options: TransientOptions = serde_json::from_value(
            json!({"stop_time": 1e-6 * stages as f64, "time_step": 1e-9 * stages as f64}),
        )
        .unwrap();
        let t = median(|| {
            solve_transient(&netlist, &options).expect("ladder simulates");
        });
        println!(
            "| {} | {} | {} | {} |",
            stages + 2,
            netlist.components.len(),
            ms(t),
            ms(t / 1000)
        );
    }
}
