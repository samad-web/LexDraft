# LexDraft

Practice management for Indian advocates — drafting, contract review, cause list, limitation tracking, billing.

A full-stack TypeScript application built as a **pnpm + Turborepo monorepo**:

```
LexDraft/
├── apps/
│   ├── web/                  Vite + React + TypeScript SPA
│   └── api/                  Node + Express + TypeScript REST API
└── packages/
    ├── types/                Shared domain types (the web ⇄ api contract)
    ├── ui/                   Shared component primitives (Icon, Button, Card, Badge)
    ├── tsconfig/             Shared TS configs (base / react / node)
    ├── eslint-config/        Shared ESLint configs
    └── tailwind-config/      Tailwind preset that maps the design tokens
```

The visual design is the **Monochrome Legal** system spelled out in [`design-system.md`](./design-system.md). Dark theme is the default; light theme is supported on day one. The CSS tokens that implement the spec live at [`apps/web/src/styles/tokens.css`](./apps/web/src/styles/tokens.css).

---

## Prerequisites

- **Node.js ≥ 20** (`.nvmrc` pins `20.18.0`)
- **pnpm ≥ 9** (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)

---

## Getting started

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Copy env templates
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env

# 3. Start everything (web on :5173, api on :4000) in parallel
pnpm dev
```

You can also start each app independently:

```bash
pnpm dev:web   # http://localhost:5173
pnpm dev:api   # http://localhost:4000
```

The web dev server proxies `/api/*` to the API, so the frontend talks to a single origin in development.

---

## Default credentials

The API ships with a seeded user. Sign in at `/auth` with:

| Email                | Password   | Notes                                 |
|----------------------|------------|---------------------------------------|
| `aarav@chambers.law` | `lexdraft` | Standard advocate                     |
| `admin@chambers.law` | `lexdraft` | Superadmin (UI shows the red banner)  |

For the prototype experience, **any email with the substring `admin`** is auto-promoted to superadmin and any email + password combination with password `lexdraft` will authenticate (provisional account creation). Switch this off before production.

---

## Scripts

Run from the repo root — Turborepo fans out to each affected workspace.

| Script              | What it does                                           |
|---------------------|---------------------------------------------------------|
| `pnpm dev`          | Starts both apps in parallel (`turbo run dev --parallel`) |
| `pnpm build`        | Builds web (Vite) + api (tsc) artifacts                |
| `pnpm typecheck`    | `tsc --noEmit` across every workspace                  |
| `pnpm lint`         | ESLint across every workspace                          |
| `pnpm test`         | Vitest where present                                   |
| `pnpm format`       | Prettier write across the repo                         |
| `pnpm clean`        | Wipes `dist`, `.turbo`, and `node_modules`             |

App-scoped variants:

```bash
pnpm --filter @lexdraft/web build
pnpm --filter @lexdraft/api start          # runs the compiled API
pnpm --filter @lexdraft/web preview        # serves the production build on :4173
```

---

## API contract

All endpoints are namespaced under `/api`. JSON in, JSON out. Auth uses a **JWT bearer token** issued at sign-in (HS256, 7-day default expiry).

### Public

| Method | Path                     | Body / query                                                      |
|--------|--------------------------|--------------------------------------------------------------------|
| `GET`  | `/api/health`            | —                                                                  |
| `POST` | `/api/auth/sign-in`      | `{ email, password }`                                              |
| `POST` | `/api/auth/sign-up`      | `{ email, password, name, role: 'solo'\|'group'\|'firm', firm? }` |
| `POST` | `/api/webhooks/:source`  | Signed by upstream — verify per provider                           |

### Protected — `Authorization: Bearer <token>`

| Method   | Path                              | Notes                                  |
|----------|-----------------------------------|----------------------------------------|
| `GET`    | `/api/auth/me`                    | Current session user                   |
| `POST`   | `/api/auth/sign-out`              | Stateless — client just discards token |
| `GET`    | `/api/dashboard`                  | Aggregated dashboard summary           |
| `GET`    | `/api/cases?type=&q=`             | List cases                             |
| `GET`    | `/api/cases/:id`                  | Single case                            |
| `POST`   | `/api/cases`                      | Create                                 |
| `PATCH`  | `/api/cases/:id`                  | Partial update                         |
| `DELETE` | `/api/cases/:id`                  |                                        |
| `GET`    | `/api/hearings/today`             |                                        |
| `GET`    | `/api/hearings`                   |                                        |
| `GET`    | `/api/tasks`                      | Returns the kanban `TaskBoard`         |
| `POST`   | `/api/tasks`                      | Create a new task                      |
| `PATCH`  | `/api/tasks/:id`                  | Update                                 |
| `POST`   | `/api/tasks/:id/move`             | `{ to: 'pending'\|'progress'\|'review'\|'done' }` |
| `DELETE` | `/api/tasks/:id`                  |                                        |
| `GET`    | `/api/documents`                  |                                        |
| `POST`   | `/api/documents`                  |                                        |
| `POST`   | `/api/drafting/generate`          | `{ docType, language, tone, fields }` — Claude or template |
| `GET`    | `/api/research?q=`                | Lex.AI canned answer with citations    |

The full contract lives in [`packages/types/src/index.ts`](./packages/types/src/index.ts).

---

## Frontend architecture

- **Vite + React 18 + TypeScript**, strict mode.
- **State management**: [Zustand](https://github.com/pmndrs/zustand) for cross-cutting UI/auth state (theme, density, language, current user, JWT). [React Query (TanStack)](https://tanstack.com/query/latest) for server state — every backend resource has a hook in `apps/web/src/hooks/`.
- **API abstraction**: [`apps/web/src/lib/api.ts`](./apps/web/src/lib/api.ts) wraps `axios`. The interceptor attaches the JWT and clears the session on `401`.
- **Routing**: `react-router-dom@6` — public routes (`/`, `/auth/*`) and protected app shell (`/app/*`).
- **Design tokens**: CSS custom properties in [`tokens.css`](./apps/web/src/styles/tokens.css) drive both `globals.css` and the Tailwind preset (`packages/tailwind-config/preset.cjs`). Theme switching is a single attribute on `<html>`.
- **Component-driven**: views read from React Query hooks, render layout with the global classes from `globals.css` and primitives from `@lexdraft/ui`.

### Adding a new view

1. Create `apps/web/src/views/MyView.tsx`.
2. Register the route in `apps/web/src/App.tsx`.
3. Add the sidebar entry in `apps/web/src/components/shell/nav-config.ts`.
4. Title + eyebrow for the topbar belongs in the same `nav-config.ts`'s `ROUTE_TITLES` map.

---

## Backend architecture

- **Express 4 + TypeScript**, modular by domain.
- **Service layer** ([`apps/api/src/services/`](./apps/api/src/services/)) contains business logic. Routes are thin adapters that validate (`zod`) and delegate.
- **Middleware**: `helmet`, `cors`, `compression`, `morgan`, `express-rate-limit`, plus app-specific `requireAuth`/`optionalAuth` and a centralised `errorHandler` that turns Zod failures into 400s and unknown errors into 500s with structured logs.
- **Logging**: [`pino`](https://getpino.io) with `pino-pretty` in development.
- **Auth**: JWT (HS256) via `jsonwebtoken`. Passwords hashed with `bcryptjs`. The seed includes two demo accounts.
- **Webhooks**: a generic `POST /api/webhooks/:source` endpoint exists; plug in signature verification per provider (eCourts, payment processors, e-sign).
- **Drafting**: if `ANTHROPIC_API_KEY` is set, `/api/drafting/generate` calls Claude with the structured brief from the design's `doc-schemas`. Otherwise it returns a deterministic template so the UI is fully usable in dev.

### Replacing the in-memory store

The services keep state in module-level arrays / maps. Swap each service's persistence layer for your DB of choice (Postgres + Drizzle, Prisma, etc.) without changing route handlers or shared types.

---

## Environment variables

### Root `.env`
```
NODE_ENV=development
```

### `apps/api/.env`
```
PORT=4000
LOG_LEVEL=debug
JWT_SECRET=change-me-in-production-please-32-bytes-min   # required, ≥16 chars
JWT_EXPIRES_IN=7d
CORS_ORIGINS=http://localhost:5173                       # comma-separated
ANTHROPIC_API_KEY=                                       # optional
ANTHROPIC_MODEL=claude-sonnet-4-6
```

### `apps/web/.env`
```
VITE_API_URL=http://localhost:4000   # only used in production builds
```

In dev the Vite proxy (`vite.config.ts`) forwards `/api` to whatever `VITE_API_URL` points at (default `http://localhost:4000`).

---

## Building & deploying

```bash
pnpm build
```

Outputs:
- `apps/web/dist/` — static SPA. Drop behind any CDN / static host.
- `apps/api/dist/` — Node bundle. Run with `node apps/api/dist/index.js`.

A reasonable production deploy is:
1. Build the API container with `node:20-alpine`, copy `apps/api/dist` and the workspace `node_modules`, set the env vars above, expose `PORT`.
2. Build the web app and serve from a CDN (CloudFront, Vercel static, S3+CloudFront, Netlify). Set `VITE_API_URL` at build time to your API host.
3. Either point your CDN at the API for the `/api/*` path, or hard-code the API origin in `VITE_API_URL` and configure the API's `CORS_ORIGINS` accordingly.

---

## Design system

Everything in `apps/web/src/styles/tokens.css` is a 1:1 mapping of the tokens in [`design-system.md`](./design-system.md):

- Section 2 → CSS custom properties (`--bg-base`, `--text-primary`, status colors, etc.)
- Section 3 → typography classes (`.display-xl`, `.heading-md`, `.body-md`, `.eyebrow`, `.mono`)
- Section 4 → `--space-0`…`--space-13`
- Section 5 → `--radius-sm/md/lg/xl/full`
- Section 7 → component CSS (`.btn`, `.input`, `.card`, `.chip`, `.badge`, `.tbl`, `.pill-nav`, `.stat-row`)
- Section 8 → layout shell (`.app`, `.sidebar`, `.topbar`, `.content`, `.mobile-nav`)

Switching to light theme is `<html data-theme="light">`. The `setTheme` action in `apps/web/src/store/ui.ts` writes the attribute and persists to `localStorage`.

---

## Project status

- ✅ Monorepo, shared packages, shared TS types
- ✅ Express API with auth (JWT), services for cases, hearings, tasks, documents, dashboard, drafting, research; rate-limit, helmet, CORS, structured logging, validation
- ✅ Vite + React app shell, routing, theme + density + language preferences, command palette (⌘K), notifications panel, mobile nav, toast system
- ✅ Design tokens & global CSS aligned 1:1 with `design-system.md`
- ✅ Views: Landing, Auth, Dashboard, Cases (list + detail), Drafting, Contract Review, Tasks, Documents, Research, Settings
- 🟡 Stub views (calendar, clients, leads, clauses, invoices, expenses, limitation, diary, causelist, ecourts, stamp, archive, members, analytics) render through the shell with the right title/eyebrow — drop a real view file in `apps/web/src/views/` and the existing route picks it up
- 🟡 Backend persistence is in-memory — swap for your DB of choice
- 🟡 No tests yet — Vitest is wired into both apps (`pnpm test`); add them as you work

---

## License

UNLICENSED — internal handoff bundle. Replace with your chosen license before distribution.
