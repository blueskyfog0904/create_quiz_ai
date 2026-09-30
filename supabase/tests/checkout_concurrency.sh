#!/usr/bin/env bash
# 원자 구매 RPC 동시성 테스트 (docs/cart-implementation-plan-v4.md P2-2, 매트릭스 T09·T13·T14·T25·T27·N1)
#   T09 같은 키 동시 20회 → batch 1, 차감 1 (나머지는 profile 잠금 뒤 replay)
#   T13 다른 키 동일 target 동시 → 소유권·차감 1회, 다른 쪽 ALREADY_OWNED
#   T14 번들 vs 서브상품(direct 2건), cart vs direct 겹침 동시 → 하나만 성공
#   T25 구매 중 다른 탭 담기 → 새 행 보존
#   T27 가격 UPDATE와 checkout 동시 → 확인 가격 체결 또는 PRICE_CHANGED
#   N1  교착 유도(credit source → profile 역순 writer) → checkout 40P01, 같은 키 재시도로 차감 1
# 동시성: 세션 A가 RPC 호출 후 커밋 전 HOLD_SECONDS 동안 잠금을 쥐고, LAUNCH_DELAY 뒤 다른 세션이 호출한다.
# 대기 세션의 RPC 소요 시간(트랜잭션 시작 → RPC 반환)이 MIN_WAIT_SECONDS 미만이면 잠금 대기가 없었던 것이므로
# 결과와 무관하게 INCONCLUSIVE(종료 코드 2)로 처리한다. N1은 40P01이 재현되지 않으면 INCONCLUSIVE다.
#
# 사용: PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE(또는 PGSERVICE) 환경변수를 설정하고
#       bash supabase/tests/checkout_concurrency.sh
#   접속 정보는 psql 인자로 넘기지 않는다(ps 노출 방지). 파일·로그에 비밀을 남기지 않는다.
#   N1은 세션별 deadlock_timeout을 SET하므로 superuser 권한(PGUSER=postgres 등)이 필요하다.
#   cart-test-concurrency-p2 접두 fixture(시나리오별 사용자, 상품 1)를 커밋해 쓰고 종료 시 그 fixture만 지운다.
#   전제: 20260930020304_market_cart_checkout, 20260930024829_market_checkout_rpc(임시 version) 적용 후.

set -euo pipefail

if [ -z "${PGSERVICE:-}" ] && [ -z "${PGHOST:-}" ]; then
  echo "PGSERVICE or PGHOST (with PGPORT/PGUSER/PGPASSWORD/PGDATABASE) is required" >&2
  exit 1
fi

FIXTURE_PREFIX='cart-test-concurrency-p2'
HOLD_SECONDS=3
LAUNCH_DELAY=0.5
MIN_WAIT_SECONDS=2
T09_WAITERS=19

psql_q() {
  psql -X -q -t -A -v ON_ERROR_STOP=1 "$@"
}

