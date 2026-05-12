# CLIENT_PORTAL — Features & Workflows

**Purpose:** Specification of the LexDraft Client Portal sub-app — what it does, how clients move through it, and what the firm-side and platform must do to support it. Pairs with [OVERVIEW.md](./OVERVIEW.md) §4.10, [WORKFLOW_DASHBOARDS.md](./WORKFLOW_DASHBOARDS.md), [lexdraft-user-management-spec.md](./lexdraft-user-management-spec.md), and the implementation README at [`apps/web/src/views/portal/README.md`](./apps/web/src/views/portal/README.md).

This document is the source of truth for *what* must work. The implementation README is the source of truth for *how it's wired*.

---

## 1. Purpose

The Client Portal is a stripped-down, read-mostly sub-application for an advocate's external clients (individuals, SME signatories, in-house counsel at corporate clients). It is **not** a second login surface for firm staff; it is a separate trust boundary with its own auth, its own data scope, and its own UI.

The portal exists to:

- Cut the email back-and-forth that currently dominates advocate–client communication around case status, hearing dates, and document handover.
- Give the firm an auditable record of when a client was shown a document, when they acknowledged it, and when they paid an invoice.
- Provide a credible "self-service" surface that Practice and Firm-tier customers can market to their own clients as a differentiator.

Out of scope for the portal: drafting, contract review, research, billing entry, anything multi-tenant. Those remain firm-side concerns.

---

## 2. Scope

### 2.1 In scope (v1)

- Magic-link authentication scoped to `/api/portal/*`.
- A dashboard summarising the client's matters, hearings, documents, invoices, and unread messages.
- Per-matter detail view with shared documents and the matter's hearing history.
- Document download via signed URLs and an "acknowledge receipt" / lightweight signature step.
- Invoice list with status, balance, and a redirect to a hosted payment checkout.
- Bidirectional messaging between client and the firm's matter team.
- Profile screen (name, contact email, language preference).
- Email and in-app notifications for the events listed in §6.4.
- Audit-log entries for every server-state mutation initiated by a portal session.

### 2.2 Out of scope (deferred)

| Item | Deferred to | Rationale |
|---|---|---|
| Native e-sign with cryptographic signatures | v2 | Acknowledge-receipt is sufficient for the matters portal v1 covers; full e-sign needs a vendor integration and tighter MFA. |
| WebSocket / push messaging | v2 | Polling at 60s is fine for the access patterns we expect (a few messages per matter per week). |
| Multiple clients on one matter (joint clients) | v2 | Single-client-per-matter assumption simplifies access control until we see the demand. |
| In-portal payments without redirect | v2 | Hosted checkout shifts PCI scope to the PSP; reduces audit burden for v1. |
| File uploads from the client side | v2 | One-way doc sharing for v1; v2 adds client-uploaded evidence/ID capture. |
| Mobile native apps | post-v2 | The web app must be mobile-responsive; native apps are a separate roadmap item. |
| Full i18n into Hindi / regional languages | v2 | English-only for v1, but all user-facing strings must be in a single locale module so v2 is a translation pass, not a refactor. |

---

## 3. Roles & personas

### 3.1 Portal-side actors

| Actor | Description | Scope |
|---|---|---|
| **External Client (primary)** | The named client on a matter — usually an individual, sometimes a designated representative of a corporate client. | Read-mostly access to *only* their own matters. Cannot see other clients of the same firm. |
| **Client Representative (v2)** | A delegated user authorised by the primary client (e.g. a relative for an elderly client, a CFO for a corporate client). | Same scope as the primary client; managed via firm-side invitations. |

### 3.2 Firm-side actors who interact with portal data

The portal is consumed by clients but produced by the firm. The firm-side roles below all need affordances on their dashboards:

