# Co-Counsel lockdown + flow fixes

Status: BUILT + tested locally 2026-11-10 (D1–D4 approved as recommended). Not deployed; migration 0101 not on Supabase/prod.

Known limit: a guest's matter-chat reply preview can quote the first 140 chars of a pre-join message if a post-join message replies to it (shortcut; hide reply previews older than the grant if that matters).

## Purpose
An outside advocate who accepts a handover must reach **exactly one case** of the referring firm and nothing else: no other cases, clients, documents or firm data. Access must be removable. The accept flow must work for new and existing DifAi users.

## What "encrypted" means here
The ask was to make the feature "encrypted". Encryption at rest does not stop a signed-in guest from reading what the server hands them; **access control** does. This plan locks access server-side (one grant row = one case). Per-case encryption keys are out of scope (see Decisions).

## Current state (audited 2026-11-10)
- Guest gets their own Solo firm (`registerCoCounselGuest`). All firm-scoped routes resolve to the guest's firm → firm A's other cases, clients, documents, hearings, drafts are already unreachable. Checked: no case/document/client query keyed on id alone in routes/services (land-records save is guarded by `caseBelongsToFirm`).
- Guest reads of the handed case go only through `/co-counsel/guest-cases/:id`, gated by `assertGuestGrant`. Documents: names only, no file bytes. Notes: `shared` only.
- **Holes**
  1. **Open link is claimable by anyone** who sees it (any Google account). Biggest leak.
  2. **No revoke.** Once accepted, access is permanent.
  3. **Matter chat bypasses the grant.** Membership comes from `case_assignments`, not `case_guest_grants`; the guest sees the firm's whole internal chat history on the case, and `removeMatterMember` refuses to remove a cross-firm user (`u.firm_id = c.firm_id`).
  4. **Existing DifAi users dead-end** on the accept page (no screen calls `POST /requests/:id/accept`).
  5. Expired links stay "Waiting to accept".
  6. API-only paths with no UI: email invite (link has no domain) and cross-firm `existingUserId`.

## Architecture
- **Single gate:** `case_guest_grants` (status `active`) is the only thing that gives a guest anything. `case_assignments` stays for in-firm staff; the guest's collaborator row is kept only for chat fan-out and is deleted on revoke.
- **Link bound to a phone:** referring advocate enters the recipient's mobile when generating the link → stored on `invitations.phone`. Accept requires the WhatsApp-OTP-verified phone (already captured by `GoogleWhatsAppVerify`) to match. Wrong phone → 403, link stays unused.
- **Existing users:** `POST /co-counsel/accept/by-token/:token` accepts a signed-in caller too: if `Authorization` is present and the phone matches, grant to that user; no new account. Replaces the dead-end toast.
- **Revoke:** `POST /co-counsel/requests/:id/revoke` (requester or firm head, accepted requests only) → grant `revoked`, delete guest's `case_assignments` row, request status `revoked`, notify guest. Guest page then 404s.
- **Leave:** guest can drop a case: `POST /co-counsel/guest-cases/:caseId/leave` → same as revoke.
- **Chat:** matter-chat membership for a cross-firm user additionally requires an active grant; messages before `grant.created_at` are hidden from them.
- **Expiry:** `listForFirm` marks pending requests whose invitation expired as `expired`.
- **Delete dead paths:** cross-firm `existingUserId` and `{name,email,phone}` targets removed from API schema + service (in-firm teammate path stays). Shrinks attack surface; UI never used them.

### Data
- Migration 0101 (additive): `alter type handover_status add value 'revoked'`. No other schema change (`invitations.phone` exists). Needs your go for live Supabase/prod per MEMORY.

## Impact map
| Touches | Risk |
|---|---|
| `co-counsel.service.ts` / `.routes.ts` | Accept logic change; existing tests must be updated for removed paths |
| `team-chat.service.ts` `membership`, `memberIds`, `members`, message list, `getMatterDiscussion` | In-firm chat must stay unchanged — regression tests on firm members |
| `auth` middleware (optional auth on accept route) | Must not make the route require auth for new users |
| `HandOffCaseModal.tsx` | New required mobile field before "Generate link" |
| `CoCounselAcceptView.tsx` | Existing-user branch now accepts instead of redirecting |
| `CaseCoCounselTab.tsx` | Revoke button on accepted external rows; "Revoked"/"Expired" labels |
| `GuestCaseDetailView.tsx` | "Leave this matter" button |
| `nav-config.ts` | Co-Counsel item gated on `shared.documents`; guest's trial plan must have it (verify) |
| Migration 0101 | Enum add only, no data loss |

## Edge cases
- Link forwarded to someone else → their phone won't match → refused.
- Recipient changes phone → referring advocate cancels + generates a new link.
- Same guest handed two cases → two grants; revoking one leaves the other.
- Revoke while guest has the page open → next fetch 404 → "Access to this matter was removed".
- Guest re-handed a revoked case → `on conflict` reactivates the grant (already coded).
- Concurrent double-accept of one link → invitation status check inside the transaction (`for update`) so only one wins.
- Firm A deletes the case → cascades remove grant (existing FK).

## Acceptance criteria
1. A guest calling firm A's cases, clients, documents (list + download), hearings, notes, drafts endpoints for any case — including the handed one — gets empty/404. Only `/co-counsel/guest-cases/:id` returns data.
2. Accepting a link with a different verified phone → 403; link still pending.
3. Existing DifAi user with matching phone accepts → grant on their account, no new account, lands on the guest case.
4. Revoke → guest case page 404, case gone from guest list, guest out of matter chat, request shows "Revoked".
5. Guest leave → same as 4 from the guest side.
6. Guest in matter chat sees only messages after their grant date; firm members see everything as before.
7. Expired link shows "Expired" in the tab.
8. Cross-firm `existingUserId` / email targets rejected with 400.
9. In-firm teammate handoff unchanged.

## Decisions (2026-11-10, user)
- D1 Access lock, not encryption.
- D2 Link bound to recipient's WhatsApp number.
- D3 Guest sees matter chat from grant date only.
- D4 Unused email / cross-firm-user API paths deleted; any outside advocate (new or existing) is reached by the phone-bound link.
