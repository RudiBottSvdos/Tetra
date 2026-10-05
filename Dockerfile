FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 \
    MIGRATIONS_DIR=/app/drizzle MEDIA_BUFFER_DIR=/data/media
COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=build --chown=node:node /app/drizzle ./drizzle
# Zwischenspeicher fuer Medien; als Volume einhaengen (Eigentuemer node, damit non-root schreiben kann).
RUN mkdir -p /data/media && chown -R node:node /data
VOLUME ["/data/media"]
USER node
EXPOSE 3000
# Liveness ohne DB-Zugriff (/api/health); busybox-wget ist im Alpine-Image enthalten.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", ".output/server/index.mjs"]
