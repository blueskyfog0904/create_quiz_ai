-- 되돌리기: 20261124100000_market_material_refund.sql
-- 함수(approve·evaluate·revoke)와 승인 유일 인덱스·전체 환불 INSERT 검사만 원래대로 되돌린다.
-- 증빙(구성 기록·누계·배정 기록·재지급 연결·문의 판)과 구성 기록 트리거, 문의 수정 함수(판 보관·member_updated_at)는 남기고
-- (계획 2-5: 되돌린 기간에도 문의 수정 증빙이 끊기지 않게. 재적용 사전 검사는 이 함수의 새 지문도 받는다), 환불 기간(30)도 낮추지 않는다
--   (30일 고지에 동의한 구매가 있을 수 있음. 새 설정 키는 옛 코드가 무시).
-- 부분·예외 환불, 재지급, 대표 정산이 1건이라도 있으면 멈춘다 — 그 뒤에는 되돌리지 않고 앞으로 고친다.
-- 실행 뒤 다시 적용하려면 supabase_migrations.schema_migrations 의 '20261124100000' 행도 지운다(재적용 사전 검사는 대기 요청 0건 필요).
-- 순서: 코드를 이전 배포로 먼저 되돌린 뒤 이 파일을 실행한다(새 코드가 지워진 함수를 부르지 않게).
-- 되돌린 기간에는 옛 코드 마감식(구매 시각 + 30×24시간)이 고지(다음 날부터 30일째 24시)보다 최대 하루 짧고 예외 환불 함수도 없다 —
--   그 기간의 마감 경계 신청·고객센터 철회는 1:1 문의로 받아 두었다가 재적용 뒤 예외 환불(withdrawal)로 처리한다.
-- 되돌린 기간에는 관리자 화면에서 구매 고지를 저장하지 않는다(옛 코드가 partialRefundConfirmNotice 를 지움 → 재적용 때 문구를 초안으로 덮음).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $down_precheck$
BEGIN
  IF EXISTS (SELECT 1 FROM public.market_refund_requests WHERE refund_kind <> 'full')
     OR EXISTS (SELECT 1 FROM public.market_refund_reissued_sources)
     OR EXISTS (SELECT 1 FROM public.market_refund_requests r, jsonb_array_elements(COALESCE(r.allocated_items, '[]'::jsonb)) x
                 WHERE x ->> 'reason' LIKE 'owner_settled%')
     OR EXISTS (SELECT 1 FROM public.market_refund_requests WHERE status = 'pending') THEN
    RAISE EXCEPTION 'DOWN_BLOCKED: partial/exception/reissue/owner settle or pending requests exist';
  END IF;
END;
$down_precheck$;

DROP FUNCTION IF EXISTS public.preview_market_partial_refund(uuid, uuid);
DROP FUNCTION IF EXISTS public.request_market_partial_refund(uuid, uuid, integer, text, uuid);
DROP FUNCTION IF EXISTS public.approve_market_partial_refund(uuid, uuid, text, integer);
DROP FUNCTION IF EXISTS public.admin_exception_market_refund(uuid, uuid, text, text, uuid[], integer, integer, text, uuid, uuid, timestamptz, integer);
DROP FUNCTION IF EXISTS public.settle_market_refund_by_owner(uuid, uuid, jsonb, text, integer);

DROP TRIGGER IF EXISTS guard_market_refund_request_insert ON public.market_refund_requests;
DROP INDEX IF EXISTS public.uq_market_refund_requests_full_approved_order;
DROP INDEX IF EXISTS public.uq_market_refund_requests_pending_order_v2;
CREATE UNIQUE INDEX IF NOT EXISTS uq_market_refund_requests_pending_order
  ON public.market_refund_requests (order_id)
  WHERE target_kind = 'v2_order' AND status = ANY (ARRAY['pending'::text, 'approved'::text]);

