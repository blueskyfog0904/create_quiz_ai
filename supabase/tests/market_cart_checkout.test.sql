-- 장바구니 Phase 1 SQL 테스트 (docs/cart-implementation-plan-v4.md 7절 P1-1·P1-3~P1-7·P1-9, 8절 T01·T04·T05·T30·N4·N13·N14)
-- pgTAP 없이 DO 블록 assert로 검증한다. 전부 begin … rollback 안에서 실행되고 fixture는
-- cart-test- 접두 사용자·상품과 아래 고정 UUID(ca7e0000-…)만 쓴다.
-- 실행: PG* 환경변수(PGHOST·PGPORT·PGUSER·PGPASSWORD·PGDATABASE) 또는 PGSERVICE로 접속 정보를 넘기고
--       psql -X -v ON_ERROR_STOP=1 -f supabase/tests/market_cart_checkout.test.sql
--       (첫 실패 assert에서 중단되고 rollback된다. 통과하면 마지막에 'market_cart_checkout: all passed' NOTICE)
-- 전제: 20260930020304_market_cart_checkout, 20260930020347_backfill_legacy_only_market_items 적용 후.
-- P1-2(동시성)는 supabase/tests/cart_concurrency.sh, P1-8(이력·재실행)은 적용 절차에서 확인한다.
--
-- fixture ID
--   사용자 A ca7e0000-0000-4000-8000-00000000000a / B ca7e0000-0000-4000-8000-00000000000b
--   상품 ca7e0000-0000-4000-8000-0000000000e1, 번들 ca7e0000-0000-4000-8000-0000000000b0
--   cart 행 c1(A)/c2(B), batch ba(B), 주문 d1(B)

begin;

set local plpgsql.check_asserts = on;

-- 0. fixture (postgres)
insert into auth.users (id, email, aud, role)
values
  ('ca7e0000-0000-4000-8000-00000000000a', 'cart-test-a@example.invalid', 'authenticated', 'authenticated'),
  ('ca7e0000-0000-4000-8000-00000000000b', 'cart-test-b@example.invalid', 'authenticated', 'authenticated');

insert into public.profiles (id, email)
values
  ('ca7e0000-0000-4000-8000-00000000000a', 'cart-test-a@example.invalid'),
  ('ca7e0000-0000-4000-8000-00000000000b', 'cart-test-b@example.invalid')
on conflict (id) do nothing;

insert into public.market_items (id, menu_entry_id, title, workspace_subject, status, is_active, published_at)
select 'ca7e0000-0000-4000-8000-0000000000e1', m.id, 'cart-test-item', m.workspace_subject, 'published', true, now()
from public.market_menu_entries m
where m.workspace_subject = 'english'
order by m.id
limit 1;

insert into public.market_item_subproducts (item_id, workspace_subject, category_id, title, price_credits, sort_order, is_active)
select 'ca7e0000-0000-4000-8000-0000000000e1', 'english', c.id,
       'cart-test-sp-' || lpad(g::text, 2, '0'), 100, g, true
from generate_series(1, 52) as g
cross join public.market_subproduct_categories c
where c.workspace_subject = 'english' and c.slug = 'question_pdf';

insert into public.market_item_subproducts (item_id, workspace_subject, category_id, title, price_credits, is_active)
select 'ca7e0000-0000-4000-8000-0000000000e1', 'english', c.id, 'cart-test-sp-inactive', 100, false
from public.market_subproduct_categories c
where c.workspace_subject = 'english' and c.slug = 'question_pdf';

insert into public.market_item_bundle_options (id, item_id, workspace_subject, label, price_credits, is_active)
values ('ca7e0000-0000-4000-8000-0000000000b0', 'ca7e0000-0000-4000-8000-0000000000e1', 'english', 'cart-test-bundle', 1000, true);

do $$
begin
  assert (select count(*) from public.profiles where id in (
    'ca7e0000-0000-4000-8000-00000000000a', 'ca7e0000-0000-4000-8000-00000000000b')) = 2,
    'fixture: 2 profiles';
  assert exists (select 1 from public.market_items where id = 'ca7e0000-0000-4000-8000-0000000000e1'),
    'fixture: item (english menu entry required)';
  assert (select count(*) from public.market_item_subproducts
          where item_id = 'ca7e0000-0000-4000-8000-0000000000e1') = 53,
    'fixture: 52 active + 1 inactive subproducts';
