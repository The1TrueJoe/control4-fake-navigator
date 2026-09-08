#!/usr/bin/env bash
# One-command local run (no Docker). DEMO mode unless C4_HOST/C4_TOKEN are set.
#   ./run.sh                                  # demo (bundled sample project)
#   C4_HOST=https://10.0.0.107 C4_TOKEN=... ./run.sh   # live
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d frontend/dist ]; then
  echo "building UI..."; (cd frontend && npm install && npm run build)
fi
cd backend
echo "starting backend on :8080 (UI) + :9010 (driver sink)"
exec env WEB_DIR=../frontend/dist cargo run --release
