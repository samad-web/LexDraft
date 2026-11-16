# Secure share link

## Purpose
Send the client a link instead of the file: it expires, can be cancelled, can need a password, and shows if it was opened. The file never sits in the WhatsApp chat.

## Architecture
- Migration 0111 `share_links`: id, firm_id, created_by, storage_key (encrypted file, own copy under `shares/`), file_name, content_type, token_hash (sha256 of a 32-byte random token; raw token only in the URL), password_hash (scrypt, nullable), expires_at, revoked_at, view_count, last_viewed_at, created_at. Index on token_hash.
- API (signed-in): `POST /api/share-links` (file upload or existing document id, expiry 1/7/30 days, optional password) → URL; `GET /api/share-links` (firm's links); `POST /api/share-links/:id/revoke`.
- Public: `POST /api/s/meta` {token} (name, size, needs password, expiry) and `POST /api/s/open` {token, password?} → file bytes, decrypted by storage. Rate limited (30 / 15 min per IP); 5 wrong passwords → link locked.
- Token never in a URL the server sees: the client link is `/s#<token>` (browsers never send the part after #), and the page posts it in the JSON body (`req.body.token` is redacted from logs). Verified locally: no log line contains a token.
- Web: public page `/s` (reads the token from the # part) (DifAi wordmark, file name, password box, Open/Download). "Send secure link on WhatsApp" on the Share card. "Shared links" list with views, expiry, Revoke.

## Impact map
- New table (0111, additive). nginx SPA route list gets `s` (else /s 404s in prod). storage service (new keys under `shares/`). Rate limiter. App routes (new public route, not behind auth). WhatsApp share helpers.
- Firm deletion: cascade on firm_id; files removed by delete hook.

## Edge cases
- Expired/revoked/unknown token → same generic "Link not available" (no hint which).
- Brute force → rate limit + lockout. Token never logged.
- Source document deleted later → link keeps its own copy until expiry, then the nightly sweep (`shareLinks.sweep`, 04:15 IST) deletes the copy.
- Max 200 active links per firm (disk-fill guard); files ≤ 25 MB.
- Firm deleted → rows cascade; their file copies stay orphaned (same as documents today).
- Concurrency: view_count via single UPDATE … RETURNING.

## Acceptance criteria
- Link opens the exact file before expiry; refuses after expiry or revoke.
- Password link refuses without/with wrong password; locks after 5 wrong tries.
- Token stored only as hash; DB row reveals no usable link.
- Advocate sees views and can revoke; other firms can't see or revoke.
