-- 되돌리기 (나) 함수·트리거: 20261126100000_member_withdrawal.sql 의 재정의 20개를 원래 정의로, 탈퇴 회원 보호 트리거 10개를 지우고,
-- 새 service_role 함수 전부의 EXECUTE 를 회수한다. 표·칸·설정·정책·새 함수 본문은 남긴다(지우는 것은 (가) down_a).
-- 순서: 코드를 10번 이전으로 되돌려 배포 → 이 파일 → _down_a.sql. 10번 코드가 돌고 있으면 down_a 를 하지 않는다.
-- 사전 조건: 재정의 함수가 10번 지문, 보관함 행 0·요청 행 0(탈퇴 회원이 있으면 되돌리지 않고 고쳐서 앞으로 간다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $down_b_precheck$
DECLARE
  v_new text[][] := ARRAY[
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '657bbb07ae4b250a2697f21e2aa805e9'],
    ARRAY['public.apply_payapp_feedback(text,text,text,text,integer,integer,integer,integer,timestamp with time zone,timestamp with time zone)', '1859412411fc132dacfae4ca7a89eba4'],
    ARRAY['public.retry_payapp_fulfillment(uuid)', '93cde859327328f598e71059dcc04e6d'],
    ARRAY['public.resolve_payment_order_review(uuid,text,uuid,text,text,timestamp with time zone,text)', 'cbe116d85e140991d5993b5563296b37'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '93e0bd5e41969f66f296f4353f3feeb9'],
    ARRAY['public.begin_payapp_request(uuid)', '679b4474c0dc42de11e5e9a14a7d1d4d'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', 'be4403fd993c45d618950a5908a91591'],
    ARRAY['public.process_payapp_cancellation(uuid)', 'e0f752c7759626790a2afb86eab6aee6'],
    ARRAY['public.payapp_sales_resume_blockers()', 'edbb1eb553719198ffa9f9bc0d3aca4c'],
    ARRAY['public.enforce_payment_reconciliation_health()', 'e563ade9c072b09e26844b655e918755'],
    ARRAY['public.prevent_payment_order_snapshot_update()', '940bcad422d63c58e5d31c5756b0d473'],
    ARRAY['public.consent_record_internal(uuid,jsonb,text)', '61a9beb9d7f94cf6b0ed9b4518b52b44'],
    ARRAY['public.guard_user_consents_mutation()', '4ba21dab0a28e0c117bbead375a3fc8f'],
    ARRAY['public.guard_market_purchase_notice_acks_mutation()', '3959ac2b8139d0f81365df59ed67ef10'],
    ARRAY['public.prevent_admin_event_mutation()', 'f35f60e1461e49138635ffd4a11a27f9'],
    ARRAY['public.remind_unanswered_admin_work()', 'b950b1bfecc0ed4d470293508c0e2a60'],
    ARRAY['public.guard_support_ticket_revisions_mutation()', '1a8d96fc0bfe469e491b86c2f866e3bd'],
    ARRAY['public.cancel_incomplete_kakao_signup(uuid)', 'a83431d12c4686a0fbe57976a82038fe'],
    ARRAY['public.complete_kakao_signup_with_consents(uuid,jsonb,text,text,text,text)', 'a43e805089f08a12e22721168dbe962a'],
    ARRAY['public.consent_eligible_member_count()', '4b1c6999080f9bf6978be808997fd9ac']
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_new, 1) LOOP
    IF md5(pg_get_functiondef(v_new[i][1]::regprocedure)) <> v_new[i][2] THEN
      RAISE EXCEPTION 'DOWN_B_BLOCKED: % is not the bundle 10 definition', v_new[i][1];
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.withdrawn_member_records) THEN
    RAISE EXCEPTION 'DOWN_B_BLOCKED: withdrawn member records exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_withdrawal_requests) THEN
    RAISE EXCEPTION 'DOWN_B_BLOCKED: withdrawal requests exist';
  END IF;
END;
$down_b_precheck$;

-- 1. 탈퇴 회원 보호 트리거
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.support_tickets;
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.support_ticket_revisions;
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.questions;
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.passages;
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.exam_papers;
DROP TRIGGER IF EXISTS guard_withdrawn_member_write ON public.exam_paper_items;
DROP TRIGGER IF EXISTS guard_withdrawn_member_view_event ON public.market_item_view_events;
DROP TRIGGER IF EXISTS guard_withdrawn_member_credit_source ON public.credit_sources;
DROP TRIGGER IF EXISTS guard_withdrawn_member_notification ON public.notifications;
DROP TRIGGER IF EXISTS record_withdrawn_member_manual_refund ON public.refund_requests;

