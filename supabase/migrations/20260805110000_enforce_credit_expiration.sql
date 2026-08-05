-- New paid sources already receive approved_at + 1 year in finalize_toss_payment.
-- Legacy paid source backfill requires a separate approved migration because
-- applying an unconfirmed policy could immediately expire existing balances.

CREATE OR REPLACE FUNCTION public.get_credit_balance_snapshot(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_profile_balance integer := 0;
  v_ledger_balance integer := 0;
  v_spendable_balance integer := 0;
  v_expired_balance integer := 0;
  v_latest_transaction_balance integer;
  v_next_expiration_at timestamptz;
BEGIN
  SELECT COALESCE(credits, 0)
    INTO v_profile_balance
    FROM public.profiles
   WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CREDIT_USER_NOT_FOUND';
  END IF;

  SELECT
    COALESCE(SUM(remaining_credits) FILTER (
      WHERE status IN ('active', 'pending_refund')
        AND (expires_at IS NULL OR expires_at > v_now)
    ), 0)::integer,
    COALESCE(SUM(remaining_credits) FILTER (
      WHERE status = 'active'
        AND (expires_at IS NULL OR expires_at > v_now)
    ), 0)::integer,
    COALESCE(SUM(remaining_credits) FILTER (
      WHERE status IN ('active', 'pending_refund')
        AND expires_at IS NOT NULL
        AND expires_at <= v_now
    ), 0)::integer,
    MIN(expires_at) FILTER (
      WHERE status IN ('active', 'pending_refund')
        AND remaining_credits > 0
        AND expires_at > v_now
    )
    INTO
      v_ledger_balance,
      v_spendable_balance,
      v_expired_balance,
      v_next_expiration_at
    FROM public.credit_sources
   WHERE user_id = p_user_id;

  SELECT balance_after
    INTO v_latest_transaction_balance
    FROM public.credit_transactions
   WHERE user_id = p_user_id
   ORDER BY created_at DESC, id DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'profile_balance', v_profile_balance,
    'ledger_balance', v_ledger_balance,
    'spendable_balance', v_spendable_balance,
    'expired_balance', v_expired_balance,
    'latest_transaction_balance', v_latest_transaction_balance,
    'next_expiration_at', v_next_expiration_at,
    'database_now', v_now
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_credits(
  p_user_id uuid,
  p_amount integer,
  p_resource_type text,
  p_resource_id uuid,
  p_description text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_available integer := 0;
  v_remaining integer := p_amount;
  v_new_balance integer := 0;
  v_source RECORD;
  v_deduct integer;
  v_consumptions jsonb := '[]'::jsonb;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_CREDIT_AMOUNT';
  END IF;

  PERFORM 1
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CREDIT_USER_NOT_FOUND';
  END IF;

  PERFORM 1
    FROM public.credit_sources
   WHERE user_id = p_user_id
     AND status = 'active'
     AND remaining_credits > 0
     AND (expires_at IS NULL OR expires_at > now())
   ORDER BY expires_at ASC NULLS LAST, purchased_at ASC, id ASC
   FOR UPDATE;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_available
    FROM public.credit_sources
   WHERE user_id = p_user_id
     AND status = 'active'
     AND remaining_credits > 0
     AND (expires_at IS NULL OR expires_at > v_now);

  IF v_available < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;

  FOR v_source IN
    SELECT id, remaining_credits
      FROM public.credit_sources
     WHERE user_id = p_user_id
       AND status = 'active'
       AND remaining_credits > 0
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY expires_at ASC NULLS LAST, purchased_at ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_deduct := LEAST(v_source.remaining_credits, v_remaining);

    UPDATE public.credit_sources
       SET remaining_credits = remaining_credits - v_deduct
     WHERE id = v_source.id;

    INSERT INTO public.credit_consumption (
      user_id,
      source_id,
      amount,
      resource_type,
      resource_id,
      description
    ) VALUES (
      p_user_id,
      v_source.id,
      v_deduct,
      p_resource_type,
      p_resource_id,
      p_description
    );

    v_consumptions := v_consumptions || jsonb_build_array(
      jsonb_build_object('source_id', v_source.id, 'amount', v_deduct)
    );
    v_remaining := v_remaining - v_deduct;
  END LOOP;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_new_balance
    FROM public.credit_sources
   WHERE user_id = p_user_id
     AND status IN ('active', 'pending_refund')
     AND (expires_at IS NULL OR expires_at > v_now);

  UPDATE public.profiles
     SET credits = v_new_balance
   WHERE id = p_user_id;

  INSERT INTO public.credit_transactions (
    user_id,
    type,
    amount,
    balance_after,
    description,
    resource_type,
    resource_id
  ) VALUES (
    p_user_id,
    'consume',
    -p_amount,
    v_new_balance,
    p_description,
    p_resource_type,
    p_resource_id
  );

  RETURN jsonb_build_object(
    'new_balance', v_new_balance,
    'consumptions', v_consumptions
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_credits(
  p_user_id uuid,
  p_amount integer,
  p_resource_type text,
  p_resource_id uuid,
  p_description text,
  p_consumptions jsonb,
  p_target_balance integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_item jsonb;
  v_source_id uuid;
  v_refund_amount integer;
  v_remaining_refund integer := p_amount;
  v_total_refunded integer := 0;
  v_source_initial integer;
  v_new_balance integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_CREDIT_REFUND_AMOUNT';
  END IF;

  IF p_consumptions IS NULL
     OR jsonb_typeof(p_consumptions) <> 'array'
     OR jsonb_array_length(p_consumptions) = 0 THEN
    RAISE EXCEPTION 'CREDIT_REFUND_SOURCE_REQUIRED';
  END IF;

  PERFORM 1
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CREDIT_USER_NOT_FOUND';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_consumptions)
  LOOP
    EXIT WHEN v_remaining_refund <= 0;

    v_source_id := NULLIF(v_item->>'source_id', '')::uuid;
    v_refund_amount := COALESCE((v_item->>'amount')::integer, 0);

    IF v_source_id IS NULL OR v_refund_amount <= 0 THEN
      CONTINUE;
    END IF;

    SELECT initial_credits
      INTO v_source_initial
      FROM public.credit_sources
     WHERE id = v_source_id
       AND user_id = p_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CREDIT_REFUND_SOURCE_NOT_FOUND';
    END IF;

    v_refund_amount := LEAST(v_refund_amount, v_remaining_refund);

    UPDATE public.credit_sources
       SET remaining_credits = LEAST(
         remaining_credits + v_refund_amount,
         v_source_initial
       )
     WHERE id = v_source_id;

    v_total_refunded := v_total_refunded + v_refund_amount;
    v_remaining_refund := v_remaining_refund - v_refund_amount;
  END LOOP;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_new_balance
    FROM public.credit_sources
   WHERE user_id = p_user_id
     AND status IN ('active', 'pending_refund')
     AND (expires_at IS NULL OR expires_at > v_now);

  IF p_target_balance IS NOT NULL THEN
    v_new_balance := LEAST(v_new_balance, p_target_balance);
  END IF;

  UPDATE public.profiles
     SET credits = v_new_balance
   WHERE id = p_user_id;

  INSERT INTO public.credit_transactions (
    user_id,
    type,
    amount,
    balance_after,
    description,
    resource_type,
    resource_id
  ) VALUES (
    p_user_id,
    'refund',
    v_total_refunded,
    v_new_balance,
    p_description,
    p_resource_type,
    p_resource_id
  );

  RETURN jsonb_build_object(
    'new_balance', v_new_balance,
    'refunded', v_total_refunded
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_credit_balance_snapshot(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_credits(
  uuid, integer, text, uuid, text
) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_credits(
  uuid, integer, text, uuid, text, jsonb, integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_credit_balance_snapshot(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_credits(
  uuid, integer, text, uuid, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_credits(
  uuid, integer, text, uuid, text, jsonb, integer
) TO service_role;
