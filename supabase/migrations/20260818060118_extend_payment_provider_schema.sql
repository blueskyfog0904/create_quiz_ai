-- Additive payment-provider boundary for Toss and direct KakaoPay.
-- Existing Toss columns remain during the compatibility window.

CREATE TABLE public.payment_runtime_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  accepted_provider_environment text NOT NULL DEFAULT 'disabled'
    CHECK (accepted_provider_environment IN ('disabled', 'test', 'live')),
  master_accepts_new_orders boolean NOT NULL DEFAULT false,
  toss_accepts_new_orders boolean NOT NULL DEFAULT false,
  kakaopay_accepts_new_orders boolean NOT NULL DEFAULT false,
  toss_merchant_id text,
  kakaopay_merchant_id text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text NOT NULL,
  change_ticket text NOT NULL
);

COMMENT ON TABLE public.payment_runtime_config IS
  'Migration-owner managed payment runtime gate. The application service role is read-only.';

ALTER TABLE public.payment_runtime_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_runtime_config
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.payment_runtime_config TO service_role;

INSERT INTO public.payment_runtime_config (
  id,
  accepted_provider_environment,
  master_accepts_new_orders,
  toss_accepts_new_orders,
  kakaopay_accepts_new_orders,
  toss_merchant_id,
  kakaopay_merchant_id,
  changed_by,
  change_ticket
)
SELECT
  true,
  'test',
  true,
  true,
  false,
  (
    SELECT po.mid
      FROM public.payment_orders po
     WHERE po.environment = 'test'
     ORDER BY po.created_at DESC
     LIMIT 1
  ),
  'TC0ONETIME',
  'migration_owner',
  'PRELAUNCH_SHARED_TEST_RUNTIME'
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.checkout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  checkout_attempt_id uuid NOT NULL,
  claimed_provider text NOT NULL
    CHECK (claimed_provider IN ('toss', 'kakaopay')),
  plan_id uuid NOT NULL REFERENCES public.pricing_plans(id) ON DELETE RESTRICT,
  request_fingerprint text NOT NULL,
  payment_order_id uuid UNIQUE,
  status text NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed', 'completed', 'cancelled', 'expired', 'manual_review')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, checkout_attempt_id)
);

COMMENT ON TABLE public.checkout_attempts IS
  'One immutable user checkout attempt claimed by exactly one provider and request fingerprint.';

ALTER TABLE public.checkout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkout_attempts
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.checkout_attempts TO service_role;

ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS checkout_attempt_id uuid,
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS provider_environment text,
  ADD COLUMN IF NOT EXISTS provider_merchant_id text,
  ADD COLUMN IF NOT EXISTS partner_order_id text,
  ADD COLUMN IF NOT EXISTS partner_user_id text,
  ADD COLUMN IF NOT EXISTS tax_free_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount integer,
  ADD COLUMN IF NOT EXISTS checkout_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirm_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconcile_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_reconcile_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reconcile_error_code text,
  ADD COLUMN IF NOT EXISTS last_reconcile_error_message text;

UPDATE public.payment_orders
   SET provider_environment = environment,
       provider_merchant_id = mid,
       tax_free_amount = 0,
       checkout_expires_at = expires_at
 WHERE provider_environment IS NULL
    OR provider_merchant_id IS NULL
    OR checkout_expires_at IS NULL;

