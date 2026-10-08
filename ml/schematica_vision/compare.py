"""Comparing netlists up to node names (and optionally component ids)."""

from __future__ import annotations

from typing import Any

TERMINALS = {
    "resistor": ("a", "b"),
    "capacitor": ("a", "b"),
    "inductor": ("a", "b"),
    "voltage_source": ("pos", "neg"),
    "current_source": ("from", "to"),
}


def difference(got: dict[str, Any], want: dict[str, Any], ids: dict[str, str] | None = None) -> str | None:
    """None if `got` is the same circuit as `want`, else what differs.

    Same circuit means the same components wired to the same nodes under some
    one-to-one renaming of nodes that keeps ground as ground. Components are
    matched through `ids` (wanted id -> recognized id) when given, else by
    type and value, which must then be unique.
    """
    got_by: dict[Any, dict[str, Any]]
    want_by: dict[Any, dict[str, Any]]
    if ids is not None:
        got_by = {c["id"]: c for c in got["components"]}
        want_by = {ids.get(c["id"], f"missing:{c['id']}"): c for c in want["components"]}
    else:
        got_by = {(c["type"], round(c["value"], 15)): c for c in got["components"]}
        want_by = {(c["type"], round(c["value"], 15)): c for c in want["components"]}
    if set(got_by) != set(want_by):
        return f"components differ: {sorted(map(str, got_by))} vs {sorted(map(str, want_by))}"
    rename: dict[str, str] = {want["ground"]: got["ground"]}
    for key, w in want_by.items():
        g = got_by[key]
        if (g["type"], g["value"]) != (w["type"], w["value"]):
            return f"{w['id']} is {g['type']} {g['value']}, expected {w['type']} {w['value']}"
        for terminal in TERMINALS[w["type"]]:
            expected = rename.setdefault(w[terminal], g[terminal])
            if g[terminal] != expected:
                return f"{w['id']}.{terminal} is on {g[terminal]}, expected {expected}"
    if len(set(rename.values())) != len(rename):
        return f"separate nodes were merged: {rename}"
    return None
