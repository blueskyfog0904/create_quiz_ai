CREATE OR REPLACE FUNCTION public.claim_point_charge_refund(
  p_request_id uuid,
  p_admin_id uuid,
  p_admin_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.refund_requests%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_provider_transaction public.payment_provider_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_FOUND';
  END IF;

  IF v_request.status = 'completed' THEN
    RETURN jsonb_build_object(
      'already_completed', true,
      'request_id', v_request.id,
      'provider', v_request.provider
    );
  END IF;

  IF v_request.status NOT IN ('pending_review', 'retryable_failed') THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_CLAIMABLE';
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = v_request.source_id
   FOR UPDATE;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_request.payment_order_id
   FOR UPDATE;

  IF v_source.status <> 'pending_refund'
     OR v_source.remaining_credits <> v_source.initial_credits
     OR v_order.status <> 'completed'
     OR v_order.provider IS DISTINCT FROM v_request.provider THEN
    RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
  END IF;

  IF v_order.provider = 'toss' AND v_order.payment_key IS NULL THEN
    RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
  END IF;

  IF v_order.provider = 'kakaopay' THEN
    SELECT * INTO v_provider_transaction
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
       AND provider = 'kakaopay'
     FOR UPDATE;

    IF NOT FOUND
       OR v_provider_transaction.provider_transaction_id IS NULL
       OR v_provider_transaction.provider_approval_id IS NULL
       OR v_provider_transaction.provider_status <> 'SUCCESS_PAYMENT'
       OR v_provider_transaction.payment_method_type <> 'MONEY' THEN
      RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
    END IF;
  END IF;

  UPDATE public.refund_requests
     SET status = 'processing',
         processed_by = p_admin_id,
         admin_note = p_admin_note,
         attempt_count = attempt_count + 1,
         next_attempt_at = NULL,
         last_error_code = NULL,
         last_error_message = NULL
   WHERE id = v_request.id;

  RETURN jsonb_build_object(
    'already_completed', false,
    'request_id', v_request.id,
    'user_id', v_request.user_id,
    'provider', v_order.provider,
    'payment_order_id', v_order.id,
    'provider_order_id', v_order.order_id,
    'payment_key', CASE WHEN v_order.provider = 'toss' THEN v_order.payment_key ELSE NULL END,
    'provider_transaction_id', v_provider_transaction.provider_transaction_id,
    'provider_approval_id', v_provider_transaction.provider_approval_id,
    'provider_merchant_id', v_order.provider_merchant_id,
    'partner_order_id', v_order.partner_order_id,
    'partner_user_id', v_order.partner_user_id,
    'cancel_idempotency_key', v_request.cancel_idempotency_key,
    'refund_amount', v_request.refund_amount,
    'tax_free_amount', v_order.tax_free_amount,
    'vat_amount', v_order.vat_amount
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_point_charge_refund(
  p_request_id uuid,
  p_provider_cancel_transaction_key text,
  p_provider_cancelled_at timestamptz,
  p_provider_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.refund_requests%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_provider_transaction public.payment_provider_transactions%ROWTYPE;
  v_new_balance integer;
BEGIN
  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_FOUND';
  END IF;

  IF v_request.status = 'completed' THEN
    SELECT credits INTO v_new_balance
      FROM public.profiles
     WHERE id = v_request.user_id;

    RETURN jsonb_build_object('already_completed', true, 'new_balance', v_new_balance);
  END IF;

  IF v_request.status NOT IN ('processing', 'retryable_failed', 'manual_review')
     OR NULLIF(BTRIM(p_provider_cancel_transaction_key), '') IS NULL
     OR p_provider_cancelled_at IS NULL THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_READY_TO_FINALIZE';
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = v_request.source_id
   FOR UPDATE;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_request.payment_order_id
   FOR UPDATE;

  IF NOT FOUND
     OR v_request.provider IS DISTINCT FROM v_order.provider
     OR v_source.status <> 'pending_refund'
     OR v_source.remaining_credits <> v_source.initial_credits
     OR v_order.status NOT IN ('completed', 'manual_review')
     OR (
       v_request.provider_cancel_transaction_key IS NOT NULL
       AND v_request.provider_cancel_transaction_key IS DISTINCT FROM p_provider_cancel_transaction_key
     ) THEN
    RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
  END IF;

  IF v_order.provider = 'toss' AND p_provider_status <> 'CANCELED' THEN
    RAISE EXCEPTION 'REFUND_PROVIDER_STATUS_INVALID';
  END IF;

  IF v_order.provider = 'kakaopay' AND p_provider_status <> 'CANCEL_PAYMENT' THEN
    RAISE EXCEPTION 'REFUND_PROVIDER_STATUS_INVALID';
  END IF;

  IF v_order.provider = 'kakaopay' THEN
    SELECT * INTO v_provider_transaction
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
       AND provider = 'kakaopay'
     FOR UPDATE;

    IF NOT FOUND
       OR v_provider_transaction.provider_transaction_id IS NULL
       OR v_provider_transaction.provider_approval_id IS NULL
       OR v_provider_transaction.payment_method_type <> 'MONEY'
       OR v_provider_transaction.provider_status NOT IN ('SUCCESS_PAYMENT', 'CANCEL_PAYMENT') THEN
      RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
    END IF;

    UPDATE public.payment_provider_transactions
       SET provider_status = 'CANCEL_PAYMENT',
           last_reconciled_at = now(),
           updated_at = now()
     WHERE id = v_provider_transaction.id;
  END IF;

  PERFORM 1
    FROM public.profiles
   WHERE id = v_request.user_id
   FOR UPDATE;

  UPDATE public.credit_sources
     SET status = 'refunded',
         remaining_credits = 0
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

  UPDATE public.payment_orders
     SET status = 'refunded',
         provider_status = p_provider_status,
         canceled_at = p_provider_cancelled_at
   WHERE id = v_order.id;

  UPDATE public.payment_history
     SET status = 'refunded',
         provider_status = p_provider_status
   WHERE payment_order_id = v_order.id;

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
    -v_source.initial_credits,
    v_new_balance,
    format('원 결제수단 환불 완료 (%s 크레딧)', v_source.initial_credits),
    v_source.id,
    'refund_request',
    v_request.id
  );

  UPDATE public.refund_requests
     SET status = 'completed',
         provider_cancel_transaction_key = p_provider_cancel_transaction_key,
         provider_cancelled_at = p_provider_cancelled_at,
         processed_at = now(),
         next_attempt_at = NULL,
         last_error_code = NULL,
         last_error_message = NULL
   WHERE id = v_request.id;

  UPDATE public.checkout_attempts
     SET status = 'cancelled',
         updated_at = now()
   WHERE id = v_order.checkout_attempt_id;

  RETURN jsonb_build_object('already_completed', false, 'new_balance', v_new_balance);
END;
$$;

CREATE OR REPLACE FUNCTION public.quarantine_external_provider_cancellation(
  p_payment_order_id uuid,
  p_provider_cancel_transaction_key text,
  p_provider_cancelled_at timestamptz,
  p_provider_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_request public.refund_requests%ROWTYPE;
  v_used_credits integer;
  v_already_quarantined boolean := false;
BEGIN
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
      last_error_message
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
      '결제사에서 직접 취소된 거래입니다. 크레딧 회수 상태를 확인하세요.'
    )
    RETURNING * INTO v_request;
  ELSE
    UPDATE public.refund_requests
       SET status = 'manual_review',
           provider_cancel_transaction_key = p_provider_cancel_transaction_key,
           provider_cancelled_at = p_provider_cancelled_at,
           next_attempt_at = NULL,
           last_error_code = 'EXTERNAL_PROVIDER_CANCELLATION',
           last_error_message = '결제사에서 직접 취소된 거래입니다. 크레딧 회수 상태를 확인하세요.'
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
$$;

REVOKE EXECUTE ON FUNCTION public.claim_point_charge_refund(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_point_charge_refund(uuid, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.quarantine_external_provider_cancellation(uuid, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_point_charge_refund(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_point_charge_refund(uuid, text, timestamptz, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.quarantine_external_provider_cancellation(uuid, text, timestamptz, text)
  TO service_role;
