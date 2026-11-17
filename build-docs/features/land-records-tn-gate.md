# Feature: Land Records for Tamil Nadu advocates only (admin switch)

Status: **built 2026-11-17 (branch feat/admin-console-v2), not deployed.**

## Purpose
- Land Records only reads Tamil Nadu's eServices site, so it's for TN advocates. The superadmin can turn it on/off. Advocates in other states see "Land Records for <state> coming soon".

## Owner decisions (2026-11-17)
- Live data has no state saved for any advocate (2 users, both empty). So: use the profile state; if empty, the Land Records screen asks "Which state do you practise in?" once and saves it to the profile.
- "Coming soon" shows in the menu (badge) and on the screen.
- Superadmin: platform on/off + per-firm override (on / off / follow the rules).

## Architecture
- Data (migration 0114, additive): `platform_settings['land_records'] = {enabled}` (absent = on, today's behaviour); `firms.land_records text null check in ('on','off')`.
- Rule (`lib/land-access.ts`, one function used by API + tests):
    1. platform off → `disabled`;
    2. firm override `off` → `disabled`; `on` → `available`;
    3. user state is Tamil Nadu (case-insensitive "tamil nadu" / "tn") → `available`;
    4. state empty → `state_required`;
    5. any other state → `coming_soon` (with the state name).
- API: `GET /land-records/access` → `{ status, state }`; `PUT /land-records/state {state}` saves users.state (from the web's India states list, max 80); every other `/land-records/*` route refused unless `available` (403 codes `land_records_disabled` / `land_records_coming_soon` / `state_required`).
- Admin: `GET/PATCH /admin/land-records` (platform switch), `PATCH /admin/firms/:id/land-records {mode: 'on'|'off'|null}`; both audited.
- Web: sidebar label "Land Records" + badge "Soon" when coming_soon, hidden when disabled; screen shows the state picker / coming-soon note / disabled note instead of the services. Admin: switch card on Overview, override select on Firm detail.

## Impact map
- `routes/land-records.routes.ts` (all routes get the guard; existing searches/tracker unchanged for TN users).
- Followed land applications (tracker) for a firm that becomes `disabled`: no new checks via the API (guarded); nothing deleted.
- `users.state` also feeds the GST invoice place of supply: saving it here makes invoices more correct, never wrong (the advocate picks their own state).
- nav-config / Sidebar: label change "TN Land Records" → "Land Records".

## Edge cases
- State typed differently ("TamilNadu", "TN", " tamil nadu ") → normalised.
- Admin switch off while a search is open → next step 403, screen shows the disabled note.
- Superadmin impersonating → same rule as the user.
- Bad state value (not in list / too long) → 400.

## Acceptance criteria
1. TN advocate: services work as today.
2. Advocate with no state: screen asks once; picking Tamil Nadu opens the services; picking another state shows "coming soon".
3. Non-TN advocate: menu shows "Soon", screen shows "Land Records for <state> coming soon", every land-records API call is 403.
4. Platform off: hidden from the menu, API 403 for everyone; firm override can't bypass it.
5. Firm override `on` gives access regardless of state; `off` blocks a TN firm.
6. Switch and override changes are audited.
