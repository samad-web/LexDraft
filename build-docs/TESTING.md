# Testing

## eFiling (apps/api/e2e/efiling*.e2e.ts)
- 2026-11-03 - portal Sign In + review fixes: 189 passed, 1 skipped (preview, on request only); DB rollback clean.
  - New: a second Sign In leaves a live session alone (multi-advocate); one-step Sign In wrong captcha -> retry, duplicate login -> logged in (portal flow).
