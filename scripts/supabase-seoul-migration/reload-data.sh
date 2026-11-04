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

info "대상 확인(데이터 기준): 새 DB는 본 전환 C-7 전까지 cron 작업이 0개(옛 운영 DB는 꺼도 2개 남음)"
[ "$(psql_new -At -c 'select count(*) from cron.job')" = 0 ] || die "대상 DB에 cron 작업이 있습니다. 옛 운영 DB이거나 C-7 이후입니다. 진행하지 않습니다."

# 본 전환: 옛 DB를 얼린(freeze.sh old on) 뒤에 뜬 덤프인지 확인(C-2 덤프가 중간에 실패해 LATEST가 예전 것을 가리키는 경우 방지)
if [ -f freeze-old-at.txt ]; then
  newer="$(psql_new -At -v a="$(cat "$d/old-db-now-at-start.txt")" -v b="$(cat freeze-old-at.txt)" -f - <<'SQL'
select (:'a')::timestamptz > (:'b')::timestamptz;
SQL
)"
  [ "$newer" = t ] || die "LATEST 덤프($d)가 옛 DB 쓰기 중지(freeze-old-at.txt) 이전 것입니다. C-2(h1-dump.sh --data-only)를 다시 하세요."
else
  read -r -p "옛 DB 쓰기 중지 기록(freeze-old-at.txt)이 없습니다. 리허설(H-10)이면 rehearsal 입력(본 전환이면 멈추고 C-1부터): " mode
  [ "$mode" = rehearsal ] || die "본 전환은 freeze.sh old on(C-1) 뒤에 C-2 덤프를 하고 재적재하세요."
fi
history_before="$(psql_new -At -c "select count(*) || ' ' || coalesce(max(version), '') from supabase_migrations.schema_migrations")"

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

confirm_target new "데이터를 비우고 $d/data.sql(옛 DB 기준 덤프 시작 $(cat "$d/old-db-now-at-start.txt")) 로 다시 채웁니다"
truncate_sql="TRUNCATE $(paste -sd, "$list_file");"
t0=$(date +%s)
psql_new --single-transaction \
  -c 'SET session_replication_role = replica' \
  -c "$truncate_sql" \
  -f "$d/data.sql"
printf '  재적재 %s초\n' "$(( $(date +%s) - t0 ))"

info "확인(cron 0, 이력 그대로). 행 수·고아 행·해시는 AI가 verify SQL로"
[ "$(psql_new -At -c 'select count(*) from cron.job')" = 0 ] || die "재적재 뒤 cron 작업이 0개가 아닙니다"
history_after="$(psql_new -At -c "select count(*) || ' ' || coalesce(max(version), '') from supabase_migrations.schema_migrations")"
[ "$history_after" = "$history_before" ] || die "마이그레이션 이력이 바뀌었습니다: $history_before → $history_after"
printf '  cron.job 0, 이력 %s, auth.users %s\n' "$history_after" "$(psql_new -At -c 'select count(*) from auth.users')"
info "완료. AI에게 '재적재 끝'이라고 알려 주세요. 대시보드 디스크 사용량도 함께."
