-- 20261113180000_payment_sales_stop_resume 되돌리기.
-- 먼저 "충전 판매 중지" 버튼 코드를 되돌려 배포한 뒤 실행한다. 판매 스위치의 현재 값은 바꾸지 않는다.
-- 실행 전에 스위치가 켜져 있는지 확인한다(꺼진 채로 함수를 지우면 재개는 직접 UPDATE만 남는다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DROP FUNCTION public.resume_payment_sales(text, text, text);
DROP FUNCTION public.payapp_sales_resume_blockers();
DROP FUNCTION public.stop_payment_sales(text, text, text);

NOTIFY pgrst, 'reload schema';
