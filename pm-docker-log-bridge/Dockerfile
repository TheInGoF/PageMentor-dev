# Minimal Bun image — the server is one file, zero npm deps.
FROM oven/bun:1-slim
WORKDIR /app
COPY server.ts .
EXPOSE 8792
CMD ["bun", "run", "server.ts"]
