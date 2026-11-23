-- 되돌리기 (가) 돈 경로: 20261125100000_point_charge_policy.sql 의 취소 격리 3곳·수동 완료·자료 환불 배정(⓪)을 원래 정의로.
-- 코드와 무관하게 실행할 수 있다. 단 코드 배포 뒤라면 재적용 전까지 수동 완료를 하지 않는다
-- (새 화면의 전액 모드는 옛 함수에서 자손이 있으면 멈추지만 부분 모드는 통과하므로 — 런북).
-- 사전 조건: 함께 보류 중인 재지급 크레딧 0, manual_review 요청 0. 부분 완료 끝 상태 결제는 건수를 알린다(감시 목록).
-- 헬퍼·설정·표·열·정책은 남긴다(판정·동의는 (나)). 다시 적용하려면 같은 트랜잭션에서 schema_migrations 의 '20261125100000' 행을 지운 뒤
-- 마이그레이션과 이력 INSERT 를 넣는다(행을 남겨 두면 이력 INSERT 가 23505 로 실패하고 전체가 롤백된다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $down_a_precheck$
DECLARE
  v_count integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.refund_requests WHERE status = 'manual_review') THEN
    RAISE EXCEPTION 'DOWN_A_BLOCKED: manual_review requests exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.credit_sources c JOIN public.market_refund_reissued_sources l ON l.source_id = c.id
              WHERE c.status = 'pending_refund') THEN
    RAISE EXCEPTION 'DOWN_A_BLOCKED: held reissued credits exist';
  END IF;
  SELECT count(*) INTO v_count
    FROM public.credit_sources a
    JOIN public.payment_orders o ON o.id = a.payment_order_id
   WHERE a.source_category = 'plan_purchase' AND a.status = 'active' AND o.status = 'completed'
     AND EXISTS (SELECT 1 FROM public.credit_source_reissued_descendants(a.id) dd
                   JOIN public.credit_sources c ON c.id = dd WHERE c.remaining_credits > 0);
  RAISE NOTICE 'DOWN_A_WATCHLIST partial-end-state payments: %', v_count;
END;
$down_a_precheck$;

