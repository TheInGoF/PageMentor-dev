#!/usr/bin/env bash
# Windows-Werkzeuge laden: ffmpeg/ffprobe (LGPL), Poppler (pdftoppm), AtomicParsley
# Aufruf: scripts/fetch-windows-tools.sh <ziel-bin-ordner>
# Tesseract fehlt bewusst: OCR macht Docling in der Engine
set -euo pipefail

DEST=${1:?Zielordner fehlt}
FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip"
POPPLER_URL="https://github.com/oschwartz10612/poppler-windows/releases/download/v24.08.0-0/Release-24.08.0-0.zip"
ATOMIC_URL="https://github.com/wez/atomicparsley/releases/download/20240608.083822.1ed9031/AtomicParsleyWindows.zip"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$DEST"

fetch() {
  echo "Lade $1"
  curl -fsSL --retry 4 --retry-delay 2 -o "$TMP/$2" "$1"
  mkdir -p "$TMP/${2%.zip}"
  if command -v unzip >/dev/null; then
    unzip -q -o "$TMP/$2" -d "$TMP/${2%.zip}"
  else
    powershell.exe -NoProfile -Command "Expand-Archive -Force -Path '$(cygpath -w "$TMP/$2")' -DestinationPath '$(cygpath -w "$TMP/${2%.zip}")'"
  fi
}

fetch "$FFMPEG_URL" ffmpeg.zip
cp "$(find "$TMP/ffmpeg" -name ffmpeg.exe | head -1)" "$DEST/"
cp "$(find "$TMP/ffmpeg" -name ffprobe.exe | head -1)" "$DEST/"

# pdftoppm braucht seine DLLs im selben Ordner
fetch "$POPPLER_URL" poppler.zip
mkdir -p "$DEST/poppler"
cp -r "$(dirname "$(find "$TMP/poppler" -name pdftoppm.exe | head -1)")"/. "$DEST/poppler/"

fetch "$ATOMIC_URL" atomic.zip
cp "$(find "$TMP/atomic" -iname AtomicParsley.exe | head -1)" "$DEST/AtomicParsley.exe"

# Kennung der Werkzeugstände: das Setup entpackt bin\ nur, wenn sie sich ändert
printf '%s\n' "$FFMPEG_URL" "$POPPLER_URL" "$ATOMIC_URL" | sha1sum | cut -c1-12 > "$DEST/tools.version"

echo "Werkzeuge in $DEST:"
ls -la "$DEST" "$DEST/poppler" | head -40
