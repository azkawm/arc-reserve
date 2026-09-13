# syntax=docker/dockerfile:1

# ArcReserve backend — hackathon demo image (testnet only, D-027).
#
# One thing this build gets right on purpose: it does NOT bake chain addresses, RPC URLs or
# DATABASE_URL into the image. Every value in backend/.env.example is read at container start
# from the environment (docker-compose.deploy.yml's env_file), so the same image serves any
# chain — swap which .env.* file a service points at and restart, no rebuild.

# ---------------------------------------------------------------------------
# Dependencies (full, including devDependencies -- needed for the TypeScript build below)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# Build — typecheck via tsc, compile to dist/. A type error fails the image, by design.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Production dependencies only (smaller runtime image; no devDependencies)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------------------------------------------------------------------------
# Runtime — compiled JS, prod-only node_modules, migrations, and the sync'd ABI snapshot.
# Runs as the built-in unprivileged `node` user, not root.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
LABEL org.opencontainers.image.title="arcreserve-backend" \
      org.opencontainers.image.description="ArcReserve backend: indexer + /v1 read API (hackathon demo, testnet only)"
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations
COPY abis ./abis
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && chown -R node:node /app

USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${PORT:-4000}/v1/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
