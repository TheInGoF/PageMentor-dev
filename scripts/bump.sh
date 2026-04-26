#!/usr/bin/env bash
# bump.sh — sets the version number in all four places at once:
#
#   VERSION                 (single source of truth, runtime read)
#   package.json            (repo root)
#   backend/package.json
#   frontend/package.json
#
# Usage:
#   scripts/bump.sh 1.18.006        # set to a target version
#   scripts/bump.sh                 # patch bump (last component +1)
#
# Doesn't do anything else for you — no git add, no commit. Makes
# ONE deterministic change in four files; you review the git diff
# and commit yourself.

set -euo pipefail

cd "$(dirname "$0")/.."

CURRENT="$(cat VERSION | tr -d '[:space:]')"

if [[ $# -ge 1 ]]; then
  NEW="$1"
else
  # Patch bump: 1.18.005 → 1.18.006
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
  if [[ -z "${PATCH:-}" ]]; then
    echo "error: cannot parse current VERSION '$CURRENT' (expected X.Y.Z)" >&2
    exit 1
  fi
  PATCH_NUM=$((10#$PATCH + 1))
  # Keep the 3-digit patch format (001, 002, ...)
  NEW=$(printf "%d.%d.%03d" "$MAJOR" "$MINOR" "$PATCH_NUM")
fi

if [[ ! "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: '$NEW' is not X.Y.Z" >&2
  exit 1
fi

echo "$CURRENT  →  $NEW"

echo "$NEW" > VERSION

# package.json fields via sed — one line like
#   "version": "1.18.005",
# in each of the three package.json files.
for PKG in package.json backend/package.json frontend/package.json; do
  if [[ -f "$PKG" ]]; then
    # BSD/macOS sed needs '', GNU sed doesn't. `sed -i.bak` works on
    # both; delete the backup afterwards.
    sed -i.bak "s/\"version\": *\"[^\"]*\"/\"version\": \"$NEW\"/" "$PKG"
    rm -f "$PKG.bak"
  fi
done

echo ""
echo "Changed files:"
git diff --name-only VERSION package.json backend/package.json frontend/package.json 2>/dev/null || true
echo ""
echo "Next:"
echo "  git add -A && git commit -m \"v$NEW — <description>\" && git push"
