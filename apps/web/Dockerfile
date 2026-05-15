# syntax=docker/dockerfile:1.7
#
# LexDraft Web - Vite SPA bundled and served by nginx.
#
# Two stages: Node-22 to compile, nginx:alpine to serve. The runner image
# carries no Node toolchain at all - just hashed static assets and an
# nginx config tuned for SPAs (try_files fallback + cache headers).
#
# Build context is the monorepo root, same as the API image:
#   docker build -f apps/web/Dockerfile -t lexdraft-web:local .

# ─── Stage 1: build ───────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /workspace
RUN corepack enable

# Workspace manifests first - cache-friendly layer.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json                apps/api/package.json
COPY apps/web/package.json                apps/web/package.json
COPY packages/types/package.json          packages/types/package.json
COPY packages/ui/package.json             packages/ui/package.json
COPY packages/tsconfig/package.json       packages/tsconfig/package.json
COPY packages/eslint-config/package.json  packages/eslint-config/package.json
COPY packages/tailwind-config/package.json packages/tailwind-config/package.json

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Source.
COPY turbo.json ./
COPY packages packages
COPY apps/web apps/web

# `VITE_API_URL` is baked into the bundle at build time. Empty default
# means the SPA calls /api on its own origin - the right answer when a
# reverse proxy fronts both web and api on the same hostname.
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}

RUN pnpm --filter @lexdraft/web build

# ─── Stage 2: runner ──────────────────────────────────────────────────
# nginx is the right answer over `node serve-static`: half the memory,
# correct cache headers out of the box, and battle-tested for static
# delivery. No Node runtime in the final image.
FROM nginx:1.27-alpine AS runner

# Replace the default config with our SPA-aware one (try_files fallback,
# security headers, gzip, sensible cache-control).
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Drop the stock welcome page before copying our bundle.
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 80

# nginx:alpine ships with a built-in /healthz default; we expose a small
# explicit check so docker-compose can mark the container healthy
# before the reverse proxy starts routing to it.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --spider -q http://localhost/ || exit 1

# nginx images already use `nginx` (non-root for worker procs); the
# upstream entrypoint and CMD are correct as shipped.
