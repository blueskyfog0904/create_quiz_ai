#!/usr/bin/env bash
# H-1 덤프(옛 DB) + H-2 덤프 손질. 본 전환 C-2는 --data-only 로 data.sql만 다시 뜬다.
# 사용: bash <저장소>/scripts/supabase-seoul-migration/h1-dump.sh [--data-only]
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DATA_ONLY=0
[ "${1:-}" = "--data-only" ] && DATA_ONLY=1

require_workdir
load_config
read_db_password old
assert_connected_ref old

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="dumps/$stamp"
mkdir -p "$out/dryrun"
info "덤프 폴더: $out"

started_at="$(psql_old -At -c "select now()")"
printf '%s\n' "$started_at" > "$out/old-db-now-at-start.txt"

exclude_args=()
for t in "${AUTH_EXCLUDED_TABLES[@]}"; do exclude_args+=(-x "$t"); done

# 이름, CLI 인자... 순서. 먼저 dry-run으로 실제 pg_dump 인자를 (비밀번호를 가린 채) 남기고 실행한다.
dump() {
  local name="$1"; shift
  PGPASSWORD="$OLD_PW" supabase db dump --agent no --remote="$OLD_DB_URL" "$@" --dry-run 2>&1 | redact > "$out/dryrun/$name.sh"
  grep -q 'PGPASSWORD=<redacted>' "$out/dryrun/$name.sh" || die "$name dry-run 출력에서 비밀번호 줄을 찾지 못했습니다(가림 확인 실패). $out/dryrun/$name.sh 를 열지 말고 삭제한 뒤 알려 주세요."
  PGPASSWORD="$OLD_PW" supabase db dump --agent no --remote="$OLD_DB_URL" "$@" -f "$out/$name.sql"
  [ -s "$out/$name.sql" ] || die "$name.sql 이 비었습니다"
  printf '  %-16s %10s bytes\n' "$name.sql" "$(wc -c < "$out/$name.sql" | tr -d ' ')"
}

if [ "$DATA_ONLY" = 0 ]; then
  dump roles --role-only
  dump schema
  dump history_schema --schema supabase_migrations
  dump history_data --data-only --use-copy --schema supabase_migrations
fi
dump data --data-only --use-copy --schema public,auth "${exclude_args[@]}"

info "data.sql COPY 대상 목록 검사"
grep -E '^COPY ' "$out/data.sql" | sed -E 's/^COPY ("[^"]+"\."[^"]+").*/\1/' > "$out/copy-tables.txt"
printf '  COPY 대상 %s개 (목록: %s/copy-tables.txt)\n' "$(wc -l < "$out/copy-tables.txt" | tr -d ' ')" "$out"
bad="$(grep -E '^"(cron|net|vault|storage|supabase_migrations)"\.|^"auth"\."schema_migrations"$' "$out/copy-tables.txt" || true)"
[ -z "$bad" ] || die "들어가면 안 되는 테이블이 COPY 대상에 있습니다: $bad"
for t in "${AUTH_EXCLUDED_TABLES[@]}"; do
  q="\"${t%%.*}\".\"${t#*.}\""
  ! grep -qxF "$q" "$out/copy-tables.txt" || die "제외해야 할 $t 가 COPY 대상에 있습니다"
done
grep -qxF '"auth"."users"' "$out/copy-tables.txt" || die "auth.users 가 COPY 대상에 없습니다"

if [ "$DATA_ONLY" = 0 ]; then
  info "H-2 덤프 손질(바뀐 줄 수 출력)"
  n1="$(grep -cE '^ALTER .* OWNER TO "supabase_admin";' "$out/schema.sql" || true)"
  sed -i '' -E 's/^(ALTER .* OWNER TO "supabase_admin";)/-- \1/' "$out/schema.sql"
  n2="$(grep -cE '^GRANT "postgres" TO "cli_login_postgres"' "$out/roles.sql" || true)"
  sed -i '' -E 's/^(GRANT "postgres" TO "cli_login_postgres".*)/-- \1/' "$out/roles.sql"
  printf '  schema.sql OWNER TO supabase_admin 주석 처리: %s줄 (예상 0)\n' "$n1"
  printf '  roles.sql cli_login_postgres GRANT 주석 처리: %s줄 (예상 0)\n' "$n2"

  info "auth 스키마의 우리 트리거 정의 저장(H-5에서 새 DB에 생성)"
  psql_old -At -c "set search_path = pg_catalog" -c "
    select pg_get_triggerdef(t.oid) || ';'
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'auth' and not t.tgisinternal
     order by t.tgname" > "$out/auth-triggers.sql"
  printf '  auth 트리거 %s개\n' "$(grep -c . "$out/auth-triggers.sql" || true)"
fi

printf '%s\n' "$stamp" > dumps/LATEST
info "완료: $out (옛 DB 기준 시작 시각 $started_at). 이 폴더에는 비밀번호 해시가 들어 있으니 다른 곳에 복사하지 마세요."
