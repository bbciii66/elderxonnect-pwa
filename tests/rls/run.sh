#!/usr/bin/env bash
# Runs the real database rules against a throwaway local Postgres. Needs postgres 16 binaries and the postgres OS user.
# Usage: tests/rls/run.sh   (as root or as the postgres user)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | tail -1)"; PORT=54329; DATA="$(mktemp -d)"; chmod 755 "$DATA"
cp "$root"/full-setup-v2.sql "$root"/care-circle-v2-migration.sql "$root"/care-circle-admin-migration.sql "$root"/push-alerts-migration.sql "$here"/setup.sql "$here"/tests.sql "$DATA"/
chown -R postgres "$DATA" 2>/dev/null || true
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -c "$*"; else bash -c "$*"; fi; }
as_pg "$PGBIN/initdb -D $DATA/db -A trust >/dev/null"
as_pg "$PGBIN/pg_ctl -D $DATA/db -o '-p $PORT -k $DATA' -l $DATA/log -w start >/dev/null"
trap 'as_pg "$PGBIN/pg_ctl -D $DATA/db -m immediate stop >/dev/null" || true; rm -rf "$DATA"' EXIT
psql_() { as_pg "$PGBIN/psql -h $DATA -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X $*"; }
psql_ "-d postgres -c 'create database exc'"
for f in setup full-setup-v2 care-circle-v2-migration care-circle-admin-migration push-alerts-migration; do psql_ "-d exc -f $DATA/$f.sql >/dev/null"; done
# The migrations must be safe to run twice.
for f in care-circle-v2-migration care-circle-admin-migration push-alerts-migration; do psql_ "-d exc -f $DATA/$f.sql >/dev/null"; done
psql_ "-d exc -f $DATA/tests.sql"
