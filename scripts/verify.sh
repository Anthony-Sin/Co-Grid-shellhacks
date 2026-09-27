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
# Scoped to code files only (.py/.ts/.tsx/.mjs): §1 limits "data processing
# scripts" and "UI components" — stylesheets are neither.
fail=0
while IFS= read -r f; do
  n=$(wc -l < "$f")
  if [ "$n" -gt 500 ]; then
    echo "  OVER LIMIT: $f ($n lines)"
    fail=1
  fi
done < <(find src -name '*.py' -o -name '*.tsx' -o -name '*.ts' -o -name '*.mjs' | grep -v node_modules)
[ "$fail" -eq 0 ] && echo "  all source files <= 500 lines"

echo
echo "== processed artifacts present =="
for f in projects.geojson overlaps.json basemap.geojson city_state.json; do
  p="data/processed/$f"
  if [ -f "$p" ]; then echo "  ok $f ($(du -h "$p" | cut -f1))"; else echo "  MISSING $f — run scripts/pipeline.sh"; fail=1; fi
done

echo
echo "== no secrets / raw data / env dirs tracked (AGENTS.md §4) =="
bad_tracked=$(git ls-files | grep -vE '(^|/)\.env\.example$' | grep -cE '(^|/)\.env($|\.)|(^|/)venv/|(^|/)node_modules/|\.(pem|key)$|^secrets/' || true)
bad_raw=$(git ls-files 'data/raw/*' | grep -vcE '^data/raw/(\.gitkeep|README\.md|SOURCES\.md)$' || true)
if [ "$bad_tracked" -gt 0 ] || [ "$bad_raw" -gt 0 ]; then
  echo "  TRACKED FILES THAT SHOULD NOT BE COMMITTED:"
  git ls-files | grep -vE '(^|/)\.env\.example$' | grep -E '(^|/)\.env($|\.)|(^|/)venv/|(^|/)node_modules/|\.(pem|key)$|^secrets/' || true
  git ls-files 'data/raw/*' | grep -vE '^data/raw/(\.gitkeep|README\.md|SOURCES\.md)$' || true
  fail=1
else
  echo "  clean — no .env/venv/node_modules/secrets/raw-data tracked"
fi

echo
if [ "$fail" -eq 0 ]; then echo "verify complete."; else echo "verify FAILED — see flagged items above"; exit 1; fi