CREATE OR REPLACE FUNCTION public.quarantine_external_provider_cancellation(p_payment_order_id uuid, p_provider_cancel_transaction_key text, p_provider_cancelled_at timestamp with time zone, p_provider_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_request public.refund_requests%ROWTYPE;
  v_used_credits integer;
  v_already_quarantined boolean := false;
  v_provider text;
  v_pre_source_id uuid;
  v_pre_request_id uuid;
  v_now_request_id uuid;
BEGIN
  SELECT provider, source_id INTO v_provider, v_pre_source_id
    FROM public.payment_orders
   WHERE id = p_payment_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND';
  END IF;

  IF v_provider = 'payapp' THEN
    IF NULLIF(BTRIM(p_provider_cancel_transaction_key), '') IS NULL
       OR p_provider_cancelled_at IS NULL
       OR p_provider_status <> 'CANCELED' THEN
      RAISE EXCEPTION 'EXTERNAL_PROVIDER_CANCELLATION_INVALID';
    END IF;

    -- 열린 환불 요청을 잠금 없이 찾고, 환불 순서로 잠근 뒤 다시 확인한다.
    IF v_pre_source_id IS NOT NULL THEN
      SELECT id INTO v_pre_request_id
        FROM public.refund_requests
       WHERE source_id = v_pre_source_id
         AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
       ORDER BY created_at DESC
       LIMIT 1;
    END IF;

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

    PERFORM 1
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
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

    IF v_order.source_id IS DISTINCT FROM v_pre_source_id
       OR v_now_request_id IS DISTINCT FROM v_pre_request_id THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PAYAPP_CANCELLATION_STATE_CHANGED';
    END IF;

    IF v_order.status = 'refunded' THEN
      RETURN jsonb_build_object('already_completed', true, 'credits_used', false);
    END IF;

    IF v_source.id IS NULL OR v_source.status = 'refunded' THEN
      RAISE EXCEPTION 'EXTERNAL_PROVIDER_CANCELLATION_SOURCE_NOT_FOUND';
    END IF;

    v_already_quarantined := v_request.id IS NOT NULL
      AND v_request.origin = 'external_cancel'
      AND v_request.last_error_code = 'EXTERNAL_PROVIDER_CANCELLATION'
      AND v_request.provider_cancel_transaction_key IS NOT DISTINCT FROM p_provider_cancel_transaction_key;

    IF v_request.id IS NULL THEN
      INSERT INTO public.refund_requests (
        user_id,
        source_id,
        reason,
        status,
        payment_order_id,
        provider,
        refund_amount,
        cancel_idempotency_key,
        provider_cancel_transaction_key,
        provider_cancelled_at,
        last_error_code,
        last_error_message,
        origin
      ) VALUES (
        v_order.user_id,
        v_source.id,
        '결제사 외부 취소 감지',
        'manual_review',
        v_order.id,
        v_order.provider,
        v_order.expected_amount,
        v_order.cancel_idempotency_key,
        p_provider_cancel_transaction_key,
        p_provider_cancelled_at,
        'EXTERNAL_PROVIDER_CANCELLATION',
        '결제사에서 직접 취소된 거래입니다. 크레딧 회수 상태를 확인하세요.',
        'external_cancel'
      )
      RETURNING * INTO v_request;
    ELSE
      UPDATE public.refund_requests
         SET status = 'manual_review',
             provider_cancel_transaction_key = p_provider_cancel_transaction_key,
             provider_cancelled_at = p_provider_cancelled_at,
             next_attempt_at = NULL,
             last_error_code = 'EXTERNAL_PROVIDER_CANCELLATION',
             last_error_message = '결제사에서 직접 취소된 거래입니다. 크레딧 회수 상태를 확인하세요.',
             origin = CASE WHEN origin = 'user' THEN 'external_cancel' ELSE origin END
       WHERE id = v_request.id;
    END IF;

    UPDATE public.credit_sources
       SET status = 'pending_refund'
     WHERE id = v_source.id
       AND status = 'active';

    UPDATE public.payment_orders
       SET status = 'manual_review',
           provider_status = p_provider_status,
           canceled_at = COALESCE(canceled_at, p_provider_cancelled_at),
           failure_code = 'EXTERNAL_PROVIDER_CANCELLATION',
           failure_message = '결제사 외부 취소가 감지되어 크레딧을 격리했습니다.',
           next_reconcile_at = NULL
     WHERE id = v_order.id;

    UPDATE public.payment_history
       SET provider_status = p_provider_status
     WHERE payment_order_id = v_order.id;

    v_used_credits := v_source.initial_credits - v_source.remaining_credits;

    IF NOT v_already_quarantined THEN
      INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
      SELECT id,
             'warning',
             '외부 결제 취소 확인 필요',
             format('%s 결제가 외부에서 취소되었습니다. 사용자 %s, 사용 크레딧 %s', v_order.provider, v_order.user_id, v_used_credits),
             '/admin/refunds',
             false
        FROM public.profiles
       WHERE is_admin = true;
    END IF;

    RETURN jsonb_build_object(
      'already_completed', false,
      'already_quarantined', v_already_quarantined,
      'request_id', v_request.id,
      'credits_used', v_used_credits > 0,
      'used_credit_amount', v_used_credits
    );
  END IF;

  -- 카카오·토스: 기존 순서(payment_orders → credit_sources → profiles → refund_requests) 그대로.
  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND';
  END IF;

  IF v_order.status = 'refunded' THEN
    RETURN jsonb_build_object('already_completed', true, 'credits_used', false);
  END IF;

  IF NULLIF(BTRIM(p_provider_cancel_transaction_key), '') IS NULL
     OR p_provider_cancelled_at IS NULL
     OR (v_order.provider = 'toss' AND p_provider_status <> 'CANCELED')
     OR (v_order.provider = 'kakaopay' AND p_provider_status <> 'CANCEL_PAYMENT') THEN
    RAISE EXCEPTION 'EXTERNAL_PROVIDER_CANCELLATION_INVALID';
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE payment_order_id = v_order.id
   FOR UPDATE;

  IF NOT FOUND OR v_source.status = 'refunded' THEN
    RAISE EXCEPTION 'EXTERNAL_PROVIDER_CANCELLATION_SOURCE_NOT_FOUND';
  END IF;

  PERFORM 1
    FROM public.profiles
   WHERE id = v_order.user_id
   FOR UPDATE;

  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE source_id = v_source.id
     AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  v_already_quarantined := FOUND
    AND v_request.last_error_code = 'EXTERNAL_PROVIDER_CANCELLATION'
    AND v_request.provider_cancel_transaction_key IS NOT DISTINCT FROM p_provider_cancel_transaction_key;

  IF v_request.id IS NULL THEN
    INSERT INTO public.refund_requests (
      user_id,
      source_id,
      reason,
      status,
      payment_order_id,
      provider,
      refund_amount,
      cancel_idempotency_key,
      provider_cancel_transaction_key,
      provider_cancelled_at,
      last_error_code,
      last_error_message,
      origin
    ) VALUES (
      v_order.user_id,
      v_source.id,
      '결제사 외부 취소 감지',
      'manual_review',
      v_order.id,
      v_order.provider,
      v_order.expected_amount,
      v_order.cancel_idempotency_key,
      p_provider_cancel_transaction_key,
      p_provider_cancelled_at,
      'EXTERNAL_PROVIDER_CANCELLATION',
      '결제사에서 직접 취소된 거래입니다. 크레딧 회수 상태를 확인하세요.',
      'external_cancel'
    )
    RETURNING * INTO v_request;
  ELSE
    UPDATE public.refund_requests
       SET status = 'manual_review',
           provider_cancel_transaction_key = p_provider_cancel_transaction_key,
           provider_cancelled_at = p_provider_cancelled_at,
           next_attempt_at = NULL,
           last_error_code = 'EXTERNAL_PROVIDER_CANCELLATION',
           last_error_message = '결제사에서 직접 취소된 거래입니다. 크레딧 회수 상태를 확인하세요.',
           origin = CASE WHEN origin = 'user' THEN 'external_cancel' ELSE origin END
     WHERE id = v_request.id;
  END IF;

  UPDATE public.credit_sources
     SET status = 'pending_refund'
   WHERE id = v_source.id;

  UPDATE public.payment_orders
     SET status = 'manual_review',
         provider_status = p_provider_status,
         canceled_at = p_provider_cancelled_at,
         failure_code = 'EXTERNAL_PROVIDER_CANCELLATION',
         failure_message = '결제사 외부 취소가 감지되어 크레딧을 격리했습니다.'
   WHERE id = v_order.id;

  UPDATE public.payment_history
     SET provider_status = p_provider_status
   WHERE payment_order_id = v_order.id;

  IF v_order.provider = 'kakaopay' THEN
    UPDATE public.payment_provider_transactions
       SET provider_status = 'CANCEL_PAYMENT',
           last_reconciled_at = now(),
           updated_at = now()
     WHERE payment_order_id = v_order.id
       AND provider = 'kakaopay';
  END IF;

  v_used_credits := v_source.initial_credits - v_source.remaining_credits;

  IF NOT v_already_quarantined THEN
    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      message,
      link,
      is_read
    )
    SELECT
      id,
      'warning',
      '외부 결제 취소 확인 필요',
      format(
        '%s 결제가 외부에서 취소되었습니다. 사용자 %s, 사용 크레딧 %s',
        v_order.provider,
        v_order.user_id,
        v_used_credits
      ),
      '/admin/refunds',
      false
      FROM public.profiles
     WHERE is_admin = true;
  END IF;

  RETURN jsonb_build_object(
    'already_completed', false,
    'already_quarantined', v_already_quarantined,
    'request_id', v_request.id,
    'credits_used', v_used_credits > 0,
    'used_credit_amount', v_used_credits
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.quarantine_payapp_partial_cancellation(p_payment_order_id uuid)
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
  v_pre_source_id uuid;
  v_pre_request_id uuid;
  v_now_request_id uuid;
  v_outcome text;
  v_notify boolean := false;
BEGIN
  SELECT source_id INTO v_pre_source_id
    FROM public.payment_orders
   WHERE id = p_payment_order_id
     AND provider = 'payapp';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FOUND';
  END IF;

  IF v_pre_source_id IS NULL THEN
    RAISE EXCEPTION 'PAYAPP_PARTIAL_CANCEL_SOURCE_NOT_FOUND';
  END IF;

  SELECT id INTO v_pre_request_id
    FROM public.refund_requests
   WHERE source_id = v_pre_source_id
     AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_pre_request_id IS NOT NULL THEN
    SELECT * INTO v_request
      FROM public.refund_requests
     WHERE id = v_pre_request_id
     FOR UPDATE;
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = v_pre_source_id
   FOR UPDATE;

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

  SELECT id INTO v_now_request_id
    FROM public.refund_requests
   WHERE source_id = v_pre_source_id
     AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_order.source_id IS DISTINCT FROM v_pre_source_id
     OR v_now_request_id IS DISTINCT FROM v_pre_request_id THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PAYAPP_CANCELLATION_STATE_CHANGED';
  END IF;

  IF v_ppt.partial_cancel_feedback_recorded_at IS NULL THEN
    RAISE EXCEPTION 'PAYAPP_PARTIAL_CANCEL_MARKER_MISSING';
  END IF;

  IF v_ppt.partial_cancel_processed_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'already_processed', 'already_quarantined', true);
  END IF;

  IF v_order.status = 'refunded' OR v_source.status = 'refunded' THEN
    -- 전액 환불로 부분취소가 흡수됐다. 크레딧은 이미 전액 회수됐다.
    v_outcome := 'absorbed_by_refund';
  ELSIF v_request.id IS NOT NULL AND v_request.status = 'processing' THEN
    -- 전취소가 진행 중이다. 처리 시각을 두지 않고 환불이 끝난 뒤 대사가 다시 집는다.
    RETURN jsonb_build_object('outcome', 'deferred_refund_processing', 'request_id', v_request.id);
  ELSIF v_request.id IS NOT NULL AND v_request.origin IN ('external_cancel', 'partial_cancel') THEN
    v_outcome := 'already_quarantined';
  ELSE
    IF v_request.id IS NULL THEN
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
        '결제사 부분취소 감지',
        'manual_review',
        v_order.id,
        'payapp',
        v_order.expected_amount,
        v_order.cancel_idempotency_key,
        'PAYAPP_PARTIAL_CANCEL_QUARANTINED',
        '페이앱에서 부분취소된 결제입니다. 회수할 크레딧과 실제 환불액을 확인해 수동 완료하세요.',
        'partial_cancel'
      )
      RETURNING * INTO v_request;
    ELSE
      UPDATE public.refund_requests
         SET status = 'manual_review',
             next_attempt_at = NULL,
             last_error_code = 'PAYAPP_PARTIAL_CANCEL_QUARANTINED',
             last_error_message = '페이앱에서 부분취소된 결제입니다. 회수할 크레딧과 실제 환불액을 확인해 수동 완료하세요.',
             origin = 'partial_cancel'
       WHERE id = v_request.id;
    END IF;

    UPDATE public.credit_sources
       SET status = 'pending_refund'
     WHERE id = v_source.id
       AND status = 'active';

    UPDATE public.payment_orders
       SET status = 'manual_review',
           failure_code = 'PAYAPP_PARTIAL_CANCEL_QUARANTINED',
           failure_message = '페이앱 부분취소가 감지되어 크레딧을 격리했습니다.',
           next_reconcile_at = NULL
     WHERE id = v_order.id;

    v_outcome := 'quarantined';
    v_notify := true;
  END IF;

  UPDATE public.payment_provider_transactions
     SET partial_cancel_processed_at = COALESCE(partial_cancel_processed_at, now()),
         updated_at = now()
   WHERE id = v_ppt.id;

  IF v_notify THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, is_read)
    SELECT id,
           'warning',
           '페이앱 부분취소 확인 필요',
           format('주문 %s가 페이앱에서 부분취소되었습니다. 사용 크레딧 %s', v_order.order_id, v_source.initial_credits - v_source.remaining_credits),
           '/admin/refunds',
           false
      FROM public.profiles
     WHERE is_admin = true;
  END IF;

  -- 전액 환불로 흡수된 부분취소는 실제 환불액(원금 − 부분취소 금액)을 돌려주고 route가 경보 details로 남긴다.
  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'already_quarantined', v_outcome IN ('already_quarantined', 'absorbed_by_refund'),
    'request_id', v_request.id,
    'partial_cancel_amount', v_ppt.partial_cancel_amount,
    'actual_refund_amount', CASE
      WHEN v_outcome = 'absorbed_by_refund' AND v_ppt.partial_cancel_amount IS NOT NULL
        THEN v_order.expected_amount - v_ppt.partial_cancel_amount
    END
  );
