#!/usr/bin/env bash
# Build pagementor/kokoro-fastapi-german:latest from r1di's repo with
# HuggingFace authentication. The Tundragoon/Kokoro-German model is
# gated, so the upstream Dockerfile fails without a token. This script:
#
#   1. Clones (or updates) r1di/kokoro-fastapi-german into /tmp.
#   2. Patches the Dockerfile to accept HF_TOKEN as a build arg.
#   3. Builds the image with the tag the compose files expect.
#
# Voraussetzungen (einmalig, manuell):
#   - HuggingFace-Account: https://huggingface.co/join
#   - Repo-Zugang: https://huggingface.co/Tundragoon/Kokoro-German
#                  → "Access repository" / "Agree and access" klicken
#   - HF-Token (Read): https://huggingface.co/settings/tokens
#
# Usage:
#   HF_TOKEN=hf_xxx ./scripts/build-kokoro-de.sh           # CPU (Mac, Synology, generic)
#   HF_TOKEN=hf_xxx ./scripts/build-kokoro-de.sh --gpu     # GPU (Windows + NVIDIA)
#
# Resultat:
#   pagementor/kokoro-fastapi-german:latest        (CPU)
#   pagementor/kokoro-fastapi-german-gpu:latest    (GPU)
#
# Image bleibt lokal — keine Pushes irgendwohin. Tundragoon-Lizenz ist
# Apache 2.0, das Gating dort ist ein Wunsch des Modell-Owners; bauen
# wir uns lokal lieber selbst statt das Image zu redistribuieren.

set -euo pipefail

DEVICE="cpu"
TAG="pagementor/kokoro-fastapi-german:latest"
DOCKERFILE_REL="docker/cpu/Dockerfile"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --gpu)
      DEVICE="gpu"
      TAG="pagementor/kokoro-fastapi-german-gpu:latest"
      DOCKERFILE_REL="docker/gpu/Dockerfile"
      shift
      ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^#\s\?//'
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

if [[ -z "${HF_TOKEN:-}" ]]; then
  cat >&2 <<EOF
Error: HF_TOKEN environment variable not set.

  1. Make a HuggingFace account if you don't have one:
       https://huggingface.co/join
  2. Accept the Tundragoon/Kokoro-German access terms:
       https://huggingface.co/Tundragoon/Kokoro-German
  3. Create a Read token:
       https://huggingface.co/settings/tokens
  4. Re-run this script with the token in the env:
       HF_TOKEN=hf_xxx $0 ${@:-}
EOF
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker CLI not found in PATH." >&2
  echo "  On macOS: install OrbStack or Docker Desktop and start it once" >&2
  echo "  so the CLI symlinks land in your PATH." >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git not found in PATH." >&2
  exit 1
fi

WORK_DIR="${WORK_DIR:-/tmp/pagementor-kokoro-de-build}"
REPO_DIR="$WORK_DIR/kokoro-fastapi-german"
mkdir -p "$WORK_DIR"

if [[ -d "$REPO_DIR/.git" ]]; then
  echo "→ Updating existing checkout in $REPO_DIR"
  git -C "$REPO_DIR" fetch --quiet origin
  git -C "$REPO_DIR" reset --hard origin/HEAD --quiet
else
  echo "→ Cloning r1di/kokoro-fastapi-german into $REPO_DIR"
  git clone --quiet --depth 1 \
    https://github.com/r1di/kokoro-fastapi-german.git \
    "$REPO_DIR"
fi

DOCKERFILE_ABS="$REPO_DIR/$DOCKERFILE_REL"
if [[ ! -f "$DOCKERFILE_ABS" ]]; then
  echo "Error: expected Dockerfile not found at $DOCKERFILE_ABS" >&2
  echo "  Has the upstream repo restructured? Check it manually." >&2
  exit 1
fi

# Patch idempotent: nur einfügen wenn noch nicht da.
if grep -q '^ARG HF_TOKEN' "$DOCKERFILE_ABS"; then
  echo "→ Dockerfile already patched, skipping."
else
  echo "→ Patching $DOCKERFILE_REL to accept HF_TOKEN build arg"
  awk '
    /^RUN if \[ "\$DOWNLOAD_MODEL" = "true" \]/ && !patched {
      print "ARG HF_TOKEN"
      print "ENV HUGGING_FACE_HUB_TOKEN=$HF_TOKEN"
      print ""
      patched = 1
    }
    { print }
  ' "$DOCKERFILE_ABS" > "$DOCKERFILE_ABS.tmp"
  mv "$DOCKERFILE_ABS.tmp" "$DOCKERFILE_ABS"
fi

echo ""
echo "→ Building $TAG"
echo "  Device:     $DEVICE"
echo "  Dockerfile: $DOCKERFILE_REL"
echo "  Context:    $REPO_DIR"
echo "  Note:       first build pulls ~2-5 GB of layers + the German"
echo "              model from HuggingFace — expect 5-15 minutes."
echo ""

docker build \
  --build-arg HF_TOKEN="$HF_TOKEN" \
  -f "$DOCKERFILE_ABS" \
  -t "$TAG" \
  "$REPO_DIR"

cat <<EOF

✓ Built $TAG

Next steps:
  1. cd into your sidecar compose directory (where docker-compose.yml or
     eigene_mac-sidecars-compose.yaml lives).
  2. Start (or restart) the kokoro-de service:
       docker compose up -d kokoro-de
     or for the whole sidecar stack:
       docker compose up -d
  3. Verify:
       docker compose logs --tail=30 kokoro-de
       curl http://localhost:8881/v1/audio/voices
     → should list ["df_eva", "dm_bernd"].
  4. On the NAS app, set PM_KOKORO_DE_URL to point at this sidecar
     (e.g. http://<this-host>:8881) and restart the app container.
EOF
