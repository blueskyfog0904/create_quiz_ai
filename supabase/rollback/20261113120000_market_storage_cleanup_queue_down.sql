-- 20261113120000_market_storage_cleanup_queue 되돌리기.
-- 먼저 이 표를 쓰는 코드를 되돌려 배포한 뒤 실행한다. 남아 있던 대기 행(아직 못 지운 파일 목록)은 사라진다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DROP TABLE public.market_storage_cleanup_queue;

NOTIFY pgrst, 'reload schema';
