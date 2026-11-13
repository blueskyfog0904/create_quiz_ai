-- 20261113170000_admin_disable_landing_pages 되돌리기: 관리자 '랜딩페이지 관리'를 다시 연다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

UPDATE public.system_settings
   SET value = jsonb_set(value, '{features}', (value -> 'features') - 'landing_pages'),
       updated_at = now()
 WHERE key = 'admin_disabled_features'
   AND (value -> 'features') ? 'landing_pages';
