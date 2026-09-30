-- 장바구니 Phase 2: 원자 구매 RPC (docs/cart-implementation-plan-v4.md 4절, 7절 Phase 2)
-- - evaluate_market_targets: target별 구매 가능 여부·원가·청구액·부분보유·차액 기준 주문 (R1~R6)
-- - checkout_market_selection: cart/direct 모드 원자 구매 (4절 1~10단계)
--
-- 파일명 version은 임시값이다. apply_migration 직후 schema_migrations.version으로 파일명을 맞춘다(P1-8).
-- 트랜잭션: 파일 안에 BEGIN/COMMIT을 두지 않는다(Phase 1 migration 머리말과 같은 이유).
-- 재실행 안전: CREATE OR REPLACE FUNCTION + REVOKE/GRANT만 사용한다.

-- 가격·판정 공통 함수. p_targets = [{targetKind, targetId}, ...], 결과는 같은 순서의 배열.
-- 규칙은 이관 전 TS 규칙(삭제됨) ensureUserCanPurchaseMarketV2Target(market-purchase.ts)와
-- getMarketSubproductPairContext(market-items-server.ts)를 옮긴 것이다.
--   available: 상품 활성·게시·미삭제 + target 활성(·미삭제) + 가격>0 + 파일 존재
--              (서브상품 = 자기 활성·미삭제 파일, 번들 = 상품 내 활성·미삭제 서브상품 파일. 카테고리 활성 무관)
--   owned: R1(번들, item scope) / R2(서브상품, item scope) / R3(같은 서브상품) / R4(PDF 포함 HWP 보유자의 question_pdf)
--   chargedCredits: R5 차액 또는 정가, partiallyOwned: R6
-- 비교 대상 서브상품은 그 상품의 활성·미삭제 서브상품만이다(4절 공통 정의).
create or replace function public.evaluate_market_targets(
  p_user_id uuid,
  p_targets jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_target jsonb;
  v_kind text;
  v_target_id uuid;
  v_found boolean;
  v_item_id uuid;
  v_ws text;
  v_item_title text;
  v_option_title text;
  v_category_name text;
  v_category_slug text;
  v_price integer;
  v_available boolean;
  v_includes_pdf boolean;
  v_has_item_scope boolean;
  v_owned boolean;
  v_partial boolean;
  v_charged integer;
  v_base_order_id uuid;
  v_hwp_count integer;
  v_target_is_hwp boolean;
  v_owned_pdf_max integer;
  v_result jsonb := '[]'::jsonb;
begin
  for v_target in select value from jsonb_array_elements(p_targets) loop
    v_kind := v_target->>'targetKind';
    v_target_id := (v_target->>'targetId')::uuid;
    v_found := false;
    v_item_id := null;
    v_ws := null;
    v_item_title := null;
    v_option_title := null;
    v_category_name := null;
    v_category_slug := null;
    v_price := null;
    v_available := false;
    v_includes_pdf := false;
    v_has_item_scope := false;
    v_owned := false;
    v_partial := false;
    v_charged := null;
    v_base_order_id := null;

    if v_kind = 'subproduct' then
      select s.item_id, i.workspace_subject, i.title, s.title, c.name, c.slug, s.price_credits,
             i.status = 'published' and i.is_active and i.deleted_at is null
               and s.is_active and s.deleted_at is null
               and s.price_credits > 0
               and exists (
                 select 1 from public.market_subproduct_files f
                 where f.subproduct_id = s.id
                   and f.workspace_subject = s.workspace_subject
                   and f.is_active and f.deleted_at is null
               ),
             exists (
               select 1
               from public.market_subproduct_files f
               join public.market_file_types ft on ft.id = f.file_type_id
               where f.subproduct_id = s.id
                 and f.workspace_subject = s.workspace_subject
                 and f.is_active and f.deleted_at is null
                 and lower(ft.code) = 'pdf'
             )
        into v_item_id, v_ws, v_item_title, v_option_title, v_category_name, v_category_slug, v_price,
             v_available, v_includes_pdf
      from public.market_item_subproducts s
      join public.market_items i on i.id = s.item_id and i.workspace_subject = s.workspace_subject
      left join public.market_subproduct_categories c on c.id = s.category_id
      where s.id = v_target_id;
      v_found := found;
    elsif v_kind = 'bundle' then
      select b.item_id, i.workspace_subject, i.title, b.label, b.price_credits,
             i.status = 'published' and i.is_active and i.deleted_at is null
               and b.is_active
               and b.price_credits > 0
               and exists (
                 select 1 from public.market_subproduct_files f
                 where f.item_id = b.item_id
                   and f.workspace_subject = b.workspace_subject
                   and f.is_active and f.deleted_at is null
               )
        into v_item_id, v_ws, v_item_title, v_option_title, v_price, v_available
      from public.market_item_bundle_options b
      join public.market_items i on i.id = b.item_id and i.workspace_subject = b.workspace_subject
      where b.id = v_target_id;
      v_found := found;
    end if;

    if v_found then
      v_charged := v_price;

      select coalesce(bool_or(e.scope = 'item'), false)
        into v_has_item_scope
      from public.market_entitlements e
      where e.user_id = p_user_id and e.item_id = v_item_id and e.status = 'active';

      if v_kind = 'bundle' then
        -- R1
        v_owned := v_has_item_scope;
        -- R6
        v_partial := exists (
          select 1
          from public.market_entitlements e
          join public.market_item_subproducts s on s.id = e.subproduct_id
          where e.user_id = p_user_id and e.item_id = v_item_id
            and e.scope = 'subproduct' and e.status = 'active'
            and s.is_active and s.deleted_at is null
        );
      else
        -- R2, R3
        v_owned := v_has_item_scope or exists (
          select 1 from public.market_entitlements e
          where e.user_id = p_user_id and e.item_id = v_item_id
            and e.scope = 'subproduct' and e.subproduct_id = v_target_id and e.status = 'active'
        );

        -- R4
        if not v_owned and v_category_slug = 'question_pdf' then
          v_owned := exists (
            select 1
            from public.market_item_subproducts s
            join public.market_subproduct_categories c on c.id = s.category_id
            join public.market_entitlements e
              on e.subproduct_id = s.id and e.user_id = p_user_id
             and e.scope = 'subproduct' and e.status = 'active'
            where s.item_id = v_item_id and s.workspace_subject = v_ws
              and s.is_active and s.deleted_at is null
              and c.slug = 'question_hwp'
              and exists (
                select 1
                from public.market_subproduct_files f
                join public.market_file_types ft on ft.id = f.file_type_id
                where f.subproduct_id = s.id
                  and f.workspace_subject = s.workspace_subject
                  and f.is_active and f.deleted_at is null
                  and lower(ft.code) = 'pdf'
              )
          );
        end if;

        -- R5: 유일한 활성 question_hwp + PDF 포함 + item scope 없음 + 미보유 + 보유 PDF 최대가 < HWP 가격
        if not v_owned and v_category_slug = 'question_hwp' and v_includes_pdf then
          select count(*), coalesce(bool_or(s.id = v_target_id), false)
            into v_hwp_count, v_target_is_hwp
          from public.market_item_subproducts s
          join public.market_subproduct_categories c on c.id = s.category_id
          where s.item_id = v_item_id and s.workspace_subject = v_ws
            and s.is_active and s.deleted_at is null
            and c.slug = 'question_hwp';

          if v_hwp_count = 1 and v_target_is_hwp then
            select max(s.price_credits)
              into v_owned_pdf_max
            from public.market_item_subproducts s
            join public.market_subproduct_categories c on c.id = s.category_id
            join public.market_entitlements e
              on e.subproduct_id = s.id and e.user_id = p_user_id
             and e.scope = 'subproduct' and e.status = 'active'
            where s.item_id = v_item_id and s.workspace_subject = v_ws
              and s.is_active and s.deleted_at is null
              and c.slug = 'question_pdf';

            if v_owned_pdf_max is not null and v_price - v_owned_pdf_max > 0 then
              v_charged := v_price - v_owned_pdf_max;

              -- 기준 주문: 최대가 PDF 권한의 source_order_id, 동률이면 주문 created_at → id 오름차순
              select e.source_order_id
                into v_base_order_id
              from public.market_item_subproducts s
              join public.market_subproduct_categories c on c.id = s.category_id
              join public.market_entitlements e
                on e.subproduct_id = s.id and e.user_id = p_user_id
               and e.scope = 'subproduct' and e.status = 'active'
              left join public.market_purchase_orders o on o.id = e.source_order_id
              where s.item_id = v_item_id and s.workspace_subject = v_ws
                and s.is_active and s.deleted_at is null
                and c.slug = 'question_pdf'
                and s.price_credits = v_owned_pdf_max
              order by o.created_at, o.id
              limit 1;
            end if;
          end if;
        end if;
      end if;
    end if;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'targetKind', v_kind,
      'targetId', v_target_id,
      'itemId', v_item_id,
      'workspaceSubject', v_ws,
      'itemTitle', v_item_title,
      'optionTitle', v_option_title,
      'categoryName', v_category_name,
      'categorySlug', v_category_slug,
      'includesPdf', v_includes_pdf,
      'available', v_found and v_available,
      'owned', v_owned,
      'partiallyOwned', v_partial,
      'purchasable', v_found and v_available and not v_owned,
      'reason', case
        when not v_found then 'NOT_FOUND'
        when not v_available then 'UNAVAILABLE'
        when v_owned then 'ALREADY_OWNED'
      end,
      'originalCredits', v_price,
      'chargedCredits', v_charged,
      'upgradeBaseOrderId', v_base_order_id
    ));
  end loop;

  return v_result;
