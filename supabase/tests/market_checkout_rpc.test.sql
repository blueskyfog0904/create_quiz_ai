-- 장바구니 Phase 2 SQL 테스트 (docs/cart-implementation-plan-v4.md 4절, 7절 P2-1, 8절 매트릭스)
-- 대상: evaluate_market_targets, checkout_market_selection
-- 커버: 구조(P1-3·P1-4 기준 재확인, 예외 핸들러 형태), T06, T07, T10, T12, T15, T16, T17, T18, T19, T24, T26,
--       T32, T40, N2, N5, N8~N12(R1~R5)와 R6, consume 부족 주입 → P0402, 다른 예외(40P01·RAISE) 주입 → 전체 롤백·SQLSTATE 보존,
--       direct 다중 줄 D-M1~D-M10(docs/cart-detail-multiselect-plan.md 7절)
-- pgTAP 없이 DO 블록 assert로 검증한다. 전부 begin … rollback 안에서 실행되고, 각 절은 savepoint로 격리한다.
-- fixture는 cart-test- 접두 사용자·상품과 아래 고정 UUID(ca7e0002-…)만 쓴다. 실패 주입 trigger는 fixture 사용자에게만
-- RAISE하며 해당 절에서 DROP한다(rollback으로도 사라진다).
-- 실행: PG* 환경변수(PGHOST·PGPORT·PGUSER·PGPASSWORD·PGDATABASE) 또는 PGSERVICE로 접속 정보를 넘기고
--       psql -X -v ON_ERROR_STOP=1 -f supabase/tests/market_checkout_rpc.test.sql
--       (첫 실패 assert에서 중단되고 rollback된다. 통과하면 마지막에 'market_checkout_rpc: all passed' NOTICE)
-- 전제: 20260930020304_market_cart_checkout, 20260930024829_market_checkout_rpc,
--       20260930080434_market_checkout_direct_multi(임시 version) 적용 후.
-- P2-2(동시성)는 supabase/tests/checkout_concurrency.sh.
--
-- fixture ID (ca7e0002-0000-4000-8000-…)
--   사용자 A …00a(10000 크레딧) / B …00b / C …00c(T40 전용 소스 조합)
--   상품 E1 …0e1(english): PDF …0a1(question_pdf 300, pdf 파일 f1), HWP …0a2(question_hwp 500, hwp f2 + pdf f3), 번들 …0b1(1000)
--   상품 K1 …0e2(korean): PDF …0a9(question_pdf 200, pdf 파일 f9)
--   idempotency key는 ca7e0002-0000-4000-9000-…

begin;

set local plpgsql.check_asserts = on;

-- 0. fixture
insert into auth.users (id, email, aud, role)
values
  ('ca7e0002-0000-4000-8000-00000000000a', 'cart-test-p2-a@example.invalid', 'authenticated', 'authenticated'),
  ('ca7e0002-0000-4000-8000-00000000000b', 'cart-test-p2-b@example.invalid', 'authenticated', 'authenticated'),
  ('ca7e0002-0000-4000-8000-00000000000c', 'cart-test-p2-c@example.invalid', 'authenticated', 'authenticated');

insert into public.profiles (id, email)
values
  ('ca7e0002-0000-4000-8000-00000000000a', 'cart-test-p2-a@example.invalid'),
  ('ca7e0002-0000-4000-8000-00000000000b', 'cart-test-p2-b@example.invalid'),
  ('ca7e0002-0000-4000-8000-00000000000c', 'cart-test-p2-c@example.invalid')
on conflict (id) do nothing;

insert into public.market_items (id, menu_entry_id, title, subject_code, workspace_subject, status, is_active, published_at)
select v.id, (
         select m.id from public.market_menu_entries m
         where m.workspace_subject = v.ws
         order by m.id
         limit 1
       ), v.title, v.ws, v.ws, 'published', true, now()
from (values
  ('ca7e0002-0000-4000-8000-0000000000e1'::uuid, 'english', 'cart-test-p2-english'),
  ('ca7e0002-0000-4000-8000-0000000000e2'::uuid, 'korean', 'cart-test-p2-korean')
) as v(id, ws, title);

insert into public.market_item_subproducts (id, item_id, workspace_subject, category_id, title, price_credits, sort_order, is_active)
select v.id, v.item_id, v.ws, c.id, v.title, v.price, v.sort_order, true
from (values
  ('ca7e0002-0000-4000-8000-0000000000a1'::uuid, 'ca7e0002-0000-4000-8000-0000000000e1'::uuid, 'english', 'question_pdf', 'cart-test-p2-pdf', 300, 1),
  ('ca7e0002-0000-4000-8000-0000000000a2'::uuid, 'ca7e0002-0000-4000-8000-0000000000e1'::uuid, 'english', 'question_hwp', 'cart-test-p2-hwp', 500, 2),
  ('ca7e0002-0000-4000-8000-0000000000a9'::uuid, 'ca7e0002-0000-4000-8000-0000000000e2'::uuid, 'korean', 'question_pdf', 'cart-test-p2-kpdf', 200, 1)
) as v(id, item_id, ws, slug, title, price, sort_order)
join public.market_subproduct_categories c on c.workspace_subject = v.ws and c.slug = v.slug;

insert into public.market_subproduct_files (id, item_id, subproduct_id, workspace_subject, file_type_id, storage_bucket, storage_path, original_file_name)
select v.id, v.item_id, v.subproduct_id, v.ws, ft.id, 'market-files', 'cart-test-p2/' || v.id, 'cart-test-p2.' || v.code
from (values
  ('ca7e0002-0000-4000-8000-0000000000f1'::uuid, 'ca7e0002-0000-4000-8000-0000000000e1'::uuid, 'ca7e0002-0000-4000-8000-0000000000a1'::uuid, 'english', 'pdf'),
  ('ca7e0002-0000-4000-8000-0000000000f2'::uuid, 'ca7e0002-0000-4000-8000-0000000000e1'::uuid, 'ca7e0002-0000-4000-8000-0000000000a2'::uuid, 'english', 'hwp'),
  ('ca7e0002-0000-4000-8000-0000000000f3'::uuid, 'ca7e0002-0000-4000-8000-0000000000e1'::uuid, 'ca7e0002-0000-4000-8000-0000000000a2'::uuid, 'english', 'pdf'),
  ('ca7e0002-0000-4000-8000-0000000000f9'::uuid, 'ca7e0002-0000-4000-8000-0000000000e2'::uuid, 'ca7e0002-0000-4000-8000-0000000000a9'::uuid, 'korean', 'pdf')
) as v(id, item_id, subproduct_id, ws, code)
join public.market_file_types ft on ft.workspace_subject = v.ws and ft.code = v.code;

insert into public.market_item_bundle_options (id, item_id, workspace_subject, label, price_credits, is_active)
values ('ca7e0002-0000-4000-8000-0000000000b1', 'ca7e0002-0000-4000-8000-0000000000e1', 'english', 'cart-test-p2-bundle', 1000, true);

insert into public.credit_sources (id, user_id, initial_credits, remaining_credits, status, source_category)
values ('ca7e0002-0000-4000-8000-0000000000c1', 'ca7e0002-0000-4000-8000-00000000000a', 10000, 10000, 'active', 'admin_grant');

-- 테스트 전용 호출 헬퍼 (pg_temp, 트랜잭션과 함께 사라짐)
create function pg_temp.direct(
  p_user uuid, p_item uuid, p_kind text, p_target uuid, p_expected integer, p_key uuid, p_ack boolean default false
) returns jsonb language sql as $$
  select public.checkout_market_selection(
    p_user, 'direct', p_item,
    jsonb_build_array(jsonb_build_object(
      'targetKind', p_kind, 'targetId', p_target, 'expectedCredits', p_expected, 'acknowledgeNoDiscount', p_ack)),
    p_key)
$$;

create function pg_temp.cart(p_user uuid, p_lines jsonb, p_key uuid) returns jsonb language sql as $$
  select public.checkout_market_selection(p_user, 'cart', null, p_lines, p_key)
$$;

create function pg_temp.eval1(p_user uuid, p_kind text, p_target uuid) returns jsonb language sql as $$
  select public.evaluate_market_targets(
    p_user, jsonb_build_array(jsonb_build_object('targetKind', p_kind, 'targetId', p_target)))->0
$$;

-- 원장·잔액·주문·권한·cart·batch 상태 요약 (전후 비교용)
create function pg_temp.state(p_user uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'tx', (select count(*) from public.credit_transactions where user_id = p_user),
    'consumption', (select count(*) from public.credit_consumption where user_id = p_user),
    'remaining', (select coalesce(sum(remaining_credits), 0) from public.credit_sources where user_id = p_user),
    'profile_credits', (select credits from public.profiles where id = p_user),
    'orders', (select count(*) from public.market_purchase_orders where user_id = p_user),
    'lines', (select count(*) from public.market_purchase_lines l
              join public.market_purchase_orders o on o.id = l.order_id where o.user_id = p_user),
    'entitlements', (select count(*) from public.market_entitlements where user_id = p_user),
    'cart', (select count(*) from public.market_cart_items where user_id = p_user),
    'batches', (select count(*) from public.market_checkout_batches where user_id = p_user)
  )
