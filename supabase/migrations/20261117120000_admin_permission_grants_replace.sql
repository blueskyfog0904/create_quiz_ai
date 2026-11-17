-- 관리자 권한 부여·회수와 권한 해제를 작업 기록과 한 트랜잭션으로 처리하는 함수, 권한 묶음 설정 행(계획 U3-4, 4-1절; 작업계획서 W4-6).
-- 선행: 20261116110000_admin_permissions_base(admin_role, admin_permission_grants), 20261117110000_admin_audit_log(작업 기록).
-- 이 파일은 추가만 한다. 기존 표·정책·함수는 바꾸지 않는다.
-- 만드는 것:
--   replace_admin_permission_grants(행위자, 대상, 권한 목록)  대상 계정의 권한을 통째로 바꾸고(삭제 + 삽입) 전/후를 작업 기록에 1행 남긴다.
--   revoke_admin_account(행위자, 대상)                        대상 계정의 관리자 자격을 해제한다(is_admin=false, admin_role=NULL, 받은 권한 삭제)
--                                                             + 작업 기록 1행. 계정(로그인 정보)과 그 계정이 남긴 이력은 지우지 않는다.
--   system_settings 'admin_permission_presets'                권한 부여 화면의 "묶음" 버튼 구성(데이터). 버튼은 체크만 채우고 저장은 대표가 한다.
-- 두 함수 공통:
--   service_role만 부른다(쓰기 정책이 없는 admin_permission_grants를 고치는 유일한 길). auth.uid()가 없으므로 행위자는 인자로 받고,
--   함수 안에서 행위자가 대표(is_admin + admin_role='owner')인지, 대상이 일반 관리자(is_admin + admin_role='staff')인지 다시 확인한다.
--   → 대표 계정은 대상이 될 수 없으므로 "마지막 대표가 사라지는" 경우가 생기지 않는다. 본인도 대상이 될 수 없다.
--   행위자 확인은 그 프로필 행을 FOR SHARE로 잠그며 한다(확인 직후 그 대표가 삭제·강등되는 틈을 막는다).
--   잠금 순서: 대상의 권한 행 → 대상의 프로필 행(뒤 단계 지급 함수 DB-6'의 "권한 행 → 프로필 행"과 같은 순서).
--   권한 항목 이름·의존·한도 규칙은 코드(src/lib/admin-permissions.ts)에 있어 저장 route가 먼저 검증한다.
--   함수는 모양(배열·중복·빈 값), 한도 값(1~2147483647 정수), 권한 이름만 다시 본다. 이름 목록은 코드 목록과 같은 16개를 적어 두고 계약 테스트
--   (tests/admin-permission-grants-contract.test.mjs)가 두 목록이 같은지 맞춰 본다 → 권한 항목을 더하면 이 함수도 새 마이그레이션으로 바꾼다.
--   모르는 이름을 막는 이유: 권한 표는 permission을 CHECK로 묶지 않아, 'owner' 같은 값이 들어가면 뒤 단계 정책(DB-P3)의
--   has_admin_permission('owner')가 참이 된다. 의존 빠짐·한도 누락은 DB에서 다시 막지 않는다 — 가드가 의존이 빠진 권한은
--   없는 것으로, 한도 값이 없는 권한은 불가로 판정하므로(코드) 잘못 저장돼도 권한이 넓어지지 않는다.
-- 예외 이름: ADMIN_PERMISSION_INVALID_ARGUMENT / ADMIN_PERMISSION_UNKNOWN / ADMIN_PERMISSION_SELF_NOT_ALLOWED
--            / ADMIN_PERMISSION_ACTOR_NOT_OWNER / ADMIN_PERMISSION_TARGET_NOT_STAFF
-- 설정 행의 한계: system_settings의 기존 정책은 로그인 사용자 누구나 읽고 관리자 누구나 고칠 수 있다. 묶음은 체크를 채울 뿐
--   권한을 주지 않으므로(저장은 대표가, 서버가 다시 검증) 이 파일은 정책을 더하지 않는다.
-- 잠금: 새 함수와 설정 1행만 만든다. 기존 표의 구조를 바꾸지 않는다.
-- 순서: 코드 배포보다 먼저 적용한다. 코드가 먼저 배포되면 권한 저장·권한 해제가 오류 안내로 끝나고(아무것도 바뀌지 않는다) 묶음 버튼이 보이지 않는다.
-- 되돌리기: supabase/rollback/20261117120000_admin_permission_grants_replace_down.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. 권한 통째 교체 ---------------------------------------------------------------------------------------------
-- p_grants 예: [{"permission": "orders.view", "limits": {}}, {"permission": "refunds.market", "limits": {"per_request": 5000}}]
-- 빈 배열이면 권한을 모두 회수한다(관리자 자격은 유지 — 권한 0개 일반 관리자).
CREATE FUNCTION public.replace_admin_permission_grants(p_actor_id uuid, p_user_id uuid, p_grants jsonb)
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

-- 2. 권한 해제 --------------------------------------------------------------------------------------------------
-- 해제된 계정은 관리자 화면에 들어올 수 없고(검사가 요청마다 DB를 읽는다) 관리자 목록에서 빠진다. 다시 주는 화면은 없다(새 아이디 발급, 결정 Q-12).
CREATE FUNCTION public.revoke_admin_account(p_actor_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_revoke_admin_account$
DECLARE
  v_is_admin boolean;
  v_role text;
  v_email text;
  v_before jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_INVALID_ARGUMENT';
  END IF;
  IF p_actor_id = p_user_id THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_SELF_NOT_ALLOWED';
  END IF;
  -- 행위자 확인은 행을 잠그며 한다(FOR SHARE): 확인한 직후 그 대표가 삭제·강등되는 틈을 막는다.
  PERFORM 1 FROM public.profiles p
   WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner'
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADMIN_PERMISSION_ACTOR_NOT_OWNER';
  END IF;

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
  UPDATE public.profiles p
     SET is_admin = false,
         admin_role = NULL
   WHERE p.id = p_user_id;

  PERFORM public.record_admin_audit(
    p_actor_id,
    'admin_account_revoke',
    'admin_account',
    p_user_id::text,
    NULL,
    NULL,
    NULL,
    jsonb_build_object('target_email', v_email, 'before', v_before),
    NULL
  );

  RETURN jsonb_build_object('before', v_before);
END;
$fn_revoke_admin_account$;

REVOKE ALL ON FUNCTION public.replace_admin_permission_grants(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_admin_account(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.replace_admin_permission_grants(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_admin_account(uuid, uuid) TO service_role;

-- 3. 권한 묶음 설정 ---------------------------------------------------------------------------------------------
-- 묶음 구성은 데이터라 코드에 두지 않는다. 바꿀 때는 이 행의 value를 고친다. 코드 목록에 없는 권한 이름은 화면이 무시한다.
-- 한도가 있는 권한(예: refunds.market)은 묶음이 체크만 채우고, 한도 숫자는 대표가 입력해야 저장된다.
-- 행이 이미 있으면 실패한다(되돌리기가 이 행을 지우므로, 이 파일이 만든 행임을 보장한다).
INSERT INTO public.system_settings (key, value, description)
VALUES (
  'admin_permission_presets',
  '{"presets": [{"name": "CS 기본", "permissions": ["support.manage", "orders.view", "members.view", "credits.view", "refunds.market"]}]}'::jsonb,
  '관리자 권한 부여 화면의 묶음 버튼: presets[{name, permissions[]}]. 버튼은 체크만 채우고 저장은 대표가 한다.'
);

NOTIFY pgrst, 'reload schema';
