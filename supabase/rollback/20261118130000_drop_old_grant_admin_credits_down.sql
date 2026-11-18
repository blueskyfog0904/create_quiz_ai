-- 20261118130000_drop_old_grant_admin_credits 되돌리기: 옛 크레딧 지급 함수(5인자)를 20261110110000의 정의 그대로 다시 만든다.
-- 다시 만든 정의의 md5는 지우기 전 운영 값(05b1c69bfb2d0e69662df8738dde1020)과 같고, EXECUTE는 service_role만이다(리허설에서 확인).
-- 되살려도 지금 코드는 새 7인자 함수만 부르므로 동작은 바뀌지 않는다. 옛 함수에는 직원 한도·작업 기록이 없다.
-- 반드시 한 트랜잭션으로 실행한다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION public.grant_admin_credits(
  p_user_id uuid,
  p_amount integer,
  p_source_category text,
  p_payment_method text,
  p_operation_key text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_existing public.credit_transactions%ROWTYPE;
  v_existing_category text;
  v_existing_payment_method text;
  v_source_id uuid;
  v_new_balance integer;
BEGIN
  IF p_amount IS NULL OR p_amount NOT BETWEEN 1 AND 10000
     OR p_source_category IS NULL
     OR p_source_category NOT IN ('admin_grant', 'bonus', 'system_refund')
     OR p_operation_key IS NULL
     OR length(p_operation_key) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'ADMIN_GRANT_INPUT_INVALID';
  END IF;

  PERFORM 1
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CREDIT_USER_NOT_FOUND';
  END IF;

  -- 같은 키의 재요청은 프로필 잠금 뒤 기존 거래를 찾아 그대로 돌려준다(사용자 조건 없이 찾는다).
  SELECT * INTO v_existing
    FROM public.credit_transactions
   WHERE operation_key = p_operation_key
   LIMIT 1;

  IF FOUND THEN
    SELECT source_category INTO v_existing_category
      FROM public.credit_sources
     WHERE id = v_existing.source_id;

    SELECT payment_method INTO v_existing_payment_method
      FROM public.payment_history
     WHERE source_id = v_existing.source_id
     LIMIT 1;

    -- 응답 유실 뒤 내용을 고쳐 같은 키로 다시 보내면 옛 지급을 성공으로 돌려주지 않고 거부한다.
    IF v_existing.user_id IS DISTINCT FROM p_user_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing_category IS DISTINCT FROM p_source_category
       OR v_existing_payment_method IS DISTINCT FROM p_payment_method THEN
      RAISE EXCEPTION 'ADMIN_GRANT_IDEMPOTENCY_CONFLICT';
    END IF;

    SELECT COALESCE(SUM(remaining_credits), 0)::integer
      INTO v_new_balance
      FROM public.credit_sources
     WHERE user_id = p_user_id
       AND status IN ('active', 'pending_refund')
       AND (expires_at IS NULL OR expires_at > v_now);

    RETURN jsonb_build_object(
      'already_granted', true,
      'source_id', v_existing.source_id,
      'new_balance', v_new_balance
    );
  END IF;

  INSERT INTO public.credit_sources (
    user_id,
    plan_id,
    initial_credits,
    remaining_credits,
    status,
    source_category
  ) VALUES (
    p_user_id,
    NULL,
    p_amount,
    p_amount,
    'active',
    p_source_category
  )
  RETURNING id INTO v_source_id;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_new_balance
    FROM public.credit_sources
   WHERE user_id = p_user_id
     AND status IN ('active', 'pending_refund')
     AND (expires_at IS NULL OR expires_at > v_now);

  UPDATE public.profiles
     SET credits = v_new_balance
   WHERE id = p_user_id;

  INSERT INTO public.payment_history (
    user_id,
    source_id,
    plan_id,
    amount,
    payment_method,
    status
  ) VALUES (
    p_user_id,
    v_source_id,
    NULL,
    0,
    p_payment_method,
    'completed'
  );

  INSERT INTO public.credit_transactions (
    user_id,
    type,
    amount,
    balance_after,
    description,
    source_id,
    operation_key
  ) VALUES (
    p_user_id,
    'purchase',
    p_amount,
    v_new_balance,
    format('크레딧 %s개 구매', to_char(p_amount, 'FM999,999,999')),
    v_source_id,
    p_operation_key
  );

  RETURN jsonb_build_object(
    'already_granted', false,
    'source_id', v_source_id,
    'new_balance', v_new_balance
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.grant_admin_credits(uuid, integer, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_admin_credits(uuid, integer, text, text, text) TO service_role;

-- 다시 만든 정의와 권한이 지우기 전과 같은지 확인한다(기본 권한이 바뀌어 권한이 넓어진 채 남지 않게). 다르면 전체를 취소한다.
DO $check_restored_grant$
BEGIN
  IF md5(pg_get_functiondef('public.grant_admin_credits(uuid,integer,text,text,text)'::regprocedure)) <> '05b1c69bfb2d0e69662df8738dde1020' THEN
    RAISE EXCEPTION 'RESTORED_GRANT_ADMIN_CREDITS_DEFINITION_MISMATCH';
  END IF;
  IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.grant_admin_credits(uuid,integer,text,text,text)'::regprocedure)
     IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'RESTORED_GRANT_ADMIN_CREDITS_ACL_MISMATCH';
  END IF;
END;
$check_restored_grant$;

NOTIFY pgrst, 'reload schema';
