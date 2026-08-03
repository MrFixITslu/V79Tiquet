# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — Build the React/Vite frontend
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# better-sqlite3 needs to compile a native addon on Alpine (musl) if no
# prebuilt binary matches this platform.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — Production runtime. server/index.js serves the API + WebSocket AND
# the built frontend (express.static on ./dist when NODE_ENV=production) from
# a single container, sitting behind Nginx Proxy Manager on the shared
# proxy_network — same convention as the rest of the V79 app portfolio.
#
# NOTE: this replaces the previous static-nginx-only Dockerfile. That was no
# longer viable once real login, 2FA, and data storage were added — plain
# nginx can't run an API. Container name and external port (8080) are kept
# unchanged from the original V79Tiquet setup so NPM routing does not need to
# be reconfigured.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY package.json package-lock.json* ./

RUN apk add --no-cache python3 make g++ && \
    npm install --omit=dev && \
    apk del python3 make g++ && \
    rm -rf /root/.npm /root/.node-gyp

COPY server/ ./server/
COPY --from=builder /app/dist ./dist

# Runtime volumes (mounted by docker-compose): /app/data holds the SQLite
# file, /app/uploads holds uploaded job/client files.
RUN mkdir -p data uploads && chown -R appuser:appgroup /app

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -qO- "http://localhost:${PORT:-8080}/health" || exit 1

CMD ["node", "server/index.js"]
