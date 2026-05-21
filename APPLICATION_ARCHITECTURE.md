# LexDraft — Application Architecture, Workflow & Reference

**Status:** Living document · Generated 2026-05-20
**Audience:** Engineers, technical PMs, and reviewers onboarding to LexDraft.
**Companion docs:** [README.md](./README.md), [OVERVIEW.md](./OVERVIEW.md), [WORKFLOW_DASHBOARDS.md](./WORKFLOW_DASHBOARDS.md), [lexdraft-user-management-spec.md](./lexdraft-user-management-spec.md), [design-system.md](./design-system.md), [DEPLOYMENT.md](./DEPLOYMENT.md), [CLIENT_PORTAL.md](./CLIENT_PORTAL.md), [PRIVACY_POLICY.md](./PRIVACY_POLICY.md), [TERMS_OF_SERVICE.md](./TERMS_OF_SERVICE.md), [DATA_PROCESSING_AGREEMENT.md](./DATA_PROCESSING_AGREEMENT.md).

---

## Table of contents

1. [What LexDraft is](#1-what-lexdraft-is)
2. [High-level architecture](#2-high-level-architecture)
3. [Repository layout](#3-repository-layout)
4. [Technology stack](#4-technology-stack)
5. [Backend architecture (`apps/api`)](#5-backend-architecture-appsapi)
6. [Frontend architecture (`apps/web`)](#6-frontend-architecture-appsweb)
7. [Shared packages](#7-shared-packages)
8. [Data model & persistence](#8-data-model--persistence)
9. [Authentication, authorization & multi-tenancy](#9-authentication-authorization--multi-tenancy)
10. [Plans, roles & feature gating](#10-plans-roles--feature-gating)
11. [End-to-end workflows](#11-end-to-end-workflows)
12. [AI / Claude integration](#12-ai--claude-integration)
13. [Client portal sub-app](#13-client-portal-sub-app)
14. [SuperAdmin control plane](#14-superadmin-control-plane)
15. [Environment variables](#15-environment-variables)
16. [Local development](#16-local-development)
17. [Build & deployment](#17-build--deployment)
18. [Observability & operations](#18-observability--operations)
19. [Security model](#19-security-model)
20. [Project status & roadmap](#20-project-status--roadmap)

---

## 1. What LexDraft is

LexDraft is a **multi-tenant practice-management SaaS for Indian advocates**. It bundles into a single web app:

- **Drafting** (template + Claude-assisted generation across multiple Indian languages).
- **Contract review** (clause-by-clause AI review with reviewer workflow).
- **Mock arguments** (AI-assisted opposing-counsel rebuttal generator with polish/improve flow).
- **Matter / case management** (notes, tasks, documents, hearings, limitation tracking).
- **Cause-list & hearing diary** (with eCourts CNR sync hook).
- **Legal research** (Lex.AI canned answer + statute citations, semantic laws search).
- **Billing** (invoices, expenses, exports).
- **Client collaboration** (separate client portal sub-app with magic-link auth).
- **Firm administration** (members, roles, analytics, audit log, MFA, DPDP self-service).

It is sold in three customer-facing plans — **Solo**, **Practice**, and **Firm** — with an internal-only **SuperAdmin** control plane operated by LexDraft staff.

---

## 2. High-level architecture

```
                ┌────────────────────────────────────────────┐
                │              Browser / Mobile              │
                │  (React SPA + lazy-loaded Portal sub-app)  │
                └───────────────┬────────────────────────────┘
                                │ HTTPS (JWT bearer)
                                │
                ┌───────────────▼───────────────┐
                │       CDN / Static Host       │  apps/web/dist
                └───────────────┬───────────────┘
                                │ /api/* (proxied in dev)
                                │
                ┌───────────────▼───────────────┐
                │       Express API (Node)      │  apps/api/dist
                │  routes ─► services ─► db     │
                └───┬────────┬──────────┬───────┘
                    │        │          │
       ┌────────────▼──┐ ┌───▼────┐ ┌───▼─────────────┐
       │  PostgreSQL   │ │ pg-boss│ │ Anthropic Claude│
       │ (multi-tenant │ │ (jobs) │ │  (drafting / AI │
       │  row-filtered)│ │        │ │   review / etc.)│
       └───────────────┘ └────────┘ └─────────────────┘
                    │
       ┌────────────▼──┐
       │  Webhooks in  │  /api/webhooks/:source
       │  (eCourts /   │  per-provider signature verification
       │   payments /  │
       │   e-sign)     │
       └───────────────┘
```

Key non-functional properties:

- **Tenant isolation by `firm_id`** on every protected query.
- **Stateless API** — JWT bearer, no server-side session store. Horizontal scale by replicating the Node process.
- **Background jobs** via `pg-boss` (`apps/api/src/services/jobs.service.ts`) — analytics refresh, embedding generation, scheduled reminders.
- **Vector search** via embeddings (`embeddings.service.ts`) for laws/research.
- **Single-origin in dev** (Vite proxy); **CORS-allowlisted multi-origin in prod**.

---

## 3. Repository layout

```
LexDraft/
├── apps/
│   ├── api/                Node + Express + TypeScript REST API
│   │   ├── migrations/     0001…0039 numbered SQL migrations
│   │   ├── src/
│   │   │   ├── routes/     thin HTTP adapters (Zod validation)
│   │   │   ├── services/   business logic (the substance of the app)
│   │   │   ├── middleware/ auth, rate-limit, requireActivePlan, errorHandler
│   │   │   ├── db/         postgres client + migration runner
│   │   │   ├── lib/        text-extraction, languages, helpers
│   │   │   ├── eval/       evaluation harness for AI features
│   │   │   └── scripts/    migrate, seeds
│   │   └── package.json
│   └── web/                Vite + React 18 + TypeScript SPA
│       ├── src/
│       │   ├── views/      one file per route (~40 views + portal/ + manage/)
│       │   ├── components/ shared shell + feature components
│       │   ├── hooks/      React Query hooks (one per backend resource)
│       │   ├── store/      Zustand stores (auth, ui)
│       │   ├── admin/      SuperAdmin shell + views
│       │   ├── lib/        api.ts (axios + JWT), doc-schemas, etc.
│       │   └── styles/     tokens.css + globals.css (design-system)
│       └── package.json
├── packages/
│   ├── types/              Shared domain types (web ⇄ api contract)
│   ├── ui/                 Shared primitives (Icon, Button, Card, Badge)
│   ├── tsconfig/           Shared TS configs (base / react / node)
│   ├── eslint-config/      Shared ESLint configs
│   └── tailwind-config/    Tailwind preset bound to design tokens
├── scripts/                Repo-level tooling
├── _design/                Design artefacts
├── docker-compose.yml      Local Postgres + API + web
├── docker-compose.prod.yml Production-shaped compose
├── turbo.json              Turborepo pipeline definition
└── pnpm-workspace.yaml     Workspace globs
```

---

## 4. Technology stack

### Runtime & tooling
- **Node.js ≥ 20** (`.nvmrc` pins `20.18.0`).
- **pnpm ≥ 9** as the package manager; **Turborepo 2** to orchestrate workspace tasks.
- **TypeScript 5.6** across every workspace, strict mode.

### Backend (`apps/api`)
- **Express 4** + **Zod** for input validation.
- **postgres** (the `postgres` npm package) for the SQL driver; raw SQL via tagged templates — no ORM.
- **pg-boss** for background jobs (Postgres-backed queue).
- **jsonwebtoken** (HS256) + **bcryptjs** for auth.
- **otplib** + **qrcode** for TOTP MFA.
- **mammoth** (DOCX) + **pdf-parse** (PDF) for text extraction.
- **pino** + **pino-pretty** for structured logging.
- **helmet**, **cors**, **compression**, **morgan**, **express-rate-limit** for hardening.
- **Anthropic SDK** (called via HTTP — see `drafting.service.ts`) for AI features when `ANTHROPIC_API_KEY` is set.

### Frontend (`apps/web`)
- **Vite 5** + **React 18** + **react-router-dom 6**.
- **@tanstack/react-query 5** for server state (one hook per resource in [apps/web/src/hooks/](./apps/web/src/hooks/)).
- **Zustand 5** for cross-cutting UI/auth state (theme, density, language, current user, JWT).
- **axios** with an interceptor that attaches the JWT and clears the session on `401` — see [apps/web/src/lib/api.ts](./apps/web/src/lib/api.ts).
- **framer-motion** for transitions, **lenis** for scroll, **html2canvas** + **jspdf** for client-side PDF export.
- **mammoth** + **pdfjs-dist** for client-side document parsing/preview.
- **Tailwind CSS 3** driven by a workspace preset that maps the design tokens.

---

## 5. Backend architecture (`apps/api`)

### 5.1 Layering

```
HTTP request
    │
    ▼
┌──────────────────────┐
│  middleware/         │  helmet, cors, compression, morgan, rate-limit,
│                      │  requireAuth / optionalAuth, requireSuperadmin,
│                      │  requireActivePlan, errorHandler
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  routes/*.routes.ts  │  Thin: Zod-validate body / params / query,
│                      │  delegate to service, format response.
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  services/*.ts       │  Business logic. Tenant scoping (firm_id).
│                      │  Permission checks. Audit-log emission.
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  db/client.ts        │  Postgres via tagged templates.
└──────────────────────┘
```

Routes never touch the database directly; services are the only callers of `db()`.

### 5.2 Route map

Mounted in [apps/api/src/routes/index.ts](./apps/api/src/routes/index.ts).

| Mount | Auth | Plan gate | Purpose |
|---|---|---|---|
| `GET /api/health` | public | — | Liveness — process is up |
| `GET /api/ready` | public | — | Readiness — DB ping included |
| `/api/auth/*` | public | — | Sign-in, sign-up, sign-out, `me` |
| `/api/webhooks/:src` | upstream-signed | — | Inbound from eCourts / payments / e-sign |
| `/api/survey/*` | public (rate-limited) | — | Market-research questionnaire |
| `/api/portal/*` | portal JWT | — | Client-facing portal (magic link auth) |
| `/api/invitations/*` | mixed (token public) | — | Accept-invite + admin management |
| `/api/dashboard` | `requireAuth` | `requireActivePlan` | Aggregated home payload (Solo) |
| `/api/firm/*` | `requireAuth` | `requireActivePlan` | Firm-scoped dashboard / members / settings |
| `/api/cases` | `requireAuth` | `requireActivePlan` | Matters CRUD |
| `/api/case-notes` | `requireAuth` | `requireActivePlan` | Per-matter notes timeline |
| `/api/hearings` | `requireAuth` | `requireActivePlan` | Today / upcoming hearings |
| `/api/tasks` | `requireAuth` | `requireActivePlan` | Kanban `TaskBoard` |
| `/api/documents` | `requireAuth` | `requireActivePlan` | Document register |
| `/api/drafting` | `requireAuth` | `requireActivePlan` | `POST /generate` — Claude or template |
| `/api/drafts` | `requireAuth` | `requireActivePlan` | Persisted drafts |
| `/api/review` | `requireAuth` | `requireActivePlan` | Contract review workflow |
| `/api/mock-arguments` | `requireAuth` | `requireActivePlan` | Mock arguments generator + polish |
| `/api/letterheads` | `requireAuth` | `requireActivePlan` | Firm letterhead templates |
| `/api/research` | `requireAuth` | `requireActivePlan` | Lex.AI canned answer + citations |
| `/api/laws` | `requireAuth` | `requireActivePlan` | Semantic laws search (embeddings) |
| `/api/clauses` | `requireAuth` | `requireActivePlan` | Clause library |
| `/api/clients` | `requireAuth` | `requireActivePlan` | Clients CRUD |
| `/api/leads` | `requireAuth` | `requireActivePlan` | Sales/intake leads |
| `/api/invoices` | `requireAuth` | `requireActivePlan` | Billing |
| `/api/expenses` | `requireAuth` | `requireActivePlan` | Expenses |
| `/api/limitations` | `requireAuth` | `requireActivePlan` | Limitation Act tracker |
| `/api/diary` | `requireAuth` | `requireActivePlan` | Hearing diary |
| `/api/archive` | `requireAuth` | `requireActivePlan` | Archive of closed matters |
| `/api/physical-documents` | `requireAuth` | `requireActivePlan` | Physical-file register |
| `/api/analytics` | `requireAuth` | `requireActivePlan` | Firm-level analytics |
| `/api/me` | `requireAuth` | — | Self-service profile + resolved feature set |
| `/api/me/mfa` | `optionalAuth` | — | TOTP enrolment + verification (challenge step pre-bearer) |
| `/api/me/dpdp` | `requireAuth` | — | DPDP self-service (export / delete) |
| `/api/sanhita` | `requireAuth` | `requireActivePlan` | Statute reference (BNS / BNSS / BSA) |
| `/api/calculators` | `requireAuth` | `requireActivePlan` | Stamp / court-fee / limitation calculators |
| `/api/conflicts` | `requireAuth` | `requireActivePlan` | Conflict-check search |
| `/api/coverage` | `requireAuth` | `requireActivePlan` | Coverage requests (cover-counsel) |
| `/api/practice-analytics` | `requireAuth` | `requireActivePlan` | Practice-scope analytics |
| `/api/engagement` | `requireAuth` | `requireActivePlan` | Engagement-letter templates |
| `/api/caseload-health` | `requireAuth` | `requireActivePlan` | Caseload-health diagnostics |
| `/api/exports` | `requireAuth` | `requireActivePlan` | Financial / data exports |
| `/api/portal-admin` | `requireAuth` | `requireActivePlan` | Firm-side portal administration |
| `/api/admin/*` | `requireAuth + requireSuperadmin` | — | Platform admin (impersonation banned here) |
| `/api/admin/errors` | `requireAuth + requireSuperadmin` | — | Internal error log viewer |

`requireActivePlan` returns **402 PaymentRequired** when `firms.plan_status` is `past_due` / `cancelled`, or when `renews_at` is in the past for a non-trial firm. SuperAdmins + impersonation sessions bypass the check. `/me*` is deliberately excluded so users can still log in to manage their profile / billing after a plan lapses.

### 5.3 Service inventory

Each file in [apps/api/src/services/](./apps/api/src/services/) owns one business capability. Highlights:

| Service | Responsibility |
|---|---|
| `auth.service.ts` | Sign-in / sign-up, JWT issuance, password hashing, demo-account provisioning |
| `permissions.service.ts` | Three-layer feature gate: BASELINE ∨ (Plan ∧ Role ∧ ¬deny ∨ grant) |
| `cases.service.ts`, `case-notes.service.ts` | Matter CRUD + note timeline |
| `hearings.service.ts` | Today / upcoming hearings, eCourts ingestion seam |
| `tasks.service.ts` | Kanban board (`pending` → `progress` → `review` → `done`) |
| `documents.service.ts`, `drafts.service.ts` | Document register + draft persistence |
| `drafting.service.ts` | Claude-assisted document generation with template fallback |
| `review.service.ts`, `review-comments.service.ts` | Contract-review workflow + comment threads |
| `mock-arguments.service.ts` | Opposing-counsel rebuttal generator (polish + improve) |
| `research.service.ts`, `laws-search.service.ts` | Lex.AI answer + semantic statute search with garble filter |
| `embeddings.service.ts` | Vector embeddings for laws/research |
| `clients.service.ts`, `leads.service.ts` | Client + intake management |
| `invoices.service.ts`, `expenses.service.ts`, `exports.service.ts` | Billing pipeline |
| `limitations.service.ts`, `limitations.calculator.ts` | Limitation Act deadline math |
| `diary.service.ts`, `archive.service.ts` | Hearing diary + closed-matter archive |
| `analytics.service.ts`, `practice-analytics.service.ts`, `analytics-refresh.service.ts` | Firm + practice analytics with materialized refresh |
| `caseload-health.service.ts` | Stale-matter / overdue diagnostics |
| `conflicts.service.ts`, `coverage.service.ts` | Conflict-checks + cover-counsel requests |
| `sanhita.service.ts` | Statute reference (BNS / BNSS / BSA) |
| `calculators.service.ts` | Stamp duty / court fee / limitation calculators |
| `engagement.service.ts`, `templates.service.ts` | Engagement-letter & draft templates |
| `letterheads.service.ts` | Firm letterhead assets |
| `physical-documents.service.ts` | Physical-file register |
| `clauses.service.ts` | Clause library |
| `firm.service.ts`, `firm-admin.service.ts`, `firm-enquiries.service.ts` | Firm CRUD + admin actions + sales enquiries |
| `invitations.service.ts` | Single-use 24h invite tokens |
| `mfa.service.ts` | TOTP enrolment + verify (otplib + qrcode) |
| `dpdp.service.ts` | DPDP export / erasure / consent ledger |
| `audit.service.ts` | Tamper-evident audit log (firm + platform) |
| `impersonation.service.ts` | SuperAdmin impersonation with reason + banner |
| `notifications.service.ts` | In-app + email notifications |
| `webhooks.verify.ts` | Per-provider HMAC verification |
| `plan-status.service.ts`, `portal-plan-gate.ts` | Subscription state |
| `portal.service.ts` | Client-portal logic (magic links, scoped JWT, matter visibility) |
| `survey.service.ts`, `survey-draft.service.ts` | Public market-research questionnaire |
| `admin.service.ts`, `error-log.service.ts` | Platform admin + internal error viewer |
| `jobs.service.ts` | pg-boss background queue (analytics refresh, embeddings, reminders) |
| `cache-broadcaster.ts` | In-process cache invalidation broadcast |
| `storage.service.ts` | Blob storage (signed URLs, etc.) |
| `tenant.ts` | Tenant scoping helpers used by every service |

### 5.4 Middleware

- `requireAuth` — verifies JWT, attaches `req.user`. Rejects with `401`.
- `optionalAuth` — verifies JWT if present; the handler is responsible for checking `req.user`. Used for the MFA challenge step (post-password, pre-bearer).
- `requireSuperadmin` — gate for `/api/admin/*`. Blocks impersonation sessions.
- `requireActivePlan` — returns `402` when the firm's plan has lapsed. SuperAdmins + impersonation bypass.
- `rateLimit` — IP-level limits; tighter `signUpLimiter`, looser `surveyDraftLimiter`.
- `errorHandler` — turns Zod failures into `400`, unknown errors into `500`, attaches `requestId` for tracing.

### 5.5 Database & migrations

All schema lives in numbered SQL migrations under [apps/api/migrations/](./apps/api/migrations/). The runner is `apps/api/src/scripts/migrate.ts`. Currently:

```
0001_init.sql                       core tables (users, firms, cases, hearings, tasks, documents)
0002_seed.sql                       demo data
0003_admin.sql                      SuperAdmin roles + audit log
0004_clauses.sql                    clause library
0004_remove_seed.sql                production cleanup
0005_extra_tables.sql               leads, invoices, expenses, limitation, diary, archive, clients
0006_drafts.sql                     draft persistence
0007_task_priority_rename.sql       task field rename
0008_seed_firm_plan_solo.sql        plan-tier seed
0009_rbac.sql                       role-based access control core
0010_documents_storage.sql          blob refs
0011_client_portal.sql              portal accounts + scoped tokens
0012_rbac_extra_features.sql        additional feature flags
0013_portal_messages_and_ack.sql    portal threads
0013_solo_role_and_tier_gates.sql   tier-gate cleanup
0014_portal_profile_prefs.sql       portal user prefs
0015_portal_visibility_flags.sql    matter visibility toggles
0016_solo_drafting_ai.sql           AI-draft quota for Solo
0017_physical_documents.sql         physical-file register
0018_index_audit.sql                index tuning + audit-log polish
0019_mfa.sql                        TOTP enrolment tables
0020_dpdp.sql                       DPDP exports / erasure / consent
0021_analytics_views.sql            materialized analytics
0022_limitation_statute.sql         limitation reference data
0023_coverage_requests.sql          cover-counsel exchange
0024_engagement_templates.sql       engagement letters
0025_error_log.sql                  internal error log
0026_contract_reviews.sql           review workflow base
0027_review_workflow.sql            review states + assignments
0028_review_for_all_tiers.sql       review unlock across tiers
0029_letterheads.sql                firm letterheads
0030_signup_profile_fields.sql      profile capture at sign-up
0031_survey_responses.sql           survey submissions
0032_survey_drafts.sql              survey draft autosave
0033_case_notes.sql                 per-matter notes timeline
0034_firm_enquiries.sql             sales enquiries
0035_mock_arguments.sql             mock-arguments base
0036_mock_arguments_polish.sql      polish stage
0037_mock_arguments_review_raw.sql  raw-LLM review storage
0038_mock_arguments_improvements.sql improvements pipeline
0039_mock_arguments_language.sql    multi-language support
```

---

## 6. Frontend architecture (`apps/web`)

### 6.1 Routing model

```
/                       LandingView (public)
/auth/*                 AuthView (sign-in / sign-up / activate)
/survey                 SurveyView (public)
/survey/thanks          SurveyThanksView

/app/* (protected — JWT required, redirects to /auth on 401)
├── /dashboard          DashboardRouter ─► Solo / Practice / Firm view by user.plan
├── /firm               FirmDashboardView (deep-link; Practice users see soft notice)
├── /cases              CasesListView
├── /cases/:id          CaseDetailView
├── /drafting           DraftingView
├── /contract-review    ContractReviewView
├── /review-queue       ReviewQueueView
├── /mock-arguments     MockArgumentsView
├── /tasks              TasksView
├── /documents          DocumentsView
├── /research           ResearchView
├── /clients            ClientsView
├── /leads              LeadsView
├── /clauses            ClausesView
├── /invoices           InvoicesView
├── /expenses           ExpensesView
├── /limitation         LimitationView
├── /diary              DiaryView
├── /calendar           CalendarView
├── /causelist          CauseListView
├── /ecourts            EcourtsView
├── /stamp              StampView
├── /sanhita            SanhitaView
├── /calculators        CalculatorsView
├── /coverage           CoverageView
├── /practice-analytics PracticeAnalyticsView
├── /engagement         EngagementTemplatesView
├── /archive            ArchiveView
├── /physical-docs      PhysicalDocsView
├── /members            MembersView          (Practice + Firm only)
├── /analytics          AnalyticsView        (Firm only)
├── /portal-inbox       PortalInboxView      (firm-side view of portal threads)
├── /settings           SettingsView
└── /manage/*           ManageView (firm-admin sub-app)

/portal/* (lazy-loaded sub-app — separate JWT)
├── /login              PortalLoginView (magic link exchange)
├── /dashboard          PortalDashboardView
├── /matters/:id        PortalMatterDetailView
├── /messages           PortalMessagesView
└── /profile            PortalProfileView

/admin/* (SuperAdmin only)
├── /                   AdminDashboardView
├── /firms              FirmsView
├── /firms/:id          FirmDetailView
├── /users              UsersView
├── /audit              AuditLogView
├── /templates          TemplatesView
└── /errors             ErrorLogView
```

### 6.2 State management

- **Zustand** for cross-cutting state — see [apps/web/src/store/auth.ts](./apps/web/src/store/auth.ts) and `store/ui.ts`. Holds: current user, JWT, impersonation `actAs`, theme, density, language, command-palette open state, toast queue.
- **React Query** for server state — every backend resource has a matching hook in [apps/web/src/hooks/](./apps/web/src/hooks/) (e.g. `useCases`, `useCaseNotes`, `useTasks`, `useMockArguments`, `useMePreferences`, `useBrowserCapabilities`, `useSpeechToText`).
- **localStorage** persistence for theme, density, language, and JWT (refreshed on app boot via `refreshUser`).

### 6.3 Shell

- `Sidebar` + `Topbar` + `MobileNav` from `components/shell/`. Nav entries are declared in `components/shell/nav-config.ts` along with a `ROUTE_TITLES` map used to render the topbar title + eyebrow.
- `CmdK` palette opens with `⌘K` / `Ctrl+K`.
- `Toast` system for transient feedback.
- `OfflineBanner`, `MfaPromptBanner`, `DeletionScheduledBanner`, `SuperadminBanner`, `ImpersonationBanner` overlay the shell when their preconditions hold.

### 6.4 Adding a new view

1. Create `apps/web/src/views/MyView.tsx`.
2. Register the route in [apps/web/src/App.tsx](./apps/web/src/App.tsx).
3. Add the sidebar entry in `apps/web/src/components/shell/nav-config.ts`.
4. Add the topbar title + eyebrow in the same file's `ROUTE_TITLES` map.

### 6.5 Design system

Implemented as CSS custom properties in [apps/web/src/styles/tokens.css](./apps/web/src/styles/tokens.css) — a 1:1 mapping of [design-system.md](./design-system.md):

- §2 → tokens (`--bg-base`, `--text-primary`, status colors).
- §3 → typography classes (`.display-xl`, `.heading-md`, `.body-md`, `.eyebrow`, `.mono`).
- §4 → spacing scale `--space-0`…`--space-13`.
- §5 → radii `--radius-sm/md/lg/xl/full`.
- §7 → component CSS (`.btn`, `.input`, `.card`, `.chip`, `.badge`, `.tbl`, `.pill-nav`, `.stat-row`).
- §8 → layout shell (`.app`, `.sidebar`, `.topbar`, `.content`, `.mobile-nav`).

Dark theme is the default. Light theme is a single `<html data-theme="light">` swap.

---

## 7. Shared packages

| Package | Purpose |
|---|---|
| [`@lexdraft/types`](./packages/types/src/index.ts) | The web ⇄ api contract. Domain types: `User`, `Case`, `Hearing`, `Task`, `Document`, `Draft`, `Firm`, `FirmPlanTier`, plus DTOs and API payload shapes. |
| `@lexdraft/ui` | Headless primitives: `Icon`, `Button`, `Card`, `Badge`. Used by both `apps/web` and the admin/portal sub-apps. |
| `@lexdraft/tsconfig` | `tsconfig.base.json`, `tsconfig.react.json`, `tsconfig.node.json`. |
| `@lexdraft/eslint-config` | Shared rules; consumed via `extends`. |
| `@lexdraft/tailwind-config` | Tailwind preset that pulls colors / spacing / radii from the same tokens consumed by `globals.css`. |

---

## 8. Data model & persistence

The schema is owned by the numbered SQL migrations described in §5.5. Production uses PostgreSQL; the driver is the `postgres` npm package, with raw SQL through tagged templates (no ORM, deliberate).

Core entities:

- **`firms`** — tenant. `plan_tier` (`Solo` / `Practice` / `Firm`), `plan_status` (`trial` / `active` / `past_due` / `cancelled`), `renews_at`, billing.
- **`users`** — belongs to a firm. `role` (Firm Admin / Practice Group Lead / Partner / Senior Associate / Associate / Paralegal / Legal Secretary / Intern). `is_superadmin` flag.
- **`cases`** — matters. `case_type`, `stage`, court fields, parties, `client_id`.
- **`case_notes`** — per-matter timeline.
- **`hearings`** — listed dates, court, status; ingested via webhook from eCourts where wired.
- **`tasks`** — Kanban states `pending` → `progress` → `review` → `done`.
- **`documents`**, **`drafts`** — document register + persisted Claude / template output.
- **`clients`**, **`leads`** — CRM.
- **`invoices`**, **`expenses`** — billing.
- **`limitations`** — statutory-deadline tracker, computed by `limitations.calculator.ts`.
- **`diary`**, **`archive`**, **`physical_documents`** — operational records.
- **`clauses`** — clause library.
- **`letterheads`**, **`engagement_templates`** — firm-branded templates.
- **`mock_arguments`** + polish / review-raw / improvements / language tables.
- **`reviews`** — contract-review workflow with comment threads.
- **`portal_accounts`**, **`portal_messages`**, **`portal_acks`** — client portal.
- **`invitations`** — single-use 24h tokens.
- **`mfa_secrets`**, **`mfa_recovery_codes`** — TOTP enrolment.
- **`dpdp_*`** — DPDP exports / erasure requests / consent ledger.
- **`audit_log`** — tamper-evident, indefinitely retained.
- **`error_log`** — internal-only viewer at `/api/admin/errors`.
- **`survey_responses`**, **`survey_drafts`** — public questionnaire.
- **`analytics_*`** — materialized views, refreshed by background job.
- **`embeddings`** — vector embeddings for laws/research semantic search.

Every protected query is filtered by `firm_id`. The helper for tenant scoping lives in `services/tenant.ts`.

---

## 9. Authentication, authorization & multi-tenancy

### 9.1 Authentication

1. `POST /api/auth/sign-in` with `{ email, password }`.
2. The API returns a 7-day **HS256 JWT** (`JWT_EXPIRES_IN` configurable). Default secret is `change-me-in-production-please-32-bytes-min` — **must** be overridden.
3. The web client persists the JWT in Zustand + `localStorage`. The axios interceptor in [apps/web/src/lib/api.ts](./apps/web/src/lib/api.ts) attaches `Authorization: Bearer <jwt>` to every `/api/*` call and clears the session on `401`.
4. `GET /api/auth/me` returns the current user, including `plan` (resolved from `firms.plan_tier`) and the resolved feature set.
5. `POST /api/auth/sign-out` is stateless — the client just discards the token.

**Demo mode** (must be disabled before production):
- `aarav@chambers.law` / `lexdraft` — standard advocate.
- `admin@chambers.law` / `lexdraft` — SuperAdmin.
- Any email containing `admin` is auto-promoted to SuperAdmin.
- Any email + password `lexdraft` provisions a new account.

### 9.2 MFA (TOTP)

Implemented in `mfa.service.ts` + `me-mfa.routes.ts`:
- Enrolment: scan QR (otpauth URL) → enter 6-digit code → backend stores HMAC-protected secret + recovery codes.
- Sign-in: if MFA enabled, password step returns a `challengeId`; `/api/me/mfa/verify-challenge` exchanges code + challenge for the bearer.
- That single endpoint uses `optionalAuth` because the user does not yet hold a bearer at that point.

### 9.3 Tenant isolation

- Every protected service helper takes the resolved `firm_id` from `req.user` and filters every query.
- Cross-tenant access is not permitted in v1.
- SuperAdmin endpoints under `/api/admin/*` bypass tenant scoping by design; impersonation routes attach `actAs.firm_id` with a banner.

---

## 10. Plans, roles & feature gating

### 10.1 The three-layer feature gate

Defined in [`apps/api/src/services/permissions.service.ts`](./apps/api/src/services/permissions.service.ts):

```
can(user, feature) =
    feature ∈ BASELINE                                  (always allowed)
    OR ( PlanHasFeature(firm.plan, feature)             Layer 1 — subscription
       AND RoleHasFeature(user.role, feature)           Layer 2 — role
       AND NOT user_override(deny)                      Layer 3 — per-user
       OR  user_override(grant) )
```

`GET /api/me` returns the **resolved** feature set so the web client can render the right sidebar / buttons without recomputing the rule.

### 10.2 Plans

| Plan | Seats | Surface |
|---|---|---|
| **Solo** | 1 | Solo dashboard. AI-draft quota (20/mo). No Firm sidebar group. |
| **Practice** | 2–8 | Practice dashboard (chambers pulse + members table). AI-draft quota (200/mo). Members + Settings in Firm group; **no** Analytics. |
| **Firm** | 9+ | Full Firm dashboard (KPIs, revenue, members, practice mix, top clients). AI-draft quota (1000/mo). Full Firm sidebar group including Analytics. |

> **Plan determines surface area; role determines actions within that surface.** Solo users cannot see Members or Analytics in the nav; deep-links are redirected to `/app/dashboard`.

### 10.3 Tenant roles

| Role | Default capabilities |
|---|---|
| Firm Admin | Full feature access + User Management + Billing. Bootstrap user when a tenant is provisioned. |
| Practice Group Lead | All drafting features + manage users within their practice group. |
| Partner | Full drafting, review, e-sign, matter management, billing view. |
| Senior Associate | Drafting, AI drafting, clause library, review, e-sign. |
| Associate | Drafting, AI drafting, clause library. |
| Paralegal | Limited drafting, templates, document assembly. |
| Legal Secretary | Document formatting, calendar, basic templates. |
| Intern / Trainee | Read-only or restricted drafting. |
| External Client (v2) | View-only access via the client portal. |
| Custom | Firm Admins can clone/extend any system role; tenant-scoped. |

Invariants:
- Every user has exactly one role.
- A tenant must always have ≥ 1 active Firm Admin (last-admin demotion blocked at the API).
- Role changes write to the tenant audit log.

### 10.4 SuperAdmin roles

| Role | Tenant impersonation | Billing edits | Compliance views |
|---|:---:|:---:|:---:|
| Founder / Owner | yes | yes | yes |
| Support engineer | yes (with reason) | — | read-only |
| Billing operations | — | yes | — |
| Compliance officer | — | — | yes + edit |
| Read-only auditor | — | — | read |

Every SuperAdmin action writes to a tamper-evident, indefinitely-retained audit log. Impersonation surfaces a persistent banner in the UI ([`apps/web/src/admin/ImpersonationBanner.tsx`](./apps/web/src/admin/ImpersonationBanner.tsx)) and is blocked from the `/api/admin/*` surface.

---

## 11. End-to-end workflows

### 11.1 Tenant provisioning

```
SuperAdmin                          Tenant
   │                                   │
   ├─ POST /admin/firms ───────────────▶
   │   { name, type, plan,             │  creates firm record + plan entitlement set
   │     billing, admin@… }            │  creates Firm Admin (status: pending_activation)
   │                                   │  emits single-use 24h activation token
   │                            ◀──────┤  activation email
   │                                   │
   │                                   ├─ Firm Admin sets password + (optional) MFA
   │                                   ├─ first-login Setup Checklist
   │                                   │   • confirm firm details
   │                                   │   • create practice groups
   │                                   │   • customise roles (where the plan allows)
   │                                   │   • invite users
   │                                   │   • review feature toggles
```

Sales-led Firm provisioning adds MSA + DPA + DPIA stages before tenant creation.

### 11.2 User onboarding (Firm Admin → invitee)

1. Firm Admin invites users (single or CSV) from `/app/members`.
2. System emits invite tokens (single-use, 24h).
3. Invitee opens link → [InviteAcceptView](./apps/web/src/views/InviteAcceptView.tsx) → sets credentials → lands on `/app/dashboard`.
4. The router (`DashboardRouter`) dispatches to `<SoloDashboardView>`, `<PracticeDashboardView>`, or `<FirmDashboardView>` based on `user.plan`.

### 11.3 Sign-in & session

1. `POST /api/auth/sign-in` → 7-day HS256 JWT (or `{ challengeId }` if MFA is required).
2. Web persists in Zustand + localStorage; axios attaches `Authorization: Bearer <jwt>`.
3. `/api/auth/me` returns the user + resolved feature set.
4. A `401` from any endpoint clears the session and bounces to `/auth`.

### 11.4 Daily advocate workflow (Solo dashboard)

```
Sign-in
  └─▶ /app/dashboard (Solo)
        ├─ §0  Masthead — greeting + alerts summary
        ├─ §I  Today's work — "Draft a new document" + drafts in progress
        ├─ §II Today's cause list — listed hearings
        ├─ §III Notices to the bench — alerts
        ├─ §IV Limitation index — statutory deadlines
        ├─ §V  Document register
        └─ §VI Stat row — Active matters · Clients · Open notices · Revenue
```

### 11.5 Practice (chambers) workflow

The Practice dashboard adds a chambers-pulse strip, a today-across-the-firm hearing list grouped by advocate, an Active Members table, and a recent-activity feed sourced from the audit log. No revenue charts or top-clients tables — those are Firm-only.

### 11.6 Firm workflow

The Firm dashboard ([FirmDashboardView.tsx](./apps/web/src/views/FirmDashboardView.tsx)) layers on KPI strip, monthly revenue chart, matters by stage, members table, practice mix, top clients, today's hearings, and notices. The full Firm sidebar (Firm overview / Members / Analytics / Settings) is visible.

### 11.7 Drafting workflow

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

### 11.8 Contract review workflow

```
Upload document (PDF / DOCX) → text-extraction.ts (pdf-parse / mammoth)
   │
   ├─▶ review.service.ts splits into clauses
   ├─▶ Claude (when configured) annotates each clause: risk, suggestion, rewrite
   ├─▶ Persisted in review tables (0026 / 0027 / 0028)
   ├─▶ ReviewQueueView shows assignments; ContractReviewView shows the clause-by-clause UI
   └─▶ Reviewer leaves comments via review-comments.service.ts
```

### 11.9 Mock arguments workflow

1. User submits the case posture in `MockArgumentsView` (party, facts, contentions, language).
2. `mock-arguments.service.ts` generates an opposing-counsel rebuttal via Claude.
3. **Polish stage** (migration 0036) refines tone and citation density.
4. **Improvements stage** (0038) reviews the raw output stored in `mock_arguments_review_raw` (0037).
5. Multi-language (0039) — supported languages enumerated in [apps/api/src/lib/languages.ts](./apps/api/src/lib/languages.ts).

### 11.10 Cause-list / hearings workflow

eCourts CNR sync (where wired) feeds [`hearings.service.ts`](./apps/api/src/services/hearings.service.ts). The dashboard pulls `GET /api/hearings/today`; the diary view pulls the broader window. Limitation calculations live in [`limitations.calculator.ts`](./apps/api/src/services/limitations.calculator.ts) and surface as the limitation index on every dashboard.

### 11.11 Research / laws-search workflow

- `ResearchView` posts a question to `/api/research?q=` — `research.service.ts` returns a canned Lex.AI answer + citations.
- `LawSidePanel` calls `/api/laws` for semantic statute lookup. The service applies a **garble filter** (recent commits) to suppress OCR-garbage chunks, distinguishes **central vs state acts**, and supports per-state filtering.

### 11.12 SuperAdmin workflows

Lifecycle, identity & impersonation, billing ops, usage & customer-health, support tooling, DPDP/compliance, and platform operations. All routes mount at `/api/admin/*` behind `requireAuth + requireSuperadmin`.

### 11.13 Client portal workflow

External clients receive a magic link → exchange for a portal JWT at `/api/portal/auth/*` → land on the stripped-down portal app under [`apps/web/src/views/portal/`](./apps/web/src/views/portal/). Portal sessions cannot reach the firm-side routes. The portal sub-app is **lazy-loaded** so it does not bloat the firm-side bundle ([CLIENT_PORTAL.md §6.5](./CLIENT_PORTAL.md)).

### 11.14 Title reports workflow

Advocate prepares a Title Investigation Report (TIR) for a bank / NBFC / buyer — the single highest-stakes drafting deliverable in property practice. The feature is wizard-driven, AI-assisted, and ends with a letterhead PDF.

```
[New title report]
        ↓
[Step 1] Property & applicant       ── jurisdiction-aware revenue-record fields
[Step 2] Chain of title             ── 30-year window, gap timeline highlights ≥ 5y gaps in amber, ≥ 7y in red
[Step 3] Documents examined         ── PDF/DOCX upload → text-extraction.ts → heuristic suggestions (accept/reject)
[Step 4] Searches                   ── SRO, revenue, municipal, litigation (HC/DC/DRT/NCLT)
[Step 5] Encumbrances & litigation  ── EC transaction rows + lis-pendens flag for direct-relevance hits
[Step 6] Defects & opinion          ── AI defects-analysis (Claude or xAI) + opinion-synthesis
[Step 7] Preview & export           ── PDF on firm letterhead via html2canvas + jsPDF
        ↓
[Transition: in_review → finalised → issued]
```

State machine (enforced by the API in [`title-reports.service.ts`](./apps/api/src/services/title-reports.service.ts), not just the UI):
- `draft → in_review` requires property + ≥ 1 chain link + ≥ 1 EC row + ≥ 1 search + a non-pending verdict.
- `in_review → finalised` requires every blocker defect acknowledged or dismissed + an opinion summary.
- `finalised → issued` requires a PDF export to have been generated.

AI runs (defects analysis + opinion synthesis) are persisted in `title_report_ai_runs` for replay and audit. Both prompts have **deterministic template fallbacks** — the feature works end-to-end without `ANTHROPIC_API_KEY` / `XAI_API_KEY` set. The template path is exercised by [`apps/api/eval/title-reports/runner.ts`](./apps/api/eval/title-reports/runner.ts) (six golden cases — clean chain, missing link, will without probate, undischarged mortgage, extent mismatch, ancestral partition).

Solo plan is capped at 2 reports per billing cycle; cap is held in `plan_title_report_caps` (migration 0050) and enforced before sequence-number allocation so a 429 doesn't burn a number.

Per-action role gating lives in the service, not in extra feature keys: Paralegals can draft but not finalise; Senior Associates can finalise but not issue; Legal Secretary / Intern cannot see the feature at all. The coarser `title_report.use` feature key gates the route, the service layer maps `req.user.role` to the action-deny matrix.

Schema: see [`apps/api/migrations/0050_title_reports.sql`](./apps/api/migrations/0050_title_reports.sql) (13 tables: header + property + chain + documents + encumbrances + searches + litigation + approvals + heirs + defects + ai_runs + exports + per-firm-year counter). Full domain primer + AI prompt excerpts + jurisdiction matrix: [TITLE_REPORTS.md](./TITLE_REPORTS.md).

---

## 12. AI / Claude integration

LexDraft talks to Claude (Anthropic) for multiple features:

| Feature | Service | Model env |
|---|---|---|
| Document drafting | `drafting.service.ts` | `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`) |
| Contract review | `review.service.ts` | Same |
| Mock arguments + polish + improvements | `mock-arguments.service.ts` | Same |
| Research answer | `research.service.ts` | Same |
| Laws semantic search | `laws-search.service.ts` + `embeddings.service.ts` | Embedding model + retrieval |

Design rules:
- **`ANTHROPIC_API_KEY` is optional.** When unset, services return deterministic templates so the UI is fully usable in dev with no key required.
- **Structured briefs** — each Claude call is composed from typed schemas in `apps/web/src/lib/doc-schemas.ts` (and mirror types in `@lexdraft/types`).
- **Per-user quotas** — AI drafts are capped per user, per firm billing cycle: Solo 20, Practice 200, Firm 1000 (migration 0045 / `plan_ai_caps`). Counts are append-only — deleting a draft tombstones the linked `ai_generations` row but never refunds quota.
- **Garble / quality filters** — `laws-search.service.ts` filters chunks that look like OCR noise before sending them to the LLM.
- **Eval harness** — `apps/api/eval/runner.ts` (script `pnpm --filter @lexdraft/api eval`) runs offline regression suites against AI features.

---

## 13. Client portal sub-app

[`apps/web/src/views/portal/`](./apps/web/src/views/portal/) — a separate, lazy-loaded SPA with its own auth.

- **Auth:** magic-link → exchange at `/api/portal/auth/*` for a **scoped portal JWT** (different audience than the firm-side JWT).
- **Surface:** `PortalLoginView`, `PortalDashboardView`, `PortalMatterDetailView`, `PortalMessagesView`, `PortalProfileView`.
- **Visibility:** which matters / documents a client sees is controlled by toggles persisted via migrations 0015 + 0014.
- **Firm-side admin:** `PortalInboxView` + `/api/portal-admin/*` give the firm an inbox to manage portal threads.
- **Isolation:** portal sessions cannot reach `/api/admin/*` or any non-`/api/portal*` route.

---

## 14. SuperAdmin control plane

[`apps/web/src/admin/`](./apps/web/src/admin/) renders inside `AdminShell` at `/admin/*`. Surface:

- `AdminDashboardView` — platform KPIs.
- `FirmsView` / `FirmDetailView` — provision, suspend, view a tenant.
- `UsersView` — cross-tenant user search.
- `AuditLogView` — tamper-evident log.
- `TemplatesView` — platform-managed templates.
- `ErrorLogView` — internal error log (`/api/admin/errors`).
- `ImpersonationBanner` — persistent banner whenever an admin is acting as a tenant user; impersonation is blocked from `/api/admin/*` itself.

---

## 15. Environment variables

### Root `.env`
```
NODE_ENV=development
```

### `apps/api/.env`
```
PORT=4000
LOG_LEVEL=debug
DATABASE_URL=postgres://lexdraft:lexdraft@localhost:5432/lexdraft
JWT_SECRET=change-me-in-production-please-32-bytes-min   # required, ≥16 chars
JWT_EXPIRES_IN=7d
CORS_ORIGINS=http://localhost:5173                        # comma-separated
ANTHROPIC_API_KEY=                                        # optional in dev
ANTHROPIC_MODEL=claude-sonnet-4-6
```

### `apps/web/.env`
```
VITE_API_URL=http://localhost:4000   # only used in production builds; dev uses Vite proxy
```

---

## 16. Local development

```bash
# 1. Install workspace deps
pnpm install

# 2. Copy env templates
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env

# 3. Bring up Postgres (or use docker-compose up db)
# 4. Run migrations
pnpm --filter @lexdraft/api db:migrate

# 5. Start both apps in parallel (web :5173, api :4000)
pnpm dev
```

Independent dev servers:

```bash
pnpm dev:web    # http://localhost:5173
pnpm dev:api    # http://localhost:4000
```

Useful per-app scripts:

| Script | What it does |
|---|---|
| `pnpm dev` | `turbo run dev --parallel` — both apps |
| `pnpm build` | Builds web (Vite) + api (tsc) |
| `pnpm typecheck` | `tsc --noEmit` across every workspace |
| `pnpm lint` | ESLint across every workspace |
| `pnpm test` | Vitest where present |
| `pnpm format` | Prettier write |
| `pnpm clean` | Removes `dist`, `.turbo`, `node_modules` |
| `pnpm --filter @lexdraft/api db:migrate` | Run migrations |
| `pnpm --filter @lexdraft/api db:reset` | Drop + re-migrate |
| `pnpm --filter @lexdraft/api db:status` | Show pending migrations |
| `pnpm --filter @lexdraft/api eval` | Run AI eval harness |
| `pnpm --filter @lexdraft/api test:integration` | Vitest with `vitest.integration.config.ts` |

---

## 17. Build & deployment

```bash
pnpm build
```

Outputs:
- `apps/web/dist/` — static SPA. Drop behind any CDN / static host.
- `apps/api/dist/` — Node bundle. Run with `node apps/api/dist/index.js`.

Reasonable deploy:
1. Build the API container with `node:20-alpine`, copy `apps/api/dist` + the workspace `node_modules`, set the env vars above, expose `PORT`.
2. Build the web app and serve from a CDN (CloudFront, Vercel static, S3+CloudFront, Netlify). Set `VITE_API_URL` at build time to the API host.
3. Either route the CDN's `/api/*` path to the API, or hard-code the API origin in `VITE_API_URL` and configure the API's `CORS_ORIGINS` accordingly.

`docker-compose.yml` / `docker-compose.prod.yml` ship reference local + production-shaped stacks (db + api + web). Health probes:

- `GET /api/health` — cheap liveness, no DB.
- `GET /api/ready` — readiness, pings DB. Returns 503 if dependencies are down.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the full production runbook.

---

## 18. Observability & operations

- **Logging:** `pino` structured JSON; `pino-pretty` in dev. Every error path attaches a `requestId`.
- **Error log:** `error-log.service.ts` records persistent errors; `/api/admin/errors` exposes a SuperAdmin viewer.
- **Audit log:** `audit.service.ts` writes tamper-evident events for tenant + platform actions. Indefinite retention.
- **Background jobs:** `pg-boss` queue via `jobs.service.ts`. Workers handle analytics refresh, embedding generation, reminders.
- **Cache invalidation:** `cache-broadcaster.ts` fans out invalidations across processes.
- **Rate limiting:** `express-rate-limit` with per-route tuning (`signUpLimiter`, `surveyDraftLimiter`).
- **Health probes:** `/api/health` (liveness), `/api/ready` (readiness with DB ping).

---

## 19. Security model

- **JWT (HS256)** with configurable secret + expiry. Bearer-only; no cookies.
- **Password hashing:** bcryptjs with sensible cost.
- **MFA:** TOTP via `otplib`, QR via `qrcode`. Recovery codes per user.
- **Tenant isolation:** every protected query filtered by `firm_id`; no cross-tenant reads in v1.
- **Plan gate:** `requireActivePlan` returns 402 when a firm's subscription has lapsed (excluding `/me*`).
- **Hardening:** `helmet`, strict `cors` allowlist, `compression`, `morgan`, rate-limits, Zod input validation on every route.
- **Webhook verification:** per-provider HMAC via `webhooks.verify.ts`.
- **DPDP:** export + erasure + consent ledger via `dpdp.service.ts` and `/api/me/dpdp`.
- **Impersonation:** allowed only off `/api/admin/*` (impersonation sessions are blocked there); persistent UI banner; reason captured and audited.
- **Audit log:** tamper-evident, indefinitely retained, queryable in `AuditLogView`.

See [PRIVACY_POLICY.md](./PRIVACY_POLICY.md), [TERMS_OF_SERVICE.md](./TERMS_OF_SERVICE.md), and [DATA_PROCESSING_AGREEMENT.md](./DATA_PROCESSING_AGREEMENT.md) for the user-facing legal posture.

---

## 20. Project status & roadmap

Already shipped:
- Monorepo, shared packages, shared TS types.
- Express API with JWT auth, MFA, DPDP, three-layer feature gate, tenant scoping, plan gating, audit log, error log, rate-limit, helmet, CORS, structured logging, Zod validation.
- Postgres persistence with 39 numbered migrations; pg-boss job queue; vector embeddings for laws/research.
- Vite + React SPA shell, plan-aware routing (`DashboardRouter`), theme + density + language preferences, command palette (⌘K), notifications panel, mobile nav, toast system.
- Design tokens & global CSS aligned 1:1 with `design-system.md`.
- Views: Landing, Auth, three Dashboards (Solo / Practice / Firm), Cases (list + detail with notes), Drafting, Contract Review + Review Queue, Mock Arguments, Tasks, Documents, Research, Sanhita, Calculators, Coverage, Practice Analytics, Engagement Templates, Clients, Leads, Clauses, Invoices, Expenses, Limitation, Diary, Calendar, Cause List, eCourts, Stamp, Archive, Physical Docs, Members, Analytics, Portal Inbox, Settings.
- Client Portal sub-app (lazy-loaded) — Login / Dashboard / Matter Detail / Messages / Profile.
- SuperAdmin sub-app — Dashboard / Firms / Users / Audit / Templates / Error log; impersonation banner.

Roadmap pointers:
- Continued AI eval growth — see [LEXDRAFT_ROADMAP.md](./LEXDRAFT_ROADMAP.md).
- External Client role v2 (broader portal capabilities).
- Deeper eCourts integration (currently a webhook seam).
- Additional payment-processor + e-sign webhook adapters.

---

## Reference points

- **Plans, pricing, gating:** [LexDraft_Pricing_and_Tiers.docx](./LexDraft_Pricing_and_Tiers.docx)
- **Per-plan dashboard model:** [WORKFLOW_DASHBOARDS.md](./WORKFLOW_DASHBOARDS.md)
- **RBAC + tenant onboarding spec:** [lexdraft-user-management-spec.md](./lexdraft-user-management-spec.md)
- **Design tokens & components:** [design-system.md](./design-system.md)
- **API contract source of truth:** [packages/types/src/index.ts](./packages/types/src/index.ts)
- **Backend route map:** [apps/api/src/routes/index.ts](./apps/api/src/routes/index.ts)
- **Client portal spec:** [CLIENT_PORTAL.md](./CLIENT_PORTAL.md)
- **Deployment runbook:** [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Onboarding:** [ONBOARDING.md](./ONBOARDING.md)
- **Feature inventory:** [LEXDRAFT_FEATURES_ANALYSIS.md](./LEXDRAFT_FEATURES_ANALYSIS.md)
- **Integration notes:** [LEXDRAFT_INTEGRATION.md](./LEXDRAFT_INTEGRATION.md)
