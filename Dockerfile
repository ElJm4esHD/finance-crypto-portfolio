# syntax=docker/dockerfile:1

# ── 1. Frontend build ─────────────────────────────────────
FROM node:24-alpine AS web
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# vite.config.js writes the bundle to ../server/public
RUN npm run build

# ── 2. Server production dependencies ─────────────────────
FROM node:24-alpine AS server-deps
WORKDIR /app
# Build tools only in case better-sqlite3 has no prebuilt binary for this platform.
RUN apk add --no-cache python3 make g++
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ── 3. Runtime ────────────────────────────────────────────
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TZ=America/Argentina/Buenos_Aires
RUN apk add --no-cache tzdata && mkdir -p /data && chown node:node /data
WORKDIR /app
COPY --from=server-deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY --from=web /build/server/public ./public
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "src/index.js"]
