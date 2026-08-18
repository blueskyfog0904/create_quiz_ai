-- Add the KakaoPay ready/callback state machine without changing Toss behavior.

DROP FUNCTION IF EXISTS public.prepare_payment_order(
  uuid, uuid, text, uuid, text, text, integer, integer, text, text,
  text, text, text, timestamptz, integer, integer
);

CREATE OR REPLACE FUNCTION public.prepare_payment_order(
  p_user_id uuid,
  p_checkout_attempt_id uuid,
  p_provider text,
  p_plan_id uuid,
  p_order_id text,
  p_plan_name_snapshot text,
  p_expected_amount integer,
  p_expected_credits integer,
  p_provider_environment text,
  p_provider_merchant_id text,
  p_request_fingerprint text,
  p_confirm_idempotency_key text,
  p_cancel_idempotency_key text,
  p_expires_at timestamptz,
  p_tax_free_amount integer,
  p_vat_amount integer,
  p_partner_user_id text
)
RETURNS public.payment_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
BEGIN
  IF p_provider NOT IN ('toss', 'kakaopay')
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
    ready_expires_at
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
    CASE WHEN p_provider = 'toss' THEN p_provider_merchant_id ELSE NULL END,
    p_provider_merchant_id,
    p_order_id,
    CASE WHEN p_provider = 'kakaopay' THEN p_partner_user_id ELSE NULL END,
    p_tax_free_amount,
    p_vat_amount,
    CASE WHEN p_provider = 'kakaopay' THEN 'preparing' ELSE 'ready' END,
    p_request_fingerprint,
    v_attempt.id,
    p_confirm_idempotency_key,
    p_cancel_idempotency_key,
    p_expires_at,
    p_expires_at,
    CASE WHEN p_provider = 'kakaopay' THEN now() ELSE NULL END,
    CASE WHEN p_provider = 'kakaopay' THEN p_expires_at ELSE NULL END
  )
  RETURNING * INTO v_order;

  UPDATE public.checkout_attempts
     SET payment_order_id = v_order.id,
         updated_at = now()
   WHERE id = v_attempt.id;

  RETURN v_order;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prepare_payment_order(
  uuid, uuid, text, uuid, text, text, integer, integer, text, text,
  text, text, text, timestamptz, integer, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_payment_order(
  uuid, uuid, text, uuid, text, text, integer, integer, text, text,
  text, text, text, timestamptz, integer, integer, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.begin_kakaopay_ready(
  p_payment_order_id uuid,
  p_callback_state_hash text,
  p_callback_state_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_runtime public.payment_runtime_config%ROWTYPE;
BEGIN
  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND OR v_order.provider <> 'kakaopay' THEN
    RAISE EXCEPTION 'KAKAOPAY_ORDER_NOT_FOUND';
  END IF;

  SELECT *
    INTO v_runtime
    FROM public.payment_runtime_config
   WHERE id = true;

  IF NOT FOUND
     OR NOT v_runtime.master_accepts_new_orders
     OR NOT v_runtime.kakaopay_accepts_new_orders
     OR v_runtime.accepted_provider_environment IS DISTINCT FROM v_order.provider_environment
     OR v_runtime.kakaopay_merchant_id IS DISTINCT FROM v_order.provider_merchant_id THEN
    RAISE EXCEPTION 'PAYMENT_RUNTIME_GATE_CLOSED';
  END IF;

  IF v_order.status = 'ready' THEN
    RETURN jsonb_build_object('claimed', false, 'status', 'ready');
  END IF;

  IF v_order.status = 'ready_unknown' THEN
    RETURN jsonb_build_object('claimed', false, 'status', 'ready_unknown');
  END IF;

  IF v_order.status <> 'preparing'
     OR v_order.ready_expires_at IS NULL
     OR v_order.ready_expires_at <= now()
     OR p_callback_state_expires_at IS DISTINCT FROM v_order.ready_expires_at
     OR NULLIF(BTRIM(p_callback_state_hash), '') IS NULL THEN
    RAISE EXCEPTION 'KAKAOPAY_READY_NOT_CLAIMABLE';
  END IF;

  INSERT INTO public.payment_provider_transactions (
    payment_order_id,
    provider,
    provider_merchant_id,
    callback_state_hash,
    callback_state_expires_at
  ) VALUES (
    v_order.id,
    'kakaopay',
    v_order.provider_merchant_id,
    p_callback_state_hash,
    p_callback_state_expires_at
  );

  UPDATE public.payment_orders
     SET status = 'ready_unknown',
         failure_code = NULL,
         failure_message = NULL,
         updated_at = now()
   WHERE id = v_order.id;

  RETURN jsonb_build_object('claimed', true, 'status', 'ready_unknown');
END;
$$;

CREATE OR REPLACE FUNCTION public.store_kakaopay_ready(
  p_payment_order_id uuid,
  p_provider_transaction_id text,
  p_next_redirect_pc_url text,
  p_next_redirect_mobile_url text,
  p_next_redirect_app_url text,
  p_ready_stored_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_provider_transaction public.payment_provider_transactions%ROWTYPE;
BEGIN
  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  SELECT *
    INTO v_provider_transaction
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id
   FOR UPDATE;

  IF v_order.id IS NULL
     OR v_provider_transaction.id IS NULL
     OR v_order.provider <> 'kakaopay'
     OR v_order.status NOT IN ('ready_unknown', 'ready')
     OR v_provider_transaction.provider <> 'kakaopay'
     OR NULLIF(BTRIM(p_provider_transaction_id), '') IS NULL
     OR p_next_redirect_pc_url NOT LIKE 'https://%'
     OR p_next_redirect_mobile_url NOT LIKE 'https://%'
     OR p_next_redirect_app_url NOT LIKE 'https://%' THEN
    RAISE EXCEPTION 'KAKAOPAY_READY_RESULT_INVALID';
  END IF;

  IF v_provider_transaction.provider_transaction_id IS NOT NULL THEN
    IF v_provider_transaction.provider_transaction_id IS DISTINCT FROM p_provider_transaction_id THEN
      RAISE EXCEPTION 'KAKAOPAY_READY_RESULT_CONFLICT';
    END IF;

    RETURN jsonb_build_object('stored', false, 'status', v_order.status);
  END IF;

  UPDATE public.payment_provider_transactions
     SET provider_transaction_id = p_provider_transaction_id,
         provider_status = 'READY',
         next_redirect_pc_url = p_next_redirect_pc_url,
         next_redirect_mobile_url = p_next_redirect_mobile_url,
         next_redirect_app_url = p_next_redirect_app_url,
         ready_stored_at = p_ready_stored_at,
         updated_at = now()
   WHERE id = v_provider_transaction.id;

  UPDATE public.payment_orders
     SET status = 'ready',
         provider_status = 'READY',
         failure_code = NULL,
         failure_message = NULL,
         updated_at = now()
   WHERE id = v_order.id;

  RETURN jsonb_build_object('stored', true, 'status', 'ready');
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_kakaopay_callback(
  p_callback_state_hash text,
  p_callback_kind text,
  p_result_token_hash text,
  p_result_token_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_provider_transaction public.payment_provider_transactions%ROWTYPE;
BEGIN
  IF p_callback_kind NOT IN ('approve', 'cancel', 'fail')
     OR NULLIF(BTRIM(p_callback_state_hash), '') IS NULL
     OR NULLIF(BTRIM(p_result_token_hash), '') IS NULL
     OR p_result_token_expires_at <= now() THEN
    RAISE EXCEPTION 'KAKAOPAY_CALLBACK_INPUT_INVALID';
  END IF;

  SELECT *
    INTO v_provider_transaction
    FROM public.payment_provider_transactions
   WHERE callback_state_hash = p_callback_state_hash
     AND provider = 'kakaopay'
   FOR UPDATE;

  IF NOT FOUND
     OR v_provider_transaction.callback_state_consumed_at IS NOT NULL
     OR v_provider_transaction.callback_state_expires_at IS NULL
     OR v_provider_transaction.callback_state_expires_at <= now() THEN
    RAISE EXCEPTION 'KAKAOPAY_CALLBACK_STATE_INVALID';
  END IF;

  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = v_provider_transaction.payment_order_id
   FOR UPDATE;

  IF v_order.id IS NULL
     OR v_provider_transaction.id IS NULL
     OR v_order.provider <> 'kakaopay'
     OR v_order.status <> 'ready'
     OR v_order.ready_expires_at IS NULL
     OR v_order.ready_expires_at <= now()
     OR v_provider_transaction.provider_transaction_id IS NULL THEN
    RAISE EXCEPTION 'KAKAOPAY_CALLBACK_ORDER_INVALID';
  END IF;

  UPDATE public.payment_provider_transactions
     SET callback_state_consumed_at = now(),
         result_token_hash = p_result_token_hash,
         result_token_expires_at = p_result_token_expires_at,
         provider_status = CASE
           WHEN p_callback_kind = 'cancel' THEN 'QUIT_PAYMENT'
           WHEN p_callback_kind = 'fail' THEN 'FAIL_PAYMENT'
           ELSE provider_status
         END,
         updated_at = now()
   WHERE id = v_provider_transaction.id;

  IF p_callback_kind = 'approve' THEN
    UPDATE public.payment_orders
       SET status = 'confirming',
           confirm_expires_at = now() + interval '10 minutes',
           failure_code = NULL,
           failure_message = NULL,
           updated_at = now()
     WHERE id = v_order.id;
  ELSE
    UPDATE public.payment_orders
       SET status = 'failed',
           provider_status = CASE
             WHEN p_callback_kind = 'cancel' THEN 'QUIT_PAYMENT'
             ELSE 'FAIL_PAYMENT'
           END,
           failure_code = CASE
             WHEN p_callback_kind = 'cancel' THEN 'KAKAOPAY_USER_CANCELLED'
             ELSE 'KAKAOPAY_PROVIDER_FAILED'
           END,
           failure_message = CASE
             WHEN p_callback_kind = 'cancel' THEN '사용자가 카카오페이 결제를 취소했습니다.'
             ELSE '카카오페이 인증을 완료하지 못했습니다.'
           END,
           updated_at = now()
     WHERE id = v_order.id;

    UPDATE public.checkout_attempts
       SET status = 'cancelled',
           updated_at = now()
     WHERE id = v_order.checkout_attempt_id;
  END IF;

  RETURN jsonb_build_object(
    'payment_order_id', v_order.id,
    'order_id', v_order.order_id,
    'partner_order_id', v_order.partner_order_id,
    'partner_user_id', v_order.partner_user_id,
    'plan_name', v_order.plan_name_snapshot,
    'expected_amount', v_order.expected_amount,
    'expected_credits', v_order.expected_credits,
    'tax_free_amount', v_order.tax_free_amount,
    'vat_amount', v_order.vat_amount,
    'provider_merchant_id', v_order.provider_merchant_id,
    'provider_transaction_id', v_provider_transaction.provider_transaction_id,
    'callback_kind', p_callback_kind
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_kakaopay_approval(
  p_payment_order_id uuid,
  p_provider_transaction_id text,
  p_provider_approval_id text,
  p_provider_status text,
  p_payment_method_type text,
  p_approved_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_provider_transaction public.payment_provider_transactions%ROWTYPE;
BEGIN
  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  SELECT *
    INTO v_provider_transaction
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND
     OR v_order.provider <> 'kakaopay'
     OR v_order.status NOT IN ('confirming', 'fulfillment_pending', 'completed')
     OR v_provider_transaction.provider <> 'kakaopay'
     OR v_provider_transaction.provider_transaction_id IS DISTINCT FROM p_provider_transaction_id
     OR p_provider_status <> 'SUCCESS_PAYMENT'
     OR p_payment_method_type <> 'MONEY'
     OR NULLIF(BTRIM(p_provider_approval_id), '') IS NULL THEN
    RAISE EXCEPTION 'KAKAOPAY_APPROVAL_RESULT_INVALID';
  END IF;

  IF v_provider_transaction.provider_approval_id IS NOT NULL
     AND v_provider_transaction.provider_approval_id IS DISTINCT FROM p_provider_approval_id THEN
    RAISE EXCEPTION 'KAKAOPAY_APPROVAL_RESULT_CONFLICT';
  END IF;

  UPDATE public.payment_provider_transactions
     SET provider_approval_id = p_provider_approval_id,
         provider_status = p_provider_status,
         payment_method_type = p_payment_method_type,
         updated_at = now()
   WHERE id = v_provider_transaction.id;

  IF v_order.status <> 'completed' THEN
    UPDATE public.payment_orders
       SET status = 'fulfillment_pending',
           provider_status = p_provider_status,
           provider_method = '카카오페이머니',
           approved_at = p_approved_at,
           failure_code = NULL,
           failure_message = NULL,
           updated_at = now()
     WHERE id = v_order.id;
  END IF;

  RETURN jsonb_build_object(
    'payment_order_id', v_order.id,
    'already_completed', v_order.status = 'completed'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_kakaopay_callback_failure(
  p_payment_order_id uuid,
  p_failure_code text,
  p_failure_message text,
  p_manual_review boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.payment_orders%ROWTYPE;
BEGIN
  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND OR v_order.provider <> 'kakaopay' THEN
    RAISE EXCEPTION 'KAKAOPAY_ORDER_NOT_FOUND';
  END IF;

  IF v_order.status IN ('completed', 'refunded', 'failed', 'expired') THEN
    RETURN;
  END IF;

  UPDATE public.payment_orders
     SET status = CASE WHEN p_manual_review THEN 'manual_review' ELSE 'failed' END,
         failure_code = LEFT(COALESCE(p_failure_code, 'KAKAOPAY_CALLBACK_FAILED'), 100),
         failure_message = LEFT(COALESCE(p_failure_message, '카카오페이 결제 결과를 확인하지 못했습니다.'), 500),
         updated_at = now()
   WHERE id = v_order.id;

  UPDATE public.payment_provider_transactions
     SET last_error_code = LEFT(COALESCE(p_failure_code, 'KAKAOPAY_CALLBACK_FAILED'), 100),
         last_error_message = LEFT(COALESCE(p_failure_message, '카카오페이 결제 결과를 확인하지 못했습니다.'), 500),
         updated_at = now()
   WHERE payment_order_id = v_order.id;

  UPDATE public.checkout_attempts
     SET status = CASE WHEN p_manual_review THEN 'manual_review' ELSE 'cancelled' END,
         updated_at = now()
   WHERE id = v_order.checkout_attempt_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.begin_kakaopay_ready(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.store_kakaopay_ready(
  uuid, text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_kakaopay_callback(
  text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_kakaopay_approval(
  uuid, text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_kakaopay_callback_failure(
  uuid, text, text, boolean
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.begin_kakaopay_ready(uuid, text, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.store_kakaopay_ready(
  uuid, text, text, text, text, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_kakaopay_callback(
  text, text, text, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_kakaopay_approval(
  uuid, text, text, text, text, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_kakaopay_callback_failure(
  uuid, text, text, boolean
) TO service_role;
