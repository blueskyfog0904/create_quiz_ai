-- 롤백: 20261110115000_cancel_alert_admin_confirmed_message.
-- process_payapp_cancellation을 20261110100000의 정의로 되돌린다(경보 문구 CASE와 격리 요청 분기 reason만 다르다).
-- 20261110100000 롤백보다 먼저 실행한다. 실행 뒤 schema_migrations에서 20261110115000 행을 지운다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF position('이 사이트 결제의 취소인지 페이앱 콘솔과 먼저 대조하세요.'
              IN pg_get_functiondef(to_regprocedure('public.process_payapp_cancellation(uuid)'))) = 0 THEN
    RAISE EXCEPTION 'CANCEL_ALERT_MESSAGE_ROLLBACK_PRECHECK: 20261110115000 not applied';
  END IF;
END;
$$;

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
          WHEN 'PAYAPP_CANCEL_AFTER_QUARANTINE' THEN '수동 확인 중인 결제가 페이앱에서 승인취소되었습니다. 전액 환불 기준으로 처리하세요.'
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

DO $$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.process_payapp_cancellation(uuid)')))
       IS DISTINCT FROM 'c96cf3e72c2adec8cc73c972977f5ea2' THEN
    RAISE EXCEPTION 'CANCEL_ALERT_MESSAGE_ROLLBACK_VERIFY: definition not restored';
  END IF;
END;
$$;
