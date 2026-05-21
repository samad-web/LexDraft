# LexDraft — Per-plan dashboard workflow

**Status:** Draft v1 · 2026-05-06
**Pairs with:** [PRICING_AND_TIERS.md](PRICING_AND_TIERS.md)
**Scope:** How a Solo / Practice / Firm user lands, what they see, and how the app decides what to render. Defines the plan-aware routing model and the information architecture for the Solo and Practice dashboards (Firm dashboard already exists in [FirmDashboardView.tsx](apps/web/src/views/FirmDashboardView.tsx)).

---

## 1. Audit of what already exists

| Layer | Today | Gap |
|---|---|---|
| **Types** ([packages/types/src/index.ts](packages/types/src/index.ts)) | `FirmPlanTier = 'Solo' \| 'Practice' \| 'Firm'` lives in admin-only types. `User` has `role`, `firm`, `isSuperadmin`. | `User` has no `plan` field — the client can't render plan-aware UI. |
| **API auth** ([apps/api/src/services/auth.service.ts](apps/api/src/services/auth.service.ts)) | Joins `users` to `firms` to get `firm_name`. | Doesn't read or expose `firms.plan_tier`. |
| **Database** | `firms.plan_tier` exists (used in [me.routes.ts](apps/api/src/routes/me.routes.ts) for AI-draft quota). | Not propagated to the auth response. |
| **Routes** ([apps/web/src/App.tsx](apps/web/src/App.tsx)) | `/app/dashboard` → `<DashboardView>` for everyone. `/app/firm` → `<FirmDashboardView>` only when navigated to. | No plan-based dispatch. |
| **Sidebar** ([apps/web/src/components/shell/nav-config.ts](apps/web/src/components/shell/nav-config.ts)) | Always shows the "Firm" group (Firm overview / Members / Analytics / Settings). | Solo users see firm-only items. |
| **Dashboards** | `DashboardView` (Solo-shaped: Today / Matters / Register / Practice), `FirmDashboardView` (Firm-shaped: KPIs / revenue / members / practice mix / top clients). | No Practice dashboard. |

**Bottom line:** the building blocks are there; we need plan plumbing and one new view.

---

## 2. Workflow principles

1. **Plan determines surface area, role determines actions.** Plan = which sidebar groups + which dashboard shape; role = whether you can invite, bill, see firm-wide data within that surface.
2. **One URL per intent.** `/app/dashboard` always lands the user on the right surface for their plan — they never type a different URL or pick from a menu.
3. **No accidental disclosure.** A Solo user can't see Members or Analytics in the nav; an attempt to deep-link is redirected to `/app/dashboard`.
4. **Upgrade is a nudge, not a wall.** Solo dashboards mention Practice features inline ("Add a co-advocate? Practice unlocks shared matters") rather than blocking interactions.
5. **One source of truth for plan.** `user.plan` on the auth payload. The sidebar, dashboards, and feature gates all read it.

---

## 3. Per-plan workflow

### 3.1 Solo

**Buyer:** independent advocate. Single seat. Self-serve trial.

**Landing flow:**
1. Sign in → `/app/dashboard` → `<SoloDashboardView>`.
2. Sidebar groups visible: Overview, Matters, Workspace, Practice, Research, Tools, Settings (no "Firm" group).
3. Plan badge in sidebar reads "SOLO · TRIAL" or "SOLO".

**Dashboard sections** (top-to-bottom, the existing `DashboardView` shape):
- §0 Masthead — greeting + hearing/alert summary.
- §I Today's work — primary CTA: "Draft a new document" + drafts in progress.
- §II Today's cause list — listed hearings (next-hearing card highlighted).
- §III Notices to the bench — alerts.
- §IV Limitation index — statutory deadlines.
- §V Document register — recent docs.
- §VI Stat row — Active matters · Clients · Open notices · Revenue.

**Solo-specific elements:**
- Usage strip in sidebar (`20 AI drafts/mo` quota — already implemented).
- "Add a co-advocate" upgrade nudge below stat row when seats are saturated.

### 3.2 Practice

**Buyer:** founding partner of a 2–8 advocate chamber. Self-serve, card on file.

**Landing flow:**
1. Sign in → `/app/dashboard` → `<PracticeDashboardView>`.
2. Sidebar groups: Overview, Matters, Workspace, Practice, Research, Tools, **Firm** (limited — Members + Settings only, no Analytics), and a "Chambers" entry-point.
3. Plan badge reads "PRACTICE · 4 / 8 SEATS" — clicking opens Members.

**Dashboard sections** (new view):
- §0 Masthead — greeting, today's date, "X hearings across chambers · Y drafts in flight".
- §I My day — personal hearings + my drafts in progress + my limitation alerts (compressed Solo "Today" block).
- §II Chambers pulse — small KPI strip: matters in progress · hearings today · seats used · AI drafts this month.
- §III Today across the firm — list of every hearing scheduled today, grouped by advocate.
- §IV Active members — light table: name, role, active matters, status (no win-rate, no billing — those are Firm-tier).
- §V Recent activity — last 10 firm events (matter opened, draft generated, invoice issued, member joined). Builds on the audit log.
- §VI Document register — firm-wide recent docs (already in `/dashboard`).
- §VII Quick actions — "Draft", "Open matter", "Invite member" buttons.