$$;

do $$
begin
  assert (select count(*) from public.market_item_subproducts
          where id in ('ca7e0002-0000-4000-8000-0000000000a1', 'ca7e0002-0000-4000-8000-0000000000a2',
                       'ca7e0002-0000-4000-8000-0000000000a9')) = 3,
    'fixture: 3 subproducts (english/korean menu entries and question_pdf/question_hwp categories required)';
  assert (select count(*) from public.market_subproduct_files
          where item_id in ('ca7e0002-0000-4000-8000-0000000000e1', 'ca7e0002-0000-4000-8000-0000000000e2')) = 4,
    'fixture: 4 files (english/korean pdf/hwp file types required)';
end;
$$;

-- 1. 구조·권한 (P1-3·P1-4 기준, 4절 예외 핸들러 형태)
do $$
declare
  f text;
  r text;
  v_def text;
begin
  foreach f in array array[
    'public.evaluate_market_targets(uuid, jsonb)',
    'public.checkout_market_selection(uuid, text, uuid, jsonb, uuid)'
  ] loop
    foreach r in array array['anon', 'authenticated'] loop
      assert not has_function_privilege(r, f, 'execute'), format('%s cannot execute %s', r, f);
    end loop;
    assert has_function_privilege('service_role', f, 'execute'), format('service_role can execute %s', f);
    assert (select prosecdef and provolatile = 'v'
                   and proconfig @> array['search_path=public, pg_temp']
            from pg_proc where oid = f::regprocedure),
      format('%s is SECURITY DEFINER, VOLATILE, search_path=public, pg_temp', f);
  end loop;

  v_def := lower(pg_get_functiondef('public.checkout_market_selection(uuid, text, uuid, jsonb, uuid)'::regprocedure));
  assert position('when others' in v_def) = 0, 'no WHEN OTHERS handler';
  assert v_def ~ 'when raise_exception then\s+if sqlerrm = ''insufficient_credits'' then\s+raise exception using errcode = ''p0402'', message = ''insufficient_credits'';\s+else\s+raise;\s+end if;',
    'consume_credits handler has the fixed form';
  assert (select count(*) from regexp_matches(v_def, 'exception\s+when', 'g')) = 1, 'exactly one exception handler';
end;
$$;

-- 2. T26: 입력 오류는 차감 전 INVALID_INPUT
savepoint s2;
do $$
declare
  a constant uuid := 'ca7e0002-0000-4000-8000-00000000000a';
  e1 constant uuid := 'ca7e0002-0000-4000-8000-0000000000e1';
  k constant uuid := 'ca7e0002-0000-4000-9000-000000000201';
  v_before jsonb := pg_temp.state(a);
  v_bad jsonb;
begin
  foreach v_bad in array array[
    '[]'::jsonb,
    '{}'::jsonb,
    (select jsonb_agg(jsonb_build_object('cartItemId', gen_random_uuid(), 'expectedCredits', 1)) from generate_series(1, 51)),
    '[{"cartItemId": "not-a-uuid", "expectedCredits": 1}]',
    '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": 0}]',
    '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": -1}]',
    '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": 1.5}]',
    '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": "100"}]',
    '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": 2147483648}]',
    '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": 1, "acknowledgeNoDiscount": "yes"}]',
    '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": 2147483647},
      {"cartItemId": "ca7e0002-0000-4000-8000-0000000000d2", "expectedCredits": 1}]',
    '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": 1},
      {"cartItemId": "CA7E0002-0000-4000-8000-0000000000D1", "expectedCredits": 1}]'
  ] loop
    assert pg_temp.cart(a, v_bad, k)->>'code' = 'INVALID_INPUT', format('cart INVALID_INPUT for %s', left(v_bad::text, 80));
  end loop;

  assert public.checkout_market_selection(a, 'bogus', null, '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": 1}]', k)->>'code' = 'INVALID_INPUT',
    'unknown mode';
  assert public.checkout_market_selection(a, 'cart', null, '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": 1}]', null)->>'code' = 'INVALID_INPUT',
    'missing key';
  assert public.checkout_market_selection(a, 'direct', null,
    '[{"targetKind": "subproduct", "targetId": "ca7e0002-0000-4000-8000-0000000000a1", "expectedCredits": 300}]', k)->>'code' = 'INVALID_INPUT',
    'direct without item id';
  assert public.checkout_market_selection(a, 'direct', e1,
    '[{"targetKind": "legacy_pdf", "targetId": "ca7e0002-0000-4000-8000-0000000000a1", "expectedCredits": 300}]', k)->>'code' = 'INVALID_INPUT',
    'direct with unknown target kind';

  assert pg_temp.state(a) = v_before, 'T26: no writes on invalid input';
end;
$$;
rollback to savepoint s2;

-- 3. 단건 성공·기록 형식 (T16, N2, 4절 9단계 기록 규칙), T12(direct replay), T10
savepoint s3;
do $$
declare
  a constant uuid := 'ca7e0002-0000-4000-8000-00000000000a';
  e1 constant uuid := 'ca7e0002-0000-4000-8000-0000000000e1';
  pdf constant uuid := 'ca7e0002-0000-4000-8000-0000000000a1';
  k1 constant uuid := 'ca7e0002-0000-4000-9000-000000000301';
  k2 constant uuid := 'ca7e0002-0000-4000-9000-000000000302';
  v_r jsonb;
  v_replay jsonb;
  v_order public.market_purchase_orders%rowtype;
  v_before_replay jsonb;
begin
  v_r := pg_temp.direct(a, e1, 'subproduct', pdf, 300, k1);
  assert v_r->>'ok' = 'true' and v_r->>'alreadyCompleted' = 'false', format('direct purchase ok: %s', v_r);
  assert (v_r->>'totalCredits')::int = 300 and jsonb_array_length(v_r->'orders') = 1, 'receipt total/orders';

  select * into v_order from public.market_purchase_orders where id = (v_r->'orders'->0->>'orderId')::uuid;
  assert v_order.checkout_batch_id = (v_r->>'batchId')::uuid, 'child order linked to batch';
  assert v_order.idempotency_key is null, 'N2: child idempotency_key is NULL';
  assert v_order.purchase_type = 'subproduct' and v_order.charged_credits = 300 and v_order.original_price_credits = 300,
    'order prices';
  assert v_order.workspace_subject = 'english', 'order subject';
  assert (select sum((c->>'amount')::int) from jsonb_array_elements(v_order.credit_consumptions) c) = 300,
    'T16: child credit_consumptions sum = charged';
  assert (select count(*) from public.market_purchase_lines
          where order_id = v_order.id and line_type = 'subproduct' and subproduct_id = pdf and price_credits = 300) = 1,
    'line row';
  assert (select count(*) from public.market_entitlements
          where source_order_id = v_order.id and scope = 'subproduct' and subproduct_id = pdf and status = 'active') = 1,
    'entitlement row';
  assert (select count(*) from public.credit_consumption
          where user_id = a and resource_type = 'market_purchase_subproduct_v2' and resource_id = e1
            and description = 'cart-test-p2-english 서브상품 구매 #' || left(v_order.id::text, 8)) = 1,
    'consume resource_type/resource_id/description with child id prefix';
  assert (select remaining_credits from public.credit_sources where id = 'ca7e0002-0000-4000-8000-0000000000c1') = 9700,
    'charged once';
  assert (select total_credits from public.market_checkout_batches where id = (v_r->>'batchId')::uuid) = 300,
    'T16: batch total_credits';
  assert (select request_payload from public.market_checkout_batches where id = (v_r->>'batchId')::uuid)
         = jsonb_build_object('mode', 'direct', 'itemId', e1, 'lines', jsonb_build_array(jsonb_build_object(
             'targetKind', 'subproduct', 'targetId', pdf, 'expectedCredits', 300, 'ack', false))),
    '3.2 normalized direct payload';

  -- T12 (direct): 같은 키·같은 입력 → 저장된 영수증, 추가 차감 없음
  v_before_replay := pg_temp.state(a);
  v_replay := pg_temp.direct(a, e1, 'subproduct', pdf, 300, k1);
  assert v_replay->>'alreadyCompleted' = 'true' and v_replay->>'batchId' = v_r->>'batchId'
         and v_replay->'orders' = v_r->'orders', 'direct replay returns stored receipt';
  assert pg_temp.state(a) = v_before_replay, 'replay writes nothing';

  -- 정규화: 대문자 targetId 문자열로 보낸 같은 요청도 같은 payload → replay
  v_replay := public.checkout_market_selection(a, 'direct', e1,
    jsonb_build_array(jsonb_build_object(
      'targetKind', 'subproduct', 'targetId', upper(pdf::text), 'expectedCredits', 300)), k1);
  assert v_replay->>'alreadyCompleted' = 'true' and v_replay->>'batchId' = v_r->>'batchId',
    format('uppercase targetId replays: %s', v_replay);
  assert pg_temp.state(a) = v_before_replay, 'uppercase replay writes nothing';

  -- T10: 같은 키·다른 payload → IDEMPOTENCY_CONFLICT (가격·ack·모드 각각)
  assert pg_temp.direct(a, e1, 'subproduct', pdf, 301, k1)->>'code' = 'IDEMPOTENCY_CONFLICT', 'T10 price differs';
  assert pg_temp.direct(a, e1, 'subproduct', pdf, 300, k1, true)->>'code' = 'IDEMPOTENCY_CONFLICT', 'T10 ack differs';
  assert pg_temp.cart(a, '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": 300}]', k1)->>'code'
         = 'IDEMPOTENCY_CONFLICT', 'T10 mode differs';
  assert pg_temp.state(a) = v_before_replay, 'T10: no writes';

  -- N2: 같은 사용자 연속 batch (child 키 NULL끼리 UNIQUE 충돌 없음)
  v_r := pg_temp.direct(a, e1, 'bundle', 'ca7e0002-0000-4000-8000-0000000000b1', 1000, k2, true);
  assert v_r->>'ok' = 'true', format('N2 second batch ok: %s', v_r);
  assert (select count(*) from public.market_purchase_orders where user_id = a and idempotency_key is null) = 2,
    'N2: two child orders with NULL key';