- **Firm Admin / Practice Group Lead:** Can enable the portal for a client, revoke access, and audit portal activity.
- **Partner / Senior Associate:** Can share a document to the portal, send a portal message, mark a portal message as read on the firm side.
- **Associate / Paralegal:** Same write capabilities as Partner for matters they're assigned to, gated by the existing role policy.
- **Legal Secretary:** May share documents on a Partner's behalf (already possible in firm-side document register; the portal flag is just an extra checkbox).

The portal does not surface *who on the firm side* shared a document or sent a message beyond their display name and role label ("Advocate"). Internal hierarchy is invisible to the client.

---

## 4. Feature catalog

For each feature: what it does, the data it shows, the actions it allows, and how it gates on `client.capabilities.*`.

### 4.1 Authentication

- **Entry:** A magic link emitted by the firm-side "Invite to portal" action or an automated re-send trigger.
- **Exchange:** `POST /api/portal/auth/exchange` swaps the single-use magic-link token for a portal session JWT.
- **Session:** 24-hour JWT (HS256). No refresh token in v1 — when the JWT expires, the client lands on the magic-link prompt and either uses a fresher email link or asks the firm for a new one.
- **Sign-out:** Best-effort server revocation, authoritative client-side clear.
- **Capabilities:** Resolved server-side per `client.capabilities` and surfaced in `auth/me`. The UI honours these; the API enforces them.

### 4.2 Dashboard overview

The first screen after sign-in. Mirrors the Solo dashboard structure (OVERVIEW §4.4) but limited to a client's view:

| Section | Content |
|---|---|
| Masthead | Time-of-day greeting, client name, firm name, outstanding balance pill. |
| Counts strip | Active matters · Upcoming hearings · Documents to sign · Open invoices · Unread messages. |
| Your matters | Top 5 active matters with status, case number, court, and either next hearing or "updated N days ago". |
| Upcoming hearings | Next hearings across all matters, chronological, court + courtroom + purpose. |
| Recent documents | Last 5 documents shared, with download and signature CTA where required. |
| Invoices | Top 4 unpaid invoices first (overdue → due → partial), then most recent paid. |
| Messages | Last 5 messages, oldest unread highlighted, quick-reply composer. |

Counts must be served by a single aggregated endpoint (`GET /api/portal/dashboard`) so first paint is one round trip, not six.

### 4.3 Matters

- **List view:** Every matter the client is on the access list for.
- **Detail view:** Title, case number, court, practice area, primary advocate, current status, all hearings (past + future), all documents shared on this matter, all messages on this matter.
- **No editing:** Clients cannot rename, close, or change matter metadata. They can only read and message.
- **Closed matters:** Visible for 6 months after closure, then archived. After archive they require a firm-side action to re-share.

### 4.4 Hearings

- Read-only, sourced from the firm-side `hearings.service.ts`.
- Statuses surfaced: `scheduled`, `completed`, `adjourned`, `cancelled`. Adjourned and cancelled show a reason if the firm has set one.
- The portal does not let clients add events to their own calendar in v1 (no `.ics` export). v2.

### 4.5 Documents

- **Discovery:** A document appears in the portal only after a firm-side user explicitly toggles "Share with client" on the document register. This is opt-in per document, not opt-in per matter.
- **Categories:** `pleading`, `order`, `contract`, `evidence`, `correspondence`, `other`. Used for filtering and grouping in the matter detail view.
- **Download:** Signed object-storage URLs valid for 5 minutes. The SPA never proxies bytes.
- **Acknowledge receipt:** When a firm-side user marks a document as `requires_acknowledgement`, the client sees an "Acknowledge" button. Clicking it records `signedAt` and writes an audit-log entry. The acknowledgement is a lightweight "I have seen this", not a cryptographic signature.
- **Re-shares:** If a firm-side user replaces a shared document with a new version, the client sees the new file in the same slot with a "Updated DD MMM" badge. The previous version remains accessible via the document's history sub-page.

### 4.6 Invoices

