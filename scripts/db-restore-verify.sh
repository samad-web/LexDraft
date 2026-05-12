#!/usr/bin/env bash
#
# LexDraft — restore-verify drill.
#
# Validates the backup pipeline end-to-end:
#   1. Pick the newest *.pgc in $BACKUP_DIR.
#   2. Create a fresh temporary database on the same server.
#   3. pg_restore the backup into it.
#   4. Apply outstanding migrations (catches "backup is older than
#      schema" drift).
#   5. Run a smoke query (`select count(*) from users`) — proves the
#      schema is present and queryable.
#   6. Drop the temp database (idempotent — runs even on failure via trap).
#
# A green run does NOT guarantee app-level correctness; it does
# guarantee the backup is parseable and the schema replays. Run on a
# schedule (quarterly is the documented minimum — see DEPLOYMENT.md).
#
# Required env:
#   DATABASE_URL    — admin URI for the SAME cluster the backups came
#                     from. The script swaps the database name to a
#                     temp one; it does NOT touch prod data.
#   BACKUP_DIR      — defaults to /backups.
#
# Optional env:
#   PGBOSS_SKIP=1   — skip if you don't have an api container handy to
#                     run migrations from. The schema replay still
#                     verifies the dump itself.
#   API_MIGRATE_CMD — override the migration command. Default:
#                     `docker compose exec -T api node dist/scripts/migrate.js`

set -euo pipefail
IFS=$'\n\t'

: "${DATABASE_URL:?DATABASE_URL must be set (admin URI for the cluster)}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
API_MIGRATE_CMD="${API_MIGRATE_CMD:-docker compose exec -T api node dist/scripts/migrate.js}"

ts="$(date -u +%Y%m%d-%H%M%S)"
tmp_db="lexdraft_restore_verify_$ts"

# ─── Locate the newest backup ──────────────────────────────────────────
latest="$(
    find "$BACKUP_DIR" -maxdepth 1 -type f -name 'lexdraft-*.pgc' \
    | sort -r \
    | head -n 1
)"

if [[ -z "$latest" ]]; then
    echo "FAIL: no lexdraft-*.pgc backup found in $BACKUP_DIR" >&2
    exit 1
fi
echo "[$(date -u +%FT%TZ)] verifying $latest → $tmp_db"

# ─── Derive an admin URI we can use to create/drop the temp database ──
# The DATABASE_URL likely points at a specific DB; we need to connect to
# `postgres` (the maintenance DB) to issue CREATE/DROP.
admin_uri="$(printf '%s' "$DATABASE_URL" | sed -E 's#(postgres(ql)?://[^/]+/)[^?]+#\1postgres#')"
restore_uri="$(printf '%s' "$DATABASE_URL" | sed -E "s#(postgres(ql)?://[^/]+/)[^?]+#\\1$tmp_db#")"

# ─── Cleanup trap — always drop the temp DB, even on failure ──────────
cleanup() {
    rc=$?
    echo "[$(date -u +%FT%TZ)] cleanup: dropping $tmp_db (script rc=$rc)"
    psql "$admin_uri" -v ON_ERROR_STOP=1 -c \
        "drop database if exists \"$tmp_db\" with (force);" \
        >/dev/null 2>&1 || true
    exit $rc
}
trap cleanup EXIT INT TERM

# ─── 1. Create the temp DB ────────────────────────────────────────────
psql "$admin_uri" -v ON_ERROR_STOP=1 -c "create database \"$tmp_db\";"

# ─── 2. Restore ───────────────────────────────────────────────────────
# --no-owner / --no-acl ignore ownership clauses (the backup may carry a
# role that doesn't exist on the verifier host). --exit-on-error is the
# important one — without it pg_restore swallows individual errors and
# returns 0.
pg_restore \
    --dbname="$restore_uri" \
    --no-owner --no-acl \
    --exit-on-error \
    "$latest"

# ─── 3. Run migrations against the restored DB ────────────────────────
if [[ "${PGBOSS_SKIP:-}" != "1" ]]; then
    echo "[$(date -u +%FT%TZ)] applying migrations via: $API_MIGRATE_CMD"
    # The migrate script reads DATABASE_URL from its env, so we have to
    # pipe through whatever runner the operator uses. `env -S` keeps
    # DATABASE_URL scoped to this one invocation.
    DATABASE_URL="$restore_uri" bash -c "$API_MIGRATE_CMD"
fi

# ─── 4. Smoke query ───────────────────────────────────────────────────
# `users` is the most central table in the schema (every other tenant
# row joins through it). Counting rows proves the table exists and is
# readable; the exact count doesn't matter.
echo "[$(date -u +%FT%TZ)] smoke query: select count(*) from users"
psql "$restore_uri" -v ON_ERROR_STOP=1 -tA -c "select count(*) from users" \
    | tee /dev/stderr \
    | grep -qE '^[0-9]+$'

echo "[$(date -u +%FT%TZ)] PASS — restore verified from $latest"
# trap will drop $tmp_db and exit with the success code.
