# Key lockdown

## Purpose
FIELD_ENCRYPTION_KEY sits in /opt/lexdraft/apps/api/.env.docker, inside the git checkout, next to the code. A leaked app folder or careless copy leaks the key with the data.

## Findings (2026-11-14 audit)
- 49 copies of the key on the server, all mode 644 (readable by the `ubuntu` login too): live .env.docker, 33 env backups (/root, /var/backups/lexdraft), ~15 Docker build-cache layers.
- Build cache has it because `.dockerignore` whitelists `apps/api/.env.docker` and `pnpm deploy` copies it into the build stage. Final api/web images are clean.
- 30 DB dumps in /var/backups/lexdraft are 644 too: full case data readable by `ubuntu`.

## Architecture
- `.dockerignore`: drop the `!apps/api/.env.docker` exception (runtime env_file only, never build).
- chmod 600 every env copy and dump; dirs /var/backups/lexdraft and /etc/lexdraft 700.
- New root-only file `/etc/lexdraft/secrets.env` (owner root, chmod 600, dir 700) holding FIELD_ENCRYPTION_KEY (later also JWT/STORAGE secrets if wanted).
- Server-only `docker-compose.apiport.yml` (untracked, already used for the api port) adds it as a second `env_file` for api. No repo change.
- Remove the key line from `.env.docker` only after the api boots with the new file and a decrypt check passes.
- Offline backup: owner copies the key from the server into a password manager, once. Not in git, chat, or email.

## Impact map
- api container env: must still see the key or every encrypted document and client email is unreadable. Uploads would be refused (prod guard).
- Redeploy steps (vps-deploy memory): api must keep using base + apiport files; documented.
- encrypt-existing-* scripts run inside the container: unaffected.

## Edge cases
- File missing/unreadable at boot → compose fails to start api. Roll back by restoring the key line from /root/env.docker.pre-enc-* backup.
- Key changed by mistake → GCM auth fails on reads. Verify with a known encrypted file (decrypt check) before and after.
- Old env backups in /root still contain the key: delete them after the move (ask first).

## Acceptance criteria
- No env file or dump on the server readable by non-root; new builds carry no env file.
- `.env.docker` has no FIELD_ENCRYPTION_KEY line; secrets file is 600 root-only.
- api healthy; an existing encrypted file decrypts; a new upload is encrypted.
- Owner confirms the offline backup exists.
