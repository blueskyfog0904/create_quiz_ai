-- 20261117110000_admin_audit_log 되돌리기: 작업 기록 표·기록 함수·조회용 보기를 없앤다.
-- 먼저 되돌릴 것: 20261117120000_admin_permission_grants_replace(그 함수들이 이 표에 적는다)와, 이 표에 적는 뒤 단계 함수(DB-6' 지급, DB-11' 회수).
-- 막아 주지 않는 것: 본문에서만 이 표·함수를 쓰는 plpgsql 함수(실행할 때 깨진다). 순서는 사람이 지킨다.
-- 앱 코드: 기록 호출은 실패를 무시하므로 그대로 두어도 기존 동작은 유지된다. 작업 기록 화면만 "불러오지 못했습니다"가 된다.
-- 사라지는 것: 쌓인 작업 기록 전부(되살릴 수 없다). 결제 쪽 조치 기록(payment_admin_actions)은 그대로다.
-- 수정 금지 트리거는 DROP TABLE을 막지 않는다(TRUNCATE·UPDATE·DELETE만 막는다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DROP VIEW public.admin_audit_timeline;
DROP FUNCTION public.record_admin_audit(uuid, text, text, text, uuid, integer, text, jsonb, text);
DROP TABLE public.admin_audit_log;
DROP FUNCTION public.prevent_admin_audit_log_mutation();

NOTIFY pgrst, 'reload schema';
