#!/usr/bin/env bash
# Abschnitt einer Version aus CHANGELOG.md, ohne Kopfzeile: Text für das GitHub-Release
# Aufruf: scripts/release-notes.sh 1.21.3
set -euo pipefail
cd "$(dirname "$0")/.."
awk -v v="$1" '
  /^## / { if (found) exit; found = ($2 == v); next }
  found { print }
' CHANGELOG.md | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
