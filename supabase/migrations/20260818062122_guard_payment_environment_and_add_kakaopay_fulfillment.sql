-- Guard fulfillment with the owner-managed runtime configuration and add the
-- direct KakaoPay MONEY fulfillment/refund database boundary.

CREATE OR REPLACE FUNCTION public.finalize_toss_payment(
  p_payment_order_id uuid,
  p_payment_key text,
  p_provider_method text,
  p_provider_status text,
  p_mid text,
  p_approved_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_runtime public.payment_runtime_config%ROWTYPE;
  v_source_id uuid;
  v_payment_history_id uuid;
  v_new_balance integer;
BEGIN
  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND';
  END IF;

  SELECT *
    INTO v_runtime
    FROM public.payment_runtime_config
   WHERE id = true;

  IF NOT FOUND
     OR v_runtime.accepted_provider_environment = 'disabled'
     OR v_order.provider_environment IS DISTINCT FROM
        v_runtime.accepted_provider_environment
     OR v_order.environment IS DISTINCT FROM
        v_runtime.accepted_provider_environment THEN
    RAISE EXCEPTION 'PAYMENT_RUNTIME_ENVIRONMENT_MISMATCH';
  END IF;

  IF v_order.provider <> 'toss'
     OR v_order.provider_merchant_id IS DISTINCT FROM p_mid
     OR v_order.mid IS DISTINCT FROM p_mid
     OR v_runtime.toss_merchant_id IS DISTINCT FROM p_mid THEN
    RAISE EXCEPTION 'PAYMENT_RUNTIME_MERCHANT_MISMATCH';
  END IF;

  IF v_order.status = 'completed' THEN
    IF v_order.payment_key IS DISTINCT FROM p_payment_key THEN
      RAISE EXCEPTION 'PAYMENT_ORDER_PAYLOAD_CONFLICT';
    END IF;

    SELECT credits
      INTO v_new_balance
      FROM public.profiles
     WHERE id = v_order.user_id;

    RETURN jsonb_build_object(
      'source_id', v_order.source_id,
      'payment_history_id', v_order.payment_history_id,
      'new_balance', v_new_balance,
      'credits', v_order.expected_credits,
      'already_completed', true
    );
  END IF;

  IF v_order.status <> 'fulfillment_pending'
     OR v_order.payment_key IS DISTINCT FROM p_payment_key
     OR p_provider_status <> 'DONE' THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_READY_FOR_FULFILLMENT';
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
    p_provider_method,
    p_payment_key,
    'completed',
    v_order.id,
    v_order.order_id,
    'toss',
    p_provider_status,
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
         provider_method = p_provider_method,
         provider_status = p_provider_status,
         approved_at = p_approved_at,
         fulfilled_at = now(),
         source_id = v_source_id,
         payment_history_id = v_payment_history_id,
         failure_code = NULL,
         failure_message = NULL
   WHERE id = v_order.id;

  UPDATE public.checkout_attempts
     SET status = 'completed',
         updated_at = now()
   WHERE id = v_order.checkout_attempt_id;

  RETURN jsonb_build_object(
    'source_id', v_source_id,
    'payment_history_id', v_payment_history_id,
    'new_balance', v_new_balance,
    'credits', v_order.expected_credits,
    'already_completed', false
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_toss_payment(
  uuid, text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_toss_payment(
  uuid, text, text, text, text, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_kakaopay_payment(
  p_payment_order_id uuid,
  p_provider_transaction_id text,
  p_provider_approval_id text,
  p_provider_status text,
  p_payment_method_type text,
  p_provider_merchant_id text,
  p_approved_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_runtime public.payment_runtime_config%ROWTYPE;
  v_provider_transaction public.payment_provider_transactions%ROWTYPE;
  v_source_id uuid;
  v_payment_history_id uuid;
  v_new_balance integer;
BEGIN
  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND';
  END IF;

  SELECT *
    INTO v_runtime
    FROM public.payment_runtime_config
   WHERE id = true;

  IF NOT FOUND
     OR v_runtime.accepted_provider_environment = 'disabled'
     OR v_order.provider_environment IS DISTINCT FROM
        v_runtime.accepted_provider_environment
     OR v_order.environment IS DISTINCT FROM
        v_runtime.accepted_provider_environment THEN
    RAISE EXCEPTION 'PAYMENT_RUNTIME_ENVIRONMENT_MISMATCH';
  END IF;

  IF v_order.provider <> 'kakaopay'
     OR v_order.provider_merchant_id IS DISTINCT FROM p_provider_merchant_id
     OR v_runtime.kakaopay_merchant_id IS DISTINCT FROM p_provider_merchant_id THEN
    RAISE EXCEPTION 'PAYMENT_RUNTIME_MERCHANT_MISMATCH';
  END IF;

  SELECT *
    INTO v_provider_transaction
    FROM public.payment_provider_transactions
   WHERE payment_order_id = v_order.id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_PROVIDER_TRANSACTION_NOT_FOUND';
  END IF;

  IF v_order.status = 'completed' THEN
    IF v_provider_transaction.provider_transaction_id IS DISTINCT FROM
         p_provider_transaction_id
       OR v_provider_transaction.provider_approval_id IS DISTINCT FROM
         p_provider_approval_id THEN
      RAISE EXCEPTION 'PAYMENT_ORDER_PAYLOAD_CONFLICT';
    END IF;

    SELECT credits
      INTO v_new_balance
      FROM public.profiles
     WHERE id = v_order.user_id;

    RETURN jsonb_build_object(
      'source_id', v_order.source_id,
      'payment_history_id', v_order.payment_history_id,
      'new_balance', v_new_balance,
      'credits', v_order.expected_credits,
      'already_completed', true
    );
  END IF;

  IF v_order.status <> 'fulfillment_pending'
     OR p_provider_status <> 'SUCCESS_PAYMENT'
     OR p_payment_method_type <> 'MONEY'
     OR v_provider_transaction.provider <> 'kakaopay'
     OR v_provider_transaction.provider_merchant_id IS DISTINCT FROM
        p_provider_merchant_id
     OR v_provider_transaction.provider_transaction_id IS DISTINCT FROM
        p_provider_transaction_id
     OR v_provider_transaction.provider_approval_id IS DISTINCT FROM
        p_provider_approval_id
     OR v_provider_transaction.provider_status IS DISTINCT FROM
        p_provider_status
     OR v_provider_transaction.payment_method_type IS DISTINCT FROM
        p_payment_method_type
     OR v_order.tax_free_amount <> 0
     OR v_order.vat_amount IS DISTINCT FROM
        round(v_order.expected_amount::numeric / 11)::integer THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_READY_FOR_FULFILLMENT';
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
    '카카오페이머니',
    NULL,
    'completed',
    v_order.id,
    v_order.order_id,
    'kakaopay',
    p_provider_status,
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
         provider_method = '카카오페이머니',
         provider_status = p_provider_status,
         approved_at = p_approved_at,
         fulfilled_at = now(),
         source_id = v_source_id,
         payment_history_id = v_payment_history_id,
         failure_code = NULL,
         failure_message = NULL
   WHERE id = v_order.id;

  UPDATE public.checkout_attempts
     SET status = 'completed',
         updated_at = now()
   WHERE id = v_order.checkout_attempt_id;

  RETURN jsonb_build_object(
    'source_id', v_source_id,
    'payment_history_id', v_payment_history_id,
    'new_balance', v_new_balance,
    'credits', v_order.expected_credits,
    'already_completed', false
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.finalize_kakaopay_payment(
  uuid, text, text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_kakaopay_payment(
  uuid, text, text, text, text, text, timestamptz
) TO service_role;

ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS provider text;

UPDATE public.refund_requests rr
   SET provider = COALESCE(po.provider, 'toss')
  FROM public.payment_orders po
 WHERE rr.payment_order_id = po.id
   AND rr.provider IS NULL;

UPDATE public.refund_requests
   SET provider = 'toss'
 WHERE provider IS NULL;

ALTER TABLE public.refund_requests
  ALTER COLUMN provider SET NOT NULL,
  DROP CONSTRAINT IF EXISTS refund_requests_provider_check,
  ADD CONSTRAINT refund_requests_provider_check
    CHECK (provider IN ('toss', 'kakaopay')) NOT VALID;

CREATE OR REPLACE FUNCTION public.get_point_charge_refund_eligibility(
  p_user_id uuid,
  p_source_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_refundable_until timestamptz;
BEGIN
  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = p_source_id
     AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_SOURCE_NOT_FOUND');
  END IF;

  IF v_source.payment_order_id IS NULL
     OR v_source.source_category <> 'plan_purchase' THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_PAID_SOURCE_REQUIRED');
  END IF;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_source.payment_order_id
     AND user_id = p_user_id;

  IF NOT FOUND
     OR v_order.status <> 'completed'
     OR v_order.approved_at IS NULL
     OR (
       v_order.provider = 'toss'
       AND v_order.payment_key IS NULL
     )
     OR (
       v_order.provider = 'kakaopay'
       AND NOT EXISTS (
         SELECT 1
           FROM public.payment_provider_transactions ppt
          WHERE ppt.payment_order_id = v_order.id
            AND ppt.provider = 'kakaopay'
            AND ppt.provider_transaction_id IS NOT NULL
            AND ppt.provider_approval_id IS NOT NULL
            AND ppt.provider_status = 'SUCCESS_PAYMENT'
            AND ppt.payment_method_type = 'MONEY'
       )
     ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_COMPLETED_PAYMENT_REQUIRED');
  END IF;

  v_refundable_until := v_order.approved_at + interval '7 days';

  IF v_source.status <> 'active' THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_SOURCE_NOT_ACTIVE',
      'refundable_until', v_refundable_until
    );
  END IF;

  IF v_source.remaining_credits <> v_source.initial_credits THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_CREDITS_ALREADY_USED',
      'refundable_until', v_refundable_until
    );
  END IF;

  IF v_source.expires_at IS NOT NULL AND v_source.expires_at <= now() THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_SOURCE_EXPIRED',
      'refundable_until', v_refundable_until
    );
  END IF;

  IF now() > v_refundable_until THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_REQUEST_PERIOD_EXPIRED',
      'refundable_until', v_refundable_until
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'reason_code', null,
    'provider', v_order.provider,
    'refundable_until', v_refundable_until
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_point_charge_refund(
  p_user_id uuid,
  p_source_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_eligibility jsonb;
  v_request_id uuid;
  v_refundable_until timestamptz;
BEGIN
  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = p_source_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_SOURCE_NOT_FOUND';
  END IF;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_source.payment_order_id
     AND user_id = p_user_id
   FOR UPDATE;

  v_eligibility := public.get_point_charge_refund_eligibility(
    p_user_id,
    p_source_id
  );

  IF COALESCE((v_eligibility->>'allowed')::boolean, false) = false THEN
    RAISE EXCEPTION '%', COALESCE(
      v_eligibility->>'reason_code',
      'REFUND_REQUEST_NOT_ALLOWED'
    );
  END IF;

  v_refundable_until := (v_eligibility->>'refundable_until')::timestamptz;

  INSERT INTO public.refund_requests (
    user_id,
    source_id,
    reason,
    status,
    payment_order_id,
    provider,
    refund_amount,
    cancel_idempotency_key
  ) VALUES (
    p_user_id,
    p_source_id,
    COALESCE(NULLIF(BTRIM(p_reason), ''), '사유 없음'),
    'pending_review',
    v_order.id,
    v_order.provider,
    v_order.expected_amount,
    v_order.cancel_idempotency_key
  )
  RETURNING id INTO v_request_id;

  UPDATE public.credit_sources
     SET status = 'pending_refund'
   WHERE id = v_source.id;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'provider', v_order.provider,
    'refund_amount', v_order.expected_amount,
    'refundable_until', v_refundable_until
  );
END;
$$;

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
       AND provider = 'kakaopay';

    IF NOT FOUND
       OR v_provider_transaction.provider_transaction_id IS NULL
       OR v_provider_transaction.provider_approval_id IS NULL THEN
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
    'payment_key', CASE WHEN v_order.provider = 'toss' THEN v_order.payment_key ELSE NULL END,
    'provider_transaction_id', v_provider_transaction.provider_transaction_id,
    'provider_merchant_id', v_order.provider_merchant_id,
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

  IF v_request.status NOT IN (
       'pending_review',
       'processing',
       'retryable_failed',
       'manual_review'
     )
     OR NULLIF(BTRIM(p_provider_cancel_transaction_key), '') IS NULL THEN
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

CREATE OR REPLACE FUNCTION public.fail_point_charge_refund(
  p_request_id uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.refund_requests
     SET status = CASE
           WHEN p_retryable THEN 'retryable_failed'
           ELSE 'manual_review'
         END,
         last_error_code = LEFT(p_error_code, 120),
         last_error_message = LEFT(p_error_message, 500),
         next_attempt_at = CASE
           WHEN p_retryable THEN now() + interval '15 minutes'
           ELSE NULL
         END
   WHERE id = p_request_id
     AND status = 'processing';
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_point_charge_refund(
  p_request_id uuid,
  p_admin_id uuid,
  p_admin_note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND OR v_request.status <> 'pending_review' THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_REJECTABLE';
  END IF;

  UPDATE public.credit_sources
     SET status = 'active'
   WHERE id = v_request.source_id
     AND status = 'pending_refund';

  UPDATE public.refund_requests
     SET status = 'rejected',
         admin_note = p_admin_note,
         processed_by = p_admin_id,
         processed_at = now()
   WHERE id = v_request.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_point_charge_refund_eligibility(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.request_point_charge_refund(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_point_charge_refund(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_point_charge_refund(uuid, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fail_point_charge_refund(uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_point_charge_refund(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_point_charge_refund_eligibility(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.request_point_charge_refund(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_point_charge_refund(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_point_charge_refund(uuid, text, timestamptz, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_point_charge_refund(uuid, text, text, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_point_charge_refund(uuid, uuid, text)
  TO service_role;