- **Statuses surfaced:** `sent`, `partial`, `paid`, `overdue`, `cancelled`. Drafts are never visible to the client.
- **Sort order:** overdue → sent → partial → draft → paid → cancelled, then by due date ascending within each.
- **Currency:** INR only in v1. Amounts stored as paise (integer minor units) to avoid float drift; formatted with `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.
- **Payment:** `POST /api/portal/invoices/:id/pay` returns a `checkoutUrl` from the firm's PSP (Razorpay assumed; the contract is PSP-agnostic). The SPA redirects the browser to that URL. On return, the PSP webhook updates the invoice; the client refreshes and sees the new status.
- **Receipts:** When status flips to `paid`, the firm emits a receipt email and exposes a download link on the invoice row.

### 4.7 Messages

- Threaded by matter (each matter has one thread) plus a "general" thread for non-matter-specific communication.
- **Send:** Plain text only in v1, 4000 character cap, no Markdown rendering. Attachments are deferred to v2.
- **Read state:** A message is marked read on the client side when it scrolls into view (`onMouseEnter` is a stand-in; replace with an IntersectionObserver in v1.1).
- **Read state on the firm side:** When a firm-side user opens the matter's messages tab, all unread client messages on that matter are marked read.
- **Notifications:** New messages emit an email to the recipient (firm-side advocate or client) unless the recipient has a portal session active and is currently viewing the thread.
- **Retention:** Messages persist for the life of the matter and follow the matter into archive.

### 4.8 Profile

A minimal screen at `/portal/profile`:

- Name (read-only — changing it requires firm-side action).
- Contact email (read-only — changing it requires firm-side action because it's the magic-link address).
- Language preference (free in v1: English; v2 enables regional choices).
- Notification preferences (per-event: new document, hearing reminder, new message, invoice issued, invoice overdue).
- "Forget me" link → opens a firm-side request flow (DPDP §7).

---

## 5. End-to-end workflows

### 5.1 First-time access (firm provisions client → client signs in)

```
Firm Admin / Partner            API                            Client
    │                            │                                │
    ├─ Toggle "Enable portal" ──▶│                                │
    │  on a Client record        │ creates portal_user record     │
    │                            │ status=pending_activation      │
    │                            │                                │
    │                            ├─ emit magic link (24 h, single │
    │                            │   use, signed) ──── email ────▶│
    │                            │                                │
    │                            │                                ├─ click link
    │                            │                                │
    │                            │◀── GET /portal/auth?token=… ───┤
    │                            │                                │
    │                            ├── POST /portal/auth/exchange ──▶│ (SPA)
    │                            │   {token}                       │
    │                            │                                │
    │                            ├── 200 { jwt, client, expires } ▶│
    │                            │                                ├─ redirect /portal/dashboard
    │                            │                                │
    │                            │   audit: portal_first_login    │
    │◀── notify (in-app) ────────┤   audit: client_activated      │
```

**Failure modes:**
- Token expired → friendly "Ask your advocate to send a new link" page.
- Token invalid (replayed, mangled) → same page with a different `reason` flag.
- Token correct but client record disabled → 403, generic error (do not leak that the client exists).

### 5.2 Returning client session

```
Client opens /portal               SPA                            API
    │                              │                              │
    ├─ navigates to /portal/anything ──▶│
    │                              │
    │                              ├─ store has unexpired JWT?
    │                              │     yes → render guarded route
    │                              │     no  → redirect /portal/auth?reason=…&next=…
    │                              │
    │                              ├── any data fetch with bearer ───▶│
    │                              │                                  │ verify
    │                              │                                  │   ok → 200
    │                              │                                  │   bad → 401
    │                              │◀────────────────────────────────┤
    │                              │
    │                              ├─ on 401: clear store,
    │                              │   redirect /portal/auth
```

The guard runs in two places — the route element (`PortalLayout`) checks at navigation time, and the response interceptor handles inline expirations during a session. Either path lands on the same magic-link prompt.

### 5.3 Reviewing a matter

```
Dashboard → click matter row
   │
   └─▶ /portal/matters/:id
         │
         ├─ load matter (cached if recently fetched)
         ├─ load documents for matter
         ├─ load messages for matter
         ├─ load hearings for matter (subset of upcoming + history)
         │
         ├─ user clicks document → signed URL → open in new tab
         ├─ user replies in thread → POST /messages → optimistic add → invalidate
