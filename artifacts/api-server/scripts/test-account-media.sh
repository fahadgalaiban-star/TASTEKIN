#!/usr/bin/env bash
set -euo pipefail
# Never inherit the project's credentials. This script always provisions its
# own Unix-socket-only cluster, and cannot accept a caller's DATABASE_URL.
if [ "${ACCOUNT_MEDIA_TEST_ISOLATED:-}" != "1" ]; then
  exec env -i PATH="$PATH" HOME=/tmp ACCOUNT_MEDIA_TEST_ISOLATED=1 bash "$0"
fi
repo=$(cd "$(dirname "$0")/../../.." && pwd)
root=$(mktemp -d /tmp/tastekin-account-media.XXXXXX)
postgres_pid=''
cleanup() {
  if [ -n "$postgres_pid" ]; then
    kill "$postgres_pid" 2>/dev/null || true
    wait "$postgres_pid" 2>/dev/null || true
  fi
  rm -rf -- "$root"
}
trap cleanup EXIT
mkdir "$root/socket"
initdb -D "$root/cluster" --username=media_test --auth=trust --no-sync > "$root/init.log"
postgres -D "$root/cluster" -c listen_addresses='' -k "$root/socket" -p 55463 > "$root/postgres.log" 2>&1 &
postgres_pid=$!
export PGHOST="$root/socket" PGPORT=55463 PGUSER=media_test PGDATABASE=postgres
for attempt in {1..50}; do if pg_isready -q; then break; fi; sleep .1; done
pg_isready -q
test "$(psql -X -At -v ON_ERROR_STOP=1 -c "SELECT inet_server_addr() IS NULL AND current_setting('listen_addresses') = '' AND current_setting('data_directory') = '$root/cluster'")" = t
createdb account_media_fixture
cd "$repo"
pnpm --filter @workspace/db exec drizzle-kit export --dialect=postgresql --schema='./src/schema/*.ts' > "$root/schema-export.log"
sed -n '/^CREATE /,$p' "$root/schema-export.log" > "$root/schema.sql"
test -s "$root/schema.sql"
PGDATABASE=account_media_fixture psql -X -v ON_ERROR_STOP=1 -f "$root/schema.sql" > "$root/schema-load.log"
export DATABASE_URL="postgresql:///account_media_fixture?host=$root/socket&port=55463&user=media_test"
export PRIVATE_OBJECT_DIR="/mock-bucket/private"
export ACCOUNT_MEDIA_TEST_ROOT="$root"
ln -s "$repo/scripts/node_modules" "$root/node_modules"
node --input-type=module <<'JS'
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.join(process.cwd(), 'artifacts/api-server/package.json'));
await require('esbuild').build({
  entryPoints: ['artifacts/api-server/scripts/test-account-media.ts'],
  outfile: path.join(process.env.ACCOUNT_MEDIA_TEST_ROOT, 'test.mjs'),
  bundle: true, platform: 'node', format: 'esm', external: ['pg', 'sharp'],
  banner: { js: "import { createRequire } from 'node:module'; globalThis.require = createRequire(import.meta.url);" },
});
JS
node --test "$root/test.mjs"
printf '\nDisposable-only tests finished; temporary cluster and files will be removed.\n'
