ALTER TABLE public.refund_requests
  DROP CONSTRAINT IF EXISTS refund_requests_status_check;

UPDATE public.refund_requests
   SET status = CASE status
     WHEN 'pending' THEN 'pending_review'
     WHEN 'approved' THEN 'completed'
     ELSE status
   END
 WHERE status IN ('pending', 'approved');

ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS payment_order_id uuid,
  ADD COLUMN IF NOT EXISTS refund_amount integer,
  ADD COLUMN IF NOT EXISTS cancel_idempotency_key text,
  ADD COLUMN IF NOT EXISTS provider_cancel_transaction_key text,
  ADD COLUMN IF NOT EXISTS provider_cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS last_error_message text;

ALTER TABLE public.refund_requests
  ADD CONSTRAINT refund_requests_status_check
    CHECK (
      status IN (
        'pending_review',
        'processing',
        'completed',
        'rejected',
        'retryable_failed',
        'manual_review'
      )
    ),
  DROP CONSTRAINT IF EXISTS refund_requests_payment_order_id_fkey,
  ADD CONSTRAINT refund_requests_payment_order_id_fkey
    FOREIGN KEY (payment_order_id)
    REFERENCES public.payment_orders(id)
    ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS refund_requests_refund_amount_check,
  ADD CONSTRAINT refund_requests_refund_amount_check
    CHECK (refund_amount IS NULL OR refund_amount BETWEEN 1 AND 100000);

CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_one_open_source
  ON public.refund_requests(source_id)
  WHERE status IN (
    'pending_review',
    'processing',
    'retryable_failed',
    'manual_review'
  );
CREATE UNIQUE INDEX IF NOT EXISTS refund_requests_cancel_idempotency_key
  ON public.refund_requests(cancel_idempotency_key)
  WHERE cancel_idempotency_key IS NOT NULL;

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

REVOKE EXECUTE ON FUNCTION public.request_toss_refund(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_toss_refund_eligibility(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_toss_refund(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_toss_refund(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fail_toss_refund(uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_toss_refund(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.request_toss_refund(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_toss_refund_eligibility(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_toss_refund(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_toss_refund(uuid, text, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_toss_refund(uuid, text, text, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_toss_refund(uuid, uuid, text)
  TO service_role;
