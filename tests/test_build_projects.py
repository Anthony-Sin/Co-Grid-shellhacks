"""Facility-name resolution rules for the seed build.

The seed uses "facility"/"endpoints" specs resolved against the gazetteer.
Regression target: same-named entries at DIFFERENT real sites (e.g. two
"Goshen Substation"s ~140km apart) must error, never silently pick one.
"""
import pytest

from src.processing.build_projects import resolve_facility, _norm

# index rows: (norm_name, layer, lon, lat)
IDX = [
    (_norm("McIntosh Substation"), "substation", -81.17, 32.36),
    (_norm("Goshen Substation"), "substation", -81.2095, 32.2487),   # Savannah-area
    (_norm("Goshen Substation"), "substation", -81.9953, 33.3198),   # Augusta-area
    (_norm("Plant Vogtle"), "plant", -81.765, 33.143),
    (_norm("Vogtle Switchyard"), "substation", -81.7648, 33.1429),   # ~35m from plant
]


def test_exact_unique_resolves():
    assert resolve_facility("McIntosh Substation", IDX) == (-81.17, 32.36)


def test_same_name_far_apart_is_ambiguous():
    with pytest.raises(KeyError, match="ambiguous"):
        resolve_facility("Goshen Substation", IDX)


def test_clustered_duplicates_count_as_one_facility():
    # 'VOGTLE' substring-matches plant + switchyard ~35m apart: same site,
    # deterministic pick (sorted-first) rather than set-order luck
    assert resolve_facility("Vogtle", IDX) == (-81.765, 33.143)


def test_no_match_errors():
    with pytest.raises(KeyError, match="no match"):
        resolve_facility("qxz blorf", IDX)
