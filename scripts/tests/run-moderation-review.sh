#!/usr/bin/env bash
set -euo pipefail
# No supplied database URLs, no existing cluster, no network PostgreSQL listener.
unset DATABASE_URL PROD_DB_URL PGHOSTADDR PGSERVICE PGPASSWORD FOUNDER_EMAIL FOUNDER_AUTH_USER_ID
root=$(mktemp -d /tmp/tastekin-moderation-review.XXXXXX)
mkdir "$root/socket" "$root/baseline"
git archive 59c73f43fc4e51861d5f1388ca1808ba7a637d01 lib/db/src/schema | tar -x -C "$root/baseline"
ln -s "$(pwd)/lib/db/node_modules" "$root/baseline/node_modules"
pnpm --filter @workspace/db exec drizzle-kit export --dialect=postgresql --schema="$root/baseline/lib/db/src/schema/*.ts" > "$root/legacy-export.log"
sed -n '/^CREATE /,$p' "$root/legacy-export.log" > "$root/legacy.sql"
pnpm --filter @workspace/db exec drizzle-kit export --dialect=postgresql --schema="./src/schema/*.ts" > "$root/current-export.log"
sed -n '/^CREATE /,$p' "$root/current-export.log" > "$root/current.sql"
test -s "$root/legacy.sql"
initdb -D "$root/cluster" --auth=trust --no-sync > "$root/init.log"
# Keep the postmaster inside this shell's lifecycle: detached pg_ctl processes
# may be reclaimed when a managed shell exits. Do not start a real app workflow.
postgres -D "$root/cluster" -c listen_addresses='' -k "$root/socket" -p 55439 > "$root/postgres.log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; rm -rf "$root"' EXIT
export PGHOST="$root/socket" PGPORT=55439 PGUSER="$(id -un)" PGDATABASE=postgres
for attempt in {1..30}; do
  if pg_isready -q; then break; fi
  sleep 0.1
done
pg_isready -q
test "$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT inet_server_addr() IS NULL AND current_setting('listen_addresses') = '' AND current_setting('data_directory') = '$root/cluster'")" = t
createdb moderation_review_fixture
PGDATABASE=moderation_review_fixture psql -X -v ON_ERROR_STOP=1 -f "$root/legacy.sql" > "$root/baseline.log"
env -i PATH="$PATH" HOME="$HOME" MODERATION_TEST_SOCKET_DIR="$root/socket" MODERATION_TEST_DB_NAME=moderation_review_fixture \
    node --experimental-strip-types --test scripts/tests/moderation.test.mjs scripts/tests/moderation-projections.test.mjs