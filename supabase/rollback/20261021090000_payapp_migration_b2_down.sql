-- 20261021090000_payapp_migration_b2 되돌리기.
-- 컬럼 2개를 B2 직전 값(true / 'tgen_docs')으로 되살리고, 토스 RPC 7개를 원래 마이그레이션 원문 그대로 다시 만든다.
--   finalize_toss_payment: 20260818062122_guard_payment_environment_and_add_kakaopay_fulfillment.sql
--   나머지 6개: 20260805120000_create_toss_refund_workflow.sql
-- prepare_payment_order와 환불 자격·claim 함수는 B2 직전 정의(20261019090000_payapp_migration_a.sql)로 되돌린다.
-- 각 함수 본문 md5는 B2 직전 운영 DB의 md5(prosrc)와 같다(2026-10-21 확인).
-- 순서: 토스 결제 코드를 다시 배포해야 할 때만 쓴다. 코드보다 먼저 실행한다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.payment_runtime_config
  ADD COLUMN toss_accepts_new_orders boolean NOT NULL DEFAULT false,
  ADD COLUMN toss_merchant_id text;

UPDATE public.payment_runtime_config
   SET toss_accepts_new_orders = true,
       toss_merchant_id = 'tgen_docs'
 WHERE id;

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

CREATE OR REPLACE FUNCTION public.get_toss_refund_eligibility(
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
  SELECT *
    INTO v_source
    FROM public.credit_sources
   WHERE id = p_source_id
     AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_SOURCE_NOT_FOUND'
    );
  END IF;

  IF v_source.payment_order_id IS NULL
     OR v_source.source_category <> 'plan_purchase' THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_PAID_SOURCE_REQUIRED'
    );
  END IF;

  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = v_source.payment_order_id
     AND user_id = p_user_id;

  IF NOT FOUND
     OR v_order.status <> 'completed'
     OR v_order.payment_key IS NULL
     OR v_order.approved_at IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_COMPLETED_TOSS_PAYMENT_REQUIRED'
    );
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
    'refundable_until', v_refundable_until
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.request_toss_refund(
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
  v_request_id uuid;
  v_refundable_until timestamptz;
BEGIN
  SELECT *
    INTO v_source
    FROM public.credit_sources
   WHERE id = p_source_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_SOURCE_NOT_FOUND';
  END IF;

  IF v_source.payment_order_id IS NULL
     OR v_source.source_category <> 'plan_purchase' THEN
    RAISE EXCEPTION 'REFUND_PAID_SOURCE_REQUIRED';
  END IF;

  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = v_source.payment_order_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND
     OR v_order.status <> 'completed'
     OR v_order.payment_key IS NULL
     OR v_order.approved_at IS NULL THEN
    RAISE EXCEPTION 'REFUND_COMPLETED_TOSS_PAYMENT_REQUIRED';
  END IF;

  v_refundable_until := v_order.approved_at + interval '7 days';

  IF v_source.status <> 'active' THEN
    RAISE EXCEPTION 'REFUND_SOURCE_NOT_ACTIVE';
  END IF;

  IF v_source.remaining_credits <> v_source.initial_credits THEN
    RAISE EXCEPTION 'REFUND_CREDITS_ALREADY_USED';
  END IF;

  IF v_source.expires_at IS NOT NULL AND v_source.expires_at <= now() THEN
    RAISE EXCEPTION 'REFUND_SOURCE_EXPIRED';
  END IF;

  IF now() > v_refundable_until THEN
    RAISE EXCEPTION 'REFUND_REQUEST_PERIOD_EXPIRED';
  END IF;

  INSERT INTO public.refund_requests (
    user_id,
    source_id,
    reason,
    status,
    payment_order_id,
    refund_amount,
    cancel_idempotency_key
  ) VALUES (
    p_user_id,
    p_source_id,
    COALESCE(NULLIF(BTRIM(p_reason), ''), '사유 없음'),
    'pending_review',
    v_order.id,
    v_order.expected_amount,
    v_order.cancel_idempotency_key
  )
  RETURNING id INTO v_request_id;

  UPDATE public.credit_sources
     SET status = 'pending_refund'
   WHERE id = v_source.id;

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'refund_amount', v_order.expected_amount,
    'refundable_until', v_refundable_until
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_toss_refund(
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
BEGIN
  SELECT *
    INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_FOUND';
  END IF;

  IF v_request.status = 'completed' THEN
    RETURN jsonb_build_object(
      'already_completed', true,
      'request_id', v_request.id
    );
  END IF;

  IF v_request.status NOT IN ('pending_review', 'retryable_failed') THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_CLAIMABLE';
  END IF;

  SELECT *
    INTO v_source
    FROM public.credit_sources
   WHERE id = v_request.source_id
   FOR UPDATE;

  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = v_request.payment_order_id
   FOR UPDATE;

  IF v_source.status <> 'pending_refund'
     OR v_source.remaining_credits <> v_source.initial_credits
     OR v_order.status <> 'completed'
     OR v_order.payment_key IS NULL THEN
    RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
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
    'payment_order_id', v_order.id,
    'payment_key', v_order.payment_key,
    'cancel_idempotency_key', v_request.cancel_idempotency_key,
    'refund_amount', v_request.refund_amount
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_toss_refund(
  p_request_id uuid,
  p_cancel_transaction_key text,
  p_cancelled_at timestamptz
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
  SELECT *
    INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_FOUND';
  END IF;

  IF v_request.status = 'completed' THEN
    SELECT credits
      INTO v_new_balance
      FROM public.profiles
     WHERE id = v_request.user_id;

    RETURN jsonb_build_object(
      'already_completed', true,
      'new_balance', v_new_balance
    );
  END IF;

  IF v_request.status NOT IN (
       'pending_review',
       'processing',
       'retryable_failed',
       'manual_review'
     )
     OR NULLIF(BTRIM(p_cancel_transaction_key), '') IS NULL THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_READY_TO_FINALIZE';
  END IF;

  SELECT *
    INTO v_source
    FROM public.credit_sources
   WHERE id = v_request.source_id
   FOR UPDATE;

  SELECT *
    INTO v_order
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
         provider_status = 'CANCELED',
         canceled_at = p_cancelled_at
   WHERE id = v_order.id;

  UPDATE public.payment_history
     SET status = 'refunded',
         provider_status = 'CANCELED'
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
         provider_cancel_transaction_key = p_cancel_transaction_key,
         provider_cancelled_at = p_cancelled_at,
         processed_at = now(),
         next_attempt_at = NULL,
         last_error_code = NULL,
         last_error_message = NULL
   WHERE id = v_request.id;

  RETURN jsonb_build_object(
    'already_completed', false,
    'new_balance', v_new_balance
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_toss_refund(
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

CREATE OR REPLACE FUNCTION public.reject_toss_refund(
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
  SELECT *
    INTO v_request
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

REVOKE ALL ON FUNCTION public.finalize_toss_payment(uuid, text, text, text, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_toss_payment(uuid, text, text, text, text, timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.get_toss_refund_eligibility(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_toss_refund_eligibility(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.request_toss_refund(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_toss_refund(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.claim_toss_refund(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_toss_refund(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_toss_refund(uuid, text, timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_toss_refund(uuid, text, timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.fail_toss_refund(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_toss_refund(uuid, text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.reject_toss_refund(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_toss_refund(uuid, uuid, text) TO service_role;

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
  p_expires_at timestamp with time zone,
  p_tax_free_amount integer,
  p_vat_amount integer,
  p_partner_user_id text,
  p_payment_method_code text DEFAULT NULL
)
 RETURNS payment_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
BEGIN
  IF p_provider NOT IN ('toss', 'kakaopay', 'payapp')
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
     OR (p_provider IN ('toss', 'kakaopay') AND p_payment_method_code IS NOT NULL
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
$function$;

CREATE OR REPLACE FUNCTION public.get_point_charge_refund_eligibility(p_user_id uuid, p_source_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
     )
     OR (
       v_order.provider = 'payapp'
       AND NOT EXISTS (
         SELECT 1
           FROM public.payment_provider_transactions ppt
          WHERE ppt.payment_order_id = v_order.id
            AND ppt.provider = 'payapp'
            AND ppt.provider_transaction_id IS NOT NULL
            AND (ppt.paid_feedback_recorded_at IS NOT NULL OR ppt.admin_paid_confirmed_at IS NOT NULL)
            AND ppt.cancel_feedback_recorded_at IS NULL
            AND ppt.partial_cancel_feedback_recorded_at IS NULL
       )
     ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_COMPLETED_PAYMENT_REQUIRED');
  END IF;

  v_refundable_until := v_order.approved_at + interval '7 days';

  IF v_source.status <> 'active'
     OR EXISTS (
       SELECT 1
         FROM public.refund_requests rr
        WHERE rr.source_id = v_source.id
          AND rr.status = 'completed'
     ) THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.claim_point_charge_refund(p_request_id uuid, p_admin_id uuid, p_admin_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  IF v_order.provider = 'payapp' THEN
    SELECT * INTO v_provider_transaction
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
       AND provider = 'payapp'
     FOR UPDATE;

    IF NOT FOUND
       OR v_provider_transaction.provider_transaction_id IS NULL
       OR (v_provider_transaction.paid_feedback_recorded_at IS NULL
           AND v_provider_transaction.admin_paid_confirmed_at IS NULL)
       OR v_provider_transaction.cancel_feedback_recorded_at IS NOT NULL
       OR v_provider_transaction.partial_cancel_feedback_recorded_at IS NOT NULL THEN
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
$function$;

REVOKE ALL ON FUNCTION public.prepare_payment_order(uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text, timestamp with time zone, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_payment_order(uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text, timestamp with time zone, integer, integer, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.get_point_charge_refund_eligibility(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_point_charge_refund_eligibility(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.claim_point_charge_refund(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_point_charge_refund(uuid, uuid, text) TO service_role;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.payment_runtime_config
       WHERE toss_accepts_new_orders AND toss_merchant_id = 'tgen_docs') <> 1 THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: toss runtime columns';
  END IF;

  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'finalize_toss_payment') IS DISTINCT FROM '6d08e97308f7e15bd3ce9230b5036f4b' THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: finalize_toss_payment body';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_toss_refund_eligibility') IS DISTINCT FROM 'a5434364015642d4fc69ec28a79d45df' THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: get_toss_refund_eligibility body';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'request_toss_refund') IS DISTINCT FROM 'f3a3b6a48414ce81d4d050751093a8f6' THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: request_toss_refund body';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'claim_toss_refund') IS DISTINCT FROM '8881ccbf734964973b2f5d8a20281895' THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: claim_toss_refund body';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'finalize_toss_refund') IS DISTINCT FROM '933eeb3f58395ce5cc473835f768e018' THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: finalize_toss_refund body';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fail_toss_refund') IS DISTINCT FROM '3ffe3d3dfcc13d7e5f3df47efd503451' THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: fail_toss_refund body';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'reject_toss_refund') IS DISTINCT FROM 'c0815767558057f20a6955c831ca32d1' THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: reject_toss_refund body';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'prepare_payment_order') IS DISTINCT FROM 'c8b8327d77a0778716992d3631581b60' THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: prepare_payment_order body';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_point_charge_refund_eligibility') IS DISTINCT FROM '518ececf91647d74233fc6d7c88a9fb0' THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: get_point_charge_refund_eligibility body';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'claim_point_charge_refund') IS DISTINCT FROM '3d77f6bb965b7349a337ee0a36cc8f3a' THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: claim_point_charge_refund body';
  END IF;

  IF (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'finalize_toss_payment') <> 1
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.finalize_toss_payment(uuid, text, text, text, text, timestamp with time zone)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.finalize_toss_payment(uuid, text, text, text, text, timestamp with time zone)'::regprocedure)
     OR NOT (SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
               FROM pg_proc WHERE oid = 'public.finalize_toss_payment(uuid, text, text, text, text, timestamp with time zone)'::regprocedure) THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: finalize_toss_payment overload or privileges';
  END IF;

  IF (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_toss_refund_eligibility') <> 1
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.get_toss_refund_eligibility(uuid, uuid)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_toss_refund_eligibility(uuid, uuid)'::regprocedure)
     OR NOT (SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
               FROM pg_proc WHERE oid = 'public.get_toss_refund_eligibility(uuid, uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: get_toss_refund_eligibility overload or privileges';
  END IF;

  IF (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'request_toss_refund') <> 1
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.request_toss_refund(uuid, uuid, text)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.request_toss_refund(uuid, uuid, text)'::regprocedure)
     OR NOT (SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
               FROM pg_proc WHERE oid = 'public.request_toss_refund(uuid, uuid, text)'::regprocedure) THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: request_toss_refund overload or privileges';
  END IF;

  IF (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'claim_toss_refund') <> 1
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.claim_toss_refund(uuid, uuid, text)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.claim_toss_refund(uuid, uuid, text)'::regprocedure)
     OR NOT (SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
               FROM pg_proc WHERE oid = 'public.claim_toss_refund(uuid, uuid, text)'::regprocedure) THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: claim_toss_refund overload or privileges';
  END IF;

  IF (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'finalize_toss_refund') <> 1
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.finalize_toss_refund(uuid, text, timestamp with time zone)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.finalize_toss_refund(uuid, text, timestamp with time zone)'::regprocedure)
     OR NOT (SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
               FROM pg_proc WHERE oid = 'public.finalize_toss_refund(uuid, text, timestamp with time zone)'::regprocedure) THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: finalize_toss_refund overload or privileges';
  END IF;

  IF (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'fail_toss_refund') <> 1
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.fail_toss_refund(uuid, text, text, boolean)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fail_toss_refund(uuid, text, text, boolean)'::regprocedure)
     OR NOT (SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
               FROM pg_proc WHERE oid = 'public.fail_toss_refund(uuid, text, text, boolean)'::regprocedure) THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: fail_toss_refund overload or privileges';
  END IF;

  IF (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'reject_toss_refund') <> 1
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.reject_toss_refund(uuid, uuid, text)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.reject_toss_refund(uuid, uuid, text)'::regprocedure)
     OR NOT (SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
               FROM pg_proc WHERE oid = 'public.reject_toss_refund(uuid, uuid, text)'::regprocedure) THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: reject_toss_refund overload or privileges';
  END IF;

  IF (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'prepare_payment_order') <> 1
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.prepare_payment_order(uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text, timestamp with time zone, integer, integer, text, text)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.prepare_payment_order(uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text, timestamp with time zone, integer, integer, text, text)'::regprocedure)
     OR NOT (SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
               FROM pg_proc WHERE oid = 'public.prepare_payment_order(uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text, timestamp with time zone, integer, integer, text, text)'::regprocedure) THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: prepare_payment_order overload or privileges';
  END IF;

  IF (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_point_charge_refund_eligibility') <> 1
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.get_point_charge_refund_eligibility(uuid, uuid)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_point_charge_refund_eligibility(uuid, uuid)'::regprocedure)
     OR NOT (SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
               FROM pg_proc WHERE oid = 'public.get_point_charge_refund_eligibility(uuid, uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: get_point_charge_refund_eligibility overload or privileges';
  END IF;

  IF (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'claim_point_charge_refund') <> 1
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.claim_point_charge_refund(uuid, uuid, text)'::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.claim_point_charge_refund(uuid, uuid, text)'::regprocedure)
     OR NOT (SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
               FROM pg_proc WHERE oid = 'public.claim_point_charge_refund(uuid, uuid, text)'::regprocedure) THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: claim_point_charge_refund overload or privileges';
  END IF;

END;
$$;

NOTIFY pgrst, 'reload schema';