end;
$$;

-- 1. 구조·권한 (P1-3 권한, P1-4, P1-9, T30, N14)
do $$
declare
  t text;
  r text;
  p text;
  f text;
begin
  assert to_regclass('public.market_cart_items') is not null, 'market_cart_items exists';
  assert to_regclass('public.market_checkout_batches') is not null, 'market_checkout_batches exists';
  assert (select bool_and(relrowsecurity) from pg_class
          where oid in ('public.market_cart_items'::regclass, 'public.market_checkout_batches'::regclass)),
    'RLS enabled on new tables';

  assert exists (
    select 1 from pg_constraint
    where conname = 'market_purchase_orders_checkout_batch_id_fkey'
      and conrelid = 'public.market_purchase_orders'::regclass
      and confrelid = 'public.market_checkout_batches'::regclass
      and confdeltype = 'a'
  ), 'checkout_batch_id FK (NO ACTION)';

  assert (select count(*) from pg_policies
          where schemaname = 'public'
            and tablename in ('market_cart_items', 'market_checkout_batches')) = 2,
    'exactly one policy per new table';
  assert (select bool_and(cmd = 'SELECT' and roles = array['authenticated']::name[] and qual like '%auth.uid()%')
          from pg_policies
          where schemaname = 'public'
            and tablename in ('market_cart_items', 'market_checkout_batches')),
    'owner SELECT policies only';

  foreach t in array array['public.market_cart_items', 'public.market_checkout_batches'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      assert not has_table_privilege('anon', t, p), format('anon has no %s on %s', p, t);
    end loop;
    foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      assert not has_table_privilege('authenticated', t, p), format('authenticated has no %s on %s', p, t);
    end loop;
    assert has_table_privilege('authenticated', t, 'SELECT'), format('authenticated has SELECT on %s', t);
  end loop;

  foreach f in array array[
    'public.add_market_cart_item(uuid, text, uuid)',
    'public.set_market_cart_selection(uuid, uuid[], boolean)',
    'public.remove_market_cart_items(uuid, uuid[])'
  ] loop
    foreach r in array array['anon', 'authenticated'] loop
      assert not has_function_privilege(r, f, 'execute'), format('%s cannot execute %s', r, f);
    end loop;
    assert has_function_privilege('service_role', f, 'execute'), format('service_role can execute %s', f);
    assert (select prosecdef and provolatile = 'v'
                   and proconfig @> array['search_path=public, pg_temp']
            from pg_proc where oid = f::regprocedure),
      format('%s is SECURITY DEFINER, VOLATILE, search_path=public, pg_temp', f);
    assert pg_get_functiondef(f::regprocedure) like '%SECURITY DEFINER%', format('%s functiondef', f);
  end loop;

  assert not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace and proname in ('grant_credits', 'deduct_credits')
  ), 'P1-9: grant_credits/deduct_credits dropped';
end;
$$;

-- 2. P1-1 / T04: target CHECK
do $$
declare
  v_user uuid := 'ca7e0000-0000-4000-8000-00000000000a';
  v_sp uuid := (select id from public.market_item_subproducts where title = 'cart-test-sp-01');
  v_bundle uuid := 'ca7e0000-0000-4000-8000-0000000000b0';
  v_case text;
begin
  foreach v_case in array array['both', 'none', 'subproduct_with_bundle', 'bundle_with_subproduct', 'unknown_kind'] loop
    begin
      insert into public.market_cart_items (user_id, target_kind, subproduct_id, bundle_option_id)
      values (
        v_user,
        case v_case when 'bundle_with_subproduct' then 'bundle' when 'unknown_kind' then 'legacy' else 'subproduct' end,
        case when v_case in ('both', 'bundle_with_subproduct', 'unknown_kind') then v_sp end,
        case when v_case in ('both', 'subproduct_with_bundle') then v_bundle end
      );
      raise exception 'P1-1 %: expected 23514', v_case;
    exception when check_violation then
      null;
    end;
  end loop;
