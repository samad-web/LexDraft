# LexDraft — System Overview

**Purpose:** A single-page reference describing the LexDraft application's workflow, architecture, and user roles. Pairs with [README.md](./README.md), [PRICING_AND_TIERS.md](./PRICING_AND_TIERS.md), [WORKFLOW_DASHBOARDS.md](./WORKFLOW_DASHBOARDS.md), and [lexdraft-user-management-spec.md](./lexdraft-user-management-spec.md).

---

## 1. What LexDraft is

LexDraft is a multi-tenant practice-management SaaS for Indian advocates. It bundles drafting (with optional Claude-assisted generation), contract review, matter/case management, hearing & cause-list tracking, limitation-period alerting, billing, and client collaboration into a single web app.

The product is sold in three customer-facing plans — **Solo**, **Practice**, and **Firm** — backed by a fourth, internal-only **SuperAdmin** control plane.

---

## 2. Architecture

### 2.1 Repo shape

A pnpm + Turborepo monorepo:

```
LexDraft/
├── apps/
│   ├── web/      Vite + React 18 + TypeScript SPA
│   └── api/      Node + Express 4 + TypeScript REST API
└── packages/
    ├── types/             Shared domain types (web ⇄ api contract)
    ├── ui/                Shared component primitives (Icon, Button, Card, Badge)
    ├── tsconfig/          Shared TS configs
    ├── eslint-config/     Shared ESLint configs
    └── tailwind-config/   Tailwind preset bound to design tokens
```

### 2.2 Frontend ([apps/web](./apps/web))

- **Stack:** Vite, React 18 (strict), TypeScript, React Router v6, TanStack Query for server state, Zustand for cross-cutting UI/auth state, Axios for transport.
- **Auth handling:** [`apps/web/src/lib/api.ts`](./apps/web/src/lib/api.ts) attaches the JWT and clears the session on `401`.
- **Routing:** Public (`/`, `/auth/*`) and protected app shell (`/app/*`). `/app/dashboard` is dispatched via a `DashboardRouter` that picks Solo / Practice / Firm based on `user.plan`.
- **Design system:** Monochrome Legal — CSS custom properties in [`apps/web/src/styles/tokens.css`](./apps/web/src/styles/tokens.css) drive both `globals.css` and the Tailwind preset. Dark theme is default; light is a single `<html data-theme="light">` swap.
- **Views** ([apps/web/src/views/](./apps/web/src/views/)) are the unit of feature: Landing, Auth, three Dashboards (Solo/Practice/Firm), Cases, Drafting, Contract Review, Tasks, Documents, Research, Clients, Leads, Clauses, Invoices, Expenses, Limitation, Diary, Cause List, eCourts, Stamp, Archive, Members, Analytics, Settings, plus a Client Portal sub-app under `views/portal/` and an admin sub-app under `views/manage/`.

### 2.3 Backend ([apps/api](./apps/api))

- **Stack:** Express 4, TypeScript, Zod for validation, `pino` (pretty in dev) for structured logs, `helmet` + `cors` + `compression` + `morgan` + `express-rate-limit` for hardening.
- **Auth:** JWT (HS256) via `jsonwebtoken`, passwords hashed with `bcryptjs`. Two demo accounts seeded; in dev any email + password `lexdraft` will provision a user, and emails containing `admin` are auto-promoted to superadmin.
- **Layering:** Routes are thin adapters that validate input and delegate to a [services layer](./apps/api/src/services/) holding business logic. Persistence is Postgres (Supabase-hosted in dev/prod) accessed via the `postgres` npm package using raw SQL tagged templates — no ORM. Schema lives under [`apps/api/migrations/`](./apps/api/migrations/) as numbered `.sql` files run by [`src/scripts/migrate.ts`](./apps/api/src/scripts/migrate.ts) (`pnpm --filter @lexdraft/api db:migrate`). Demo mode (no `DATABASE_URL`) falls back to seed data via the `db()` helper returning null. (Earlier drafts of this doc described in-memory module-level maps — that was the prototype layout, replaced by migration `0001_init.sql`.)
- **Drafting:** When `ANTHROPIC_API_KEY` or `XAI_API_KEY` is set, [`drafting.service.ts`](./apps/api/src/services/drafting.service.ts) calls the configured LLM provider with a structured brief; otherwise it returns a deterministic template so the UI is fully usable in dev.
- **Webhooks:** Generic `POST /api/webhooks/:source` endpoint with per-provider signature verification — see [`webhooks.routes.ts`](./apps/api/src/routes/webhooks.routes.ts). Note: verification is implemented but per-source dispatch (eCourts, payment, e-sign) is not yet wired. The endpoint currently acknowledges verified payloads with `{ received: true, dispatched: false }`.

