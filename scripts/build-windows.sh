#!/usr/bin/env bash
# Windows-Paket bauen: <ziel>/PageMentor.exe, public/, bin/
# Auf Windows mit Icon und ohne Konsolenfenster, sonst Cross-Compile
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=$(realpath -m "${1:-dist/PageMentor}")
VERSION=$(tr -d '\r\n' < VERSION)
rm -rf "$OUT"
mkdir -p "$OUT"

echo "Frontend bauen"
(cd frontend && npm ci --no-audit --no-fund >/dev/null && npx vite build --outDir "$OUT/public" --emptyOutDir >/dev/null)

echo "Backend-Abhängigkeiten"
(cd backend && bun install --frozen-lockfile 2>/dev/null || bun install)

FLAGS=()
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    FLAGS+=(--windows-hide-console --windows-icon=packaging/windows/app.ico
      --windows-title=PageMentor --windows-publisher=PageMentor
      --windows-version="$VERSION.0" --windows-description="PageMentor")
    ;;
esac

echo "Exe bauen, Version $VERSION"
# Fenster läuft als Worker und muss mit in die Exe
bun build backend/src/index.ts backend/src/desktop/window.ts --compile --target=bun-windows-x64 "${FLAGS[@]}" \
  --define "process.env.PM_BUILD_VERSION=\"$VERSION\"" \
  --outfile "$OUT/PageMentor.exe"

if [ -z "${SKIP_TOOLS:-}" ]; then
  scripts/fetch-windows-tools.sh "$OUT/bin"
fi
cp VERSION LICENSE NOTICE "$OUT/"
# Vektorsuche: sqlite-vec liegt neben der Exe (bun install holt es nur für das eigene System)
VEC=backend/node_modules/sqlite-vec-windows-x64/vec0.dll
if [ ! -f "$VEC" ]; then
  (cd backend && npm pack sqlite-vec-windows-x64@0.1.6 --silent >/dev/null && tar -xzf sqlite-vec-windows-x64-0.1.6.tgz && mkdir -p node_modules/sqlite-vec-windows-x64 && cp package/vec0.dll node_modules/sqlite-vec-windows-x64/ && rm -rf package sqlite-vec-windows-x64-0.1.6.tgz)
fi
cp "$VEC" "$OUT/"
# Engine-Skripte für die WSL-Umgebung
mkdir -p "$OUT/engine"
cp engine/provision.sh engine/compose.yaml "$OUT/engine/"
# Fingerabdruck der Engine-Pakete: ändert sich nur mit compose.yaml oder den Paketquellen, nicht mit jeder App-Version
{ git rev-parse HEAD:engine/compose.yaml; for d in pm-gpu-arbiter pm-qwen-tts pm-kokoro-tts pm-f5-tts pm-tada-tts pm-tts-common pm-docling-de; do git rev-parse "HEAD:$d" 2>/dev/null || true; done; } \
  | sha1sum | cut -c1-12 > "$OUT/engine/images.rev" || true
echo "Fertig: $OUT"