end;
$$;

-- 3. 담기·선택·삭제 RPC 단일 세션 (T01·T05 순차 부분, P1-2의 51번째 거부)
set local role service_role;

do $$
declare
  v_a uuid := 'ca7e0000-0000-4000-8000-00000000000a';
  v_bundle uuid := 'ca7e0000-0000-4000-8000-0000000000b0';
  v_sp01 uuid := (select id from public.market_item_subproducts where title = 'cart-test-sp-01');
  v_inactive uuid := (select id from public.market_item_subproducts where title = 'cart-test-sp-inactive');
  v_r jsonb;
  v_first uuid;
  v_sp uuid;
begin
  v_r := public.add_market_cart_item(v_a, 'subproduct', v_sp01);
  assert (v_r->>'ok')::boolean and (v_r->>'created')::boolean and (v_r->>'count')::int = 1, 'add first: ' || v_r::text;
  v_first := (v_r->>'cartItemId')::uuid;

  v_r := public.add_market_cart_item(v_a, 'subproduct', v_sp01);
  assert (v_r->>'ok')::boolean and not (v_r->>'created')::boolean
         and (v_r->>'cartItemId')::uuid = v_first and (v_r->>'count')::int = 1, 'T01 duplicate returns existing: ' || v_r::text;

  v_r := public.add_market_cart_item(v_a, 'bundle', v_bundle);
  assert (v_r->>'ok')::boolean and (v_r->>'count')::int = 2, 'add bundle: ' || v_r::text;

  v_r := public.add_market_cart_item(v_a, 'subproduct', v_inactive);
  assert v_r->>'code' = 'NOT_FOUND', 'inactive target: ' || v_r::text;
  v_r := public.add_market_cart_item(v_a, 'bundle', v_sp01);
  assert v_r->>'code' = 'NOT_FOUND', 'kind/target mismatch: ' || v_r::text;
  v_r := public.add_market_cart_item(v_a, 'legacy', v_sp01);
  assert v_r->>'code' = 'INVALID_INPUT', 'unknown kind: ' || v_r::text;
  v_r := public.add_market_cart_item(gen_random_uuid(), 'subproduct', v_sp01);
  assert v_r->>'code' = 'NOT_FOUND', 'unknown user: ' || v_r::text;

  for v_sp in
    select id from public.market_item_subproducts
    where item_id = 'ca7e0000-0000-4000-8000-0000000000e1'
      and title between 'cart-test-sp-02' and 'cart-test-sp-49'
    order by title
  loop
    v_r := public.add_market_cart_item(v_a, 'subproduct', v_sp);
    assert (v_r->>'ok')::boolean, 'fill: ' || v_r::text;
  end loop;
  assert (select count(*) from public.market_cart_items where user_id = v_a) = 50, 'T05 filled to 50';

  v_r := public.add_market_cart_item(v_a, 'subproduct',
    (select id from public.market_item_subproducts where title = 'cart-test-sp-50'));
  assert v_r->>'code' = 'CART_LIMIT' and (v_r->>'count')::int = 50, 'T05 51st rejected: ' || v_r::text;

  v_r := public.add_market_cart_item(v_a, 'subproduct', v_sp01);
  assert (v_r->>'ok')::boolean and (v_r->>'cartItemId')::uuid = v_first, 'duplicate at limit returns existing: ' || v_r::text;
  assert (select count(*) from public.market_cart_items where user_id = v_a) = 50, 'still 50 rows';

  v_r := public.set_market_cart_selection(v_a, array[v_first, v_first], false);
  assert (v_r->>'ok')::boolean and v_r->'updatedIds' = jsonb_build_array(v_first)
         and v_r->'missingIds' = '[]'::jsonb, 'set selection: ' || v_r::text;
  assert not (select is_selected from public.market_cart_items where id = v_first), 'is_selected false';

  v_r := public.set_market_cart_selection(v_a, array[]::uuid[], true);
  assert v_r->>'code' = 'INVALID_INPUT', 'empty ids: ' || v_r::text;
  v_r := public.set_market_cart_selection(v_a, array[v_first], null);
  assert v_r->>'code' = 'INVALID_INPUT', 'null selected: ' || v_r::text;
  v_r := public.remove_market_cart_items(v_a, array(select gen_random_uuid() from generate_series(1, 51)));
  assert v_r->>'code' = 'INVALID_INPUT', 'more than 50 ids: ' || v_r::text;

  v_sp := gen_random_uuid();
  v_r := public.remove_market_cart_items(v_a, array[v_first, v_sp]);
  assert (v_r->>'ok')::boolean and v_r->'removedIds' = jsonb_build_array(v_first)
         and (v_r->>'count')::int = 49, 'remove (missing id is success): ' || v_r::text;
