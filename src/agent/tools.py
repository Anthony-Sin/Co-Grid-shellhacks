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
    tool_playbook, tool_staging_clusters, tool_timeline_summary,
    tool_utility_matrix, tool_why_ranked,
)
from .tool_reports import (
    tool_handoff_chains, tool_savings_rollup, tool_season_calendar,
    tool_utility_profile, tool_voltage_match, tool_zone_report,
)
from .tool_whatif import tool_what_if_drop_utility, tool_what_if_shift
from .tool_map import tool_map_focus
from .tool_export import tool_export_data
from .tool_data import (
    tool_data_health, tool_find_overlaps, tool_gazetteer, tool_get_overlap,
    tool_get_project, tool_list_projects, tool_no_overlap_reason,
    tool_project_overlaps, tool_projects_near, tool_stats,
    tool_top_overlaps,
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
        "List planned utility projects. Filter by utility ('DESC','GPC','SanteeCooper'), "
        "zone tag, or a substring of the provenance source (e.g. '2025 IRP', 'GTC').",
        {"utility": "string (optional)", "zone": "string (optional)",
         "source": "string substring of the provenance source (optional)",
         "limit": "int <=50 (optional)"},
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
        "Full detail for overlap records — includes `members` resolving each "
        "side to name/utility/voltage/window/filing source, so one call fully "
        "cites an opportunity. Pass overlap_id for one record, or overlap_ids "
        "(list, <=30) to fetch several — prefer the list form.",
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
        "pair 'GPC,DESC'), tier, zone substring, timeline_only "
        "(intersecting) OR adjacent_only (end-to-start handoffs — a "
        "different coordination class). Engine rank order. Returns a "
        "csv_export link — same filters on /api/overlaps.csv — you can "
        "hand to the analyst for the full result as a spreadsheet.",
        {"utility": "string (optional, either side)",
         "utilities": "string 'A,B' or list (optional, exact pair)",
         "tier": "int 1-4 (optional)", "zone": "string (optional)",
         "timeline_only": "bool (optional)",
         "adjacent_only": "bool (optional, exclusive w/ timeline_only)",
         "limit": "int <=50 (optional)"},
    ),
    "project_overlaps": (
        tool_project_overlaps,
        "Every coordination record touching one project_id — its full "
        "coordination portfolio with the counterparty named per record.",
        {"project_id": "string (required)"},
    ),
    "no_overlap_reason": (
        tool_no_overlap_reason,
        "Why a project has ZERO records: nearest cross-utility project + "
        "closest-point distance (>=40km = outside radius, the honest "
        "reason), nearest same-utility neighbor (excluded by rule). "
        "Answers 'why NOT', not just 'what'.",
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
    "handoff_chains": (
        tool_handoff_chains,
        "Crew-relay chains: maximal sequences of end-to-start (adjacent) "
        "records a shared crew could roll through — the longest honest "
        "relays across utilities. Each hop is a real record.",
        {},
    ),
    "voltage_match": (
        tool_voltage_match,
        "Equipment-class view: records where both projects share the "
        "same kV (conductor/hardware family) vs interface pairs across "
        "classes (autobank ties). Buckets by voltage class.",
        {"tier": "int 1-4 (optional)", "limit": "int <=50 (optional)"},
    ),
    "utility_profile": (
        tool_utility_profile,
        "One-shot brief for ONE utility: project count/kinds, program "
        "window span, coordination partners + record counts, tier "
        "histogram, top-3 scored records. Use for 'tell me about X'.",
        {"utility": "string (required — stats.projects_by_utility)"},
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
    "map_focus": (
        tool_map_focus,
        "Drive the user's interactive map: select + fly to an overlap or "
        "project, fly the camera to a named place/metro/facility, restrict "
        "the visible tiers, filter to one utility, or clear everything "
        "(reset selection + filters). Ids and places are validated against "
        "the loaded data — unknown names return honest errors, so resolve "
        "real ids first (get_overlap/top_overlaps/list_projects/gazetteer). "
        "Use when the user says 'show me …', 'zoom to …', or right after "
        "citing a record worth looking at; then describe what the map is "
        "showing — only claim a move the ui_action actually carried out.",
        {"overlap_id": "string (optional) — select + zoom to a record",
         "project_id": "string (optional) — select + zoom to a project",
         "utility": "string (optional) — filter map to one utility",
         "tiers": "list<int> 1-4 (optional) — visible tiers",
         "place": "string (optional) — fly the camera to a metro/place/"
                  "facility name (Atlanta, Columbia, Plant Vogtle…)",
         "clear": "bool (optional) — reset selection + all filters"},
    ),
    "export_data": (
        tool_export_data,
        "Create a downloadable CSV/Excel/HTML file of the REAL overlap/"
        "project data — same records and filters as find_overlaps/"
        "list_projects, never fabricated rows. Use when the user asks for "
        "a spreadsheet, export, doc, or report ('give me a csv', 'excel "
        "sheet of tier-1 overlaps', 'project list for DESC'). Then link "
        "it for the user like [Download CSV](url) using the returned url.",
        {"format": "string csv|xlsx|html (optional, default csv)",
         "kind": "string overlaps|projects (optional, default overlaps)",
         "utility": "string (optional, either side for overlaps)",
         "utilities": "string 'A,B' or list (optional, exact pair — overlaps only)",
         "tier": "int 1-4 (optional — overlaps only)",
         "zone": "string (optional) — zone substring / project zone tag",
         "source": "string substring of the provenance source (optional — projects only)",
         "timeline_only": "bool (optional — overlaps only)",
         "adjacent_only": "bool (optional — overlaps only, exclusive w/ timeline_only)",
         "limit": "int <=2000 (optional, default 200)"},
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
