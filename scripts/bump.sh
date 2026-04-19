#!/usr/bin/env bash
# bump.sh — setzt die Versionsnummer an allen vier Stellen gleichzeitig:
#
#   VERSION                 (Single Source of Truth, Runtime-Read)
#   package.json            (Repo-Root)
#   backend/package.json
#   frontend/package.json
#
# Usage:
#   scripts/bump.sh 1.18.006        # auf Ziel-Version setzen
#   scripts/bump.sh                 # patch bump (letzte Komponente +1)
#
# Nimmt dir nichts weiteres ab — kein git add, kein commit. Macht
# deterministisch EINE Änderung in vier Dateien, du siehst sie im
# git diff und committest selber.

set -euo pipefail

cd "$(dirname "$0")/.."

CURRENT="$(cat VERSION | tr -d '[:space:]')"

if [[ $# -ge 1 ]]; then
  NEW="$1"
else
  # Patch-Bump: 1.18.005 → 1.18.006
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
  if [[ -z "${PATCH:-}" ]]; then
    echo "error: cannot parse current VERSION '$CURRENT' (expected X.Y.Z)" >&2
    exit 1
  fi
  PATCH_NUM=$((10#$PATCH + 1))
  # Wir halten das 3-stellige Patch-Format bei (001, 002, ...)
  NEW=$(printf "%d.%d.%03d" "$MAJOR" "$MINOR" "$PATCH_NUM")
fi

if [[ ! "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: '$NEW' ist kein X.Y.Z" >&2
  exit 1
fi

echo "$CURRENT  →  $NEW"

echo "$NEW" > VERSION

# package.json-Felder per sed — eine Zeile wie
#   "version": "1.18.005",
# in jedem der drei package.json.
for PKG in package.json backend/package.json frontend/package.json; do
  if [[ -f "$PKG" ]]; then
    # BSD/macOS sed braucht '', GNU sed nicht. `sed -i.bak` funktioniert
    # auf beiden, Backup hinterher löschen.
    sed -i.bak "s/\"version\": *\"[^\"]*\"/\"version\": \"$NEW\"/" "$PKG"
    rm -f "$PKG.bak"
  fi
done

echo ""
echo "Geänderte Dateien:"
git diff --name-only VERSION package.json backend/package.json frontend/package.json 2>/dev/null || true
echo ""
echo "Next:"
echo "  git add -A && git commit -m \"v$NEW — <beschreibung>\" && git push"