end;
$$;

reset role;

-- 4. P1-3 / T30: authenticated 직접 접근 (B의 JWT)
insert into public.market_cart_items (id, user_id, target_kind, subproduct_id)
select 'ca7e0000-0000-4000-8000-0000000000c1', 'ca7e0000-0000-4000-8000-00000000000a', 'subproduct', id
from public.market_item_subproducts where title = 'cart-test-sp-51';
insert into public.market_cart_items (id, user_id, target_kind, subproduct_id)
select 'ca7e0000-0000-4000-8000-0000000000c2', 'ca7e0000-0000-4000-8000-00000000000b', 'subproduct', id
from public.market_item_subproducts where title = 'cart-test-sp-52';

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ca7e0000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

do $$
begin
  assert (select count(*) from public.market_cart_items
          where user_id = 'ca7e0000-0000-4000-8000-00000000000a') = 0, 'other user rows invisible';
  assert (select array_agg(id) from public.market_cart_items)
         = array['ca7e0000-0000-4000-8000-0000000000c2'::uuid], 'own row visible';

  begin
    insert into public.market_cart_items (user_id, target_kind, subproduct_id)
    values ('ca7e0000-0000-4000-8000-00000000000b', 'subproduct', gen_random_uuid());
    raise exception 'cart INSERT should be 42501';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.market_cart_items set is_selected = false where id = 'ca7e0000-0000-4000-8000-0000000000c2';
    raise exception 'cart UPDATE should be 42501';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.market_cart_items where id = 'ca7e0000-0000-4000-8000-0000000000c2';
    raise exception 'cart DELETE should be 42501';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.market_checkout_batches (user_id, mode, idempotency_key, request_payload, total_credits, result_payload)
    values ('ca7e0000-0000-4000-8000-00000000000b', 'cart', gen_random_uuid(), '{}', 1, '{}');
    raise exception 'batch INSERT should be 42501';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.add_market_cart_item('ca7e0000-0000-4000-8000-00000000000b', 'subproduct', gen_random_uuid());
    raise exception 'RPC EXECUTE should be 42501';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

-- 5. P1-3: PATCH/DELETE RPC에 타인 ID를 섞어도 타인 행 변경 0
set local role service_role;

do $$
declare
  v_b uuid := 'ca7e0000-0000-4000-8000-00000000000b';
  v_a_row uuid := 'ca7e0000-0000-4000-8000-0000000000c1';
  v_b_row uuid := 'ca7e0000-0000-4000-8000-0000000000c2';
  v_r jsonb;
begin
  v_r := public.set_market_cart_selection(v_b, array[v_a_row, v_b_row], false);
  assert v_r->'updatedIds' = jsonb_build_array(v_b_row) and v_r->'missingIds' = jsonb_build_array(v_a_row),
    'selection ignores other user row: ' || v_r::text;
  assert (select is_selected from public.market_cart_items where id = v_a_row), 'other user row unchanged';

  v_r := public.remove_market_cart_items(v_b, array[v_a_row]);
  assert v_r->'removedIds' = '[]'::jsonb and (v_r->>'count')::int = 1, 'remove ignores other user row: ' || v_r::text;
  assert exists (select 1 from public.market_cart_items where id = v_a_row), 'other user row kept';
end;
$$;

reset role;

