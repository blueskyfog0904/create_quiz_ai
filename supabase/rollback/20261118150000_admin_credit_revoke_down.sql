-- 20261118150000_admin_credit_revoke 되돌리기: 회수 함수를 지운다.
-- 반드시 코드를 먼저 되돌린 뒤 실행한다(새 코드의 회수 화면이 이 함수를 부른다).
-- 이미 회수한 크레딧·거래·작업 기록은 그대로 남는다(되돌리지 않는다).
-- 반드시 한 트랜잭션으로 실행한다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DROP FUNCTION public.revoke_admin_credits(uuid, uuid, integer, text, text);

NOTIFY pgrst, 'reload schema';
