# Munshi seats on Sanad / Vakalat / Brief (2026-11-16)

## Purpose
Munshi seats (₹149/mo, max 4) are sold on every paid plan, but inviting needed `admin.users`, which only Associates / Partners have. A solo owner could pay for a Munshi seat and never use it.

## Architecture
- `middleware/requireMemberAdmin.ts`: `admin.users` holders pass as before; the active owner of a Solo-tier firm (`users.role = 'Solo Advocate'`) passes with `res.locals.munshiOnly = true`; others 403.
- `/invitations` GET/POST/DELETE/resend use it. munshiOnly: list filtered to Munshi invites; POST with any other role -> 403 `munshi_only`; cancel/resend only on Munshi invites. Seat check (assertSeatCapNotExceeded) unchanged.
- New `/firm/munshi` GET (active/suspended Munshi members) and PATCH `/firm/munshi/:id` `{status: active|deactivated}`, Munshi targets only (else 404); goes through firmAdminService.updateUser, so re-activation is seat-checked.
- Error handler: legacy errors with `.status` now keep a string `code` (e.g. `seat_cap_exceeded`), which web lib/api.ts already reads.
- Web: `MunshiPanel` on Plan & Billing (owner, Solo tier, munshiSeats > 0): seats used, members with Remove, pending invites with Cancel, "Invite your Munshi" opens InviteMemberModal with `munshiOnly` (role fixed to Munshi; link shown to share on WhatsApp as before).

## Impact map
- invitations.routes (Associates/Partners admins unchanged), firm.routes (new routes only), error.ts (adds `code` to 4xx legacy errors), BillingView, InviteMemberModal.
- Full member admin (/firm/users, Roles & Access) stays closed to solo owners.

## Acceptance criteria
1. Solo owner inviting an advocate -> 403 munshi_only. 2. Munshi invite fits the paid seat; one more -> 402 seat_cap_exceeded (with code). 3. List shows only Munshi invites; cancel works. 4. Munshi members listed and removable; non-Munshi target -> 404. 5. /firm/users stays 403. 6. A Munshi cannot invite. 7. Associates admin still invites advocates.
