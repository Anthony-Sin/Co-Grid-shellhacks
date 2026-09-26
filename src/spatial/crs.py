"""Shared CRS constants — every meter-space calculation uses these.

The study extent is now all of Georgia + South Carolina. UTM 17N's
central meridian (-81 deg) leaves western GA ~4.5 deg off-axis — up to
~0.2% scale error (~80 m at 40 km), enough to nudge tier-boundary cases.
This Lambert Conformal Conic is fitted to the region (standard parallels
bracketing the GA/SC envelope), keeping conformal error well under 0.1%
end-to-end.
"""

SOURCE_CRS = "EPSG:4326"

# Custom LCC: origin mid-state, parallels at ~31N and ~34.5N.
TARGET_CRS = (
    "+proj=lcc +lat_0=32.5 +lon_0=-82.0 +lat_1=31.0 +lat_2=34.5 "
    "+datum=WGS84 +units=m +no_defs"
)

_KM = 1000.0
