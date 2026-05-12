# LexDraft — Deployment Guide

Operating manual for shipping LexDraft to a single-tenant or shared production environment. Pairs with [`OVERVIEW.md`](./OVERVIEW.md) (architecture) and [`LEXDRAFT_ROADMAP.md`](./LEXDRAFT_ROADMAP.md) (planned work).

This guide assumes a Linux host with Docker Engine 24+ and the Compose v2 plugin. Everything else (Postgres, TLS termination, log shipping) is bring-your-own or runs on the same host via the documented overrides.

---

## 1. What you're deploying

| Service  | Image                              | Purpose                                                            |
|----------|------------------------------------|--------------------------------------------------------------------|
| `api`    | built from `apps/api/Dockerfile`   | Express + postgres-js + pg-boss. Serves `/api/*` on port 4000.     |
| `web`    | built from `apps/web/Dockerfile`   | nginx serving the React SPA. Listens on port 80 inside the network.|
| `postgres` (optional) | `postgres:16-alpine`  | Only run this if you don't have a managed Postgres yet. **Strongly prefer managed.** |

The API uses Postgres for BOTH application data and the pg-boss background-job queue. No Redis, no separate broker, no sidecars.

---

## 2. Prerequisites

### 2.1 Host
- Linux x86_64 with kernel 5.x+. Tested against Debian 12 / Ubuntu 22.04. Anything `systemd` + `docker` works.
- Docker Engine ≥ 24.0 and the Compose v2 plugin (`docker compose ...`, not the deprecated `docker-compose`).
- 2 vCPU / 4 GB RAM is the floor; 4 vCPU / 8 GB is comfortable for early customers.
- A dedicated non-root user that's a member of the `docker` group.

### 2.2 Outside the host
- A DNS record (`app.yourdomain.in`) pointing at the host's public IP.
- A reverse proxy that terminates TLS — Caddy is the simplest; Traefik or an nginx-ingress in front are equally fine. Sample Caddyfile in §6.
- A managed Postgres or self-hosted Postgres on a separate host. **Treat the database as the only stateful asset; nothing in this repo restores you from a lost volume.**
- An SMTP provider, once you turn on transactional email (Postmark, AWS SES, Resend, etc.). Not required for first boot — the notifications service degrades gracefully.

### 2.3 Repository checkout
```bash
sudo mkdir -p /opt/lexdraft
sudo chown $USER:$USER /opt/lexdraft
git clone <your fork or this repo> /opt/lexdraft
cd /opt/lexdraft
```

---

## 3. Local development

The whole stack runs from the repo root with a single command:

```bash
docker compose up --build
```

That brings up Postgres, the API (port 4000), and the web SPA (port 8080). Defaults live in [`apps/api/.env.docker`](./apps/api/.env.docker) and are safe for a laptop — `JWT_SECRET` is a placeholder, `DEV_AUTH_AUTO_PROVISION=true`, and unsigned webhooks are accepted.

Common dev tasks:

```bash
# Tail logs.
docker compose logs -f api

# Open a shell inside the API container.
docker compose exec api sh

# Apply migrations (idempotent — `db:migrate` no-ops if everything's
# already applied).
docker compose exec api node dist/scripts/migrate.js

# Reset the database (DROPS EVERYTHING — dev only).
docker compose exec api node dist/scripts/migrate.js --reset

# Talk to Postgres directly.
docker compose exec postgres psql -U postgres lexdraft
```

The web SPA is served at `http://localhost:8080` and proxies `/api/*` requests through the API container thanks to the `VITE_API_URL` build-arg in `docker-compose.yml`.

---

## 4. Initial production deploy

### 4.1 Provision the database

Pick one. Listed in increasing operational burden:

1. **Neon** — Postgres 16, serverless, point-in-time restore included. Easiest.
2. **Supabase** — Postgres 15 + pooler. Has a generous free tier; if you only need Postgres, ignore the rest of the platform.
3. **AWS RDS / Aurora** — bigger upfront cost, the right answer once you have multiple regions.
4. **Self-hosted on a second VPS** — only if regulatory pressure (DPDP cross-border concerns) forces it. You take on the backup + patching burden.

