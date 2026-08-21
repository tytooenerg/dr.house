#!/usr/bin/env bash
# Applies every translated migration in server/src/db/migrations-postgres/ to a real,
# throwaway Postgres database via psql, in filename order, and fails loudly on the first
# statement that isn't valid Postgres — not a hand-review, an actual apply against a real
# server. Requires a reachable Postgres (PGHOST/PGPORT/PGUSER/PGPASSWORD env vars, or the
# defaults below for a local trust-auth instance) and generate-schema.mjs already run.
set -euo pipefail

PGHOST="${PGHOST:-/var/run/postgresql}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
DB_NAME="lastro_schema_check_$$"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../server/src/db/migrations-postgres" && pwd)"

echo "Creating throwaway database $DB_NAME on $PGHOST:$PGPORT ..."
createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$DB_NAME"
trap 'echo "Dropping $DB_NAME ..."; dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$DB_NAME"' EXIT

count=0
for f in "$DIR"/*.sql; do
  echo "Applying $(basename "$f") ..."
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -f "$f"
  count=$((count + 1))
done

echo "OK — $count migration(s) applied cleanly to a real Postgres 16 database."
echo "Tables created:"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB_NAME" -c "\dt" || true
