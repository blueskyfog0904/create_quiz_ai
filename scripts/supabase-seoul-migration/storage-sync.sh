#!/usr/bin/env bash
# H-6·C-4 Storage 복사·차이 반영. 옛 → 새 한 방향만.
# 사용:
#   storage-sync.sh                 버킷 생성·설정 맞춤 + 바뀐 파일 업로드 + 새 쪽에만 있는 파일 "목록만" 출력
#   storage-sync.sh --apply-delete  위와 같고, 새 쪽에만 있는 파일을 실제로 삭제
# 비교 목록은 두 DB의 storage.objects 를 SELECT해서 만든다(계획 H-6). 키는 환경변수로만 node에 넘긴다.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

APPLY_DELETE=0
[ "${1:-}" = "--apply-delete" ] && APPLY_DELETE=1

require_workdir
load_config
command -v node >/dev/null || die "node 가 없습니다"
read_db_password old
read_db_password new
assert_connected_ref old
assert_connected_ref new
read -r -s -p "[old] $OLD_REF service_role 키(Settings → API Keys → Legacy, 화면에 보이지 않음): " OLD_KEY; echo
read -r -s -p "[new] $NEW_REF secret 키(sb_secret_…, 화면에 보이지 않음): " NEW_KEY; echo
[ -n "$OLD_KEY" ] && [ -n "$NEW_KEY" ] || die "키가 비었습니다"

work="storage-sync/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$work"

# 옛 DB 시각을 목록보다 먼저 기록 → 성공하면 다음 실행의 기준 시각이 된다(로컬 시계를 쓰지 않음)
psql_old -At -c "select now()" > "$work/old-now.txt"

BUCKETS_SQL="select coalesce(json_agg(json_build_object('id', id, 'name', name, 'public', public,
  'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types) order by id), '[]') from storage.buckets"
OBJECTS_SQL="select coalesce(json_agg(json_build_object('bucket_id', bucket_id, 'name', name,
  'size', (metadata->>'size')::bigint, 'mimetype', metadata->>'mimetype', 'cache_control', metadata->>'cacheControl',
  'updated_at', updated_at) order by bucket_id, name collate \"C\"), '[]') from storage.objects"

psql_old -At -c "$BUCKETS_SQL" > "$work/old-buckets.json"
psql_old -At -c "$OBJECTS_SQL" > "$work/old-objects.json"
psql_new -At -c "$BUCKETS_SQL" > "$work/new-buckets.json"
psql_new -At -c "$OBJECTS_SQL" > "$work/new-objects.json"

# 기준 시각 파일은 "새 ref<TAB>옛 DB 시각". 다른 새 프로젝트의 기준 시각은 쓰지 않는다.
last_sync=""
if [ -f storage-sync/LAST_SYNC ]; then
  IFS=$'\t' read -r sync_ref sync_at < storage-sync/LAST_SYNC || true
  [ "${sync_ref:-}" = "$NEW_REF" ] || die "storage-sync/LAST_SYNC 가 다른 새 프로젝트(${sync_ref:-?}) 것입니다. 지우고 다시 실행하세요."
  last_sync="$sync_at"
else
  info "기준 시각 없음(첫 동기화): 없거나 크기가 다른 파일만 올립니다. 본 전환(C-4)이면 리허설 때의 작업 폴더에서 실행하세요."
fi
# 삭제는 직전 실행에서 목록으로 확인한 항목만(목록 확인 없이 지우지 않게)
prev_new_only=""
# 확인 목록도 새 ref별로 둔다(다른 새 프로젝트의 목록으로 지우지 않게)
new_only_file="storage-sync/LAST_NEW_ONLY-$NEW_REF.json"
[ -f "$new_only_file" ] && prev_new_only="$new_only_file"
[ "$APPLY_DELETE" = 0 ] || [ -n "$prev_new_only" ] || die "--apply-delete 전에 옵션 없이 한 번 실행해 삭제 목록을 확인하세요."

OLD_REF="$OLD_REF" NEW_REF="$NEW_REF" OLD_KEY="$OLD_KEY" NEW_KEY="$NEW_KEY" \
  SYNC_DIR="$work" LAST_SYNC="$last_sync" APPLY_DELETE="$APPLY_DELETE" PREV_NEW_ONLY="$prev_new_only" \
  node "$MIG_SCRIPT_DIR/storage-sync.mjs"

# node가 실패 없이 끝났을 때만 기준 시각을 넘긴다
printf '%s\t%s\n' "$NEW_REF" "$(cat "$work/old-now.txt")" > storage-sync/LAST_SYNC
cp "$work/new-only.json" "$new_only_file"
info "완료. 기준 시각(옛 DB) = $(cat "$work/old-now.txt"). AI에게 'H-6 끝'이라고 알려 주세요(V-3 비교)."
