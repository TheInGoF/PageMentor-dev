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
# Engine-Skripte für die WSL-Umgebung
mkdir -p "$OUT/engine"
cp engine/provision.sh engine/compose.yaml "$OUT/engine/"
echo "Fertig: $OUT"
