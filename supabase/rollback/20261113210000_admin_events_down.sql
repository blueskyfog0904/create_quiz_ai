-- 20261113210000_admin_events 되돌리기: 관리자 알림의 바탕(이벤트 표·트리거·슬랙 전송 작업)을 모두 없앤다.
-- 먼저 admin_events를 읽거나 쓰는 화면·앱 코드를 되돌려 배포한 뒤 실행한다.
-- 사라지는 것: 쌓인 이벤트와 전송 기록 전부, 설정 행 admin_alert_settings(DB-A2가 같은 행에 값을 더했다면 DB-A2를 먼저 되돌린다).
-- 남는 것: vault의 admin_alert_slack_webhook_url·admin_alert_heartbeat_url(필요하면 따로 지운다), 업무 테이블의 데이터.
-- 결제 테이블의 트리거를 지울 때 잠깐 잠금을 잡는다(최대 3초 대기).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 전송 작업부터 멈춘다.
DO $unschedule$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid FROM cron.job
     WHERE jobname IN ('admin-events-dispatch', 'admin-events-cron-history-cleanup')
  LOOP
    -- 실행 기록도 지운다(다시 적용하면 작업 번호가 바뀌어 정리 작업이 옛 기록을 지우지 못한다).
    DELETE FROM cron.job_run_details WHERE jobid = v_job.jobid;
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
END;
$unschedule$;

DROP TRIGGER trg_admin_event_support_ticket_created ON public.support_tickets;
DROP TRIGGER trg_admin_event_market_refund_requested ON public.market_refund_requests;
DROP TRIGGER trg_admin_event_payment_refund_inserted ON public.refund_requests;
DROP TRIGGER trg_admin_event_payment_refund_needs_action ON public.refund_requests;
DROP TRIGGER trg_admin_event_payment_manual_review ON public.payment_orders;
DROP TRIGGER trg_admin_event_payment_alert ON public.payment_reconciliation_alerts;
DROP TRIGGER trg_admin_event_sales_switch_changed ON public.payment_runtime_config;

DROP FUNCTION public.admin_event_on_support_ticket_created();
DROP FUNCTION public.admin_event_on_market_refund_requested();
DROP FUNCTION public.admin_event_on_payment_refund_inserted();
DROP FUNCTION public.admin_event_on_payment_refund_needs_action();
DROP FUNCTION public.admin_event_on_payment_manual_review();
DROP FUNCTION public.admin_event_on_payment_alert();
DROP FUNCTION public.admin_event_on_sales_switch_changed();
DROP FUNCTION public.dispatch_admin_events();

DO $publication$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'admin_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.admin_events;
  END IF;
END;
$publication$;

-- 추가 전용 트리거(prevent_admin_event_mutation, prevent_admin_event_truncate)는 표와 함께 사라진다.
DROP TABLE public.admin_event_deliveries;
DROP TABLE public.admin_event_reads;
DROP TABLE public.admin_event_dispatch_state;
DROP TABLE public.admin_events;
DROP FUNCTION public.prevent_admin_event_mutation();

DROP POLICY system_settings_admin_alert_settings_no_client_write ON public.system_settings;
DELETE FROM public.system_settings WHERE key = 'admin_alert_settings';

NOTIFY pgrst, 'reload schema';
