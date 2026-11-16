-- 20261116110000_admin_permissions_base 되돌리기: 계정별 권한의 바탕(역할 열·권한 표·함수 2개)을 없앤다.
-- 먼저 admin_role·admin_permission_grants·is_owner()·has_admin_permission()을 쓰는 앱 코드와 뒤 단계 마이그레이션(DB-P2, DB-P3)을 되돌린다.
-- 정책이 두 함수를 쓰고 있으면 DROP FUNCTION이 실패한다(그 정책을 먼저 되돌려야 한다는 뜻이다).
-- 막아 주지 않는 것: 본문에서만 새 표·함수를 쓰는 plpgsql 함수(실행할 때 깨진다), admin_role을 쓰는 다른 CHECK(열과 함께 조용히 사라진다). 순서는 사람이 지킨다.
-- 사라지는 것: 계정별로 부여된 권한 전부, 대표·일반 관리자 구분. is_admin 값은 그대로라 관리자 로그인은 유지된다.
-- profiles에서 열을 뺄 때 ACCESS EXCLUSIVE 잠금을 잠깐 잡는다(최대 3초 대기).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DROP POLICY admin_permission_grants_select ON public.admin_permission_grants;
DROP FUNCTION public.has_admin_permission(text);
DROP FUNCTION public.is_owner();
DROP TABLE public.admin_permission_grants;

ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_admin_role_check,
  DROP COLUMN admin_role;

NOTIFY pgrst, 'reload schema';