end;
$$;
rollback to savepoint s3;

-- 4. direct 대상 위조·없는 대상 → NOT_FOUND (T36의 path/target 위조 차단)
savepoint s4;
do $$
declare
  a constant uuid := 'ca7e0002-0000-4000-8000-00000000000a';
  v_before jsonb := pg_temp.state(a);
begin
  assert pg_temp.direct(a, 'ca7e0002-0000-4000-8000-0000000000e2', 'subproduct',
                        'ca7e0002-0000-4000-8000-0000000000a1', 300,
                        'ca7e0002-0000-4000-9000-000000000401')->>'code' = 'NOT_FOUND',
    'target of another item → NOT_FOUND';
  assert pg_temp.direct(a, 'ca7e0002-0000-4000-8000-0000000000e1', 'subproduct',
                        'ca7e0002-0000-4000-8000-0000000000b1', 1000,
                        'ca7e0002-0000-4000-9000-000000000402')->>'code' = 'NOT_FOUND',
    'bundle id sent as subproduct → NOT_FOUND';
  assert pg_temp.direct(a, 'ca7e0002-0000-4000-8000-0000000000e1', 'bundle',
                        'ca7e0002-0000-4000-8000-0000000000a1', 1000,
                        'ca7e0002-0000-4000-9000-000000000403')->>'code' = 'NOT_FOUND',
    'subproduct id sent as bundle → NOT_FOUND';
  assert pg_temp.state(a) = v_before, 'no writes';
end;
$$;
rollback to savepoint s4;

-- 5. R1~R6 (N8~N12)
savepoint s5;
do $$
declare
  a constant uuid := 'ca7e0002-0000-4000-8000-00000000000a';
  e1 constant uuid := 'ca7e0002-0000-4000-8000-0000000000e1';
  pdf constant uuid := 'ca7e0002-0000-4000-8000-0000000000a1';
  hwp constant uuid := 'ca7e0002-0000-4000-8000-0000000000a2';
  bundle constant uuid := 'ca7e0002-0000-4000-8000-0000000000b1';
  v_e jsonb;
