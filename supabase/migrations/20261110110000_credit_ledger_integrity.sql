-- 크레딧 원장 정합성 수정. 계획 docs/payment-integrity-fixes-plan.md 2.5·2.6·2.15·2.16·2.17, 3.4.
-- 1) refund_credits: 환불 완료·만료 원천은 건너뛰고(CONTINUE), 실제로 늘어난 양만 원장에 쓴다.
--    되돌리지 못한 양(복구 불가·상한 초과·소비 내역 부족)은 같은 트랜잭션의 CREDIT_REFUND_SOURCE_SKIPPED 경보로 남긴다.
-- 2) approve_market_refund: 마켓 환불 승인(크레딧 복구·주문/이용권 회수·요청 승인·부족분 경보)을 한 트랜잭션으로 묶는다.
-- 3) grant_admin_credits: 관리자 지급(원천·결제이력·거래·잔액)을 한 트랜잭션으로, operation_key로 멱등 처리한다.
-- 4) 원장 CHECK 제약 4개 추가, payment_history_amount_charge_limit VALIDATE.
-- 5) 레거시 함수 consume_credits_once·refund_credits_once 삭제(호출처 0).
-- 마이그레이션 20261110100000_payment_integrity_fixes 뒤에만 적용한다(경보 dedupe_key 키 전제, 사전 점검이 확인).
-- 페이앱 판매가 꺼진 동안(payapp_accepts_new_orders=false)에만 적용한다(웹훅 지급 경로와의 교착 방지, 계획 3.4-2).
-- 적용부터 커밋 B 배포 확인까지 마켓 환불 승인·관리자 지급을 하지 않는다(계획 4.2, 6.2).
-- 되돌리기: supabase/rollback/20261110110000_credit_ledger_integrity_down.sql (커밋 B를 먼저 되돌린 뒤)
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 0. 사전 점검: 마이그레이션 1 적용 여부, 바꿀 함수의 운영 정의(md5, 2026-11-10), 원장 위반 0건, *_credits_once 참조 0
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_count integer;
  v_refs integer;
BEGIN
  IF to_regclass('public.payment_reconciliation_alerts_active_key') IS NULL THEN
    RAISE EXCEPTION 'CREDIT_LEDGER_PRECHECK: payment_reconciliation_alerts_active_key missing (apply 20261110100000 first)';
  END IF;

  IF md5(pg_get_functiondef(to_regprocedure('public.refund_credits(uuid, integer, text, uuid, text, jsonb, integer)')))
       IS DISTINCT FROM '6a082ed597597efdbb688225076a3996' THEN
    RAISE EXCEPTION 'CREDIT_LEDGER_PRECHECK: refund_credits definition drifted';
  END IF;

  IF md5(pg_get_functiondef(to_regprocedure('public.consume_credits_once(uuid, integer, text, uuid, text, text)')))
       IS DISTINCT FROM '5bba3e44100b1eb403da9210b87ad53e' THEN
    RAISE EXCEPTION 'CREDIT_LEDGER_PRECHECK: consume_credits_once definition drifted';
  END IF;

  IF md5(pg_get_functiondef(to_regprocedure('public.refund_credits_once(uuid, integer, text, uuid, text, text, text, integer)')))
       IS DISTINCT FROM '5a7af4fbce9ef158d411b505cd419e6d' THEN
    RAISE EXCEPTION 'CREDIT_LEDGER_PRECHECK: refund_credits_once definition drifted';
  END IF;

  SELECT count(*) INTO v_count FROM public.credit_sources WHERE NOT (initial_credits > 0);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'CREDIT_LEDGER_PRECHECK: credit_sources_initial_credits_positive violated (% rows)', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.credit_sources
   WHERE NOT (remaining_credits >= 0 AND remaining_credits <= initial_credits);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'CREDIT_LEDGER_PRECHECK: credit_sources_remaining_credits_range violated (% rows)', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.credit_consumption WHERE NOT (amount > 0);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'CREDIT_LEDGER_PRECHECK: credit_consumption_amount_positive violated (% rows)', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.profiles WHERE NOT (credits >= 0);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'CREDIT_LEDGER_PRECHECK: profiles_credits_nonnegative violated (% rows)', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM public.payment_history WHERE NOT (amount >= 0 AND amount <= 100000);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'CREDIT_LEDGER_PRECHECK: payment_history_amount_charge_limit violated (% rows)', v_count;
  END IF;

  -- 두 함수 자신의 머리도 '_credits_once('에 걸리므로 반드시 자기 자신을 뺀다(계획 2.17).
  SELECT count(*) INTO v_refs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname NOT IN ('consume_credits_once', 'refund_credits_once')
     AND pg_get_functiondef(p.oid) ILIKE '%_credits_once(%';   -- '_'는 와일드카드라 더 넓게 걸릴 뿐 빠뜨리지 않는다
  IF v_refs > 0 THEN
    RAISE EXCEPTION 'CREDIT_LEDGER_PRECHECK: _credits_once referenced by % functions', v_refs;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. 원장 CHECK 제약(계획 2.16)