```

Cache invalidation discipline: the matter detail loads four queries; only the most recently mutated one is refetched on a mutation. Don't blow the whole `portal` tree.

### 5.4 Acknowledging a document

```
Client                                SPA                            API
  │                                    │                              │
  ├─ sees "Signature needed" pill      │                              │
  ├─ clicks Acknowledge ───────────────▶│                              │
  │                                    ├── POST /documents/:id/sign ─▶│
  │                                    │                              ├─ verify capability
  │                                    │                              ├─ verify status==pending
  │                                    │                              ├─ write signedAt
  │                                    │                              ├─ audit: doc_acknowledged
  │                                    │                              ├─ notify firm-side
  │                                    │◀── 200 { signedAt, ... } ────┤
  │                                    │                              │
  │                                    ├─ invalidate documents query │
  │                                    │  invalidate dashboard query │
  │◀── pill disappears, "Acknowledged"─┤                              │
  │    note appears                    │                              │
```

The "acknowledge receipt" semantics for v1 are deliberately weaker than e-signature: it records *that* the client viewed and confirmed, not *the contents* via a hash. v2 layers on a real e-sign provider for documents that need it.

### 5.5 Paying an invoice

```
Client                          SPA                       API                    PSP
  │                              │                         │                      │
  ├─ click Pay on invoice ───────▶│                         │                      │
  │                              ├── POST /invoices/:id/pay ▶│                      │
  │                              │                         ├─ create order ──────▶│
  │                              │                         │◀── checkoutUrl ──────┤
  │                              │◀── { checkoutUrl } ─────┤                      │
  │                              │                         │                      │
  │◀── window.location = url ────┤                         │                      │
  │                              ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶ (PSP UI)
  │                                                         │                      │
  │   pays at PSP                                           │                      │
  │                                                         │◀── webhook ──────────┤
  │                                                         │   /api/webhooks/payment
  │                                                         │
  │                                                         ├─ verify signature
  │                                                         ├─ update invoice
  │                                                         ├─ audit: invoice_paid
  │                                                         ├─ notify firm + client
  │                                                         │
  │   PSP redirects back to /portal/invoices                │
  │   query refetch shows new status                        │
```

The webhook is the source of truth for payment status. The redirect-back is decorative — never trust the redirect query string for payment confirmation.

### 5.6 Messaging the advocate

```
Client                  SPA                          API                      Firm-side
  │                      │                             │                         │
  ├─ types message       │                             │                         │
  ├─ click Send ─────────▶│                             │                         │
  │                      ├── POST /messages ──────────▶│                         │
  │                      │                             ├─ persist                │
  │                      │                             ├─ audit: portal_msg_sent │
  │                      │                             ├─ notify firm advocate ──▶│ email + in-app
  │                      │◀─── 200 { id, sentAt } ─────┤                         │
  │                      ├─ invalidate messages query  │                         │
  │                      ├─ invalidate dashboard query │                         │
  │◀── message appears ──┤                             │                         │
  │    in thread, marked │                             │                         │
  │    "You", just now   │                             │                         │
```

When the firm-side user replies, the same flow inverts: their message lands in the matter thread, an email goes to the client, the dashboard count goes up.

### 5.7 Session expiry mid-session

```
Client uses the portal                  SPA                              API
   │                                     │                                │
   ├─ JWT expires while reading dashboard │                                │
   │                                     │                                │
   ├─ clicks "Pay" on an invoice ────────▶│                                │
   │                                     ├─ getActiveToken() returns null │
   │                                     │  (skew window says expired)    │
   │                                     │                                │
   │                                     ├── request fires WITHOUT bearer ▶│
   │                                     │◀── 401 invalid_token ──────────┤
   │                                     │
   │                                     ├─ unauthorized handler:
   │                                     │    clearSession()
   │                                     │    navigate /portal/auth?reason=expired&next=/portal/invoices
   │                                     │
   │◀── magic-link prompt with context ──┤
   │   "Your session has expired."       │