end;
$$;

-- 원자 구매. 업무 거절은 쓰기 전에 {ok:false, code, ...}로 반환하고, 9단계 이후 실패는 RAISE로 전체 롤백한다.
-- p_lines
--   cart:   [{cartItemId, expectedCredits, acknowledgeNoDiscount?}, ...] (1~50)
--   direct: [{targetKind, targetId, expectedCredits, acknowledgeNoDiscount?}] (정확히 1, p_item_id 필수)
-- 잠금 순서: profile → cart row(ID순) → credit source(consume_credits 내부). catalog는 잠그지 않는다.
create or replace function public.checkout_market_selection(
  p_user_id uuid,
  p_mode text,
  p_item_id uuid,
  p_lines jsonb,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_line jsonb;
  v_norm_lines jsonb := '[]'::jsonb;
  v_expected_total bigint := 0;
  v_payload jsonb;
  v_batch public.market_checkout_batches%rowtype;
  v_cart_ids uuid[];
  v_missing uuid[];
  v_work jsonb;
  v_items jsonb;
  v_rejected jsonb;
  v_total integer;
  v_balance bigint;
  v_batch_id uuid;
  v_order_id uuid;
  v_kind text;
  v_item_id uuid;
  v_ws text;
  v_charged integer;
  v_consume jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  -- 1. 입력 검증
  if p_user_id is null or p_idempotency_key is null
     or p_mode is null or p_mode not in ('cart', 'direct')
     or p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) not between 1 and 50 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if p_mode = 'direct' and (p_item_id is null or jsonb_array_length(p_lines) <> 1) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) <> 'object'
       or coalesce(jsonb_typeof(v_line->'expectedCredits'), '') <> 'number'
       or coalesce(jsonb_typeof(v_line->'acknowledgeNoDiscount'), 'null') not in ('boolean', 'null') then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;
    if (v_line->>'expectedCredits') !~ '^[0-9]{1,10}$' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;
    if (v_line->>'expectedCredits')::bigint not between 1 and 2147483647 then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;

    if p_mode = 'cart' then
      if coalesce(v_line->>'cartItemId', '') !~ c_uuid_pattern then
        return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
      end if;
      v_norm_lines := v_norm_lines || jsonb_build_array(jsonb_build_object(
        'cartItemId', (v_line->>'cartItemId')::uuid,
        'expectedCredits', (v_line->>'expectedCredits')::integer,
        'ack', coalesce((v_line->>'acknowledgeNoDiscount')::boolean, false)
      ));
    else
      if coalesce(v_line->>'targetKind', '') not in ('subproduct', 'bundle')
         or coalesce(v_line->>'targetId', '') !~ c_uuid_pattern then
        return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
      end if;
      v_norm_lines := v_norm_lines || jsonb_build_array(jsonb_build_object(
        'targetKind', v_line->>'targetKind',
        'targetId', (v_line->>'targetId')::uuid,
        'expectedCredits', (v_line->>'expectedCredits')::integer,
        'ack', coalesce((v_line->>'acknowledgeNoDiscount')::boolean, false)
      ));
    end if;

    v_expected_total := v_expected_total + (v_line->>'expectedCredits')::bigint;
  end loop;

  if v_expected_total > 2147483647 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  if p_mode = 'cart' then
    select array_agg((l->>'cartItemId')::uuid order by (l->>'cartItemId')::uuid)
      into v_cart_ids
    from jsonb_array_elements(v_norm_lines) as l;

    if cardinality(v_cart_ids) <> (select count(distinct x) from unnest(v_cart_ids) as x) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;

    -- 정규화 payload(3.2): 입력값만 사용, cartItemId 오름차순
    select jsonb_build_object(
             'mode', 'cart',
             'lines', jsonb_agg(l order by (l->>'cartItemId')::uuid)
           )
      into v_payload
    from jsonb_array_elements(v_norm_lines) as l;
  else
    v_payload := jsonb_build_object(
      'mode', 'direct',
      'itemId', p_item_id,
      'target_kind', v_norm_lines->0->>'targetKind',
      'target_id', v_norm_lines->0->'targetId',
      'expectedCredits', v_norm_lines->0->'expectedCredits',
      'ack', v_norm_lines->0->'ack'
    );
  end if;

  -- 2. profile 잠금 (같은 사용자의 checkout·담기·선택 변경 직렬화)
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- 3. 멱등 확인: cart·가격 읽기보다 먼저
  select * into v_batch
  from public.market_checkout_batches
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_batch.request_payload = v_payload then
      return v_batch.result_payload || jsonb_build_object('alreadyCompleted', true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
  end if;

  -- 4. 대상 확정
  if p_mode = 'cart' then
    perform 1
    from public.market_cart_items
    where user_id = p_user_id and id = any(v_cart_ids)
    order by id
    for update;

    select coalesce(array_agg(x order by x), '{}')
      into v_missing
    from unnest(v_cart_ids) as x
    where not exists (
      select 1 from public.market_cart_items c where c.user_id = p_user_id and c.id = x
    );
    if cardinality(v_missing) > 0 then
      return jsonb_build_object('ok', false, 'code', 'CART_CHANGED', 'missingIds', to_jsonb(v_missing));
    end if;

    select jsonb_agg(
             l || jsonb_build_object(
               'targetKind', c.target_kind,
               'targetId', coalesce(c.subproduct_id, c.bundle_option_id)
             )
             order by c.id
           )
      into v_work
    from jsonb_array_elements(v_payload->'lines') as l
    join public.market_cart_items c
      on c.id = (l->>'cartItemId')::uuid and c.user_id = p_user_id;
  else
    v_work := v_norm_lines;
  end if;

  -- 5. 판정 (같은 SQL로 GET 표시 가격과 차감 가격을 계산)
  select jsonb_agg(w.value || e.value order by w.idx)
    into v_items
  from jsonb_array_elements(v_work) with ordinality as w(value, idx)
  join jsonb_array_elements(public.evaluate_market_targets(p_user_id, v_work)) with ordinality as e(value, idx)
    using (idx);

  if exists (
    select 1 from jsonb_array_elements(v_items) as x
    where x->>'reason' = 'NOT_FOUND'
       or (p_mode = 'direct' and (x->>'itemId')::uuid is distinct from p_item_id)
  ) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- 6. batch 내 충돌 → 부분보유 ack → 기보유
  select jsonb_agg(distinct a.value->'itemId')
    into v_rejected
  from jsonb_array_elements(v_items) as a
  join jsonb_array_elements(v_items) as b
    on a.value->>'itemId' = b.value->>'itemId'
  where (a.value->>'targetKind' = 'bundle' and b.value->>'targetKind' = 'subproduct')
     or (a.value->>'categorySlug' = 'question_pdf'
         and b.value->>'categorySlug' = 'question_hwp'
         and (b.value->>'includesPdf')::boolean);
  if v_rejected is not null then
    return jsonb_build_object('ok', false, 'code', 'CONFLICTING_SELECTION', 'itemIds', v_rejected);
  end if;

  select jsonb_agg(jsonb_build_object(
           'cartItemId', x->'cartItemId', 'targetKind', x->'targetKind', 'targetId', x->'targetId'))
    into v_rejected
  from jsonb_array_elements(v_items) as x
  where (x->>'partiallyOwned')::boolean and not (x->>'ack')::boolean;
  if v_rejected is not null then
    return jsonb_build_object('ok', false, 'code', 'ACK_REQUIRED', 'lines', v_rejected);
  end if;

  select jsonb_agg(jsonb_build_object(
           'cartItemId', x->'cartItemId', 'targetKind', x->'targetKind', 'targetId', x->'targetId'))
    into v_rejected
  from jsonb_array_elements(v_items) as x
  where (x->>'owned')::boolean;
  if v_rejected is not null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_OWNED', 'lines', v_rejected);
  end if;

  -- 7. 가격·판매 상태 비교 (5의 청구액을 그대로 비교·차감·기록에 사용)
  if exists (
    select 1 from jsonb_array_elements(v_items) as x
    where not (x->>'available')::boolean
       or (x->>'chargedCredits')::integer <> (x->>'expectedCredits')::integer
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'PRICE_CHANGED',
      'items', (
        select jsonb_agg(jsonb_build_object(
                 'cartItemId', x.value->'cartItemId',
                 'targetKind', x.value->'targetKind',
                 'targetId', x.value->'targetId',
                 'purchasable', x.value->'purchasable',
                 'reason', x.value->'reason',
                 'originalCredits', x.value->'originalCredits',
                 'chargedCredits', x.value->'chargedCredits'
               ) order by x.idx)
        from jsonb_array_elements(v_items) with ordinality as x(value, idx)
      )
    );
  end if;

  select sum((x->>'chargedCredits')::integer)::integer
    into v_total
  from jsonb_array_elements(v_items) as x;

  -- 8. 잔액 사전 확인: consume_credits와 같은 조건·같은 now()
  select coalesce(sum(remaining_credits), 0)
    into v_balance
  from public.credit_sources
  where user_id = p_user_id
    and status = 'active'
    and remaining_credits > 0
    and (expires_at is null or expires_at > now());
  if v_balance < v_total then
    return jsonb_build_object(
      'ok', false,
      'code', 'INSUFFICIENT_CREDITS',
      'balance', v_balance,
      'shortfall', v_total - v_balance
    );
  end if;

  -- 9. 쓰기. 이후 실패는 전부 RAISE로 전체 롤백한다.
  insert into public.market_checkout_batches (
    user_id, mode, idempotency_key, request_payload, total_credits, result_payload
  ) values (
    p_user_id, p_mode, p_idempotency_key, v_payload, v_total, '{}'::jsonb
  )
  returning id into v_batch_id;

  for v_line in select value from jsonb_array_elements(v_items) loop
    v_order_id := gen_random_uuid();
    v_kind := v_line->>'targetKind';
    v_item_id := (v_line->>'itemId')::uuid;
    v_ws := v_line->>'workspaceSubject';
    v_charged := (v_line->>'chargedCredits')::integer;

    begin
      v_consume := public.consume_credits(
        p_user_id,
        v_charged,
        case when v_kind = 'bundle' then 'market_purchase_bundle_v2' else 'market_purchase_subproduct_v2' end,
        v_item_id,
        format(
          '%s %s 구매 #%s',
          v_line->>'itemTitle',
          case when v_kind = 'bundle' then '전체구매' else '서브상품' end,
          left(v_order_id::text, 8)
        )
      );
    exception
      when raise_exception then
        if sqlerrm = 'INSUFFICIENT_CREDITS' then
          raise exception using errcode = 'P0402', message = 'INSUFFICIENT_CREDITS';
        else
          raise;
        end if;
    end;

    insert into public.market_purchase_orders (
      id, workspace_subject, user_id, item_id, purchase_type, idempotency_key,
      original_price_credits, charged_credits, credit_consumptions, status, checkout_batch_id
    ) values (
      v_order_id, v_ws, p_user_id, v_item_id, v_kind, null,
      (v_line->>'originalCredits')::integer, v_charged, v_consume->'consumptions', 'completed', v_batch_id
    );

    insert into public.market_purchase_lines (
      order_id, workspace_subject, item_id, line_type, subproduct_id, bundle_option_id, price_credits, status
    ) values (
      v_order_id, v_ws, v_item_id, v_kind,
      case when v_kind = 'subproduct' then (v_line->>'targetId')::uuid end,
      case when v_kind = 'bundle' then (v_line->>'targetId')::uuid end,
      v_charged, 'completed'
    );

    insert into public.market_entitlements (
      workspace_subject, user_id, item_id, scope, subproduct_id, file_id, source_order_id, status
    ) values (
      v_ws, p_user_id, v_item_id,
      case when v_kind = 'bundle' then 'item' else 'subproduct' end,
      case when v_kind = 'subproduct' then (v_line->>'targetId')::uuid end,
      null, v_order_id, 'active'
    );

    v_orders := v_orders || jsonb_build_array(jsonb_build_object(
      'orderId', v_order_id,
      'cartItemId', v_line->'cartItemId',
      'targetKind', v_kind,
      'targetId', v_line->'targetId',
      'itemId', v_item_id,
      'workspaceSubject', v_ws,
      'itemTitle', v_line->'itemTitle',
      'optionTitle', v_line->'optionTitle',
      'categoryName', v_line->'categoryName',
      'originalCredits', v_line->'originalCredits',
      'chargedCredits', v_charged,
      'upgradeBaseOrderId', v_line->'upgradeBaseOrderId'
    ));
  end loop;

  -- 10. 4에서 잠근 cart 행만 삭제, 영수증 스냅샷 저장
  if p_mode = 'cart' then
    delete from public.market_cart_items
    where user_id = p_user_id and id = any(v_cart_ids);
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'batchId', v_batch_id,
    'mode', p_mode,
    'totalCredits', v_total,
    'balanceAfter', (v_consume->>'new_balance')::integer,
    'orders', v_orders,
    'createdAt', now()
  );

  update public.market_checkout_batches
  set result_payload = v_result
  where id = v_batch_id;

  return v_result || jsonb_build_object('alreadyCompleted', false);
end;
$$;

revoke all on function public.evaluate_market_targets(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.checkout_market_selection(uuid, text, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.evaluate_market_targets(uuid, jsonb) to service_role;
grant execute on function public.checkout_market_selection(uuid, text, uuid, jsonb, uuid) to service_role;
