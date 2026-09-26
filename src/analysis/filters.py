"""Shared overlap-record filtering — used by the agent's find_overlaps
tool AND the /api/overlaps.csv export route so both surfaces apply
identical semantics (a download link the agent hands back is faithful
to the result set it described)."""


def filter_records(rows: list[dict],
                   utility: str | None = None,
                   utilities: str | list | None = None,
                   tier: int | None = None,
                   zone: str | None = None,
                   timeline_only: bool = False,
                   adjacent_only: bool = False) -> list[dict]:
    """Apply the record filters in canonical order. Raises ValueError on
    the mutually-exclusive timeline_only+adjacent_only combination —
    callers translate to HTTP 422 (route) or an error dict (tool)."""
    if utility:
        u = str(utility).strip()
        rows = [r for r in rows if u in (r.get("utilities") or [])]
    if utilities:
        pair = utilities if isinstance(utilities, list) else [
            x.strip() for x in str(utilities).split(",") if x.strip()]
        pair = sorted(pair)
        rows = [r for r in rows
                if sorted(r.get("utilities") or []) == pair]
    if tier is not None:
        rows = [r for r in rows if r.get("tier") == int(tier)]
    if zone:
        z = str(zone).strip().lower()
        rows = [r for r in rows if z in (r.get("zone") or "").lower()]
    if timeline_only and adjacent_only:
        raise ValueError("timeline_only and adjacent_only are exclusive — "
                         "adjacent records never intersect")
    if timeline_only:
        rows = [r for r in rows if r.get("timeline_overlap")]
    if adjacent_only:
        rows = [r for r in rows if r.get("timeline_adjacent")
                and not r.get("timeline_overlap")]
    return rows
