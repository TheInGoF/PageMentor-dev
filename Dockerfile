# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Backend deps (Bun)
# ---------------------------------------------------------------------------
FROM oven/bun:1-slim AS backend-deps
WORKDIR /app/backend
COPY backend/package.json backend/bun.lock* ./
RUN bun install --frozen-lockfile || bun install

# ---------------------------------------------------------------------------
# Frontend build (Node)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/ .
RUN npm run build

# ---------------------------------------------------------------------------
# Piper binary + voice models (built once, baked into image)
#
# PIPER_LANGS is a comma-separated list of ISO language codes (e.g.
# "de,en,fr"). Each known language pulls a single curated voice during
# image build. At runtime the container uses only those cached files —
# no network required for TTS.
# ---------------------------------------------------------------------------
FROM debian:12-slim AS piper-voices
ARG PIPER_LANGS=de,en
ARG PIPER_VERSION=2023.11.14-2
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
# Piper release tarball for linux/amd64. NB: our GHA runner builds linux/amd64
# only; if multi-arch is ever enabled, swap the URL based on TARGETARCH.
RUN curl -fsSL -o piper.tar.gz \
      "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz" \
 && tar -xzf piper.tar.gz \
 && rm piper.tar.gz \
 && chmod +x /opt/piper/piper

WORKDIR /voices
COPY docker/download-piper-voices.sh /usr/local/bin/download-piper-voices.sh
RUN chmod +x /usr/local/bin/download-piper-voices.sh \
 && /usr/local/bin/download-piper-voices.sh "${PIPER_LANGS}" /voices

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM oven/bun:1-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg curl poppler-utils tesseract-ocr \
      tesseract-ocr-deu tesseract-ocr-eng \
      libstdc++6 libc6 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=backend-deps /app/backend/node_modules ./node_modules
COPY backend/ .
COPY --from=frontend /app/dist ./public

# Piper binary + libs + voice models
COPY --from=piper-voices /opt/piper /opt/piper
COPY --from=piper-voices /voices /app/piper-voices

ENV PM_PIPER_BIN=/opt/piper/piper \
    PM_PIPER_DIR=/app/piper-voices \
    LD_LIBRARY_PATH=/opt/piper

EXPOSE 3000
CMD ["bun", "src/index.ts"]