END;
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.complete_manual_point_charge_refund(p_request_id uuid, p_admin_id uuid, p_note text, p_external_method text, p_refund_amount integer, p_recovered_credits integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.refund_requests%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_partial boolean;
  v_recovered integer;
  v_remaining_after integer;
  v_used_before integer;
  v_balance_before integer;
  v_new_balance integer;
  v_source_status_after text;
  v_double boolean := false;
BEGIN
  IF p_admin_id IS NULL
     OR NULLIF(BTRIM(p_note), '') IS NULL
     OR p_external_method IS NULL
     OR p_external_method NOT IN ('payapp_cancel_request', 'bank_transfer', 'provider_admin_cancel')
     OR p_refund_amount IS NULL
     OR p_refund_amount NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'MANUAL_REFUND_INPUT_INVALID';
  END IF;

  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_FOUND';
  END IF;

  IF v_request.status = 'completed' THEN
    -- 계좌 송금 외의 방식(결제사 취소 통보, 페이앱 취소 요청, 페이앱 관리자 취소)으로 이미 완료된 요청에
    -- 계좌 송금 완료가 들어오면 이중 환불 의심이다. 같은 계좌 송금의 재클릭은 제외한다.
    IF p_external_method = 'bank_transfer' AND NOT EXISTS (
         SELECT 1 FROM public.payment_admin_actions paa
          WHERE paa.refund_request_id = v_request.id
            AND paa.action = 'manual_refund_completed'
            AND paa.external_method = 'bank_transfer') THEN
      PERFORM public.record_payment_alert('PAYAPP_DOUBLE_REFUND_SUSPECTED', 'critical',
        '이미 다른 방식으로 환불이 완료된 요청에 계좌 송금 완료가 입력되었습니다. 송금했다면 회수가 필요합니다.',
        jsonb_build_object('payment_order_id', v_request.payment_order_id, 'refund_request_id', v_request.id,
                           'actor_id', p_admin_id, 'provider_cancel_transaction_key', v_request.provider_cancel_transaction_key,
                           'dedupe_key', 'refund_request:' || v_request.id::text,
                           'source', 'complete_manual_after_completed'));
      v_double := true;
    END IF;

    SELECT credits INTO v_new_balance
      FROM public.profiles
     WHERE id = v_request.user_id;

    RETURN jsonb_build_object('already_completed', true, 'new_balance', v_new_balance, 'double_refund_suspected', v_double);
  END IF;

  IF v_request.status <> 'manual_review' THEN
    RAISE EXCEPTION 'MANUAL_REFUND_NOT_ALLOWED';
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = v_request.source_id
   FOR UPDATE;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_request.payment_order_id
   FOR UPDATE;

  IF v_order.id IS NOT NULL THEN
    SELECT * INTO v_ppt
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
     FOR UPDATE;
  END IF;

  SELECT credits INTO v_balance_before
    FROM public.profiles
   WHERE id = v_request.user_id
   FOR UPDATE;

  IF v_order.id IS NULL
     OR v_order.status NOT IN ('completed', 'manual_review')
     OR v_source.id IS NULL
     OR v_source.status <> 'pending_refund'
     OR p_refund_amount > v_order.expected_amount THEN
    RAISE EXCEPTION 'MANUAL_REFUND_REVALIDATION_FAILED';
  END IF;

  -- 처리되지 않은 부분취소 표식이 있으면 격리가 끝난 뒤에 완료한다(나중에 원천이 다시 묶이지 않게).
  IF v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
     AND v_ppt.partial_cancel_processed_at IS NULL THEN
    RAISE EXCEPTION 'MANUAL_REFUND_MARKER_PENDING';
  END IF;

  -- 승인취소(전액) 표식이 있으면 PG는 전액 환불이므로 부분 회수를 허용하지 않는다(남은 크레딧 전량 회수).
  v_partial := v_ppt.cancel_feedback_recorded_at IS NULL
    AND COALESCE(
    v_request.origin = 'partial_cancel'
    OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
    OR v_request.last_error_code IN ('KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW'),
    false
  );

  IF v_partial THEN
    IF p_recovered_credits IS NULL
       OR p_recovered_credits NOT BETWEEN 0 AND v_source.remaining_credits THEN
      RAISE EXCEPTION 'MANUAL_REFUND_RECOVERY_INVALID';
    END IF;
    v_recovered := p_recovered_credits;
  ELSE
    IF p_recovered_credits IS NOT NULL
       AND p_recovered_credits <> v_source.remaining_credits THEN
      RAISE EXCEPTION 'MANUAL_REFUND_RECOVERY_INVALID';
    END IF;
    v_recovered := v_source.remaining_credits;
  END IF;

  v_used_before := v_source.initial_credits - v_source.remaining_credits;
  v_remaining_after := v_source.remaining_credits - v_recovered;
  v_source_status_after := CASE WHEN v_remaining_after > 0 THEN 'active' ELSE 'refunded' END;

  UPDATE public.credit_sources
     SET remaining_credits = v_remaining_after,
         status = v_source_status_after
   WHERE id = v_source.id;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_new_balance
    FROM public.credit_sources
   WHERE user_id = v_request.user_id
     AND status IN ('active', 'pending_refund')
     AND (expires_at IS NULL OR expires_at > now());

  UPDATE public.profiles
     SET credits = v_new_balance
   WHERE id = v_request.user_id;

  IF v_recovered > 0 THEN
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
      v_request.user_id,
      'refund',
      -v_recovered,
      v_new_balance,
      format('수동 환불 완료 (%s 크레딧 회수)', v_recovered),
      v_source.id,
      'refund_request',
      v_request.id
    );
  END IF;

  IF v_source_status_after = 'refunded' THEN
    UPDATE public.payment_orders
       SET status = 'refunded',
           canceled_at = COALESCE(canceled_at, now()),
           next_reconcile_at = NULL
     WHERE id = v_order.id;

    UPDATE public.payment_history
       SET status = 'refunded'
     WHERE payment_order_id = v_order.id;

    UPDATE public.checkout_attempts
       SET status = 'cancelled',
           updated_at = now()
     WHERE id = v_order.checkout_attempt_id;
  ELSE
    UPDATE public.payment_orders
       SET status = 'completed',
           failure_code = NULL,
           failure_message = NULL,
           next_reconcile_at = NULL
     WHERE id = v_order.id;
  END IF;

  UPDATE public.refund_requests
     SET status = 'completed',
         refund_amount = p_refund_amount,
         processed_by = p_admin_id,
         processed_at = now(),
         next_attempt_at = NULL
   WHERE id = v_request.id;

  INSERT INTO public.payment_admin_actions (
    actor_id,
    action,
    payment_order_id,
    refund_request_id,
    before_state,
    after_state,
    note,
    recovered_credits,
    unrecovered_credits,
    external_method,
    details
  ) VALUES (
    p_admin_id,
    'manual_refund_completed',
    v_order.id,
    v_request.id,
    jsonb_build_object(
      'request_status', v_request.status,
      'order_status', v_order.status,
      'source_status', v_source.status,
      'remaining_credits', v_source.remaining_credits,
      'profile_credits', v_balance_before
    ),
    jsonb_build_object(
      'request_status', 'completed',
      'order_status', CASE WHEN v_source_status_after = 'refunded' THEN 'refunded' ELSE 'completed' END,
      'source_status', v_source_status_after,
      'remaining_credits', v_remaining_after,
      'profile_credits', v_new_balance
    ),
    p_note,
    v_recovered,
    v_remaining_after,
    p_external_method,
    jsonb_build_object(
      'used_credits_before', v_used_before,
      'refund_amount', p_refund_amount,
      'partial', v_partial,
      'origin', v_request.origin
    )
  );

  RETURN jsonb_build_object(
    'already_completed', false,
    'new_balance', v_new_balance,
    'recovered_credits', v_recovered,
    'remaining_credits', v_remaining_after,
    'user_id', v_request.user_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.market_refund_allocate(p_order_id uuid, p_amount integer, p_exclude uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_order public.market_purchase_orders%ROWTYPE;
  v_src record;
  v_source public.credit_sources%ROWTYPE;
  v_items jsonb := '[]'::jsonb;
  v_left integer := p_amount;
  v_take integer;
  v_cap integer;
  v_restore integer;
  v_restored integer := 0;
  v_reissued integer := 0;
  v_unrecovered integer := 0;
  v_needs_owner boolean := false;
  v_in_progress boolean := false;
  v_flags jsonb := '[]'::jsonb;
  v_po uuid;
  v_has_cash boolean;
  v_open boolean;
  v_marker boolean;
  v_reason text;
  v_purchase_left interval;
BEGIN
  SELECT * INTO v_order FROM public.market_purchase_orders WHERE id = p_order_id;
  IF NOT FOUND OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('code', 'INVALID');
  END IF;

  FOR v_src IN
    WITH cons AS (
      SELECT NULLIF(COALESCE(e ->> 'source_id', e ->> 'sourceId'), '')::uuid AS source_id,
             COALESCE((e ->> 'amount')::integer, 0) AS amount, ord
        FROM jsonb_array_elements(COALESCE(v_order.credit_consumptions, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
    ), grouped AS (
      SELECT source_id, sum(amount)::integer AS consumed, min(ord) AS first_ord
        FROM cons WHERE source_id IS NOT NULL AND amount > 0 GROUP BY source_id
    ), prior AS (
      SELECT (x ->> 'source_id')::uuid AS source_id, sum(COALESCE((x ->> 'taken')::integer, 0))::integer AS taken
        FROM public.market_refund_requests r, jsonb_array_elements(COALESCE(r.allocated_items, '[]'::jsonb)) x
       WHERE r.order_id = p_order_id AND r.status = 'approved' AND x ? 'source_id' AND (x ->> 'source_id') IS NOT NULL
       GROUP BY 1
    )
    SELECT g.source_id, GREATEST(g.consumed - COALESCE(p.taken, 0), 0) AS remaining_consumed, g.first_ord
      FROM grouped g LEFT JOIN prior p ON p.source_id = g.source_id
     ORDER BY g.first_ord DESC
  LOOP
    CONTINUE WHEN v_src.remaining_consumed <= 0 OR v_src.source_id = ANY (COALESCE(p_exclude, '{}'));

    SELECT * INTO v_source FROM public.credit_sources WHERE id = v_src.source_id AND user_id = v_order.user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CREDIT_REFUND_SOURCE_NOT_FOUND';
    END IF;

    v_po := COALESCE(v_source.payment_order_id,
                     (SELECT rr.payment_order_id FROM public.refund_requests rr WHERE rr.source_id = v_source.id
                       AND rr.payment_order_id IS NOT NULL ORDER BY rr.created_at LIMIT 1));
    v_has_cash := EXISTS (SELECT 1 FROM public.refund_requests rr WHERE rr.source_id = v_source.id AND rr.status = 'completed');
    v_open := EXISTS (SELECT 1 FROM public.refund_requests rr WHERE rr.source_id = v_source.id
                       AND rr.status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review'));
    v_marker := v_po IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.payment_provider_transactions t
       WHERE t.payment_order_id = v_po
         AND ((t.cancel_feedback_recorded_at IS NOT NULL AND t.cancel_processed_at IS NULL)
           OR (t.partial_cancel_feedback_recorded_at IS NOT NULL AND t.partial_cancel_processed_at IS NULL)));

    IF v_has_cash OR v_open OR v_marker OR v_source.status <> 'active' THEN
      v_needs_owner := true;
      IF v_open OR v_marker OR v_source.status = 'pending_refund' THEN
        v_in_progress := true;
      END IF;
      v_flags := v_flags || jsonb_build_array(jsonb_build_object(
        'source_id', v_source.id, 'remaining_consumed', v_src.remaining_consumed, 'status', v_source.status,
        'cash_refunded', v_has_cash, 'refund_open', v_open, 'cancel_marker', v_marker));
    END IF;
  END LOOP;

  IF v_needs_owner THEN
    RETURN jsonb_build_object('code', 'NEEDS_OWNER', 'in_progress', v_in_progress, 'owner_sources', v_flags);
  END IF;

  FOR v_src IN
    WITH cons AS (
      SELECT NULLIF(COALESCE(e ->> 'source_id', e ->> 'sourceId'), '')::uuid AS source_id,
             COALESCE((e ->> 'amount')::integer, 0) AS amount, ord
        FROM jsonb_array_elements(COALESCE(v_order.credit_consumptions, '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
    ), grouped AS (
      SELECT source_id, sum(amount)::integer AS consumed, min(ord) AS first_ord
        FROM cons WHERE source_id IS NOT NULL AND amount > 0 GROUP BY source_id
    ), prior AS (
      SELECT (x ->> 'source_id')::uuid AS source_id, sum(COALESCE((x ->> 'taken')::integer, 0))::integer AS taken
        FROM public.market_refund_requests r, jsonb_array_elements(COALESCE(r.allocated_items, '[]'::jsonb)) x
       WHERE r.order_id = p_order_id AND r.status = 'approved' AND (x ->> 'source_id') IS NOT NULL
       GROUP BY 1
    )
    SELECT g.source_id, GREATEST(g.consumed - COALESCE(p.taken, 0), 0) AS remaining_consumed, g.first_ord
      FROM grouped g LEFT JOIN prior p ON p.source_id = g.source_id
     ORDER BY g.first_ord DESC
  LOOP
    EXIT WHEN v_left <= 0;
    CONTINUE WHEN v_src.remaining_consumed <= 0 OR v_src.source_id = ANY (COALESCE(p_exclude, '{}'));
    SELECT * INTO v_source FROM public.credit_sources WHERE id = v_src.source_id FOR UPDATE;
    v_take := LEAST(v_src.remaining_consumed, v_left);
    v_purchase_left := CASE WHEN v_source.expires_at IS NULL THEN NULL ELSE v_source.expires_at - v_order.created_at END;

    IF v_source.expires_at IS NULL
       OR (v_source.expires_at > v_now AND v_source.expires_at - v_now >= LEAST(v_purchase_left, interval '30 days')) THEN
      v_cap := GREATEST(v_source.initial_credits - v_source.remaining_credits, 0);
      v_restore := LEAST(v_take, v_cap);
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source_id', v_source.id, 'taken', v_take, 'restored', v_restore, 'reissued', 0,
        'unrecovered', v_take - v_restore, 'reason', CASE WHEN v_take > v_restore THEN 'capped' END));
      v_restored := v_restored + v_restore;
      v_unrecovered := v_unrecovered + (v_take - v_restore);
    ELSE
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source_id', v_source.id, 'taken', v_take, 'restored', 0, 'reissued', v_take, 'unrecovered', 0,
        'reason', NULL,
        'reissued_expires_at', v_now + GREATEST(v_purchase_left, interval '1 day')));
      v_reissued := v_reissued + v_take;
    END IF;
    v_left := v_left - v_take;
  END LOOP;

  IF v_left > 0 THEN
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'source_id', NULL, 'taken', v_left, 'restored', 0, 'reissued', 0, 'unrecovered', v_left, 'reason', 'unmatched'));
    v_unrecovered := v_unrecovered + v_left;
  END IF;

  RETURN jsonb_build_object('code', 'OK', 'items', v_items, 'requested', p_amount,
    'restored', v_restored, 'reissued', v_reissued, 'unrecovered', v_unrecovered,
    'restorable', v_restored + v_reissued);
END;
$function$;

DO $down_a_verify$
BEGIN
  IF md5(pg_get_functiondef('public.quarantine_external_provider_cancellation(uuid,text,timestamp with time zone,text)'::regprocedure)) <> '7262e621179dda8b3094b8455a6718a1'
     OR md5(pg_get_functiondef('public.quarantine_payapp_partial_cancellation(uuid)'::regprocedure)) <> 'e0d24cd68b52d8011bf3adce4e0c5eb7'
     OR md5(pg_get_functiondef('public.process_payapp_cancellation(uuid)'::regprocedure)) <> '31878a1c6c5247c501c46b3d49091a82'
     OR md5(pg_get_functiondef('public.complete_manual_point_charge_refund(uuid,uuid,text,text,integer,integer)'::regprocedure)) <> '90c81af8fb2ebf8cb9a4a848d81dc688'
     OR md5(pg_get_functiondef('public.market_refund_allocate(uuid,integer,uuid[])'::regprocedure)) <> '0eca13d1b2dcce79e5872a4ce8b82453' THEN
    RAISE EXCEPTION 'DOWN_A_VERIFY: function md5 not restored';
  END IF;
END;
$down_a_verify$;

NOTIFY pgrst, 'reload schema';