### 2.4 Route surface (high level)

Mounted in [`apps/api/src/routes/index.ts`](./apps/api/src/routes/index.ts):

| Mount                | Auth                       | Purpose                                                        |
|----------------------|----------------------------|----------------------------------------------------------------|
| `/api/health`        | public                     | Liveness                                                       |
| `/api/auth/*`        | public                     | Sign-in, sign-up, sign-out, `me`                               |
| `/api/webhooks/:src` | upstream-signed            | Inbound from eCourts / payments / e-sign                       |
| `/api/portal/*`      | portal JWT (magic link)    | Client-facing portal                                           |
| `/api/invitations/*` | mixed (token public)       | Accept-invite endpoints + admin-side management                |
| `/api/dashboard`     | `requireAuth`              | Aggregated home payload (Solo)                                 |
| `/api/firm/*`        | `requireAuth`              | Firm-scoped dashboard, members, settings                       |
| `/api/cases`         | `requireAuth`              | Matters CRUD                                                   |
| `/api/hearings`      | `requireAuth`              | Today / upcoming                                               |
| `/api/tasks`         | `requireAuth`              | Kanban `TaskBoard`                                             |
| `/api/documents`     | `requireAuth`              | Document register                                              |
| `/api/drafting`      | `requireAuth`              | `POST /generate` — Claude or template                          |
| `/api/drafts`        | `requireAuth`              | Draft documents persistence                                    |
| `/api/research`      | `requireAuth`              | Lex.AI canned answer + citations                               |
| `/api/clauses`       | `requireAuth`              | Clause library                                                 |
| `/api/clients`       | `requireAuth`              | Clients                                                        |
| `/api/leads`         | `requireAuth`              | Sales/intake leads                                             |
| `/api/invoices`      | `requireAuth`              | Billing                                                        |
| `/api/expenses`      | `requireAuth`              | Expenses                                                       |
| `/api/limitations`   | `requireAuth`              | Limitation Act tracker                                         |
| `/api/diary`         | `requireAuth`              | Hearing diary                                                  |
| `/api/archive`       | `requireAuth`              | Archive of closed matters                                      |
| `/api/analytics`     | `requireAuth`              | Firm-level analytics (gated by plan client-side)               |
| `/api/me`            | `requireAuth`              | Self-service profile + resolved feature set                    |
| `/api/admin/*`       | `requireAuth + requireSuperadmin` | Platform-admin control plane (impersonation banned here) |

### 2.5 Multi-tenancy & permissions

LexDraft enforces a **three-layer feature gate** ([lexdraft-user-management-spec.md §5](./lexdraft-user-management-spec.md)):

```
can(user, feature) =
    feature ∈ BASELINE                       (always allowed)
    OR ( PlanHasFeature(firm.plan, feature)  (Layer 1 — subscription)
       AND RoleHasFeature(user.role, feature) (Layer 2 — role)
       AND NOT user_override(deny)            (Layer 3 — per-user)
       OR  user_override(grant) )
```

Tenant isolation: every protected query is filtered by `firm_id`; no cross-tenant access in v1.

---

## 3. User roles

LexDraft has two role planes: **inside a tenant** (firm/practice/solo) and **inside SuperAdmin** (LexDraft staff only).

