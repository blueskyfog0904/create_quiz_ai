#!/usr/bin/env bash
# 쓰기 중지·해제와 cron 끄기·켜기. H-10(a)(b)은 new, 본 전환 C-1·9절 되돌리기는 old.
# 사용:
#   freeze.sh <old|new> on        읽기 전용 + superuser가 아닌 연결 모두 종료 + 확인(C-1 ③④⑤)
#   freeze.sh <old|new> off       읽기 전용 해제 + 연결 다시 종료 + 확인(9절)
#   freeze.sh <old|new> status    설정과 남은 연결 보기
#   freeze.sh <old|new> cron-off  모든 cron 작업 비활성(C-1 ②) 후 확인
#   freeze.sh <old|new> cron-on <jobname>   지정한 작업 하나만 재활성(9절: http 먼저, 성공 확인 뒤 health)
# 주의: DB 기본값 읽기 전용은 PostgREST처럼 트랜잭션을 READ WRITE로 여는 쓰기는 막지 못할 수 있다(H-10(a)에서 실측).
#       본 전환에서는 Vercel Firewall(C-1 ①)이 입구를 막고, C-8에서 옛 DB 스냅샷을 비교한다.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

which="${1:-}"; action="${2:-}"
[ "$which" = old ] || [ "$which" = new ] || die "첫 인자는 old 또는 new"
require_workdir
load_config
read_db_password "$which"
assert_connected_ref "$which"
if [ "$which" = old ]; then run() { psql_old "$@"; }; else run() { psql_new "$@"; }; fi
marker="freeze-$which-at.txt"

# 우리 세션은 읽기 전용 기본값의 영향을 받지 않게 한다(읽기 전용 상태에서 ALTER DATABASE가 막히므로).
RW='SET default_transaction_read_only = off;'
NON_SUPER="backend_type = 'client backend' and usename not in (select rolname from pg_roles where rolsuper)"
TERMINATE="select count(*) filter (where pg_terminate_backend(pid)) as terminated
             from pg_stat_activity where pid <> pg_backend_pid() and $NON_SUPER"
# DB에 저장된 설정(새 연결이 받는 기본값)으로 판정한다(show는 재사용된 연결의 값을 보여 줄 수 있음)
STORED="select exists (select 1 from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase
                        where s.setrole = 0 and d.datname = 'postgres'
                          and 'default_transaction_read_only=true' = any (s.setconfig))"

# 기준 시각 t 이전에 맺은 연결(자기 연결 포함)이 없을 때까지 끊고 다시 확인한다.
# 자기 연결이 오래된 것(풀에서 재사용)이면 스스로 끊고 새 연결로 다시 본다.
verify_after() {
  local t="$1" try row others self
  for try in 1 2 3; do
    row="$(run -At -F ' ' -v t="$t" -f - <<SQL
select count(*) filter (where pid <> pg_backend_pid() and backend_start <= (:'t')::timestamptz),
       coalesce(bool_or(pid = pg_backend_pid() and backend_start <= (:'t')::timestamptz), false)
  from pg_stat_activity where $NON_SUPER;
SQL
)"
    others="${row%% *}"; self="${row##* }"
    if [ "$others" = 0 ] && [ "$self" = f ]; then return 0; fi
    printf '  기준 시각 이전 연결: 다른 연결 %s개, 자기 연결 오래됨=%s → 다시 끊음(%s/3)\n' "$others" "$self" "$try"
    run -c "$RW" -c "$TERMINATE" >/dev/null
    [ "$self" = t ] && { run -c "select pg_terminate_backend(pg_backend_pid())" >/dev/null 2>&1 || true; }
    sleep 2
  done
  die "기준 시각 이전 연결이 남았습니다. '$action'을 다시 실행하세요."
}

case "$action" in
  on)
    confirm_target "$which" "DB를 읽기 전용으로 바꾸고 superuser가 아닌 연결을 모두 끊습니다"
    # ALTER가 커밋된 뒤의 시각을 같은 세션에서 잡는다(계획 C-1 ⑤)
    t="$(run -At -c "$RW" -c "ALTER DATABASE postgres SET default_transaction_read_only = true;" -c "select clock_timestamp()")"
    printf '%s\n' "$t" > "$marker"
    run -c "$RW" -c "$TERMINATE"
    sleep 3
    verify_after "$t"
    [ "$(run -At -c "$STORED")" = t ] || die "DB 설정에 읽기 전용이 저장되지 않았습니다"
    info "읽기 전용 확인 완료(기준 시각 $t, $marker). 남은 연결은 모두 그 뒤에 맺은 것"
    run -c "select usename, application_name, backend_start from pg_stat_activity where $NON_SUPER order by backend_start"
    ;;
  off)
    confirm_target "$which" "DB 읽기 전용을 해제하고 연결을 다시 끊습니다"
    t="$(run -At -c "$RW" -c "ALTER DATABASE postgres RESET default_transaction_read_only;" -c "select clock_timestamp()")"
    run -c "$TERMINATE"
    sleep 3
    verify_after "$t"
    [ "$(run -At -c "$STORED")" = f ] || die "DB 설정에 읽기 전용이 남아 있습니다"
    rm -f "$marker"
    info "읽기 전용 해제 확인 완료(기준 시각 $t). 9절이면 다음은 쓰기 시험(대표 로그인 → AI가 last_sign_in_at 확인)"
    ;;
  status)
    info "DB 설정 읽기 전용: $(run -At -c "$STORED")"
    run -c "select usename, application_name, backend_start, state from pg_stat_activity where backend_type = 'client backend' order by backend_start"
    run -c "select jobname, schedule, active from cron.job order by jobname"
    ;;
  cron-off)
    confirm_target "$which" "cron 작업을 모두 끕니다"
    run -c "$RW" -c "select cron.alter_job(job_id := jobid, active := false) from cron.job"
    run -c "select jobname, active from cron.job order by jobname"
    [ "$(run -At -c 'select count(*) from cron.job where active')" = 0 ] || die "켜진 cron 작업이 남았습니다"
    ;;
  cron-on)
    job="${3:-}"; [ -n "$job" ] || die "cron-on 뒤에 jobname을 주세요"
    confirm_target "$which" "cron 작업 $job 을 켭니다"
    n="$(run -At -v job="$job" -c "$RW" -f - <<'SQL'
select count(*) from (select cron.alter_job(job_id := jobid, active := true) from cron.job where jobname = :'job') x;
SQL
)"
    [ "$n" = 1 ] || die "jobname '$job' 인 작업이 정확히 1개가 아닙니다($n)"
    run -c "select jobname, active from cron.job order by jobname"
    ;;
  *) die "두 번째 인자: on | off | status | cron-off | cron-on <jobname>" ;;
esac