**Practice-specific elements:**
- Plan-tier badge with seats remaining.
- "9th seat? Move to Firm" nudge when seats == 8.
- No revenue chart, no top-clients table, no advocate-level performance — those are Firm-only differentiators.

### 3.3 Firm

**Buyer:** managing partner of a 9+ seat firm. Sales-led, MSA + DPIA, annual contract.

**Landing flow:**
1. Sign in → `/app/dashboard` → `<FirmDashboardView>` (existing).
2. Sidebar groups: all of the above + full "Firm" group (Firm overview, Members, Analytics, Settings).
3. Plan badge reads "FIRM · ENTERPRISE".

**Dashboard sections** (already implemented — kept as-is):
- KPI strip · Monthly revenue chart · Matters by stage · Members table · Practice mix · Top clients · Today's hearings · Notices.

---

## 4. Routing model

```
/app
├── /dashboard          → <DashboardRouter />
│                          plan === 'Solo'     → <SoloDashboardView />
│                          plan === 'Practice' → <PracticeDashboardView />
│                          plan === 'Firm'     → <FirmDashboardView />
│                          plan === undefined  → <SoloDashboardView /> (safe default)
│
├── /firm               → <FirmDashboardView /> (kept for Firm direct-link;
│                          Practice users can still visit but see a soft notice
│                          that their plan shows the lighter chambers view)
├── /members            → gated: Practice + Firm only
├── /analytics          → gated: Firm only
└── ... (rest unchanged)
```

Deep-link redirects:
- Solo navigating to `/app/firm`, `/app/members`, `/app/analytics` → redirected to `/app/dashboard`.
- Practice navigating to `/app/analytics` → redirected to `/app/dashboard`.

---

## 5. Plan plumbing — implementation plan

The work breaks into five small, sequential steps:

1. **Types** — extend `User` with `plan?: FirmPlanTier` (move `FirmPlanTier` above `User` declaration).
2. **API auth** — `auth.service` joins `firms.plan_tier`, populates `User.plan`. JWT does not need to carry plan (it's looked up fresh on each `/me` call).
3. **Frontend dispatcher** — replace `<DashboardView>` route with `<DashboardRouter>` that reads `user.plan` and renders the correct view.
4. **Two dashboards** —
   - `SoloDashboardView`: lift the existing `DashboardView` body verbatim (no behavioural change for current users).
   - `PracticeDashboardView`: new view, fetches both `/dashboard` and `/firm/dashboard`, renders the seven sections above.
5. **Sidebar polish** — add a plan badge under the avatar block; gate the "Firm" group items by plan.

Sidebar-level gating across every nav item, deep-link redirects, and a dedicated `/practice/dashboard` API are tracked as **follow-ups** (see §7) — not in this milestone.

---

## 6. Data flow per dashboard

| View | Endpoints | Notes |
|---|---|---|
| `SoloDashboardView` | `GET /dashboard` (existing) | No change. |
| `PracticeDashboardView` | `GET /dashboard` (personal) + `GET /firm/dashboard` (chambers) | Fetched in parallel via React Query. Practice view filters/condenses the firm payload (no revenue chart, no top clients, no win rates). |
| `FirmDashboardView` | `GET /firm/dashboard` (existing) | No change. |

Why reuse `/firm/dashboard` for Practice instead of a new endpoint? It returns exactly the right primitives (members, hearings today, alerts) for a chamber-sized firm and is already production-ready. We discard the analytics-heavy fields client-side. A dedicated `/practice/dashboard` is a future optimization once we have data on what Practice users actually look at.

---

## 7. Out of scope for this milestone (follow-ups)

- Plan-aware sidebar rendering for **every** group/item (this milestone does the Firm group only).
- Server-side route guards in API for plan-gated endpoints (today the gates are role + tenant, not plan).
- Upgrade-flow plumbing (Razorpay session creation when a Solo user clicks "Upgrade").
- Dedicated `/practice/dashboard` API endpoint (use `/dashboard` + `/firm/dashboard` for now).
- Custom roles, white-label portal, SSO — Firm-only, deferred to Phase 2 per [PRICING_AND_TIERS.md §9](PRICING_AND_TIERS.md).
- Plan badge in topbar (sidebar only for now).

---

## 8. Acceptance — when this milestone is done

- A Solo user lands at `/app/dashboard` and sees the Solo view. The sidebar plan badge reads `SOLO`.
- A Practice user lands at `/app/dashboard` and sees the new chambers view with my-day + team pulse + member roster.
- A Firm user lands at `/app/dashboard` and continues to see `<FirmDashboardView>`.
- `pnpm typecheck` passes for both `apps/api` and `apps/web`.
- No existing test fails; one new visual smoke check (manual) confirms Solo & Practice render with empty state and with seeded data.
