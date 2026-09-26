"""Tool registry — every function the analyst model may call.

Implementations live in `tool_data.py` (record access over processed
artifacts) and `tool_analysis.py` (src.analysis-backed analytics + the
challenge glossary). This module maps names → (fn, description, args)
and executes calls safely: unknown tools / bad args become data, not
crashes.
"""
from __future__ import annotations

from typing import Any, Callable

from .tool_analysis import (
    tool_compare_overlaps, tool_define, tool_exec_summary,
    tool_impact_estimate, tool_outage_conflicts, tool_overlap_neighbors,
    tool_playbook, tool_savings_rollup, tool_season_calendar,
    tool_staging_clusters,
    tool_timeline_summary, tool_utility_matrix, tool_what_if_drop_utility,
    tool_what_if_shift, tool_why_ranked, tool_zone_report,
)
from .tool_data import (
    tool_data_health, tool_find_overlaps, tool_gazetteer, tool_get_overlap,
    tool_get_project, tool_list_projects, tool_project_overlaps,
    tool_projects_near, tool_stats, tool_top_overlaps,
)

TOOLS: dict[str, tuple[Callable[..., Any], str, dict]] = {
    "stats": (tool_stats, "Dataset-wide counts: projects per utility, overlaps per tier.", {}),
    "exec_summary": (
        tool_exec_summary,
        "Program headline card: project/overlap counts, dominant utility pair, "
        "peak build season, mandatory joint-outage count, top opportunity. "
        "Best first call for 'what does the data say' questions.",
        {},
    ),
    "list_projects": (
        tool_list_projects,
        "List planned utility projects. Filter by utility ('DESC','GPC','SanteeCooper') or zone tag.",
        {"utility": "string (optional)", "zone": "string (optional)", "limit": "int <=50 (optional)"},
    ),
    "get_project": (
        tool_get_project,
        "Full record of one planned project by project_id.",
        {"project_id": "string (required)"},
    ),
    "top_overlaps": (
        tool_top_overlaps,
        "Top-N ranked coordination opportunities. Optional tier (1-4) and timeline_only filters.",
        {"n": "int <=50 (optional)", "tier": "int 1-4 (optional)", "timeline_only": "bool (optional)"},
    ),
    "get_overlap": (
        tool_get_overlap,
        "Full detail for overlap records. Pass overlap_id for one record, "
        "or overlap_ids (list, <=30) to fetch several in one call — prefer "
        "the list form for multi-record questions.",
        {"overlap_id": "string (single record)",
         "overlap_ids": "list<string> <=30 (batch fetch)"},
    ),
    "projects_near": (
        tool_projects_near,
        "Planned projects within `km` of a lon/lat point.",
        {"lon": "float (required)", "lat": "float (required)", "km": "float 1-200 (optional)"},
    ),
    "timeline_summary": (
        tool_timeline_summary,
        "Per-year build activity per utility + overlap-window stats.",
        {},
    ),
    "impact_estimate": (
        tool_impact_estimate,
        "Resource-sharing analysis for one overlap: what can be jointly used, "
        "staging logistics, shared build-months, stored cost figures.",
        {"overlap_id": "string (required)"},
    ),
    "gazetteer": (
        tool_gazetteer,
        "Resolve real grid facilities (substations, plants) by name to lon/lat "
        "— use when a project references a named facility.",
        {"name": "string (required)", "limit": "int <=25 (optional)"},
    ),
    "data_health": (
        tool_data_health,
        "Dataset quality report: missing build dates, location-confidence "
        "breakdown, source families, overlap timeline coverage.",
        {},
    ),
    "staging_clusters": (
        tool_staging_clusters,
        "Engine-built yard network: yards_needed (each cluster servable "
        "within radius_km) + wider corridor groupings (connectivity "
        "context — a corridor count is NOT a single-yard reach). For "
        "'what does a yard AT THIS ONE SITE reach' use overlap_neighbors.",
        {"radius_km": "float 5-200 (optional)", "top": "int <=30 (optional)"},
    ),
    "playbook": (
        tool_playbook,
        "Executable coordination plan: per staging cluster, the minimal "
        "season-years covering all windowed sites + peak concurrent "
        "workload (crew sizing).",
        {"radius_km": "float 5-200 (optional)", "top": "int <=20 (optional)"},
    ),
    "utility_matrix": (
        tool_utility_matrix,
        "Overlap counts per utility pair with tier split — who coordinates "
        "with whom, ranked by volume.",
        {},
    ),
    "outage_conflicts": (
        tool_outage_conflicts,
        "Tier-1 touching overlaps WITH intersecting build windows — the "
        "mandatory joint-outage scheduling list, bucketed by season year.",
        {},
    ),
    "find_overlaps": (
        tool_find_overlaps,
        "Filtered overlap search: utility (either side), utilities (exact "
        "pair 'GPC,DESC'), tier, zone substring, timeline_only. Engine "
        "rank order. Use for 'all X overlaps in Y' questions.",
        {"utility": "string (optional, either side)",
         "utilities": "string 'A,B' or list (optional, exact pair)",
         "tier": "int 1-4 (optional)", "zone": "string (optional)",
         "timeline_only": "bool (optional)", "limit": "int <=50 (optional)"},
    ),
    "project_overlaps": (
        tool_project_overlaps,
        "Every coordination record touching one project_id — its full "
        "coordination portfolio with the counterparty named per record.",
        {"project_id": "string (required)"},
    ),
    "compare_overlaps": (
        tool_compare_overlaps,
        "Side-by-side comparison of 2-8 overlap records + a deltas "
        "summary (closest, earliest window, best score, largest savings).",
        {"overlap_ids": "list<string> 2-8 (required)"},
    ),
    "why_ranked": (
        tool_why_ranked,
        "Transparent score decomposition for one overlap — tier base, "
        "distance-within-tier, timeline bonus, voltage bonus.",
        {"overlap_id": "string (required)"},
    ),
    "zone_report": (
        tool_zone_report,
        "One-shot brief for a zone tag: project/overlap counts, tier "
        "histogram, dominant utility pair, top-3 records.",
        {"zone": "string (required — see stats.zones_available)"},
    ),
    "savings_rollup": (
        tool_savings_rollup,
        "Aggregate sharing value across filtered records — summed stored "
        "cost fields (tiers <=tier_max; 3-4 carry $0 land).",
        {"zone": "string (optional)", "utility": "string (optional)",
         "tier_max": "int 1-4 (optional, default 2)"},
    ),
    "overlap_neighbors": (
        tool_overlap_neighbors,
        "Exact per-site yard reach: every other overlap record within "
        "radius_km of THIS record's midpoint — prefer this over "
        "staging_clusters for 'what does a yard at this site reach' "
        "(clusters are engine-built groups; this is the ad-hoc radius).",
        {"overlap_id": "string (required)",
         "radius_km": "float (optional, default 40)"},
    ),
    "season_calendar": (
        tool_season_calendar,
        "THE tool for 'what joint work is schedulable in YEAR' — "
        "overlaps bucketed by shared-window start year (concurrent "
        "windows only; adjacent-only records never appear). Omit year "
        "for the whole calendar.",
        {"year": "int (optional — one season's full slate)"},
    ),
    "what_if_shift": (
        tool_what_if_shift,
        "Counterfactual: if one project's window moved to [new_start,"
        "new_end], which of its overlap records keep a timeline "
        "relationship? Labeled hypothetical — recomputed from the other "
        "project's filed window.",
        {"project_id": "string (required)",
         "new_start": "int year (required)", "new_end": "int year (required)"},
    ),
    "what_if_drop_utility": (
        tool_what_if_drop_utility,
        "Counterfactual partner exit: if this utility's projects left, "
        "every record touching it dies (records need both parties). "
        "Reports lost value by tier + which partners lose the most. "
        "Labeled hypothetical.",
        {"utility": "string (required)"},
    ),
    "define": (
        tool_define,
        "Define a grid-planning term (IRP, SERTP, SCRTP, CEII, right-of-way, "
        "Order 1920, tiers, 40km rule...) from the challenge glossary.",
        {"term": "string (required)"},
    ),
}


