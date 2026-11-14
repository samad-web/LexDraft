# Secure share link

## Purpose
Send the client a link instead of the file: it expires, can be cancelled, can need a password, and shows if it was opened. The file never sits in the WhatsApp chat.

## Architecture
- Migration 0111 `share_links`: id, firm_id, created_by, storage_key (encrypted file, own copy under `shares/`), file_name, content_type, token_hash (sha256 of a 32-byte random token; raw token only in the URL), password_hash (scrypt, nullable), expires_at, revoked_at, view_count, last_viewed_at, created_at. Index on token_hash.
- API (signed-in): `POST /api/share-links` (file upload or existing document id, expiry 1/7/30 days, optional password) → URL; `GET /api/share-links` (firm's links); `POST /api/share-links/:id/revoke`.
- Public: `GET /api/s/:token/meta` (name, needs password, expired?) and `POST /api/s/:token/open` (password if set) → file bytes, decrypted by storage. Rate limited (10/min per IP+token); 5 wrong passwords → link locked.
- Web: public page `/s/:token` (DifAi wordmark, file name, password box, Open/Download). "Send secure link on WhatsApp" on the Share card. "Shared links" list with views, expiry, Revoke.

## Impact map
- New table (0111, additive). storage service (new keys under `shares/`). Rate limiter. App routes (new public route, not behind auth). WhatsApp share helpers.
- Firm deletion: cascade on firm_id; files removed by delete hook.

## Edge cases
- Expired/revoked/unknown token → same generic "Link not available" (no hint which).
- Brute force → rate limit + lockout. Token never logged.
- Source document deleted later → link keeps its own copy until expiry, then a nightly sweep deletes expired copies.
- Concurrency: view_count via single UPDATE … RETURNING.

## Acceptance criteria
- Link opens the exact file before expiry; refuses after expiry or revoke.
- Password link refuses without/with wrong password; locks after 5 wrong tries.
- Token stored only as hash; DB row reveals no usable link.
- Advocate sees views and can revoke; other firms can't see or revoke.