Whichever you pick, make sure:
- The instance is reachable from the application host (private network or allowlisted IP).
- It runs Postgres 14 or newer.
- You can connect with `psql "$DATABASE_URL"` from the application host before continuing.

### 4.2 Generate secrets

```bash
# JWT_SECRET            — signing key for app JWTs.
# STORAGE_SIGNING_SECRET — HMAC for presigned upload/download URLs.
# WEBHOOK_SECRET_*       — one per upstream that sends webhooks.

openssl rand -base64 48     # use the output for JWT_SECRET
openssl rand -base64 48     # use the output for STORAGE_SIGNING_SECRET
openssl rand -hex 32        # one per webhook source
```

Store them in a real secret manager (1Password Business, AWS Secrets Manager, doppler.com). Never commit a populated `.env` to the repo.

### 4.3 Write the prod env file

Drop this on the host at `/etc/lexdraft/api.env` (the path the production compose override expects):

```bash
sudo mkdir -p /etc/lexdraft
sudo install -m 0600 -o $USER -g $USER /dev/null /etc/lexdraft/api.env
$EDITOR /etc/lexdraft/api.env
```

Required fields (see [`apps/api/.env.example`](./apps/api/.env.example) for the canonical list):

| Variable                    | What goes here                                                                                                  |
|-----------------------------|-----------------------------------------------------------------------------------------------------------------|
| `NODE_ENV`                  | `production` — flips off DEV_AUTH_AUTO_PROVISION and WEBHOOK_ALLOW_UNVERIFIED regardless of their literal value. |
| `PORT`                      | Leave at `4000`. The reverse proxy talks to this.                                                               |
| `LOG_LEVEL`                 | `info` for steady state; bump to `debug` while incident response is live.                                       |
| `JWT_SECRET`                | 48-byte random string from §4.2. Rotating this signs every active user out.                                     |
| `JWT_EXPIRES_IN`            | `7d` is reasonable; tighter for higher-security tenants.                                                        |
| `CORS_ORIGINS`              | Comma-separated. Production: `https://app.yourdomain.in`. NEVER include `*`.                                    |
| `LLM_PROVIDER`              | `auto`, `xai`, `anthropic`, or `none`. Drafting falls back to a deterministic template when `none`.             |
| `ANTHROPIC_API_KEY`         | Optional. Required if `LLM_PROVIDER=anthropic`.                                                                 |
| `XAI_API_KEY`               | Optional. Required if `LLM_PROVIDER=xai`.                                                                       |
| `DATABASE_URL`              | Full Postgres URI to your managed instance. **MUST be set.**                                                    |
| `DATABASE_SSL`              | `true` for any managed Postgres. `false` ONLY when both ends are inside the same private network.               |
| `STORAGE_DRIVER`            | `local` until you wire S3/R2 credentials. Local storage = host disk → backup matters more (see §7).             |
| `STORAGE_LOCAL_DIR`         | `/app/uploads` inside the container — left at the default.                                                      |
| `STORAGE_PUBLIC_BASE_URL`   | The PUBLIC URL of the API (`https://app.yourdomain.in`). Used to mint presigned links.                          |
| `STORAGE_SIGNING_SECRET`    | 48-byte random string from §4.2.                                                                                |
| `WRITE_RATE_LIMIT`          | `120` writes per window per user is sane; tune down for hostile environments.                                   |
| `WRITE_RATE_LIMIT_WINDOW_MS`| `900000` (15 minutes) is the default.                                                                           |
| `WEB_PUBLIC_BASE_URL`       | The PUBLIC URL of the SPA (`https://app.yourdomain.in`).                                                        |
| `CLIENT_PORTAL_RETURN_LINK` | `false` for prod — the dev-only flag returns magic links in the response body.                                  |
| `WEBHOOK_SECRET_*`          | One per source. Empty = that source returns 503. Set what you've onboarded.                                     |
| `WEBHOOK_ALLOW_UNVERIFIED`  | `false`. The env loader forces this off when NODE_ENV=production anyway.                                        |
| `RESEARCH_PROVIDER`         | `none` until real case-law retrieval is built. `demo` returns the canned-demo answer — never to paying users.   |

