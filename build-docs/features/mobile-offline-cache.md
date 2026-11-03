# mobile-offline-cache

## Purpose
Courtrooms have bad signal. Diary, case timelines and recent drafts must open without network.

## Architecture
- `@tanstack/react-query-persist-client` + `createSyncStoragePersister` (official add-ons to the installed react-query 5). Native only.
- `shouldDehydrateQuery` allow-list: diary/hearings, case detail + timeline, case list, last 10 drafts. Everything else (AI, eFiling, billing, admin) never persisted.
- `maxAge` 7 days; `buster` = app version + user id.
- Offline banner: "Offline — showing data from <time>"; mutations disabled with a toast, not queued.

## Impact map
- main.tsx (provider swap), query keys in hooks (allow-list by key prefix), sign-out path (must `persister.removeClient()` + `queryClient.clear()`), mobile-biometric-lock (prerequisite).

## Edge cases
- Sign-out / user switch → cache wiped before the next user's first render.
- Storage quota hit → persister errors swallowed, app works online.
- Schema change between versions → buster drops old cache.
- Stale hearing date shown offline → banner time makes staleness explicit.

## Acceptance criteria
- Airplane mode after one online visit: diary, a case timeline and a recent draft open.
- Sign out → reopen offline → nothing cached is readable.
- AI/eFiling/billing responses never appear in storage (checked by key scan in a test).
