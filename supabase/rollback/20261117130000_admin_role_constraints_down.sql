-- 20261117130000_admin_role_constraints 되돌리기: is_admin–admin_role 정합 제약, 마지막 대표 보호 트리거, profiles 표 권한 회수를 없앤다.
-- 되돌린 뒤에는 관리자 계정 삭제가 대표 수를 세지 않으므로, 대표 두 명이 동시에 서로를 지우면 대표가 0명이 될 수 있다.
-- 표 권한은 적용 직전 값(2026-11-17 운영 DB 조회: anon·authenticated 모두 INSERT·DELETE·TRUNCATE 보유)으로 되돌린다.
-- 이 권한을 쓰는 INSERT·DELETE 정책은 없어서 되돌려도 RLS가 계속 막는다(TRUNCATE는 RLS를 타지 않지만 PostgREST로는 부를 수 없다).
-- profiles에서 제약·트리거를 뺄 때 ACCESS EXCLUSIVE 잠금을 잠깐 잡는다(최대 3초 대기).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

GRANT INSERT, DELETE, TRUNCATE ON TABLE public.profiles TO anon, authenticated;

DROP TRIGGER profiles_keep_admin_owner ON public.profiles;
DROP FUNCTION public.keep_admin_owner();

ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_admin_role_matches_is_admin;

NOTIFY pgrst, 'reload schema';
