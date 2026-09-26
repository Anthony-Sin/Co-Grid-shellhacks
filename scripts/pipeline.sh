#!/usr/bin/env bash
# Full data pipeline: raw -> processed -> overlaps.
# Run from repo root: ./scripts/pipeline.sh
# (Download steps are separate — network-bound, see README quick-start:
#  hifld_download, osm_download, osm_pois, osm_power, osm_places,
#  osm_borders, osm_roads_rivers.)
set -euo pipefail
cd "$(dirname "$0")/.."
PY=./venv/bin/python

echo "==> gazetteer (HIFLD+OSM named facilities)"
$PY -m src.processing.build_gazetteer

echo "==> basemap (HIFLD raw + context ties -> basemap.geojson)"
$PY -m src.processing.build_basemap

echo "==> city scenes (OSM raw -> city_<scene>.json)"
$PY -m src.processing.build_city savannah augusta

echo "==> state scene (borders/corridors/rivers/places -> city_state.json)"
$PY -m src.processing.build_state

echo "==> projects (seeds + HIFLD anchors -> projects.geojson)"
$PY -m src.processing.build_projects

echo "==> overlaps (engine -> overlaps.json)"
$PY -m src.spatial.engine data/processed/projects.geojson data/processed/overlaps.json

echo "==> done. Artifacts in data/processed/"
ls -la data/processed/
