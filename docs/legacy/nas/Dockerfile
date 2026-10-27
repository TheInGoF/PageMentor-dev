# syntax=docker/dockerfile:1.7

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
      atomicparsley \
      libstdc++6 libc6

WORKDIR /app
COPY --from=backend-deps /app/backend/node_modules ./node_modules
COPY backend/ .
COPY --from=frontend /app/dist ./public
# VERSION (repo-root, single line) — Single Source of Truth für die
# Versionsnummer. Backend liest sie zur Laufzeit und loggt sie im
# Startup-Banner, Frontend zeigt sie im Settings-Modal.
COPY VERSION /app/VERSION

# Docker: von außen erreichbar, Port wie bisher
ENV PM_HOST=0.0.0.0 PM_ALLOW_REMOTE=1 PORT=3000
EXPOSE 3000
CMD ["bun", "src/index.ts"]
