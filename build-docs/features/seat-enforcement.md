# Seat enforcement on direct member management (2026-11-16)

## Purpose
Only email invitations checked paid seats. A Firm Admin could exceed paid advocate seats with Roles & Access "Add member", or turn a ₹149 Munshi seat into a full advocate (with AI) by changing role, or re-activate a deactivated member past the cap.

## Architecture
- `assertSeatCapNotExceeded(firmId, role, acceptingInviteId?, excludeUserId?)`: new `excludeUserId` so a member being changed is not counted twice.
- `firmAdminService.createUser`: seat check with the chosen role before insert.
- `firmAdminService.updateUser`: role must be a system role or this firm's (else 404). When the member ends up active and either was not active before or switches between advocate and Munshi, the seat check runs. On such a switch `users.role` (text) is set to the new role name, so the Munshi seat count and the no-AI rule (credit.service assertNotMunshi) follow the change.

## Impact map
- routes/firm.routes.ts POST/PATCH /firm/users (Roles & Access screens). Error: 402 seat_cap_exceeded, already shown as a message by web lib/api.ts (no sign-out).
- invitations.service (shared helper; old callers unchanged).
- Role changes that do not cross advocate/Munshi (e.g. Associate -> Senior Associate) are not seat-checked, so legacy over-cap firms can still edit.

## Acceptance criteria
1. Add member past advocate seats -> 402. 2. Munshi past Munshi seats -> 402. 3. Munshi -> advocate with no free advocate seat -> 402. 4. With a free seat it works and users.role follows. 5. Re-activation past the cap -> 402. 6. Advocate -> Munshi: AI charges refused. 7. Role outside the firm -> 404.
