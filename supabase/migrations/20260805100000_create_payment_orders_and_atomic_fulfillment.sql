-- Toss point-charge orders are created from server-owned pricing snapshots.
-- The payment provider approval and local credit fulfillment are linked 1:1.

CREATE TABLE IF NOT EXISTS public.payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  order_id text NOT NULL UNIQUE,
  plan_id uuid REFERENCES public.pricing_plans(id) ON DELETE SET NULL,
  plan_name_snapshot text NOT NULL,
  expected_amount integer NOT NULL
    CHECK (expected_amount BETWEEN 1 AND 100000),
  expected_credits integer NOT NULL
    CHECK (expected_credits > 0),
  provider text NOT NULL DEFAULT 'toss'
    CHECK (provider = 'toss'),
  environment text NOT NULL
    CHECK (environment IN ('test', 'live')),
  mid text NOT NULL,
  payment_key text UNIQUE,
  provider_method text,
  provider_status text,
  status text NOT NULL DEFAULT 'ready'
    CHECK (
      status IN (
        'ready',
        'confirming',
        'fulfillment_pending',
        'completed',
        'cancel_pending',
        'refunded',
        'failed',
        'manual_review'
      )
    ),
  confirm_idempotency_key text NOT NULL UNIQUE,
  cancel_idempotency_key text NOT NULL UNIQUE,
  failure_code text,
  failure_message text,
  source_id uuid,
  payment_history_id uuid,
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  fulfilled_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_orders IS
  '서버가 생성한 토스 포인트 충전 주문과 승인·지급 처리 상태';

CREATE INDEX IF NOT EXISTS idx_payment_orders_user_created
  ON public.payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status_updated
  ON public.payment_orders(status, updated_at);

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own payment orders"
  ON public.payment_orders;
CREATE POLICY "Users can view own payment orders"
  ON public.payment_orders
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.payment_orders
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payment_orders TO authenticated;
GRANT ALL ON TABLE public.payment_orders TO service_role;

ALTER TABLE public.credit_sources
  ADD COLUMN IF NOT EXISTS payment_order_id uuid;
ALTER TABLE public.payment_history
  ADD COLUMN IF NOT EXISTS payment_order_id uuid,
  ADD COLUMN IF NOT EXISTS order_id text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

ALTER TABLE public.payment_orders
  DROP CONSTRAINT IF EXISTS payment_orders_source_id_fkey,
  ADD CONSTRAINT payment_orders_source_id_fkey
    FOREIGN KEY (source_id) REFERENCES public.credit_sources(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS payment_orders_payment_history_id_fkey,
  ADD CONSTRAINT payment_orders_payment_history_id_fkey
    FOREIGN KEY (payment_history_id) REFERENCES public.payment_history(id) ON DELETE RESTRICT;

ALTER TABLE public.credit_sources
  DROP CONSTRAINT IF EXISTS credit_sources_payment_order_id_fkey,
  ADD CONSTRAINT credit_sources_payment_order_id_fkey
    FOREIGN KEY (payment_order_id) REFERENCES public.payment_orders(id) ON DELETE RESTRICT;
ALTER TABLE public.payment_history
  DROP CONSTRAINT IF EXISTS payment_history_payment_order_id_fkey,
  ADD CONSTRAINT payment_history_payment_order_id_fkey
    FOREIGN KEY (payment_order_id) REFERENCES public.payment_orders(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS credit_sources_payment_order_id_key
  ON public.credit_sources(payment_order_id)
  WHERE payment_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_history_payment_order_id_key
  ON public.payment_history(payment_order_id)
  WHERE payment_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_history_order_id_key
  ON public.payment_history(order_id)
  WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_history_payment_key_key
  ON public.payment_history(payment_key)
  WHERE payment_key IS NOT NULL;

ALTER TABLE public.pricing_plans
  DROP CONSTRAINT IF EXISTS pricing_plans_price_charge_limit,
  ADD CONSTRAINT pricing_plans_price_charge_limit
    CHECK (price BETWEEN 1 AND 100000) NOT VALID;
ALTER TABLE public.payment_history
  DROP CONSTRAINT IF EXISTS payment_history_amount_charge_limit,
  ADD CONSTRAINT payment_history_amount_charge_limit
    CHECK (amount BETWEEN 0 AND 100000) NOT VALID;

DROP TRIGGER IF EXISTS update_payment_orders_updated_at
  ON public.payment_orders;
CREATE TRIGGER update_payment_orders_updated_at
  BEFORE UPDATE ON public.payment_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

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
     OR p_provider_status <> 'DONE'
     OR v_order.mid IS DISTINCT FROM p_mid THEN
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
