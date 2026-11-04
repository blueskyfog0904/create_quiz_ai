#!/usr/bin/env bash
# H-3 기본 권한 회수 → H-4 복원 → H-5 기본 권한 원복·auth 트리거. 대상은 새(서울) DB뿐이다.
# 사용: bash <저장소>/scripts/supabase-seoul-migration/h3-h5-restore.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_workdir
load_config
d="$(latest_dump_dir)"
for f in roles.sql schema.sql data.sql history_schema.sql history_data.sql auth-triggers.sql; do
  [ -s "$d/$f" ] || die "$d/$f 가 없습니다. 전체 덤프(h1-dump.sh, --data-only 아님)가 LATEST여야 합니다."
done
read_db_password new
assert_connected_ref new

info "새 DB가 비어 있는지 확인(두 번 실행·옛 DB 대상 실수 방지)"
counts="$(psql_new -At -c "
  select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p','v','m'))
       || ' ' || (select count(*) from auth.users)")"
[ "$counts" = "0 0" ] || die "새 DB가 비어 있지 않습니다(public 객체 수, auth.users 수 = $counts). 재리허설이면 계획 4절대로 새 프로젝트를 다시 만드세요."
confirm_ref "$NEW_REF" "새 DB($NEW_REF)에 덤프 $d 를 복원합니다"

info "H-3 기본 권한 회수"
psql_new -c "
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;"

info "H-4 복원(한 트랜잭션, 오류 시 전부 롤백)"
t0=$(date +%s)
psql_new --single-transaction \
  -f "$d/roles.sql" \
  -f "$d/schema.sql" \
  -c 'SET session_replication_role = replica' \
  -f "$d/data.sql"
psql_new --single-transaction -f "$d/history_schema.sql" -f "$d/history_data.sql"
psql_new -c 'DROP ROLE IF EXISTS cli_login_postgres;'
printf '  복원 %s초\n' "$(( $(date +%s) - t0 ))"

info "H-5 기본 권한 원복·auth 트리거"
psql_new -c "
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;"
psql_new --single-transaction -f "$d/auth-triggers.sql"

info "요약(자세한 비교는 AI가 verify SQL로)"
psql_new -At -F ' | ' -c "
  select 'public 테이블', count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')
  union all select 'auth.users', count(*) from auth.users
  union all select 'migration 이력', count(*) from supabase_migrations.schema_migrations
  union all select 'cron.job', count(*) from cron.job"
info "완료. AI에게 'H-4 끝'이라고 알려 주세요(V-1~V-6 검증). 대시보드 Database → Settings에서 디스크 사용량도 알려 주세요."
