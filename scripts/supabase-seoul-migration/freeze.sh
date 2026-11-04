#!/usr/bin/env bash
# 쓰기 중지·해제와 cron 끄기·켜기. H-10(a)(b)은 new, 본 전환 C-1·9절 되돌리기는 old.
# 사용:
#   freeze.sh <old|new> on        읽기 전용 + API·Auth·Storage·다른 postgres 연결 종료 + 확인(C-1 ③④⑤)
#   freeze.sh <old|new> off       읽기 전용 해제 + 연결 다시 종료(9절)
#   freeze.sh <old|new> status    설정과 남은 연결 보기
#   freeze.sh <old|new> cron-off  모든 cron 작업 비활성(C-1 ②) 후 확인
#   freeze.sh <old|new> cron-on <jobname>   지정한 작업 하나만 재활성(9절: http 먼저, 성공 확인 뒤 health)
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

which="${1:-}"; action="${2:-}"
[ "$which" = old ] || [ "$which" = new ] || die "첫 인자는 old 또는 new"
require_workdir
load_config
read_db_password "$which"
assert_connected_ref "$which"
if [ "$which" = old ]; then ref="$OLD_REF"; run() { psql_old "$@"; }; else ref="$NEW_REF"; run() { psql_new "$@"; }; fi

# 우리 세션은 읽기 전용 기본값의 영향을 받지 않게 한다(읽기 전용 상태에서 ALTER DATABASE가 막히므로).
RW='SET default_transaction_read_only = off;'
TERMINATE="
  select count(*) filter (where pg_terminate_backend(pid)) as terminated
    from pg_stat_activity
   where pid <> pg_backend_pid()
     and backend_type = 'client backend'
     and (usename in ('authenticator', 'supabase_auth_admin', 'supabase_storage_admin', 'pgbouncer')
          or usename = 'postgres')"
REMAINING="
  select usename, application_name, backend_start, (backend_start > \$\$__T__\$\$::timestamptz) as after_freeze
    from pg_stat_activity
   where pid <> pg_backend_pid()
     and backend_type = 'client backend'
     and usename not in (select rolname from pg_roles where rolsuper)
   order by backend_start"

case "$action" in
  on)
    confirm_ref "$ref" "[$which] DB를 읽기 전용으로 바꾸고 연결을 끊습니다"
    t="$(run -At -c "$RW" -c "select now()")"
    run -c "$RW" -c "ALTER DATABASE postgres SET default_transaction_read_only = true;"
    run -c "$RW" -c "$TERMINATE"
    sleep 3
    info "남은 연결(superuser 제외). after_freeze가 모두 t 이어야 함(③ 이후에 맺은 연결)"
    run -c "${REMAINING//__T__/$t}"
    bad="$(run -At -c "select count(*) from pg_stat_activity where pid <> pg_backend_pid() and backend_type = 'client backend' and usename not in (select rolname from pg_roles where rolsuper) and backend_start <= \$\$$t\$\$::timestamptz")"
    [ "$bad" = 0 ] || die "읽기 전용 이전에 맺은 연결이 $bad 개 남았습니다. 다시 'on'을 실행하세요."
    info "읽기 전용 확인: $(run -At -c 'show default_transaction_read_only')"
    ;;
  off)
    confirm_ref "$ref" "[$which] DB 읽기 전용을 해제합니다"
    run -c "$RW" -c "ALTER DATABASE postgres RESET default_transaction_read_only;"
    run -c "$TERMINATE"
    info "새 연결 기준 읽기 전용: $(run -At -c 'show default_transaction_read_only') (off 이어야 함)"
    ;;
  status)
    info "읽기 전용(새 연결 기준): $(run -At -c 'show default_transaction_read_only')"
    run -c "select usename, application_name, backend_start, state from pg_stat_activity where pid <> pg_backend_pid() and backend_type = 'client backend' order by backend_start"
    run -c "select jobname, schedule, active from cron.job order by jobname"
    ;;
  cron-off)
    confirm_ref "$ref" "[$which] cron 작업을 모두 끕니다"
    run -c "$RW" -c "select cron.alter_job(job_id := jobid, active := false) from cron.job"
    run -c "select jobname, active from cron.job order by jobname"
    [ "$(run -At -c 'select count(*) from cron.job where active')" = 0 ] || die "켜진 cron 작업이 남았습니다"
    ;;
  cron-on)
    job="${3:-}"; [ -n "$job" ] || die "cron-on 뒤에 jobname을 주세요"
    confirm_ref "$ref" "[$which] cron 작업 $job 을 켭니다"
    n="$(run -At -v job="$job" -c "$RW" -f - <<'SQL'
select count(*) from (select cron.alter_job(job_id := jobid, active := true) from cron.job where jobname = :'job') x;
SQL
)"
    [ "$n" = 1 ] || die "jobname '$job' 인 작업이 정확히 1개가 아닙니다($n)"
    run -c "select jobname, active from cron.job order by jobname"
    ;;
  *) die "두 번째 인자: on | off | status | cron-off | cron-on <jobname>" ;;
esac
