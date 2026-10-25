ARG NODE_BASE=node:22-alpine
ARG RUNTIME_BASE=alpine:3.24
FROM ${NODE_BASE} AS node-runtime
FROM node-runtime AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# Native modules use the same Node ABI/musl family at build and runtime.
# npm, compilers, Vite and development binaries stay in the builder stage.
FROM ${RUNTIME_BASE} AS production
RUN apk add --no-cache libstdc++ && addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node && addgroup -S -g 101 appgroup && adduser -S -u 100 appuser -G appgroup
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/bin/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
WORKDIR /app
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/dist ./dist
RUN mkdir -p data uploads logs && chown appuser:appgroup data uploads logs
USER appuser
EXPOSE 3050
ENTRYPOINT ["docker-entrypoint.sh"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT:-3050}/health" || exit 1
CMD ["node", "server/index.js"]
