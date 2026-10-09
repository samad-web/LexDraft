# Google Calendar Two-Way Sync — Implementation Spec

**Status:** Draft for review · **Owner:** LexDraft · **Date:** 2026-09-19
**Scope:** Bidirectional sync between LexDraft hearings and each advocate's Google Calendar.

---

## 1. Decision summary

| Question | Decision | Why |
|---|---|---|
| Who owns the Google Cloud project? | **LexDraft owns ONE GCP project.** Advocates never see GCP. | Advocates lack cloud knowledge; we can't support per-advocate setup. They click one "Connect" button and approve Google's consent screen. |
| Sync direction | **Two-way** (LexDraft ⇄ Google) | User requirement: "if they set it on both, it should work." |
| Where do LexDraft events land in Google? | A **dedicated "LexDraft Hearings" calendar** auto-created in the advocate's Google account. | Cleanly separable, safe to bulk-remove on disconnect, never touches personal events. Still shows on their phone like any Google calendar — no app install. |
| Source of truth | **LexDraft** (hearings are created against cases). Google is a mirror + an inbound capture surface. | Matches how advocates actually work. |
| Pull method (Google → LexDraft) for v1 | **Incremental polling via sync tokens** (pg-boss cron, ~5 min). | More *reliable* than push: no public endpoint dependency, no 7-day watch-channel renewal that silently breaks. Push webhook is a v2 latency optimization. |
| Conflict resolution | **Last-write-wins by `updated_at`.** | Predictable; matches user intuition ("my most recent edit is right"). |
| Fallback for non-OAuth users | Keep existing **Export ICS** subscribe URL (read-only). | Zero-auth path for advocates who won't connect. |

---

## 2. One-time setup (LexDraft side only — NOT per advocate)

1. Create a Google Cloud project (e.g. `lexdraft-prod`).
2. Enable the **Google Calendar API**.
3. Configure the **OAuth consent screen**:
   - App name: *LexDraft*, support email, logo, privacy-policy URL (`/PRIVACY_POLICY`).
   - Scopes: `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.calendarlist` (or the broader `.../auth/calendar` if we auto-create the calendar).
   - Publishing status: **In production** (so any advocate can connect, not just test users). This requires Google's OAuth verification (branded consent screen) — budget ~1–2 weeks for review. Until verified, works for up to 100 test users.
4. Create an **OAuth 2.0 Client ID** (type: *Web application*).
   - Authorized redirect URI: `${BASE_URL}/api/integrations/google/callback`.
5. Put credentials in `.env` (see §7). **Never** commit them.

> Advocate experience: Settings → *Connect Google Calendar* → Google consent screen → back to LexDraft. Zero GCP knowledge required.

---

## 3. Data model (new migration `0071_google_calendar.sql`)

```sql
-- Per-user Google connection. One row per (user, google account).
create table google_calendar_accounts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  firm_id           uuid not null references firms(id) on delete cascade,
  google_email      text not null,
  refresh_token     text not null,              -- encrypted at rest (see §6)
  access_token      text,                       -- cached; short-lived
  access_expires_at timestamptz,
  calendar_id       text,                       -- the "LexDraft Hearings" calendar id in Google
  sync_token        text,                       -- Google incremental sync cursor
  channel_id        text,                       -- v2 push only; null in v1
  channel_expiry    timestamptz,                -- v2 push only
  status            text not null default 'active', -- active | revoked | error
  last_synced_at    timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, google_email)
);

-- Link each hearing to its Google event so we never duplicate.
alter table hearings
  add column google_event_id text,     -- event id in the LexDraft Hearings calendar
  add column google_etag     text,     -- for conflict / change detection
  add column gcal_synced_at  timestamptz;

create index hearings_google_event_id_idx on hearings (google_event_id);

-- Loose inbound events created in Google but not yet attached to a case.
-- (Reuses existing "orphan hearing" concept: case_id null.)
```

**Identity link rule:** a hearing "is" a Google event iff `hearings.google_event_id = <event.id>`. On pull, look up by `google_event_id` before inserting — this is the single most important anti-duplication invariant.

---

## 4. API surface (new `google-calendar.routes.ts`, mounted in `routes/index.ts`)

