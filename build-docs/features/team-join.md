# Team join, Teams-style (2026-11-18, owner: "work like Microsoft Teams") — built

## Purpose
Chambers/Firm admins add teammates by email; the teammate joins with Google OR email + password. Fixes: "Add member" created accounts nobody could sign in to (random hidden password + Google refused with google_link_required); Google-only invites shut out non-Google work emails; existing DifAi users could not join a firm.

## Decisions (owner, 2026-11-18)
- One "Add member" = an invite (email + role) → link + WhatsApp share right away. Direct account creation removed from the firm UI and API route.
- Join with Google, or with email + password (+ WhatsApp code, strong password, Terms in-app).
- Existing DifAi account: confirm "Join <firm>" → account moves into the firm. Old workspace (matters, drafts, clients) stays where it is, not deleted, not visible to the firm; join screen offers "Download my data" first and says unused solo-plan days are not refunded automatically.
- Not built: one person in many firms; auto-join on sign-in without the link.

## Architecture
- API (invitations.routes):
  - `POST /invitations/by-token/:token/email/start {name, phone}` → WhatsApp code; email is the invite's (not typed).
  - `POST /invitations/by-token/:token/email/accept {signupToken, challengeId, code, password}` → account in the firm.
  - `POST /invitations/by-token/:token/join` (signed in; account email = invite email) → move: users.firm_id, role, role_id; invite accepted; caches cleared; new session.
  - Google path unchanged (`/accept`).
  - `POST /firm/users` removed (it made the lockout accounts).
- invitationsService.accept takes `{ name, email, googleSub?, phone, password }`.
- Web: InviteAcceptView = choose Google / email; signed-in invitee sees the Join confirm; signed in as someone else → "sign out and sign in as <email>". Members screen: one "Add member" opens the invite modal.

## Impact map
- auth.service: email sign-up token + OTP check shared with the invite email path (one helper). Normal sign-up unchanged.
- Seat + paid-firm checks: same assertFirmPaidForMembers / assertSeatCapNotExceeded on every path.
- Permissions / plan-status caches: invalidated for a moved user.
- Old solo firm: keeps its rows and plan row; no members. Renewal reminders for it have no owner phone path → none sent.

## Edge cases
- Invite expired / cancelled / accepted / seat full / firm unpaid → clear error, nothing changes.
- Email path: email already has an account → "Sign in, then join" (existing-user path). Phone already used → refused (same as sign-up).
- Join: signed-in email ≠ invite email → 403. Superadmin → 403. Already in this firm → 409. Sole Firm Admin of a firm with other active members → 409 "promote another admin first".
- Link = credential for the email path (link goes to the person over WhatsApp); Google path still proves the email. Accepted risk, like Teams guest links.

## Acceptance criteria
- AC1 email path: invite → code on WhatsApp → strong password → user in inviter's firm with the invite role; invite accepted.
- AC2 email path refuses: wrong/expired code, weak password, email that already has an account.
- AC3 existing user joins: firm_id/role move, invite accepted, old firm rows untouched, new session works.
- AC4 join refuses: other email, superadmin, expired invite, seat full, sole admin with members.
- AC5 Members screen: no direct-create; Add member opens the invite with link + WhatsApp share.
- AC6 web invite page: Google and email choices; signed-in invitee sees Join with export link.
- AC7 sign-in from the invite (?next=/invite/<token>) returns to the invite; any other next is ignored (no open redirect).
