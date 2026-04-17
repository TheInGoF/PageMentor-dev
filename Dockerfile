FROM oven/bun:1-alpine AS backend-deps
WORKDIR /app/backend
COPY backend/package.json backend/bun.lock* ./
RUN bun install --frozen-lockfile || bun install

FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/ .
RUN npm run build

FROM oven/bun:1-alpine
RUN apk add --no-cache ffmpeg curl poppler-utils tesseract-ocr tesseract-ocr-data-deu tesseract-ocr-data-eng
WORKDIR /app
COPY --from=backend-deps /app/backend/node_modules ./node_modules
COPY backend/ .
COPY --from=frontend /app/dist ./public
EXPOSE 3000
CMD ["bun", "src/index.ts"]
