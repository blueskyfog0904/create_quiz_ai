-- 관리자 여부(is_admin)와 관리자 종류(admin_role)를 묶고, 대표 관리자가 0명이 되지 않게 막는다(계획 4-1절, DB-P2).
-- 배경: DB-P1(20261116110000)에서 admin_role을 더했지만 is_admin과 따로 놀 수 있었다. 권한 함수(is_owner, has_admin_permission)와
--       앱의 권한 판정은 "관리자면 admin_role이 있고, 관리자가 아니면 없다"를 전제로 한다.
--       또 관리자 계정 삭제(src/lib/admin-accounts-server.ts deleteAdminAccount)는 관리자 수(2명 이상)만 세고 대표 수는 세지 않아,
--       대표가 두 명뿐일 때 둘이 동시에 서로를 지우면 대표가 0명이 될 수 있다(권한을 줄 사람이 사라진다).
-- 만드는 것:
--   CHECK profiles_admin_role_matches_is_admin  (is_admin IS TRUE) = (admin_role IS NOT NULL)
--         비관리자(false·NULL)는 admin_role NULL, 관리자는 'owner'|'staff'(값 목록은 기존 profiles_admin_role_check).
--   트리거 profiles_keep_admin_owner  대표 행을 지우거나(회원 삭제 연쇄 포함) 대표가 아니게 바꿀 때, 다른 대표가 남는지 확인한다.
--         동시성: 대표를 빼는 트랜잭션끼리는 트랜잭션 단위 advisory lock으로 한 줄로 세운다. 뒤에 온 쪽은 앞 쪽이 커밋한 결과를
--         새 스냅샷으로 다시 읽으므로(READ COMMITTED, VOLATILE 트리거 함수), 둘이 서로를 지우면 뒤에 온 쪽이 ADMIN_LAST_OWNER로 실패한다.
--         한 문장으로 여러 대표를 지울 때도 앞 행의 삭제가 뒤 행의 확인에 보인다.
--         한계: REPEATABLE READ 이상에서는 트랜잭션 스냅샷이 고정돼 이 확인이 앞 쪽 커밋을 못 본다. 앱·GoTrue·PostgREST는 READ COMMITTED다.
--   표 권한 정리: profiles의 anon·authenticated INSERT·DELETE·TRUNCATE를 걷는다. 이 권한을 쓰는 정책이 없어(INSERT·DELETE 정책 없음)
--         지금도 RLS가 막고 있었다. 프로필 생성은 handle_new_user(SECURITY DEFINER), 삭제는 auth.users 연쇄(service role)로만 일어난다.
--         SELECT·REFERENCES·TRIGGER는 그대로 둔다(SELECT는 본인·관리자 조회 정책이 쓴다). UPDATE는 원래 없다.
-- 앞서 확인한 것(2026-11-17, 운영 DB 읽기):
--   현재 행: false/NULL 11, true/'owner' 4 — 제약을 어기는 행 0건(회원 수는 가입에 따라 바뀐다. 1절이 적용 시점에 다시 센다).
--   쓰는 코드: 가입 트리거 handle_new_user는 is_admin·admin_role을 넣지 않는다(기본값 false·NULL).
--             관리자 생성 src/lib/admin-accounts-server.ts의 createAdminAccount는 is_admin=true, admin_role='staff'를
--             한 UPDATE로 쓴다(커밋 f058d30, push됨).
--             권한 해제 revoke_admin_account(20261117120000)는 is_admin=false, admin_role=NULL을 한 UPDATE로 쓰고, staff만 대상이다.
--             관리자 삭제는 auth.users 삭제의 연쇄라 행이 통째로 사라진다.
-- 선행: 20261116110000_admin_permissions_base. 관리자 생성 코드(f058d30)가 배포된 뒤 적용한다(옛 코드는 admin_role 없이 is_admin만 켜서 이 제약에 걸린다).
-- 영향: 마지막 대표의 삭제·강등이 DB에서 거부된다. 관리자 계정 화면에서 대표를 지우려다 이 오류가 나면 GoTrue가 500으로 돌려주고,
--       화면은 "관리자 계정을 삭제하지 못했습니다: …"를 보인다(삭제 전 generate_listboard_* 참조 해제는 이미 끝난 뒤다 — 무해).
-- 잠금: CHECK를 더하며 profiles에 ACCESS EXCLUSIVE를 잡고 전체 행(지금 15행)을 검사한다(짧다). 트리거 생성은 SHARE ROW EXCLUSIVE. 최대 3초 대기.
-- 되돌리기: supabase/rollback/20261117130000_admin_role_constraints_down.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. 어긋난 행 확인 -----------------------------------------------------------------------------------------------
-- ADD CONSTRAINT도 실패하지만, 몇 행이 어긋났는지 알 수 있게 먼저 센다.
DO $mismatch$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM public.profiles
   WHERE (is_admin IS TRUE) <> (admin_role IS NOT NULL);
  IF v_count > 0 THEN
    RAISE EXCEPTION 'ADMIN_ROLE_MISMATCH_ROWS: %', v_count;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE is_admin IS TRUE AND admin_role = 'owner') THEN
    RAISE EXCEPTION 'ADMIN_OWNER_MISSING';
  END IF;
