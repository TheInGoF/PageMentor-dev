#!/usr/bin/env bash
# Download curated Piper voices per language.
#
# Usage: download-piper-voices.sh "de,en,fr" /voices
#
# Pro Sprache werden mehrere kuratierte Stimmen aus rhasspy/piper-voices
# gezogen, damit der Voice-Picker Abwechslung bietet. Multi-Speaker-
# Modelle (wie thorsten_emotional-medium) werden einmal geladen und im
# Runtime-Scanner pro Sprecher-ID als eigener Voice-Eintrag aufgefaltet.

set -euo pipefail

LANGS_CSV="${1:-de,en}"
OUT_DIR="${2:-/voices}"
BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main"

voices_for_lang() {
  case "$1" in
    de) echo "de_DE-thorsten-high de_DE-thorsten_emotional-medium de_DE-pavoque-low de_DE-ramona-low" ;;
    en) echo "en_US-lessac-high en_US-amy-medium en_US-ryan-high en_GB-alba-medium" ;;
    fr) echo "fr_FR-siwis-medium" ;;
    es) echo "es_ES-sharvard-medium" ;;
    it) echo "it_IT-riccardo-x_low" ;;
    nl) echo "nl_NL-mls-medium" ;;
    pl) echo "pl_PL-mls_6892-low" ;;
    pt) echo "pt_PT-tugao-medium" ;;
    ru) echo "ru_RU-irina-medium" ;;
    uk) echo "uk_UA-ukrainian_tts-medium" ;;
    zh) echo "zh_CN-huayan-medium" ;;
    tr) echo "tr_TR-dfki-medium" ;;
    *) return 1 ;;
  esac
}

# Leitet den HF-Pfad aus der Voice-ID ab.
#   de_DE-thorsten-high      → de/de_DE/thorsten/high
#   it_IT-riccardo-x_low     → it/it_IT/riccardo/x_low
#   pl_PL-mls_6892-low       → pl/pl_PL/mls_6892/low
derive_path() {
  local voice_id="$1"
  local locale="${voice_id%%-*}"        # de_DE
  local rest="${voice_id#*-}"           # thorsten-high
  local lang="${locale%%_*}"            # de
  local quality="${rest##*-}"           # high
  local speaker="${rest%-*}"            # thorsten
  echo "${lang}/${locale}/${speaker}/${quality}"
}

mkdir -p "$OUT_DIR"

IFS=',' read -ra LANG_LIST <<< "$LANGS_CSV"
for raw in "${LANG_LIST[@]}"; do
  lang="$(echo "$raw" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
  [ -z "$lang" ] && continue

  if ! voices="$(voices_for_lang "$lang")"; then
    echo "[piper-voices] skipped '$lang' — no curated voices defined." >&2
    continue
  fi

  for voice_id in $voices; do
    rel_path="$(derive_path "$voice_id")"
    echo "[piper-voices] fetching ${voice_id} …"
    curl -fsSL -o "${OUT_DIR}/${voice_id}.onnx" \
      "${BASE}/${rel_path}/${voice_id}.onnx"
    curl -fsSL -o "${OUT_DIR}/${voice_id}.onnx.json" \
      "${BASE}/${rel_path}/${voice_id}.onnx.json"
  done
done

echo "[piper-voices] done. Contents:"
ls -la "$OUT_DIR"
