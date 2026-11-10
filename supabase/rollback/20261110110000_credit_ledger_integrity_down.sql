-- 20261110110000_credit_ledger_integrity 되돌리기. 계획 docs/payment-integrity-fixes-plan.md 3.6·6.4.
-- 순서: 커밋 B(approve_market_refund·grant_admin_credits를 부르는 코드)를 먼저 되돌려 배포한 뒤 실행한다.
--       롤백 1(20261110100000_payment_integrity_fixes_down.sql)은 이 파일을 실행한 뒤에만 실행한다.
-- 1) consume_credits_once·refund_credits_once를 운영 원문(pg_get_functiondef, 2026-11-10)으로 다시 만들고 ACL을 지금과 같게 한다.
-- 2) 새 함수 approve_market_refund·grant_admin_credits를 지운다.
-- 3) refund_credits를 운영 원문으로 되돌린다(옛 정의는 'skipped'를 돌려주지 않는다. 롤백 순서상 읽는 코드가 없다).
-- 4) 원장 CHECK 제약 4개를 지운다. payment_history_amount_charge_limit은 검증 상태 그대로 둔다.
-- 원문 md5(md5(pg_get_functiondef(oid))):
--   refund_credits       6a082ed597597efdbb688225076a3996
--   consume_credits_once 5bba3e44100b1eb403da9210b87ad53e
--   refund_credits_once  5a7af4fbce9ef158d411b505cd419e6d
-- 백필·DB가 남긴 경보는 되돌리지 않는다(기록 데이터).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. 레거시 함수 복원(운영 원문 그대로)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_credits_once(p_user_id uuid, p_amount integer, p_resource_type text, p_resource_id uuid, p_description text, p_operation_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_existing_transaction record;
  v_user_balance integer;
  v_remaining integer := p_amount;
  v_new_balance integer;
  v_source record;
  v_deduct integer;
  v_consumptions jsonb := '[]'::jsonb;
  v_transaction_id uuid;
begin
  if auth.uid() is distinct from p_user_id and not coalesce(public.is_admin(), false) then
    raise exception '권한이 없습니다.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception '차감할 크레딧은 0보다 커야 합니다.';
  end if;

  if p_operation_key is null or length(trim(p_operation_key)) = 0 then
    raise exception 'operation_key가 필요합니다.';
  end if;

  select id, balance_after
    into v_existing_transaction
    from public.credit_transactions
    where user_id = p_user_id
      and operation_key = p_operation_key
      and type = 'consume'
    limit 1;

  if found then
    select coalesce(
      jsonb_agg(jsonb_build_object('source_id', source_id, 'amount', amount, 'transaction_id', transaction_id)),
      '[]'::jsonb
    )
      into v_consumptions
      from public.credit_consumption
      where transaction_id = v_existing_transaction.id;

    return jsonb_build_object(
      'new_balance', v_existing_transaction.balance_after,
      'transaction_id', v_existing_transaction.id,
      'consumptions', v_consumptions,
      'idempotent', true
    );
  end if;

  select credits
    into v_user_balance
    from public.profiles
    where id = p_user_id
    for update;

  if v_user_balance is null then
    raise exception '사용자 정보를 찾을 수 없습니다.';
  end if;

  if v_user_balance < p_amount then
    raise exception '크레딧이 부족합니다.';
  end if;

  v_new_balance := v_user_balance - p_amount;

  insert into public.credit_transactions (
    user_id,
    type,
    amount,
    balance_after,
    description,
    resource_type,
    resource_id,
    operation_key
  ) values (
    p_user_id,
    'consume',
    -p_amount,
    v_new_balance,
    p_description,
    p_resource_type,
    p_resource_id,
    p_operation_key
  ) returning id into v_transaction_id;

  for v_source in
    select id, remaining_credits
      from public.credit_sources
      where user_id = p_user_id
        and status = 'active'
        and remaining_credits > 0
      order by purchased_at asc
      for update
  loop
    exit when v_remaining <= 0;

    v_deduct := least(v_source.remaining_credits, v_remaining);

    update public.credit_sources
      set remaining_credits = remaining_credits - v_deduct
      where id = v_source.id;

    insert into public.credit_consumption (
      user_id,
      source_id,
      amount,
      resource_type,
      resource_id,
      description,
      transaction_id,
      operation_key
    ) values (
      p_user_id,
      v_source.id,
      v_deduct,
      p_resource_type,
      p_resource_id,
      p_description,
      v_transaction_id,
      p_operation_key
    );

    v_consumptions := v_consumptions || jsonb_build_array(jsonb_build_object(
      'source_id', v_source.id,
      'amount', v_deduct,
      'transaction_id', v_transaction_id
    ));

    v_remaining := v_remaining - v_deduct;
  end loop;

  if v_remaining > 0 then
    raise exception '크레딧이 부족합니다.';
  end if;

  update public.profiles
    set credits = v_new_balance
    where id = p_user_id;

  return jsonb_build_object(
    'new_balance', v_new_balance,
    'transaction_id', v_transaction_id,
    'consumptions', v_consumptions,
    'idempotent', false
  );
exception when unique_violation then
  select id, balance_after
    into v_existing_transaction
    from public.credit_transactions
    where user_id = p_user_id
      and operation_key = p_operation_key
      and type = 'consume'
    limit 1;

  if not found then
    raise;
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('source_id', source_id, 'amount', amount, 'transaction_id', transaction_id)),
    '[]'::jsonb
  )
    into v_consumptions
    from public.credit_consumption
    where transaction_id = v_existing_transaction.id;

  return jsonb_build_object(
    'new_balance', v_existing_transaction.balance_after,
    'transaction_id', v_existing_transaction.id,
    'consumptions', v_consumptions,
    'idempotent', true
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.refund_credits_once(p_user_id uuid, p_amount integer, p_resource_type text, p_resource_id uuid, p_description text, p_operation_key text, p_original_operation_key text, p_target_balance integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_existing_transaction record;
  v_original_transaction record;
  v_current_balance integer;
  v_new_balance integer;
  v_consumption record;
  v_total_refunded integer := 0;
  v_remaining_refund integer := p_amount;
  v_source_initial integer;
  v_refund_amount integer;
  v_transaction_id uuid;
begin
  if auth.uid() is distinct from p_user_id
    and coalesce(auth.role(), '') <> 'service_role'
    and not coalesce(public.is_admin(), false) then
    raise exception '권한이 없습니다.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception '환불할 크레딧은 0보다 커야 합니다.';
  end if;

  if p_operation_key is null or length(trim(p_operation_key)) = 0 then
    raise exception 'operation_key가 필요합니다.';
  end if;

  if p_original_operation_key is null or length(trim(p_original_operation_key)) = 0 then
    raise exception 'original_operation_key가 필요합니다.';
  end if;

  select id, balance_after
    into v_existing_transaction
    from public.credit_transactions
    where user_id = p_user_id
      and type = 'refund'
      and (
        operation_key = p_operation_key
        or original_operation_key = p_original_operation_key
      )
    limit 1;

  if found then
    return jsonb_build_object(
      'new_balance', v_existing_transaction.balance_after,
      'transaction_id', v_existing_transaction.id,
      'refunded', 0,
      'idempotent', true
    );
  end if;

  select id
    into v_original_transaction
    from public.credit_transactions
    where user_id = p_user_id
      and type = 'consume'
      and operation_key = p_original_operation_key
    limit 1;

  if not found then
    raise exception '원본 차감 거래를 찾을 수 없습니다.';
  end if;

  select credits
    into v_current_balance
    from public.profiles
    where id = p_user_id
    for update;

  if not found then
    raise exception '사용자 정보를 찾을 수 없습니다.';
  end if;

  for v_consumption in
    select source_id, amount
    from public.credit_consumption
    where transaction_id = v_original_transaction.id
    order by created_at desc
  loop
    exit when v_remaining_refund <= 0;

    select initial_credits
      into v_source_initial
      from public.credit_sources
      where id = v_consumption.source_id
      for update;

    v_refund_amount := least(v_consumption.amount, v_remaining_refund);

    update public.credit_sources
      set remaining_credits = least(coalesce(remaining_credits, 0) + v_refund_amount, v_source_initial),
          updated_at = now()
      where id = v_consumption.source_id;

    v_total_refunded := v_total_refunded + v_refund_amount;
    v_remaining_refund := v_remaining_refund - v_refund_amount;
  end loop;

  if v_total_refunded <= 0 then
    raise exception '환불 가능한 소비 내역이 없습니다.';
  end if;

  v_new_balance := coalesce(p_target_balance, v_current_balance + v_total_refunded);

  insert into public.credit_transactions (
    user_id,
    type,
    amount,
    balance_after,
    resource_type,
    resource_id,
    description,
    operation_key,
    original_operation_key
  ) values (
    p_user_id,
    'refund',
    v_total_refunded,
    v_new_balance,
    p_resource_type,
    p_resource_id,
    p_description,
    p_operation_key,
    p_original_operation_key
  ) returning id into v_transaction_id;

  update public.profiles
    set credits = v_new_balance
    where id = p_user_id;

  return jsonb_build_object(
    'new_balance', v_new_balance,
    'transaction_id', v_transaction_id,
    'refunded', v_total_refunded,
    'idempotent', false
  );
exception when unique_violation then
  select id, balance_after
    into v_existing_transaction
    from public.credit_transactions
    where user_id = p_user_id
      and type = 'refund'
      and (
        operation_key = p_operation_key
        or original_operation_key = p_original_operation_key
      )
    limit 1;

  if not found then
    raise;
  end if;

  return jsonb_build_object(
    'new_balance', v_existing_transaction.balance_after,
    'transaction_id', v_existing_transaction.id,
    'refunded', 0,
    'idempotent', true
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.consume_credits_once(uuid, integer, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_credits_once(uuid, integer, text, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.refund_credits_once(uuid, integer, text, uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_credits_once(uuid, integer, text, uuid, text, text, text, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. 새 함수 삭제
-- ---------------------------------------------------------------------------
DROP FUNCTION public.grant_admin_credits(uuid, integer, text, text, text);
DROP FUNCTION public.approve_market_refund(uuid, uuid, text, integer);

-- ---------------------------------------------------------------------------
-- 3. refund_credits 원문 복원(CREATE OR REPLACE라 ACL은 유지된다)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_credits(p_user_id uuid, p_amount integer, p_resource_type text, p_resource_id uuid, p_description text, p_consumptions jsonb, p_target_balance integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

-- ---------------------------------------------------------------------------
-- 4. 원장 CHECK 제약 삭제. 잠금 순서는 마이그레이션과 같게 profiles → credit_sources → credit_consumption.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_credits_nonnegative;
ALTER TABLE public.credit_sources
  DROP CONSTRAINT credit_sources_remaining_credits_range,
  DROP CONSTRAINT credit_sources_initial_credits_positive;
ALTER TABLE public.credit_consumption
  DROP CONSTRAINT credit_consumption_amount_positive;

-- ---------------------------------------------------------------------------
-- 5. 검증: 세 함수가 원문 md5와 같고 ACL이 마이그레이션 전과 같은지
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF md5(pg_get_functiondef('public.refund_credits(uuid, integer, text, uuid, text, jsonb, integer)'::regprocedure))
       IS DISTINCT FROM '6a082ed597597efdbb688225076a3996'
     OR md5(pg_get_functiondef('public.consume_credits_once(uuid, integer, text, uuid, text, text)'::regprocedure))
       IS DISTINCT FROM '5bba3e44100b1eb403da9210b87ad53e'
     OR md5(pg_get_functiondef('public.refund_credits_once(uuid, integer, text, uuid, text, text, text, integer)'::regprocedure))
       IS DISTINCT FROM '5a7af4fbce9ef158d411b505cd419e6d' THEN
    RAISE EXCEPTION 'VERIFY: restored function definitions differ from the originals';
  END IF;

  IF (SELECT proacl::text FROM pg_proc WHERE oid = 'public.consume_credits_once(uuid, integer, text, uuid, text, text)'::regprocedure)
       IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.refund_credits_once(uuid, integer, text, uuid, text, text, text, integer)'::regprocedure)
       IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR (SELECT proacl::text FROM pg_proc WHERE oid = 'public.refund_credits(uuid, integer, text, uuid, text, jsonb, integer)'::regprocedure)
       IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'VERIFY: restored function privileges';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
