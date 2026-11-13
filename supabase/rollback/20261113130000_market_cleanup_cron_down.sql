-- 20261113130000_market_cleanup_cron 되돌리기: 하루 한 번 자동 정리를 끈다(관리자 화면의 "남은 파일 다시 정리" 버튼은 그대로).
-- 이미 지워진 임시저장 상품·파일은 돌아오지 않는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'market-cleanup-daily';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END;
$$;