-- 6. P1-5 / N4: batch·주문 보유 fixture의 profile 삭제 CASCADE, batch 단독 삭제는 차단
insert into public.market_checkout_batches (id, user_id, mode, idempotency_key, request_payload, total_credits, result_payload)
values ('ca7e0000-0000-4000-8000-0000000000ba', 'ca7e0000-0000-4000-8000-00000000000b',
        'cart', gen_random_uuid(), '{"mode":"cart"}', 100, '{}');
insert into public.market_purchase_orders (
  id, workspace_subject, user_id, item_id, purchase_type, original_price_credits, charged_credits, status, checkout_batch_id
)
values ('ca7e0000-0000-4000-8000-0000000000d1', 'english', 'ca7e0000-0000-4000-8000-00000000000b',
        'ca7e0000-0000-4000-8000-0000000000e1', 'subproduct', 100, 100, 'completed',
        'ca7e0000-0000-4000-8000-0000000000ba');

do $$
begin
  begin
    delete from public.market_checkout_batches where id = 'ca7e0000-0000-4000-8000-0000000000ba';
    raise exception 'batch delete with child order should be 23503';
  exception when foreign_key_violation then null;
  end;

  delete from public.profiles where id = 'ca7e0000-0000-4000-8000-00000000000b';
  assert not exists (select 1 from public.market_checkout_batches where id = 'ca7e0000-0000-4000-8000-0000000000ba'),
    'batch cascaded';
  assert not exists (select 1 from public.market_purchase_orders where id = 'ca7e0000-0000-4000-8000-0000000000d1'),
    'order cascaded';
  assert not exists (select 1 from public.market_cart_items where user_id = 'ca7e0000-0000-4000-8000-00000000000b'),
    'cart rows cascaded';
end;
$$;

-- 7. P1-7 / N13: 판매 테이블 직접 쓰기 차단
do $$
declare
  t text;
  r text;
  p text;
begin
  assert not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'market_purchases'
      and policyname in ('Users can insert own market purchases', 'Users can update own pending market purchases')
  ), 'user write policies dropped';

  foreach t in array array['public.market_purchases', 'public.market_purchase_orders',
                           'public.market_purchase_lines', 'public.market_entitlements'] loop
    foreach r in array array['anon', 'authenticated'] loop
      foreach p in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
        assert not has_table_privilege(r, t, p), format('%s has no %s on %s', r, p, t);
      end loop;
    end loop;
    assert has_table_privilege('authenticated', t, 'SELECT'), format('authenticated keeps SELECT on %s', t);
  end loop;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ca7e0000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

do $$
declare
  v_a uuid := 'ca7e0000-0000-4000-8000-00000000000a';
  v_item uuid := 'ca7e0000-0000-4000-8000-0000000000e1';
begin
  begin
    insert into public.market_purchases (user_id, item_id, asset_kind, price_credits, credit_resource_type)
    values (v_a, v_item, 'pdf', 0, 'market');
    raise exception 'market_purchases INSERT should be 42501';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.market_purchases set status = 'completed' where user_id = v_a;
    raise exception 'market_purchases UPDATE should be 42501';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.market_purchase_orders (workspace_subject, user_id, item_id, purchase_type)
    values ('english', v_a, v_item, 'subproduct');
    raise exception 'market_purchase_orders INSERT should be 42501';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.market_purchase_lines set status = 'completed' where false;
    raise exception 'market_purchase_lines UPDATE should be 42501';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.market_entitlements (workspace_subject, user_id, item_id, scope)
    values ('english', v_a, v_item, 'item');
    raise exception 'market_entitlements INSERT should be 42501';
  exception when insufficient_privilege then null;
  end;

  -- 보관함 조회 경로(본인 SELECT)는 유지
  perform count(*) from public.market_purchases;
  perform count(*) from public.market_purchase_orders;
  perform count(*) from public.market_purchase_lines;
  perform count(*) from public.market_entitlements;
end;
$$;

reset role;
select set_config('request.jwt.claims', '', true);

-- 8. P1-6 / N3: legacy 이관 결과 (backfill 적용 후). 규칙 기반 자기 일관성 검사 +
--    Phase 0 dry-run(P0-5) 수치 대조: 서브상품 2(legacy_pdf 1000 / legacy_hwp_bundle 1500), 파일 2, legacy_zip 0.
do $$
declare
  v_row record;