POSTGRES_PASSWORD and POSTGRES_DB are also required in the SHELL env (not in api.env) if you're running Postgres in-compose — see §4.4.

### 4.4 First boot

If you're using **managed Postgres**, edit `docker-compose.prod.yml` and remove the `postgres:` service block entirely; the API will talk to your managed endpoint via `DATABASE_URL`. The compose file as shipped still defines `postgres` so the in-compose path keeps working for pilots.

```bash
# Pass the postgres secrets via the shell if you still run it in-compose.
export POSTGRES_PASSWORD="$(openssl rand -base64 32)"
export POSTGRES_DB=lexdraft

# Build and start. --build pulls the latest source from the working tree;
# wire this into a CI/CD pipeline once you have one.
docker compose \
    -f docker-compose.yml \
    -f docker-compose.prod.yml \
    up -d --build
```

Then apply migrations:

```bash
docker compose exec api node dist/scripts/migrate.js
```

Check status:

```bash
docker compose ps
docker compose logs --tail=100 api
curl http://127.0.0.1:4000/api/ready   # 200 = good
```

### 4.5 Seed the first superadmin

There's no built-in seeder for an empty database in production (the dev migration `0008_seed_firm_plan_solo.sql` is intentionally minimal — see [`apps/api/migrations`](./apps/api/migrations/)). Two paths:

**a) SQL — bootstrap once:**
```bash
docker compose exec postgres psql -U postgres lexdraft <<'SQL'
-- Replace with a real bcrypt hash. Generate with:
--   node -e "console.log(require('bcryptjs').hashSync('strong-password', 10))"
insert into users (id, email, name, role, password_hash, created_at)
values (
    gen_random_uuid(),
    'founder@yourdomain.in',
    'Founder',
    'superadmin',
    '$2a$10$REPLACE_WITH_REAL_HASH',
    now()
);
SQL
```

