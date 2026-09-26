"""Pydantic models mirroring docs/DATA_SCHEMA.md.

These are the single source of truth for record shapes passed between
ingestion -> processing -> spatial engine -> api.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Utility = Literal["GPC", "DESC", "SanteeCooper", "MEAG", "Other"]
ProjectKind = Literal[
    "transmission_line", "substation", "plant", "upgrade", "reconductor"
]
LocationConfidence = Literal["verified", "endpoint_only", "approximate"]
ProjectStatus = Literal["planned", "under_construction", "proposed"]


class ProjectProps(BaseModel):
    """Properties block of a planned-project GeoJSON Feature."""

    project_id: str
    utility: str
    name: str
    kind: ProjectKind
    voltage_kv: Optional[float] = None
    start_year: Optional[int] = None
    end_year: Optional[int] = None
    status: ProjectStatus = "planned"
    location_confidence: LocationConfidence = "approximate"
    source: str = ""
    notes: str = ""


class BasemapProps(BaseModel):
    """Properties block for existing-grid (HIFLD) features."""

    layer: Literal[
        "existing_transmission_line",
        "existing_substation",
        "existing_power_plant",
        "service_territory",
    ]
    name: str = ""
    owner: str = "unknown"
    voltage_kv: Optional[float] = None
    source: str = "HIFLD"


TIER_LABELS = {1: "touching", 2: "shared_row", 3: "shared_logistics", 4: "shared_crews"}
TIER_DESCRIPTIONS = {
    1: "Touching/crossing — must coordinate outages & crossing structures",
    2: "< 1.6 km — can share right-of-way, access roads, permits",
    3: "< 8 km — can share laydown yards & site logistics",
    4: "< 40 km — can share crews, cranes, contractors",
}


class OverlapRecord(BaseModel):
    """One ranked coordination opportunity (docs/DATA_SCHEMA.md §4)."""

    overlap_id: str
    project_a: str
    project_b: str
    utilities: list[str]
    min_distance_km: float
    tier: int = Field(ge=1, le=4)
    tier_label: str
    tier_threshold_km: float
    timeline_overlap: bool  # True ONLY for true window intersections
    timeline_adjacent: bool = False  # windows end/start within slack — roll-over, not overlap
    shared_window: Optional[dict] = None  # intersection only; None when adjacent/unknown
    adjacent_window: Optional[dict] = None  # the between-years gap when adjacent
    max_voltage_kv: Optional[float] = None  # higher of the two projects' filed voltage
    closest_point_a: tuple[float, float]
    closest_point_b: tuple[float, float]
    midpoint: tuple[float, float]
    score: float
    explanation: str = ""
    cost: Optional[dict] = None
    zone: str = "savannah_river_corridor"
    # GeoJSON polygon (WGS84): the "coordination zone" drawn as a hatched
    # highlight on the map — bridge between the two closest points.
    zone_geometry: Optional[dict] = None