--    consume_credits의 잠금 순서(profiles → credit_sources)에 맞춰 profiles → credit_sources → credit_consumption → payment_history 순으로 잠근다.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_credits_nonnegative CHECK (credits >= 0);
ALTER TABLE public.credit_sources
  ADD CONSTRAINT credit_sources_initial_credits_positive CHECK (initial_credits > 0),
  ADD CONSTRAINT credit_sources_remaining_credits_range CHECK (remaining_credits >= 0 AND remaining_credits <= initial_credits);
ALTER TABLE public.credit_consumption
  ADD CONSTRAINT credit_consumption_amount_positive CHECK (amount > 0);
ALTER TABLE public.payment_history VALIDATE CONSTRAINT payment_history_amount_charge_limit;

-- ---------------------------------------------------------------------------
-- 2. refund_credits(계획 2.5). 인자·반환형 그대로, 운영 정의(md5 6a082ed5…)에서 필요한 줄만 바꾼다.
--    p_target_balance는 시그니처 호환을 위해 받기만 하고 쓰지 않는다. 잔액은 원장 값으로만 쓴다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_credits(p_user_id uuid, p_amount integer, p_resource_type text, p_resource_id uuid, p_description text, p_consumptions jsonb, p_target_balance integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_item jsonb;
  v_source_id uuid;
  v_refund_amount integer;
  v_remaining_refund integer := p_amount;
  v_total_refunded integer := 0;
  v_source_initial integer;
  v_new_balance integer;
  v_before integer;
  v_after integer;
  v_source_status text;
  v_source_expires_at timestamptz;
  v_skipped integer := 0;
  v_skipped_unrestorable integer := 0;
  v_skipped_capped integer := 0;
  v_skipped_unmatched integer := 0;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_CREDIT_REFUND_AMOUNT';
  END IF;

  IF p_consumptions IS NULL
     OR jsonb_typeof(p_consumptions) <> 'array'
     OR jsonb_array_length(p_consumptions) = 0 THEN
    RAISE EXCEPTION 'CREDIT_REFUND_SOURCE_REQUIRED';
  END IF;

  PERFORM 1
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CREDIT_USER_NOT_FOUND';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_consumptions)
  LOOP
    EXIT WHEN v_remaining_refund <= 0;

    v_source_id := NULLIF(v_item->>'source_id', '')::uuid;
    v_refund_amount := COALESCE((v_item->>'amount')::integer, 0);

    IF v_source_id IS NULL OR v_refund_amount <= 0 THEN
      CONTINUE;
    END IF;

    SELECT initial_credits, remaining_credits, status, expires_at
      INTO v_source_initial, v_before, v_source_status, v_source_expires_at
      FROM public.credit_sources
     WHERE id = v_source_id
       AND user_id = p_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CREDIT_REFUND_SOURCE_NOT_FOUND';
    END IF;

    -- 환불 완료·만료 원천에는 되돌리지 않는다(잔액에 안 보이고 원장만 어긋난다).
    -- 함수 전체를 멈추지 않고 그 항목만 건너뛴다. 같은 차감의 다른(active) 원천 몫은 계속 복구한다.
    IF v_source_status NOT IN ('active', 'pending_refund')
       OR (v_source_expires_at IS NOT NULL AND v_source_expires_at <= v_now) THEN
      v_skipped_unrestorable := v_skipped_unrestorable + LEAST(v_refund_amount, v_remaining_refund);
      v_remaining_refund := v_remaining_refund - LEAST(v_refund_amount, v_remaining_refund);
      CONTINUE;
    END IF;

    v_refund_amount := LEAST(v_refund_amount, v_remaining_refund);

    UPDATE public.credit_sources
       SET remaining_credits = LEAST(
         remaining_credits + v_refund_amount,
         v_source_initial
       )
     WHERE id = v_source_id
    RETURNING remaining_credits INTO v_after;

    -- 실제로 늘어난 양만 원장에 쓴다.
    v_total_refunded := v_total_refunded + (v_after - v_before);
    -- 상한(initial)에 걸려 덜 늘어난 양. 같은 소비를 두 번 환불하려 했다는 뜻이라 막되 기록한다.
    v_skipped_capped := v_skipped_capped + (v_refund_amount - (v_after - v_before));
    v_remaining_refund := v_remaining_refund - v_refund_amount;
  END LOOP;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_new_balance
    FROM public.credit_sources
   WHERE user_id = p_user_id
     AND status IN ('active', 'pending_refund')
     AND (expires_at IS NULL OR expires_at > v_now);

  UPDATE public.profiles
     SET credits = v_new_balance
   WHERE id = p_user_id;

  -- 복구가 0이면 거래 행을 만들지 않는다.
  IF v_total_refunded > 0 THEN
    INSERT INTO public.credit_transactions (
      user_id,
      type,
      amount,
      balance_after,
      description,
      resource_type,
      resource_id
    ) VALUES (
      p_user_id,
      'refund',
      v_total_refunded,
      v_new_balance,
      p_description,
      p_resource_type,
      p_resource_id
    );
  END IF;

  -- 소비 내역 합이 p_amount보다 작아 배정하지 못한 양.
  v_skipped_unmatched := GREATEST(v_remaining_refund, 0);
  v_skipped := v_skipped_unrestorable + v_skipped_capped + v_skipped_unmatched;

  -- 되돌리지 못한 양은 같은 트랜잭션의 지울 수 없는 기록으로 남긴다. 호출마다 1행(dedupe_key, 계획 2.2).
  IF v_skipped > 0 THEN
    PERFORM public.record_payment_alert(
      'CREDIT_REFUND_SOURCE_SKIPPED', 'warning',
      '일부 크레딧을 되돌리지 못했습니다(환불 완료·만료 원천, 원천 한도 초과, 소비 내역 부족). 사용자에게 보상이 필요한지 확인하세요.',
      jsonb_build_object('user_id', p_user_id, 'resource_type', p_resource_type, 'resource_id', p_resource_id,
                         'requested', p_amount, 'refunded', v_total_refunded, 'skipped', v_skipped,
                         'skipped_unrestorable', v_skipped_unrestorable, 'skipped_capped', v_skipped_capped,
                         'skipped_unmatched', v_skipped_unmatched,
                         'dedupe_key', 'credit_refund_skip:' || gen_random_uuid()::text,
                         'source', 'refund_credits'));
  END IF;

  RETURN jsonb_build_object(
    'new_balance', v_new_balance,
    'refunded', v_total_refunded,
    'skipped', v_skipped
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. approve_market_refund(계획 2.6). 승인·크레딧 복구·주문/이용권 회수·부족분 경보를 한 트랜잭션으로 처리한다.
--    잠금 순서: profiles → 환불 요청 → 대상 주문/구매 → credit_sources (checkout_market_selection·consume_credits와 같이 프로필 먼저).
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.approve_market_refund(
  p_request_id uuid,
  p_admin_id uuid,
  p_admin_note text,
  p_confirmed_refund_credits integer DEFAULT NULL
)
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

REVOKE ALL ON FUNCTION public.approve_market_refund(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_market_refund(uuid, uuid, text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. grant_admin_credits(계획 2.15). 원천·결제이력·거래·잔액을 한 트랜잭션으로, operation_key로 멱등 처리한다.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.grant_admin_credits(
  p_user_id uuid,
  p_amount integer,
  p_source_category text,
  p_payment_method text,
  p_operation_key text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_existing public.credit_transactions%ROWTYPE;
  v_existing_category text;
  v_existing_payment_method text;
  v_source_id uuid;
  v_new_balance integer;
BEGIN
  IF p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 10000
     OR p_source_category IS NULL
     OR p_source_category NOT IN ('admin_grant', 'bonus', 'system_refund')
     OR p_operation_key IS NULL
     OR length(p_operation_key) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'ADMIN_GRANT_INPUT_INVALID';
  END IF;

  PERFORM 1
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CREDIT_USER_NOT_FOUND';
  END IF;

  -- 같은 키의 재요청은 프로필 잠금 뒤 기존 거래를 찾아 그대로 돌려준다(사용자 조건 없이 찾는다).
  SELECT * INTO v_existing
    FROM public.credit_transactions
   WHERE operation_key = p_operation_key
   LIMIT 1;

  IF FOUND THEN
    SELECT source_category INTO v_existing_category
      FROM public.credit_sources
     WHERE id = v_existing.source_id;

    SELECT payment_method INTO v_existing_payment_method
      FROM public.payment_history
     WHERE source_id = v_existing.source_id
     LIMIT 1;

    -- 응답 유실 뒤 내용을 고쳐 같은 키로 다시 보내면 옛 지급을 성공으로 돌려주지 않고 거부한다.
    IF v_existing.user_id IS DISTINCT FROM p_user_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing_category IS DISTINCT FROM p_source_category
       OR v_existing_payment_method IS DISTINCT FROM p_payment_method THEN
      RAISE EXCEPTION 'ADMIN_GRANT_IDEMPOTENCY_CONFLICT';
    END IF;

    SELECT COALESCE(SUM(remaining_credits), 0)::integer
      INTO v_new_balance
      FROM public.credit_sources
     WHERE user_id = p_user_id
       AND status IN ('active', 'pending_refund')
       AND (expires_at IS NULL OR expires_at > v_now);

    RETURN jsonb_build_object(
      'already_granted', true,
      'source_id', v_existing.source_id,
      'new_balance', v_new_balance
    );
  END IF;

  INSERT INTO public.credit_sources (
    user_id,
    plan_id,
    initial_credits,
    remaining_credits,
    status,
    source_category
  ) VALUES (
    p_user_id,
    NULL,
    p_amount,
    p_amount,
    'active',
    p_source_category
  )
  RETURNING id INTO v_source_id;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_new_balance
    FROM public.credit_sources
   WHERE user_id = p_user_id
     AND status IN ('active', 'pending_refund')
     AND (expires_at IS NULL OR expires_at > v_now);

  UPDATE public.profiles
     SET credits = v_new_balance
   WHERE id = p_user_id;

  INSERT INTO public.payment_history (
    user_id,
    source_id,
    plan_id,
    amount,
    payment_method,
    status
  ) VALUES (
    p_user_id,
    v_source_id,
    NULL,
    0,
    p_payment_method,
    'completed'
  );

  INSERT INTO public.credit_transactions (
    user_id,
    type,
    amount,
    balance_after,
    description,
    source_id,
    operation_key
  ) VALUES (
    p_user_id,
    'purchase',
    p_amount,
    v_new_balance,
    format('크레딧 %s개 구매', to_char(p_amount, 'FM999,999,999')),
    v_source_id,
    p_operation_key
  );

  RETURN jsonb_build_object(
    'already_granted', false,
    'source_id', v_source_id,
    'new_balance', v_new_balance
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.grant_admin_credits(uuid, integer, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_admin_credits(uuid, integer, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. 레거시 함수 삭제(계획 2.17). 호출처·참조 0(사전 점검).
-- ---------------------------------------------------------------------------
DROP FUNCTION public.consume_credits_once(uuid, integer, text, uuid, text, text);
DROP FUNCTION public.refund_credits_once(uuid, integer, text, uuid, text, text, text, integer);

-- ---------------------------------------------------------------------------
-- 6. 사후 점검: 세 함수의 SECURITY DEFINER·search_path, 새 함수 ACL(anon·authenticated 없음)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn regprocedure;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.refund_credits(uuid, integer, text, uuid, text, jsonb, integer)'::regprocedure,
    'public.approve_market_refund(uuid, uuid, text, integer)'::regprocedure,
    'public.grant_admin_credits(uuid, integer, text, text, text)'::regprocedure
  ]
  LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn)
       OR NOT (SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp'] FROM pg_proc WHERE oid = v_fn) THEN
      RAISE EXCEPTION 'VERIFY: % security definer or search_path missing', v_fn;
    END IF;

    IF (SELECT proacl::text FROM pg_proc WHERE oid = v_fn)
         IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
      RAISE EXCEPTION 'VERIFY: % privileges', v_fn;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