**b) API + invitation flow — preferred:** sign in once with `DEV_AUTH_AUTO_PROVISION=true` temporarily (you'll need NODE_ENV != production for one boot), promote yourself, then flip both back. Document the dance in your runbook; never leave the escape hatch open.

### 4.6 Reverse proxy + DNS + TLS

The compose override binds `api` and `web` to `127.0.0.1` only. Front them with TLS termination. Minimum Caddyfile:

```caddy
app.yourdomain.in {
    encode gzip zstd

    # /api → API container
    handle_path /api/* {
        reverse_proxy 127.0.0.1:4000 {
            header_up X-Real-IP {remote_host}
        }
    }

    # Everything else → SPA
    handle {
        reverse_proxy 127.0.0.1:8080
    }

    # Hardening at the edge — the SPA's nginx config sets the same
    # headers, but the edge takes precedence.
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options    "nosniff"
        Referrer-Policy           "strict-origin-when-cross-origin"
    }
}
```

Caddy auto-provisions Let's Encrypt certs on first request. For a Traefik / nginx-ingress setup, mirror the same path-based routing.

After DNS is live, smoke-test from a clean machine:
```bash
curl -I https://app.yourdomain.in/             # 200 OK, served by nginx
curl    https://app.yourdomain.in/api/health   # {"ok":true,...}
curl    https://app.yourdomain.in/api/ready    # {"ok":true,"checks":{"db":{"ok":true,...}}}
```

---

## 5. Rolling update procedure

The compose stack runs a single replica of each service, which means a naive `docker compose up -d --build` causes ~10 seconds of API downtime. Two improvements, in order of effort:

### 5.1 Zero-thought rolling update (with seconds of downtime)
```bash
cd /opt/lexdraft
git pull --ff-only
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
    up -d --build --remove-orphans
docker compose exec api node dist/scripts/migrate.js
docker image prune -f
```
For most early-stage deployments this is fine — the reverse proxy will retry, the user sees a half-second hiccup. Note: **migrations run AFTER the new container is healthy.** The API code is forwards-compatible across single-migration steps; do schema-breaking work in expand/contract pairs (separate PRs, separate deploys).

### 5.2 True zero-downtime (manual blue-green)
1. Bring up a second API replica on a different port (`docker run -d -p 4001:4000 ...` with the same env file).
2. Point the reverse proxy at both.
3. Drain the old one (`curl http://127.0.0.1:4000/api/ready` until it returns 503 after `docker stop --time=30`).
4. Promote and remove the old container.

If you find yourself doing this often, move to Kubernetes — at that point the cost-benefit flips. For < 100 customers, the seconds-of-downtime path is correct.

---

## 6. Backups and disaster recovery

### 6.1 Daily backup

Cron the included [`scripts/db-backup.sh`](./scripts/db-backup.sh) on the application host:

```cron
# /etc/cron.d/lexdraft-backup
MAILTO=ops@yourdomain.in
DATABASE_URL=postgresql://...
BACKUP_DIR=/var/backups/lexdraft
30 2 * * *  docker  /opt/lexdraft/scripts/db-backup.sh >> /var/log/lexdraft-backup.log 2>&1
```

The script keeps **14 daily snapshots** and **the first snapshot from each of the last 12 months** — a customer asking "what did our data look like on March 12 last year?" can be answered for a year, and the last fortnight is recoverable to within a day. Adjust `KEEP_DAILY` and `KEEP_MONTHLY` in the script if your retention policy is different.

Ship the backups off the application host. The cheapest correct answer:
```bash
# After the cron writes a backup, replicate to object storage.
aws s3 sync /var/backups/lexdraft s3://yourco-lexdraft-backups/ --storage-class STANDARD_IA
```
Run this from the same cron entry (chain with `&&`). Object-lock the bucket if you want immutable backups (ransomware concern).

### 6.2 Quarterly restore drill

**A backup you haven't tested is a wish, not a backup.** On a schedule — quarterly is the documented floor, monthly is better — run:

```bash
# On a non-prod host with read access to the backup bucket.
DATABASE_URL="postgresql://verify:pass@verify-pg/postgres" \
BACKUP_DIR=/tmp/lexdraft-backups \
    /opt/lexdraft/scripts/db-restore-verify.sh
```

This pulls the latest backup, restores it into a fresh database, replays migrations, runs a smoke query, and drops the temp DB. Exit 0 means the backup is valid. Wire the run into a monitoring check; a silent restore-drill failure is the same failure mode as a silent backup failure.

### 6.3 Uploads

`STORAGE_DRIVER=local` writes to the host's `./uploads` directory via the compose volume. **Back this up too** — pgdump only covers the database, not the files referenced by `documents.file_path`. A simple rsync to S3 every hour is the right call until you move storage to S3/R2 natively, at which point delete this paragraph.

---

## 7. Monitoring & operations

LexDraft is small enough that a hosted observability stack is overkill. The stated preference is self-hosted / no-telemetry; the recommended setup is:

| Concern         | Tool                              | Setup                                                            |
|-----------------|-----------------------------------|------------------------------------------------------------------|
| Uptime check    | [healthchecks.io](https://healthchecks.io) self-hosted | One check per host per hour, pinging `/api/ready`.    |
| Log shipping    | Vector → Loki (self-hosted)       | Vector reads `docker logs` and ships to a Loki instance on a different host. |
| Metrics         | Postgres exposes pg_stat_*; node_exporter on the host | Prometheus + Grafana, single VPS.                |
| Alerting        | Grafana Alerting → SMTP / Pushover| One channel.                                                     |

If you're not ready to run that, the floor is:
- A cron entry that `curl -fsS https://app.yourdomain.in/api/ready || mail -s "LexDraft down" ops@...`.
- `docker logs --since=24h api > /var/log/lexdraft/api-$(date -u +%F).log` rolled by logrotate.

### 7.1 Common operational tasks

```bash
# Force-reset a user's MFA (the user's TOTP device was lost).
docker compose exec postgres psql -U postgres lexdraft <<SQL
    update users set mfa_enrolled=false, mfa_secret=null
    where email='user@example.com';
SQL

# Run a one-off DPDP purge for a deletion request whose timer has expired.
# The service is wired at apps/api/src/services/dpdp.service.ts.
docker compose exec api node -e "
    const { dpdpService } = require('./dist/services/dpdp.service.js');
    dpdpService.sweep().then(() => process.exit(0));
"

# Rotate JWT_SECRET (signs every active user out — telegraph this).
$EDITOR /etc/lexdraft/api.env       # update JWT_SECRET
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart api

# Tail the live request log.
docker compose logs -f --tail=200 api | grep -v "/api/health"

# Inspect job queue (pg-boss tables live in the `pgboss` schema).
docker compose exec postgres psql -U postgres lexdraft -c \
    "select state, name, count(*) from pgboss.job group by 1,2 order by 3 desc;"
```

### 7.2 What to wake up for

| Symptom                                                         | Likely cause                                  |
|-----------------------------------------------------------------|-----------------------------------------------|
| `/api/ready` returns 503 with `db.ok=false`                     | Postgres unreachable or overloaded.           |
| 500s spike, logs full of `relation "..." does not exist`        | Deploy raced a migration. Run `db:migrate`.   |
| `helmet` rejects the SPA's requests                             | `CORS_ORIGINS` doesn't list the actual origin.|
| pg-boss queue growing without bound                             | Worker crashed. Restart the api container.    |

---

## 8. Open items the operator must decide

These are out of scope for the deployment scripts in this repo, but every production tenant needs an answer:

1. **Postgres**: pick a managed provider. Self-hosting Postgres for a SaaS is a job, not a checkbox.
2. **TLS termination**: pick Caddy / Traefik / nginx-ingress. Don't terminate TLS in the API.
3. **Backup destination**: an external object store with lifecycle rules.
4. **Log shipping**: at least file rotation; ideally Vector → Loki.
5. **Email provider**: needed for invitations, magic links, and DPDP notices. Resend / Postmark / SES.
6. **Secret manager**: someplace to store `/etc/lexdraft/api.env` that isn't a Slack DM.
7. **DPDP retention**: confirm the configured retention windows match your privacy policy. The service is in [`apps/api/src/services/dpdp.service.ts`](./apps/api/src/services/dpdp.service.ts).
8. **MFA enrolment policy**: when do you require it? The roadmap calls this out — see [`LEXDRAFT_ROADMAP.md`](./LEXDRAFT_ROADMAP.md).

---

## 9. Reference — files in this directory

| File                                                | Purpose                                                  |
|-----------------------------------------------------|----------------------------------------------------------|
| [`apps/api/Dockerfile`](./apps/api/Dockerfile)      | Multi-stage build for the API.                           |
| [`apps/web/Dockerfile`](./apps/web/Dockerfile)      | Multi-stage build for the SPA (nginx final stage).       |
| [`apps/web/nginx.conf`](./apps/web/nginx.conf)      | SPA fallback + cache headers + baseline security.        |
| [`docker-compose.yml`](./docker-compose.yml)        | Local dev stack.                                         |
| [`docker-compose.prod.yml`](./docker-compose.prod.yml) | Production overrides (binds to localhost, limits, secrets path). |
| [`apps/api/.env.docker`](./apps/api/.env.docker)    | Dev env file for docker-compose.                         |
| [`scripts/db-backup.sh`](./scripts/db-backup.sh)    | Daily backup with retention.                             |
| [`scripts/db-restore-verify.sh`](./scripts/db-restore-verify.sh) | Restore-drill harness — run quarterly.       |
| [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) | CI — typecheck, lint, test, build on every PR.       |