END;
$mismatch$;

-- 2. 정합 제약 --------------------------------------------------------------------------------------------------
-- is_admin이 NULL이면 비관리자로 본다(is_admin(), is_owner(), has_admin_permission()이 모두 IS TRUE로 판정한다).
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_admin_role_matches_is_admin CHECK ((is_admin IS TRUE) = (admin_role IS NOT NULL));

-- 3. 마지막 대표 보호 -------------------------------------------------------------------------------------------
-- SECURITY DEFINER: 확인 쿼리가 실행 역할의 RLS·표 권한과 무관하게 대표 행을 모두 보게 한다.
--   auth.users 삭제의 연쇄(ON DELETE CASCADE)는 참조 표(profiles) 소유자 권한으로 실행되므로 그 경로만이면 필요 없다.
--   그러나 profiles를 직접 고치는 역할이 RLS를 받으면(authenticated 등) 다른 대표가 정책에 가려 "남은 대표 없음"으로 잘못 거부되고,
--   SELECT 권한이 없는 역할(예: supabase_auth_admin — 운영 DB 확인)이면 확인 쿼리 자체가 권한 오류로 실패한다.
CREATE FUNCTION public.keep_admin_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_keep_admin_owner$
BEGIN
  IF OLD.is_admin IS TRUE
     AND OLD.admin_role = 'owner'
     AND (TG_OP = 'DELETE' OR NEW.is_admin IS NOT TRUE OR NEW.admin_role IS DISTINCT FROM 'owner') THEN
    -- 대표를 빼는 트랜잭션끼리 한 줄로 세운다(커밋·롤백 때 풀린다).
    PERFORM pg_advisory_xact_lock(hashtext('public.profiles:admin_owner'));
    IF NOT EXISTS (
      SELECT 1
        FROM public.profiles p
       WHERE p.id <> OLD.id
         AND p.is_admin IS TRUE
         AND p.admin_role = 'owner'
    ) THEN
      RAISE EXCEPTION 'ADMIN_LAST_OWNER';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$fn_keep_admin_owner$;

-- 트리거 함수는 직접 부를 일이 없다(트리거 실행에는 EXECUTE 권한이 필요 없다).
REVOKE ALL ON FUNCTION public.keep_admin_owner() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER profiles_keep_admin_owner
  BEFORE UPDATE OF is_admin, admin_role OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.keep_admin_owner();

-- 4. 표 권한 정리 -----------------------------------------------------------------------------------------------
REVOKE INSERT, DELETE, TRUNCATE ON TABLE public.profiles FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
