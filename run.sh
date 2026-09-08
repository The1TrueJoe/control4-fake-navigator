#!/usr/bin/env bash
# One-command local run (no Docker). Loads .env if present (live), else DEMO mode.
#   ./run.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && { set -a; . ./.env; set +a; echo "loaded .env (live: $C4_HOST)"; }
if [ ! -d frontend/dist ]; then echo "building UI..."; (cd frontend && npm install && npm run build); fi
cd backend
echo "starting backend on :${HTTP_ADDR:-0.0.0.0:8080} (UI) + :${SINK_ADDR:-0.0.0.0:9010} (driver sink)"
exec cargo run --release
