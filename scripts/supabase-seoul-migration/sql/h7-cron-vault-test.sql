-- H-7 pg_net·vault 권한 시험. 새(서울) 프로젝트 SQL Editor에서만 실행한다.
-- 일부러 틀린 secret(무작위 48자, 아무도 모름)으로 대사 cron을 등록해, 앱이 403을 돌려주는지 본다.
-- 진짜 CRON_SECRET은 여기서 쓰지 않는다(C-7에서만).
-- 옛(운영) 프로젝트에서 실수로 실행해도 아래 DO 검사가 멈추게 한다(운영에는 cron 2개·vault 2개가 있음).

-- [1·2단계] 시작 전 검사(cron·vault 모두 0이어야 함) → 틀린 secret으로 등록. 이 블록을 한 번에 실행
DO $$
BEGIN
  IF (SELECT count(*) FROM cron.job) <> 0 OR (SELECT count(*) FROM vault.secrets) <> 0 THEN
    RAISE EXCEPTION 'H7_STOP: cron.job 또는 vault.secrets가 비어 있지 않습니다. 새 프로젝트가 맞는지 확인하세요.';
  END IF;
END $$;
select vault.create_secret('https://www.summersuninst.com', 'payment_reconcile_origin');
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'payment_reconcile_cron_secret');
select public.configure_payment_reconciliation_http_cron();
select jobname, schedule, active from cron.job;

-- [3단계] 5~10분 기다린 뒤 AI에게 알린다. AI가 net._http_response에서 403을 확인한다.

-- [4단계] AI 확인 뒤 정리. 이 블록을 한 번에 실행(cron이 시험 작업 1개뿐일 때만 진행)
DO $$
BEGIN
  IF (SELECT count(*) FROM cron.job) <> 1
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payment-reconciliation-http-5m') THEN
    RAISE EXCEPTION 'H7_STOP: cron 작업이 시험 작업 1개가 아닙니다. 새 프로젝트가 맞는지 확인하세요.';
  END IF;
END $$;
select cron.unschedule(jobid) from cron.job where jobname = 'payment-reconciliation-http-5m';
delete from vault.secrets where name in ('payment_reconcile_origin', 'payment_reconcile_cron_secret');

-- [5단계] 정리 확인: 둘 다 0
select (select count(*) from cron.job) as cron_jobs,
       (select count(*) from vault.secrets) as vault_secrets;
