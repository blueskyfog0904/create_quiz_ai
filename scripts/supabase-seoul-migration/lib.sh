#!/usr/bin/env bash
# 서울 이전 스크립트 공통 함수. 다른 스크립트가 source 한다.
# 규칙(docs/supabase-seoul-migration-plan.md 6절):
#   - 작업 폴더 ~/supabase-migration/<날짜>/ 에서만 실행(저장소·iCloud 밖)
#   - 비밀번호·키는 read -s 로 받고, 명령줄 인자에 넣지 않는다(PGPASSWORD 환경변수로만 전달)
#   - 접속 URL에는 비밀번호를 넣지 않는다
set -euo pipefail
umask 077

MIG_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
MIG_REPO_DIR="$(cd "$MIG_SCRIPT_DIR/../.." && pwd -P)"
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
# SSL 없이 접속하지 않는다
export PGSSLMODE=require

# H-1에서 데이터 덤프에서 빼는 auth 테이블. C-3 비우기 목록에도 다시 넣는다(계획 H-1·C-3).
AUTH_EXCLUDED_TABLES=(auth.sessions auth.refresh_tokens auth.flow_state auth.mfa_amr_claims auth.saml_relay_states)

die() { printf '\n[중단] %s\n' "$*" >&2; exit 1; }
info() { printf '\n== %s\n' "$*"; }

require_workdir() {
  local here
  here="$(pwd -P)"
  case "$here/" in
    "$MIG_REPO_DIR"/*) die "저장소 안에서는 실행하지 마세요. ~/supabase-migration/<날짜>/ 에서 실행하세요." ;;
  esac
  case "$here/" in
    "$(cd "$HOME" && pwd -P)"/supabase-migration/?*/) ;;
    *) die "작업 폴더 ~/supabase-migration/<날짜>/ 안에서 실행하세요. 지금 위치: $here" ;;
  esac
  [ -e supabase ] && die "작업 폴더에 supabase/ 가 있으면 CLI가 그 안의 .env를 읽습니다. 지우거나 다른 폴더를 쓰세요."
  chmod 700 .
  # 덤프에 비밀번호 해시가 들어가므로 Time Machine 백업에서 뺀다(실패해도 진행)
  tmutil addexclusion "$here" >/dev/null 2>&1 || true
  for cmd in psql pg_dump supabase docker; do
    command -v "$cmd" >/dev/null || die "$cmd 명령이 없습니다(P-4)."
  done
  psql --version | grep -q ' 17\.' || die "psql 17이 아닙니다: $(psql --version)"
}

# migration.env: 비밀값이 아닌 설정만 둔다(ref와 비밀번호 없는 Session pooler URL).
load_config() {
  if [ ! -f migration.env ]; then
    info "처음 실행: 설정을 입력합니다(비밀값 아님). Supabase 대시보드 → Connect → Session pooler 주소에서 비밀번호 부분을 뺀 형태"
    local old_ref new_ref old_url new_url
    read -r -p "옛(싱가포르) project ref: " old_ref
    read -r -p "새(서울) project ref: " new_ref
    read -r -p "옛 Session pooler URL (postgresql://postgres.<옛 ref>@<host>:5432/postgres): " old_url
    read -r -p "새 Session pooler URL (postgresql://postgres.<새 ref>@<host>:5432/postgres): " new_url
    # 검사를 통과한 값만 파일에 남긴다(비밀번호가 든 URL이 저장되지 않게)
    OLD_REF="$old_ref" NEW_REF="$new_ref" OLD_DB_URL="$old_url" NEW_DB_URL="$new_url" validate_config
    printf 'OLD_REF=%q\nNEW_REF=%q\nOLD_DB_URL=%q\nNEW_DB_URL=%q\n' "$old_ref" "$new_ref" "$old_url" "$new_url" > migration.env
  fi
  # shellcheck disable=SC1091
  . ./migration.env
  validate_config
  OLD_API_URL="https://${OLD_REF}.supabase.co"
  NEW_API_URL="https://${NEW_REF}.supabase.co"
}

validate_config() {
  [[ "${OLD_REF:-}" =~ ^[a-z0-9]{20}$ ]] || die "OLD_REF 형식이 아닙니다(migration.env)"
  [[ "${NEW_REF:-}" =~ ^[a-z0-9]{20}$ ]] || die "NEW_REF 형식이 아닙니다(migration.env)"
  [ "$OLD_REF" != "$NEW_REF" ] || die "OLD_REF와 NEW_REF가 같습니다"
  check_db_url "$OLD_DB_URL" "$OLD_REF" OLD_DB_URL
  check_db_url "$NEW_DB_URL" "$NEW_REF" NEW_DB_URL
}

# 비밀번호가 들어 있지 않고 ref가 맞는 Session pooler URL인지 확인
check_db_url() {
  local url="$1" ref="$2" name="$3"
  [[ "$url" =~ ^postgresql://postgres\.${ref}@[A-Za-z0-9.-]+:5432/postgres$ ]] \
    || die "$name 이 'postgresql://postgres.${ref}@<host>:5432/postgres' 형식이 아닙니다(비밀번호를 넣지 마세요, 포트 5432 Session pooler)"
}

# 사용: read_db_password old|new → OLD_PW 또는 NEW_PW
read_db_password() {
  local which="$1" ref pw
  if [ "$which" = old ]; then ref="$OLD_REF"; else ref="$NEW_REF"; fi
  read -r -s -p "[$which] $ref DB 비밀번호(화면에 보이지 않음): " pw; echo
  [ -n "$pw" ] || die "비밀번호가 비었습니다"
  if [ "$which" = old ]; then OLD_PW="$pw"; else NEW_PW="$pw"; fi
}

# psql 접속. 비밀번호는 이 명령의 환경변수로만 넘긴다.
psql_old() { PGPASSWORD="$OLD_PW" PGAPPNAME=seoul-migration psql "$OLD_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
psql_new() { PGPASSWORD="$NEW_PW" PGAPPNAME=seoul-migration psql "$NEW_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

# 접속 대상이 정말 그 프로젝트인지 확인(새 쪽에서 옛 쪽을 건드리는 실수 방지)
assert_connected_ref() {
  local which="$1" got
  if [ "$which" = old ]; then got="$(psql_old -At -c 'select current_user')"; else got="$(psql_new -At -c 'select current_user')"; fi
  [ "$got" = postgres ] || die "[$which] postgres 계정이 아닙니다: $got"
}

# dry-run 출력의 비밀번호를 가린다(dry-run은 PGPASSWORD를 평문으로 출력함, 계획 H-1)
redact() { sed -E 's/^(export PGPASSWORD=).*/\1<redacted>/'; }

# 사람이 직접 ref를 입력해야 진행(옛 DB에 쓰는 단계 보호)
confirm_ref() {
  local ref="$1" what="$2" typed
  read -r -p "$what — 계속하려면 대상 ref($ref)를 그대로 입력: " typed
  [ "$typed" = "$ref" ] || die "입력한 ref가 다릅니다"
}

latest_dump_dir() {
  [ -f dumps/LATEST ] || die "dumps/LATEST 가 없습니다. 먼저 h1-dump.sh 를 실행하세요."
  local d="dumps/$(cat dumps/LATEST)"
  [ -d "$d" ] || die "$d 가 없습니다"
  printf '%s' "$d"
}
