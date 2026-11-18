-- 20261118140000_questions_admin_uploaded_owner_only 되돌리기: 더한 RESTRICTIVE 정책 2개를 지운다.
-- 되돌리면 일반 회원이 다시 자기 세션으로 source='admin_uploaded' 문제를 넣거나 바꿀 수 있게 된다.
-- 반드시 한 트랜잭션으로 실행한다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DROP POLICY questions_admin_uploaded_insert_owner_only ON public.questions;
DROP POLICY questions_admin_uploaded_update_owner_only ON public.questions;

NOTIFY pgrst, 'reload schema';
