#!/usr/bin/env bash
# 장바구니 담기 동시성 테스트 (docs/cart-implementation-plan-v4.md P1-2, 매트릭스 T01·T05)
#   1) 동일 target 2세션 동시 담기 → 행 1, 두 응답의 cartItemId 동일
#   2) 49행에서 서로 다른 target 2세션 동시 담기 → 최종 50행, 한쪽 CART_LIMIT
#   3) 50행에서 순차 51번째 → CART_LIMIT
# 동시성: 세션 A가 RPC 호출 후 커밋 전 HOLD_SECONDS 동안 profile 잠금을 쥐고, LAUNCH_DELAY 뒤 세션 B가 호출한다.
# B의 RPC 소요 시간(트랜잭션 시작 → RPC 반환)이 MIN_WAIT_SECONDS 미만이면 잠금 대기가 없었던 것이므로
# 결과와 무관하게 INCONCLUSIVE(종료 코드 2)로 처리한다.
#
# 사용: PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE(또는 PGSERVICE) 환경변수를 설정하고
#       bash supabase/tests/cart_concurrency.sh
#   접속 정보는 psql 인자로 넘기지 않는다(ps 노출 방지). 파일·로그에 비밀을 남기지 않는다.
#   cart-test-concurrency 접두 fixture(사용자 1, 상품 1, 서브상품 51)를 커밋해 쓰고 종료 시 그 fixture만 지운다.
#   전제: 20260930020304_market_cart_checkout 적용 후.

set -euo pipefail

if [ -z "${PGSERVICE:-}" ] && [ -z "${PGHOST:-}" ]; then
  echo "PGSERVICE or PGHOST (with PGPORT/PGUSER/PGPASSWORD/PGDATABASE) is required" >&2
  exit 1
fi

FIXTURE_EMAIL='cart-test-concurrency@example.invalid'
FIXTURE_TITLE='cart-test-concurrency'
HOLD_SECONDS=3
LAUNCH_DELAY=0.5
MIN_WAIT_SECONDS=2

psql_q() {
  psql -X -q -t -A -v ON_ERROR_STOP=1 "$@"
}

