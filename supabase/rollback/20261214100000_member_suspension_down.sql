-- 12번 묶음 되돌리기(supabase/migrations/20261214100000_member_suspension.sql 의 down). 계획 docs/plan-bundle12-member-suspension.md 4-6·10절.
-- 코드를 12번 전으로 되돌린 뒤에만 실행한다(새 코드는 함수가 없으면 구매를 막는다 — 10절). 13번 묶음이 적용돼 있으면 13번을 먼저 되돌린다.
-- 머리 확인(하나라도 어기면 멈춤):
--   ① 활성 정지 0건 ② scope = 'login_blocked' 이면서 banned_until 이 남은 탈퇴 안 한 회원 0건 ③ members.memo·members.suspend 권한 행 0건
--   ④ replace_admin_permission_grants 의 지금 md5(prosrc)가 12번 적용 뒤 값(d6cd294f…)과 같음 — 다르면 뒤 묶음이 다시 정의한 것이므로 멈춘다
--   ⑤ 13번 마이그레이션 version(20261215100000·110000·120000·130000, 시각이 바뀌어도 12번 뒤 이름에 bundle13 이 든 것)과 13번 표 admin_member_access_log 가 없음
-- 지난 정지 이력·메모가 있으면 대표가 내보내기를 확인한 뒤에만 지운다(아래 두 상수를 true 로 바꿔 실행). 뼈대는 작업 기록에 남는다(4-3).
--   내보내기 파일 규칙(4-6): 탈퇴 회원 행은 내보내지 않는다(이미 지워짐). 표를 다시 만들 때 되돌려 넣은 뒤 바로 파기하고, 다시 만들지 않기로
--   하면 그때 파기한다. 보관 중에 그 회원이 탈퇴하면 그 회원 행을 파일에서 지운다. 파일은 대표만 갖고 런북 RB-12 에 파기 날짜를 적는다.
-- 순서: 트리거 → 함수 → replace_admin_permission_grants 를 20261118120000 정의로 되돌림 → 정책 → 설정 행 → 표.
-- 이 파일은 이력 행을 지우지 않는다. 다시 적용하려면 같은 거래에서 schema_migrations 의 '20261214100000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다.
-- 잠금: profiles 트리거 삭제(ACCESS EXCLUSIVE), system_settings 정책 삭제(ACCESS EXCLUSIVE). 새벽 짧은 창에서 실행한다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $precheck_member_suspension_down$
DECLARE
  c_suspensions_export_confirmed constant boolean := false;
  c_notes_export_confirmed constant boolean := false;
BEGIN
  IF to_regclass('public.member_suspensions') IS NULL OR to_regclass('public.member_admin_notes') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 12 tables missing (not the bundle 12 state)';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations m
              WHERE m.version IN ('20261215100000', '20261215110000', '20261215120000', '20261215130000')
                 OR (m.version > '20261214100000' AND m.name LIKE '%bundle13%'))
     OR to_regclass('public.admin_member_access_log') IS NOT NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 13 is applied — roll back bundle 13 first';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.replace_admin_permission_grants(uuid,uuid,jsonb)'))
     IS DISTINCT FROM 'd6cd294fb5cb60c7e17356c895bf259b' THEN
    RAISE EXCEPTION 'DOWN PRECHECK: replace_admin_permission_grants is not the bundle 12 definition (%)',
      (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure('public.replace_admin_permission_grants(uuid,uuid,jsonb)'));
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_suspensions s WHERE s.lifted_at IS NULL AND (s.ends_at IS NULL OR s.ends_at > now())) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: active suspensions exist — lift them first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_suspensions s
               JOIN auth.users u ON u.id = s.user_id
               JOIN public.profiles p ON p.id = s.user_id
              WHERE s.scope = 'login_blocked' AND p.withdrawn_at IS NULL
                AND u.banned_until IS NOT NULL AND u.banned_until > now()) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: login_blocked member still banned (banned_until) — check the runbook first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.admin_permission_grants g WHERE g.permission IN ('members.memo', 'members.suspend')) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: members.memo / members.suspend grants exist — owner revokes them first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_suspensions) AND NOT c_suspensions_export_confirmed THEN
    RAISE EXCEPTION 'DOWN PRECHECK: suspension history exists — owner confirms export (c_suspensions_export_confirmed)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_admin_notes) AND NOT c_notes_export_confirmed THEN
    RAISE EXCEPTION 'DOWN PRECHECK: admin notes exist — owner confirms export (c_notes_export_confirmed)';
  END IF;