begin
  -- 미보유 기준값
  v_e := pg_temp.eval1(a, 'subproduct', pdf);
  assert v_e->>'purchasable' = 'true' and (v_e->>'chargedCredits')::int = 300 and v_e->>'reason' is null, 'base pdf';
  v_e := pg_temp.eval1(a, 'subproduct', hwp);
  assert (v_e->>'chargedCredits')::int = 500 and v_e->>'includesPdf' = 'true', 'base hwp';
  v_e := pg_temp.eval1(a, 'bundle', bundle);
  assert v_e->>'purchasable' = 'true' and v_e->>'partiallyOwned' = 'false' and (v_e->>'chargedCredits')::int = 1000,
    'base bundle';
  v_e := pg_temp.eval1(a, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000ff');
  assert v_e->>'reason' = 'NOT_FOUND' and v_e->>'purchasable' = 'false', 'missing target → NOT_FOUND';
end;
$$;

-- N8(R1)·N9(R2): item scope 보유
savepoint s5a;
do $$
declare
  a constant uuid := 'ca7e0002-0000-4000-8000-00000000000a';
  e1 constant uuid := 'ca7e0002-0000-4000-8000-0000000000e1';
begin
  assert pg_temp.direct(a, e1, 'bundle', 'ca7e0002-0000-4000-8000-0000000000b1', 1000,
                        'ca7e0002-0000-4000-9000-000000000501')->>'ok' = 'true', 'buy bundle';
  assert pg_temp.eval1(a, 'bundle', 'ca7e0002-0000-4000-8000-0000000000b1')->>'reason' = 'ALREADY_OWNED', 'N8 R1';
  assert pg_temp.eval1(a, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a1')->>'reason' = 'ALREADY_OWNED', 'N9 R2 pdf';
  assert pg_temp.eval1(a, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a2')->>'reason' = 'ALREADY_OWNED', 'N9 R2 hwp';
  assert pg_temp.direct(a, e1, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a1', 300,
                        'ca7e0002-0000-4000-9000-000000000502')->>'code' = 'ALREADY_OWNED', 'N9 checkout ALREADY_OWNED';
  assert pg_temp.direct(a, e1, 'bundle', 'ca7e0002-0000-4000-8000-0000000000b1', 1000,
                        'ca7e0002-0000-4000-9000-000000000503')->>'code' = 'ALREADY_OWNED', 'N8 checkout ALREADY_OWNED';
end;
$$;
rollback to savepoint s5a;

-- N10(R3)·R5 차액·T19 기준 주문·R6·T32
savepoint s5b;
do $$
declare
  a constant uuid := 'ca7e0002-0000-4000-8000-00000000000a';
  e1 constant uuid := 'ca7e0002-0000-4000-8000-0000000000e1';
  pdf constant uuid := 'ca7e0002-0000-4000-8000-0000000000a1';
  hwp constant uuid := 'ca7e0002-0000-4000-8000-0000000000a2';
  bundle constant uuid := 'ca7e0002-0000-4000-8000-0000000000b1';
  v_pdf_order uuid;
  v_e jsonb;
  v_r jsonb;
begin
  v_r := pg_temp.direct(a, e1, 'subproduct', pdf, 300, 'ca7e0002-0000-4000-9000-000000000511');
  assert v_r->>'ok' = 'true', 'buy pdf';
  v_pdf_order := (v_r->'orders'->0->>'orderId')::uuid;

  assert pg_temp.eval1(a, 'subproduct', pdf)->>'reason' = 'ALREADY_OWNED', 'N10 R3';

  v_e := pg_temp.eval1(a, 'subproduct', hwp);
  assert (v_e->>'chargedCredits')::int = 200 and (v_e->>'originalCredits')::int = 500
         and (v_e->>'upgradeBaseOrderId')::uuid = v_pdf_order, 'R5: HWP diff 200, base = pdf order';

  v_e := pg_temp.eval1(a, 'bundle', bundle);
  assert v_e->>'partiallyOwned' = 'true' and (v_e->>'chargedCredits')::int = 1000, 'R6 partial, full price';

  -- T32: ack 없음 → ACK_REQUIRED, ack → 정가 체결·기존 권한 유지
  assert pg_temp.direct(a, e1, 'bundle', bundle, 1000, 'ca7e0002-0000-4000-9000-000000000512')->>'code' = 'ACK_REQUIRED',
    'T32 ack required';
  v_r := pg_temp.direct(a, e1, 'bundle', bundle, 1000, 'ca7e0002-0000-4000-9000-000000000513', true);
  assert v_r->>'ok' = 'true' and (v_r->'orders'->0->>'chargedCredits')::int = 1000, format('T32 ack → full price: %s', v_r);
  assert (select count(*) from public.market_entitlements
          where user_id = a and item_id = e1 and status = 'active'
            and ((scope = 'subproduct' and subproduct_id = pdf) or scope = 'item')) = 2,
    'T32: existing subproduct entitlement kept + item entitlement';
end;
$$;
rollback to savepoint s5b;

-- T19: 차액 체결 + 기준 주문 결정적 선택(동률 PDF 2개 → created_at, id 오름차순)
savepoint s5c;
do $$
declare
  a constant uuid := 'ca7e0002-0000-4000-8000-00000000000a';
  e1 constant uuid := 'ca7e0002-0000-4000-8000-0000000000e1';
  pdf2 constant uuid := 'ca7e0002-0000-4000-8000-0000000000a3';
  v_r jsonb;
  v_expected_base uuid;
begin
  insert into public.market_item_subproducts (id, item_id, workspace_subject, category_id, title, price_credits, sort_order)
  select pdf2, e1, 'english', c.id, 'cart-test-p2-pdf2', 300, 3
  from public.market_subproduct_categories c where c.workspace_subject = 'english' and c.slug = 'question_pdf';
  insert into public.market_subproduct_files (item_id, subproduct_id, workspace_subject, file_type_id, storage_bucket, storage_path, original_file_name)
  select e1, pdf2, 'english', ft.id, 'market-files', 'cart-test-p2/pdf2', 'cart-test-p2.pdf'
  from public.market_file_types ft where ft.workspace_subject = 'english' and ft.code = 'pdf';

  assert pg_temp.direct(a, e1, 'subproduct', pdf2, 300, 'ca7e0002-0000-4000-9000-000000000521')->>'ok' = 'true', 'buy pdf2';
  assert pg_temp.direct(a, e1, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a1', 300,
                        'ca7e0002-0000-4000-9000-000000000522')->>'ok' = 'true', 'buy pdf1';

  select o.id into v_expected_base
  from public.market_purchase_orders o
  where o.user_id = a and o.item_id = e1
  order by o.created_at, o.id
  limit 1;

  -- 순서를 바꿔 두 번 평가해도 같은 기준 주문
  assert (pg_temp.eval1(a, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a2')->>'upgradeBaseOrderId')::uuid = v_expected_base,
    'T19 deterministic base order';

  v_r := pg_temp.direct(a, e1, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a2', 200,
                        'ca7e0002-0000-4000-9000-000000000523');
  assert v_r->>'ok' = 'true', format('T19 hwp diff purchase: %s', v_r);
  assert (v_r->'orders'->0->>'chargedCredits')::int = 200 and (v_r->'orders'->0->>'originalCredits')::int = 500
         and (v_r->'orders'->0->>'upgradeBaseOrderId')::uuid = v_expected_base, 'T19 receipt snapshot';
  assert (select charged_credits = 200 and original_price_credits = 500 from public.market_purchase_orders
          where id = (v_r->'orders'->0->>'orderId')::uuid), 'T19 order prices';
  assert pg_temp.direct(a, e1, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a2', 500,
                        'ca7e0002-0000-4000-9000-000000000524')->>'code' = 'ALREADY_OWNED', 'hwp now owned';
end;
$$;
rollback to savepoint s5c;

-- N11(R4): PDF 포함 HWP 보유자의 PDF → ALREADY_OWNED, HWP에 PDF 파일이 없으면 구매 가능
savepoint s5d;
do $$
declare
  a constant uuid := 'ca7e0002-0000-4000-8000-00000000000a';
  e1 constant uuid := 'ca7e0002-0000-4000-8000-0000000000e1';
  pdf constant uuid := 'ca7e0002-0000-4000-8000-0000000000a1';
begin
  assert pg_temp.direct(a, e1, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a2', 500,
                        'ca7e0002-0000-4000-9000-000000000531')->>'ok' = 'true', 'buy hwp';
  assert pg_temp.eval1(a, 'subproduct', pdf)->>'reason' = 'ALREADY_OWNED', 'N11 R4 blocked';
  assert pg_temp.direct(a, e1, 'subproduct', pdf, 300, 'ca7e0002-0000-4000-9000-000000000532')->>'code' = 'ALREADY_OWNED',
    'N11 checkout blocked';

  update public.market_subproduct_files set is_active = false where id = 'ca7e0002-0000-4000-8000-0000000000f3';
  assert pg_temp.eval1(a, 'subproduct', pdf)->>'purchasable' = 'true', 'N11 hwp without pdf file → pdf purchasable';
  assert pg_temp.direct(a, e1, 'subproduct', pdf, 300, 'ca7e0002-0000-4000-9000-000000000533')->>'ok' = 'true',
    'N11 pdf purchase ok';
end;
$$;
rollback to savepoint s5d;

-- N12(R5 미적용): 활성 HWP 2개 / HWP에 PDF 파일 없음 / 차액 ≤ 0 → 정가
savepoint s5e;
do $$
declare
  a constant uuid := 'ca7e0002-0000-4000-8000-00000000000a';
  e1 constant uuid := 'ca7e0002-0000-4000-8000-0000000000e1';
  hwp constant uuid := 'ca7e0002-0000-4000-8000-0000000000a2';
  v_e jsonb;
begin
  assert pg_temp.direct(a, e1, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a1', 300,
                        'ca7e0002-0000-4000-9000-000000000541')->>'ok' = 'true', 'buy pdf';
  assert (pg_temp.eval1(a, 'subproduct', hwp)->>'chargedCredits')::int = 200, 'precondition: diff applies';

  -- (a) 활성 HWP 2개
  insert into public.market_item_subproducts (id, item_id, workspace_subject, category_id, title, price_credits, sort_order)
  select 'ca7e0002-0000-4000-8000-0000000000a4', e1, 'english', c.id, 'cart-test-p2-hwp2', 500, 4
  from public.market_subproduct_categories c where c.workspace_subject = 'english' and c.slug = 'question_hwp';
  v_e := pg_temp.eval1(a, 'subproduct', hwp);
  assert (v_e->>'chargedCredits')::int = 500 and v_e->>'upgradeBaseOrderId' is null, 'N12 two active hwp → full price';
  update public.market_item_subproducts set is_active = false where id = 'ca7e0002-0000-4000-8000-0000000000a4';
  assert (pg_temp.eval1(a, 'subproduct', hwp)->>'chargedCredits')::int = 200, 'inactive second hwp ignored';

  -- (b) HWP에 PDF 파일 없음
  update public.market_subproduct_files set is_active = false where id = 'ca7e0002-0000-4000-8000-0000000000f3';
  assert (pg_temp.eval1(a, 'subproduct', hwp)->>'chargedCredits')::int = 500, 'N12 hwp without pdf → full price';
  update public.market_subproduct_files set is_active = true where id = 'ca7e0002-0000-4000-8000-0000000000f3';

  -- (c) 차액 0, 음수
  update public.market_item_subproducts set price_credits = 500 where id = 'ca7e0002-0000-4000-8000-0000000000a1';
  assert (pg_temp.eval1(a, 'subproduct', hwp)->>'chargedCredits')::int = 500, 'N12 diff = 0 → full price';
  update public.market_item_subproducts set price_credits = 600 where id = 'ca7e0002-0000-4000-8000-0000000000a1';
  assert (pg_temp.eval1(a, 'subproduct', hwp)->>'chargedCredits')::int = 500, 'N12 diff < 0 → full price';
end;
$$;
rollback to savepoint s5e;
rollback to savepoint s5;

-- 6. cart 모드: T24(영/국 혼합), T16, T12(cart 삭제 후 같은 키), 미선택·미포함 행 보존, is_selected 무시
savepoint s6;
insert into public.market_cart_items (id, user_id, target_kind, subproduct_id, bundle_option_id, is_selected)
values
  ('ca7e0002-0000-4000-8000-0000000000d1', 'ca7e0002-0000-4000-8000-00000000000a', 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a1', null, false),
  ('ca7e0002-0000-4000-8000-0000000000d2', 'ca7e0002-0000-4000-8000-00000000000a', 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a9', null, true),
  ('ca7e0002-0000-4000-8000-0000000000d3', 'ca7e0002-0000-4000-8000-00000000000a', 'bundle', null, 'ca7e0002-0000-4000-8000-0000000000b1', true);
do $$
declare
  a constant uuid := 'ca7e0002-0000-4000-8000-00000000000a';
  k constant uuid := 'ca7e0002-0000-4000-9000-000000000601';
  v_lines constant jsonb := '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d2", "expectedCredits": 200},
                              {"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": 300}]';
  v_r jsonb;
  v_replay jsonb;
  v_after jsonb;
begin
  v_r := pg_temp.cart(a, v_lines, k);
  assert v_r->>'ok' = 'true' and v_r->>'mode' = 'cart', format('cart checkout ok: %s', v_r);
  assert (v_r->>'totalCredits')::int = 500 and jsonb_array_length(v_r->'orders') = 2, 'receipt total 500, 2 children';

  -- T24: child 과목 = 상품 과목
  assert (select count(*) from public.market_purchase_orders o
          join public.market_items i on i.id = o.item_id
          where o.checkout_batch_id = (v_r->>'batchId')::uuid and o.workspace_subject = i.workspace_subject) = 2,
    'T24 child subject matches item';
  assert (select array_agg(workspace_subject order by workspace_subject) from public.market_purchase_orders
          where checkout_batch_id = (v_r->>'batchId')::uuid) = array['english', 'korean'], 'T24 english + korean';

  -- T16: child별 소비 합 = 청구액, 총합 = total
  assert (select bool_and((select sum((c->>'amount')::int) from jsonb_array_elements(o.credit_consumptions) c) = o.charged_credits)
          from public.market_purchase_orders o where o.checkout_batch_id = (v_r->>'batchId')::uuid),
    'T16 per-child consumptions';
  assert (select sum(charged_credits) from public.market_purchase_orders where checkout_batch_id = (v_r->>'batchId')::uuid)
         = (select total_credits from public.market_checkout_batches where id = (v_r->>'batchId')::uuid), 'T16 total';
  assert (select count(*) from public.credit_transactions where user_id = a and type = 'consume') = 2,
    'one consume transaction per child';

  -- 구매된 행만 삭제 (is_selected=false 행도 명시 ID면 구매, 미포함 번들 행 보존)
  assert (select array_agg(id) from public.market_cart_items where user_id = a) = array['ca7e0002-0000-4000-8000-0000000000d3'::uuid],
    'only purchased cart rows deleted';
  assert (select request_payload->'lines'->0->>'cartItemId' from public.market_checkout_batches where id = (v_r->>'batchId')::uuid)
         = 'ca7e0002-0000-4000-8000-0000000000d1', '3.2 cart payload sorted by cartItemId';

  -- T12: cart 행 삭제 후 같은 키 → CART_CHANGED가 아니라 같은 영수증
  v_after := pg_temp.state(a);
  v_replay := pg_temp.cart(a, v_lines, k);
  assert v_replay->>'alreadyCompleted' = 'true' and v_replay->>'batchId' = v_r->>'batchId'
         and v_replay->'orders' = v_r->'orders', format('T12 replay: %s', v_replay);
  assert pg_temp.state(a) = v_after, 'T12 replay writes nothing';

  -- 정규화: cartItemId 대문자·줄 순서 반대로 보내도 같은 payload → replay
  v_replay := pg_temp.cart(a, '[{"cartItemId": "CA7E0002-0000-4000-8000-0000000000D1", "expectedCredits": 300},
                                {"cartItemId": "CA7E0002-0000-4000-8000-0000000000D2", "expectedCredits": 200}]', k);
  assert v_replay->>'alreadyCompleted' = 'true' and v_replay->>'batchId' = v_r->>'batchId',
    format('uppercase/reordered cart ids replay: %s', v_replay);
  assert pg_temp.state(a) = v_after, 'uppercase/reordered replay writes nothing';
end;
$$;
rollback to savepoint s6;

-- 7. N5: 확인 후 삭제된 cart ID / 타인 cart ID → CART_CHANGED(missingIds), 차감 0
savepoint s7;
insert into public.market_cart_items (id, user_id, target_kind, subproduct_id)
values
  ('ca7e0002-0000-4000-8000-0000000000d1', 'ca7e0002-0000-4000-8000-00000000000a', 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a1'),
  ('ca7e0002-0000-4000-8000-0000000000d9', 'ca7e0002-0000-4000-8000-00000000000b', 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a9');
do $$
declare
  a constant uuid := 'ca7e0002-0000-4000-8000-00000000000a';
  v_before jsonb;
  v_r jsonb;
begin
  delete from public.market_cart_items where id = 'ca7e0002-0000-4000-8000-0000000000d1';
  v_before := pg_temp.state(a);
  v_r := pg_temp.cart(a, '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": 300}]',
                      'ca7e0002-0000-4000-9000-000000000701');
  assert v_r->>'code' = 'CART_CHANGED' and v_r->'missingIds' = '["ca7e0002-0000-4000-8000-0000000000d1"]', format('N5: %s', v_r);

  v_r := pg_temp.cart(a, '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d9", "expectedCredits": 200}]',
                      'ca7e0002-0000-4000-9000-000000000702');
  assert v_r->>'code' = 'CART_CHANGED', 'other user cart id is missing for A';
  assert pg_temp.state(a) = v_before, 'N5 no writes';
  assert exists (select 1 from public.market_cart_items where id = 'ca7e0002-0000-4000-8000-0000000000d9'), 'B row untouched';
end;
$$;
rollback to savepoint s7;

-- 8. T06(판매 중지 포함 → 전체 거절), T07(가격·파일 변경 → PRICE_CHANGED + 최신 가격)
savepoint s8;
insert into public.market_cart_items (id, user_id, target_kind, subproduct_id)
values
  ('ca7e0002-0000-4000-8000-0000000000d1', 'ca7e0002-0000-4000-8000-00000000000a', 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a1'),
  ('ca7e0002-0000-4000-8000-0000000000d2', 'ca7e0002-0000-4000-8000-00000000000a', 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a9');
do $$
declare
  a constant uuid := 'ca7e0002-0000-4000-8000-00000000000a';
  v_lines constant jsonb := '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": 300},
                              {"cartItemId": "ca7e0002-0000-4000-8000-0000000000d2", "expectedCredits": 200}]';
  v_before jsonb := pg_temp.state(a);
  v_r jsonb;
begin
  -- T06: B(국어 PDF) 판매 중지
  update public.market_item_subproducts set is_active = false where id = 'ca7e0002-0000-4000-8000-0000000000a9';
  v_r := pg_temp.cart(a, v_lines, 'ca7e0002-0000-4000-9000-000000000801');
  assert v_r->>'code' = 'PRICE_CHANGED', format('T06: %s', v_r);
  assert (select x->>'reason' from jsonb_array_elements(v_r->'items') x
          where x->>'cartItemId' = 'ca7e0002-0000-4000-8000-0000000000d2') = 'UNAVAILABLE', 'T06 reason';
  assert pg_temp.state(a) = v_before, 'T06: no charge, no order, cart kept';
  update public.market_item_subproducts set is_active = true where id = 'ca7e0002-0000-4000-8000-0000000000a9';

  -- 상품 비게시도 판매 중지
  update public.market_items set status = 'hidden' where id = 'ca7e0002-0000-4000-8000-0000000000e2';
  assert pg_temp.cart(a, v_lines, 'ca7e0002-0000-4000-9000-000000000802')->>'code' = 'PRICE_CHANGED', 'unpublished item';
  update public.market_items set status = 'published' where id = 'ca7e0002-0000-4000-8000-0000000000e2';

  -- T07: 가격 변경 → 최신 가격 반환
  update public.market_item_subproducts set price_credits = 350 where id = 'ca7e0002-0000-4000-8000-0000000000a1';
  v_r := pg_temp.cart(a, v_lines, 'ca7e0002-0000-4000-9000-000000000803');
  assert v_r->>'code' = 'PRICE_CHANGED'
         and (select (x->>'chargedCredits')::int from jsonb_array_elements(v_r->'items') x
              where x->>'cartItemId' = 'ca7e0002-0000-4000-8000-0000000000d1') = 350, format('T07 price: %s', v_r);
  update public.market_item_subproducts set price_credits = 300 where id = 'ca7e0002-0000-4000-8000-0000000000a1';

  -- T07: 파일 비활성 → 판매 불가
  update public.market_subproduct_files set is_active = false where id = 'ca7e0002-0000-4000-8000-0000000000f1';
  assert pg_temp.cart(a, v_lines, 'ca7e0002-0000-4000-9000-000000000804')->>'code' = 'PRICE_CHANGED', 'T07 file removed';
  update public.market_subproduct_files set is_active = true where id = 'ca7e0002-0000-4000-8000-0000000000f1';

  assert pg_temp.state(a) = v_before, 'T07: no writes';

  -- 복원 후 같은 입력으로 성공 (가격 비교 기준은 확인한 가격)
  assert pg_temp.cart(a, v_lines, 'ca7e0002-0000-4000-9000-000000000805')->>'ok' = 'true', 'succeeds after restore';
end;
$$;
rollback to savepoint s8;

-- 9. T18: PDF + PDF 포함 HWP / 번들 + 개별 → CONFLICTING_SELECTION (cart ID 순서를 바꿔 2회)
savepoint s9;
do $$
declare
  a constant uuid := 'ca7e0002-0000-4000-8000-00000000000a';
  v_case record;
  v_r jsonb;
  v_before jsonb;
begin
  for v_case in
    select * from (values
      ('ca7e0002-0000-4000-8000-0000000000d1'::uuid, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a1'::uuid, 300,
       'ca7e0002-0000-4000-8000-0000000000d2'::uuid, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a2'::uuid, 500),
      ('ca7e0002-0000-4000-8000-0000000000d4'::uuid, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a1'::uuid, 300,
       'ca7e0002-0000-4000-8000-0000000000d3'::uuid, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a2'::uuid, 500),
      ('ca7e0002-0000-4000-8000-0000000000d5'::uuid, 'bundle', 'ca7e0002-0000-4000-8000-0000000000b1'::uuid, 1000,
       'ca7e0002-0000-4000-8000-0000000000d6'::uuid, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a1'::uuid, 300),
      ('ca7e0002-0000-4000-8000-0000000000d8'::uuid, 'bundle', 'ca7e0002-0000-4000-8000-0000000000b1'::uuid, 1000,
       'ca7e0002-0000-4000-8000-0000000000d7'::uuid, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a1'::uuid, 300)
    ) as t(id1, kind1, target1, price1, id2, kind2, target2, price2)
  loop
    delete from public.market_cart_items where user_id = a;
    insert into public.market_cart_items (id, user_id, target_kind, subproduct_id, bundle_option_id)
    values
      (v_case.id1, a, v_case.kind1,
       case when v_case.kind1 = 'subproduct' then v_case.target1 end, case when v_case.kind1 = 'bundle' then v_case.target1 end),
      (v_case.id2, a, v_case.kind2,
       case when v_case.kind2 = 'subproduct' then v_case.target2 end, case when v_case.kind2 = 'bundle' then v_case.target2 end);
    v_before := pg_temp.state(a);
    v_r := pg_temp.cart(a, jsonb_build_array(
      jsonb_build_object('cartItemId', v_case.id1, 'expectedCredits', v_case.price1),
      jsonb_build_object('cartItemId', v_case.id2, 'expectedCredits', v_case.price2)
    ), gen_random_uuid());
    assert v_r->>'code' = 'CONFLICTING_SELECTION' and v_r->'itemIds' = '["ca7e0002-0000-4000-8000-0000000000e1"]',
      format('T18 %s/%s: %s', v_case.id1, v_case.id2, v_r);
    assert pg_temp.state(a) = v_before, 'T18 no writes';
  end loop;

  -- PDF 파일 없는 HWP와 PDF는 함께 구매 가능 (각각 정가)
  update public.market_subproduct_files set is_active = false where id = 'ca7e0002-0000-4000-8000-0000000000f3';
  delete from public.market_cart_items where user_id = a;
  insert into public.market_cart_items (id, user_id, target_kind, subproduct_id)
  values
    ('ca7e0002-0000-4000-8000-0000000000d1', a, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a1'),
    ('ca7e0002-0000-4000-8000-0000000000d2', a, 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a2');
  v_r := pg_temp.cart(a, '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": 300},
                           {"cartItemId": "ca7e0002-0000-4000-8000-0000000000d2", "expectedCredits": 500}]', gen_random_uuid());
  assert v_r->>'ok' = 'true' and (v_r->>'totalCredits')::int = 800, format('pdf + hwp without pdf allowed: %s', v_r);
end;
$$;
rollback to savepoint s9;

-- 10. T17·T40: 만료 과거/미래/NULL·pending_refund 조합에서 8단계 합계 = get_credit_balance_snapshot 사용 가능액
savepoint s10;
insert into public.credit_sources (id, user_id, initial_credits, remaining_credits, status, source_category, expires_at)
values
  ('ca7e0002-0000-4000-8000-0000000000c2', 'ca7e0002-0000-4000-8000-00000000000c', 100, 100, 'active', 'admin_grant', now() - interval '1 day'),
  ('ca7e0002-0000-4000-8000-0000000000c3', 'ca7e0002-0000-4000-8000-00000000000c', 100, 100, 'active', 'admin_grant', now() + interval '1 day'),
  ('ca7e0002-0000-4000-8000-0000000000c4', 'ca7e0002-0000-4000-8000-00000000000c', 100, 100, 'active', 'admin_grant', null),
  ('ca7e0002-0000-4000-8000-0000000000c5', 'ca7e0002-0000-4000-8000-00000000000c', 500, 500, 'pending_refund', 'admin_grant', null);
do $$
declare
  c constant uuid := 'ca7e0002-0000-4000-8000-00000000000c';
  v_spendable integer := (public.get_credit_balance_snapshot(c)->>'spendable_balance')::int;
  v_before jsonb := pg_temp.state(c);
  v_r jsonb;
begin
  assert v_spendable = 200, format('snapshot spendable = 200 (got %s)', v_spendable);

  -- 부족: 300 > 200 → 쓰기 전 INSUFFICIENT_CREDITS(balance = 스냅샷 사용 가능액)
  v_r := pg_temp.direct(c, 'ca7e0002-0000-4000-8000-0000000000e1', 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a1', 300,
                        'ca7e0002-0000-4000-9000-000000001001');
  assert v_r->>'code' = 'INSUFFICIENT_CREDITS' and (v_r->>'balance')::int = v_spendable and (v_r->>'shortfall')::int = 100,
    format('T17 insufficient: %s', v_r);
  assert pg_temp.state(c) = v_before, 'T17 no writes';

  -- 통과: 200 = 200 → consume 부족 없이 체결, 유효 소스만 차감
  v_r := pg_temp.direct(c, 'ca7e0002-0000-4000-8000-0000000000e2', 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a9', 200,
                        'ca7e0002-0000-4000-9000-000000001002');
  assert v_r->>'ok' = 'true', format('T40 pass → consume ok: %s', v_r);
  assert (select remaining_credits from public.credit_sources where id = 'ca7e0002-0000-4000-8000-0000000000c2') = 100, 'expired untouched';
  assert (select remaining_credits from public.credit_sources where id = 'ca7e0002-0000-4000-8000-0000000000c5') = 500, 'pending_refund untouched';
  assert (select sum(remaining_credits) from public.credit_sources
          where id in ('ca7e0002-0000-4000-8000-0000000000c3', 'ca7e0002-0000-4000-8000-0000000000c4')) = 0, 'valid sources consumed';
end;
$$;
rollback to savepoint s10;

-- 11. 실패 주입 (fixture 사용자 A에게만 RAISE하는 임시 trigger)
create function public.cart_test_p2_inject() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'market_checkout_batches' and new.user_id = 'ca7e0002-0000-4000-8000-00000000000a' then
    -- 8단계 통과 후 소스를 비워 consume_credits가 INSUFFICIENT_CREDITS를 내게 한다
    update public.credit_sources set remaining_credits = 0 where user_id = new.user_id;
  elsif tg_table_name = 'market_entitlements' and new.user_id = 'ca7e0002-0000-4000-8000-00000000000a' then
    raise exception 'cart-test-injected-entitlement';
  elsif tg_table_name = 'market_purchase_orders' and new.user_id = 'ca7e0002-0000-4000-8000-00000000000a' then
    raise exception using errcode = '40P01', message = 'cart-test-injected-deadlock';
  elsif tg_table_name = 'credit_consumption' and new.user_id = 'ca7e0002-0000-4000-8000-00000000000a' then
    raise exception 'cart-test-injected-consume';
  end if;
  return new;
end;
$$;

insert into public.market_cart_items (id, user_id, target_kind, subproduct_id)
values
  ('ca7e0002-0000-4000-8000-0000000000d1', 'ca7e0002-0000-4000-8000-00000000000a', 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a1'),
  ('ca7e0002-0000-4000-8000-0000000000d2', 'ca7e0002-0000-4000-8000-00000000000a', 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a9');

create function pg_temp.expect_error(p_label text, p_key uuid, p_state text, p_message text) returns void
language plpgsql as $$
declare
  a constant uuid := 'ca7e0002-0000-4000-8000-00000000000a';
  v_before jsonb := pg_temp.state(a);
  v_state text;
  v_message text;
begin
  begin
    perform pg_temp.cart(a, '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": 300},
                              {"cartItemId": "ca7e0002-0000-4000-8000-0000000000d2", "expectedCredits": 200}]', p_key);
    v_state := 'no error';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  assert v_state = p_state and v_message = p_message,
    format('%s: expected %s/%s, got %s/%s', p_label, p_state, p_message, v_state, v_message);
  assert pg_temp.state(a) = v_before, format('%s: ledger/balance/orders/entitlements/cart/batch unchanged', p_label);
end;
$$;

-- consume 부족 → P0402
savepoint s11a;
create trigger cart_test_p2_inject after insert on public.market_checkout_batches
  for each row execute function public.cart_test_p2_inject();
select pg_temp.expect_error('P0402 injection', 'ca7e0002-0000-4000-9000-000000001101', 'P0402', 'INSUFFICIENT_CREDITS');
drop trigger cart_test_p2_inject on public.market_checkout_batches;
rollback to savepoint s11a;

-- T15: entitlement INSERT 실패 → 전체 롤백, 원래 SQLSTATE(P0001)·메시지 보존
savepoint s11b;
create trigger cart_test_p2_inject before insert on public.market_entitlements
  for each row execute function public.cart_test_p2_inject();
select pg_temp.expect_error('T15 entitlement failure', 'ca7e0002-0000-4000-9000-000000001102', 'P0001', 'cart-test-injected-entitlement');
drop trigger cart_test_p2_inject on public.market_entitlements;
rollback to savepoint s11b;

-- 40P01 주입 → 전체 롤백, SQLSTATE 보존(route 재시도 대상)
savepoint s11c;
create trigger cart_test_p2_inject before insert on public.market_purchase_orders
  for each row execute function public.cart_test_p2_inject();
select pg_temp.expect_error('40P01 injection', 'ca7e0002-0000-4000-9000-000000001103', '40P01', 'cart-test-injected-deadlock');
drop trigger cart_test_p2_inject on public.market_purchase_orders;
rollback to savepoint s11c;

-- consume_credits 내부의 다른 RAISE → 핸들러가 ELSE RAISE로 원래 오류 보존
savepoint s11d;
create trigger cart_test_p2_inject before insert on public.credit_consumption
  for each row execute function public.cart_test_p2_inject();
select pg_temp.expect_error('other raise in consume', 'ca7e0002-0000-4000-9000-000000001104', 'P0001', 'cart-test-injected-consume');
drop trigger cart_test_p2_inject on public.credit_consumption;
rollback to savepoint s11d;

-- 주입 없이 같은 입력은 성공 (주입 실패가 batch·키를 남기지 않았음)
do $$
begin
  assert pg_temp.cart('ca7e0002-0000-4000-8000-00000000000a',
    '[{"cartItemId": "ca7e0002-0000-4000-8000-0000000000d1", "expectedCredits": 300},
      {"cartItemId": "ca7e0002-0000-4000-8000-0000000000d2", "expectedCredits": 200}]',
    'ca7e0002-0000-4000-9000-000000001101')->>'ok' = 'true', 'same key succeeds after injected failures';
end;
$$;

drop function public.cart_test_p2_inject();

-- 12. direct 다중 줄 D-M1~D-M10 (docs/cart-detail-multiselect-plan.md 3절·7절)
-- 사용자 B(…00b, 10000 크레딧 소스 …0c6)와 E1의 세 번째 서브상품 …0a3(cart-test-p2-etc 150, hwp 파일 f4)을 쓴다.
-- 11절 마지막 성공 구매로 A가 PDF를 보유하게 되므로 B로 격리한다. 각 절은 savepoint s12로 되돌린다.
insert into public.market_subproduct_categories (id, workspace_subject, name, slug)
values ('ca7e0002-0000-4000-8000-0000000000ca', 'english', 'cart-test-p2-etc', 'cart-test-p2-etc');
insert into public.market_item_subproducts (id, item_id, workspace_subject, category_id, title, price_credits, sort_order, is_active)
values ('ca7e0002-0000-4000-8000-0000000000a3', 'ca7e0002-0000-4000-8000-0000000000e1', 'english',
        'ca7e0002-0000-4000-8000-0000000000ca', 'cart-test-p2-etc', 150, 3, true);
insert into public.market_subproduct_files (id, item_id, subproduct_id, workspace_subject, file_type_id, storage_bucket, storage_path, original_file_name)
select 'ca7e0002-0000-4000-8000-0000000000f4', 'ca7e0002-0000-4000-8000-0000000000e1', 'ca7e0002-0000-4000-8000-0000000000a3',
       'english', ft.id, 'market-files', 'cart-test-p2/f4', 'cart-test-p2.hwp'
from public.market_file_types ft where ft.workspace_subject = 'english' and ft.code = 'hwp';
insert into public.credit_sources (id, user_id, initial_credits, remaining_credits, status, source_category)
values ('ca7e0002-0000-4000-8000-0000000000c6', 'ca7e0002-0000-4000-8000-00000000000b', 10000, 10000, 'active', 'admin_grant');
insert into public.market_cart_items (id, user_id, target_kind, subproduct_id)
values ('ca7e0002-0000-4000-8000-0000000000db', 'ca7e0002-0000-4000-8000-00000000000b', 'subproduct', 'ca7e0002-0000-4000-8000-0000000000a1');

create function pg_temp.dl(p_kind text, p_target text, p_expected bigint, p_ack boolean default false) returns jsonb
language sql as $$
  select jsonb_build_object('targetKind', p_kind, 'targetId', p_target, 'expectedCredits', p_expected, 'acknowledgeNoDiscount', p_ack)
$$;

create function pg_temp.dlines(p_lines jsonb, p_key uuid, p_item uuid default 'ca7e0002-0000-4000-8000-0000000000e1') returns jsonb
language sql as $$
  select public.checkout_market_selection('ca7e0002-0000-4000-8000-00000000000b', 'direct', p_item, p_lines, p_key)
$$;

savepoint s12;

-- D-M1: 서브상품 2건 성공(입력 역순) / D-M2: 역순·대문자 같은 키 replay
do $$
declare
  b constant uuid := 'ca7e0002-0000-4000-8000-00000000000b';
  e1 constant uuid := 'ca7e0002-0000-4000-8000-0000000000e1';
  pdf constant uuid := 'ca7e0002-0000-4000-8000-0000000000a1';
  etc constant uuid := 'ca7e0002-0000-4000-8000-0000000000a3';
  k constant uuid := 'ca7e0002-0000-4000-9000-000000001201';
  v_r jsonb;
  v_replay jsonb;
  v_batch uuid;
  v_before_replay jsonb;
begin
  v_r := pg_temp.dlines(jsonb_build_array(pg_temp.dl('subproduct', etc::text, 150), pg_temp.dl('subproduct', pdf::text, 300)), k);
  assert v_r->>'ok' = 'true' and v_r->>'mode' = 'direct' and (v_r->>'totalCredits')::int = 450
         and jsonb_array_length(v_r->'orders') = 2, format('D-M1 ok: %s', v_r);
  v_batch := (v_r->>'batchId')::uuid;
  assert v_r->'orders'->0->>'targetId' = pdf::text and v_r->'orders'->1->>'targetId' = etc::text,
    'D-M1 child order follows sorted payload';
  assert (select mode from public.market_checkout_batches where id = v_batch) = 'direct', 'D-M1 batch mode direct';
  assert (select count(*) from public.market_purchase_orders where checkout_batch_id = v_batch and idempotency_key is null) = 2,
    'D-M1 two child orders';
  assert (select count(*) from public.market_purchase_orders o
          join public.market_purchase_lines l on l.order_id = o.id
          where o.checkout_batch_id = v_batch
            and ((l.subproduct_id = pdf and o.charged_credits = 300) or (l.subproduct_id = etc and o.charged_credits = 150))) = 2,
    'D-M1 per-line charged_credits';
  assert (select bool_and((select sum((c->>'amount')::int) from jsonb_array_elements(o.credit_consumptions) c) = o.charged_credits)
          from public.market_purchase_orders o where o.checkout_batch_id = v_batch), 'D-M1 per-child consumptions';
  assert (select sum(charged_credits) from public.market_purchase_orders where checkout_batch_id = v_batch)
         = (select total_credits from public.market_checkout_batches where id = v_batch), 'D-M1 sum = total_credits';
  assert (select count(*) from public.market_entitlements e
          join public.market_purchase_orders o on o.id = e.source_order_id
          where o.checkout_batch_id = v_batch and e.scope = 'subproduct' and e.status = 'active') = 2, 'D-M1 two entitlements';
  assert (select array_agg(id) from public.market_cart_items where user_id = b) = array['ca7e0002-0000-4000-8000-0000000000db'::uuid],
    'D-M1 cart untouched';
  assert (select request_payload from public.market_checkout_batches where id = v_batch)
         = jsonb_build_object('mode', 'direct', 'itemId', e1, 'lines', jsonb_build_array(
             jsonb_build_object('targetKind', 'subproduct', 'targetId', pdf, 'expectedCredits', 300, 'ack', false),
             jsonb_build_object('targetKind', 'subproduct', 'targetId', etc, 'expectedCredits', 150, 'ack', false))),
    'D-M1 normalized payload sorted by targetKind, targetId';

  v_before_replay := pg_temp.state(b);
  v_replay := pg_temp.dlines(jsonb_build_array(
    jsonb_build_object('targetKind', 'subproduct', 'targetId', upper(pdf::text), 'expectedCredits', 300),
    pg_temp.dl('subproduct', upper(etc::text), 150)), k);
  assert v_replay->>'alreadyCompleted' = 'true' and v_replay->>'batchId' = v_r->>'batchId'
         and v_replay->'orders' = v_r->'orders', format('D-M2 replay: %s', v_replay);
  assert pg_temp.state(b) = v_before_replay, 'D-M2 replay writes nothing';
end;
$$;
rollback to savepoint s12;

-- D-M3: 중복 target / 51줄 / 합계 overflow → INVALID_INPUT
do $$
declare
  b constant uuid := 'ca7e0002-0000-4000-8000-00000000000b';
  pdf constant text := 'ca7e0002-0000-4000-8000-0000000000a1';
  etc constant text := 'ca7e0002-0000-4000-8000-0000000000a3';
  k constant uuid := 'ca7e0002-0000-4000-9000-000000001203';
  v_before jsonb := pg_temp.state(b);
  v_bad jsonb;
begin
  foreach v_bad in array array[
    jsonb_build_array(pg_temp.dl('subproduct', pdf, 300), pg_temp.dl('subproduct', pdf, 300)),
    jsonb_build_array(pg_temp.dl('subproduct', pdf, 300), pg_temp.dl('subproduct', upper(pdf), 300)),
    (select jsonb_agg(pg_temp.dl('subproduct', gen_random_uuid()::text, 1)) from generate_series(1, 51)),
    jsonb_build_array(pg_temp.dl('subproduct', pdf, 2147483647), pg_temp.dl('subproduct', etc, 1))
  ] loop
    assert pg_temp.dlines(v_bad, k)->>'code' = 'INVALID_INPUT', format('D-M3 INVALID_INPUT for %s', left(v_bad::text, 80));
  end loop;
  assert pg_temp.state(b) = v_before, 'D-M3 no writes';
end;
$$;
rollback to savepoint s12;

-- D-M4: 번들+서브상품, PDF+PDF 포함 HWP(순서 2가지) → CONFLICTING_SELECTION
do $$
declare
  b constant uuid := 'ca7e0002-0000-4000-8000-00000000000b';
  pdf constant text := 'ca7e0002-0000-4000-8000-0000000000a1';
  hwp constant text := 'ca7e0002-0000-4000-8000-0000000000a2';
  bundle constant text := 'ca7e0002-0000-4000-8000-0000000000b1';
  v_before jsonb := pg_temp.state(b);
  v_lines jsonb;
  v_r jsonb;
begin
  foreach v_lines in array array[
    jsonb_build_array(pg_temp.dl('bundle', bundle, 1000), pg_temp.dl('subproduct', pdf, 300)),
    jsonb_build_array(pg_temp.dl('subproduct', pdf, 300), pg_temp.dl('bundle', bundle, 1000)),
    jsonb_build_array(pg_temp.dl('subproduct', pdf, 300), pg_temp.dl('subproduct', hwp, 500)),
    jsonb_build_array(pg_temp.dl('subproduct', hwp, 500), pg_temp.dl('subproduct', pdf, 300))
  ] loop
    v_r := pg_temp.dlines(v_lines, gen_random_uuid());
    assert v_r->>'code' = 'CONFLICTING_SELECTION' and v_r->'itemIds' = '["ca7e0002-0000-4000-8000-0000000000e1"]',
      format('D-M4 %s: %s', v_lines, v_r);
  end loop;
  assert pg_temp.state(b) = v_before, 'D-M4 no writes';
end;
$$;
rollback to savepoint s12;

-- D-M5 가격 불일치 / D-M6 한 줄 보유 / D-M7 다른 상품 target / D-M8 합계만 잔액 초과
do $$
declare
  b constant uuid := 'ca7e0002-0000-4000-8000-00000000000b';
  pdf constant text := 'ca7e0002-0000-4000-8000-0000000000a1';
  etc constant text := 'ca7e0002-0000-4000-8000-0000000000a3';
  kpdf constant text := 'ca7e0002-0000-4000-8000-0000000000a9';
  v_before jsonb := pg_temp.state(b);
  v_r jsonb;
begin
  -- D-M5
  v_r := pg_temp.dlines(jsonb_build_array(pg_temp.dl('subproduct', pdf, 300), pg_temp.dl('subproduct', etc, 999)), gen_random_uuid());
  assert v_r->>'code' = 'PRICE_CHANGED' and jsonb_array_length(v_r->'items') = 2
         and (select (x->>'chargedCredits')::int from jsonb_array_elements(v_r->'items') x where x->>'targetId' = etc) = 150
         and (select (x->>'chargedCredits')::int from jsonb_array_elements(v_r->'items') x where x->>'targetId' = pdf) = 300,
    format('D-M5: %s', v_r);
  assert pg_temp.state(b) = v_before, 'D-M5 no writes';

  -- D-M7
  v_r := pg_temp.dlines(jsonb_build_array(pg_temp.dl('subproduct', pdf, 300), pg_temp.dl('subproduct', kpdf, 200)), gen_random_uuid());
  assert v_r->>'code' = 'NOT_FOUND', format('D-M7: %s', v_r);
  assert pg_temp.state(b) = v_before, 'D-M7 no writes';

  -- D-M8: 각 줄(300·150)은 잔액 400 이하, 합계 450은 초과
  update public.credit_sources set remaining_credits = 400 where id = 'ca7e0002-0000-4000-8000-0000000000c6';
  v_before := pg_temp.state(b);
  v_r := pg_temp.dlines(jsonb_build_array(pg_temp.dl('subproduct', pdf, 300), pg_temp.dl('subproduct', etc, 150)), gen_random_uuid());
  assert v_r->>'code' = 'INSUFFICIENT_CREDITS' and (v_r->>'balance')::int = 400 and (v_r->>'shortfall')::int = 50,
    format('D-M8: %s', v_r);
  assert pg_temp.state(b) = v_before, 'D-M8 no writes';
  update public.credit_sources set remaining_credits = 10000 where id = 'ca7e0002-0000-4000-8000-0000000000c6';

  -- D-M6
  assert pg_temp.dlines(jsonb_build_array(pg_temp.dl('subproduct', etc, 150)), gen_random_uuid())->>'ok' = 'true', 'D-M6 buy etc';
  v_before := pg_temp.state(b);
  v_r := pg_temp.dlines(jsonb_build_array(pg_temp.dl('subproduct', pdf, 300), pg_temp.dl('subproduct', etc, 150)), gen_random_uuid());
  assert v_r->>'code' = 'ALREADY_OWNED' and jsonb_array_length(v_r->'lines') = 1 and v_r->'lines'->0->>'targetId' = etc,
    format('D-M6: %s', v_r);
  assert pg_temp.state(b) = v_before, 'D-M6 no writes';
end;
$$;
rollback to savepoint s12;

-- D-M9: 두 번째 child의 entitlement INSERT 실패 → 전체 롤백(T15 direct 판)
create function public.cart_test_p2_inject_second() returns trigger language plpgsql as $$
begin
  if new.user_id = 'ca7e0002-0000-4000-8000-00000000000b' and exists (
    select 1
    from public.market_entitlements e
    join public.market_purchase_orders o on o.id = e.source_order_id
    where o.checkout_batch_id = (select checkout_batch_id from public.market_purchase_orders where id = new.source_order_id)
  ) then
    raise exception 'cart-test-injected-second-entitlement';
  end if;
  return new;
end;
$$;
create trigger cart_test_p2_inject_second before insert on public.market_entitlements
  for each row execute function public.cart_test_p2_inject_second();
do $$
declare
  b constant uuid := 'ca7e0002-0000-4000-8000-00000000000b';
  v_before jsonb := pg_temp.state(b);
  v_remaining integer := (select remaining_credits from public.credit_sources where id = 'ca7e0002-0000-4000-8000-0000000000c6');
  v_state text;
  v_message text;
begin
  begin
    perform pg_temp.dlines(jsonb_build_array(
      pg_temp.dl('subproduct', 'ca7e0002-0000-4000-8000-0000000000a1', 300),
      pg_temp.dl('subproduct', 'ca7e0002-0000-4000-8000-0000000000a3', 150)), 'ca7e0002-0000-4000-9000-000000001209');
    v_state := 'no error';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  assert v_state = 'P0001' and v_message = 'cart-test-injected-second-entitlement',
    format('D-M9: expected P0001/cart-test-injected-second-entitlement, got %s/%s', v_state, v_message);
  assert pg_temp.state(b) = v_before, 'D-M9 ledger/balance/orders/entitlements/cart/batch unchanged';
  assert (select remaining_credits from public.credit_sources where id = 'ca7e0002-0000-4000-8000-0000000000c6') = v_remaining,
    'D-M9 source balance unchanged';
end;
$$;
drop trigger cart_test_p2_inject_second on public.market_entitlements;
drop function public.cart_test_p2_inject_second();
rollback to savepoint s12;

-- D-M10: PDF 보유자가 HWP(차액)+다른 서브상품 → HWP child charged = 차액, upgradeBaseOrderId 기록
do $$
declare
  pdf constant text := 'ca7e0002-0000-4000-8000-0000000000a1';
  hwp constant text := 'ca7e0002-0000-4000-8000-0000000000a2';
  etc constant text := 'ca7e0002-0000-4000-8000-0000000000a3';
  v_r jsonb;
  v_pdf_order uuid;
  v_hwp jsonb;
begin
  v_r := pg_temp.dlines(jsonb_build_array(pg_temp.dl('subproduct', pdf, 300)), gen_random_uuid());
  assert v_r->>'ok' = 'true', format('D-M10 buy pdf: %s', v_r);
  v_pdf_order := (v_r->'orders'->0->>'orderId')::uuid;

  v_r := pg_temp.dlines(jsonb_build_array(pg_temp.dl('subproduct', etc, 150), pg_temp.dl('subproduct', hwp, 200)), gen_random_uuid());
  assert v_r->>'ok' = 'true' and (v_r->>'totalCredits')::int = 350, format('D-M10 hwp diff + etc: %s', v_r);
  select x into v_hwp from jsonb_array_elements(v_r->'orders') x where x->>'targetId' = hwp;
  assert (v_hwp->>'chargedCredits')::int = 200 and (v_hwp->>'originalCredits')::int = 500
         and (v_hwp->>'upgradeBaseOrderId')::uuid = v_pdf_order, format('D-M10 receipt: %s', v_hwp);
  assert (select charged_credits = 200 and original_price_credits = 500 from public.market_purchase_orders
          where id = (v_hwp->>'orderId')::uuid), 'D-M10 hwp child order prices';
  assert (select (x->>'upgradeBaseOrderId')::uuid from public.market_checkout_batches bt,
                 jsonb_array_elements(bt.result_payload->'orders') x
          where bt.id = (v_r->>'batchId')::uuid and x->>'targetId' = hwp) = v_pdf_order,
    'D-M10 upgradeBaseOrderId stored in receipt snapshot';
end;
$$;
rollback to savepoint s12;

do $$
begin
  raise notice 'market_checkout_rpc: all passed';
end;
$$;

rollback;
