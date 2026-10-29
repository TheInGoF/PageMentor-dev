#!/usr/bin/env bash
# Prüft, dass CHANGELOG.md einen ausgefüllten Abschnitt für die aktuelle Version hat
set -euo pipefail
cd "$(dirname "$0")/.."
v="$(tr -d '[:space:]' < VERSION)"
notes="$(scripts/release-notes.sh "$v")"
if [ -z "$notes" ]; then echo "CHANGELOG.md: Abschnitt für $v fehlt"; exit 1; fi
if grep -qx -- "- *" <<< "$notes"; then echo "CHANGELOG.md: leere Einträge in $v"; exit 1; fi
echo "Changelog $v vorhanden"
