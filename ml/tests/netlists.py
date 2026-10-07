"""Comparing netlists up to node names and component ids."""

from __future__ import annotations

from typing import Any

TERMINALS = {
    "resistor": ("a", "b"),
    "capacitor": ("a", "b"),
    "inductor": ("a", "b"),
    "voltage_source": ("pos", "neg"),
    "current_source": ("from", "to"),
}


def assert_equivalent(got: dict[str, Any], want: dict[str, Any]) -> None:
    """Same components (matched by type and value, which are unique in the
    test circuits) wired to the same nodes, under some renaming of nodes that
    keeps ground as ground."""
    key = lambda c: (c["type"], round(c["value"], 15))  # noqa: E731
    got_by = {key(c): c for c in got["components"]}
    want_by = {key(c): c for c in want["components"]}
    assert set(got_by) == set(want_by), f"components differ: {sorted(got_by)} vs {sorted(want_by)}"
    rename: dict[str, str] = {want["ground"]: got["ground"]}
    for k, w in want_by.items():
        g = got_by[k]
        for terminal in TERMINALS[w["type"]]:
            expected = rename.setdefault(w[terminal], g[terminal])
            assert g[terminal] == expected, f"{w['id']}.{terminal}: {g[terminal]} != {expected}"
    assert len(set(rename.values())) == len(rename), f"two nodes merged: {rename}"
