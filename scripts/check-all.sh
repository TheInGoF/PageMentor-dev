#!/usr/bin/env bash
# Alle lokalen Prüfungen, wie im CI
set -euo pipefail
cd "$(dirname "$0")/.."

scripts/check-lines.sh
scripts/check-changelog.sh
(cd backend && npx tsc --noEmit -p . && bun test && bun scripts/smoke.ts)
(cd frontend && npm run build >/dev/null)
PY="pm-gpu-arbiter pm-qwen-tts pm-tts-common pm-kokoro-tts pm-f5-tts pm-tada-tts"
python3 -m pyflakes $PY 2>/dev/null || python3 -m compileall -q $PY
echo "Alle Prüfungen bestanden"