def openai_tool_specs() -> list[dict]:
    """OpenAI `tools` payload — permissive schemas (small models)."""
    specs = []
    for name, (_, desc, props) in TOOLS.items():
        spec_props = {
            k: {"type": "number" if "float" in v else "integer" if "int" in v
                else "boolean" if "bool" in v else "string",
                "description": v}
            for k, v in props.items()
        }
        required = [k for k, v in props.items() if "required" in v]
        specs.append({
            "type": "function",
            "function": {
                "name": name,
                "description": desc,
                "parameters": {"type": "object", "properties": spec_props,
                               "required": required},
            },
        })
    return specs


def run_tool(name: str, args: dict) -> dict:
    """Execute a tool safely — unknown tools / bad args become data, not crashes."""
    entry = TOOLS.get(name)
    if not entry:
        return {"error": f"unknown tool '{name}'"}
    fn = entry[0]
    try:
        clean = {k: v for k, v in (args or {}).items() if v is not None}
        return {"ok": True, "result": fn(**clean)}
    except TypeError as e:
        return {"error": f"bad args for {name}: {e}"}
    except FileNotFoundError as e:
        return {"error": str(e)}
    except Exception as e:  # never let a tool crash the loop
        return {"error": f"{name} failed: {type(e).__name__}: {e}"}