```

Background watchdog: `PortalLayout` runs a 60-second interval that checks `isExpired()` and bounces the user even when no request is in flight, so a client who left the tab open for 24 hours doesn't get a confusing 401 the next time they click something.

---

## 6. Cross-cutting requirements

### 6.1 Security & data isolation

| Requirement | Implementation |
|---|---|
| Portal JWT cannot reach `/api/*` outside `/api/portal/*` | Separate Axios instance + separate base URL + separate interceptors. Cross-pollination requires importing the wrong client, which is loud at code review. |
| Tenant isolation | Every portal endpoint filters by the JWT's `firmId` and `clientId`. No query parameter ever overrides those. |
| Portal sessions can never reach firm-side routes | Two distinct middlewares (`requireAuth` for firm, `requirePortalAuth` for portal) that issue and verify mutually-exclusive token audiences. |
| Magic links single-use | Token table tracks `consumed_at`; a second exchange returns 410 Gone. |
| Magic links short-lived | 24 hour expiry, irrespective of when first opened. Refresh-via-email is intentional friction. |
| Replay protection on the SPA | `?token=…` stripped from URL via `navigate(replace)` immediately after exchange; React Strict Mode guarded with `useRef`. |
| Token storage hardening | localStorage in v1 (matches firm-side per OVERVIEW §2.2). CSP + no third-party scripts on the portal host. v2: in-memory store + refresh cookie if threat model demands. |
| File access | Signed URLs only, 5-minute TTL, never the byte stream through the SPA. |
| Capability enforcement | Client `capabilities.*` is for UX. Server enforces independently. |
| MFA | Out of scope for v1. v2 layer: OTP step-up for invoice payment and document acknowledgement on Firm-tier customers. |

### 6.2 Audit logging

Every portal action that mutates state or accesses a sensitive resource writes a row to the same audit table the firm-side uses, with an `actor_kind = 'portal_client'` discriminator. Minimum fields: `firmId`, `clientId`, `matterId?`, `action`, `resourceId`, `requestId`, `ip`, `userAgent`, `createdAt`.

Audited actions, non-exhaustive:

- `portal.session.created` (magic-link exchange)
- `portal.session.signed_out`
- `portal.session.expired_logout`
- `portal.dashboard.viewed`
- `portal.matter.viewed`
- `portal.document.viewed` (signed URL issued)
- `portal.document.acknowledged`
- `portal.message.sent`
- `portal.message.read`
- `portal.invoice.payment_started`
- `portal.invoice.payment_completed` (from webhook, not from client)

### 6.3 Accessibility

- All interactive elements reachable by keyboard, with visible focus rings using the design-token outline colour.
- Every section heading has a stable `id` so screen readers can navigate; the dashboard uses `aria-labelledby` on each `<section>`.
- Status pills (matter status, invoice status) carry text labels — colour is decorative.
- Live regions announce: a sent message, a successful acknowledgement, a payment redirect.
- Target WCAG 2.1 AA; document any deviations.

### 6.4 Notifications

Email triggers (transactional, single-recipient):

| Event | Recipient | Subject (English) |
|---|---|---|
| Portal access enabled | Client | Your portal is ready — sign in |
| Magic link re-sent | Client | Your new sign-in link |
| Document shared | Client | A new document is ready in your portal |
| Document requires acknowledgement | Client | Action needed: please review a document |
| Hearing scheduled / rescheduled | Client | Your hearing has been scheduled |
| Hearing within 48 h | Client | Reminder: hearing on {date} |
| New message from advocate | Client | New message from {advocate} |
| Invoice issued | Client | Invoice {number} from {firm} |
| Invoice overdue | Client | Reminder: invoice {number} is overdue |
| Payment received | Client | Receipt for invoice {number} |
| New message from client | Firm advocate | {client} sent you a message on {matter} |
| Document acknowledged | Firm advocate | {client} acknowledged {document} |

Each notification respects the recipient's per-event preference (§4.8). System messages (security: sign-in from new device, magic link re-sent) ignore preferences.

### 6.5 Performance budgets

- **First Contentful Paint** on dashboard: < 2.5 s on a 4G connection from Mumbai or Delhi (per assumed user base).
- **Time to interactive** on dashboard: < 3.5 s under the same conditions.
- **Dashboard payload:** one request, < 100 KB JSON for a typical client (≤ 10 matters).
- **Bundle:** the portal sub-app must code-split from the firm-side bundle. A client who never visits `/app/*` should not download the firm-side code.

### 6.6 Internationalisation

- v1 English-only, but every string lives in a single locale module with stable keys.
- Date and currency rendering uses `Intl.*` with `'en-IN'` locale.
- Right-to-left support not required (no current target language is RTL).

### 6.7 Browser & device support

- Latest two versions of Chrome, Edge, Safari, Firefox.
- Mobile Safari iOS 15+, Chrome on Android 9+ (covers the long tail of devices in India).
- The dashboard, all panels, and all workflows must be usable on a 360-px-wide viewport. The Solo and Firm dashboards on firm-side may target wider viewports; the portal does not.

---

## 7. Integration points with the rest of LexDraft

### 7.1 Firm-side affordances that produce portal data

The portal is empty unless firm-side users actively share. The firm-side surfaces the portal expects:

| Firm-side surface | What it must add |
|---|---|
| Client record (`/app/clients/:id`) | "Enable portal" toggle, "Resend magic link" button, "Revoke access" button, recent activity list scoped to that client. |
| Matter detail (`/app/cases/:id`) | "Visible to client" toggle on the matter (default off in v1). |
| Document register (`/app/documents`) | Per-document "Share with client" toggle, "Requires acknowledgement" toggle, version-history visibility. |
| Invoices (`/app/invoices/:id`) | "Visible to client" — true once status moves out of draft. |
| Messages (new in-firm view) | A "Portal messages" inbox grouped by matter, surfacing unread client messages across all of an advocate's matters. |

### 7.2 SuperAdmin views

SuperAdmin (per [PRICING_AND_TIERS.md](./PRICING_AND_TIERS.md) §4) needs read-only views of:

- Number of portal users active in the last 30 days, per tenant.
- Magic-link issuance and exchange success rates.
- Failed-exchange rates (a spike suggests an enumeration attempt).
- Storage used by portal-shared documents per tenant, for billing reconciliation.

### 7.3 Webhooks

| Webhook | Source | Effect on portal |
|---|---|---|
| `payment.captured` | PSP (Razorpay or equivalent) | Updates invoice status; emits client + firm notifications. |
| `esign.completed` (v2) | E-sign provider | Replaces "acknowledge" semantics with cryptographic-signature record. |
| `ecourts.hearing_updated` | eCourts CNR sync | If matter is portal-visible, surfaces in upcoming hearings; emits notification. |

### 7.4 Plan / pricing gating

The portal is **not** baseline. Per [PRICING_AND_TIERS.md](./PRICING_AND_TIERS.md):

- **Solo:** portal not included in v1. v2 may ship a single-client portal as a paid add-on.
- **Practice:** included, capped at 50 active portal users per tenant.
- **Firm:** included, no cap.

The `firm.plan_tier` resolution that gates the firm-side "Enable portal" toggle must be enforced server-side in addition to UI-side; never trust the SPA to gate revenue.

---

## 8. Phasing

### 8.1 v1 — must

Everything in §2.1.

### 8.2 v1.1 — should (within ~6 weeks of v1)

- IntersectionObserver for message read state (replaces the `onMouseEnter` stand-in).
- Document version history sub-page on matter detail.
- "Resend magic link" rate-limited to once every 5 minutes per client.
- Per-event notification preferences UI (the back-end already supports them; v1 ships defaults only).

### 8.3 v2 — should (next quarter)

- Real e-sign integration via the existing webhook surface.
- Client-side file uploads (evidence, ID copies).
- Joint clients on a matter (multiple portal users → one matter).
- WebSocket subscription for messages and dashboard counts.
- MFA step-up for payment and acknowledgement on Firm-tier customers.
- Hindi + 2 regional languages.

### 8.4 v3 — could

- iOS / Android native clients sharing the portal API.
- Calendar export (`.ics`) of hearings.
- A read-only "auditor" role for the client's CFO/in-house counsel to view invoices but not message.

---

## 9. Acceptance criteria

The portal v1 is done when *all* of the following hold for a freshly seeded Practice-tier tenant:

1. A Firm Admin can enable the portal for an existing client in two clicks. The client receives a magic-link email within 60 seconds.
2. The client can complete the first-time access flow on a clean browser session and land on a populated dashboard. The URL no longer contains the magic-link token after redirect.
3. The dashboard renders in one round trip and meets the FCP/TTI budgets in §6.5.
4. The client can:
   - View any matter they are on.
   - Download a shared document (signed URL opens in a new tab; SPA does not navigate).
   - Acknowledge a document that requires it; the firm-side sees the acknowledgement within 5 seconds.
   - Pay a `sent` invoice; on PSP webhook, the invoice status flips to `paid` and a receipt email is sent.
   - Send a message; the firm-side advocate receives an email and an in-app notification.
   - Sign out; subsequent navigation to `/portal/dashboard` redirects to the magic-link prompt.
5. The client cannot:
   - See any matter, document, message, or invoice belonging to another client.
   - Reach any URL under `/api/*` outside `/api/portal/*` with their JWT (verified with curl + tampered headers).
   - Replay a consumed magic-link token.
   - Use an expired JWT to make a request (verified by clock-forwarding the test runner).
6. Every action in §6.2 produces an audit-log entry that includes `firmId`, `clientId`, `requestId`, and IP.
7. The portal sub-app is code-split from the firm-side bundle (verified by inspecting the Vite manifest).
8. The portal passes axe-core accessibility checks with zero serious or critical violations on the dashboard and matter detail views.
9. SuperAdmin can disable the portal for a tenant in one click; existing portal sessions are invalidated within 30 seconds.

---

## 10. Open questions

1. **Magic-link refresh:** Should the portal expose a "send me a new link" button on the magic-link prompt, or require the client to ask their advocate? The first is friendlier; the second is harder to abuse.
2. **Joint matters:** When the v2 multi-client work happens, are message threads per-matter (current model) or per-matter-per-client? The former is simpler; the latter handles confidentiality between joint clients better.
3. **Closed-matter visibility window:** §4.3 sets it at 6 months — is that the right number for the Indian practice context, where appeals can land much later?
4. **PSP choice:** Razorpay is the working assumption. Confirmed, or do we abstract over multiple PSPs in v1?
5. **Branding:** Does the portal carry the firm's logo / colours, or LexDraft's? Practice and Firm tiers may want firm-branding; that's a token-override mechanism we haven't specced.

---

## 11. References

- System overview: [OVERVIEW.md](./OVERVIEW.md)
- Per-plan dashboards: [WORKFLOW_DASHBOARDS.md](./WORKFLOW_DASHBOARDS.md)
- RBAC + tenant onboarding: [lexdraft-user-management-spec.md](./lexdraft-user-management-spec.md)
- Plan gating: [PRICING_AND_TIERS.md](./PRICING_AND_TIERS.md)
- Implementation README: [`apps/web/src/views/portal/README.md`](./apps/web/src/views/portal/README.md)
- Wire types: [`packages/types/src/portal.ts`](./packages/types/src/portal.ts)
- Backend routes (to add): `apps/api/src/routes/portal/*`
