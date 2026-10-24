#!/usr/bin/env bash
# Disposable-only PostgreSQL logical backup/restore rehearsal.
set -euo pipefail
umask 077
[[ "$CI_SUPPORT_SYNTHETIC" == "1" && "$NODE_ENV" == "test" &&
    "$V79_SUPPORT_DESK_ENABLED" == "0" ]] || {
 echo "RECOVERY=REFUSED_NOT_SYNTHETIC" >&2; exit 1;
}
[[ "$DATABASE_URL" == "postgresql://support_test:support_test_password@127.0.0.1:5432/tiquet_support_test" ]] || {
 echo "RECOVERY=REFUSED_DATABASE_MISMATCH" >&2; exit 1;
}
for cmd in pg_dump pg_restore psql createdb dropdb; do
 command -v "$cmd" >/dev/null || { echo "RECOVERY=STOP_CLIENT_MISSING_$cmd" >&2; exit 1; }
done
export PGPASSWORD=support_test_password
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=support_test
source_db=tiquet_support_test
restore_db=tiquet_support_restore_test
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"; dropdb --if-exists "$restore_db" >/dev/null 2>&1 || true' EXIT
dropdb --if-exists "$restore_db"
pg_dump --format=custom --no-owner --no-acl -d "$source_db" -f "$tmp/synthetic.dump"
test -s "$tmp/synthetic.dump"
createdb "$restore_db"
pg_restore --no-owner --no-acl --exit-on-error --single-transaction \
 -d "$restore_db" "$tmp/synthetic.dump"
for tbl in support_tickets support_messages support_outbox support_sla_records \
 support_agent_presence support_synthetic_alerts support_automation_receipts \
 support_mail_ingest support_mail_references; do
 source_count="$(psql -X -At -d "$source_db" -c "SELECT count(*) FROM $tbl")"
 restored_count="$(psql -X -At -d "$restore_db" -c "SELECT count(*) FROM $tbl")"
 [[ "$source_count" == "$restored_count" ]] || {
  echo "RECOVERY=STOP_TABLE_COUNT_MISMATCH_$tbl" >&2;exit 1;
 }
done
fk_count="$(psql -X -At -d "$restore_db" -c \
 "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace")"
[[ "$fk_count" =~ ^[0-9]+$ && "$fk_count" -ge 10 ]] || {
 echo "RECOVERY=STOP_CONSTRAINTS_MISSING" >&2;exit 1;
}
source_ticket_ids="$(psql -X -At -d "$source_db" -c \
 "SELECT string_agg(id,'|' ORDER BY id) FROM support_tickets WHERE account_id='demoA'")"
restored_ticket_ids="$(psql -X -At -d "$restore_db" -c \
 "SELECT string_agg(id,'|' ORDER BY id) FROM support_tickets WHERE account_id='demoA'")"
[[ "$source_ticket_ids" == "$restored_ticket_ids" ]] || {
 echo "RECOVERY=STOP_TICKET_ID_MISMATCH" >&2;exit 1;
}
echo "SUPPORT_P5_DISPOSABLE_LOGICAL_BACKUP_RESTORE=PASS"
echo "RECOVERY_SOURCE=LOCAL_SYNTHETIC_ONLY"
echo "RECOVERY_RESTORED_TENANT_SCOPED_TICKET_IDS=PASS"