ALTER TABLE public.payment_orders
  ALTER COLUMN provider_environment SET NOT NULL,
  ALTER COLUMN provider_merchant_id SET NOT NULL,
  ALTER COLUMN checkout_expires_at SET NOT NULL,
  ALTER COLUMN mid DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS payment_orders_provider_check,
  ADD CONSTRAINT payment_orders_provider_check
    CHECK (provider IN ('toss', 'kakaopay')) NOT VALID,
  DROP CONSTRAINT IF EXISTS payment_orders_status_check,
  ADD CONSTRAINT payment_orders_status_check
    CHECK (
      status IN (
        'preparing',
        'ready_unknown',
        'ready',
        'confirming',
        'fulfillment_pending',
        'completed',
        'cancel_pending',
        'refunded',
        'failed',
        'expired',
        'manual_review'
      )
    ) NOT VALID,
  DROP CONSTRAINT IF EXISTS payment_orders_provider_environment_check,
  ADD CONSTRAINT payment_orders_provider_environment_check
    CHECK (provider_environment IN ('test', 'live')) NOT VALID,
  DROP CONSTRAINT IF EXISTS payment_orders_tax_snapshot_check,
  ADD CONSTRAINT payment_orders_tax_snapshot_check
    CHECK (
      tax_free_amount BETWEEN 0 AND expected_amount
      AND (vat_amount IS NULL OR vat_amount BETWEEN 0 AND expected_amount)
    ) NOT VALID,
  DROP CONSTRAINT IF EXISTS payment_orders_provider_snapshot_check,
  ADD CONSTRAINT payment_orders_provider_snapshot_check
    CHECK (
      provider_environment = environment
      AND (
        (
          provider = 'toss'
          AND mid IS NOT NULL
          AND provider_merchant_id = mid
        )
        OR (
          provider = 'kakaopay'
          AND mid IS NULL
          AND tax_free_amount = 0
          AND vat_amount = round(expected_amount::numeric / 11)::integer
        )
      )
    ) NOT VALID,
  DROP CONSTRAINT IF EXISTS payment_orders_checkout_attempt_id_fkey,
  ADD CONSTRAINT payment_orders_checkout_attempt_id_fkey
    FOREIGN KEY (checkout_attempt_id)
    REFERENCES public.checkout_attempts(id)
    ON DELETE RESTRICT;

