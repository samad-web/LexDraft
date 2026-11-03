# Project memory (LexDraft / DifAi)

## Decisions
- 2026-11-03 — eFiling redesigned fully in DifAi's Chambers design; may reorganise menus/screens. Replaces 2026-11-02 "copy the portal's layout". Reason: user's choice after being shown the conflict with the earlier portal-copy request.
- 2026-11-02 — eFiling stays black and white (user reversed the portal-colour request the same day).
- 2026-11-02 — eFiling login = one-step Sign In with the captcha shown on load; a new Sign In never ends a live session until the new login succeeds; unused Sign In pages close after 3 min.
- eFiling portal actions always need the advocate's confirmation; captcha/OTP typed by the advocate; DifAi never pays.

## Constraints
- Strictly black & white; red only as a button naming a mandatory issue. Light + dark.
- Live Supabase: no schema/data changes without approval; no test accounts; tests roll back.
- Deploy only when the user says "deploy".

## Open questions
- none. (eFiling redesign plan approved 2026-11-03.)

## Known issues
- eFiling Overview tiles are still portal-style (light tiles in dark mode) until redesign step 2.
