"""Timeline-overlap logic — the mandatory secondary signal.

A project pair only counts as a coordination opportunity when the build
windows intersect (or are adjacent — crews can roll from one to the next).
Unknown years are treated honestly: flagged unknown, never assumed overlap.
"""
from __future__ import annotations

from typing import Optional

# Years of slack allowed between windows to still count as "coordinated"
# (crews/equipment mobilized for one project can roll to a neighbor).
ADJACENCY_SLACK_YEARS = 1


def _clean(v):
    """None-out NaN (pandas reads missing ints as float NaN)."""
    return None if v is None or v != v else v  # noqa: PLR0124 — NaN != NaN


def _window(start: Optional[int], end: Optional[int]) -> Optional[tuple[int, int]]:
    start, end = _clean(start), _clean(end)
    if start is None and end is None:
        return None
    s = start if start is not None else end
    e = end if end is not None else start
    return (min(s, e), max(s, e))  # type: ignore[arg-type]


def _i(v) -> int:
    """int() that also unwraps numpy integer scalars from pandas cells."""
    return int(v)


def windows_overlap(
    a_start: Optional[int],
    a_end: Optional[int],
    b_start: Optional[int],
    b_end: Optional[int],
    slack_years: int = ADJACENCY_SLACK_YEARS,
) -> tuple[bool, Optional[dict]]:
    """Return (overlaps, shared_window).

    shared_window = {"start": x, "end": y} intersection when known.
    If either side lacks dates entirely -> (False, None); caller treats
    this as "timeline unknown", which is NOT falsified into a match.
    """
    wa = _window(a_start, a_end)
    wb = _window(b_start, b_end)
    if wa is None or wb is None:
        return False, None
    s = max(wa[0], wb[0])
    e = min(wa[1], wb[1])
    if s <= e:
        return True, {"start": _i(s), "end": _i(e)}
    if s - e <= slack_years:
        # Adjacent within slack: report the gap bridge as the shared window.
        return True, {"start": _i(e), "end": _i(s)}
    return False, None
