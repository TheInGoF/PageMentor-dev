#!/usr/bin/env bash
# Richtet die WSL-Umgebung "PageMentor-Engine" ein: Docker, NVIDIA-Toolkit, Compose
# Idempotent: jeder Schritt prüft erst, ob er schon erledigt ist
# Exit-Codes: 0 fertig, 10 WSL-Neustart nötig (systemd neu), 1 Fehler
# Umgebung:
#   PM_COMPOSE_SRC  Pfad zur compose.yaml (Standard: neben diesem Skript)
#   PM_SKIP_GPU=1   NVIDIA-Toolkit überspringen (CI ohne GPU)
#   PM_SKIP_START=1 Docker nicht starten (CI-Container ohne systemd)
set -euo pipefail

ENGINE_DIR=/opt/pagementor
MARKER="$ENGINE_DIR/provisioned"
PROVISION_VERSION=1
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_SRC="${PM_COMPOSE_SRC:-$SRC_DIR/compose.yaml}"
export DEBIAN_FRONTEND=noninteractive

step() { echo "[provision] $*"; }
fail() { echo "[provision] FEHLER: $*" >&2; exit 1; }
trap 'fail "Abbruch in Zeile $LINENO: $BASH_COMMAND"' ERR

[ "$(id -u)" -eq 0 ] || fail "muss als root laufen"
. /etc/os-release
step "System: $PRETTY_NAME, Kernel $(uname -r)"

apt_installed() { dpkg -s "$1" >/dev/null 2>&1; }

apt_update_once() {
  if [ -z "${APT_UPDATED:-}" ]; then
    step "Paketlisten aktualisieren"
    apt-get update -qq
    APT_UPDATED=1
  fi
}

install_pkgs() {
  local missing=()
  for p in "$@"; do apt_installed "$p" || missing+=("$p"); done
  if [ ${#missing[@]} -gt 0 ]; then
    apt_update_once
    step "Installiere: ${missing[*]}"
    apt-get install -y -qq --no-install-recommends "${missing[@]}"
  else
    step "Schon vorhanden: $*"
  fi
}

# 1. Grundpakete
install_pkgs ca-certificates curl gnupg

# 2. systemd in WSL einschalten, damit Docker als Dienst läuft
RESTART_NEEDED=0
if [ -f /proc/sys/fs/binfmt_misc/WSLInterop ] || grep -qi microsoft /proc/version; then
  if ! grep -qs '^systemd=true' /etc/wsl.conf; then
    step "systemd in /etc/wsl.conf einschalten"
    cat > /etc/wsl.conf <<'CONF'
[boot]
systemd=true

[user]
default=root

[interop]
appendWindowsPath=false
CONF
    RESTART_NEEDED=1
  else
    step "systemd ist eingeschaltet"
  fi
fi

# 3. Docker Engine aus dem offiziellen Docker-Repository
if ! apt_installed docker-ce; then
  step "Docker-Repository einrichten"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  APT_UPDATED=
fi
install_pkgs docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 4. NVIDIA Container Toolkit, Treiber kommt aus Windows
if [ -z "${PM_SKIP_GPU:-}" ]; then
  if ! apt_installed nvidia-container-toolkit; then
    step "NVIDIA-Repository einrichten"
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
      | gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
      | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
      > /etc/apt/sources.list.d/nvidia-container-toolkit.list
    APT_UPDATED=
  fi
  install_pkgs nvidia-container-toolkit
  if ! grep -qs nvidia /etc/docker/daemon.json; then
    step "Docker für die GPU konfigurieren"
    nvidia-ctk runtime configure --runtime=docker
    RESTART_DOCKER=1
  else
    step "Docker kennt die GPU-Runtime"
  fi
else
  step "GPU-Teil übersprungen (PM_SKIP_GPU)"
fi

# 5. Compose-Datei ablegen
mkdir -p "$ENGINE_DIR"
[ -f "$COMPOSE_SRC" ] || fail "compose.yaml nicht gefunden: $COMPOSE_SRC"
if ! cmp -s "$COMPOSE_SRC" "$ENGINE_DIR/compose.yaml"; then
  step "compose.yaml aktualisiert"
  cp "$COMPOSE_SRC" "$ENGINE_DIR/compose.yaml"
else
  step "compose.yaml unverändert"
fi

# 6. Docker starten, sofern systemd schon läuft
if [ -z "${PM_SKIP_START:-}" ] && [ "$RESTART_NEEDED" -eq 0 ]; then
  if pidof systemd >/dev/null 2>&1 || [ "$(ps -p 1 -o comm= 2>/dev/null)" = "systemd" ]; then
    systemctl enable --now docker >/dev/null
    [ -n "${RESTART_DOCKER:-}" ] && systemctl restart docker
    step "Docker läuft: $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?')"
  else
    step "systemd läuft noch nicht, Docker startet nach WSL-Neustart"
    RESTART_NEEDED=1
  fi
fi

echo "$PROVISION_VERSION" > "$MARKER"
if [ "$RESTART_NEEDED" -eq 1 ]; then
  step "Fertig, WSL-Neustart nötig"
  exit 10
fi
step "Fertig"