-- 원래 정의(md5 approve 3639ac23…, evaluate 128f6ad5…, revoke 3e64b0a4…). 문의 수정 함수는 되돌리지 않음(새 md5 cb221135… 그대로)
CREATE OR REPLACE FUNCTION public.approve_market_refund(p_request_id uuid, p_admin_id uuid, p_admin_note text, p_confirmed_refund_credits integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_user_id uuid;
  v_request public.market_refund_requests%ROWTYPE;
  v_consumptions jsonb;
  v_item jsonb;
  v_source_id uuid;
  v_amount integer;
  v_take integer;
  v_remaining_request integer;
  v_source public.credit_sources%ROWTYPE;
  v_allocated jsonb := '{}'::jsonb;
  v_already integer;
  v_alloc integer;
  v_restorable integer := 0;
  v_shortfall integer;
  v_restore_items jsonb := '[]'::jsonb;
  v_refund jsonb;
  v_new_balance integer;
  v_note text;
BEGIN
  -- 1. 잠금 없이 사용자만 읽는다.
  SELECT user_id INTO v_user_id
    FROM public.market_refund_requests
   WHERE id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MARKET_REFUND_NOT_FOUND';
  END IF;

  -- 2. 프로필을 먼저 잠근다.
  PERFORM 1
    FROM public.profiles
   WHERE id = v_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CREDIT_USER_NOT_FOUND';
  END IF;

  -- 3. 요청을 잠그고 상태를 다시 본다. 응답 유실 뒤 재클릭·승인/거부 경합은 여기서 막힌다.
  SELECT * INTO v_request
    FROM public.market_refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MARKET_REFUND_NOT_FOUND';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'MARKET_REFUND_NOT_PENDING';
  END IF;

  -- 4. 대상 주문/구매를 잠그고 다시 검사한다. 소비 내역은 TS에서 받지 않고 잠근 행에서 읽는다.
  IF v_request.target_kind = 'v2_order' THEN
    SELECT credit_consumptions INTO v_consumptions
      FROM public.market_purchase_orders
     WHERE id = v_request.order_id
       AND user_id = v_request.user_id
       AND status = 'completed'
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'MARKET_REFUND_TARGET_CHANGED';
    END IF;
  ELSIF v_request.target_kind = 'legacy_purchase' THEN
    SELECT credit_consumptions INTO v_consumptions
      FROM public.market_purchases
     WHERE id = v_request.legacy_purchase_id
       AND user_id = v_request.user_id
       AND status = 'completed'
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'MARKET_REFUND_TARGET_CHANGED';
    END IF;
  ELSE
    RAISE EXCEPTION 'MARKET_REFUND_TARGET_CHANGED';
  END IF;

  -- 5. 다운로드 재검사. 다운로드 기록 insert는 FK로 프로필·주문 행에 FOR KEY SHARE를 잡으므로
  --    2·4의 잠금 뒤에 센 값은 커밋 전까지 바뀌지 않는다.
  IF EXISTS (
    SELECT 1
      FROM public.market_download_events
     WHERE (v_request.target_kind = 'v2_order' AND order_id = v_request.order_id)
        OR (v_request.target_kind = 'legacy_purchase' AND purchase_id = v_request.legacy_purchase_id)
  ) THEN
    RAISE EXCEPTION 'MARKET_REFUND_TARGET_CHANGED';
  END IF;

  -- 6. 소비 내역 형식 검사.
  IF v_consumptions IS NULL
     OR jsonb_typeof(v_consumptions) <> 'array'
     OR jsonb_array_length(v_consumptions) = 0 THEN
    RAISE EXCEPTION 'MARKET_REFUND_TARGET_CHANGED';
  END IF;

  -- 7. 원천 판정(복구 전). refund_credits 루프와 같은 식으로 복구 예정량을 계산한다.
  --    운영 데이터는 키가 source_id·sourceId로 섞여 있어 둘 다 읽는다.
  --    refund_credits에는 정규화한 새 원소({source_id, amount: 배정량})만 넘긴다(원래 요소를 그대로 넘기지 않는다).
  v_remaining_request := v_request.requested_refund_credits;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_consumptions)
  LOOP
    EXIT WHEN v_remaining_request <= 0;

    v_source_id := NULLIF(COALESCE(v_item->>'source_id', v_item->>'sourceId'), '')::uuid;
    v_amount := COALESCE((v_item->>'amount')::integer, 0);

    IF v_source_id IS NULL OR v_amount <= 0 THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_source
      FROM public.credit_sources
     WHERE id = v_source_id
       AND user_id = v_request.user_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CREDIT_REFUND_SOURCE_NOT_FOUND';
    END IF;

    v_take := LEAST(v_amount, v_remaining_request);

    IF v_source.status IN ('active', 'pending_refund')
       AND (v_source.expires_at IS NULL OR v_source.expires_at > v_now) THEN
      -- 같은 원천이 여러 항목에 나와도 누적 배정량으로 상한(initial - remaining)을 넘지 않게 한다.
      v_already := COALESCE((v_allocated->>v_source_id::text)::integer, 0);
      v_alloc := GREATEST(LEAST(v_take, v_source.initial_credits - v_source.remaining_credits - v_already), 0);

      IF v_alloc > 0 THEN
        v_restore_items := v_restore_items || jsonb_build_array(
          jsonb_build_object('source_id', v_source_id, 'amount', v_alloc)
        );
        v_allocated := v_allocated || jsonb_build_object(v_source_id::text, v_already + v_alloc);
        v_restorable := v_restorable + v_alloc;
      END IF;
    END IF;

    v_remaining_request := v_remaining_request - v_take;
  END LOOP;

  -- 복구 불가 원천·상한 초과·소비 내역 부족을 모두 포함한 부족분.
  v_shortfall := v_request.requested_refund_credits - v_restorable;

  -- 8. 판정. 일반 승인은 전액 복구 가능할 때만, 부족분 승인은 관리자가 본 숫자가 지금 계산과 같을 때만 진행한다.
  IF (p_confirmed_refund_credits IS NULL AND v_restorable <> v_request.requested_refund_credits)
     OR (p_confirmed_refund_credits IS NOT NULL AND p_confirmed_refund_credits <> v_restorable) THEN
    RAISE EXCEPTION 'MARKET_REFUND_SHORTFALL'
      USING DETAIL = jsonb_build_object(
        'requested', v_request.requested_refund_credits,
        'restorable', v_restorable
      )::text;
  END IF;

  -- 9. 같은 트랜잭션에서 복구한다. 7에서 같은 잠금 아래 정규화·계산했으므로 어긋나면 버그다.
  IF v_restorable > 0 THEN
    v_refund := public.refund_credits(
      v_request.user_id,
      v_restorable,
      'market_refund',
      v_request.id,
      '문제마켓 구매 환불',
      v_restore_items
    );

    IF (v_refund->>'refunded')::integer <> v_restorable
       OR (v_refund->>'skipped')::integer <> 0 THEN
      RAISE EXCEPTION 'MARKET_REFUND_AMOUNT_MISMATCH';
    END IF;

    v_new_balance := (v_refund->>'new_balance')::integer;
  ELSE
    SELECT credits INTO v_new_balance
      FROM public.profiles
     WHERE id = v_request.user_id;
  END IF;

  -- 10. 주문·라인·이용권(또는 레거시 구매) 회수.
  IF v_request.target_kind = 'v2_order' THEN
    UPDATE public.market_purchase_orders
       SET status = 'refunded'
     WHERE id = v_request.order_id;

    UPDATE public.market_purchase_lines
       SET status = 'refunded'
     WHERE order_id = v_request.order_id;

    UPDATE public.market_entitlements
       SET status = 'refunded'
     WHERE source_order_id = v_request.order_id;
  ELSE
    UPDATE public.market_purchases
       SET status = 'refunded',
           refunded_at = v_now
     WHERE id = v_request.legacy_purchase_id;
  END IF;

  -- 11. 요청 승인. approved_refund_credits는 요청량이 아니라 실제 복구량이다.
  v_note := p_admin_note;
  IF v_shortfall > 0 THEN
    v_note := concat_ws(
      E'\n',
      NULLIF(p_admin_note, ''),
      format('[부족분 %s크레딧: 환불 완료·만료된 원천이라 복구하지 않음. 보상 여부는 관리자 판단]', v_shortfall)
    );
  END IF;

  UPDATE public.market_refund_requests
     SET status = 'approved',
         approved_refund_credits = v_restorable,
         admin_note = v_note,
         processed_by = p_admin_id,
         processed_at = v_now
   WHERE id = v_request.id
  RETURNING * INTO v_request;

  -- 12. 부족분은 승인과 같은 트랜잭션의 경보로 남긴다. 요청마다 1행(dedupe_key).
  IF v_shortfall > 0 THEN
    PERFORM public.record_payment_alert(
      'MARKET_REFUND_SHORTFALL', 'warning',
      '문제마켓 환불을 부족분과 함께 승인했습니다. 보상이 필요한지 확인하세요.',
      jsonb_build_object('request_id', v_request.id, 'user_id', v_request.user_id,
                         'requested', v_request.requested_refund_credits, 'refunded', v_restorable,
                         'shortfall', v_shortfall, 'actor_id', p_admin_id,
                         'dedupe_key', 'market_refund:' || v_request.id::text));
  END IF;

  -- 13. 승인된 요청 행에 잔액·부족분을 덧붙여 돌려준다.
  RETURN to_jsonb(v_request) || jsonb_build_object(
    'new_balance', v_new_balance,
    'shortfall', v_shortfall
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.evaluate_market_targets(p_user_id uuid, p_targets jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.revoke_admin_credits(p_actor_id uuid, p_source_id uuid, p_amount integer, p_reason text, p_operation_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_user_id uuid;
  v_actor_is_admin boolean;
  v_actor_role text;
  v_grant_limits jsonb;
  v_per_grant numeric;
  v_is_replay boolean := false;
  v_existing public.credit_transactions%ROWTYPE;
  v_category text;
  v_status text;
  v_remaining integer;
  v_expires_at timestamptz;
  v_new_balance integer;
BEGIN
  -- ① 인자
  IF p_actor_id IS NULL OR p_source_id IS NULL
     OR p_amount IS NULL OR p_amount < 1
     OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500
     OR p_operation_key IS NULL
     OR length(p_operation_key) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_INPUT_INVALID';
  END IF;

  -- 결제 충전분 원천은 잠그기 전에 거른다(결제 환불 함수들은 "원천 → 프로필" 순서로 잠그므로, 같은 원천을 반대 순서로 잠그지 않게).
  SELECT s.user_id, s.source_category INTO v_user_id, v_category
    FROM public.credit_sources s
   WHERE s.id = p_source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_FOUND';
  END IF;
  IF v_user_id = p_actor_id THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SELF_TARGET';
  END IF;
  IF v_category IS NULL OR v_category NOT IN ('admin_grant', 'bonus', 'system_refund') THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_ADMIN_GRANT';
  END IF;

  -- ② 행위자: 관리자(대표 또는 직원). 행위자 프로필은 잠그지 않는다(지급 함수와 같은 방식).
  SELECT p.is_admin, p.admin_role
    INTO v_actor_is_admin, v_actor_role
    FROM public.profiles p
   WHERE p.id = p_actor_id;
  IF NOT FOUND OR v_actor_is_admin IS NOT TRUE
     OR (v_actor_role IS DISTINCT FROM 'owner' AND v_actor_role IS DISTINCT FROM 'staff') THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_ACTOR_NOT_ALLOWED';
  END IF;

  IF v_actor_role = 'staff' THEN
    SELECT g.limits
      INTO v_grant_limits
      FROM public.admin_permission_grants g
     WHERE g.user_id = p_actor_id AND g.permission = 'credits.revoke'
       FOR UPDATE;
    IF NOT FOUND
       OR (SELECT count(*) FROM public.admin_permission_grants g
            WHERE g.user_id = p_actor_id AND g.permission IN ('members.view', 'credits.view')) <> 2 THEN
      RAISE EXCEPTION 'ADMIN_REVOKE_ACTOR_NOT_ALLOWED';
    END IF;

    v_is_replay := EXISTS (SELECT 1 FROM public.credit_transactions t WHERE t.operation_key = p_operation_key);

    IF NOT v_is_replay THEN
      v_per_grant := CASE
        WHEN jsonb_typeof(v_grant_limits -> 'per_grant') = 'number' THEN (v_grant_limits ->> 'per_grant')::numeric
      END;
      IF v_per_grant IS NULL OR v_per_grant < 1 THEN
        RAISE EXCEPTION 'ADMIN_REVOKE_LIMIT_NOT_SET';
      END IF;
      IF p_amount > v_per_grant THEN
        RAISE EXCEPTION 'ADMIN_REVOKE_LIMIT_PER_GRANT limit=%', v_per_grant;
      END IF;
    END IF;
  END IF;

  -- ③ 대상 프로필 잠금 → 같은 키의 재요청이면 기존 결과
  PERFORM 1
    FROM public.profiles
   WHERE id = v_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CREDIT_USER_NOT_FOUND';
  END IF;

  SELECT * INTO v_existing
    FROM public.credit_transactions
   WHERE operation_key = p_operation_key
   LIMIT 1;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM v_user_id
       OR v_existing.source_id IS DISTINCT FROM p_source_id
       OR v_existing.type IS DISTINCT FROM 'refund'
       OR v_existing.amount IS DISTINCT FROM -p_amount THEN
      RAISE EXCEPTION 'ADMIN_REVOKE_IDEMPOTENCY_CONFLICT';
    END IF;

    SELECT COALESCE(SUM(remaining_credits), 0)::integer
      INTO v_new_balance
      FROM public.credit_sources
     WHERE user_id = v_user_id
       AND status IN ('active', 'pending_refund')
       AND (expires_at IS NULL OR expires_at > v_now);

    RETURN jsonb_build_object(
      'already_revoked', true,
      'user_id', v_user_id,
      'new_balance', v_new_balance,
      'source_remaining', (SELECT s.remaining_credits FROM public.credit_sources s WHERE s.id = p_source_id)
    );
  END IF;

  -- 재요청으로 보고 한도를 건너뛰었는데 기존 거래가 없으면 회수하지 않는다.
  IF v_is_replay THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_REPLAY_MISSING';
  END IF;

  -- ④ 원천 잠금과 확인
  -- 잠근 프로필의 원천인지 다시 확인한다(그 사이 원천이 지워졌거나 주인이 달라졌으면 회수하지 않는다).
  SELECT s.source_category, s.status, s.remaining_credits, s.expires_at
    INTO v_category, v_status, v_remaining, v_expires_at
    FROM public.credit_sources s
   WHERE s.id = p_source_id
     AND s.user_id = v_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_FOUND';
  END IF;

  IF v_category IS NULL OR v_category NOT IN ('admin_grant', 'bonus', 'system_refund') THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_ADMIN_GRANT';
  END IF;
  IF v_status IS DISTINCT FROM 'active' OR (v_expires_at IS NOT NULL AND v_expires_at <= v_now) THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_ACTIVE';
  END IF;
  IF p_amount > v_remaining THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_EXCEEDS_REMAINING remaining=%', v_remaining;
  END IF;

  -- ⑤ 회수
  UPDATE public.credit_sources
     SET remaining_credits = remaining_credits - p_amount
   WHERE id = p_source_id;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_new_balance
    FROM public.credit_sources
   WHERE user_id = v_user_id
     AND status IN ('active', 'pending_refund')
     AND (expires_at IS NULL OR expires_at > v_now);

  UPDATE public.profiles
     SET credits = v_new_balance
   WHERE id = v_user_id;

  INSERT INTO public.credit_transactions (
    user_id,
    type,
    amount,
    balance_after,
    description,
    source_id,
    operation_key
  ) VALUES (
    v_user_id,
    'refund',
    -p_amount,
    v_new_balance,
    format('크레딧 %s개 관리자 회수', to_char(p_amount, 'FM999,999,999,999')),
    p_source_id,
    p_operation_key
  );

  PERFORM public.record_admin_audit(
    p_actor_id,
    'credit_revoke',
    'member',
    v_user_id::text,
    v_user_id,
    p_amount,
    btrim(p_reason),
    jsonb_build_object(
      'source_id', p_source_id,
      'source_category', v_category,
      'operation_key', p_operation_key,
      'new_balance', v_new_balance,
      'source_remaining', v_remaining - p_amount
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'already_revoked', false,
    'user_id', v_user_id,
    'new_balance', v_new_balance,
    'source_remaining', v_remaining - p_amount
  );
END;
$function$;

DO $down_verify$
BEGIN
  IF md5(pg_get_functiondef('public.approve_market_refund(uuid,uuid,text,integer)'::regprocedure)) <> '3639ac2383927d33f065012f0c59d1e9'
     OR md5(pg_get_functiondef('public.evaluate_market_targets(uuid,jsonb)'::regprocedure)) <> '128f6ad5e14626a9fc2bfa29f831752d'
     OR md5(pg_get_functiondef('public.revoke_admin_credits(uuid,uuid,integer,text,text)'::regprocedure)) <> '3e64b0a4a9163d72d561ee5503fba429' THEN
    RAISE EXCEPTION 'DOWN_VERIFY: function md5 not restored';
  END IF;
END;
$down_verify$;

NOTIFY pgrst, 'reload schema';
