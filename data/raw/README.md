# data/raw — read-only source data (gitignored)

This directory is **intentionally empty** in a fresh clone. It holds
downloaded public source files that the pipeline reads but never modifies
(AGENTS.md §2 immutability). Regenerate it by running the downloaders in
README.md's quickstart, in this order:

```bash
./venv/bin/python -m src.ingestion.hifld_download   # -> hifld/*.geojson
./venv/bin/python -m src.ingestion.osm_download     # -> osm/<scene>_{buildings,roads,water,green}.json
./venv/bin/python -m src.ingestion.osm_pois         # -> osm/<scene>_pois.json
./venv/bin/python -m src.ingestion.osm_power        # -> osm/power_infra.json
./venv/bin/python -m src.ingestion.osm_places       # -> osm/statewide_places.json
./venv/bin/python -m src.ingestion.osm_borders      # -> osm/state_borders.json
./venv/bin/python -m src.ingestion.osm_roads_rivers # -> osm/state_roads_rivers.json
```

Expected layout after downloads:

| Path | Contents | Producer |
|---|---|---|
| `filings/*.pdf` | 14 public utility filings (SCRTP project lists, SERTP plans, GA/SC PSC dockets, IRPs) | manual download — direct URLs in `SOURCES.md` |
| `filings/PROJECTS_EXTRACT.md` | per-row citation extract (repo work product) | committed alongside filings |
| `hifld/*.geojson` | HIFLD transmission lines, substations, plants, retail territories | `hifld_download.py` |
| `osm/<scene>_*.json` | buildings/roads/water/green/pois per corridor scene | `osm_download.py`, `osm_pois.py` |
| `osm/power_infra.json` | statewide substations/plants/switchgear (gazetteer input) | `osm_power.py` |
| `osm/state_*.json`, `osm/statewide_places.json` | borders, interstates+rivers, places for the state scene | `osm_borders.py`, `osm_roads_rivers.py`, `osm_places.py` |

**The filings are not scripted-downloadable** — SC PSC DMS attachment URLs and
the SCRTP PDF index are fetched by hand (no stable public API); every file's
URL, publisher, and fetch date is documented in `SOURCES.md`.

All data is public — nothing here required a CEII NDA (SCRTP's CEII-gated
"Reports"/"Base Cases" libraries were deliberately skipped).
