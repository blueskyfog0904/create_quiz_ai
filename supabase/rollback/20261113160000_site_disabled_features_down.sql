-- 20261113160000_site_disabled_features 되돌리기: 닫아 둔 사용자 쪽 옛 기능을 모두 다시 연다.
-- 주의: /passages/create 는 로그인 없이 열리고, 그 화면의 AI 호출(지문 생성·글자 추출)에는 로그인 확인과 크레딧 차감이 없다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DELETE FROM public.system_settings WHERE key = 'site_disabled_features';
