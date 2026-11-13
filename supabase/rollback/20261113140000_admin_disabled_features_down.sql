-- 20261113140000_admin_disabled_features 되돌리기: 꺼 둔 관리자 기능을 모두 다시 연다(메뉴·페이지·API).
-- 주의: /admin/ai-question-generation-runs 는 열기만 해도 만료된 생성 로그를 영구 삭제한다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DELETE FROM public.system_settings WHERE key = 'admin_disabled_features';
