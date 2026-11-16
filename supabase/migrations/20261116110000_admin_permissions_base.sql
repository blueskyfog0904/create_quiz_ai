-- 관리자 계정별 권한의 바탕(계획 4-1절, DB-P1).
-- 배경: 지금은 profiles.is_admin=true인 계정이면 모든 관리자 기능을 쓴다. 대표가 계정마다 권한을 주는 구조로 바꾸기 위한 첫 단계다.
-- 이 파일은 추가만 한다. 기존 정책·함수·화면은 아무것도 이 파일이 만든 것을 쓰지 않으므로, 적용해도 동작은 바뀌지 않는다.
-- 만드는 것:
--   profiles.admin_role  'owner'(대표 관리자: 모든 권한) | 'staff'(일반 관리자: 받은 권한만) | NULL
--                        is_admin=true인데 NULL이면 권한 0개 staff로 취급한다(옛 코드로 만들어진 계정).
--   admin_permission_grants  누가 어떤 권한을 받았는지와 한도(데이터). 권한 항목의 목록·의존은 코드(src/lib/admin-permissions.ts).
--                            permission 값은 CHECK로 묶지 않는다(항목을 더할 때마다 마이그레이션이 필요해지므로). 코드 목록에 없는 값은 서버가 무시한다.
--   is_owner()               로그인한 사용자가 대표 관리자인가.
--   has_admin_permission(p)  로그인한 사용자가 대표이거나, 관리자이면서 그 권한을 받았는가.
-- 기존 관리자: 지금 is_admin=true인 계정은 모두 'owner'로 시작한다(사용자 결정 Q-J, 2026-11-13). 조정은 대표가 권한 부여 화면에서 한다.
-- 쓰기: admin_permission_grants는 service_role로만 쓴다(쓰기 정책 없음). profiles.admin_role은 authenticated에 UPDATE 권한이 없고
--       INSERT·UPDATE 정책도 없어 스스로 올릴 수 없다.
-- 재귀: 두 함수는 SECURITY DEFINER(소유자 postgres)이고 FORCE RLS 표가 없어, 정책 안에서 불려도 profiles·grants를 정책 없이 읽는다.
-- 잠금: profiles에 열과 CHECK를 더할 때 ACCESS EXCLUSIVE 잠금을 잡아 이 트랜잭션이 끝날 때까지 유지한다(표를 다시 쓰지 않아 짧다. 최대 3초 대기).
-- 뒤 단계: is_admin과 admin_role을 묶는 CHECK(DB-P2), 기존 쓰기 정책을 권한별로 바꾸기(DB-P3).
-- 되돌리기: supabase/rollback/20261116110000_admin_permissions_base_down.sql (부여된 권한이 모두 사라진다)
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. 역할 열 ----------------------------------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN admin_role text,
  ADD CONSTRAINT profiles_admin_role_check CHECK (admin_role IN ('owner', 'staff'));

UPDATE public.profiles
   SET admin_role = 'owner'
 WHERE is_admin IS TRUE;

-- 대표 관리자가 한 명도 없으면 뒤 단계에서 권한을 줄 사람이 없다.
DO $owners$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE is_admin IS TRUE AND admin_role = 'owner') THEN
    RAISE EXCEPTION 'ADMIN_OWNER_MISSING';
  END IF;
END;
$owners$;

-- 2. 권한 표 ----------------------------------------------------------------------------------------------------
-- granted_by에는 FK를 두지 않는다(권한을 준 관리자 계정을 지울 수 있어야 한다. 부여 이력은 작업 기록에 남긴다).
-- limits 예: credits.grant → {"per_grant": 1000, "per_day": 5000}, refunds.market → {"per_request": 5000}. 키가 없으면 불가로 판정한다(코드).
CREATE TABLE public.admin_permission_grants (
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  permission text NOT NULL,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  granted_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission),
  CONSTRAINT admin_permission_grants_permission_check CHECK (permission <> ''),
  CONSTRAINT admin_permission_grants_limits_check CHECK (jsonb_typeof(limits) = 'object')
);

ALTER TABLE public.admin_permission_grants ENABLE ROW LEVEL SECURITY;

-- 새 표에는 기본 권한으로 anon·authenticated·service_role 모두 ALL이 붙는다. 전부 걷고 필요한 것만 준다.
REVOKE ALL ON TABLE public.admin_permission_grants FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.admin_permission_grants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_permission_grants TO service_role;

-- 3. 함수 -------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_is_owner$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.is_admin IS TRUE
       AND p.admin_role = 'owner'
  );
$fn_is_owner$;

CREATE FUNCTION public.has_admin_permission(p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_has_admin_permission$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.is_admin IS TRUE
       AND (
         p.admin_role = 'owner'
         OR EXISTS (
           SELECT 1
             FROM public.admin_permission_grants g
            WHERE g.user_id = p.id
              AND g.permission = p_permission
         )
       )
  );
$fn_has_admin_permission$;

-- 로그인한 세션(정책 안에서 쓰인다)과 service_role만. service_role로 부르면 auth.uid()가 없어 항상 false다.
REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.has_admin_permission(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_admin_permission(text) TO authenticated, service_role;

-- 4. 조회 정책 --------------------------------------------------------------------------------------------------
-- 본인이 받은 권한과, 대표는 전체를 읽는다. 쓰기 정책은 두지 않는다(service_role로만).
CREATE POLICY admin_permission_grants_select ON public.admin_permission_grants
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_owner()));

NOTIFY pgrst, 'reload schema';
