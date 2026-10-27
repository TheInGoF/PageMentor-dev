#!/usr/bin/env bash
# Alle lokalen Prüfungen, wie im CI
set -euo pipefail
cd "$(dirname "$0")/.."

scripts/check-lines.sh
(cd backend && npx tsc --noEmit -p . && bun scripts/smoke.ts)
(cd frontend && npm run build >/dev/null)
python3 -m compileall -q pm-gpu-arbiter pm-qwen-tts pm-audio-analyzer
echo "Alle Prüfungen bestanden"