### 3.1 Tenant roles (per [lexdraft-user-management-spec.md §4](./lexdraft-user-management-spec.md))

| Role                       | Default capabilities                                                                                  |
|----------------------------|-------------------------------------------------------------------------------------------------------|
| **Firm Admin**             | Full feature access + User Management + Billing. Bootstrap user when a tenant is provisioned.         |
| **Practice Group Lead**    | All drafting features + manage users within their practice group.                                     |
| **Partner**                | Full drafting, review, e-sign, matter management, billing view.                                       |
| **Senior Associate**       | Drafting, AI drafting, clause library, review, e-sign.                                                |
| **Associate**              | Drafting, AI drafting, clause library.                                                                |
| **Paralegal**              | Limited drafting, templates, document assembly.                                                       |
| **Legal Secretary**        | Document formatting, calendar, basic templates.                                                       |
| **Intern / Trainee**       | Read-only or restricted drafting.                                                                     |
| **External Client (v2)**   | View-only access to shared matters via the client portal.                                             |
| **Custom roles**           | Firm Admins can clone/extend any system role; scoped to the tenant.                                   |

**Invariants:**
- Every user has exactly one role at any time.
- A tenant must always have ≥ 1 active Firm Admin (last-admin demotion blocked at the API).
- Role changes write to the tenant audit log.

### 3.2 SuperAdmin roles (LexDraft-internal, per [PRICING_AND_TIERS.md §4.8](./PRICING_AND_TIERS.md))

| Role                  | Tenant impersonation | Billing edits | Compliance views |
|-----------------------|:--------------------:|:-------------:|:----------------:|
| Founder / Owner       | yes                  | yes           | yes              |
| Support engineer      | yes (with reason)    | —             | read-only        |
| Billing operations    | —                    | yes           | —                |
| Compliance officer    | —                    | —             | yes + edit       |
| Read-only auditor     | —                    | —             | read             |

Every SuperAdmin action writes to a tamper-evident, indefinitely-retained audit log. Impersonation surfaces a persistent banner in the UI ([`apps/web/src/admin/ImpersonationBanner.tsx`](./apps/web/src/admin/ImpersonationBanner.tsx)) and is blocked from the `/api/admin/*` surface.

### 3.3 Plan vs. role

> **Plan determines surface area; role determines actions within that surface.**

The plan controls which sidebar groups and which dashboard a user lands on; the role controls whether that user can invite, bill, or see firm-wide data. See [WORKFLOW_DASHBOARDS.md §2](./WORKFLOW_DASHBOARDS.md).

---

## 4. Workflows

### 4.1 Tenant provisioning

```
SuperAdmin                Tenant
  │                         │
  ├─ POST /admin/firms ─────▶
  │   { name, type, plan,   │  creates firm record + plan entitlement set
  │     billing, admin@… }  │  creates Firm Admin (status: pending_activation)
  │                         │  emits single-use 24 h activation token
  │                         │
  │                  ◀──────┤  activation email
  │                         │
  │                         ├─ Firm Admin sets password + MFA
  │                         ├─ first-login Setup Checklist
  │                         │   • confirm firm details
  │                         │   • create practice groups
  │                         │   • customise roles (if allowed by plan)
  │                         │   • invite users
  │                         │   • review feature toggles
```

Sales-led Firm provisioning adds an MSA + DPA + DPIA stage before the tenant is created; details in [PRICING_AND_TIERS.md §5.3](./PRICING_AND_TIERS.md).

### 4.2 User onboarding (Firm Admin → invitee)

1. Firm Admin invites users (single or CSV).
2. System emits invite tokens (single-use, 24 h).
3. Invitee accepts via [InviteAcceptView](./apps/web/src/views/InviteAcceptView.tsx) → sets credentials → lands on `/app/dashboard`.
4. `/app/dashboard` renders `<AdvocateDashboardView>` for every plan (today in court, needs attention, next 7 days, practice figures; firm pulse for partners/admins/PG leads). The firm-wide view is `<FirmDashboardView>` at `/app/firm`.

