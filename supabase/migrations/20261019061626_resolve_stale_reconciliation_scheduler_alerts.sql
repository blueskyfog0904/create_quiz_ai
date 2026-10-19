-- 2026-09-11·12 대사 스케줄러 일시 장애 경보 해소.
-- 미해소 경보가 code당 1건으로 제한되어 있어, 남아 있으면 같은 장애가 다시 나도 새 경보가 생기지 않는다.
-- 스케줄러가 지금 정상(연속 실패 0, 15분 이내 성공)일 때만 해소한다. 해소할 경보가 없으면(로컬 등) 아무것도 하지 않는다.
DO $$
DECLARE
  v_scheduler public.payment_reconciliation_scheduler%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.payment_reconciliation_alerts
     WHERE resolved_at IS NULL
       AND code IN (
         'PAYMENT_RECONCILIATION_SCHEDULER_STALE',
         'PAYMENT_RECONCILIATION_REPEATED_FAILURE'
       )
       AND created_at < '2026-10-01'::timestamptz
  ) THEN
    RETURN;
  END IF;

  SELECT * INTO v_scheduler
    FROM public.payment_reconciliation_scheduler
   WHERE id = 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_scheduler.consecutive_failures <> 0
     OR v_scheduler.last_succeeded_at IS NULL
     OR v_scheduler.last_succeeded_at < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_SCHEDULER_NOT_HEALTHY';
  END IF;

  UPDATE public.payment_reconciliation_alerts
     SET resolved_at = now(),
         details = details || jsonb_build_object(
           'resolution', jsonb_build_object(
             'note', '스케줄러 정상화 확인 후 수동 해소 (2026-09 일시 장애, 이후 연속 성공)',
             'verified_last_succeeded_at', v_scheduler.last_succeeded_at
           )
         )
   WHERE resolved_at IS NULL
     AND code IN (
       'PAYMENT_RECONCILIATION_SCHEDULER_STALE',
       'PAYMENT_RECONCILIATION_REPEATED_FAILURE'
     )
     AND created_at < '2026-10-01'::timestamptz;
END;
$$;
