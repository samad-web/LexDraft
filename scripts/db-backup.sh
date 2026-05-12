#!/usr/bin/env bash
#
# LexDraft — Postgres backup, retention-aware.
#
# Dumps the database pointed at by $DATABASE_URL to $BACKUP_DIR using
# `pg_dump --format=custom --compress=9` (the format that `pg_restore`
# wants — schema + data with parallelisable restore).
#
# Retention:
#   - Daily snapshots are kept for the last 14 days.
#   - The FIRST snapshot taken in each calendar month is kept as the
#     monthly snapshot; the last 12 of those are kept indefinitely.
#   - Anything that's neither among the most-recent 14 dailies nor among
#     the most-recent 12 monthlies is deleted.
#
# Exit codes:
#     0 — backup succeeded and retention prune ran clean.
#   !=0 — anything else. Stderr carries the failure. Wire this into a
#         monitoring check (Prometheus textfile, healthcheck.io, an
#         emailed cron MAILTO) so a silent failure is loud.
#
# Cron suggestion (UTC, daily 02:30):
#   30 2 * * *  /opt/lexdraft/scripts/db-backup.sh >> /var/log/lexdraft-backup.log 2>&1

set -euo pipefail
IFS=$'\n\t'

# ─── Config ────────────────────────────────────────────────────────────
: "${DATABASE_URL:?DATABASE_URL must be set (postgresql://... URI)}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"

mkdir -p "$BACKUP_DIR"

# ─── Dump ──────────────────────────────────────────────────────────────
ts="$(date -u +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/lexdraft-$ts.pgc"

echo "[$(date -u +%FT%TZ)] backup → $out"

# --format=custom gives us a binary archive that `pg_restore --jobs` can
# parallelise. --compress=9 trades CPU for disk. --no-owner / --no-acl
# means the dump replays cleanly into a fresh database whose role names
# differ from prod.
pg_dump \
    --dbname="$DATABASE_URL" \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-acl \
    --file="$out.partial"

# Atomic rename — a half-written .pgc never enters the rotation set.
mv "$out.partial" "$out"
size="$(stat -c '%s' "$out" 2>/dev/null || wc -c < "$out")"
echo "[$(date -u +%FT%TZ)] wrote $out ($size bytes)"

# ─── Retention ─────────────────────────────────────────────────────────
# Daily set: the most recent KEEP_DAILY files by filename. Filenames sort
# chronologically because of the %Y%m%d-%H%M%S stamp.
mapfile -t all_backups < <(
    find "$BACKUP_DIR" -maxdepth 1 -type f -name 'lexdraft-*.pgc' -printf '%f\n' \
    | sort -r
)

declare -A keep
daily_kept=0
for f in "${all_backups[@]}"; do
    if (( daily_kept < KEEP_DAILY )); then
        keep["$f"]=1
        daily_kept=$(( daily_kept + 1 ))
    fi
done

# Monthly set: scan oldest → newest and keep the FIRST backup we see for
# each YYYYMM. Bash hash tracks "have we seen this month yet?".
declare -A month_seen
declare -a monthly_keepers
for f in $(printf '%s\n' "${all_backups[@]}" | sort); do
    # filename pattern: lexdraft-YYYYMMDD-HHMMSS.pgc
    yyyymm="${f:9:6}"
    if [[ -z "${month_seen[$yyyymm]:-}" ]]; then
        month_seen[$yyyymm]=1
        monthly_keepers+=("$f")
    fi
done

# Now keep the LAST KEEP_MONTHLY monthly keepers.
total_monthly="${#monthly_keepers[@]}"
start=$(( total_monthly - KEEP_MONTHLY ))
(( start < 0 )) && start=0
for (( i = start; i < total_monthly; i++ )); do
    keep["${monthly_keepers[$i]}"]=1
done

# Prune anything not in the keep set.
pruned=0
for f in "${all_backups[@]}"; do
    if [[ -z "${keep[$f]:-}" ]]; then
        echo "[$(date -u +%FT%TZ)] prune $f"
        rm -f -- "$BACKUP_DIR/$f"
        pruned=$(( pruned + 1 ))
    fi
done

echo "[$(date -u +%FT%TZ)] retention: kept ${#keep[@]} (daily ≤${KEEP_DAILY}, monthly ≤${KEEP_MONTHLY}), pruned $pruned"
echo "[$(date -u +%FT%TZ)] done"
