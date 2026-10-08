"""Test helper: assert two netlists are the same circuit."""

from __future__ import annotations

from typing import Any

from schematica_vision.compare import difference


def assert_equivalent(got: dict[str, Any], want: dict[str, Any], ids: dict[str, str] | None = None) -> None:
    problem = difference(got, want, ids)
    assert problem is None, problem
