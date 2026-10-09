# syntax=docker/dockerfile:1.7
#
# LexDraft API - multi-stage build.
#
# Three stages keep the final image lean by leaving the toolchain
# (pnpm cache, source, devDependencies, TypeScript compiler) behind in
# earlier stages. Only the compiled `dist/`, runtime `node_modules`, and
# the migrations directory ship in the runner image.
#
# Build context MUST be the monorepo root so the workspace lockfile and
# the sibling packages/* are available. Example:
#   docker build -f apps/api/Dockerfile -t lexdraft-api:local .

# ─── Stage 1: deps ────────────────────────────────────────────────────
# Resolve the full workspace using the frozen lockfile. Cached aggressively
# because the lockfile changes far less often than source.
FROM node:22-alpine AS deps
WORKDIR /workspace

# Corepack ships with Node 22 and pins the exact pnpm version declared
# in the root package.json - keeps CI and developer builds bit-identical.
RUN corepack enable

# Workspace manifests first so the install layer is cache-stable when only
# source files change.
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

# ─── Stage 2: build ───────────────────────────────────────────────────
# Compile the API. Brings devDependencies along so `tsc` resolves.
FROM node:22-alpine AS build
WORKDIR /workspace
RUN corepack enable

COPY --from=deps /workspace/node_modules                 node_modules
COPY --from=deps /workspace/apps/api/node_modules        apps/api/node_modules
COPY --from=deps /workspace/packages/types/node_modules  packages/types/node_modules

# Source - copied AFTER node_modules so source edits don't bust the deps layer.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY packages packages
COPY apps/api apps/api

RUN pnpm --filter @lexdraft/api build

# Trim devDependencies - the runner copies these as-is and the final image
# carries only what `node dist/index.js` actually requires. `pnpm deploy`
# emits a self-contained directory with a flat (non-symlinked) node_modules,
# so the runner stage doesn't need pnpm or the rest of the workspace.
RUN pnpm --filter @lexdraft/api deploy --prod /deploy

# ─── Stage 3: runner ──────────────────────────────────────────────────
# Slim production image. No pnpm, no TypeScript, no source - just the
# compiled bundle, prod node_modules, migrations, and tini for PID-1
# signal handling.
FROM node:22-alpine AS runner
WORKDIR /app

# tini handles SIGTERM/SIGINT cleanly so the express shutdown hooks in
# src/index.ts actually fire on container stop instead of being killed
# after the 10s docker-stop grace expires.
#
# LibreOffice (soffice) converts the engine .docx -> filing PDF in the
# document.render pg-boss job. It is PINNED to an exact apk version: a
# LibreOffice minor bump can shift line-breaking/pagination, which would
# change the page count of a document the advocate already approved. When
# bumping, re-baseline the golden PDF fixtures deliberately. The build is also
# recorded per-render in draft_renders.soffice_version so a drift is visible.
# Pin uses the Alpine 3.x repo pin syntax `pkg=version`. To find the exact
# string for the base image: `docker run --rm node:22-alpine apk list libreoffice`.
#
# BUMPED 24.8.4.2-r0 -> 25.8.7.3-r0 (2026-10): the pinned 24.8.x build was
# removed from Alpine's repo entirely (not just superseded - `apk` could no
# longer resolve it at all), which had been silently breaking every image
# rebuild since ~May 2026 - `docker compose up --build` logs a build error
# but still brings up whatever image last built successfully, so this went
# unnoticed for months. Per the policy above: RE-BASELINE THE GOLDEN PDF
# FIXTURES before trusting this build's output pagination-for-pagination
# against documents rendered under 24.8.x.
#
# FONTS — the templates reference Calibri + Cambria (theme body/heading) and
# Courier (explicit, for monospace/tabular content). Those are proprietary
# Microsoft fonts we cannot ship; without a substitute LibreOffice picks an
# arbitrary fallback and pagination silently diverges from what the advocate
# approved. We install METRIC-COMPATIBLE substitutes so glyph widths (hence line
# breaks and page count) match:
#   - font-carlito   -> Calibri  (same metrics)
#   - ttf-liberation  -> Liberation Mono/Serif/Sans (Courier/Times/Arial metrics)
#   - font-noto       -> Devanagari/Tamil coverage for Indian-language party names.
# font-caladea (Cambria substitute) was DROPPED from this list (2026-10): it no
# longer exists in Alpine's repo at all (confirmed via `apk search caladea` /
# `apk search crosextra` returning nothing - not a rename, genuinely removed
# upstream). Documents whose template uses the Cambria heading style now
# render with LibreOffice's own fallback font instead of a metric-compatible
# substitute; re-baseline those specific golden fixtures and watch for
# pagination drift. If a true fix is wanted later: download the Caladea font
# files directly (e.g. from the Google metric-compatible font archive) and
# COPY them into the image instead of relying on apk.
# NOTE: verify these package names resolve in the pinned Alpine repo at build time
# (`apk search font-carlito`); adjust if the repo names differ.
RUN apk add --no-cache tini wget \
      libreoffice=25.8.7.3-r0 \
      font-carlito \
      ttf-liberation \
      font-noto \
 && addgroup -g 1001 -S lexdraft \
 && adduser  -u 1001 -S lexdraft -G lexdraft

# Compiled JS + the trimmed prod node_modules from the deploy stage.
COPY --from=build --chown=lexdraft:lexdraft /deploy/dist          ./dist
COPY --from=build --chown=lexdraft:lexdraft /deploy/node_modules  ./node_modules
COPY --from=build --chown=lexdraft:lexdraft /deploy/package.json  ./package.json
# Migrations are read at runtime by `tsx src/scripts/migrate.ts` - keep
# the .sql files alongside the app so `docker compose exec api ...` can
# apply them inside the container.
COPY --from=build --chown=lexdraft:lexdraft /workspace/apps/api/migrations ./migrations

# Uploads directory - STORAGE_LOCAL_DIR defaults to ./uploads in env.ts.
# Bind-mount this in docker-compose so files survive container restarts.
RUN mkdir -p /app/uploads && chown -R lexdraft:lexdraft /app/uploads

ENV NODE_ENV=production \
    PORT=4000 \
    STORAGE_LOCAL_DIR=/app/uploads \
    SOFFICE_BIN=/usr/bin/soffice

EXPOSE 4000

# /api/ready talks to Postgres - a failure here pulls the container out
# of the load balancer rotation. Liveness (/api/health) is intentionally
# NOT used: a broken DB connection should fail readiness, not restart
# the process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --spider -q "http://localhost:${PORT}/api/ready" || exit 1

USER lexdraft
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