cleanup() {
  psql_q <<SQL >/dev/null
delete from auth.users where email = '$FIXTURE_EMAIL';
delete from public.market_items where title = '$FIXTURE_TITLE';
SQL
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

inconclusive() {
  echo "INCONCLUSIVE: $*" >&2
  exit 2
}

field() {
  printf '%s' "$1" | cut -d '|' -f "$2"
}

cleanup
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"; cleanup' EXIT

USER_ID=$(psql_q <<SQL
insert into auth.users (id, email, aud, role)
values (gen_random_uuid(), '$FIXTURE_EMAIL', 'authenticated', 'authenticated');
insert into public.profiles (id, email)
select id, email from auth.users where email = '$FIXTURE_EMAIL'
on conflict (id) do nothing;
select id from auth.users where email = '$FIXTURE_EMAIL';
SQL
)

ITEM_ID=$(psql_q <<SQL
insert into public.market_items (menu_entry_id, title, workspace_subject, status, is_active, published_at)
select m.id, '$FIXTURE_TITLE', m.workspace_subject, 'published', true, now()
from public.market_menu_entries m
where m.workspace_subject = 'english'
order by m.id
limit 1
returning id;
SQL
)
[ -n "$USER_ID" ] && [ -n "$ITEM_ID" ] || fail "fixture setup (user=$USER_ID item=$ITEM_ID)"

psql_q <<SQL >/dev/null
insert into public.market_item_subproducts (item_id, workspace_subject, category_id, title, price_credits, sort_order)
select '$ITEM_ID', 'english', c.id, '$FIXTURE_TITLE-sp-' || lpad(g::text, 2, '0'), 100, g
from generate_series(1, 51) as g
cross join public.market_subproduct_categories c
where c.workspace_subject = 'english' and c.slug = 'question_pdf';
SQL

sp_id() {
  psql_q -c "select id from public.market_item_subproducts where item_id = '$ITEM_ID' and title = '$FIXTURE_TITLE-sp-$1'"
}

# add_market_cart_item 결과를 'ok|code|cartItemId|rpc_seconds' 한 줄로 출력한다. $2 = 커밋 전 대기 초.
# rpc_seconds = 트랜잭션 시작(now())부터 RPC 반환까지. MATERIALIZED CTE로 RPC를 먼저 끝낸 뒤 측정한다.
add_item() {
  psql_q -F '|' <<SQL | grep '|'
begin;
set local role service_role;
with c as materialized (
  select public.add_market_cart_item('$USER_ID', 'subproduct', '$1') as r
)
select r->>'ok', coalesce(r->>'code', ''), coalesce(r->>'cartItemId', ''),
       round(extract(epoch from clock_timestamp() - now())::numeric, 3)
from c;
select pg_sleep($2) where $2 > 0;
commit;
SQL
}

cart_count() {
  psql_q -c "select count(*) from public.market_cart_items where user_id = '$USER_ID'"
}

# 세션 A(잠금 보유)와 세션 B(대기)를 동시에 실행하고 결과를 $TMP_DIR/<name>_a, _b에 남긴다.
run_pair() {
  add_item "$2" "$HOLD_SECONDS" >"$TMP_DIR/$1_a" &
  local pid_a=$!
  sleep "$LAUNCH_DELAY"
  add_item "$3" 0 >"$TMP_DIR/$1_b"
  wait "$pid_a"
  local waited
  waited=$(field "$(cat "$TMP_DIR/$1_b")" 4)
  awk -v w="$waited" -v m="$MIN_WAIT_SECONDS" 'BEGIN { exit !(w >= m) }' \
    || inconclusive "$1 session B did not wait on the lock (rpc_seconds=$waited < $MIN_WAIT_SECONDS)"
  echo "$1 session B lock wait: ${waited}s"
}

# 1) T01: 동일 target 동시 담기
SP01=$(sp_id 01)
run_pair t01 "$SP01" "$SP01"
RES_A=$(cat "$TMP_DIR/t01_a")
RES_B=$(cat "$TMP_DIR/t01_b")
[ "$(field "$RES_A" 1)" = true ] && [ "$(field "$RES_B" 1)" = true ] || fail "T01 responses: A=$RES_A B=$RES_B"
[ -n "$(field "$RES_A" 3)" ] && [ "$(field "$RES_A" 3)" = "$(field "$RES_B" 3)" ] \
  || fail "T01 cartItemId differs: A=$RES_A B=$RES_B"
[ "$(cart_count)" = 1 ] || fail "T01 row count $(cart_count) != 1"
echo "PASS T01: same target concurrent add -> 1 row, same id"

# 2) T05: 49행에서 동시 담기 2건
for n in $(seq -w 2 49); do
  RES=$(add_item "$(sp_id "$n")" 0)
  [ "$(field "$RES" 1)" = true ] || fail "prefill $n: $RES"
done
[ "$(cart_count)" = 49 ] || fail "prefill count $(cart_count) != 49"

run_pair t05 "$(sp_id 50)" "$(sp_id 51)"
RES_A=$(cat "$TMP_DIR/t05_a")
RES_B=$(cat "$TMP_DIR/t05_b")
[ "$(field "$RES_A" 1)" = true ] && [ "$(field "$RES_B" 2)" = CART_LIMIT ] \
  || fail "T05 expected A ok and B CART_LIMIT: A=$RES_A B=$RES_B"
[ "$(cart_count)" = 50 ] || fail "T05 row count $(cart_count) != 50"
echo "PASS T05: concurrent add at 49 rows -> 50 rows, one CART_LIMIT"

# 3) 순차 51번째 거부
RES=$(add_item "$(sp_id 51)" 0)
[ "$(field "$RES" 1)" = false ] && [ "$(field "$RES" 2)" = CART_LIMIT ] || fail "sequential 51st: $RES"
[ "$(cart_count)" = 50 ] || fail "after 51st row count $(cart_count) != 50"
echo "PASS P1-2: sequential 51st add -> CART_LIMIT"

echo "cart_concurrency: all passed"
