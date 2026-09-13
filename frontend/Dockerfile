# syntax=docker/dockerfile:1

# ArcReserve frontend — hackathon demo image (testnet only).
#
# One thing about this build is easy to get wrong: Vite *inlines* every VITE_* variable into
# the JavaScript bundle at build time. They are therefore build arguments, not runtime
# environment; setting them on `docker run` has no effect at all. Rebuild to repoint the app.

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# Dev server (compose profile "dev"; source is bind-mounted over /app)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS dev
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---------------------------------------------------------------------------
# Build — typecheck and bundle. A type error fails the image, by design.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG VITE_API_URL
ARG VITE_RPC_URL
ARG VITE_ASSET_ID
ARG VITE_MUSD_ADDRESS
ARG VITE_REGISTRY_ADDRESS
ARG VITE_TOKEN_ADDRESS
ARG VITE_VAULT_ADDRESS
ARG VITE_OFFERING_ADDRESS
ARG VITE_MARKET_MANAGER_ADDRESS
ARG VITE_REVENUE_DISTRIBUTOR_ADDRESS
ARG VITE_REDEMPTION_CONTROLLER_ADDRESS

RUN npm run build

# ---------------------------------------------------------------------------
# Runtime — static files behind nginx, unprivileged
# ---------------------------------------------------------------------------
FROM nginx:1.29-alpine AS runtime
LABEL org.opencontainers.image.title="arcreserve-frontend" \
      org.opencontainers.image.description="ArcReserve frontend (hackathon demo, testnet only)"

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/arcreserve.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
