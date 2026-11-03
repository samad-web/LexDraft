# Testing

## eFiling (apps/api/e2e/efiling*.e2e.ts)
- 2026-11-03 - redesign step 1 (shell, sections, Sign In card): 189 passed, 1 skipped.
  - Failures found: the new section/screen tabs collided with the wizard's own tabs ("Applications" twice); tests now look for tabs inside the screen (`.efiling > section`). Old portal "Case Filing" menu step removed from the Dashboard test.
  - Screenshots light/dark 1440 + phone 360 reviewed: fixed wrapped PillNav clipping corner pills (rounded overflow) and the captcha row breaking at 360.
  - `E2E_SCHEME` / `E2E_WIDTH` added to efiling-login-ui for dark and phone shots.
- 2026-11-03 - portal Sign In + review fixes: 189 passed, 1 skipped (preview, on request only); DB rollback clean.
  - New: a second Sign In leaves a live session alone (multi-advocate); one-step Sign In wrong captcha -> retry, duplicate login -> logged in (portal flow).
