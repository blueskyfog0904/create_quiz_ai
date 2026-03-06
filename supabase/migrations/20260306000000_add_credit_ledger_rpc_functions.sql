-- ============================================================================
-- 크레딧 입출력을 RPC로 원자 처리
-- ============================================================================
-- 목적
-- - 크레딧 차감/환불을 DB 함수 하나에서 트랜잭션 단위로 처리
-- - credit_sources / profiles / 로그 테이블 간 불일치 위험을 최소화
-- ============================================================================

CREATE OR REPLACE FUNCTION public.consume_credits(
  p_user_id uuid,
  p_amount integer,
  p_resource_type text,
  p_resource_id uuid,
  p_description text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_balance integer;
  v_remaining integer := p_amount;
  v_new_balance integer;
  v_source RECORD;
  v_deduct integer;
  v_consumptions jsonb := '[]'::jsonb;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION '차감할 크레딧은 0보다 커야 합니다.';
  END IF;

  -- 사용자 잔액 조회 + 잠금 (동시성 충돌 시 안전하게 시퀀스 처리)
  SELECT credits
    INTO v_user_balance
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

  IF v_user_balance IS NULL THEN
    RAISE EXCEPTION '사용자 정보를 찾을 수 없습니다.';
  END IF;

  IF v_user_balance < p_amount THEN
    RAISE EXCEPTION '크레딧이 부족합니다.';
  END IF;

  -- FIFO 순서로 남은 크레딧이 있는 active 소스만 차감
  FOR v_source IN
    SELECT id, remaining_credits
      FROM public.credit_sources
     WHERE user_id = p_user_id
       AND status = 'active'
       AND remaining_credits > 0
     ORDER BY purchased_at ASC
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

    v_consumptions := v_consumptions || jsonb_build_array(jsonb_build_object(
      'source_id', v_source.id,
      'amount', v_deduct
    ));

    v_remaining := v_remaining - v_deduct;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION '크레딧이 부족합니다.';
  END IF;

  v_new_balance := v_user_balance - p_amount;

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
AS $$
DECLARE
  v_item jsonb;
  v_source_id uuid;
  v_refund_amount integer;
  v_remaining_refund integer := p_amount;
  v_total_refunded integer := 0;
  v_source_initial integer;
  v_current_balance integer;
  v_new_balance integer;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('new_balance', (
      SELECT credits FROM public.profiles WHERE id = p_user_id
    ), 'refunded', 0);
  END IF;

  IF p_consumptions IS NULL OR jsonb_typeof(p_consumptions) <> 'array' OR jsonb_array_length(p_consumptions) = 0 THEN
    RAISE EXCEPTION '환불 대상 소비 내역이 없습니다.';
  END IF;

  -- 사용자 잔액 잠금
  SELECT credits
    INTO v_current_balance
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION '사용자 정보를 찾을 수 없습니다.';
  END IF;

  -- 전달받은 소비 내역만큼 source 복구
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
      RAISE EXCEPTION '환불 처리 중 크레딧 소스를 찾을 수 없습니다.';
    END IF;

    v_refund_amount := LEAST(v_refund_amount, v_remaining_refund);

    UPDATE public.credit_sources
      SET remaining_credits = LEAST(remaining_credits + v_refund_amount, v_source_initial)
      WHERE id = v_source_id;

    v_total_refunded := v_total_refunded + v_refund_amount;
    v_remaining_refund := v_remaining_refund - v_refund_amount;
  END LOOP;

  v_new_balance := v_current_balance + v_total_refunded;

  IF p_target_balance IS NOT NULL AND v_new_balance > p_target_balance THEN
    v_new_balance := p_target_balance;
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

-- 기존 익명권한 사용자도 RPC를 호출할 수 있도록 허용
GRANT EXECUTE ON FUNCTION public.consume_credits(uuid, integer, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credits(uuid, integer, text, uuid, text, jsonb, integer) TO authenticated;