-- 2. 새 service_role 함수 EXECUTE 회수
REVOKE ALL ON FUNCTION public.get_member_withdrawal_preview(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_member_withdrawal_notice(uuid, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_member_withdrawal_request(uuid, text, text, text, integer, integer, integer, text, uuid, boolean, text, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_member_withdrawal_request_reply(uuid, uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_member_withdrawal_request(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.anonymize_member(uuid, uuid, text, uuid, integer, text, boolean, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.redact_member_text(uuid, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_member_text_reviewed(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.close_withdrawn_member_held_order(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.add_withdrawn_member_event(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_withdrawn_member_auth_scrubbed(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdrawn_member_kakao_unlink_target(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.clear_withdrawn_member_kakao_unlink(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_withdrawn_member_record(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_withdrawn_member_ticket(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.scrub_member_admin_events(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdrawn_member_account_status(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_member_full_delete_auth_alert(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdrawn_member_held_order_ids(uuid[]) FROM PUBLIC, anon, authenticated, service_role;

-- 3. 재정의 함수 원래 정의(운영 DB pg_get_functiondef 원문)
-- 3-1. payapp_fulfill_order_internal
CREATE OR REPLACE FUNCTION public.payapp_fulfill_order_internal(p_payment_order_id uuid, p_approved_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_method_label text;
  v_source_id uuid;
  v_payment_history_id uuid;
  v_new_balance integer;
BEGIN
  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id
   FOR UPDATE;

  IF v_order.id IS NULL
     OR v_ppt.id IS NULL
     OR v_order.provider <> 'payapp'
     OR v_ppt.provider <> 'payapp'
     OR v_order.source_id IS NOT NULL
     OR v_order.status IN ('completed', 'refunded')
     OR v_ppt.provider_transaction_id IS NULL
     OR v_ppt.cancel_feedback_recorded_at IS NOT NULL
     OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
     OR NOT COALESCE(
       (v_ppt.paid_feedback_recorded_at IS NOT NULL
        AND v_ppt.paid_amount IS NOT DISTINCT FROM v_order.expected_amount)
       OR v_ppt.admin_paid_confirmed_at IS NOT NULL,
       false
     )
     OR p_approved_at IS NULL THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FULFILLABLE';
  END IF;

  SELECT pm.label INTO v_method_label
    FROM public.payment_methods pm
   WHERE pm.code = v_order.payment_method_code
     AND pm.provider = 'payapp';

  IF v_method_label IS NULL THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FULFILLABLE';
  END IF;

  PERFORM 1
    FROM public.profiles
   WHERE id = v_order.user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_USER_NOT_FOUND';
  END IF;

  INSERT INTO public.credit_sources (
    user_id,
    plan_id,
    initial_credits,
    remaining_credits,
    status,
    source_category,
    purchased_at,
    expires_at,
    payment_order_id
  ) VALUES (
    v_order.user_id,
    v_order.plan_id,
    v_order.expected_credits,
    v_order.expected_credits,
    'active',
    'plan_purchase',
    p_approved_at,
    p_approved_at + interval '1 year',
    v_order.id
  )
  RETURNING id INTO v_source_id;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_new_balance
    FROM public.credit_sources
   WHERE user_id = v_order.user_id
     AND status IN ('active', 'pending_refund')
     AND (expires_at IS NULL OR expires_at > now());

  UPDATE public.profiles
     SET credits = v_new_balance
   WHERE id = v_order.user_id;

  INSERT INTO public.payment_history (
    user_id,
    source_id,
    plan_id,
    amount,
    payment_method,
    payment_key,
    status,
    payment_order_id,
    order_id,
    provider,
    provider_status,
    approved_at
  ) VALUES (
    v_order.user_id,
    v_source_id,
    v_order.plan_id,
    v_order.expected_amount,
    v_method_label,
    NULL,
    'completed',
    v_order.id,
    v_order.order_id,
    'payapp',
    v_ppt.provider_status,
    p_approved_at
  )
  RETURNING id INTO v_payment_history_id;

  INSERT INTO public.credit_transactions (
    user_id,
    type,
    amount,
    balance_after,
    description,
    source_id,
    resource_type,
    resource_id
  ) VALUES (
    v_order.user_id,
    'purchase',
    v_order.expected_credits,
    v_new_balance,
    format('크레딧 %s개 구매', v_order.expected_credits),
    v_source_id,
    'payment_order',
    v_order.id
  );

  UPDATE public.payment_orders
     SET status = 'completed',
         provider_method = v_method_label,
         approved_at = p_approved_at,
         fulfilled_at = now(),
         source_id = v_source_id,
         payment_history_id = v_payment_history_id,
         failure_code = NULL,
         failure_message = NULL,
         next_reconcile_at = NULL
   WHERE id = v_order.id;

  UPDATE public.checkout_attempts
     SET status = 'completed',
         updated_at = now()
   WHERE id = v_order.checkout_attempt_id;

  RETURN jsonb_build_object(
    'source_id', v_source_id,
    'payment_history_id', v_payment_history_id,
    'new_balance', v_new_balance,
    'credits', v_order.expected_credits
  );
END;
$function$
;

-- 3-2. apply_payapp_feedback
CREATE OR REPLACE FUNCTION public.apply_payapp_feedback(p_userid text, p_mul_no text, p_orig_mul_no text, p_order_id text, p_pay_state integer, p_price integer, p_orig_price integer, p_pay_type integer, p_pay_date timestamp with time zone, p_canceldate timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_marker boolean := p_pay_state IN (9, 64, 70, 71);
  v_lookup_mul_no text;
  v_by_mul_no uuid;
  v_by_order_id uuid;
  v_order_id uuid;
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_reason text;
  v_status_text text;
  v_already boolean;
  v_expected_pay_types integer[];
  v_pay_type_mismatch boolean := false;
  v_paid_amount_conflict boolean := false;
  v_fulfill jsonb;
  v_error_state text;
BEGIN
  IF p_pay_state IS NULL THEN
    RETURN jsonb_build_object('result', 'ignored', 'reason', 'PAY_STATE_MISSING');
  END IF;

  -- 1. 주문 찾기(잠금 없음). 판단은 2단계에서 잠근 행으로 한다.
  v_lookup_mul_no := CASE WHEN p_pay_state IN (70, 71) THEN p_orig_mul_no ELSE p_mul_no END;

  IF v_lookup_mul_no IS NOT NULL THEN
    SELECT ppt.payment_order_id INTO v_by_mul_no
      FROM public.payment_provider_transactions ppt
     WHERE ppt.provider = 'payapp'
       AND ppt.provider_transaction_id = v_lookup_mul_no;
  END IF;

  IF NULLIF(BTRIM(p_order_id), '') IS NOT NULL THEN
    SELECT po.id INTO v_by_order_id
      FROM public.payment_orders po
     WHERE po.order_id = p_order_id
       AND po.provider = 'payapp';
  END IF;

  IF v_by_mul_no IS NOT NULL AND v_by_order_id IS NOT NULL
     AND v_by_mul_no <> v_by_order_id THEN
    RETURN jsonb_build_object('result', 'ignored', 'reason', 'PAYAPP_ORDER_REFERENCE_MISMATCH');
  END IF;

  v_order_id := COALESCE(v_by_mul_no, v_by_order_id);

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('result', 'order_not_found');
  END IF;

  -- 2·3. 취소 표식 경로: payment_provider_transactions 한 행만 잠그고 주문 행은 쓰지 않는다.
  IF v_is_marker THEN
    SELECT * INTO v_ppt
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order_id
     FOR UPDATE;

    -- 불변 스냅샷 값만 읽는다(잠금 없음).
    SELECT * INTO v_order
      FROM public.payment_orders
     WHERE id = v_order_id;

    IF v_ppt.id IS NULL OR v_ppt.provider <> 'payapp' THEN
      v_reason := 'PAYAPP_TRANSACTION_NOT_FOUND';
    ELSIF p_userid IS DISTINCT FROM v_order.provider_merchant_id THEN
      v_reason := 'PAYAPP_FEEDBACK_MERCHANT_MISMATCH';
    -- 부분취소 뒤 승인취소는 price가 잔액(원금 - 부분취소 금액)으로 올 수 있어 그 값도 받는다.
    -- price가 NULL이면 지금처럼 금액 불일치로 둔다.
    ELSIF p_pay_state IN (9, 64)
      AND p_price IS DISTINCT FROM v_order.expected_amount
      AND NOT (p_price IS NOT NULL
               AND v_ppt.partial_cancel_amount IS NOT NULL
               AND p_price = v_order.expected_amount - v_ppt.partial_cancel_amount) THEN
      v_reason := 'PAYAPP_FEEDBACK_AMOUNT_MISMATCH';
    ELSIF p_pay_state IN (70, 71) AND p_orig_price IS DISTINCT FROM v_order.expected_amount THEN
      v_reason := 'PAYAPP_FEEDBACK_AMOUNT_MISMATCH';
    ELSIF v_lookup_mul_no IS NULL
       OR (v_ppt.provider_transaction_id IS NOT NULL
           AND v_ppt.provider_transaction_id <> v_lookup_mul_no) THEN
      v_reason := 'PAYAPP_FEEDBACK_MUL_NO_MISMATCH';
    END IF;

    IF v_reason IS NOT NULL THEN
      RETURN jsonb_build_object(
        'result', 'ignored',
        'reason', v_reason,
        'payment_order_id', v_order_id,
        'order_id', v_order.order_id
      );
    END IF;

    IF p_pay_state IN (9, 64) THEN
      v_already := v_ppt.cancel_feedback_recorded_at IS NOT NULL;
    ELSE
      v_already := v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL;
      -- 금액은 처음 값만 남기고, 다른 금액이 다시 오면 결과 키로 알려 route가 경보를 남긴다.
      v_paid_amount_conflict := v_ppt.partial_cancel_amount IS NOT NULL
        AND p_price IS DISTINCT FROM v_ppt.partial_cancel_amount;
    END IF;

    BEGIN
      UPDATE public.payment_provider_transactions
         SET provider_transaction_id = COALESCE(provider_transaction_id, v_lookup_mul_no),
             cancel_feedback_recorded_at = CASE
               WHEN p_pay_state IN (9, 64) THEN COALESCE(cancel_feedback_recorded_at, now())
               ELSE cancel_feedback_recorded_at
             END,
             provider_cancelled_at = CASE
               WHEN p_pay_state IN (9, 64) THEN COALESCE(provider_cancelled_at, p_canceldate)
               ELSE provider_cancelled_at
             END,
             partial_cancel_feedback_recorded_at = CASE
               WHEN p_pay_state IN (70, 71) THEN COALESCE(partial_cancel_feedback_recorded_at, now())
               ELSE partial_cancel_feedback_recorded_at
             END,
             -- 부분취소 통보의 price는 취소된 금액이다. 원금 미만일 때만 기록한다.
             partial_cancel_amount = CASE
               WHEN p_pay_state IN (70, 71) AND p_price BETWEEN 1 AND v_order.expected_amount - 1
                 THEN COALESCE(partial_cancel_amount, p_price)
               ELSE partial_cancel_amount
             END,
             -- 표시용 상태는 진행 순위가 낮은 값으로 되돌리지 않는다.
             provider_status = CASE
               WHEN CASE provider_status WHEN '1' THEN 1 WHEN '10' THEN 2 WHEN '8' THEN 3 WHEN '16' THEN 3 WHEN '32' THEN 3 WHEN '4' THEN 4 WHEN '70' THEN 5 WHEN '71' THEN 5 WHEN '9' THEN 6 WHEN '64' THEN 6 ELSE 0 END >= CASE p_pay_state::text WHEN '1' THEN 1 WHEN '10' THEN 2 WHEN '8' THEN 3 WHEN '16' THEN 3 WHEN '32' THEN 3 WHEN '4' THEN 4 WHEN '70' THEN 5 WHEN '71' THEN 5 WHEN '9' THEN 6 WHEN '64' THEN 6 ELSE 0 END
                 THEN provider_status
               ELSE p_pay_state::text
             END,
             updated_at = now()
       WHERE id = v_ppt.id;
    EXCEPTION
      WHEN unique_violation THEN
        RETURN jsonb_build_object(
          'result', 'ignored',
          'reason', 'PAYAPP_MUL_NO_CONFLICT',
          'payment_order_id', v_order_id,
          'order_id', v_order.order_id
        );
    END;

    RETURN jsonb_build_object(
      'result', 'cancel_marker_recorded',
      'marker', CASE WHEN p_pay_state IN (9, 64) THEN 'cancel' ELSE 'partial_cancel' END,
      'already_recorded', v_already,
      'partial_cancel_amount_mismatch', v_paid_amount_conflict,
      'payment_order_id', v_order_id,
      'order_id', v_order.order_id
    );
  END IF;

  -- 2. 그 밖의 상태: payment_orders → payment_provider_transactions 순으로 잠그고 다시 읽는다.
  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_order_id
   FOR UPDATE;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = v_order_id
   FOR UPDATE;

  IF v_order.provider <> 'payapp' OR v_ppt.id IS NULL OR v_ppt.provider <> 'payapp' THEN
    v_reason := 'PAYAPP_TRANSACTION_NOT_FOUND';
  ELSIF p_userid IS DISTINCT FROM v_order.provider_merchant_id THEN
    v_reason := 'PAYAPP_FEEDBACK_MERCHANT_MISMATCH';
  ELSIF p_price IS DISTINCT FROM v_order.expected_amount THEN
    v_reason := 'PAYAPP_FEEDBACK_AMOUNT_MISMATCH';
  ELSIF p_mul_no IS NULL
     OR (v_ppt.provider_transaction_id IS NOT NULL
         AND v_ppt.provider_transaction_id <> p_mul_no) THEN
    v_reason := 'PAYAPP_FEEDBACK_MUL_NO_MISMATCH';
  ELSIF v_ppt.provider_transaction_id IS NULL THEN
    BEGIN
      UPDATE public.payment_provider_transactions
         SET provider_transaction_id = p_mul_no,
             updated_at = now()
       WHERE id = v_ppt.id;
      v_ppt.provider_transaction_id := p_mul_no;
    EXCEPTION
      WHEN unique_violation THEN
        v_reason := 'PAYAPP_MUL_NO_CONFLICT';
    END;
  END IF;

  IF v_reason IS NOT NULL THEN
    -- 미지급 주문이면 manual_review로 보낸다. 지급·환불이 끝난 주문은 바꾸지 않는다.
    IF v_reason <> 'PAYAPP_TRANSACTION_NOT_FOUND'
       AND p_pay_state IN (1, 4, 8, 16, 32)
       AND v_order.source_id IS NULL
       AND v_order.status NOT IN ('completed', 'refunded', 'manual_review') THEN
      UPDATE public.payment_orders
         SET status = 'manual_review',
             failure_code = CASE
               WHEN v_reason = 'PAYAPP_MUL_NO_CONFLICT' THEN 'PAYAPP_MUL_NO_CONFLICT'
               ELSE 'PAYAPP_FEEDBACK_MISMATCH'
             END,
             failure_message = LEFT(format('페이앱 통보 검증 실패: %s', v_reason), 500),
             next_reconcile_at = NULL,
             updated_at = now()
       WHERE id = v_order.id;

      UPDATE public.checkout_attempts
         SET status = 'manual_review',
             updated_at = now()
       WHERE id = v_order.checkout_attempt_id
         AND status <> 'completed';
    END IF;

    RETURN jsonb_build_object(
      'result', 'ignored',
      'reason', v_reason,
      'payment_order_id', v_order_id,
      'order_id', v_order.order_id
    );
  END IF;

  -- 표시용 상태는 진행 순위(1 < 10 < 8·16·32 < 4 < 70·71 < 9·64)가 낮은 값으로 되돌리지 않는다.
  v_status_text := CASE
    WHEN CASE v_ppt.provider_status WHEN '1' THEN 1 WHEN '10' THEN 2 WHEN '8' THEN 3 WHEN '16' THEN 3 WHEN '32' THEN 3 WHEN '4' THEN 4 WHEN '70' THEN 5 WHEN '71' THEN 5 WHEN '9' THEN 6 WHEN '64' THEN 6 ELSE 0 END >= CASE p_pay_state::text WHEN '1' THEN 1 WHEN '10' THEN 2 WHEN '8' THEN 3 WHEN '16' THEN 3 WHEN '32' THEN 3 WHEN '4' THEN 4 WHEN '70' THEN 5 WHEN '71' THEN 5 WHEN '9' THEN 6 WHEN '64' THEN 6 ELSE 0 END
      THEN v_ppt.provider_status
    ELSE p_pay_state::text
  END;

  -- 결제 요청(1): mul_no 저장만 한다.
  IF p_pay_state = 1 THEN
    UPDATE public.payment_provider_transactions
       SET provider_status = v_status_text,
           updated_at = now()
     WHERE id = v_ppt.id;

    RETURN jsonb_build_object(
      'result', 'request_recorded',
      'payment_order_id', v_order.id,
      'order_id', v_order.order_id
    );
  END IF;

  -- 결제완료(4): 기록은 바깥 블록, 지급은 모든 예외를 잡는 서브블록.
  IF p_pay_state = 4 THEN
    IF v_ppt.paid_amount IS NOT NULL AND v_ppt.paid_amount <> p_price THEN
      v_paid_amount_conflict := true;
    END IF;

    UPDATE public.payment_provider_transactions
       SET paid_feedback_recorded_at = COALESCE(paid_feedback_recorded_at, now()),
           provider_paid_at = COALESCE(provider_paid_at, p_pay_date),
           paid_amount = COALESCE(paid_amount, p_price),
           payment_method_type = COALESCE(payment_method_type, p_pay_type::text),
           provider_status = v_status_text,
           updated_at = now()
     WHERE id = v_ppt.id
    RETURNING * INTO v_ppt;

    SELECT pm.provider_pay_types INTO v_expected_pay_types
      FROM public.payment_methods pm
     WHERE pm.code = v_order.payment_method_code
       AND pm.provider = 'payapp';

    v_pay_type_mismatch := p_pay_type IS NULL
      OR v_expected_pay_types IS NULL
      OR NOT (p_pay_type = ANY (v_expected_pay_types));

    IF v_ppt.cancel_feedback_recorded_at IS NOT NULL
       OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'result', 'cancelled_before_fulfillment',
        'payment_order_id', v_order.id,
        'order_id', v_order.order_id
      );
    END IF;

    IF v_order.source_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'result', 'already_fulfilled',
        'payment_order_id', v_order.id,
        'order_id', v_order.order_id,
        'paid_amount_conflict', v_paid_amount_conflict
      );
    END IF;

    -- 결제 전 대기 동안 쌓인 대사 백오프를 지워, 지급이 실패하면 다음 회차에 바로 재시도한다.
    UPDATE public.payment_orders
       SET status = 'fulfillment_pending',
           provider_status = v_status_text,
           failure_code = NULL,
           failure_message = NULL,
           next_reconcile_at = NULL,
           reconcile_attempt_count = 0,
           updated_at = now()
     WHERE id = v_order.id;

    BEGIN
      v_fulfill := public.payapp_fulfill_order_internal(
        v_order.id,
        COALESCE(v_ppt.provider_paid_at, v_ppt.paid_feedback_recorded_at)
      );
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE;
        v_fulfill := NULL;
    END;

    -- pay_type·금액 기록 불일치 경보와 관리자 알림은 route가 별도 트랜잭션에서 남긴다(5.6).
    RETURN jsonb_build_object(
      'result', CASE WHEN v_fulfill IS NULL THEN 'recorded_pending' ELSE 'fulfilled' END,
      'payment_order_id', v_order.id,
      'order_id', v_order.order_id,
      'user_id', v_order.user_id,
      'fulfillment_error_state', v_error_state,
      'new_balance', v_fulfill->'new_balance',
      'pay_type_mismatch', v_pay_type_mismatch,
      'paid_amount_conflict', v_paid_amount_conflict
    );
  END IF;

  -- 요청 취소(8·16·32): 미결제 주문만 만료한다.
  IF p_pay_state IN (8, 16, 32) THEN
    UPDATE public.payment_provider_transactions
       SET provider_status = v_status_text,
           updated_at = now()
     WHERE id = v_ppt.id;

    IF v_order.source_id IS NULL
       AND v_ppt.paid_feedback_recorded_at IS NULL
       AND v_ppt.admin_paid_confirmed_at IS NULL
       AND v_ppt.cancel_feedback_recorded_at IS NULL
       AND v_ppt.partial_cancel_feedback_recorded_at IS NULL
       AND (
         v_order.status IN ('ready', 'ready_unknown')
         OR (v_order.status = 'manual_review'
             AND v_order.failure_code = 'PAYAPP_READY_CANCEL_FAILED')
       ) THEN
      UPDATE public.payment_orders
         SET status = 'expired',
             provider_status = v_status_text,
             failure_code = 'PAYAPP_REQUEST_CANCELLED',
             failure_message = '페이앱 결제 요청이 취소되었습니다.',
             next_reconcile_at = NULL,
             updated_at = now()
       WHERE id = v_order.id;

      UPDATE public.checkout_attempts
         SET status = 'expired',
             updated_at = now()
       WHERE id = v_order.checkout_attempt_id
         AND status <> 'completed';

      RETURN jsonb_build_object(
        'result', 'expired',
        'payment_order_id', v_order.id,
        'order_id', v_order.order_id
      );
    END IF;

    RETURN jsonb_build_object(
      'result', 'unchanged',
      'payment_order_id', v_order.id,
      'order_id', v_order.order_id
    );
  END IF;

  -- 가상계좌 대기(10)와 그 밖의 상태: 기록만 한다.
  UPDATE public.payment_provider_transactions
     SET provider_status = v_status_text,
         updated_at = now()
   WHERE id = v_ppt.id;

  RETURN jsonb_build_object(
    'result', 'recorded',
    'payment_order_id', v_order.id,
    'order_id', v_order.order_id
  );
END;
$function$
;

-- 3-3. retry_payapp_fulfillment
CREATE OR REPLACE FUNCTION public.retry_payapp_fulfillment(p_payment_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_fulfill jsonb;
  v_error_state text;
  v_attempts integer;
BEGIN
  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id
   FOR UPDATE;

  IF v_order.id IS NULL OR v_order.provider <> 'payapp' OR v_ppt.id IS NULL THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FOUND';
  END IF;

  IF v_order.source_id IS NOT NULL OR v_order.status = 'completed' THEN
    RETURN jsonb_build_object('result', 'already_fulfilled', 'status', v_order.status);
  END IF;

  IF v_order.status <> 'fulfillment_pending'
     OR v_ppt.cancel_feedback_recorded_at IS NOT NULL
     OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
     OR v_ppt.paid_feedback_recorded_at IS NULL
     OR v_ppt.paid_amount IS DISTINCT FROM v_order.expected_amount THEN
    RETURN jsonb_build_object('result', 'not_retryable', 'status', v_order.status);
  END IF;

  BEGIN
    v_fulfill := public.payapp_fulfill_order_internal(
      v_order.id,
      COALESCE(v_ppt.provider_paid_at, v_ppt.paid_feedback_recorded_at)
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE;
      v_fulfill := NULL;
  END;

  IF v_fulfill IS NOT NULL THEN
    RETURN jsonb_build_object(
      'result', 'fulfilled',
      'user_id', v_order.user_id,
      'new_balance', v_fulfill->'new_balance'
    );
  END IF;

  UPDATE public.payment_provider_transactions
     SET fulfillment_attempt_count = fulfillment_attempt_count + 1,
         updated_at = now()
   WHERE id = v_ppt.id
  RETURNING fulfillment_attempt_count INTO v_attempts;

  IF v_attempts >= 3 THEN
    UPDATE public.payment_orders
       SET status = 'manual_review',
           failure_code = 'PAYAPP_FULFILLMENT_RETRY_EXHAUSTED',
           failure_message = '페이앱 결제완료 건의 크레딧 지급을 3회 재시도했지만 실패했습니다.',
           next_reconcile_at = NULL,
           updated_at = now()
     WHERE id = v_order.id
       AND status = 'fulfillment_pending';

    RETURN jsonb_build_object(
      'result', 'retry_exhausted',
      'attempts', v_attempts,
      'error_state', v_error_state
    );
  END IF;

  RETURN jsonb_build_object(
    'result', 'retry_failed',
    'attempts', v_attempts,
    'error_state', v_error_state
  );
END;
$function$
;

-- 3-4. resolve_payment_order_review
CREATE OR REPLACE FUNCTION public.resolve_payment_order_review(p_payment_order_id uuid, p_action text, p_actor_id uuid, p_note text, p_mul_no text DEFAULT NULL::text, p_paid_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_external_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_fulfill jsonb;
  v_paid_via text;
  v_after_status text;
  v_approved_at timestamptz;
BEGIN
  IF p_action IS NULL
     OR p_action NOT IN ('paid_confirmed', 'unpaid_confirmed', 'cancel_handled')
     OR p_actor_id IS NULL
     OR NULLIF(BTRIM(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_REVIEW_INPUT_INVALID';
  END IF;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND';
  END IF;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = v_order.id
   FOR UPDATE;

  IF v_order.status <> 'manual_review' THEN
    RAISE EXCEPTION 'PAYMENT_REVIEW_NOT_PENDING';
  END IF;

  IF p_action = 'paid_confirmed' THEN
    IF v_order.provider <> 'payapp'
       OR v_ppt.id IS NULL
       OR v_order.source_id IS NOT NULL
       OR v_ppt.cancel_feedback_recorded_at IS NOT NULL
       OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
       OR v_order.failure_code IN ('EXTERNAL_PROVIDER_CANCELLATION', 'PAYAPP_PARTIAL_CANCEL_QUARANTINED', 'PAYAPP_CANCEL_HANDLING_FAILED') THEN
      RAISE EXCEPTION 'PAYMENT_REVIEW_ACTION_NOT_ALLOWED';
    END IF;

    IF v_ppt.paid_feedback_recorded_at IS NOT NULL
       AND v_ppt.paid_amount = v_order.expected_amount THEN
      v_paid_via := 'feedback';
      v_approved_at := COALESCE(v_ppt.provider_paid_at, v_ppt.paid_feedback_recorded_at);
    ELSE
      IF p_mul_no IS NULL OR p_mul_no !~ '^[0-9]+$'
         OR (v_ppt.provider_transaction_id IS NOT NULL AND v_ppt.provider_transaction_id <> p_mul_no) THEN
        RAISE EXCEPTION 'PAYMENT_REVIEW_MUL_NO_INVALID';
      END IF;

      v_paid_via := 'admin';
      v_approved_at := COALESCE(p_paid_at, now());

      -- 결제 시각은 만료(1년)와 환불 기한(7일)의 기준이므로 주문 생성 이후·현재 이전만 받는다.
      IF v_approved_at > now() OR v_approved_at < v_order.created_at THEN
        RAISE EXCEPTION 'PAYMENT_REVIEW_PAID_AT_INVALID';
      END IF;

      BEGIN
        UPDATE public.payment_provider_transactions
           SET provider_transaction_id = COALESCE(provider_transaction_id, p_mul_no),
               admin_paid_confirmed_at = COALESCE(admin_paid_confirmed_at, v_approved_at),
               updated_at = now()
         WHERE id = v_ppt.id;
      EXCEPTION
        WHEN unique_violation THEN
          RAISE EXCEPTION 'PAYAPP_MUL_NO_CONFLICT';
      END;
    END IF;

    UPDATE public.payment_orders
       SET status = 'fulfillment_pending',
           updated_at = now()
     WHERE id = v_order.id;

    v_fulfill := public.payapp_fulfill_order_internal(v_order.id, v_approved_at);
    v_after_status := 'completed';
  ELSIF p_action = 'unpaid_confirmed' THEN
    IF v_order.provider <> 'payapp'
       OR v_order.source_id IS NOT NULL
       OR v_ppt.paid_feedback_recorded_at IS NOT NULL
       OR v_ppt.admin_paid_confirmed_at IS NOT NULL
       OR v_ppt.cancel_feedback_recorded_at IS NOT NULL
       OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL THEN
      RAISE EXCEPTION 'PAYMENT_REVIEW_ACTION_NOT_ALLOWED';
    END IF;

    UPDATE public.payment_orders
       SET status = 'expired',
           next_reconcile_at = NULL,
           updated_at = now()
     WHERE id = v_order.id;

    UPDATE public.checkout_attempts
       SET status = 'expired',
           updated_at = now()
     WHERE id = v_order.checkout_attempt_id
       AND status <> 'completed';

    v_after_status := 'expired';
  ELSE
    IF v_order.source_id IS NOT NULL THEN
      SELECT * INTO v_source
        FROM public.credit_sources
       WHERE id = v_order.source_id;
    END IF;

    IF p_external_method IS NULL
       OR p_external_method NOT IN ('payapp_cancel_request', 'bank_transfer', 'provider_admin_cancel')
       OR NOT (
         (v_order.provider = 'payapp' AND v_order.failure_code IN ('PAYAPP_PARTIAL_CANCEL', 'PAYAPP_CANCEL_HANDLING_FAILED'))
         OR (v_order.provider = 'kakaopay' AND v_order.failure_code = 'KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW')
       )
       OR (v_source.id IS NOT NULL AND v_source.status <> 'refunded') THEN
      -- 활성·묶인 원천이 있으면 complete_manual_point_charge_refund로 해소한다.
      RAISE EXCEPTION 'PAYMENT_REVIEW_ACTION_NOT_ALLOWED';
    END IF;

    v_after_status := CASE WHEN v_source.id IS NULL THEN 'failed' ELSE 'refunded' END;

    UPDATE public.payment_orders
       SET status = v_after_status,
           next_reconcile_at = NULL,
           updated_at = now()
     WHERE id = v_order.id;

    IF v_after_status = 'refunded' THEN
      UPDATE public.payment_history
         SET status = 'refunded'
       WHERE payment_order_id = v_order.id;
    END IF;

    UPDATE public.checkout_attempts
       SET status = 'cancelled',
           updated_at = now()
     WHERE id = v_order.checkout_attempt_id
       AND status <> 'completed';
  END IF;

  INSERT INTO public.payment_admin_actions (
    actor_id,
    action,
    payment_order_id,
    before_state,
    after_state,
    note,
    external_method,
    details
  ) VALUES (
    p_actor_id,
    p_action,
    v_order.id,
    jsonb_build_object('order_status', v_order.status, 'failure_code', v_order.failure_code),
    jsonb_build_object('order_status', v_after_status),
    p_note,
    p_external_method,
    jsonb_build_object(
      'paid_via', v_paid_via,
      'mul_no', COALESCE(v_ppt.provider_transaction_id, p_mul_no),
      'approved_at', v_approved_at,
      'fulfillment', v_fulfill
    )
  );

  UPDATE public.payment_reconciliation_alerts
     SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND details->>'payment_order_id' = v_order.id::text;

  RETURN jsonb_build_object(
    'status', v_after_status,
    'user_id', v_order.user_id,
    'new_balance', v_fulfill->'new_balance'
  );
END;
$function$
;

-- 3-5. prepare_payment_order
CREATE OR REPLACE FUNCTION public.prepare_payment_order(p_user_id uuid, p_checkout_attempt_id uuid, p_provider text, p_plan_id uuid, p_order_id text, p_plan_name_snapshot text, p_expected_amount integer, p_expected_credits integer, p_provider_environment text, p_provider_merchant_id text, p_request_fingerprint text, p_confirm_idempotency_key text, p_cancel_idempotency_key text, p_expires_at timestamp with time zone, p_tax_free_amount integer, p_vat_amount integer, p_partner_user_id text, p_payment_method_code text DEFAULT NULL::text)
 RETURNS payment_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
BEGIN
  IF p_provider NOT IN ('kakaopay', 'payapp')
     OR p_provider_environment NOT IN ('test', 'live')
     OR NULLIF(BTRIM(p_provider_merchant_id), '') IS NULL
     OR NULLIF(BTRIM(p_request_fingerprint), '') IS NULL
     OR p_expected_amount NOT BETWEEN 1 AND 100000
     OR p_expected_credits < 1
     OR p_tax_free_amount NOT BETWEEN 0 AND p_expected_amount
     OR p_vat_amount NOT BETWEEN 0 AND p_expected_amount
     OR p_expires_at <= now()
     OR (p_provider = 'kakaopay' AND (
       NULLIF(BTRIM(p_partner_user_id), '') IS NULL
       OR p_tax_free_amount <> 0
       OR p_vat_amount <> round(p_expected_amount::numeric / 11)::integer
     ))
     OR (p_provider = 'payapp' AND (
       p_provider_environment <> 'live'
       OR p_vat_amount IS NULL
       OR p_tax_free_amount <> 0
       OR p_vat_amount <> round(p_expected_amount::numeric / 11)::integer
       OR NOT EXISTS (
         SELECT 1
           FROM public.payment_methods pm
          WHERE pm.code = p_payment_method_code
            AND pm.provider = 'payapp'
            AND pm.is_enabled
       )
     ))
     OR (p_provider = 'kakaopay' AND p_payment_method_code IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
             FROM public.payment_methods pm
            WHERE pm.code = p_payment_method_code
              AND pm.provider = p_provider
         )) THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_INPUT_INVALID';
  END IF;

  INSERT INTO public.checkout_attempts (
    user_id,
    checkout_attempt_id,
    claimed_provider,
    plan_id,
    request_fingerprint,
    expires_at
  ) VALUES (
    p_user_id,
    p_checkout_attempt_id,
    p_provider,
    p_plan_id,
    p_request_fingerprint,
    p_expires_at
  )
  ON CONFLICT (user_id, checkout_attempt_id) DO NOTHING;

  SELECT *
    INTO v_attempt
    FROM public.checkout_attempts
   WHERE user_id = p_user_id
     AND checkout_attempt_id = p_checkout_attempt_id
   FOR UPDATE;

  IF v_attempt.claimed_provider IS DISTINCT FROM p_provider
     OR v_attempt.plan_id IS DISTINCT FROM p_plan_id
     OR v_attempt.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
    RAISE EXCEPTION 'PAYMENT_ATTEMPT_PAYLOAD_CONFLICT';
  END IF;

  IF v_attempt.payment_order_id IS NOT NULL THEN
    SELECT *
      INTO v_order
      FROM public.payment_orders
     WHERE id = v_attempt.payment_order_id;

    IF v_order.payment_method_code IS DISTINCT FROM p_payment_method_code THEN
      RAISE EXCEPTION 'PAYMENT_ATTEMPT_PAYLOAD_CONFLICT';
    END IF;

    RETURN v_order;
  END IF;

  INSERT INTO public.payment_orders (
    user_id,
    order_id,
    plan_id,
    plan_name_snapshot,
    expected_amount,
    expected_credits,
    provider,
    environment,
    provider_environment,
    mid,
    provider_merchant_id,
    partner_order_id,
    partner_user_id,
    tax_free_amount,
    vat_amount,
    status,
    request_fingerprint,
    checkout_attempt_id,
    confirm_idempotency_key,
    cancel_idempotency_key,
    expires_at,
    checkout_expires_at,
    ready_requested_at,
    ready_expires_at,
    payment_method_code
  ) VALUES (
    p_user_id,
    p_order_id,
    p_plan_id,
    p_plan_name_snapshot,
    p_expected_amount,
    p_expected_credits,
    p_provider,
    p_provider_environment,
    p_provider_environment,
    CASE
      WHEN p_provider = 'toss' THEN p_provider_merchant_id
      WHEN p_provider IN ('kakaopay', 'payapp') THEN NULL
    END,
    p_provider_merchant_id,
    p_order_id,
    CASE
      WHEN p_provider = 'kakaopay' THEN p_partner_user_id
      WHEN p_provider IN ('toss', 'payapp') THEN NULL
    END,
    p_tax_free_amount,
    p_vat_amount,
    CASE
      WHEN p_provider IN ('kakaopay', 'payapp') THEN 'preparing'
      WHEN p_provider = 'toss' THEN 'ready'
    END,
    p_request_fingerprint,
    v_attempt.id,
    p_confirm_idempotency_key,
    p_cancel_idempotency_key,
    p_expires_at,
    p_expires_at,
    CASE
      WHEN p_provider IN ('kakaopay', 'payapp') THEN now()
      WHEN p_provider = 'toss' THEN NULL
    END,
    CASE
      WHEN p_provider IN ('kakaopay', 'payapp') THEN p_expires_at
      WHEN p_provider = 'toss' THEN NULL
    END,
    p_payment_method_code
  )
  RETURNING * INTO v_order;

  UPDATE public.checkout_attempts
     SET payment_order_id = v_order.id,
         updated_at = now()
   WHERE id = v_attempt.id;

  RETURN v_order;
END;
$function$
;

-- 3-6. begin_payapp_request
CREATE OR REPLACE FUNCTION public.begin_payapp_request(p_payment_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_runtime public.payment_runtime_config%ROWTYPE;
BEGIN
  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND OR v_order.provider <> 'payapp' THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FOUND';
  END IF;

  SELECT *
    INTO v_runtime
    FROM public.payment_runtime_config
   WHERE id = true;

  -- 페이앱은 accepted_provider_environment를 보지 않고 항상 live다(5.3).
  IF NOT FOUND
     OR NOT v_runtime.master_accepts_new_orders
     OR NOT v_runtime.payapp_accepts_new_orders
     OR v_runtime.payapp_merchant_id IS DISTINCT FROM v_order.provider_merchant_id
     OR v_order.provider_environment <> 'live' THEN
    RAISE EXCEPTION 'PAYMENT_RUNTIME_GATE_CLOSED';
  END IF;

  IF v_order.status IN ('ready', 'ready_unknown') THEN
    RETURN jsonb_build_object('claimed', false, 'status', v_order.status);
  END IF;

  IF v_order.status <> 'preparing'
     OR v_order.ready_expires_at IS NULL
     OR v_order.ready_expires_at <= now()
     OR NOT EXISTS (
       SELECT 1
         FROM public.payment_methods pm
        WHERE pm.code = v_order.payment_method_code
          AND pm.provider = 'payapp'
          AND pm.is_enabled
     ) THEN
    RAISE EXCEPTION 'PAYAPP_REQUEST_NOT_CLAIMABLE';
  END IF;

  INSERT INTO public.payment_provider_transactions (
    payment_order_id,
    provider,
    provider_merchant_id
  ) VALUES (
    v_order.id,
    'payapp',
    v_order.provider_merchant_id
  );

  UPDATE public.payment_orders
     SET status = 'ready_unknown',
         failure_code = NULL,
         failure_message = NULL,
         updated_at = now()
   WHERE id = v_order.id;

  RETURN jsonb_build_object('claimed', true, 'status', 'ready_unknown');
END;
$function$
;

-- 3-7. record_point_charge_checkout_ack
CREATE OR REPLACE FUNCTION public.record_point_charge_checkout_ack(p_user_id uuid, p_checkout_attempt_id uuid, p_plan_id uuid, p_expected_amount integer, p_expected_credits integer, p_notice_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing public.point_charge_checkout_acks%ROWTYPE;
  v_value jsonb;
  v_items jsonb;
  v_days integer;
  v_parts text[];
  v_part text;
  v_key text;
  v_text text;
  v_sha text;
  v_plan public.pricing_plans%ROWTYPE;
  v_details jsonb;
  v_policy_sha text;
  v_inserted uuid;
BEGIN
  IF p_user_id IS NULL OR p_checkout_attempt_id IS NULL OR p_plan_id IS NULL OR p_expected_amount IS NULL OR p_expected_credits IS NULL
     OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID');
  END IF;

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;

  -- 지금 정책(필수 키·자리표시 규칙 — TS 저장 검사와 같음)
  v_days := public.point_charge_refund_days();
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'point_charge_policy';
  v_items := v_value -> 'checkoutItems';
  IF v_days IS NULL OR jsonb_typeof(v_items) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
  END IF;
  v_parts := ARRAY[v_value ->> 'checkoutTitle', v_items ->> 'product', v_items ->> 'validity', v_items ->> 'refund',
                   v_items ->> 'restriction', v_items ->> 'otherCases', v_value ->> 'minorNotice', v_value ->> 'agreeLabel'];
  FOREACH v_part IN ARRAY v_parts LOOP
    IF v_part IS NULL OR v_part !~ '\S' OR replace(v_part, '{충전환불기간}', '') ~ '[{}]' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
    END IF;
  END LOOP;
  IF strpos(v_items ->> 'refund', '{충전환불기간}') = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
  END IF;
  v_text := array_to_string(ARRAY(SELECT replace(x, '{충전환불기간}', v_days::text) FROM unnest(v_parts) WITH ORDINALITY AS t(x, n) ORDER BY n), chr(10));
  v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');

  SELECT * INTO v_plan FROM public.pricing_plans p WHERE p.id = p_plan_id;
  v_details := jsonb_build_object(
    'checkoutTitle', replace(v_value ->> 'checkoutTitle', '{충전환불기간}', v_days::text),
    'checkoutItems', jsonb_build_object(
      'product', replace(v_items ->> 'product', '{충전환불기간}', v_days::text),
      'validity', replace(v_items ->> 'validity', '{충전환불기간}', v_days::text),
      'refund', replace(v_items ->> 'refund', '{충전환불기간}', v_days::text),
      'restriction', replace(v_items ->> 'restriction', '{충전환불기간}', v_days::text),
      'otherCases', replace(v_items ->> 'otherCases', '{충전환불기간}', v_days::text)),
    'minorNotice', replace(v_value ->> 'minorNotice', '{충전환불기간}', v_days::text),
    'agreeLabel', replace(v_value ->> 'agreeLabel', '{충전환불기간}', v_days::text),
    'noticeSha256', v_sha, 'refundDays', v_days,
    'plan', CASE WHEN v_plan.id IS NULL THEN NULL ELSE jsonb_build_object('price', v_plan.price, 'credits', v_plan.credits) END);

  IF v_plan.id IS NULL OR NOT v_plan.is_active THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_UNAVAILABLE', 'details', v_details);
  END IF;
  IF v_plan.price <> p_expected_amount OR v_plan.credits <> p_expected_credits THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_CHANGED', 'details', v_details);
  END IF;
  -- 같은 시도의 재요청: 요금제가 그대로일 때만(위 검사 뒤) 같은 기록으로 본다.
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
       AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
      RETURN jsonb_build_object('ok', true, 'replay', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details);
  END IF;
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details);
  END IF;

  SELECT s.content_sha256 INTO v_policy_sha FROM public.policy_document_snapshots s
   WHERE s.doc_key = 'refundPolicy' ORDER BY s.seq DESC LIMIT 1;

  INSERT INTO public.point_charge_checkout_acks (user_id, checkout_attempt_id, plan_id, plan_name, amount, credits, refund_days,
                                                 notice_text, notice_sha256, refund_policy_sha256)
  VALUES (p_user_id, p_checkout_attempt_id, v_plan.id, v_plan.name, v_plan.price, v_plan.credits, v_days, v_text, v_sha, v_policy_sha)
  ON CONFLICT (user_id, checkout_attempt_id) DO NOTHING
  RETURNING id INTO v_inserted;
  IF v_inserted IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false);
  END IF;

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;
  IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
     AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
    RETURN jsonb_build_object('ok', true, 'replay', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details);
END;
$function$
;

-- 3-8. process_payapp_cancellation
CREATE OR REPLACE FUNCTION public.process_payapp_cancellation(p_payment_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_request public.refund_requests%ROWTYPE;
  v_marker text;
  v_pre_source_id uuid;
  v_pre_request_id uuid;
  v_now_request_id uuid;
  v_result text;
  v_detail jsonb := '{}'::jsonb;
  v_error_state text;
  v_error_message text;
  v_cancel_key text;
  v_alert_code text;
  v_alert_details jsonb;
BEGIN
  -- 잠금 없이 읽어 처리할 표식과 잠글 행을 정한다.
  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id;

  IF v_order.id IS NULL OR v_order.provider <> 'payapp' OR v_ppt.id IS NULL THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FOUND';
  END IF;

  IF v_ppt.cancel_feedback_recorded_at IS NOT NULL AND v_ppt.cancel_processed_at IS NULL THEN
    v_marker := 'cancel';
  ELSIF v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL AND v_ppt.partial_cancel_processed_at IS NULL THEN
    v_marker := 'partial_cancel';
  ELSE
    RETURN jsonb_build_object('result', 'nothing_to_process');
  END IF;

  v_pre_source_id := v_order.source_id;
  IF v_pre_source_id IS NOT NULL THEN
    SELECT id INTO v_pre_request_id
      FROM public.refund_requests
     WHERE source_id = v_pre_source_id
       AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  BEGIN
    -- 환불 순서: refund_requests → credit_sources → payment_orders → payment_provider_transactions → profiles
    IF v_pre_request_id IS NOT NULL THEN
      SELECT * INTO v_request
        FROM public.refund_requests
       WHERE id = v_pre_request_id
       FOR UPDATE;
    END IF;

    IF v_pre_source_id IS NOT NULL THEN
      SELECT * INTO v_source
        FROM public.credit_sources
       WHERE id = v_pre_source_id
       FOR UPDATE;
    END IF;

    SELECT * INTO v_order
      FROM public.payment_orders
     WHERE id = p_payment_order_id
     FOR UPDATE;

    SELECT * INTO v_ppt
      FROM public.payment_provider_transactions
     WHERE payment_order_id = p_payment_order_id
     FOR UPDATE;

    PERFORM 1
      FROM public.profiles
     WHERE id = v_order.user_id
     FOR UPDATE;

    IF v_pre_source_id IS NOT NULL THEN
      SELECT id INTO v_now_request_id
        FROM public.refund_requests
       WHERE source_id = v_pre_source_id
         AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
       ORDER BY created_at DESC
       LIMIT 1;
    END IF;

    -- 잠금 전 판단과 다르면 아무것도 쓰지 않고 재시도한다.
    IF v_order.source_id IS DISTINCT FROM v_pre_source_id
       OR v_now_request_id IS DISTINCT FROM v_pre_request_id
       OR (v_marker = 'cancel' AND v_ppt.cancel_processed_at IS NOT NULL)
       OR (v_marker = 'partial_cancel' AND (
             v_ppt.partial_cancel_processed_at IS NOT NULL
             OR (v_ppt.cancel_feedback_recorded_at IS NOT NULL AND v_ppt.cancel_processed_at IS NULL)
           )) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PAYAPP_CANCELLATION_STATE_CHANGED';
    END IF;

    v_cancel_key := 'payapp-cancel:' || v_ppt.provider_transaction_id;

    IF v_marker = 'cancel' THEN
      IF v_order.source_id IS NULL THEN
        -- 지급 전 승인취소: 어떤 경로로도 지급하지 않는다.
        UPDATE public.payment_orders
           SET status = 'failed',
               canceled_at = COALESCE(canceled_at, v_ppt.provider_cancelled_at, now()),
               failure_code = 'PAYAPP_CANCELLED_BEFORE_FULFILLMENT',
               failure_message = '크레딧 지급 전에 페이앱 결제가 취소되었습니다.',
               next_reconcile_at = NULL,
               updated_at = now()
         WHERE id = v_order.id;

        UPDATE public.checkout_attempts
           SET status = 'cancelled',
               updated_at = now()
         WHERE id = v_order.checkout_attempt_id
           AND status <> 'completed';

        v_result := 'cancelled_before_fulfillment';
      ELSIF v_order.status = 'refunded' THEN
        v_result := 'already_refunded';
        IF EXISTS (
          SELECT 1
            FROM public.refund_requests rr
            JOIN public.payment_admin_actions paa
              ON paa.refund_request_id = rr.id
             AND paa.action = 'manual_refund_completed'
           WHERE rr.source_id = v_order.source_id
             AND rr.status = 'completed'
             AND rr.provider_cancel_transaction_key IS NULL
             AND paa.external_method = 'bank_transfer'
        ) THEN
          v_result := 'double_refund_suspected';
        END IF;
      ELSIF v_request.id IS NOT NULL AND v_request.origin IN ('external_cancel', 'partial_cancel') THEN
        v_result := 'already_quarantined';
        -- 관리자 결제확인 주문에 부분취소가 먼저 와서 격리된 경우도 결제번호가 검증되지 않았다. 경보 문구를 콘솔 대조로 안내한다.
        IF v_ppt.paid_feedback_recorded_at IS NULL AND v_ppt.admin_paid_confirmed_at IS NOT NULL THEN
          v_detail := jsonb_build_object('reason', 'admin_confirmed_mul_no_unverified');
        END IF;
      ELSIF v_request.id IS NOT NULL
            AND v_request.status = 'manual_review' AND v_request.origin = 'user'
            AND v_ppt.paid_feedback_recorded_at IS NULL
            AND v_ppt.admin_paid_confirmed_at IS NOT NULL THEN
        -- 관리자가 입력한 결제번호라 이 취소가 우리 결제인지 검증되지 않았다. 자동 완료하지 않는다.
        v_result := 'already_quarantined';
        v_detail := jsonb_build_object('reason', 'admin_confirmed_mul_no_unverified');
      ELSIF v_request.id IS NOT NULL
            AND (v_request.status IN ('processing', 'retryable_failed')
                 OR (v_request.status = 'manual_review' AND v_request.origin = 'user')) THEN
        v_detail := public.finalize_point_charge_refund(
          v_request.id,
          v_cancel_key,
          COALESCE(v_ppt.provider_cancelled_at, now()),
          'CANCELED'
        );
        v_result := 'refund_finalized';
        v_detail := v_detail || jsonb_build_object('request_id', v_request.id, 'user_id', v_request.user_id);
      ELSE
        v_detail := public.quarantine_external_provider_cancellation(
          v_order.id,
          v_cancel_key,
          COALESCE(v_ppt.provider_cancelled_at, now()),
          'CANCELED'
        );
        v_result := 'external_cancel_quarantined';
      END IF;

      UPDATE public.payment_provider_transactions
         SET cancel_processed_at = COALESCE(cancel_processed_at, now()),
             updated_at = now()
       WHERE id = v_ppt.id;
    ELSE
      IF v_ppt.cancel_processed_at IS NOT NULL THEN
        -- 승인취소를 이미 처리한 뒤에 온 부분취소: 바꾸지 않고 경보만.
        v_result := 'partial_cancel_after_cancel';
        IF v_order.status = 'refunded' THEN
          v_detail := jsonb_build_object(
            'partial_cancel_amount', v_ppt.partial_cancel_amount,
            'actual_refund_amount', CASE
              WHEN v_ppt.partial_cancel_amount IS NOT NULL
                THEN v_order.expected_amount - v_ppt.partial_cancel_amount
            END
          );
        END IF;
        UPDATE public.payment_provider_transactions
           SET partial_cancel_processed_at = COALESCE(partial_cancel_processed_at, now()),
               updated_at = now()
         WHERE id = v_ppt.id;
      ELSIF v_order.source_id IS NULL THEN
        UPDATE public.payment_orders
           SET status = 'manual_review',
               failure_code = 'PAYAPP_PARTIAL_CANCEL',
               failure_message = '크레딧 지급 전에 페이앱 결제가 부분취소되었습니다.',
               next_reconcile_at = NULL,
               updated_at = now()
         WHERE id = v_order.id;

        UPDATE public.checkout_attempts
           SET status = 'manual_review',
               updated_at = now()
         WHERE id = v_order.checkout_attempt_id
           AND status <> 'completed';

        UPDATE public.payment_provider_transactions
           SET partial_cancel_processed_at = COALESCE(partial_cancel_processed_at, now()),
               updated_at = now()
         WHERE id = v_ppt.id;

        v_result := 'partial_cancel_unpaid';
      ELSE
        v_detail := public.quarantine_payapp_partial_cancellation(v_order.id);
        v_result := CASE
          WHEN v_detail->>'outcome' = 'deferred_refund_processing' THEN 'deferred_refund_processing'
          ELSE 'partial_cancel_quarantined'
        END;
      END IF;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_error_state = RETURNED_SQLSTATE,
        v_error_message = MESSAGE_TEXT;
      IF v_error_state IN ('40P01', '40001', '55P03') THEN
        RAISE;
      END IF;
      v_result := NULL;
  END;

  IF v_result IS NOT NULL THEN
    -- 취소 후속 경보를 처리 시각과 같은 트랜잭션에 남긴다. code·문구는 TS cancellationFollowUps와 같다.
    -- TS가 같은 경보를 다시 기록해도 (code, payment_order_id) 키라 DO NOTHING이 된다.
    v_alert_code := CASE
      WHEN v_result = 'double_refund_suspected' THEN 'PAYAPP_DOUBLE_REFUND_SUSPECTED'
      WHEN v_result = 'already_quarantined' AND v_marker = 'cancel' THEN 'PAYAPP_CANCEL_AFTER_QUARANTINE'
      WHEN v_result = 'partial_cancel_after_cancel' THEN 'PAYAPP_PARTIAL_CANCEL_AFTER_CANCEL'
      WHEN v_result = 'partial_cancel_quarantined' AND v_detail->>'outcome' = 'absorbed_by_refund' THEN 'PAYAPP_PARTIAL_CANCEL_ABSORBED'
      WHEN v_result = 'deferred_refund_processing' THEN 'PAYAPP_PARTIAL_CANCEL_DEFERRED'
      -- 관리자 결제확인 주문에 열린 manual_review·user 요청이 없으면 외부 전취소 격리로 간다.
      -- 결제번호가 페이앱 통보로 검증되지 않았으므로 critical로 남긴다.
      WHEN v_result = 'external_cancel_quarantined'
           AND v_ppt.paid_feedback_recorded_at IS NULL
           AND v_ppt.admin_paid_confirmed_at IS NOT NULL THEN 'PAYAPP_CANCEL_AFTER_QUARANTINE'
    END;

    IF v_alert_code IS NOT NULL THEN
      v_alert_details := jsonb_build_object('order_id', v_order.order_id, 'payment_order_id', v_order.id, 'source', 'process_payapp_cancellation')
        || (COALESCE(v_detail, '{}'::jsonb) - 'request_id' - 'user_id');
      IF v_result = 'external_cancel_quarantined' THEN
        v_alert_details := v_alert_details || jsonb_build_object('reason', 'admin_confirmed_mul_no_unverified');
      END IF;

      PERFORM public.record_payment_alert(
        v_alert_code,
        CASE WHEN v_alert_code IN ('PAYAPP_DOUBLE_REFUND_SUSPECTED', 'PAYAPP_CANCEL_AFTER_QUARANTINE') THEN 'critical' ELSE 'warning' END,
        CASE v_alert_code
          WHEN 'PAYAPP_DOUBLE_REFUND_SUSPECTED' THEN '계좌이체로 환불한 결제가 페이앱에서도 취소되었습니다.'
          WHEN 'PAYAPP_CANCEL_AFTER_QUARANTINE' THEN
            CASE WHEN v_alert_details->>'reason' = 'admin_confirmed_mul_no_unverified'
              THEN '관리자가 결제확인한 결제가 페이앱에서 승인취소되었습니다. 이 사이트 결제의 취소인지 페이앱 콘솔과 먼저 대조하세요.'
              ELSE '수동 확인 중인 결제가 페이앱에서 승인취소되었습니다. 전액 환불 기준으로 처리하세요.'
            END
          WHEN 'PAYAPP_PARTIAL_CANCEL_AFTER_CANCEL' THEN '승인취소를 처리한 결제에 부분취소가 통보되었습니다. 실제 환불액을 확인하세요.'
          WHEN 'PAYAPP_PARTIAL_CANCEL_ABSORBED' THEN '전액 환불된 결제에 부분취소가 통보되었습니다. 실제 환불액을 확인하세요.'
          WHEN 'PAYAPP_PARTIAL_CANCEL_DEFERRED' THEN '환불 처리 중인 결제에 부분취소가 통보되었습니다. 환불이 끝난 뒤 대사가 정리합니다.'
        END,
        v_alert_details
      );
    END IF;

    RETURN jsonb_build_object(
      'result', v_result,
      'marker', v_marker,
      'payment_order_id', v_order.id,
      'order_id', v_order.order_id,
      'user_id', v_order.user_id
    ) || v_detail;
  END IF;

  -- 실패 대체 처리: 크레딧을 묶고 manual_review로 보낸 뒤 처리 시각을 남긴다.
  v_request := NULL;
  v_source := NULL;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id;

  IF v_order.source_id IS NOT NULL THEN
    SELECT * INTO v_request
      FROM public.refund_requests
     WHERE source_id = v_order.source_id
       AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE;

    SELECT * INTO v_source
      FROM public.credit_sources
     WHERE id = v_order.source_id
     FOR UPDATE;
  END IF;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id
   FOR UPDATE;

  PERFORM 1
    FROM public.profiles
   WHERE id = v_order.user_id
   FOR UPDATE;

  IF v_source.id IS NOT NULL AND v_source.status <> 'refunded' THEN
    UPDATE public.credit_sources
       SET status = 'pending_refund'
     WHERE id = v_source.id
       AND status = 'active';

    IF v_request.id IS NOT NULL THEN
      UPDATE public.refund_requests
         SET status = 'manual_review',
             next_attempt_at = NULL,
             last_error_code = 'PAYAPP_CANCEL_HANDLING_FAILED',
             last_error_message = LEFT(format('페이앱 취소 처리 실패(%s): %s', v_error_state, v_error_message), 500),
             origin = CASE WHEN origin = 'user' THEN 'external_cancel' ELSE origin END
       WHERE id = v_request.id;
    ELSE
      INSERT INTO public.refund_requests (
        user_id,
        source_id,
        reason,
        status,
        payment_order_id,
        provider,
        refund_amount,
        cancel_idempotency_key,
        last_error_code,
        last_error_message,
        origin
      ) VALUES (
        v_order.user_id,
        v_source.id,
        '결제사 취소 처리 실패',
        'manual_review',
        v_order.id,
        'payapp',
        v_order.expected_amount,
        v_order.cancel_idempotency_key,
        'PAYAPP_CANCEL_HANDLING_FAILED',
        LEFT(format('페이앱 취소 처리 실패(%s): %s', v_error_state, v_error_message), 500),
        'external_cancel'
      );
    END IF;
    -- [9번] 시작
    -- 실패 대체 경로도 다시 지급한 크레딧을 묶는다. 원래 원천 격리는 위에서 끝났으므로, 묶기가 실패해도 그것은 유지하고 경보만 남긴다.
    SELECT * INTO v_request
      FROM public.refund_requests
     WHERE source_id = v_source.id AND status = 'manual_review'
     ORDER BY created_at DESC
     LIMIT 1;
    BEGIN
      PERFORM public.point_charge_hold_reissued(v_source.id, v_request.id);
      PERFORM public.point_charge_reissued_alert('REISSUED_CREDIT_HELD', v_request.id, v_order.id, v_source.id);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.point_charge_reissued_alert('REISSUED_CREDIT_HOLD_FAILED', v_request.id, v_order.id, v_source.id, true);
    END;
    -- [9번] 끝
  END IF;

  IF v_order.status <> 'refunded' THEN
    UPDATE public.payment_orders
       SET status = 'manual_review',
           failure_code = 'PAYAPP_CANCEL_HANDLING_FAILED',
           failure_message = '페이앱 취소 통보를 자동으로 처리하지 못해 크레딧을 격리했습니다.',
           next_reconcile_at = NULL,
           updated_at = now()
     WHERE id = v_order.id;
  END IF;

  UPDATE public.payment_provider_transactions
     SET cancel_processed_at = CASE
           WHEN v_marker = 'cancel' THEN COALESCE(cancel_processed_at, now())
           ELSE cancel_processed_at
         END,
         partial_cancel_processed_at = CASE
           WHEN v_marker = 'partial_cancel' THEN COALESCE(partial_cancel_processed_at, now())
           ELSE partial_cancel_processed_at
         END,
         updated_at = now()
   WHERE id = v_ppt.id;

  -- 실패 대체 처리의 경보도 처리 시각과 같은 트랜잭션에 남긴다(TS cancellationFollowUps와 같은 code·문구).
  PERFORM public.record_payment_alert(
    'PAYAPP_CANCEL_HANDLING_FAILED',
    'critical',
    '페이앱 취소 처리에 실패해 크레딧을 묶고 수동 확인으로 보냈습니다.',
    jsonb_build_object('order_id', v_order.order_id, 'payment_order_id', v_order.id, 'source', 'process_payapp_cancellation',
                       'error_state', v_error_state)
  );

  RETURN jsonb_build_object(
    'result', 'cancel_handling_failed',
    'marker', v_marker,
    'payment_order_id', v_order.id,
    'order_id', v_order.order_id,
    'error_state', v_error_state
  );
END;
$function$
;

-- 3-9. payapp_sales_resume_blockers
CREATE OR REPLACE FUNCTION public.payapp_sales_resume_blockers()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scheduler public.payment_reconciliation_scheduler%ROWTYPE;
  v_scheduler_stale boolean;
  v_payapp_unfulfilled_count integer;
  v_payapp_money_review_count integer;
  v_payapp_cancel_active_count integer;
BEGIN
  SELECT *
    INTO v_scheduler
    FROM public.payment_reconciliation_scheduler
   WHERE id = 1;

  v_scheduler_stale := v_scheduler.last_started_at IS NOT NULL
    AND (
      v_scheduler.last_succeeded_at IS NULL
      OR v_scheduler.last_succeeded_at <= now() - interval '15 minutes'
    );

  SELECT COUNT(*)::integer
    INTO v_payapp_unfulfilled_count
    FROM public.payment_orders po
    JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
   WHERE po.provider = 'payapp'
     AND ppt.paid_feedback_recorded_at <= now() - interval '10 minutes'
     AND po.source_id IS NULL
     AND ppt.cancel_feedback_recorded_at IS NULL
     AND ppt.partial_cancel_feedback_recorded_at IS NULL;

  SELECT COUNT(*)::integer
    INTO v_payapp_money_review_count
    FROM public.payment_orders po
   WHERE po.provider = 'payapp'
     AND po.status = 'manual_review'
     AND po.failure_code IN (
       'PAYAPP_FEEDBACK_MISMATCH',
       'PAYAPP_MUL_NO_CONFLICT',
       'PAYAPP_PARTIAL_CANCEL',
       'PAYAPP_READY_CANCEL_FAILED',
       'PAYAPP_FULFILLMENT_RETRY_EXHAUSTED',
       'PAYAPP_CANCEL_HANDLING_FAILED'
     );

  SELECT
    COUNT(*) FILTER (WHERE cs.status = 'active')::integer
    INTO v_payapp_cancel_active_count
    FROM public.payment_orders po
    JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
    LEFT JOIN public.credit_sources cs ON cs.payment_order_id = po.id
   WHERE po.provider = 'payapp'
     AND (
       (ppt.cancel_feedback_recorded_at <= now() - interval '10 minutes'
        AND ppt.cancel_processed_at IS NULL)
       OR (ppt.partial_cancel_feedback_recorded_at <= now() - interval '10 minutes'
           AND ppt.partial_cancel_processed_at IS NULL)
     );

  RETURN jsonb_build_object(
    'paid_unfulfilled_count', v_payapp_unfulfilled_count,
    'money_review_count', v_payapp_money_review_count,
    'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
    -- 점검 작업 기록 행이 없으면 건강하다고 볼 근거가 없으므로 막는다.
    'scheduler_unhealthy', COALESCE(v_scheduler_stale OR v_scheduler.consecutive_failures >= 3, true),
    'consecutive_failures', v_scheduler.consecutive_failures,
    'last_succeeded_at', v_scheduler.last_succeeded_at
  );
END;
$function$
;

-- 3-10. enforce_payment_reconciliation_health
CREATE OR REPLACE FUNCTION public.enforce_payment_reconciliation_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scheduler public.payment_reconciliation_scheduler%ROWTYPE;
  v_stale_count integer;
  v_manual_count integer;
  v_backlog integer;
  v_scheduler_stale boolean;
  v_should_disable boolean;
  v_code text;
  v_message text;
  v_kakao_marker_active_count integer;
  v_kakao_marker_frozen_count integer;
  v_kakao_marker_disable boolean;
  v_payapp_unfulfilled_count integer;
  v_payapp_money_review_count integer;
  v_payapp_cancel_active_count integer;
  v_payapp_cancel_frozen_count integer;
  v_payapp_scheduler_unhealthy boolean;
  v_payapp_disable boolean;
  v_payapp_code text;
  v_feedback_ack timestamptz;
  v_feedback_unprocessed_count integer;
  v_feedback_latest timestamptz;
BEGIN
  SELECT *
    INTO v_scheduler
    FROM public.payment_reconciliation_scheduler
   WHERE id = 1;

  SELECT COUNT(*)::integer
    INTO v_stale_count
    FROM public.payment_orders
   WHERE provider = 'kakaopay'
     AND status IN ('confirming', 'fulfillment_pending')
     AND updated_at <= now() - interval '10 minutes';

  SELECT COUNT(*)::integer
    INTO v_manual_count
    FROM public.payment_orders
   WHERE provider = 'kakaopay'
     AND status = 'manual_review';

  v_backlog := public.payment_reconciliation_backlog_count();
  v_scheduler_stale := v_scheduler.last_started_at IS NOT NULL
    AND (
      v_scheduler.last_succeeded_at IS NULL
      OR v_scheduler.last_succeeded_at <= now() - interval '15 minutes'
    );
  v_should_disable := v_stale_count > 0
    OR v_manual_count > 0
    OR v_scheduler_stale
    OR v_scheduler.consecutive_failures >= 3;

  IF v_stale_count > 0 THEN
    v_code := 'PAYMENT_RECONCILIATION_STALE_PAYMENT';
    v_message := '10분 이상 완료되지 않은 카카오페이 승인 또는 지급 건이 있습니다.';
  ELSIF v_manual_count > 0 THEN
    v_code := 'PAYMENT_RECONCILIATION_MANUAL_REVIEW';
    v_message := '카카오페이 대사 수동 확인 건이 있습니다.';
  ELSIF v_scheduler.consecutive_failures >= 3 THEN
    v_code := 'PAYMENT_RECONCILIATION_REPEATED_FAILURE';
    v_message := '결제 대사 작업이 3회 연속 실패했습니다.';
  ELSIF v_scheduler_stale THEN
    v_code := 'PAYMENT_RECONCILIATION_SCHEDULER_STALE';
    v_message := '결제 대사 성공 기록이 15분 이상 갱신되지 않았습니다.';
  END IF;

  IF v_should_disable THEN
    UPDATE public.payment_runtime_config
       SET kakaopay_accepts_new_orders = false,
           changed_at = now(),
           changed_by = 'payment_reconciliation_health',
           change_ticket = v_code
     WHERE id = true
       AND kakaopay_accepts_new_orders = true;

    INSERT INTO public.payment_reconciliation_alerts (
      code,
      severity,
      message,
      details
    )
    SELECT
      v_code,
      'critical',
      v_message,
      jsonb_build_object(
        'stale_count', v_stale_count,
        'manual_review_count', v_manual_count,
        'backlog', v_backlog,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    WHERE NOT EXISTS (
      SELECT 1
        FROM public.payment_reconciliation_alerts pra
       WHERE pra.code = v_code
         AND pra.resolved_at IS NULL
    );
  END IF;

  -- 카카오 부분취소 표식 블록: 미처리 표식 + 크레딧 사용 가능이 10분을 넘으면 카카오 판매를 끈다.
  SELECT
    COUNT(*) FILTER (WHERE cs.status = 'active')::integer,
    COUNT(*) FILTER (WHERE cs.status IS DISTINCT FROM 'active')::integer
    INTO v_kakao_marker_active_count, v_kakao_marker_frozen_count
    FROM public.payment_orders po
    JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
    LEFT JOIN public.credit_sources cs ON cs.payment_order_id = po.id
   WHERE po.provider = 'kakaopay'
     AND ppt.partial_cancel_feedback_recorded_at <= now() - interval '10 minutes'
     AND ppt.partial_cancel_processed_at IS NULL;

  v_kakao_marker_disable := v_kakao_marker_active_count > 0;

  IF v_kakao_marker_disable THEN
    UPDATE public.payment_runtime_config
       SET kakaopay_accepts_new_orders = false,
           changed_at = now(),
           changed_by = 'payment_reconciliation_health',
           change_ticket = 'KAKAOPAY_PARTIAL_CANCEL_UNPROCESSED'
     WHERE id = true
       AND kakaopay_accepts_new_orders = true;

    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'KAKAOPAY_PARTIAL_CANCEL_UNPROCESSED',
      'critical',
      '카카오페이 부분취소 처리가 10분 넘게 끝나지 않았고 크레딧을 쓸 수 있는 상태입니다.',
      jsonb_build_object('count', v_kakao_marker_active_count)
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  ELSIF v_kakao_marker_frozen_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'KAKAOPAY_PARTIAL_CANCEL_UNPROCESSED_FROZEN',
      'warning',
      '카카오페이 부분취소 처리가 10분 넘게 끝나지 않았습니다(크레딧은 묶여 있음).',
      jsonb_build_object('count', v_kakao_marker_frozen_count)
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  -- 페이앱 블록: 돈이 걸린 위험만 판매를 끈다.
  SELECT COUNT(*)::integer
    INTO v_payapp_unfulfilled_count
    FROM public.payment_orders po
    JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
   WHERE po.provider = 'payapp'
     AND ppt.paid_feedback_recorded_at <= now() - interval '10 minutes'
     AND po.source_id IS NULL
     AND ppt.cancel_feedback_recorded_at IS NULL
     AND ppt.partial_cancel_feedback_recorded_at IS NULL;

  SELECT COUNT(*)::integer
    INTO v_payapp_money_review_count
    FROM public.payment_orders po
   WHERE po.provider = 'payapp'
     AND po.status = 'manual_review'
     AND po.failure_code IN (
       'PAYAPP_FEEDBACK_MISMATCH',
       'PAYAPP_MUL_NO_CONFLICT',
       'PAYAPP_PARTIAL_CANCEL',
       'PAYAPP_READY_CANCEL_FAILED',
       'PAYAPP_FULFILLMENT_RETRY_EXHAUSTED',
       'PAYAPP_CANCEL_HANDLING_FAILED'
     );

  SELECT
    COUNT(*) FILTER (WHERE cs.status = 'active')::integer,
    COUNT(*) FILTER (WHERE cs.status IS DISTINCT FROM 'active')::integer
    INTO v_payapp_cancel_active_count, v_payapp_cancel_frozen_count
    FROM public.payment_orders po
    JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
    LEFT JOIN public.credit_sources cs ON cs.payment_order_id = po.id
   WHERE po.provider = 'payapp'
     AND (
       (ppt.cancel_feedback_recorded_at <= now() - interval '10 minutes'
        AND ppt.cancel_processed_at IS NULL)
       OR (ppt.partial_cancel_feedback_recorded_at <= now() - interval '10 minutes'
           AND ppt.partial_cancel_processed_at IS NULL)
     );

  v_payapp_scheduler_unhealthy := v_scheduler_stale OR v_scheduler.consecutive_failures >= 3;

  v_payapp_disable := v_payapp_unfulfilled_count > 0
    OR v_payapp_money_review_count > 0
    OR v_payapp_cancel_active_count > 0
    OR v_payapp_scheduler_unhealthy;

  -- change_ticket에 남길 첫 code. 경보는 아래에서 조건마다 따로 남긴다.
  IF v_payapp_unfulfilled_count > 0 THEN
    v_payapp_code := 'PAYAPP_PAID_UNFULFILLED';
  ELSIF v_payapp_cancel_active_count > 0 THEN
    v_payapp_code := 'PAYAPP_CANCEL_UNPROCESSED';
  ELSIF v_payapp_money_review_count > 0 THEN
    v_payapp_code := 'PAYAPP_MONEY_RISK_REVIEW';
  ELSIF v_payapp_scheduler_unhealthy THEN
    v_payapp_code := 'PAYAPP_RECONCILIATION_UNHEALTHY';
  END IF;

  IF v_payapp_disable THEN
    UPDATE public.payment_runtime_config
       SET payapp_accepts_new_orders = false,
           changed_at = now(),
           changed_by = 'payment_reconciliation_health',
           change_ticket = v_payapp_code
     WHERE id = true
       AND payapp_accepts_new_orders = true;
  END IF;

  -- 스케줄러 이상은 기존 블록이 이미 경보를 남기므로 돈 위험 조건만 페이앱 경보로 남긴다.
  -- 조건마다 따로 남겨 한 조건이 다른 조건(특히 취소 미처리)을 가리지 않게 한다.
  IF v_payapp_unfulfilled_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_PAID_UNFULFILLED',
      'critical',
      '결제완료가 기록됐지만 10분 넘게 크레딧이 지급되지 않은 페이앱 건이 있습니다.',
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_cancel_active_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_CANCEL_UNPROCESSED',
      'critical',
      '페이앱 취소 처리가 10분 넘게 끝나지 않았고 크레딧을 쓸 수 있는 상태입니다.',
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_money_review_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_MONEY_RISK_REVIEW',
      'critical',
      '돈이 걸린 페이앱 수동 확인 건이 있습니다.',
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_cancel_frozen_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_CANCEL_UNPROCESSED_FROZEN',
      'warning',
      '페이앱 취소 처리가 10분 넘게 끝나지 않았습니다(크레딧은 묶여 있거나 지급 전).',
      jsonb_build_object('count', v_payapp_cancel_frozen_count)
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  -- 기록되지 않은 페이앱 통보: 경보만 남기고 판매는 끄지 않는다.
  -- 이미 확인(해소)된 경보가 덮은 시각 이후만 센다. 해소하면 다시 울리지 않는다.
  SELECT MAX((details->>'latest_received_at')::timestamptz)
    INTO v_feedback_ack
    FROM public.payment_reconciliation_alerts
   WHERE code = 'PAYAPP_FEEDBACK_UNPROCESSED';

  -- pending·failed는 payment_webhook_events_pending_idx, 표식 없이 ignored로 닫힌 취소 계열 통보는
  -- payment_webhook_events_ignored_cancel_idx를 타도록 두 부분으로 나눈다.
  -- PROCESS: 실패는 표식이 이미 커밋된 경우라 취소 미처리 점검과 대사가 다룬다. 사이트 밖 통보는 뺀다.
  SELECT COUNT(*)::integer, MAX(e.received_at)
    INTO v_feedback_unprocessed_count, v_feedback_latest
    FROM (
      SELECT pwe.received_at
        FROM public.payment_webhook_events pwe
       WHERE pwe.processing_status IN ('pending', 'failed')
         AND pwe.transmission_id LIKE 'payapp:%'
         AND pwe.received_at <= now() - interval '30 minutes'
         AND pwe.received_at > COALESCE(v_feedback_ack, '-infinity'::timestamptz)
         AND (pwe.processing_status = 'pending'
              OR COALESCE(pwe.last_error_code, '') NOT LIKE 'PROCESS:%')
      UNION ALL
      SELECT pwe.received_at
        FROM public.payment_webhook_events pwe
       WHERE pwe.processing_status = 'ignored'
         AND pwe.event_type IN ('PAYAPP_PAY_STATE_9', 'PAYAPP_PAY_STATE_64', 'PAYAPP_PAY_STATE_70', 'PAYAPP_PAY_STATE_71')
         AND pwe.transmission_id LIKE 'payapp:%'
         AND pwe.received_at <= now() - interval '30 minutes'
         AND pwe.received_at > COALESCE(v_feedback_ack, '-infinity'::timestamptz)
         AND COALESCE(pwe.last_error_code, '') <> 'PAYAPP_FOREIGN_FEEDBACK'
    ) e;

  IF v_feedback_unprocessed_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES ('PAYAPP_FEEDBACK_UNPROCESSED', 'critical',
            '30분 넘게 처리되지 않은 페이앱 통보가 있습니다. 페이앱 관리자 내역과 대조하세요.',
            jsonb_build_object('count', v_feedback_unprocessed_count, 'latest_received_at', v_feedback_latest))
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'healthy', NOT (v_should_disable OR v_kakao_marker_disable),
    'backlog', v_backlog,
    'stale_count', v_stale_count,
    'manual_review_count', v_manual_count,
    'consecutive_failures', v_scheduler.consecutive_failures,
    'last_started_at', v_scheduler.last_started_at,
    'last_succeeded_at', v_scheduler.last_succeeded_at,
    'kakaopay_disabled', v_should_disable OR v_kakao_marker_disable,
    'payapp_disabled', v_payapp_disable
  );
END;
$function$
;

-- 3-11. prevent_payment_order_snapshot_update
CREATE OR REPLACE FUNCTION public.prevent_payment_order_snapshot_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.plan_name_snapshot IS DISTINCT FROM OLD.plan_name_snapshot
     OR NEW.expected_amount IS DISTINCT FROM OLD.expected_amount
     OR NEW.expected_credits IS DISTINCT FROM OLD.expected_credits
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.provider_environment IS DISTINCT FROM OLD.provider_environment
     OR NEW.mid IS DISTINCT FROM OLD.mid
     OR NEW.provider_merchant_id IS DISTINCT FROM OLD.provider_merchant_id
     OR NEW.partner_order_id IS DISTINCT FROM OLD.partner_order_id
     OR NEW.partner_user_id IS DISTINCT FROM OLD.partner_user_id
     OR NEW.tax_free_amount IS DISTINCT FROM OLD.tax_free_amount
     OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount
     OR NEW.checkout_attempt_id IS DISTINCT FROM OLD.checkout_attempt_id
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.checkout_expires_at IS DISTINCT FROM OLD.checkout_expires_at
     OR NEW.ready_requested_at IS DISTINCT FROM OLD.ready_requested_at
     OR NEW.ready_expires_at IS DISTINCT FROM OLD.ready_expires_at
     OR NEW.payment_method_code IS DISTINCT FROM OLD.payment_method_code THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_IMMUTABLE_SNAPSHOT';
  END IF;

  RETURN NEW;
END;
$function$
;

-- 3-12. consent_record_internal
CREATE OR REPLACE FUNCTION public.consent_record_internal(p_user_id uuid, p_items jsonb, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_error text;
  v_provider text;
  v_signup_completed boolean;
  v_email_confirmed_at timestamptz;
  v_has_records boolean;
  v_mode text := 'full';
  v_elem jsonb;
  v_item public.signup_consent_items%ROWTYPE;
  v_agreed boolean;
  v_latest boolean;
  v_item_ids uuid[] := ARRAY[]::uuid[];
  v_doc_key text;
  v_doc jsonb;
  v_hash text;
BEGIN
  IF p_user_id IS NULL OR p_source IS NULL
     OR p_source NOT IN ('email_signup', 'kakao_signup', 'consent_gate', 'mypage') THEN
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;

  -- ① 회원 advisory ② 항목 쓰기 공유(저장·개정과 겹치지 않게) ③ profiles 행
  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));

  SELECT p.provider, p.signup_completed
    INTO v_provider, v_signup_completed
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONSENT_PROFILE_MISSING';
  END IF;

  IF p_source IN ('consent_gate', 'mypage') AND v_provider = 'kakao' AND v_signup_completed IS NOT TRUE THEN
    RAISE EXCEPTION 'CONSENT_KAKAO_SIGNUP_INCOMPLETE';
  END IF;
  IF p_source = 'kakao_signup' AND v_provider IS DISTINCT FROM 'kakao' THEN
    RAISE EXCEPTION 'CONSENT_KAKAO_NOT_KAKAO';
  END IF;

  v_error := public.consent_items_error(p_items, p_source);
  IF v_error IS NOT NULL THEN
    RAISE EXCEPTION '%', v_error;
  END IF;

  SELECT array_agg((e ->> 'item_id')::uuid) INTO v_item_ids FROM jsonb_array_elements(p_items) AS e;

  -- 이메일 가입: 미인증 이메일 계정에만. 기록이 이미 있으면(같은 이메일 재가입 — 제3자일 수 있음) 선택 철회만 받는다.
  IF p_source = 'email_signup' THEN
    SELECT u.email_confirmed_at INTO v_email_confirmed_at FROM auth.users u WHERE u.id = p_user_id;
    IF v_email_confirmed_at IS NOT NULL OR v_provider IS DISTINCT FROM 'email' THEN
      RETURN '[]'::jsonb;
    END IF;
    v_has_records := EXISTS (SELECT 1 FROM public.user_consents c WHERE c.user_id = p_user_id);
    IF v_has_records THEN
      v_mode := 'withdraw_only';
    END IF;
  END IF;

  IF v_mode = 'full' AND p_source <> 'mypage'
     AND EXISTS (SELECT 1 FROM public.consent_missing_required(p_user_id, p_items)) THEN
    RAISE EXCEPTION 'CONSENT_REQUIRED_MISSING';
  END IF;

  FOR v_elem IN SELECT e FROM jsonb_array_elements(p_items) AS e LOOP
    SELECT * INTO v_item FROM public.signup_consent_items i WHERE i.id = (v_elem ->> 'item_id')::uuid;
    v_agreed := (v_elem -> 'agreed') = 'true'::jsonb;

    IF v_mode = 'withdraw_only' AND (v_item.required OR v_agreed) THEN
      CONTINUE;
    END IF;

    SELECT c.agreed INTO v_latest
      FROM public.user_consents c
     WHERE c.user_id = p_user_id AND c.item_id = v_item.id AND c.item_version = v_item.version
     ORDER BY c.seq DESC
     LIMIT 1;
    IF FOUND AND v_latest = v_agreed THEN
      CONTINUE;
    END IF;

    -- 연결 약관이 있으면 동의 제출 시점의 저장 본문 지문(sha256)을 함께 적는다(6번 묶음).
    v_hash := NULL;
    IF v_item.policy_slug IS NOT NULL THEN
      SELECT d.key, d.value INTO v_doc_key, v_doc
        FROM public.system_settings s,
             jsonb_each(CASE WHEN jsonb_typeof(s.value -> 'policyDocuments') = 'object' THEN s.value -> 'policyDocuments' ELSE '{}'::jsonb END) AS d
       WHERE s.key = 'site_footer_content'
         AND d.value ->> 'slug' = v_item.policy_slug
       LIMIT 1;
      IF FOUND AND jsonb_typeof(v_doc -> 'content') = 'string' THEN
        v_hash := encode(sha256(convert_to(v_doc ->> 'content', 'UTF8')), 'hex');
        -- 그 본문의 사본이 없으면(이론상 저장 트리거가 보장) 여기서 남긴다.
        IF NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots p WHERE p.doc_key = v_doc_key AND p.content_sha256 = v_hash) THEN
          PERFORM pg_advisory_xact_lock(hashtextextended('public.policy_document_snapshots', 0));
          IF NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots p WHERE p.doc_key = v_doc_key AND p.content_sha256 = v_hash) THEN
            INSERT INTO public.policy_document_snapshots (doc_key, slug, title, content, content_sha256)
            VALUES (v_doc_key, v_doc ->> 'slug', v_doc ->> 'title', v_doc ->> 'content', v_hash);
          END IF;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.user_consents (user_id, item_id, item_version, agreed, source, policy_sha256)
    VALUES (p_user_id, v_item.id, v_item.version, v_agreed, p_source, v_hash);
  END LOOP;

  RETURN public.consent_latest_results(p_user_id, v_item_ids);
END;
$function$
;

-- 3-13. guard_user_consents_mutation
CREATE OR REPLACE FUNCTION public.guard_user_consents_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
      RAISE EXCEPTION 'USER_CONSENTS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'USER_CONSENTS_APPEND_ONLY';
END;
$function$
;

-- 3-14. guard_market_purchase_notice_acks_mutation
CREATE OR REPLACE FUNCTION public.guard_market_purchase_notice_acks_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id) THEN
      RAISE EXCEPTION 'MARKET_PURCHASE_NOTICE_ACKS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'MARKET_PURCHASE_NOTICE_ACKS_APPEND_ONLY';
END;
$function$
;

-- 3-15. prevent_admin_event_mutation
CREATE OR REPLACE FUNCTION public.prevent_admin_event_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION 'ADMIN_EVENTS_APPEND_ONLY';
END;
$function$
;

-- 3-16. remind_unanswered_admin_work
CREATE OR REPLACE FUNCTION public.remind_unanswered_admin_work()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cfg jsonb;
  v_support_hours numeric;
  v_refund_hours numeric;
  v_from_hour numeric;
  v_until_hour numeric;
  v_now timestamptz := now();
  v_kst timestamp := now() AT TIME ZONE 'Asia/Seoul';
  v_day text;
BEGIN
  SELECT s.value -> 'reminders'
    INTO v_cfg
    FROM public.system_settings s
   WHERE s.key = 'admin_alert_settings';

  IF v_cfg IS NULL THEN
    RETURN;
  END IF;

  IF jsonb_typeof(v_cfg -> 'support_after_hours') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_cfg -> 'refund_after_hours') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_cfg -> 'send_from_hour') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_cfg -> 'send_until_hour') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'ADMIN_REMINDER_SETTINGS_INVALID';
  END IF;

  v_support_hours := (v_cfg ->> 'support_after_hours')::numeric;
  v_refund_hours := (v_cfg ->> 'refund_after_hours')::numeric;
  v_from_hour := (v_cfg ->> 'send_from_hour')::numeric;
  v_until_hour := (v_cfg ->> 'send_until_hour')::numeric;

  IF v_support_hours <= 0 OR v_refund_hours <= 0
     OR v_from_hour < 0 OR v_until_hour > 24 OR v_from_hour >= v_until_hour THEN
    RAISE EXCEPTION 'ADMIN_REMINDER_SETTINGS_INVALID';
  END IF;

  -- 보내는 시간대(한국 시각, 이상~미만) 밖이면 만들지 않는다.
  IF extract(hour FROM v_kst) < v_from_hour OR extract(hour FROM v_kst) >= v_until_hour THEN
    RETURN;
  END IF;

  v_day := to_char(v_kst, 'YYYY-MM-DD');

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  SELECT
    'support_unanswered',
    'info',
    '답변 대기 문의'
      || COALESCE(' [' || COALESCE(
           t.category_snapshot ->> 'name',
           (SELECT c.name FROM public.support_ticket_categories c WHERE c.id = t.category_id)
         ) || ']', '')
      || ' ' || left(regexp_replace(t.subject, '\s+', ' ', 'g'), 30),
    format('접수 후 %s시간 지남', floor(extract(epoch FROM v_now - t.created_at) / 3600)),
    '/admin/support',
    'support_tickets',
    t.id,
    'support.manage',
    'support_unanswered:' || t.id || ':' || v_day
  FROM public.support_tickets t
  WHERE t.status = 'pending'
    AND t.is_deleted_by_user = false
    AND t.created_at <= v_now - make_interval(secs => (v_support_hours * 3600)::double precision)
  ON CONFLICT (dedupe_key) DO NOTHING;

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  SELECT
    'refund_unanswered',
    'info',
    '처리 대기 문제마켓 환불',
    format('요청 %s크레딧 · 접수 후 %s시간 지남',
           r.requested_refund_credits,
           floor(extract(epoch FROM v_now - r.created_at) / 3600)),
    '/admin/refunds',
    'market_refund_requests',
    r.id,
    'refunds.market',
    'refund_unanswered:' || r.id || ':' || v_day
  FROM public.market_refund_requests r
  WHERE r.status = 'pending'
    AND r.created_at <= v_now - make_interval(secs => (v_refund_hours * 3600)::double precision)
  ON CONFLICT (dedupe_key) DO NOTHING;

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  SELECT
    'refund_unanswered',
    'info',
    CASE WHEN r.status = 'pending_review' THEN '처리 대기 충전 환불' ELSE '확인이 필요한 충전 환불' END,
    concat_ws(' · ',
      '환불 금액 ' || r.refund_amount || '원',
      format('%s시간 지남', floor(extract(epoch FROM v_now - s.since) / 3600))),
    '/admin/refunds',
    'refund_requests',
    r.id,
    'refunds.payment',
    'refund_unanswered:' || r.id || ':' || v_day
  FROM public.refund_requests r
  CROSS JOIN LATERAL (
    SELECT CASE WHEN r.status = 'pending_review' THEN r.created_at ELSE COALESCE(r.updated_at, r.created_at) END AS since
  ) s
  WHERE r.status IN ('pending_review', 'retryable_failed', 'manual_review')
    AND s.since <= v_now - make_interval(secs => (v_refund_hours * 3600)::double precision)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$function$
;

-- 3-17. guard_support_ticket_revisions_mutation
CREATE OR REPLACE FUNCTION public.guard_support_ticket_revisions_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'SUPPORT_TICKET_REVISIONS_APPEND_ONLY';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'SUPPORT_TICKET_REVISIONS_APPEND_ONLY';
END;
$function$
;

-- 3-18. cancel_incomplete_kakao_signup
CREATE OR REPLACE FUNCTION public.cancel_incomplete_kakao_signup(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_provider text;
  v_signup_completed boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));

  SELECT p.provider, p.signup_completed
    INTO v_provider, v_signup_completed
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR UPDATE;
  IF NOT FOUND OR v_provider IS DISTINCT FROM 'kakao' OR v_signup_completed IS TRUE THEN
    RETURN false;
  END IF;
  -- 관리자 계정은 여기서 지우지 않는다(탈퇴 route 와 같은 규칙).
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.is_admin IS TRUE) THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_orders o WHERE o.user_id = p_user_id)
     OR EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.user_id = p_user_id) THEN
    RETURN false;
  END IF;

  DELETE FROM public.exam_papers WHERE user_id = p_user_id;
  DELETE FROM public.questions WHERE user_id = p_user_id;
  DELETE FROM public.support_tickets WHERE user_id = p_user_id;
  DELETE FROM public.credit_transactions WHERE user_id = p_user_id;
  RETURN true;
END;
$function$
;

-- 3-19. complete_kakao_signup_with_consents
CREATE OR REPLACE FUNCTION public.complete_kakao_signup_with_consents(p_user_id uuid, p_items jsonb, p_email text, p_phone text, p_kakao_email text, p_kakao_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_provider text;
  v_signup_completed boolean;
  v_profile jsonb;
  v_optional_ids uuid[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'CONSENT_INPUT_INVALID';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('public.user_consents:' || p_user_id::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('public.signup_consent_items:write', 0));

  SELECT p.provider, p.signup_completed
    INTO v_provider, v_signup_completed
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONSENT_PROFILE_MISSING';
  END IF;
  IF v_provider IS DISTINCT FROM 'kakao' THEN
    RAISE EXCEPTION 'CONSENT_KAKAO_NOT_KAKAO';
  END IF;

  IF v_signup_completed IS NOT TRUE THEN
    PERFORM public.consent_record_internal(p_user_id, p_items, 'kakao_signup');

    UPDATE public.profiles
       SET email = p_email,
           phone = NULLIF(btrim(COALESCE(p_phone, '')), ''),
           kakao_email = p_email,
           kakao_id = p_kakao_id,
           provider = 'kakao',
           signup_completed = true
     WHERE id = p_user_id;
  END IF;

  SELECT jsonb_build_object('id', p.id, 'email', p.email, 'phone', p.phone, 'signup_completed', p.signup_completed)
    INTO v_profile
    FROM public.profiles p
   WHERE p.id = p_user_id;

  SELECT COALESCE(array_agg(i.id), ARRAY[]::uuid[]) INTO v_optional_ids
    FROM public.signup_consent_items i
   WHERE NOT i.required;

  RETURN jsonb_build_object(
    'profile', v_profile,
    'consentResults', public.consent_latest_results(p_user_id, v_optional_ids)
  );
END;
$function$
;

-- 3-20. consent_eligible_member_count
CREATE OR REPLACE FUNCTION public.consent_eligible_member_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT count(*)::integer
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE NOT public.is_internal_admin_account(u.email)
     AND (
       (p.provider = 'kakao' AND p.signup_completed IS TRUE)
       OR (p.provider IS DISTINCT FROM 'kakao' AND u.email_confirmed_at IS NOT NULL)
     )
$function$
;

DO $down_b_verify$
DECLARE
  v_orig text[][] := ARRAY[
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '78cd0333f01a23a4d63228369175f517'],
    ARRAY['public.apply_payapp_feedback(text,text,text,text,integer,integer,integer,integer,timestamp with time zone,timestamp with time zone)', '179f00a9693bb7b8d11dc26ce1c12c6c'],
    ARRAY['public.retry_payapp_fulfillment(uuid)', '1125573d41ab522c63a64836aa839f05'],
    ARRAY['public.resolve_payment_order_review(uuid,text,uuid,text,text,timestamp with time zone,text)', 'c9be280b25e58591f026dd196f2bc1ef'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '462fed08230394ce2b047818477ddc74'],
    ARRAY['public.begin_payapp_request(uuid)', '6deb115ebe9995bf2a0477f795e73a3e'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', '0047854ac79ddae6fba6dde114fb575d'],
    ARRAY['public.process_payapp_cancellation(uuid)', 'f45eed1de563b453dc2330e520744f06'],
    ARRAY['public.payapp_sales_resume_blockers()', '22f52c8934fe53005acf64ea21ca770a'],
    ARRAY['public.enforce_payment_reconciliation_health()', '2c7b70c6757abc8e9f078bf5626a8a8b'],
    ARRAY['public.prevent_payment_order_snapshot_update()', 'd7df22fd210082e75ae46fc5c36cd4ba'],
    ARRAY['public.consent_record_internal(uuid,jsonb,text)', '254dc713e8f9710cfd0bacf8623558a0'],
    ARRAY['public.guard_user_consents_mutation()', 'e6518c872c2be65b8c9f9e65350253e0'],
    ARRAY['public.guard_market_purchase_notice_acks_mutation()', 'aa8e0414ddbfcbd47878ccbaad2e6d23'],
    ARRAY['public.prevent_admin_event_mutation()', 'c5ec0c9e2e5f1ccc057461c207c5f074'],
    ARRAY['public.remind_unanswered_admin_work()', 'c5f96dc4237cb19a83d277a65216904b'],
    ARRAY['public.guard_support_ticket_revisions_mutation()', '1104177c1ea4a098ce06e01dfc8608e6'],
    ARRAY['public.cancel_incomplete_kakao_signup(uuid)', '7efb18ab95e4ab052a0d1f157f579ef3'],
    ARRAY['public.complete_kakao_signup_with_consents(uuid,jsonb,text,text,text,text)', 'e40ece6e830d9ccf5e5ebb691f825fd0'],
    ARRAY['public.consent_eligible_member_count()', '56fcd7334482cb97b778c97ff8947e12']
  ];
  v_text text;
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_orig, 1) LOOP
    IF md5(pg_get_functiondef(v_orig[i][1]::regprocedure)) <> v_orig[i][2] THEN
      RAISE EXCEPTION 'DOWN_B_VERIFY: % not restored', v_orig[i][1];
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('guard_withdrawn_member_write', 'guard_withdrawn_member_view_event',
               'guard_withdrawn_member_credit_source', 'guard_withdrawn_member_notification', 'record_withdrawn_member_manual_refund')) THEN
    RAISE EXCEPTION 'DOWN_B_VERIFY: protection triggers left';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_text
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('get_member_withdrawal_preview', 'get_member_withdrawal_notice', 'create_member_withdrawal_request', 'record_member_withdrawal_request_reply', 'cancel_member_withdrawal_request', 'anonymize_member', 'redact_member_text', 'mark_member_text_reviewed', 'close_withdrawn_member_held_order', 'add_withdrawn_member_event', 'mark_withdrawn_member_auth_scrubbed', 'withdrawn_member_kakao_unlink_target', 'clear_withdrawn_member_kakao_unlink', 'read_withdrawn_member_record', 'read_withdrawn_member_ticket', 'scrub_member_admin_events', 'withdrawn_member_account_status', 'resolve_member_full_delete_auth_alert', 'withdrawn_member_held_order_ids')
     AND p.proacl::text LIKE '%service_role=X%';
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'DOWN_B_VERIFY: service_role still executes %', v_text;
  END IF;
END;
$down_b_verify$;

NOTIFY pgrst, 'reload schema';
