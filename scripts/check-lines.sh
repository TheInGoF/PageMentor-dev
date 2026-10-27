#!/usr/bin/env bash
# Zeilenlimit pro Code-Datei
# Warnung > 500, Fehler > 600, Ausnahmen in scripts/line-limit-exceptions.txt

set -euo pipefail
cd "$(dirname "$0")/.."

WARN=500
MAX=600
EXCEPTIONS=scripts/line-limit-exceptions.txt
fail=0

while IFS= read -r file; do
  lines=$(wc -l < "$file")
  if grep -qxF "$file" "$EXCEPTIONS" 2>/dev/null; then
    [ "$lines" -gt "$WARN" ] && echo "AUSNAHME $lines $file"
    continue
  fi
  if [ "$lines" -gt "$MAX" ]; then
    echo "FEHLER   $lines $file"
    fail=1
  elif [ "$lines" -gt "$WARN" ]; then
    echo "WARNUNG  $lines $file"
  fi
done < <(git ls-files '*.ts' '*.tsx' '*.py' '*.sh' '*.mjs')

exit $fail
