-- 20261118120000_admin_credit_grant_limits 되돌리기.
-- 순서: ① 새 권한 화면에서 credits.limits.manage를 모두 회수한다(옛 화면은 이 권한을 보여 주지 않는다).
--         대상 확인: SELECT user_id FROM public.admin_permission_grants WHERE permission = 'credits.limits.manage';
--       ② 코드를 되돌린다(새 코드는 새 지급 함수·한도 변경 함수를 부른다 — 먼저 지우면 크레딧 지급이 모두 실패한다).
--       ③ 이 파일을 실행한다.
--       ④ 되돌린 뒤 옛 코드는 직원의 1회 한도를 필수로 본다. 새 화면에서 한도를 비워 둔 직원(credits.grant limits = {})은
--         지급이 거부되므로, 대표가 그 직원의 1회·하루 한도를 다시 입력한다.
-- 하는 일: 새 지급 함수(7인자)·한도 변경 함수 삭제, 기본 한도 설정 행과 그 쓰기 금지 정책 삭제,
--          권한 교체 함수의 이름 목록을 20261117120000 그대로 되돌린다(적용 직후 정의일 때만).
-- 남는 것: 새 함수로 지급한 크레딧·거래·작업 기록은 그대로 남는다(지우지 않는다). 옛 지급 함수(5인자)는 이 마이그레이션이 건드리지 않았다.
-- 확인: credits.limits.manage 권한을 받은 계정이 있으면 멈춘다(권한 화면에서 먼저 회수한다 — 남겨 두면 코드 목록에 없는 권한 행이 된다).
-- 반드시 한 트랜잭션으로 실행한다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $precheck$
BEGIN
  IF EXISTS (SELECT 1 FROM public.admin_permission_grants g WHERE g.permission = 'credits.limits.manage') THEN
    RAISE EXCEPTION 'ROLLBACK_PRECHECK: revoke credits.limits.manage grants first';
  END IF;
  IF md5(pg_get_functiondef('public.replace_admin_permission_grants(uuid,uuid,jsonb)'::regprocedure)) <> 'dcb2155fae26443c98231627d102a821' THEN
    RAISE EXCEPTION 'ROLLBACK_PRECHECK: replace_admin_permission_grants definition changed';
  END IF;
END;
$precheck$;

DROP FUNCTION public.grant_admin_credits(uuid, uuid, integer, text, text, jsonb, text);
DROP FUNCTION public.set_admin_credit_grant_limits(uuid, integer, integer);

DROP POLICY system_settings_admin_credit_grant_limits_no_client_write ON public.system_settings;
DELETE FROM public.system_settings WHERE key = 'admin_credit_grant_limits';

-- 권한 교체 함수: 20261117120000의 정의 그대로.
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
       'pricing.manage', 'site.manage', 'reports.view'
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