All under the existing JWT auth middleware (firm/user scoped).

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/integrations/google/connect` | Returns Google OAuth consent URL (state = signed user id). |
| `GET`  | `/api/integrations/google/callback` | Google redirects here with `code`. Exchange for tokens, create "LexDraft Hearings" calendar, store row, kick initial full sync. Redirect to `${WEB_PUBLIC_BASE_URL}/app/calendar?connected=1`. |
| `GET`  | `/api/integrations/google/status` | `{ connected, google_email, last_synced_at, status }` for the UI badge. |
| `POST` | `/api/integrations/google/disconnect` | Revoke token at Google, optionally delete the LexDraft Hearings calendar, mark row `revoked`. |
| `POST` | `/api/integrations/google/sync` | Manual "Sync now" — enqueues a pull+push pass. |

---

## 5. Services & jobs (new `google-calendar.service.ts`; hooks into existing files)

### 5.1 Push (LexDraft → Google) — hook into `hearings.service.ts`
On `createHearing` / `updateHearing` / `deleteHearing`, after the DB write:
```
jobs.enqueue('gcal.push', { userId, hearingId, op: 'upsert' | 'delete' })
```
Handler `gcal.push`:
- Load the user's active `google_calendar_accounts` row (skip if none).
- Map hearing → Google event (summary = `case_label`, start/end from `hearing_date` + `hearing_time`, description = purpose/court/judge, `extendedProperties.private.lexdraftHearingId = <id>`).
- If `google_event_id` exists → `events.update`; else `events.insert`. Store returned `id` + `etag`.
- Idempotent: safe to redeliver (pg-boss may retry).

### 5.2 Pull (Google → LexDraft) — cron job `gcal.pull`
Registered via `jobs.register('gcal.pull', handler, { cron: '*/5 * * * *', tz: 'Asia/Kolkata' })`.
For each active account:
- Call `events.list` on the LexDraft Hearings calendar with the stored `sync_token` (incremental). First run has no token → full sync, then store the returned `nextSyncToken`.
- For each changed event:
  - Find hearing by `google_event_id`.
  - **Conflict:** compare Google `updated` vs `hearings.updated_at`. Newer wins.
  - If event was created in Google (no matching hearing) → insert a **loose hearing** (`case_id` null, `case_label` = event summary) so the advocate can attach it to a case later. Set `google_event_id`.
  - If event deleted in Google (`status: cancelled`) → soft-cancel the hearing.
- On `410 Gone` (expired sync token) → drop token, do a full resync.

### 5.3 Token refresh
Access tokens expire hourly. Before any Google call, if `access_expires_at` is past, refresh using `refresh_token` and update the row. If refresh returns `invalid_grant` (user revoked access in their Google account) → mark `status = 'revoked'`, surface a "reconnect" banner in the UI.

### 5.4 Nightly reconcile — cron `gcal.reconcile` (`0 2 * * *`, Asia/Kolkata)
Full diff between LexDraft hearings and Google events per account to heal any missed deltas (belt-and-suspenders against dropped webhooks/tokens).

---

## 6. Security

- **Refresh tokens are credentials.** Encrypt at rest (AES-256-GCM using a new `GCAL_TOKEN_ENC_KEY`), decrypt only in-memory when calling Google. Never log them.
- OAuth `state` = HMAC-signed `{userId, nonce}` (reuse `JWT_SECRET` or a dedicated secret) to prevent CSRF on the callback.
- Multi-tenant: every query filters by `firm_id` / `user_id`; a user only ever syncs their own calendar.
- Disconnect must **revoke at Google** (`POST https://oauth2.googleapis.com/revoke`), not just delete our row.
- Rate limits: Google Calendar API has per-project quotas; polling every 5 min with sync tokens is well within free quota even at thousands of advocates (incremental lists return only deltas).

---

## 7. New environment variables

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=${BASE_URL}/api/integrations/google/callback
GCAL_TOKEN_ENC_KEY=            # 32-byte base64 key for token encryption
GCAL_SYNC_ENABLED=true         # feature flag / kill switch
```

---

## 8. Frontend (`apps/web` calendar page)

- Add a **"Connect Google Calendar"** button next to "Export ICS".
- When connected: show a green **"Synced with Google · <email>"** badge, a **"Sync now"** action, and **"Disconnect."**
- If `status = revoked`: amber banner "Reconnect Google Calendar to resume syncing."
- Copy for expectation-setting (important): *"Hearings you add in Google Calendar will appear here as unlinked entries — open one to attach it to a case."*

---

## 9. Rollout plan

1. **Migration + token model + OAuth connect/callback** (no sync yet) — prove connection works, calendar gets created.
2. **Push (LexDraft → Google)** — hearings appear on the advocate's phone.
3. **Pull via polling (Google → LexDraft)** — phone edits flow back.
4. **Nightly reconcile** — self-healing.
5. **UI polish + expectation copy.**
6. **v2 (later):** Google push webhook via existing `/webhooks/:source` route for near-instant pull, replacing/augmenting the 5-min poll. Adds watch-channel creation + 7-day renewal cron.

---

## 10. Explicit non-goals for v1

- No push webhook (polling instead — more reliable to ship).
- No sync of *client-portal* calendars or firm-wide shared calendars — per-advocate only.
- No mapping of Google event → specific case automatically (loose entries, manual attach).

---

## 11. Open items to confirm before coding

- [ ] Google OAuth **verification** timeline — start the consent-screen review early (gates production use beyond 100 test users).
- [ ] Encrypt-at-rest key management (`GCAL_TOKEN_ENC_KEY`) — where it's stored in prod (env / secret manager).
- [ ] Whether disconnect should **delete** the LexDraft Hearings calendar in Google or leave it (recommend: leave events, just stop syncing).