cleanup() {
  psql_q <<SQL >/dev/null
delete from auth.users where email like '$FIXTURE_PREFIX-%@example.invalid';
delete from public.market_items where title = '$FIXTURE_PREFIX';
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

# 시나리오별 사용자(10000 크레딧). 출력: user id
new_user() {
  psql_q <<SQL
insert into auth.users (id, email, aud, role)
values (gen_random_uuid(), '$FIXTURE_PREFIX-$1@example.invalid', 'authenticated', 'authenticated');
insert into public.profiles (id, email)
select id, email from auth.users where email = '$FIXTURE_PREFIX-$1@example.invalid'
on conflict (id) do nothing;
insert into public.credit_sources (user_id, initial_credits, remaining_credits, status, source_category)
select id, 10000, 10000, 'active', 'admin_grant' from auth.users where email = '$FIXTURE_PREFIX-$1@example.invalid';
select id from auth.users where email = '$FIXTURE_PREFIX-$1@example.invalid';
SQL
}

ITEM_ID=$(psql_q <<SQL
insert into public.market_items (menu_entry_id, title, subject_code, workspace_subject, status, is_active, published_at)
select m.id, '$FIXTURE_PREFIX', m.workspace_subject, m.workspace_subject, 'published', true, now()
from public.market_menu_entries m
where m.workspace_subject = 'english'
order by m.id
limit 1
returning id;
SQL
)
[ -n "$ITEM_ID" ] || fail "fixture item"

# 서브상품: pdf(question_pdf 300, pdf 파일), hwp(question_hwp 500, hwp 파일), 번들 1000
psql_q <<SQL >/dev/null
insert into public.market_item_subproducts (item_id, workspace_subject, category_id, title, price_credits, sort_order)
select '$ITEM_ID', 'english', c.id, '$FIXTURE_PREFIX-' || v.name, v.price, v.sort_order
from (values ('pdf', 'question_pdf', 300, 1), ('hwp', 'question_hwp', 500, 2)) as v(name, slug, price, sort_order)
join public.market_subproduct_categories c on c.workspace_subject = 'english' and c.slug = v.slug;

insert into public.market_subproduct_files (item_id, subproduct_id, workspace_subject, file_type_id, storage_bucket, storage_path, original_file_name)
select '$ITEM_ID', s.id, 'english', ft.id, 'market-files', '$FIXTURE_PREFIX/' || s.id, '$FIXTURE_PREFIX.' || ft.code
from public.market_item_subproducts s
join public.market_file_types ft on ft.workspace_subject = 'english'
  and ft.code = case when s.title like '%-pdf' then 'pdf' else 'hwp' end
where s.item_id = '$ITEM_ID';

insert into public.market_item_bundle_options (item_id, workspace_subject, label, price_credits, is_active)
values ('$ITEM_ID', 'english', '$FIXTURE_PREFIX-bundle', 1000, true);
SQL

PDF_ID=$(psql_q -c "select id from public.market_item_subproducts where item_id = '$ITEM_ID' and title = '$FIXTURE_PREFIX-pdf'")
HWP_ID=$(psql_q -c "select id from public.market_item_subproducts where item_id = '$ITEM_ID' and title = '$FIXTURE_PREFIX-hwp'")
BUNDLE_ID=$(psql_q -c "select id from public.market_item_bundle_options where item_id = '$ITEM_ID'")
[ -n "$PDF_ID" ] && [ -n "$HWP_ID" ] && [ -n "$BUNDLE_ID" ] || fail "fixture targets"

direct_lines() {
  printf '[{"targetKind": "%s", "targetId": "%s", "expectedCredits": %s}]' "$1" "$2" "$3"
}

# checkout_market_selection 결과를 'ok|code|alreadyCompleted|batchId|rpc_seconds' 한 줄로 출력한다.
# $1 user, $2 mode, $3 item(direct) 또는 빈 값, $4 lines json, $5 key, $6 커밋 전 대기 초, $7 추가 SET(선택)
checkout() {
  local item_sql='null'
  [ -n "$3" ] && item_sql="'$3'"
  psql_q -F '|' <<SQL | grep '|'
begin;
${7:-}
set local role service_role;
with c as materialized (
  select public.checkout_market_selection('$1', '$2', $item_sql, '$4'::jsonb, '$5') as r
)
select coalesce(r->>'ok', ''), coalesce(r->>'code', ''), coalesce(r->>'alreadyCompleted', ''),
       coalesce(r->>'batchId', ''), round(extract(epoch from clock_timestamp() - now())::numeric, 3)
from c;
select pg_sleep($6) where $6 > 0;
commit;
SQL
}

consume_count() {
  psql_q -c "select count(*) from public.credit_transactions where user_id = '$1' and type = 'consume'"
}

charged_total() {
  psql_q -c "select coalesce(sum(-amount), 0) from public.credit_transactions where user_id = '$1' and type = 'consume'"
}

require_wait() {
  local waited
  waited=$(field "$2" 5)
  awk -v w="$waited" -v m="$MIN_WAIT_SECONDS" 'BEGIN { exit !(w >= m) }' \
    || inconclusive "$1 waiting session did not wait on the lock (rpc_seconds=$waited < $MIN_WAIT_SECONDS)"
}

# T09: 같은 키 동시 20회
U=$(new_user t09)
KEY=$(psql_q -c "select gen_random_uuid()")
LINES=$(direct_lines subproduct "$PDF_ID" 300)
checkout "$U" direct "$ITEM_ID" "$LINES" "$KEY" "$HOLD_SECONDS" >"$TMP_DIR/t09_a" &
PID_A=$!
sleep "$LAUNCH_DELAY"
PIDS=()
for n in $(seq 1 "$T09_WAITERS"); do
  checkout "$U" direct "$ITEM_ID" "$LINES" "$KEY" 0 >"$TMP_DIR/t09_b$n" &
  PIDS+=("$!")
done
wait "$PID_A"
for pid in "${PIDS[@]}"; do wait "$pid"; done
RES_A=$(cat "$TMP_DIR/t09_a")
[ "$(field "$RES_A" 1)" = true ] && [ "$(field "$RES_A" 3)" = false ] || fail "T09 first session: $RES_A"
for n in $(seq 1 "$T09_WAITERS"); do
  RES_B=$(cat "$TMP_DIR/t09_b$n")
  require_wait "T09 session $n" "$RES_B"
  [ "$(field "$RES_B" 1)" = true ] && [ "$(field "$RES_B" 3)" = true ] \
    && [ "$(field "$RES_B" 4)" = "$(field "$RES_A" 4)" ] || fail "T09 session $n not a replay of the same batch: $RES_B"
done
[ "$(psql_q -c "select count(*) from public.market_checkout_batches where user_id = '$U'")" = 1 ] || fail "T09 batch count"
[ "$(consume_count "$U")" = 1 ] && [ "$(charged_total "$U")" = 300 ] || fail "T09 consume count/total"
echo "PASS T09: same key x20 -> 1 batch, 1 charge ($T09_WAITERS replays)"

# T13: 다른 키 동일 target 동시
U=$(new_user t13)
LINES=$(direct_lines subproduct "$PDF_ID" 300)
checkout "$U" direct "$ITEM_ID" "$LINES" "$(psql_q -c "select gen_random_uuid()")" "$HOLD_SECONDS" >"$TMP_DIR/t13_a" &
PID_A=$!
sleep "$LAUNCH_DELAY"
checkout "$U" direct "$ITEM_ID" "$LINES" "$(psql_q -c "select gen_random_uuid()")" 0 >"$TMP_DIR/t13_b"
wait "$PID_A"
RES_A=$(cat "$TMP_DIR/t13_a")
RES_B=$(cat "$TMP_DIR/t13_b")
require_wait T13 "$RES_B"
[ "$(field "$RES_A" 1)" = true ] && [ "$(field "$RES_B" 2)" = ALREADY_OWNED ] || fail "T13: A=$RES_A B=$RES_B"
[ "$(consume_count "$U")" = 1 ] || fail "T13 consume count"
[ "$(psql_q -c "select count(*) from public.market_entitlements where user_id = '$U' and status = 'active'")" = 1 ] \
  || fail "T13 entitlement count"
echo "PASS T13: different keys same target -> 1 owner, 1 charge"

# T14-1: 번들 vs 서브상품 (direct 2건)
U=$(new_user t14a)
checkout "$U" direct "$ITEM_ID" "$(direct_lines bundle "$BUNDLE_ID" 1000)" "$(psql_q -c "select gen_random_uuid()")" "$HOLD_SECONDS" >"$TMP_DIR/t14a_a" &
PID_A=$!
sleep "$LAUNCH_DELAY"
checkout "$U" direct "$ITEM_ID" "$(direct_lines subproduct "$HWP_ID" 500)" "$(psql_q -c "select gen_random_uuid()")" 0 >"$TMP_DIR/t14a_b"
wait "$PID_A"
RES_A=$(cat "$TMP_DIR/t14a_a")
RES_B=$(cat "$TMP_DIR/t14a_b")
require_wait T14-bundle "$RES_B"
[ "$(field "$RES_A" 1)" = true ] && [ "$(field "$RES_B" 2)" = ALREADY_OWNED ] || fail "T14 bundle vs subproduct: A=$RES_A B=$RES_B"
[ "$(consume_count "$U")" = 1 ] || fail "T14 bundle consume count"
echo "PASS T14: bundle vs subproduct concurrent -> only one succeeds"

# T14-2: cart vs direct 겹침
U=$(new_user t14b)
CART_ID=$(psql_q -c "select public.add_market_cart_item('$U', 'subproduct', '$PDF_ID')->>'cartItemId'")
[ -n "$CART_ID" ] || fail "T14 cart add"
checkout "$U" cart '' "[{\"cartItemId\": \"$CART_ID\", \"expectedCredits\": 300}]" "$(psql_q -c "select gen_random_uuid()")" "$HOLD_SECONDS" >"$TMP_DIR/t14b_a" &
PID_A=$!
sleep "$LAUNCH_DELAY"
checkout "$U" direct "$ITEM_ID" "$(direct_lines subproduct "$PDF_ID" 300)" "$(psql_q -c "select gen_random_uuid()")" 0 >"$TMP_DIR/t14b_b"
wait "$PID_A"
RES_A=$(cat "$TMP_DIR/t14b_a")
RES_B=$(cat "$TMP_DIR/t14b_b")
require_wait T14-cart "$RES_B"
[ "$(field "$RES_A" 1)" = true ] && [ "$(field "$RES_B" 2)" = ALREADY_OWNED ] || fail "T14 cart vs direct: A=$RES_A B=$RES_B"
[ "$(consume_count "$U")" = 1 ] || fail "T14 cart consume count"
echo "PASS T14: cart vs direct concurrent -> only one succeeds"

# T25: 구매 중 다른 탭 담기 → 새 행 보존
U=$(new_user t25)
CART_ID=$(psql_q -c "select public.add_market_cart_item('$U', 'subproduct', '$PDF_ID')->>'cartItemId'")
checkout "$U" cart '' "[{\"cartItemId\": \"$CART_ID\", \"expectedCredits\": 300}]" "$(psql_q -c "select gen_random_uuid()")" "$HOLD_SECONDS" >"$TMP_DIR/t25_a" &
PID_A=$!
sleep "$LAUNCH_DELAY"
psql_q -F '|' <<SQL | grep '|' >"$TMP_DIR/t25_b"
begin;
set local role service_role;
with c as materialized (
  select public.add_market_cart_item('$U', 'subproduct', '$HWP_ID') as r
)
select coalesce(r->>'ok', ''), coalesce(r->>'cartItemId', ''), '', '',
       round(extract(epoch from clock_timestamp() - now())::numeric, 3)
from c;
commit;
SQL
wait "$PID_A"
RES_A=$(cat "$TMP_DIR/t25_a")
RES_B=$(cat "$TMP_DIR/t25_b")
require_wait T25 "$RES_B"
[ "$(field "$RES_A" 1)" = true ] && [ "$(field "$RES_B" 1)" = true ] || fail "T25: A=$RES_A B=$RES_B"
[ "$(psql_q -c "select count(*) from public.market_cart_items where user_id = '$U'")" = 1 ] \
  && [ "$(psql_q -c "select id from public.market_cart_items where user_id = '$U'")" = "$(field "$RES_B" 2)" ] \
  || fail "T25 new row not preserved"
echo "PASS T25: cart add during checkout -> purchased row deleted, new row kept"

# T27: 가격 UPDATE와 checkout 동시 (catalog는 잠그지 않음)
U=$(new_user t27)
psql_q <<SQL >/dev/null &
begin;
update public.market_item_subproducts set price_credits = 350 where id = '$PDF_ID';
select pg_sleep($HOLD_SECONDS);
commit;
SQL
PID_A=$!
sleep "$LAUNCH_DELAY"
RES_B=$(checkout "$U" direct "$ITEM_ID" "$(direct_lines subproduct "$PDF_ID" 300)" "$(psql_q -c "select gen_random_uuid()")" 0)
wait "$PID_A"
if [ "$(field "$RES_B" 1)" = true ]; then
  [ "$(charged_total "$U")" = 300 ] || fail "T27 charged $(charged_total "$U") != confirmed 300"
  echo "PASS T27: checkout during uncommitted price update -> confirmed price 300 charged"
else
  [ "$(field "$RES_B" 2)" = PRICE_CHANGED ] && [ "$(consume_count "$U")" = 0 ] || fail "T27: $RES_B"
  echo "PASS T27: checkout during price update -> PRICE_CHANGED, no charge"
fi
U=$(new_user t27b)
RES_B=$(checkout "$U" direct "$ITEM_ID" "$(direct_lines subproduct "$PDF_ID" 300)" "$(psql_q -c "select gen_random_uuid()")" 0)
[ "$(field "$RES_B" 2)" = PRICE_CHANGED ] && [ "$(consume_count "$U")" = 0 ] || fail "T27 after commit: $RES_B"
echo "PASS T27: checkout after committed price update -> PRICE_CHANGED, no charge"
psql_q -c "update public.market_item_subproducts set price_credits = 300 where id = '$PDF_ID'" >/dev/null

# N1: credit source → profile 역순 writer와 교착 → checkout이 40P01로 실패, 같은 키 재시도로 차감 1
# checkout 세션 deadlock_timeout(2s) < writer 세션(10s)이므로 교착 판정은 checkout 쪽에서 난다.
U=$(new_user n1)
KEY=$(psql_q -c "select gen_random_uuid()")
LINES=$(direct_lines subproduct "$PDF_ID" 300)
psql -X -q -t -A -v ON_ERROR_STOP=1 <<SQL >/dev/null 2>&1 &
begin;
set local deadlock_timeout = '10s';
select 1 from public.credit_sources where user_id = '$U' for update;
select pg_sleep(1);
update public.profiles set updated_at = now() where id = '$U';
commit;
SQL
PID_A=$!
sleep "$LAUNCH_DELAY"
psql -X -q -t -A -v VERBOSITY=verbose <<SQL >"$TMP_DIR/n1_a" 2>&1 || true
begin;
set local deadlock_timeout = '2s';
set local role service_role;
select public.checkout_market_selection('$U', 'direct', '$ITEM_ID', '$LINES'::jsonb, '$KEY')->>'ok';
commit;
SQL
wait "$PID_A" || fail "N1 reverse-order writer failed"
grep -q '40P01' "$TMP_DIR/n1_a" || inconclusive "N1 deadlock not reproduced: $(tr '\n' ' ' <"$TMP_DIR/n1_a")"
[ "$(consume_count "$U")" = 0 ] && [ "$(psql_q -c "select count(*) from public.market_checkout_batches where user_id = '$U'")" = 0 ] \
  || fail "N1 aborted attempt left writes"
RES_B=$(checkout "$U" direct "$ITEM_ID" "$LINES" "$KEY" 0)
[ "$(field "$RES_B" 1)" = true ] && [ "$(field "$RES_B" 3)" = false ] || fail "N1 retry: $RES_B"
RES_C=$(checkout "$U" direct "$ITEM_ID" "$LINES" "$KEY" 0)
[ "$(field "$RES_C" 3)" = true ] && [ "$(field "$RES_C" 4)" = "$(field "$RES_B" 4)" ] || fail "N1 replay: $RES_C"
[ "$(consume_count "$U")" = 1 ] || fail "N1 consume count"
echo "PASS N1: deadlock 40P01 -> same-key retry succeeds, 1 charge"

echo "checkout_concurrency: all passed"
