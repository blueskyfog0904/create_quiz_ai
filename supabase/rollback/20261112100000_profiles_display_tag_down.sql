-- 20261112100000_profiles_display_tag 되돌리기.
-- 먼저 display_tag를 읽는 코드를 되돌려 배포한 뒤 실행한다(컬럼이 없으면 그 코드의 조회가 실패한다).
-- 저장된 태그는 사라지며, 다시 적용하면 새 태그가 뽑힌다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.profiles DROP COLUMN IF EXISTS display_tag;
DROP FUNCTION IF EXISTS public.generate_member_display_tag();
