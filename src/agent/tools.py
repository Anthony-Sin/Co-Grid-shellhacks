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
    tool_define, tool_exec_summary, tool_impact_estimate,
    tool_outage_conflicts, tool_playbook, tool_staging_clusters,
    tool_timeline_summary, tool_utility_matrix,
)
from .tool_data import (
    tool_data_health, tool_gazetteer, tool_get_overlap, tool_get_project,
    tool_list_projects, tool_projects_near, tool_stats, tool_top_overlaps,
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
        "Full detail for one overlap record by overlap_id.",
        {"overlap_id": "string (required)"},
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
        "Overlaps grouped by shared staging radius — where one crew yard "
        "could serve multiple coordination sites (40 km rule).",
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
