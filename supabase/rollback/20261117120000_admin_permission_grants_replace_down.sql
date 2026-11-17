-- 20261117120000_admin_permission_grants_replace 되돌리기: 권한 교체·권한 해제 함수와 권한 묶음 설정 행을 없앤다.
-- 20261117110000_admin_audit_log를 되돌리려면 이 파일을 먼저 실행한다(두 함수가 작업 기록에 적는다).
-- 앱 코드: 권한 저장(PUT /api/admin/admin-accounts/[userId]/permissions)과 권한 해제가 오류 안내로 끝난다(아무것도 바뀌지 않는다). 묶음 버튼은 보이지 않는다.
-- 그대로 남는 것: 이미 부여된 권한(admin_permission_grants), 이미 해제된 계정의 상태, 이미 적힌 작업 기록.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DELETE FROM public.system_settings WHERE key = 'admin_permission_presets';
DROP FUNCTION public.revoke_admin_account(uuid, uuid);
DROP FUNCTION public.replace_admin_permission_grants(uuid, uuid, jsonb);

NOTIFY pgrst, 'reload schema';
