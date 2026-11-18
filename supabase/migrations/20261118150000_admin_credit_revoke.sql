-- 잘못 지급한 크레딧을 관리자 화면에서 회수하는 함수(계획 U3-7, DB-11'; 런북 RB-4를 대신한다).
-- 정한 규칙(2026-11-18 사용자 결정):
--   관리자 지급분(원천 분류 admin_grant·bonus·system_refund)에서만 회수한다. 회원이 결제로 충전한 크레딧(plan_purchase)은 건드리지 않는다.
--   지급 건(원천 1개)을 골라 그 건의 남은 수량 안에서만 회수한다. 이미 쓴 크레딧은 되돌리지 않고, 잔액은 마이너스가 되지 않는다.
-- 이 파일은 추가만 한다(새 함수 1개). 표 구조는 바꾸지 않는다.
-- revoke_admin_credits(행위자, 원천, 수량, 사유, 요청 키):
--   ① 인자 검증(사유 1~500자) → 원천을 찾고 그 주인이 행위자 본인이면 거부, 관리자 지급분이 아니면 잠그기 전에 거부.
--   ② 행위자: 대표는 한도 없음. 직원은 그 계정의 credits.revoke 권한 행을 FOR UPDATE로 잠그고 함께 필요한 권한(members.view, credits.view)을 확인,
--      재요청이 아니면 1회 회수 한도(계정의 per_grant, 필수 — 없으면 거부) 안인지 본다.
--   ③ 대상 회원 프로필 잠금 → 같은 요청 키의 거래가 있으면 그 결과를 돌려준다(내용이 다르면 ADMIN_REVOKE_IDEMPOTENCY_CONFLICT).
--   ④ 원천 잠금 → 관리자 지급분인지, 쓸 수 있는 상태(active, 만료 전)인지, 회수량 ≤ 남은 수량인지 확인.
--   ⑤ 원천의 남은 수량을 줄이고 잔액 캐시를 다시 계산, 거래 1행(type 'refund', 음수 수량, "크레딧 N개 관리자 회수" — 결제 환불 회수와 같은 기록 방식),
--      작업 기록 1행(action 'credit_revoke', 같은 트랜잭션).
--   잠금 순서: (직원) 행위자 권한 행 → 대상 프로필 → 원천. 크레딧 사용 함수(consume_credits)의 "프로필 → 원천"과 같은 방향.
--   결제 환불 함수들(finalize_point_charge_refund 등)은 "원천 → 프로필"이지만 결제 충전분 원천만 잠근다. 이 함수는 관리자 지급분만 잠그므로 같은 행을 반대 순서로 잡지 않는다.
-- 회원 알림은 앱(route)이 서버 키로 넣는다(지급과 같은 방식).
-- 예외 이름: ADMIN_REVOKE_INPUT_INVALID / ADMIN_REVOKE_SOURCE_NOT_FOUND / ADMIN_REVOKE_SELF_TARGET / ADMIN_REVOKE_ACTOR_NOT_ALLOWED
--            / ADMIN_REVOKE_LIMIT_NOT_SET / ADMIN_REVOKE_LIMIT_PER_GRANT limit=N / CREDIT_USER_NOT_FOUND / ADMIN_REVOKE_IDEMPOTENCY_CONFLICT
--            / ADMIN_REVOKE_REPLAY_MISSING / ADMIN_REVOKE_SOURCE_NOT_ADMIN_GRANT / ADMIN_REVOKE_SOURCE_NOT_ACTIVE / ADMIN_REVOKE_EXCEEDS_REMAINING remaining=N
-- 권한: SECURITY DEFINER, search_path 고정, EXECUTE는 service_role만.
-- 선행: 20261117110000(작업 기록), 20261118120000(credits.limits.manage까지 든 권한 이름 목록 — credits.revoke는 처음부터 있음).
-- 잠금: 새 함수만 만든다(표 잠금 없음). 순서: 코드 배포보다 먼저 적용한다(새 코드가 이 함수를 부른다).
-- 되돌리기: supabase/rollback/20261118150000_admin_credit_revoke_down.sql (코드를 먼저 되돌린 뒤 실행. 되돌린 코드에서는 남은 credit_revoke 작업 기록이 한글 이름 없이 보인다)
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION public.revoke_admin_credits(
  p_actor_id uuid,
  p_source_id uuid,
  p_amount integer,
  p_reason text,
  p_operation_key text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_revoke_admin_credits$
DECLARE
  v_now timestamptz := now();
  v_user_id uuid;
  v_actor_is_admin boolean;
  v_actor_role text;
  v_grant_limits jsonb;
  v_per_grant numeric;
  v_is_replay boolean := false;
  v_existing public.credit_transactions%ROWTYPE;
  v_category text;
  v_status text;
  v_remaining integer;
  v_expires_at timestamptz;
  v_new_balance integer;
BEGIN
  -- ① 인자
  IF p_actor_id IS NULL OR p_source_id IS NULL
     OR p_amount IS NULL OR p_amount < 1
     OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500
     OR p_operation_key IS NULL
     OR length(p_operation_key) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_INPUT_INVALID';
  END IF;

  -- 결제 충전분 원천은 잠그기 전에 거른다(결제 환불 함수들은 "원천 → 프로필" 순서로 잠그므로, 같은 원천을 반대 순서로 잠그지 않게).
  SELECT s.user_id, s.source_category INTO v_user_id, v_category
    FROM public.credit_sources s
   WHERE s.id = p_source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_FOUND';
  END IF;
  IF v_user_id = p_actor_id THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SELF_TARGET';
  END IF;
  IF v_category IS NULL OR v_category NOT IN ('admin_grant', 'bonus', 'system_refund') THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_ADMIN_GRANT';
  END IF;

  -- ② 행위자: 관리자(대표 또는 직원). 행위자 프로필은 잠그지 않는다(지급 함수와 같은 방식).
  SELECT p.is_admin, p.admin_role
    INTO v_actor_is_admin, v_actor_role
    FROM public.profiles p
   WHERE p.id = p_actor_id;
  IF NOT FOUND OR v_actor_is_admin IS NOT TRUE
     OR (v_actor_role IS DISTINCT FROM 'owner' AND v_actor_role IS DISTINCT FROM 'staff') THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_ACTOR_NOT_ALLOWED';
  END IF;

  IF v_actor_role = 'staff' THEN
    SELECT g.limits
      INTO v_grant_limits
      FROM public.admin_permission_grants g
     WHERE g.user_id = p_actor_id AND g.permission = 'credits.revoke'
       FOR UPDATE;
    IF NOT FOUND
       OR (SELECT count(*) FROM public.admin_permission_grants g
            WHERE g.user_id = p_actor_id AND g.permission IN ('members.view', 'credits.view')) <> 2 THEN
      RAISE EXCEPTION 'ADMIN_REVOKE_ACTOR_NOT_ALLOWED';
    END IF;

    v_is_replay := EXISTS (SELECT 1 FROM public.credit_transactions t WHERE t.operation_key = p_operation_key);

    IF NOT v_is_replay THEN
      v_per_grant := CASE
        WHEN jsonb_typeof(v_grant_limits -> 'per_grant') = 'number' THEN (v_grant_limits ->> 'per_grant')::numeric
      END;
      IF v_per_grant IS NULL OR v_per_grant < 1 THEN
        RAISE EXCEPTION 'ADMIN_REVOKE_LIMIT_NOT_SET';
      END IF;
      IF p_amount > v_per_grant THEN
        RAISE EXCEPTION 'ADMIN_REVOKE_LIMIT_PER_GRANT limit=%', v_per_grant;
      END IF;
    END IF;
  END IF;

  -- ③ 대상 프로필 잠금 → 같은 키의 재요청이면 기존 결과
  PERFORM 1
    FROM public.profiles
   WHERE id = v_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CREDIT_USER_NOT_FOUND';
  END IF;

  SELECT * INTO v_existing
    FROM public.credit_transactions
   WHERE operation_key = p_operation_key
   LIMIT 1;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM v_user_id
       OR v_existing.source_id IS DISTINCT FROM p_source_id
       OR v_existing.type IS DISTINCT FROM 'refund'
       OR v_existing.amount IS DISTINCT FROM -p_amount THEN
      RAISE EXCEPTION 'ADMIN_REVOKE_IDEMPOTENCY_CONFLICT';
    END IF;

    SELECT COALESCE(SUM(remaining_credits), 0)::integer
      INTO v_new_balance
      FROM public.credit_sources
     WHERE user_id = v_user_id
       AND status IN ('active', 'pending_refund')
       AND (expires_at IS NULL OR expires_at > v_now);

    RETURN jsonb_build_object(
      'already_revoked', true,
      'user_id', v_user_id,
      'new_balance', v_new_balance,
      'source_remaining', (SELECT s.remaining_credits FROM public.credit_sources s WHERE s.id = p_source_id)
    );
  END IF;

  -- 재요청으로 보고 한도를 건너뛰었는데 기존 거래가 없으면 회수하지 않는다.
  IF v_is_replay THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_REPLAY_MISSING';
  END IF;

  -- ④ 원천 잠금과 확인
  -- 잠근 프로필의 원천인지 다시 확인한다(그 사이 원천이 지워졌거나 주인이 달라졌으면 회수하지 않는다).
  SELECT s.source_category, s.status, s.remaining_credits, s.expires_at
    INTO v_category, v_status, v_remaining, v_expires_at
    FROM public.credit_sources s
   WHERE s.id = p_source_id
     AND s.user_id = v_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_FOUND';
  END IF;

  IF v_category IS NULL OR v_category NOT IN ('admin_grant', 'bonus', 'system_refund') THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_ADMIN_GRANT';
  END IF;
  IF v_status IS DISTINCT FROM 'active' OR (v_expires_at IS NOT NULL AND v_expires_at <= v_now) THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_ACTIVE';
  END IF;
  IF p_amount > v_remaining THEN
    RAISE EXCEPTION 'ADMIN_REVOKE_EXCEEDS_REMAINING remaining=%', v_remaining;
  END IF;

  -- ⑤ 회수
  UPDATE public.credit_sources
     SET remaining_credits = remaining_credits - p_amount
   WHERE id = p_source_id;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_new_balance
    FROM public.credit_sources
   WHERE user_id = v_user_id
     AND status IN ('active', 'pending_refund')
     AND (expires_at IS NULL OR expires_at > v_now);

  UPDATE public.profiles
     SET credits = v_new_balance
   WHERE id = v_user_id;

  INSERT INTO public.credit_transactions (
    user_id,
    type,
    amount,
    balance_after,
    description,
    source_id,
    operation_key
  ) VALUES (
    v_user_id,
    'refund',
    -p_amount,
    v_new_balance,
    format('크레딧 %s개 관리자 회수', to_char(p_amount, 'FM999,999,999,999')),
    p_source_id,
    p_operation_key
  );

  PERFORM public.record_admin_audit(
    p_actor_id,
    'credit_revoke',
    'member',
    v_user_id::text,
    v_user_id,
    p_amount,
    btrim(p_reason),
    jsonb_build_object(
      'source_id', p_source_id,
      'source_category', v_category,
      'operation_key', p_operation_key,
      'new_balance', v_new_balance,
      'source_remaining', v_remaining - p_amount
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'already_revoked', false,
    'user_id', v_user_id,
    'new_balance', v_new_balance,
    'source_remaining', v_remaining - p_amount
  );
END;
$fn_revoke_admin_credits$;

REVOKE ALL ON FUNCTION public.revoke_admin_credits(uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_admin_credits(uuid, uuid, integer, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
