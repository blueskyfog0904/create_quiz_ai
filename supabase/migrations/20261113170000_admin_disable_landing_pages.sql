-- 관리자 '랜딩페이지 관리'를 끈다(메뉴 숨김 + 페이지·쓰기 액션 차단). 사용자 결정 2026-11-13.
-- 배경: 이 화면이 고치던 옛 과목별 첫 화면(/korean, /english)과 /legacy는 20261113160000으로 닫혀 문제마켓 홈으로 이동한다.
-- 묶음 정의는 src/lib/admin-features.ts의 landing_pages. 이미 들어 있으면 아무것도 바꾸지 않는다. 적용 후 최대 60초 안에 반영된다.
-- 되돌리기: supabase/rollback/20261113170000_admin_disable_landing_pages_down.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

UPDATE public.system_settings
   SET value = jsonb_set(value, '{features}', (value -> 'features') || '["landing_pages"]'::jsonb),
       updated_at = now()
 WHERE key = 'admin_disabled_features'
   AND jsonb_typeof(value -> 'features') = 'array'
   AND NOT (value -> 'features') ? 'landing_pages';