### 4.3 Sign-in & session

1. `POST /api/auth/sign-in` returns a 7-day HS256 JWT.
2. The web client persists it in Zustand + localStorage; `axios` attaches `Authorization: Bearer <jwt>`.
3. `/api/auth/me` returns the current user including `plan` (resolved from `firms.plan_tier`) and the resolved feature set.
4. A `401` from any endpoint clears the session and bounces to `/auth`.

### 4.4 Daily advocate workflow (Solo dashboard)

```
Sign-in
  └─▶ /app/dashboard (Solo)
        ├─ §0 Masthead — greeting + alerts summary
        ├─ §I  Today's work — "Draft a new document" + drafts in progress
        ├─ §II  Today's cause list — listed hearings
        ├─ §III Notices to the bench — alerts
        ├─ §IV Limitation index — statutory deadlines
        ├─ §V  Document register
        └─ §VI Stat row — Active matters · Clients · Open notices · Revenue
```

### 4.5 Practice (chambers) workflow

The Practice dashboard adds a chambers-pulse strip, a today-across-the-firm hearing list grouped by advocate, an Active Members table, and a recent-activity feed sourced from the audit log. No revenue charts or top-clients tables — those are Firm-only.

### 4.6 Firm workflow

The Firm dashboard ([FirmDashboardView.tsx](./apps/web/src/views/FirmDashboardView.tsx)) layers on KPI strip, monthly revenue chart, matters by stage, members table, practice mix, top clients, today's hearings, and notices. The full Firm sidebar (Firm overview / Members / Analytics / Settings) is visible.

### 4.7 Drafting workflow

```
DraftingView
  │  user picks docType, language, tone, fields
  ├─▶ POST /api/drafting/generate
  │     ├─ ANTHROPIC_API_KEY set?
  │     │     ├─ yes → Claude (model from ANTHROPIC_MODEL) with structured brief
  │     │     └─ no  → deterministic template fallback
  │     └─ returns generated body + citations
  ├─ user reviews / edits in-place
  ├─ saves to drafts (POST /api/drafts) → appears in document register
  └─ optional: send to e-sign or push to client portal
```

### 4.8 Cause-list / hearings workflow

eCourts CNR sync (where wired) feeds [`hearings.service.ts`](./apps/api/src/services/hearings.service.ts). The dashboard pulls `GET /api/hearings/today`; the diary view pulls the broader window. Limitation calculations live in [`limitations.calculator.ts`](./apps/api/src/services/limitations.calculator.ts) and surface as the limitation index on every dashboard.

### 4.9 SuperAdmin workflows

Lifecycle, identity & impersonation, billing ops, usage & customer-health, support tooling, DPDP/compliance, and platform operations — full inventory in [PRICING_AND_TIERS.md §4](./PRICING_AND_TIERS.md). All routes mount at `/api/admin/*` behind `requireAuth + requireSuperadmin`.

### 4.10 Client portal workflow

External clients receive a magic link → exchange for a portal JWT at `/api/portal/auth/*` → land on a stripped-down portal app under [`apps/web/src/views/portal/`](./apps/web/src/views/portal/). Portal sessions cannot reach the firm-side routes.

---

## 5. Reference points

- **Plans, pricing, gating:** [PRICING_AND_TIERS.md](./PRICING_AND_TIERS.md)
- **Per-plan dashboard model:** [WORKFLOW_DASHBOARDS.md](./WORKFLOW_DASHBOARDS.md)
- **RBAC + tenant onboarding spec:** [lexdraft-user-management-spec.md](./lexdraft-user-management-spec.md)
- **Design tokens & components:** [design-system.md](./design-system.md)
- **API contract source of truth:** [packages/types/src/index.ts](./packages/types/src/index.ts)
- **Backend route map:** [apps/api/src/routes/index.ts](./apps/api/src/routes/index.ts)
