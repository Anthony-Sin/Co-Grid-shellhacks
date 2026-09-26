"""Timeline-overlap logic — the mandatory secondary signal.

Three outcomes, honestly distinguished:

  "intersect" — build windows genuinely share calendar years. Crews,
    outages, and laydown can overlap in time AND space.
  "adjacent"  — windows don't intersect but end/start within slack years.
    Crews could roll site-to-site, but there is NO concurrent shared
    window — calling this an "overlap" would be wrong.
  None        — windows don't meet even with slack, or dates are missing.
    Missing dates are never assumed into a match.

Unknown years are treated honestly: flagged unknown, never assumed.
"""
from __future__ import annotations

from typing import Optional

# Years of slack allowed between windows to still count as "adjacent"
# (crews/equipment mobilized for one project can roll to a neighbor).
ADJACENCY_SLACK_YEARS = 1

WindowKind = Optional[str]  # "intersect" | "adjacent" | None


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
) -> tuple[WindowKind, Optional[dict]]:
    """Return (kind, window).

    kind="intersect": window is the true intersection {start,end}.
    kind="adjacent":  window is the between-years gap {start,end} — the
                      handoff bridge, NOT a shared window.
    kind=None:        window is None.
    """
    wa = _window(a_start, a_end)
    wb = _window(b_start, b_end)
    if wa is None or wb is None:
        return None, None
    s = max(wa[0], wb[0])
    e = min(wa[1], wb[1])
    if s <= e:
        return "intersect", {"start": _i(s), "end": _i(e)}
    if s - e <= slack_years:
        return "adjacent", {"start": _i(e), "end": _i(s)}
    return None, None
