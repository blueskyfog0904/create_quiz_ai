-- 직원(staff)의 크레딧 수동 지급에 1회·하루 한도를 DB에서 적용하고, 기본 한도를 설정값으로 둔다(계획 U3-6, DB-6').
-- 배경: 지금 지급 함수 grant_admin_credits(5인자)는 누가 지급하는지 모르고 1회 10,000만 본다. 직원의 1회 한도는 route가 보고,
--       하루 누적 한도는 어디서도 보지 않는다(같은 직원이 잘게 나눠 계속 지급할 수 있다). 지급 기록도 route가 지급 뒤 따로 남긴다.
-- 정한 규칙(2026-11-18 사용자 결정):
--   대표(owner)는 지급 한도가 없다.
--   직원은 1회 한도와 하루 한도(한국 시간 0시~24시, 직원 한 명이 그날 지급한 합계)를 넘을 수 없다.
--   한도 값은 그 계정의 지급 권한(credits.grant)에 적힌 값이 있으면 그 값, 없으면 기본 한도(system_settings 'admin_credit_grant_limits').
--   기본 한도는 대표, 또는 대표가 새 권한 credits.limits.manage(크레딧 지급 한도 설정)를 준 관리자가 바꾼다.
-- 이 파일은 추가만 한다. 옛 지급 함수(5인자)는 그대로 두므로 적용해도 지금 코드는 그대로 동작한다.
--   새 코드가 배포된 뒤 옛 함수를 지우는 마이그레이션을 따로 둔다.
-- 만드는 것:
--   1. system_settings 'admin_credit_grant_limits' = {"per_grant": 10000, "per_day": 50000} 과,
--      그 행을 화면 세션(authenticated)으로 고치지 못하게 하는 RESTRICTIVE 정책(바꾸는 길은 아래 3번 함수뿐 — 작업 기록이 남는다).
--   2. grant_admin_credits(행위자, 대상, 수량, 원천 분류, 사유, 기록 세부, 요청 키) — 새 7인자 함수(옛 5인자와 인자 이름이 달라 PostgREST가 헷갈리지 않는다).
--      ① 인자 검증(사유 1~500자) ② 행위자 확인: 관리자가 아니면 거부. 본인 지급 거부.
--      ③ 직원이면: 그 계정의 credits.grant 권한 행을 FOR UPDATE로 잠근다(같은 직원의 동시 지급을 한 줄로 세운다 — 하루 합계를 두 요청이 동시에
--         "아직 한도 안"으로 읽는 일을 막는다). 함께 필요한 권한(members.view, credits.view)도 있어야 한다.
--         같은 요청 키의 거래가 이미 있으면(재요청) 한도를 보지 않는다. 아니면 1회 한도, 그리고 작업 기록에서 그 직원의 오늘 지급 합계 + 이번 수량 ≤ 하루 한도.
--      ④ 대상 프로필 잠금 → 같은 요청 키의 기존 거래가 있으면 그 결과를 돌려준다(내용이 다르면 ADMIN_GRANT_IDEMPOTENCY_CONFLICT — 기존 규칙 그대로).
--      ⑤ 지급(기존 로직 그대로: 원천·결제 이력·거래·잔액 캐시). 원장 설명은 "크레딧 N개 관리자 지급"(옛 함수는 "구매"로 적었다).
--      ⑥ 작업 기록 1행(같은 트랜잭션, action 'credit_grant', amount = 수량 — 하루 합산이 이 열을 읽는다).
--      잠금 순서: 행위자의 권한 행 → 대상 프로필 행(권한 교체 함수의 "권한 행 → 프로필 행"과 같은 방향). 행위자 프로필은 잠그지 않는다.
--   3. set_admin_credit_grant_limits(행위자, 1회, 하루) — 기본 한도를 바꾸고 전/후를 작업 기록에 남긴다. 1회 ≤ 하루여야 한다.
--      행위자는 대표, 또는 credits.limits.manage + credits.view를 받은 직원.
--   4. replace_admin_permission_grants의 권한 이름 목록에 'credits.limits.manage'를 더한다(목록 말고는 그대로 — 현재 정의 md5를 확인한 뒤 바꾼다).
-- 세 함수 모두 SECURITY DEFINER, search_path 고정, EXECUTE는 service_role만.
-- 예외 이름: ADMIN_GRANT_INPUT_INVALID / ADMIN_GRANT_SELF_TARGET / ADMIN_GRANT_ACTOR_NOT_ALLOWED / ADMIN_GRANT_LIMIT_NOT_SET
--            / ADMIN_GRANT_LIMIT_PER_GRANT limit=N / ADMIN_GRANT_LIMIT_PER_DAY limit=N used=N / ADMIN_GRANT_REPLAY_MISSING
--            / CREDIT_USER_NOT_FOUND / ADMIN_GRANT_IDEMPOTENCY_CONFLICT
--            / ADMIN_GRANT_LIMITS_INVALID / ADMIN_GRANT_LIMITS_ACTOR_NOT_ALLOWED / ADMIN_GRANT_LIMITS_NOT_FOUND
-- 한계: 기본 한도 행은 기존 조회 정책대로 로그인 사용자 누구나 읽을 수 있다(숫자 두 개, 권한을 주지 않는다).
-- 선행: 20261117110000(작업 기록), 20261117120000(권한 교체 함수), 20261117130000(관리자 역할 정합).
-- 잠금: system_settings에 정책을 더하며 ACCESS EXCLUSIVE를 잡고 커밋까지 유지한다(리허설 실측 적용 전체 약 60ms — 그동안 이 표를 읽는
--       페이지 렌더가 잠깐 기다린다). 잡지 못하면 최대 3초 대기 뒤 전체 취소. 확인 SELECT는 적용 호출과 나눠 실행한다.
--       그 밖에는 새 함수·설정 1행·함수 정의 교체.
-- 순서: 코드 배포보다 먼저 적용한다(새 코드는 새 함수를 부른다).
-- 되돌리기: supabase/rollback/20261118120000_admin_credit_grant_limits_down.sql (그 파일 머리말의 순서: 새 권한 회수 → 코드 되돌리기 → 실행)
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. 기본 한도 설정 행 --------------------------------------------------------------------------------------------
-- 행이 이미 있으면 실패한다(되돌리기가 이 행을 지우므로, 이 파일이 만든 행임을 보장한다).
INSERT INTO public.system_settings (key, value, description)
VALUES (
  'admin_credit_grant_limits',
  '{"per_grant": 10000, "per_day": 50000}'::jsonb,
  '직원 크레딧 수동 지급 기본 한도: per_grant(1회), per_day(하루, 한국 시간, 직원 한 명 기준). 계정별 한도가 있으면 그 값을 쓴다. 대표는 한도 없음. 변경은 set_admin_credit_grant_limits로만.'
);

-- 화면 세션으로는 이 행을 고치지 못한다(대표 포함 — 바꾸는 길은 작업 기록을 남기는 3번 함수뿐). 선례: system_settings_admin_alert_settings_no_client_write.
CREATE POLICY system_settings_admin_credit_grant_limits_no_client_write
  ON public.system_settings
  AS RESTRICTIVE
  FOR UPDATE
  USING (key <> 'admin_credit_grant_limits')
  WITH CHECK (key <> 'admin_credit_grant_limits');

-- 2. 지급 함수(행위자·한도·작업 기록) -----------------------------------------------------------------------------
CREATE FUNCTION public.grant_admin_credits(
  p_actor_id uuid,
  p_user_id uuid,
  p_amount integer,
  p_source_category text,
  p_reason text,
  p_details jsonb,
  p_operation_key text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_grant_admin_credits$
DECLARE
  v_now timestamptz := now();
  v_actor_is_admin boolean;
  v_actor_role text;
  v_grant_limits jsonb;
  v_default_limits jsonb;
  v_per_grant numeric;
  v_per_day numeric;
  v_used_today bigint;
  v_is_replay boolean := false;
  v_existing public.credit_transactions%ROWTYPE;
  v_existing_category text;
  v_existing_payment_method text;
  v_source_id uuid;
  v_new_balance integer;
BEGIN
  -- ① 인자
  IF p_actor_id IS NULL OR p_user_id IS NULL
     OR p_amount IS NULL OR p_amount < 1
     OR p_source_category IS NULL
     OR p_source_category NOT IN ('admin_grant', 'bonus', 'system_refund')
     OR p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 500
     OR (p_details IS NOT NULL AND jsonb_typeof(p_details) <> 'object')
     OR p_operation_key IS NULL
     OR length(p_operation_key) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'ADMIN_GRANT_INPUT_INVALID';
  END IF;
  IF p_actor_id = p_user_id THEN
    RAISE EXCEPTION 'ADMIN_GRANT_SELF_TARGET';
  END IF;

  -- ② 행위자: 관리자(대표 또는 직원)여야 한다. 행위자 프로필은 잠그지 않는다(크레딧 사용 함수와 잠금 순서가 얽히지 않게).
  SELECT p.is_admin, p.admin_role
    INTO v_actor_is_admin, v_actor_role
    FROM public.profiles p
   WHERE p.id = p_actor_id;
  IF NOT FOUND OR v_actor_is_admin IS NOT TRUE
     OR (v_actor_role IS DISTINCT FROM 'owner' AND v_actor_role IS DISTINCT FROM 'staff') THEN
    RAISE EXCEPTION 'ADMIN_GRANT_ACTOR_NOT_ALLOWED';
  END IF;

  -- ③ 직원의 한도. 대표는 한도가 없다.
  IF v_actor_role = 'staff' THEN
    -- 그 직원의 지급 권한 행을 잠근다: 같은 직원의 동시 지급이 여기서 차례를 기다리므로, 아래 오늘 합계는 앞 지급이 끝난 뒤의 값이다.
    SELECT g.limits
      INTO v_grant_limits
      FROM public.admin_permission_grants g
     WHERE g.user_id = p_actor_id AND g.permission = 'credits.grant'
       FOR UPDATE;
    IF NOT FOUND
       OR (SELECT count(*) FROM public.admin_permission_grants g
            WHERE g.user_id = p_actor_id AND g.permission IN ('members.view', 'credits.view')) <> 2 THEN
      RAISE EXCEPTION 'ADMIN_GRANT_ACTOR_NOT_ALLOWED';
    END IF;

    -- 같은 요청 키의 거래가 이미 있으면 재요청이다(한도와 무관하게 아래 ④에서 기존 결과를 돌려준다).
    v_is_replay := EXISTS (SELECT 1 FROM public.credit_transactions t WHERE t.operation_key = p_operation_key);

    IF NOT v_is_replay THEN
      SELECT s.value INTO v_default_limits
        FROM public.system_settings s
       WHERE s.key = 'admin_credit_grant_limits';

      -- 계정별 값이 있으면 그 값, 없으면 기본 한도. 계정에 키가 있는데 숫자가 아니면 기본 한도로 넘어가지 않고 거부한다(NULL → 아래 NOT_SET).
      v_per_grant := CASE
        WHEN v_grant_limits ? 'per_grant' THEN
          CASE WHEN jsonb_typeof(v_grant_limits -> 'per_grant') = 'number' THEN (v_grant_limits ->> 'per_grant')::numeric END
        WHEN jsonb_typeof(v_default_limits -> 'per_grant') = 'number' THEN (v_default_limits ->> 'per_grant')::numeric
      END;
      v_per_day := CASE
        WHEN v_grant_limits ? 'per_day' THEN
          CASE WHEN jsonb_typeof(v_grant_limits -> 'per_day') = 'number' THEN (v_grant_limits ->> 'per_day')::numeric END
        WHEN jsonb_typeof(v_default_limits -> 'per_day') = 'number' THEN (v_default_limits ->> 'per_day')::numeric
      END;
      IF v_per_grant IS NULL OR v_per_grant < 1 OR v_per_day IS NULL OR v_per_day < 1 THEN
        RAISE EXCEPTION 'ADMIN_GRANT_LIMIT_NOT_SET';
      END IF;

      IF p_amount > v_per_grant THEN
        RAISE EXCEPTION 'ADMIN_GRANT_LIMIT_PER_GRANT limit=%', v_per_grant;
      END IF;

      -- 오늘(한국 시간 0시부터) 이 직원이 지급한 합계. 작업 기록은 고칠 수 없는 표다(20261117110000).
      SELECT COALESCE(SUM(l.amount), 0)
        INTO v_used_today
        FROM public.admin_audit_log l
       WHERE l.actor_id = p_actor_id
         AND l.action = 'credit_grant'
         AND l.created_at >= (date_trunc('day', v_now AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul');

      IF v_used_today + p_amount > v_per_day THEN
        RAISE EXCEPTION 'ADMIN_GRANT_LIMIT_PER_DAY limit=% used=%', v_per_day, v_used_today;
      END IF;
    END IF;
  END IF;

  -- ④ 대상 프로필 잠금 → 같은 키의 재요청이면 기존 결과(사용자 조건 없이 찾는다).
  PERFORM 1
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CREDIT_USER_NOT_FOUND';
  END IF;

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
       OR v_existing_payment_method IS DISTINCT FROM 'admin_grant' THEN
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

  -- 재요청으로 보고 한도를 건너뛰었는데 기존 거래가 없으면 지급하지 않는다(한도를 거치지 않은 지급을 막는다).
  IF v_is_replay THEN
    RAISE EXCEPTION 'ADMIN_GRANT_REPLAY_MISSING';
  END IF;

  -- ⑤ 지급
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
    'admin_grant',
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
    format('크레딧 %s개 관리자 지급', to_char(p_amount, 'FM999,999,999,999')),
    v_source_id,
    p_operation_key
  );

  -- ⑥ 작업 기록(같은 트랜잭션). 하루 한도 합산이 amount를 읽는다.
  PERFORM public.record_admin_audit(
    p_actor_id,
    'credit_grant',
    'member',
    p_user_id::text,
    p_user_id,
    p_amount,
    btrim(p_reason),
    COALESCE(p_details, '{}'::jsonb) || jsonb_build_object(
      'source_category', p_source_category,
      'operation_key', p_operation_key,
      'new_balance', v_new_balance
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'already_granted', false,
    'source_id', v_source_id,
    'new_balance', v_new_balance
  );
END;
$fn_grant_admin_credits$;

-- 3. 기본 한도 변경 함수 ------------------------------------------------------------------------------------------
CREATE FUNCTION public.set_admin_credit_grant_limits(p_actor_id uuid, p_per_grant integer, p_per_day integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_set_admin_credit_grant_limits$
DECLARE
  v_is_admin boolean;
  v_role text;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_per_grant IS NULL OR p_per_day IS NULL
     OR p_per_grant < 1 OR p_per_day < 1 OR p_per_grant > p_per_day THEN
    RAISE EXCEPTION 'ADMIN_GRANT_LIMITS_INVALID';
  END IF;

  SELECT p.is_admin, p.admin_role
    INTO v_is_admin, v_role
    FROM public.profiles p
   WHERE p.id = p_actor_id;
  IF NOT FOUND OR v_is_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'ADMIN_GRANT_LIMITS_ACTOR_NOT_ALLOWED';
  END IF;
  IF v_role IS DISTINCT FROM 'owner' THEN
    IF v_role IS DISTINCT FROM 'staff'
       OR (SELECT count(*) FROM public.admin_permission_grants g
            WHERE g.user_id = p_actor_id AND g.permission IN ('credits.limits.manage', 'credits.view')) <> 2 THEN
      RAISE EXCEPTION 'ADMIN_GRANT_LIMITS_ACTOR_NOT_ALLOWED';
    END IF;
  END IF;

  SELECT s.value INTO v_before
    FROM public.system_settings s
   WHERE s.key = 'admin_credit_grant_limits'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_GRANT_LIMITS_NOT_FOUND';
  END IF;

  v_after := jsonb_build_object('per_grant', p_per_grant, 'per_day', p_per_day);

  UPDATE public.system_settings
     SET value = v_after,
         updated_at = now()
   WHERE key = 'admin_credit_grant_limits';

  PERFORM public.record_admin_audit(
    p_actor_id,
    'credit_grant_limits_update',
    'system_setting',
    'admin_credit_grant_limits',
    NULL,
    NULL,
    NULL,
    jsonb_build_object('before', v_before, 'after', v_after),
    NULL
  );

  RETURN jsonb_build_object('before', v_before, 'after', v_after);
END;
$fn_set_admin_credit_grant_limits$;

REVOKE ALL ON FUNCTION public.grant_admin_credits(uuid, uuid, integer, text, text, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_admin_credit_grant_limits(uuid, integer, integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.grant_admin_credits(uuid, uuid, integer, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_admin_credit_grant_limits(uuid, integer, integer) TO service_role;

-- 4. 권한 교체 함수의 권한 이름 목록에 'credits.limits.manage'를 더한다 ----------------------------------------------
-- 20261117120000의 정의를 그대로 옮기고 목록 끝에 한 이름만 더했다. 그 사이 정의가 바뀌었으면 전체를 취소한다.
DO $check_replace$
BEGIN
  IF md5(pg_get_functiondef('public.replace_admin_permission_grants(uuid,uuid,jsonb)'::regprocedure)) <> 'b04254ce36e496885442ceab4387b964' THEN
    RAISE EXCEPTION 'REPLACE_ADMIN_PERMISSION_GRANTS_DEFINITION_CHANGED';
  END IF;
END;
$check_replace$;

CREATE OR REPLACE FUNCTION public.replace_admin_permission_grants(p_actor_id uuid, p_user_id uuid, p_grants jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_replace_admin_permission_grants$
DECLARE
  v_is_admin boolean;
  v_role text;
  v_email text;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_user_id IS NULL OR p_grants IS NULL OR jsonb_typeof(p_grants) <> 'array' THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  IF p_actor_id = p_user_id THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_SELF_NOT_ALLOWED';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_grants) AS g
     WHERE jsonb_typeof(g) <> 'object'
        OR jsonb_typeof(g -> 'permission') IS DISTINCT FROM 'string'
        OR btrim(g ->> 'permission') = ''
        OR (g ? 'limits' AND jsonb_typeof(g -> 'limits') <> 'object')
  ) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  IF (SELECT count(DISTINCT btrim(g ->> 'permission')) <> count(*) FROM jsonb_array_elements(p_grants) AS g) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  -- 한도 값은 1 이상 2147483647 이하의 정수만(앱 ADMIN_PERMISSION_LIMIT_MAX와 같은 값). 지급 함수가 integer로 비교한다.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_grants) AS g,
           jsonb_each(COALESCE(g -> 'limits', '{}'::jsonb)) AS l(limit_key, limit_value)
     WHERE jsonb_typeof(l.limit_value) <> 'number'
        OR (l.limit_value #>> '{}')::numeric <> trunc((l.limit_value #>> '{}')::numeric)
        OR (l.limit_value #>> '{}')::numeric < 1
        OR (l.limit_value #>> '{}')::numeric > 2147483647
  ) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  -- 코드 목록(src/lib/admin-permissions.ts ADMIN_PERMISSIONS)과 같은 이름만 받는다.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_grants) AS g
     WHERE NOT (btrim(g ->> 'permission') = ANY (ARRAY[
       'support.manage', 'content.manage', 'orders.view', 'members.view', 'credits.view',
       'credits.grant', 'credits.revoke', 'refunds.market', 'refunds.payment',
       'products.edit', 'products.delete', 'storefront.edit', 'reviews.manage',
       'pricing.manage', 'site.manage', 'reports.view', 'credits.limits.manage'
     ]::text[]))
  ) THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_UNKNOWN';
  END IF;

  -- 행위자 확인은 행을 잠그며 한다(FOR SHARE): 확인한 직후 그 대표가 삭제·강등되는 틈을 막는다.
  PERFORM 1 FROM public.profiles p
   WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner'
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_ACTOR_NOT_OWNER';
  END IF;

  -- 잠금: 권한 행 → 프로필 행. 같은 계정의 동시 저장·해제는 프로필 행에서 차례를 기다린다.
  PERFORM 1 FROM public.admin_permission_grants g WHERE g.user_id = p_user_id FOR UPDATE;
  SELECT p.is_admin, p.admin_role, p.email
    INTO v_is_admin, v_role, v_email
    FROM public.profiles p
   WHERE p.id = p_user_id
     FOR UPDATE;
  IF NOT FOUND OR v_is_admin IS NOT TRUE OR v_role IS DISTINCT FROM 'staff' THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_TARGET_NOT_STAFF';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('permission', g.permission, 'limits', g.limits) ORDER BY g.permission), '[]'::jsonb)
    INTO v_before
    FROM public.admin_permission_grants g
   WHERE g.user_id = p_user_id;

  DELETE FROM public.admin_permission_grants g WHERE g.user_id = p_user_id;

  INSERT INTO public.admin_permission_grants (user_id, permission, limits, granted_by)
  SELECT p_user_id, btrim(g ->> 'permission'), COALESCE(g -> 'limits', '{}'::jsonb), p_actor_id
    FROM jsonb_array_elements(p_grants) AS g;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('permission', g.permission, 'limits', g.limits) ORDER BY g.permission), '[]'::jsonb)
    INTO v_after
    FROM public.admin_permission_grants g
   WHERE g.user_id = p_user_id;

  PERFORM public.record_admin_audit(
    p_actor_id,
    'admin_permissions_replace',
    'admin_account',
    p_user_id::text,
    NULL,
    NULL,
    NULL,
    jsonb_build_object('target_email', v_email, 'before', v_before, 'after', v_after),
    NULL
  );

  RETURN jsonb_build_object('before', v_before, 'after', v_after);
END;
$fn_replace_admin_permission_grants$;

NOTIFY pgrst, 'reload schema';