END;
$precheck_member_suspension_down$;

-- [12번] 시작: 되돌림 ----------------------------------------------------------------------------------------------
-- 1. 탈퇴 트리거(profiles)
DROP TRIGGER member_suspension_withdrawal_cleanup ON public.profiles;

-- 2. 함수(쓰기 막기 트리거는 표와 함께 지워진다)
DROP FUNCTION public.get_my_member_gate();
DROP FUNCTION public.save_member_suspension_policy(uuid, integer, jsonb);
DROP FUNCTION public.member_refund_deadlines(uuid);
DROP FUNCTION public.member_active_suspension(uuid);
DROP FUNCTION public.redact_member_admin_note(uuid, uuid);
DROP FUNCTION public.delete_member_admin_note(uuid, uuid);
DROP FUNCTION public.add_member_admin_note(uuid, uuid, text);
DROP FUNCTION public.mark_member_suspension_seen(uuid);
DROP FUNCTION public.record_member_suspension_notice(uuid, uuid, text, timestamptz, text);
DROP FUNCTION public.lift_member_suspension(uuid, uuid, text);
DROP FUNCTION public.suspend_member(uuid, uuid, text, boolean, text, text, text, timestamptz, text);
DROP FUNCTION public.member_suspension_actor_allowed(uuid, text);
DROP FUNCTION public.member_suspension_withdrawal_cleanup();

-- 3. 권한 교체 함수: 20261118120000 정의 그대로(본문 md5(prosrc) 54540b6b…)
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
-- 4. 정책 → 설정 행 → 표(쓰기 막기 트리거·함수 포함)
DROP POLICY system_settings_member_suspension_policy_no_client_write ON public.system_settings;
DELETE FROM public.system_settings WHERE key = 'member_suspension_policy';
DROP TABLE public.member_admin_notes;
DROP TABLE public.member_suspensions;
DROP FUNCTION public.guard_member_admin_notes_mutation();
DROP FUNCTION public.guard_member_suspensions_mutation();
-- [12번] 끝 -----------------------------------------------------------------------------------------------------

DO $verify_member_suspension_down$
BEGIN
  IF to_regclass('public.member_suspensions') IS NOT NULL OR to_regclass('public.member_admin_notes') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (
          'member_suspension_actor_allowed', 'suspend_member', 'lift_member_suspension', 'record_member_suspension_notice',
          'mark_member_suspension_seen', 'add_member_admin_note', 'delete_member_admin_note', 'redact_member_admin_note',
          'member_active_suspension', 'member_refund_deadlines', 'get_my_member_gate', 'save_member_suspension_policy',
          'guard_member_suspensions_mutation', 'guard_member_admin_notes_mutation', 'member_suspension_withdrawal_cleanup'))
     OR EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_suspension_policy')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
                 AND policyname = 'system_settings_member_suspension_policy_no_client_write')
     OR (SELECT array_agg(t.tgname::text ORDER BY t.tgname) FROM pg_trigger t
          WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal) IS DISTINCT FROM ARRAY['profiles_keep_admin_owner'] THEN
    RAISE EXCEPTION 'DOWN VERIFY: bundle 12 objects remain';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.replace_admin_permission_grants(uuid,uuid,jsonb)'::regprocedure)
     IS DISTINCT FROM '54540b6b0286f81f243575f1c03a568c'
     OR md5(pg_get_functiondef('public.replace_admin_permission_grants(uuid,uuid,jsonb)'::regprocedure)) <> 'dcb2155fae26443c98231627d102a821' THEN
    RAISE EXCEPTION 'DOWN VERIFY: replace_admin_permission_grants is not the 20261118120000 definition';
  END IF;
END;
$verify_member_suspension_down$;

NOTIFY pgrst, 'reload schema';
