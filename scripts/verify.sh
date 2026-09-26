#!/usr/bin/env bash
# One-shot verification for the repo — run before demoing or merging.
# pytest (backend logic + routes) · tsc (UI types) · vite build ·
# 500-line rule audit · file-size guard on tracked source files.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== backend tests =="
./venv/bin/python -m pytest tests/ -x -q

echo
echo "== frontend typecheck + build =="
(cd src/ui && npm run build >/dev/null && echo "tsc + vite build ok")

echo
echo "== 500-line rule (AGENTS.md §1) =="
fail=0
while IFS= read -r f; do
  n=$(wc -l < "$f")
  if [ "$n" -gt 500 ]; then
    echo "  OVER LIMIT: $f ($n lines)"
    fail=1
  fi
done < <(find src -name '*.py' -o -name '*.tsx' -o -name '*.ts' | grep -v node_modules)
[ "$fail" -eq 0 ] && echo "  all source files <= 500 lines"

echo
echo "== processed artifacts present =="
for f in projects.geojson overlaps.json basemap.geojson city_state.json; do
  p="data/processed/$f"
  if [ -f "$p" ]; then echo "  ok $f ($(du -h "$p" | cut -f1))"; else echo "  MISSING $f — run scripts/pipeline.sh"; fi
done

echo
echo "verify complete."
