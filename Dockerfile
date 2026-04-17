# syntax=docker/dockerfile:1.7

# Upstream piper-voices image (binary + baked voice models). Built by
# a separate workflow when PIPER_LANGS or the download script changes,
# so normal app builds skip the ~230–540 MB voice download entirely.
ARG PIPER_VOICES_IMAGE=ghcr.io/lordvonbaum/pagementor-piper-voices:latest

# ---------------------------------------------------------------------------
# Backend deps (Bun)
# ---------------------------------------------------------------------------
FROM oven/bun:1-slim AS backend-deps
WORKDIR /app/backend
COPY backend/package.json backend/bun.lock* ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile || bun install

# ---------------------------------------------------------------------------
# Frontend build (Node)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-audit --no-fund
COPY frontend/ .
RUN --mount=type=cache,target=/root/.npm \
    npm run build

# ---------------------------------------------------------------------------
# Piper assets — pulled from the pre-built image above. No download in
# this build.
# ---------------------------------------------------------------------------
FROM ${PIPER_VOICES_IMAGE} AS piper-assets

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM oven/bun:1-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg curl poppler-utils tesseract-ocr \
      tesseract-ocr-deu tesseract-ocr-eng \
      libstdc++6 libc6

WORKDIR /app
COPY --from=backend-deps /app/backend/node_modules ./node_modules
COPY backend/ .
COPY --from=frontend /app/dist ./public

# Piper binary + libs + voice models come straight from the piper-voices
# image — the main build never downloads these itself.
COPY --from=piper-assets /opt/piper /opt/piper
COPY --from=piper-assets /voices /app/piper-voices

ENV PM_PIPER_BIN=/opt/piper/piper \
    PM_PIPER_DIR=/app/piper-voices \
    LD_LIBRARY_PATH=/opt/piper

EXPOSE 3000
CMD ["bun", "src/index.ts"]
