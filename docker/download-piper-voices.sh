#!/usr/bin/env bash
# Download a curated default Piper voice per language.
#
# Usage: download-piper-voices.sh "de,en,fr" /voices
#
# Each language maps to a single high-quality voice from rhasspy/piper-voices
# on Hugging Face. Unknown codes are logged and skipped (not an error — the
# build keeps whatever voices it was able to resolve).

set -euo pipefail

LANGS_CSV="${1:-de,en}"
OUT_DIR="${2:-/voices}"
BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main"

# lang code -> "relative path/base-filename" on the HF voice repo.
# Keep this list small and curated. Quality tier is chosen per voice for a
# reasonable size/quality tradeoff.
lookup_voice() {
  case "$1" in
    de) echo "de/de_DE/thorsten/high|de_DE-thorsten-high" ;;
    en) echo "en/en_US/lessac/high|en_US-lessac-high" ;;
    fr) echo "fr/fr_FR/siwis/medium|fr_FR-siwis-medium" ;;
    es) echo "es/es_ES/sharvard/medium|es_ES-sharvard-medium" ;;
    it) echo "it/it_IT/riccardo/x_low|it_IT-riccardo-x_low" ;;
    nl) echo "nl/nl_NL/mls/medium|nl_NL-mls-medium" ;;
    pl) echo "pl/pl_PL/mls_6892/low|pl_PL-mls_6892-low" ;;
    pt) echo "pt/pt_PT/tugao/medium|pt_PT-tugao-medium" ;;
    ru) echo "ru/ru_RU/irina/medium|ru_RU-irina-medium" ;;
    uk) echo "uk/uk_UA/ukrainian_tts/medium|uk_UA-ukrainian_tts-medium" ;;
    zh) echo "zh/zh_CN/huayan/medium|zh_CN-huayan-medium" ;;
    tr) echo "tr/tr_TR/dfki/medium|tr_TR-dfki-medium" ;;
    *) return 1 ;;
  esac
}

mkdir -p "$OUT_DIR"

IFS=',' read -ra LANG_LIST <<< "$LANGS_CSV"
for raw in "${LANG_LIST[@]}"; do
  lang="$(echo "$raw" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
  [ -z "$lang" ] && continue

  if ! mapping="$(lookup_voice "$lang")"; then
    echo "[piper-voices] skipped '$lang' — no curated voice defined." >&2
    continue
  fi

  rel_path="${mapping%%|*}"
  base_name="${mapping##*|}"

  echo "[piper-voices] fetching ${base_name} …"
  curl -fsSL -o "${OUT_DIR}/${base_name}.onnx" \
    "${BASE}/${rel_path}/${base_name}.onnx"
  curl -fsSL -o "${OUT_DIR}/${base_name}.onnx.json" \
    "${BASE}/${rel_path}/${base_name}.onnx.json"
done

echo "[piper-voices] done. Contents:"
ls -la "$OUT_DIR"