ALTER TABLE public.checkout_attempts
  DROP CONSTRAINT IF EXISTS checkout_attempts_payment_order_id_fkey,
  ADD CONSTRAINT checkout_attempts_payment_order_id_fkey
    FOREIGN KEY (payment_order_id)
    REFERENCES public.payment_orders(id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_checkout_attempt_id_key
  ON public.payment_orders(checkout_attempt_id)
  WHERE checkout_attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_orders_reconciliation
  ON public.payment_orders(status, next_reconcile_at, updated_at);

CREATE TABLE public.payment_provider_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_order_id uuid NOT NULL UNIQUE
    REFERENCES public.payment_orders(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('toss', 'kakaopay')),
  provider_merchant_id text NOT NULL,
  provider_transaction_id text,
  provider_approval_id text,
  provider_status text,
  payment_method_type text,
  callback_state_hash text,
  callback_state_expires_at timestamptz,
  callback_state_consumed_at timestamptz,
  result_token_hash text,
  result_token_expires_at timestamptz,
  next_redirect_pc_url text,
  next_redirect_mobile_url text,
  next_redirect_app_url text,
  ready_stored_at timestamptz,
  reconcile_attempt_count integer NOT NULL DEFAULT 0,
  next_reconcile_at timestamptz,
  last_reconciled_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_provider_transactions IS
  'Private provider identifiers and callback capabilities. Browser roles have no direct access.';

CREATE UNIQUE INDEX payment_provider_transactions_provider_transaction_key
  ON public.payment_provider_transactions(provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX payment_provider_transactions_provider_approval_key
  ON public.payment_provider_transactions(provider, provider_approval_id)
  WHERE provider_approval_id IS NOT NULL;
CREATE UNIQUE INDEX payment_provider_transactions_callback_state_key
  ON public.payment_provider_transactions(callback_state_hash)
  WHERE callback_state_hash IS NOT NULL;
CREATE UNIQUE INDEX payment_provider_transactions_result_token_key
  ON public.payment_provider_transactions(result_token_hash)
  WHERE result_token_hash IS NOT NULL;

ALTER TABLE public.payment_provider_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_provider_transactions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.payment_provider_transactions TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_payment_order_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
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
     OR NEW.ready_expires_at IS DISTINCT FROM OLD.ready_expires_at THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_IMMUTABLE_SNAPSHOT';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_payment_order_snapshot_update
  ON public.payment_orders;
CREATE TRIGGER prevent_payment_order_snapshot_update
  BEFORE UPDATE ON public.payment_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_payment_order_snapshot_update();

CREATE OR REPLACE FUNCTION public.prevent_payment_provider_identifier_replacement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (OLD.provider_transaction_id IS NOT NULL
      AND NEW.provider_transaction_id IS DISTINCT FROM OLD.provider_transaction_id)
     OR (OLD.provider_approval_id IS NOT NULL
         AND NEW.provider_approval_id IS DISTINCT FROM OLD.provider_approval_id)
     OR (OLD.callback_state_hash IS NOT NULL
         AND NEW.callback_state_hash IS DISTINCT FROM OLD.callback_state_hash)
     OR (OLD.result_token_hash IS NOT NULL
         AND NEW.result_token_hash IS DISTINCT FROM OLD.result_token_hash) THEN
    RAISE EXCEPTION 'PAYMENT_PROVIDER_IDENTIFIER_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_payment_provider_identifier_replacement
  BEFORE UPDATE ON public.payment_provider_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_payment_provider_identifier_replacement();

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
  p_vat_amount integer
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
     OR p_expires_at <= now() THEN
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
    tax_free_amount,
    vat_amount,
    status,
    request_fingerprint,
    checkout_attempt_id,
    confirm_idempotency_key,
    cancel_idempotency_key,
    expires_at,
    checkout_expires_at
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
    p_tax_free_amount,
    p_vat_amount,
    'ready',
    p_request_fingerprint,
    v_attempt.id,
    p_confirm_idempotency_key,
    p_cancel_idempotency_key,
    p_expires_at,
    p_expires_at
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
  text, text, text, timestamptz, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_payment_order(
  uuid, uuid, text, uuid, text, text, integer, integer, text, text,
  text, text, text, timestamptz, integer, integer
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_payment_history()
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  amount integer,
  status text,
  payment_method text,
  order_id text,
  provider text,
  provider_status text,
  approved_at timestamptz,
  plan_id uuid,
  plan_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    ph.id,
    ph.created_at,
    ph.amount,
    ph.status,
    ph.payment_method,
    ph.order_id,
    ph.provider,
    ph.provider_status,
    ph.approved_at,
    ph.plan_id,
    pp.name
  FROM public.payment_history ph
  LEFT JOIN public.pricing_plans pp ON pp.id = ph.plan_id
  WHERE ph.user_id = (SELECT auth.uid())
    AND ph.amount > 0
    AND ph.plan_id IS NOT NULL
  ORDER BY ph.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_my_refund_requests()
RETURNS TABLE (
  id uuid,
  source_id uuid,
  reason text,
  status text,
  refund_amount integer,
  processed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    rr.id,
    rr.source_id,
    rr.reason,
    rr.status,
    rr.refund_amount,
    rr.processed_at,
    rr.created_at,
    rr.updated_at
  FROM public.refund_requests rr
  WHERE rr.user_id = (SELECT auth.uid())
  ORDER BY rr.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_payment_history()
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_refund_requests()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_payment_history()
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_refund_requests()
  TO authenticated;

DROP POLICY IF EXISTS "Users can view own payment orders"
  ON public.payment_orders;
DROP POLICY IF EXISTS "Users can view own payments"
  ON public.payment_history;
DROP POLICY IF EXISTS "Users can view own refund requests"
  ON public.refund_requests;

REVOKE ALL ON TABLE public.payment_orders
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.payment_history
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.refund_requests
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.payment_orders TO service_role;
GRANT ALL ON TABLE public.payment_history TO service_role;
GRANT ALL ON TABLE public.refund_requests TO service_role;
