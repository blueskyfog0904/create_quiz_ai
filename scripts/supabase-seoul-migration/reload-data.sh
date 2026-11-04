#!/usr/bin/env bash
# C-3 재적재(H-10(c) 실측도 같은 스크립트). 새 DB 데이터를 한 트랜잭션으로 비우고 LATEST의 data.sql을 다시 넣는다.
# 비우는 목록 = data.sql COPY 대상 전부 + H-1에서 뺀 auth 테이블. CASCADE 없음.
# 사용: bash <저장소>/scripts/supabase-seoul-migration/reload-data.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_workdir
load_config
d="$(latest_dump_dir)"
[ -s "$d/data.sql" ] && [ -s "$d/copy-tables.txt" ] || die "$d 에 data.sql·copy-tables.txt 가 없습니다"
read_db_password new
assert_connected_ref new

list_file="$d/truncate-tables.txt"
{ cat "$d/copy-tables.txt"
  for t in "${AUTH_EXCLUDED_TABLES[@]}"; do printf '"%s"."%s"\n' "${t%%.*}" "${t#*.}"; done
} | sort -u > "$list_file"
tables="$(cat "$list_file")"
printf '  비울 테이블 %s개 (%s)\n' "$(wc -l < "$list_file" | tr -d ' ')" "$list_file"

info "목록 검사(새 DB 기준): 모두 존재 + FK로 닫혀 있음(목록 안 테이블을 참조하는 테이블이 모두 목록에 있음)"
check="$(psql_new -At -v tables="$tables" -f - <<'SQL'
with l as (
  select to_regclass(x) as rel, x as name
    from unnest(string_to_array(:'tables', E'\n')) as x
)
select 'missing ' || name from l where rel is null
union all
select distinct 'not-closed ' || con.conrelid::regclass::text || ' -> ' || con.confrelid::regclass::text
  from pg_constraint con
 where con.contype = 'f'
   and con.confrelid in (select rel from l where rel is not null)
   and con.conrelid not in (select rel from l where rel is not null);
SQL
)"
[ -z "$check" ] || die "목록 검사 실패:
$check
(새 DB에만 있는 auth 테이블이 걸리면 그 테이블을 알려 주세요 — 계획 C-3)"

confirm_ref "$NEW_REF" "새 DB($NEW_REF)의 데이터를 비우고 $d/data.sql 로 다시 채웁니다"
truncate_sql="TRUNCATE $(paste -sd, "$list_file");"
t0=$(date +%s)
psql_new --single-transaction \
  -c 'SET session_replication_role = replica' \
  -c "$truncate_sql" \
  -f "$d/data.sql"
printf '  재적재 %s초\n' "$(( $(date +%s) - t0 ))"

info "확인(cron 0, 이력 그대로). 행 수·고아 행·해시는 AI가 verify SQL로"
psql_new -At -F ' | ' -c "
  select 'cron.job', count(*)::text from cron.job
  union all select 'migration 이력', count(*)::text || ' / 최신 ' || max(version) from supabase_migrations.schema_migrations
  union all select 'auth.users', count(*)::text from auth.users"
info "완료. AI에게 '재적재 끝'이라고 알려 주세요. 대시보드 디스크 사용량도 함께."
