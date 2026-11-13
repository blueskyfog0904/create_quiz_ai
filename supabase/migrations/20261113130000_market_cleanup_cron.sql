-- 문제마켓 정리 작업을 하루 한 번 자동으로 실행한다(매일 19:00 UTC = 한국 시간 04:00). 사용자 결정 2026-11-13.
-- 호출 대상: POST /api/cron/market/cleanup-auto-upload-drafts (dryRun=false)
--   국어: 임시저장 상품 삭제(autoUploadDrafts) + 지운 샘플 파일 정리(manualSampleUploadTargets) + 남은 파일 다시 정리(storageCleanup)
--   영어: 임시저장 상품 삭제 + 지운 샘플 파일 정리 (남은 파일 정리는 과목과 무관해 국어 호출에서 한 번만)
-- 주의: autoUploadDrafts는 마지막 수정 후 24시간이 지난 자동 업로드 임시저장 상품을 지운다(구매·다운로드·환불·후기 이력이 있으면 지우지 않음).
-- 주소와 인증값은 결제 대사 cron과 같은 vault 항목(payment_reconcile_origin, payment_reconcile_cron_secret = 서버의 CRON_SECRET)을 쓴다.
-- 순서: route가 tasks·subject를 받는 코드가 배포된 뒤에 적용한다.
-- 되돌리기: supabase/rollback/20261113130000_market_cleanup_cron_down.sql (배포를 tasks 이전 버전으로 되돌릴 때는 이것을 먼저 실행)
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'payment_reconcile_origin')
     OR NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'payment_reconcile_cron_secret') THEN
    RAISE EXCEPTION 'MARKET_CLEANUP_CRON: vault secrets are missing';
  END IF;

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'market-cleanup-daily';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'market-cleanup-daily',
    '0 19 * * *',
    $cron$
      SELECT net.http_post(
        url := (
          SELECT TRIM(decrypted_secret)
            FROM vault.decrypted_secrets
           WHERE name = 'payment_reconcile_origin'
        ) || '/api/cron/market/cleanup-auto-upload-drafts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT TRIM(decrypted_secret)
              FROM vault.decrypted_secrets
             WHERE name = 'payment_reconcile_cron_secret'
          )
        ),
        body := call.body,
        timeout_milliseconds := 55000
      )
      FROM (VALUES
        (jsonb_build_object('dryRun', false, 'subject', 'korean',
          'tasks', jsonb_build_array('autoUploadDrafts', 'manualSampleUploadTargets', 'storageCleanup'))),
        (jsonb_build_object('dryRun', false, 'subject', 'english',
          'tasks', jsonb_build_array('autoUploadDrafts', 'manualSampleUploadTargets')))
      ) AS call(body);
    $cron$
  );
END;
$$;
