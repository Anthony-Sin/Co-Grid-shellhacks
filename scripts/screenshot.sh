#!/usr/bin/env bash
# Headless UI capture — thin wrapper around scripts/screenshot.mjs.
#
# Requires: dev server (127.0.0.1:3210) + API (127.0.0.1:8000) running
# and `npm install` done in src/ui (puppeteer-core is a devDependency).
#
# Usage:
#   ./scripts/screenshot.sh                       # all presets -> shots/
#   ./scripts/screenshot.sh --out=/tmp/shots      # custom output dir
#   ./scripts/screenshot.sh "name|select=OV-0004&panel=0"
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/screenshot.mjs "$@"
