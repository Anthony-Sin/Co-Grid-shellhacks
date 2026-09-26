# Agent Rules: Gridlock Challenge

## 1. Modularity & File Size Limits
Enforce strict modularity on the project code to ensure rapid iteration during the hackathon:
* **Owned sources:** Data ingestion scripts, geospatial analysis logic, API routes, UI components, and tests.
* **Third-party / External:** Public utility filings (IRPs, 10-Year Plans), HIFLD GIS shapefiles, and open-source libraries.
* **Limit:** If any data processing script or UI component exceeds **500 lines**, split it into cohesive modules (e.g., separate the spatial indexing logic from the raw data parser).

## 2. Preserve Raw Data (Immutability)
* Treat all downloaded utility data (PDFs, CSVs, GIS shapefiles) as **strictly read-only**.
* Never manually edit raw data files to fix formatting. All cleaning, normalization, and standardization must be done via reproducible Python/Node scripts.
* Store raw data in a dedicated `data/raw/` folder and output processed/merged data to `data/processed/`.

## 3. Development Environment
* Run all code inside a designated virtual environment (e.g., `./venv/bin/python` or standard `npm/yarn` workspaces).
* Keep backend processing and frontend UI decoupled. Run the backend API on a local port (e.g., `127.0.0.1:8000`) and the UI/Dashboard on another (e.g., `127.0.0.1:3000`).
* Use mock JSON payloads *only* for initial UI skeleton building, but they must be replaced by real data before final testing.

## 4. Git & Version Control
Hackathons move fast; local commits are your safety net.
* Commit **locally** once a slice of work (e.g., "parsed GPC timeline", "added 40km radius calculation") is verified.
* Do not push to `origin/main` until a feature is fully working and doesn't break the map UI.
* Never commit secrets, API keys (e.g., Mapbox tokens), environment folders (`venv`, `node_modules`), or massive raw dataset files (use `.gitignore`).

## 5. Standard Change Checklist
Before declaring a task complete, verify the following:
1. **Scope:** Does this directly address the UI, the overlap algorithm, or data parsing?
2. **Logic Check:** Are spatial distances calculated accurately (e.g., using Haversine formula or proper map projections like EPSG:3857)?
3. **Domain Check:** Does the logic respect the timeline overlap and the exact distance tiers (Touching, <1.6km, <8km, <40km)?
4. **Commit:** Commit locally.

## 6. Geospatial Guardrails & Optimization
Calculating point-to-point or line-to-line distances between hundreds of utility assets can computationally explode ($O(N^2)$).
* **Spatial Indexing:** Never do a brute-force cross-join of all coordinates. Use bounding boxes or spatial indexes (e.g., R-Trees, `geopandas.sjoin`, Shapely) to filter out projects that are obviously further than 40km apart before doing exact distance math.
* **Resource limits:** If running heavy GIS processing, ensure memory is monitored. If a script OOM-kills, reduce the dataset to a single county or a single year to test the logic first.

## 7. Strict Data Authenticity (No Fake Scenarios)
* **No Hallucinations:** Never generate, display, or inject fake, mock, or artificially created utility projects, transmission lines, or overlaps. 
* **Real Scenarios Only:** When visualizing coordination scenarios (like the DESC and GPC Savannah River overlap), the UI and backend must rely *strictly* on verified, publicly filed data (IRPs, 10-Year Plans, and HIFLD).
* **Honest Output:** If the algorithm genuinely finds zero overlaps in a certain region or timeframe, the UI must accurately display zero overlaps. Do not falsify or force matches just to make the dashboard look busy.

## 8. Challenge-Specific Domain Rules
When writing logic or UI components, strictly adhere to the Gridlock Challenge criteria:
* **The 40km Rule:** Geographic overlap is the primary signal. The maximum threshold is 40km. Calculate distance based on the *closest points* between two projects, not their center points.
* **Ranking Tiers:** Ensure the output data structure automatically ranks overlaps by value: 
  * *Tier 1:* Touching / crossing
  * *Tier 2:* < 1.6 km (Shared right-of-way)
  * *Tier 3:* < 8 km (Shared logistics)
  * *Tier 4:* < 40 km (Shared crews)
* **Timeline Match:** Treat timeline overlap as the mandatory secondary signal. A 1.6km spatial overlap means nothing if one project is in 2027 and the other is in 2035.
* **No CEII:** Strictly utilize publicly available data. If a dataset requires a Critical Energy Infrastructure Information (CEII) NDA, immediately discard it.
* **Deliverable Focus:** All data pipelines must culminate in the required deliverables: **(1)** An interactive UI/Map, and **(2)** A ranked list of top coordination opportunities.

## 9. Workspace Layout (Suggested)
* `data/raw/` — Unaltered HIFLD files, DESC/GPC project lists.
* `src/ingestion/` — Scripts to parse utility PDFs/tables into a standardized schema `[Project ID, Utility, Start_Date, End_Date, Geometry]`.
* `src/spatial/` — The core logic for calculating the 40km intersections and ranking tiers.
* `src/ui/` — The interactive map dashboard (e.g., Streamlit, React-Leaflet, or Mapbox).
* `.env` — API keys for mapping libraries.