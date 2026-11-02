#!/usr/bin/env bash
# Disposable PG16-only portal test. Never connects to live V79 databases.
set -Eeuo pipefail
umask 077
REPO="/home/firelion/v79-phase4-20261101/V79Tiquet"
BIN="/home/firelion/v79-recovery-lab/2026-10-09/rootfs/usr/lib/postgresql/16/bin"
SHARE="/home/firelion/v79-recovery-lab/2026-10-09/rootfs/usr/share/postgresql/16"
SCRATCH="$(mktemp -d /home/firelion/v79-recovery-lab/weekly/phase4-portal-XXXXXXXX)"
DATA="$SCRATCH/pg"
SOCKET="$SCRATCH/socket"
PORT=55583
cleanup() {
  result=$?
  if [[ -f "$DATA/postmaster.pid" ]]; then
    "$BIN/pg_ctl" -D "$DATA" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  case "$SCRATCH" in /home/firelion/v79-recovery-lab/weekly/phase4-portal-*) rm -rf -- "$SCRATCH";; esac
  exit "$result"
}
trap cleanup EXIT
mkdir -m 700 "$SOCKET"
"$BIN/initdb" -D "$DATA" -L "$SHARE" -U firelion --auth-local=peer --auth-host=reject --encoding=UTF8 --locale=C --no-instructions >/dev/null
"$BIN/pg_ctl" -D "$DATA" -l "$SCRATCH/server.log" -o "-c listen_addresses='' -c unix_socket_directories=$SOCKET -c port=$PORT -c max_connections=14" -w start >/dev/null
export PGHOST="$SOCKET" PGPORT="$PORT" PGUSER=firelion PGDATABASE=portal_test
"/usr/lib/postgresql/16/bin/createdb" --template=template0 --encoding=UTF8 --locale=C portal_test
"/usr/lib/postgresql/16/bin/psql" -X -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE TABLE accounts (id TEXT PRIMARY KEY, status TEXT NOT NULL);
CREATE TABLE clients (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
 name TEXT NOT NULL, email TEXT NOT NULL, createdat TEXT NOT NULL,
 newsletteroptin INTEGER NOT NULL DEFAULT 0, leadsource TEXT, leadstatus TEXT
);
CREATE TABLE jobs (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL,
 createdat TEXT NOT NULL, priority TEXT NOT NULL, client TEXT NOT NULL,
 clientemail TEXT, clientid TEXT REFERENCES clients(id), account_id TEXT NOT NULL REFERENCES accounts(id),
 intakeeventid TEXT UNIQUE, amount DOUBLE PRECISION
);
SQL
"/usr/lib/postgresql/16/bin/psql" -X -v ON_ERROR_STOP=1 -f "$REPO/server/customerPortalSelfService.schema.sql" >/dev/null
cd "$REPO"
export V79_PORTAL_TEST_DATABASE_URL="postgresql:///portal_test?host=$(python3 -c 'import os,urllib.parse;print(urllib.parse.quote(os.environ["PGHOST"],safe=""))')&port=$PORT&user=firelion"
node --test tests/customerPortalSelfService.test.js
echo 'PHASE4_PORTAL_DISPOSABLE_POSTGRES=PASS'
echo 'LIVE_DATABASE_MUTATIONS=NONE'
echo 'NETWORK_LISTENING=DISABLED'
