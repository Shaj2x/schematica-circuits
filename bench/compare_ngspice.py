"""Accuracy against ngspice, the reference open-source SPICE simulator.

    cd backend && uv run python ../bench/compare_ngspice.py [--ngspice PATH] [--random 200]

Every netlist is translated to a SPICE deck, simulated by both, and compared:

* DC: the 13 hand-solved fixtures from solver/tests/fixtures, plus random
  circuits (connected resistor networks with voltage and current sources,
  values spread over four decades). Node voltages and voltage-source
  currents are compared.
* Transient: RC, RL and RLC step responses with nonzero initial conditions.
  ngspice runs with `uic` (start from the initial conditions, as Schematica
  does) and a maximum step equal to Schematica's fixed step; waveforms are
  compared at every Schematica time point.

Errors are reported relative to the largest magnitude in each circuit, so a
1 mV error in a 10 V circuit counts as 1e-4. ngspice adds a 1e-12 S `gmin`
from every node to ground, so DC agreement much beyond ~1e-9 is not
expected even though both solve the same linear system exactly.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import schematica_solver

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "solver" / "tests" / "fixtures"


# --- netlist -> SPICE ---------------------------------------------------------


def spice_node(name: str, ground: str) -> str:
    return "0" if name == ground else "n_" + re.sub(r"[^A-Za-z0-9_]", "_", name)


def to_spice(netlist: dict[str, Any], analysis: str) -> str:
    g = netlist["ground"]
    n = lambda name: spice_node(name, g)  # noqa: E731
    lines = ["* schematica comparison"]
    for c in netlist["components"]:
        kind, cid, v = c["type"], c["id"], c["value"]
        if kind == "resistor":
            lines.append(f"R{cid} {n(c['a'])} {n(c['b'])} {v!r}")
        elif kind == "voltage_source":
            lines.append(f"V{cid} {n(c['pos'])} {n(c['neg'])} DC {v!r}")
        elif kind == "current_source":
            # Both conventions push `value` from the first node to the second
            # through the source.
            lines.append(f"I{cid} {n(c['from'])} {n(c['to'])} DC {v!r}")
        elif kind == "capacitor":
            lines.append(f"C{cid} {n(c['a'])} {n(c['b'])} {v!r} IC={c.get('initial_voltage', 0)!r}")
        elif kind == "inductor":
            lines.append(f"L{cid} {n(c['a'])} {n(c['b'])} {v!r} IC={c.get('initial_current', 0)!r}")
        else:
            raise ValueError(kind)
    lines += [".options numdgt=15", analysis, ".end"]
    return "\n".join(lines) + "\n"


def run_ngspice(ngspice: str, deck: str, control: str) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "deck.cir"
        out = Path(tmp) / "out.txt"
        body = deck.replace(
            ".end\n",
            f".control\nset wr_singlescale\nset wr_vecnames\n{control.format(out=out)}\nquit\n.endc\n.end\n",
        )
        path.write_text(body)
        proc = subprocess.run([ngspice, "-b", str(path)], capture_output=True, text=True, timeout=120)
        if not out.exists():
            raise RuntimeError(f"ngspice failed:\n{proc.stdout[-2000:]}\n{proc.stderr[-2000:]}")
        return out.read_text()


def parse_wrdata(text: str) -> dict[str, list[float]]:
    lines = [line.split() for line in text.strip().splitlines() if line.strip()]
    header, rows = lines[0], lines[1:]
    return {name.lower(): [float(r[i]) for r in rows] for i, name in enumerate(header)}


# --- circuits -----------------------------------------------------------------


def random_circuit(rng: random.Random, index: int) -> dict[str, Any]:
    nodes = [f"n{i}" for i in range(rng.randint(3, 25))]
    everything = ["gnd", *nodes]
    log_value = lambda lo, hi: 10 ** rng.uniform(lo, hi)  # noqa: E731
    components: list[dict[str, Any]] = []
    # A random spanning tree keeps every node connected, then extra edges add loops.
    for i in range(1, len(everything)):
        a, b = everything[i], rng.choice(everything[:i])
        components.append(
            {"id": f"R{len(components)}", "type": "resistor", "a": a, "b": b, "value": log_value(1, 5)}
        )
    for _ in range(rng.randint(0, len(nodes))):
        a, b = rng.sample(everything, 2)
        components.append(
            {"id": f"R{len(components)}", "type": "resistor", "a": a, "b": b, "value": log_value(1, 5)}
        )
    # Voltage sources to ground from distinct nodes can never form a loop.
    for k, node in enumerate(rng.sample(nodes, rng.randint(1, min(3, len(nodes))))):
        components.append(
            {
                "id": f"V{k}",
                "type": "voltage_source",
                "pos": node,
                "neg": "gnd",
                "value": rng.uniform(-24, 24),
            }
        )
    for k in range(rng.randint(0, 2)):
        a, b = rng.sample(everything, 2)
        components.append(
            {"id": f"I{k}", "type": "current_source", "from": a, "to": b, "value": rng.uniform(-0.05, 0.05)}
        )
    return {"version": 1, "ground": "gnd", "components": components, "_name": f"random-{index}"}


TRANSIENT = [
    (
        "RC charging, C starts at 1 V",
        {
            "components": [
                {"id": "V1", "type": "voltage_source", "pos": "in", "neg": "gnd", "value": 5},
                {"id": "R1", "type": "resistor", "a": "in", "b": "out", "value": 1000},
                {
                    "id": "C1",
                    "type": "capacitor",
                    "a": "out",
                    "b": "gnd",
                    "value": 1e-6,
                    "initial_voltage": 1,
                },
            ]
        },
        {"stop_time": 5e-3, "time_step": 5e-6},
    ),
    (
        "RL current rise",
        {
            "components": [
                {"id": "V1", "type": "voltage_source", "pos": "in", "neg": "gnd", "value": 12},
                {"id": "R1", "type": "resistor", "a": "in", "b": "mid", "value": 100},
                {"id": "L1", "type": "inductor", "a": "mid", "b": "gnd", "value": 0.01},
            ]
        },
        {"stop_time": 5e-4, "time_step": 5e-7},
    ),
    (
        "Series RLC, underdamped ringing",
        {
            "components": [
                {"id": "V1", "type": "voltage_source", "pos": "in", "neg": "gnd", "value": 1},
                {"id": "R1", "type": "resistor", "a": "in", "b": "a", "value": 10},
                {"id": "L1", "type": "inductor", "a": "a", "b": "b", "value": 1e-3},
                {"id": "C1", "type": "capacitor", "a": "b", "b": "gnd", "value": 1e-6},
            ]
        },
        {"stop_time": 1e-3, "time_step": 1e-7},
    ),
    (
        "Two-stage RC with a current source",
        {
            "components": [
                {"id": "I1", "type": "current_source", "from": "gnd", "to": "a", "value": 1e-3},
                {"id": "R1", "type": "resistor", "a": "a", "b": "gnd", "value": 2000},
                {"id": "R2", "type": "resistor", "a": "a", "b": "b", "value": 1000},
                {"id": "C1", "type": "capacitor", "a": "a", "b": "gnd", "value": 1e-7},
                {
                    "id": "C2",
                    "type": "capacitor",
                    "a": "b",
                    "b": "gnd",
                    "value": 4.7e-7,
                    "initial_voltage": 0.5,
                },
            ]
        },
        {"stop_time": 3e-3, "time_step": 3e-6},
    ),
]


# --- comparisons --------------------------------------------------------------


def compare_dc(ngspice: str, netlist: dict[str, Any]) -> float:
    ours = schematica_solver.solve(netlist)
    g = netlist["ground"]
    nodes = sorted(k for k in ours["node_voltages"] if k != g)
    sources = [c["id"] for c in netlist["components"] if c["type"] == "voltage_source"]
    vectors = [f"v({spice_node(k, g)})" for k in nodes] + [f"i(v{s.lower()})" for s in sources]
    text = run_ngspice(ngspice, to_spice(netlist, ".op"), "op\nwrdata {out} " + " ".join(vectors))
    theirs = parse_wrdata(text)
    pairs = [(ours["node_voltages"][k], theirs[f"v({spice_node(k, g).lower()})"][0]) for k in nodes]
    voltage_scale = max(abs(t) for _, t in pairs) or 1.0
    errors = [abs(o - t) / voltage_scale for o, t in pairs]
    current_pairs = [(ours["branch_currents"][s], theirs[f"i(v{s.lower()})"][0]) for s in sources]
    current_scale = max((abs(t) for _, t in current_pairs), default=0.0) or 1.0
    errors += [abs(o - t) / current_scale for o, t in current_pairs]
    return max(errors)


def compare_transient(ngspice: str, netlist: dict[str, Any], options: dict[str, float], method: str) -> float:
    ours = schematica_solver.solve_transient(netlist, {**options, "method": method})
    g = netlist["ground"]
    nodes = sorted(k for k in ours["node_voltages"] if k != g)
    step, stop = options["time_step"], options["stop_time"]
    vectors = " ".join(f"v({spice_node(k, g)})" for k in nodes)
    text = run_ngspice(
        ngspice,
        to_spice(netlist, f".tran {step!r} {stop!r} 0 {step!r} uic"),
        f"run\nlinearize\nwrdata {{out}} {vectors}",
    )
    theirs = parse_wrdata(text)
    time_ngspice = theirs[next(iter(theirs))]  # first column is time with wr_singlescale
    worst = 0.0
    for k in nodes:
        o, t = ours["node_voltages"][k], theirs[f"v({spice_node(k, g).lower()})"]
        scale = max(abs(x) for x in t) or 1.0
        for ti, oi in zip(ours["time"], o, strict=True):
            # ngspice's linearized grid matches ours; interpolate anyway in case
            # it starts or ends a point early.
            j = min(range(len(time_ngspice)), key=lambda m: abs(time_ngspice[m] - ti))
            worst = max(worst, abs(oi - t[j]) / scale)
    return worst


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--ngspice", default=shutil.which("ngspice"), help="path to the ngspice binary")
    parser.add_argument("--random", type=int, default=200, help="number of random DC circuits")
    parser.add_argument("--json", type=Path, help="also write the results here")
    args = parser.parse_args()
    if not args.ngspice:
        sys.exit("ngspice not found: install it or pass --ngspice PATH")

    version = subprocess.run([args.ngspice, "-v"], capture_output=True, text=True).stdout
    match = re.search(r"ngspice-(\d+)", version)
    print(f"Reference: ngspice {match.group(1) if match else '?'}\n")

    fixtures = []
    for path in sorted(FIXTURES.glob("*.json")):
        data = json.loads(path.read_text())
        netlist = data.get("netlist", data)
        fixtures.append((path.stem, compare_dc(args.ngspice, netlist)))
    rng = random.Random(2026)
    randoms = [compare_dc(args.ngspice, random_circuit(rng, i)) for i in range(args.random)]

    print("DC operating point\n")
    print("| Circuits | Count | Worst relative error | Median |")
    print("|----------|------:|---------------------:|-------:|")
    fx = [e for _, e in fixtures]
    for label, errors in (("Hand-solved fixtures", fx), ("Random networks (3-25 nodes)", randoms)):
        print(f"| {label} | {len(errors)} | {max(errors):.1e} | {sorted(errors)[len(errors) // 2]:.1e} |")

    print("\nTransient (worst error over every time point, relative to the signal's peak)\n")
    print("| Circuit | Steps | Trapezoidal | Backward Euler |")
    print("|---------|------:|------------:|---------------:|")
    transient = []
    for name, body, options in TRANSIENT:
        netlist = {"version": 1, "ground": "gnd", **body}
        trap = compare_transient(args.ngspice, netlist, options, "trapezoidal")
        euler = compare_transient(args.ngspice, netlist, options, "backward_euler")
        steps = round(options["stop_time"] / options["time_step"])
        transient.append({"circuit": name, "steps": steps, "trapezoidal": trap, "backward_euler": euler})
        print(f"| {name} | {steps} | {trap:.1e} | {euler:.1e} |")

    if args.json:
        args.json.write_text(
            json.dumps(
                {"fixtures": dict(fixtures), "random_worst": max(randoms), "transient": transient},
                indent=2,
            )
        )
    if max(fx + randoms) > 1e-6 or not all(math.isfinite(e) for e in fx + randoms):
        sys.exit("DC disagreement above 1e-6")


if __name__ == "__main__":
    main()
