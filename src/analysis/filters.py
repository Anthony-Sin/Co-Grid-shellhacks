"""Shared overlap-record filtering — used by the agent's find_overlaps
tool AND the /api/overlaps.csv export route so both surfaces apply
identical semantics (a download link the agent hands back is faithful
to the result set it described)."""

# Zone labels are state-derived; a record's composite zone ('a / b')
# touches both sides honestly — a state filter keeps records whose zone
# mentions ANY zone of that state (river-border composites count both).
_GA_ZONES = {
    "athens", "atlanta", "augusta", "central_ga", "columbus", "macon",
    "north_ga", "savannah", "south_ga",
}
_SC_ZONES = {
    "beaufort", "charleston", "columbia", "greenville", "lowcountry",
    "midlands", "peedee", "west_sc",
}


def _state_match(zone_label: str, state: str) -> bool:
    parts = {z.strip() for z in (zone_label or "").lower().split(" / ")}
    if state == "ga":
        return bool(parts & _GA_ZONES)
    if state == "sc":
        return bool(parts & _SC_ZONES)
    return True


def filter_records(rows: list[dict],
                   utility: str | None = None,
                   utilities: str | list | None = None,
                   tier: int | None = None,
                   zone: str | None = None,
                   state: str | None = None,
                   timeline_only: bool = False,
                   adjacent_only: bool = False,
                   missing_dates: bool = False) -> list[dict]:
    """Apply the record filters in canonical order. Raises ValueError on
    the mutually-exclusive timeline_only+adjacent_only combination, a
    single-name `utilities` (a pair can never match), or an unknown
    `state` — callers translate to HTTP 422 (route) or an error dict
    (tool)."""
    if utility:
        u = str(utility).strip()
        rows = [r for r in rows if u in (r.get("utilities") or [])]
    if utilities:
        pair = utilities if isinstance(utilities, list) else [
            x.strip() for x in str(utilities).split(",") if x.strip()]
        if len(pair) == 1:
            raise ValueError(
                "utilities expects an exact PAIR like 'GPC,MEAG' — "
                "for a single side use utility= instead")
        pair = sorted(pair)
        rows = [r for r in rows
                if sorted(r.get("utilities") or []) == pair]
    if tier is not None:
        rows = [r for r in rows if r.get("tier") == int(tier)]
    if zone:
        z = str(zone).strip().lower()
        rows = [r for r in rows if z in (r.get("zone") or "").lower()]
    if state:
        s = str(state).strip().lower()
        if s not in ("ga", "sc", "georgia", "south carolina"):
            raise ValueError(f"unknown state '{state}' — use ga|sc")
        s = "ga" if s == "georgia" else "sc" if s == "south carolina" else s
        rows = [r for r in rows if _state_match(r.get("zone") or "", s)]
    if timeline_only and adjacent_only:
        raise ValueError("timeline_only and adjacent_only are exclusive — "
                         "adjacent records never intersect")
    if timeline_only:
        rows = [r for r in rows if r.get("timeline_overlap")]
    if adjacent_only:
        rows = [r for r in rows if r.get("timeline_adjacent")
                and not r.get("timeline_overlap")]
    if missing_dates:
        # "no dates" = neither a shared window nor an adjacent handoff —
        # at least one side filed no build years
        rows = [r for r in rows
                if not r.get("shared_window") and not r.get("adjacent_window")]
    return rows