begin
  assert not exists (
    select 1
    from public.market_items i
    where i.status = 'published' and i.is_active and i.deleted_at is null
      and exists (
        select 1 from public.market_item_files f
        where f.item_id = i.id and f.is_active and f.deleted_at is null
          and case f.asset_kind when 'pdf' then i.pdf_price when 'hwp' then i.hwp_price when 'zip' then i.zip_price end > 0
      )
      and not exists (
        select 1 from public.market_item_subproducts s
        where s.item_id = i.id and s.is_active and s.deleted_at is null
      )
      and not exists (
        select 1 from public.market_item_bundle_options b
        where b.item_id = i.id and b.is_active
      )
  ), 'P1-6: legacy-only target items re-count = 0';

  -- 이관 서브상품마다 활성 파일 정확히 1개, 같은 kind의 활성 legacy 파일과 같은 storage path, 가격 = 해당 kind 가격 > 0
  assert not exists (
    select 1
    from public.market_item_subproducts s
    join public.market_subproduct_categories c on c.id = s.category_id
    join public.market_items i on i.id = s.item_id
    where c.slug in ('legacy_pdf', 'legacy_hwp_bundle', 'legacy_zip')
      and s.deleted_at is null
      and (
        s.price_credits <= 0
        or s.price_credits <> case c.slug when 'legacy_pdf' then i.pdf_price
                                         when 'legacy_hwp_bundle' then i.hwp_price
                                         else i.zip_price end
        or (select count(*) from public.market_subproduct_files sf
            where sf.subproduct_id = s.id and sf.is_active and sf.deleted_at is null) <> 1
        or not exists (
          select 1
          from public.market_subproduct_files sf
          join public.market_item_files lf
            on lf.item_id = s.item_id and lf.storage_path = sf.storage_path
           and lf.is_active and lf.deleted_at is null
           and lf.asset_kind = case c.slug when 'legacy_pdf' then 'pdf'
                                           when 'legacy_hwp_bundle' then 'hwp'
                                           else 'zip' end
          where sf.subproduct_id = s.id and sf.is_active and sf.deleted_at is null
        )
      )
  ), 'P1-6: every legacy_* subproduct mirrors one active paid legacy file';

  assert not exists (
    select 1 from public.market_subproduct_categories
    where slug = 'legacy_hwp_bundle' and deleted_at is null and name <> 'HWP 파일'
  ), 'P1-6: legacy_hwp_bundle display name is HWP 파일';

  select
    count(distinct s.id) as count,
    count(distinct s.id) filter (where c.slug = 'legacy_zip') as count_zip,
    coalesce(array_agg(distinct s.price_credits) filter (where c.slug = 'legacy_pdf'), '{}') as pdf_prices,
    coalesce(array_agg(distinct s.price_credits) filter (where c.slug = 'legacy_hwp_bundle'), '{}') as hwp_prices,
    count(distinct sf.id) as files
  into v_row
  from public.market_item_subproducts s
  join public.market_subproduct_categories c on c.id = s.category_id
  left join public.market_subproduct_files sf
    on sf.subproduct_id = s.id and sf.is_active and sf.deleted_at is null
  where c.slug in ('legacy_pdf', 'legacy_hwp_bundle', 'legacy_zip')
    and s.deleted_at is null;

  assert v_row.count = 2, format('P1-6: legacy_* subproducts = 2 (got %s)', v_row.count);
  assert v_row.count_zip = 0, format('P1-6: legacy_zip subproducts = 0 (got %s)', v_row.count_zip);
  assert v_row.pdf_prices = array[1000], format('P1-6: legacy_pdf price 1000 (got %s)', v_row.pdf_prices);
  assert v_row.hwp_prices = array[1500], format('P1-6: legacy_hwp_bundle price 1500 (got %s)', v_row.hwp_prices);
  assert v_row.files = 2, format('P1-6: legacy_* files = 2 (got %s)', v_row.files);
end;
$$;

do $$ begin raise notice 'market_cart_checkout: all passed'; end; $$;

rollback;
