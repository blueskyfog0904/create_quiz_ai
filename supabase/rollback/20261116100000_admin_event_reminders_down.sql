-- 20261116100000_admin_event_reminders 되돌리기: 미답변 재알림 작업·함수·설정을 없앤다.
-- 남는 것: 이미 만들어진 재알림 이벤트(admin_events는 추가 전용), 그 슬랙 전송 기록.
-- 20261113210000_admin_events를 되돌리려면 이 파일을 먼저 실행한다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 작업부터 멈춘다.
DO $unschedule$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid FROM cron.job WHERE jobname = 'admin-events-remind'
  LOOP
    -- 실행 기록도 지운다(다시 적용하면 작업 번호가 바뀐다).
    DELETE FROM cron.job_run_details WHERE jobid = v_job.jobid;
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END;
$unschedule$;

DROP FUNCTION public.remind_unanswered_admin_work();

UPDATE public.system_settings
   SET value = value - 'reminders',
       description = '관리자 알림 설정: site_url(슬랙 링크의 사이트 주소), alert_codes(결제 경보 코드별 통지 방식 screen|full, 없으면 full)',
       updated_at = now()
 WHERE key = 'admin_alert_settings';
