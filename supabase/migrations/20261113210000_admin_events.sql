-- 관리자 알림의 바탕: 이벤트 표 + 업무 테이블 트리거 + 슬랙 전송 작업(계획 4-3절, DB-A1).
-- 배경: 문의·환불·결제 문제가 생겨도 관리자가 화면을 직접 열어 보기 전에는 알 수 없었다.
-- 흐름: 업무 테이블의 변화 → 트리거가 admin_events에 1행 INSERT → (1) 관리자 화면이 Realtime으로 받는다
--       (2) 15초마다 도는 dispatch_admin_events()가 슬랙으로 묶어 보낸다(실패 시 재시도, 6회 실패 시 포기 기록).
-- 만드는 것:
--   표 4개  admin_events(추가 전용) / admin_event_deliveries(슬랙 전송 상태) / admin_event_dispatch_state(전송 작업 상태 1행)
--           / admin_event_reads(관리자별 마지막 확인 시각)
--   트리거  support_tickets INSERT, market_refund_requests INSERT, refund_requests INSERT·상태 전이,
--           payment_orders 상태 전이(manual_review), payment_reconciliation_alerts INSERT, payment_runtime_config 스위치 변경
--           → 모두 admin_events INSERT 한 줄만 하고, 실패해도 원래 작업을 막지 않는다(EXCEPTION WHEN OTHERS).
--             단, statement_timeout 취소와 잠금 대기는 이 블록으로 막지 못한다. 그래서 잠금을 잡지 않는 INSERT만 한다.
--   설정 행 system_settings 'admin_alert_settings' : site_url(슬랙 링크의 사이트 주소), alert_codes(경보 코드별 통지 방식)
--   cron    admin-events-dispatch(15초), admin-events-cron-history-cleanup(하루 1회, 이 작업의 실행 기록 7일 보관)
-- 이 파일이 만들지 않는 것: refund_over_limit·credit_balance_mismatch(앱 코드), 재알림(DB-A2), 권한별 조회(DB-P3).
--   required_permission 열은 지금부터 채워 두고, 조회 정책은 DB-P3 전까지 is_admin()이다.
-- 슬랙 주소: vault 'admin_alert_slack_webhook_url'. 등록 전에는 전송 작업이 last_run_error='WEBHOOK_NOT_CONFIGURED'만 남기고
--   시도 횟수를 올리지 않는다. 등록하면 최근 24시간 안에 쌓인 delivery='full' 이벤트가 한 번에 20건씩 나간다(그보다 묵은 것은 화면에만 남는다).
-- 하트비트 주소: vault 'admin_alert_heartbeat_url'(없으면 보내지 않는다).
-- 잠금: 결제 테이블(refund_requests, payment_orders, payment_reconciliation_alerts, payment_runtime_config)에 트리거를 만들 때
--   SHARE ROW EXCLUSIVE 잠금을 잡고 이 트랜잭션이 끝날(커밋·롤백) 때까지 유지한다(진행 중인 쓰기가 끝나길 최대 3초 기다리고,
--   그 사이 새 쓰기는 대기). 3초를 넘기면 전체가 취소된다. 5분 주기 결제 작업과 겹치지 않게 매 5분 경계를 피해 적용한다.
-- 순서: 이 파일은 추가만 하므로 코드 배포보다 먼저 적용해도 된다. 화면·앱 코드는 뒤 단위에서 붙는다.
-- 되돌리기: supabase/rollback/20261113210000_admin_events_down.sql (이벤트·전송 기록이 모두 사라진다)
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. 표 ---------------------------------------------------------------------------------------------------------

CREATE TABLE public.admin_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  body text,
  link text NOT NULL,
  ref_table text,
  ref_id uuid,
  required_permission text NOT NULL,
  delivery text NOT NULL DEFAULT 'full',
  dedupe_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_events_severity_check CHECK (severity IN ('info', 'warning', 'critical')),
  CONSTRAINT admin_events_delivery_check CHECK (delivery IN ('full', 'screen'))
);

CREATE INDEX idx_admin_events_created_at ON public.admin_events (created_at DESC);

CREATE TABLE public.admin_event_deliveries (
  event_id uuid PRIMARY KEY REFERENCES public.admin_events (id),
  channel text,
  request_id bigint,
  requested_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  delivered_at timestamptz,
  last_error text,
  gave_up_at timestamptz
);

CREATE INDEX idx_admin_event_deliveries_open
  ON public.admin_event_deliveries (requested_at)
  WHERE delivered_at IS NULL;

CREATE TABLE public.admin_event_dispatch_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_run_at timestamptz,
  last_run_error text,
  last_success_at timestamptz,
  last_heartbeat_at timestamptz
);

INSERT INTO public.admin_event_dispatch_state (id) VALUES (true);

CREATE TABLE public.admin_event_reads (
  admin_id uuid PRIMARY KEY,
  last_seen_at timestamptz
);

-- admin_events는 추가 전용이다(선례: payment_admin_actions).
CREATE FUNCTION public.prevent_admin_event_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_prevent_admin_event_mutation$
BEGIN
  RAISE EXCEPTION 'ADMIN_EVENTS_APPEND_ONLY';
END;
$fn_prevent_admin_event_mutation$;

CREATE TRIGGER prevent_admin_event_mutation
  BEFORE UPDATE OR DELETE ON public.admin_events
  FOR EACH ROW EXECUTE FUNCTION public.prevent_admin_event_mutation();

CREATE TRIGGER prevent_admin_event_truncate
  BEFORE TRUNCATE ON public.admin_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_admin_event_mutation();

ALTER TABLE public.admin_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_event_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_event_dispatch_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_event_reads ENABLE ROW LEVEL SECURITY;

-- 새 표에는 기본 권한으로 anon·authenticated·service_role 모두 ALL이 붙는다. 전부 걷고 필요한 것만 준다.
REVOKE ALL ON TABLE public.admin_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admin_event_deliveries FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admin_event_dispatch_state FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.admin_event_reads FROM PUBLIC, anon, authenticated, service_role;

-- 관리자 화면(Realtime 구독)은 관리자 세션으로 읽는다. 앱 코드(service_role)는 이벤트를 읽고 추가만 한다.
GRANT SELECT ON TABLE public.admin_events TO authenticated;
GRANT SELECT, INSERT ON TABLE public.admin_events TO service_role;
GRANT SELECT ON TABLE public.admin_event_deliveries TO service_role;
GRANT SELECT ON TABLE public.admin_event_dispatch_state TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_event_reads TO service_role;

-- DB-P3에서 has_admin_permission(required_permission)으로 바꾼다.
CREATE POLICY admin_events_select_admin ON public.admin_events
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

DO $publication$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'admin_events'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_events;
  END IF;
END;
$publication$;

-- 2. 설정 행 ----------------------------------------------------------------------------------------------------
-- site_url    : 슬랙 메시지의 링크 앞에 붙는 사이트 주소.
-- alert_codes : 결제 경보 코드별 통지 방식. {"<코드>": {"delivery": "screen"}} 이면 슬랙·소리 없이 화면 목록에만 남긴다.
--               적지 않은 코드는 'full'. 지금은 비워 둔다 — 사이트 밖(카페) 결제 통보는 0adda5e부터 경보를 만들지 않고,
--               남은 PAYAPP_FEEDBACK_ORDER_NOT_FOUND는 "주문번호가 있는데 주문이 없는" 실제 이상이라 조용히 두지 않는다.
-- 행이 이미 있으면 실패한다(되돌리기가 이 행을 지우므로, 이 파일이 만든 행임을 보장한다).
INSERT INTO public.system_settings (key, value, description)
VALUES (
  'admin_alert_settings',
  '{"site_url": "https://www.summersuninst.com", "alert_codes": {}}'::jsonb,
  '관리자 알림 설정: site_url(슬랙 링크의 사이트 주소), alert_codes(결제 경보 코드별 통지 방식 screen|full, 없으면 full)'
);

-- 이 설정 행은 슬랙 링크의 주소와 경보별 통지 방식을 정하므로 브라우저 세션(관리자 포함)으로는 바꾸지 못하게 한다.
-- system_settings의 기존 정책은 관리자 누구나 UPDATE를 허용한다. 이 행만 제한 정책으로 막고, 바꿀 때는 마이그레이션으로 한다.
CREATE POLICY system_settings_admin_alert_settings_no_client_write ON public.system_settings
  AS RESTRICTIVE FOR UPDATE TO public
  USING (key <> 'admin_alert_settings')
  WITH CHECK (key <> 'admin_alert_settings');

-- 3. 트리거 함수 ------------------------------------------------------------------------------------------------
-- 제목·본문에는 회원 이메일·전화번호·문의 본문·환불 사유를 넣지 않는다(슬랙으로 나간다).

CREATE FUNCTION public.admin_event_on_support_ticket_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_admin_event_on_support_ticket_created$
BEGIN
  INSERT INTO public.admin_events (kind, severity, title, link, ref_table, ref_id, required_permission, dedupe_key)
  VALUES (
    'support_ticket_created',
    'info',
    '새 문의'
      || COALESCE(' [' || COALESCE(
           NEW.category_snapshot ->> 'name',
           (SELECT c.name FROM public.support_ticket_categories c WHERE c.id = NEW.category_id)
         ) || ']', '')
      || ' ' || left(regexp_replace(NEW.subject, '\s+', ' ', 'g'), 30),
    '/admin/support',
    'support_tickets',
    NEW.id,
    'support.manage',
    'ticket:' || NEW.id
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_event_on_support_ticket_created: % %', SQLSTATE, SQLERRM;
  RETURN NULL;
END;
$fn_admin_event_on_support_ticket_created$;

CREATE FUNCTION public.admin_event_on_market_refund_requested()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_admin_event_on_market_refund_requested$
BEGIN
  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  VALUES (
    'market_refund_requested',
    'info',
    '문제마켓 환불 요청',
    format('요청 %s크레딧', NEW.requested_refund_credits),
    '/admin/refunds',
    'market_refund_requests',
    NEW.id,
    'refunds.market',
    'mrefund:' || NEW.id
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_event_on_market_refund_requested: % %', SQLSTATE, SQLERRM;
  RETURN NULL;
END;
$fn_admin_event_on_market_refund_requested$;

-- 충전 환불 요청 INSERT: 고객 요청이면 payment_refund_requested, 결제사 쪽 취소·부분취소면 payment_external_cancel.
-- 결제사 쪽 행은 처음부터 status='manual_review'로 들어오지만 이 이벤트 하나로 알린다(같은 행에 "확인 필요"를 또 울리지 않는다).
CREATE FUNCTION public.admin_event_on_payment_refund_inserted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_admin_event_on_payment_refund_inserted$
BEGIN
  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  VALUES (
    CASE WHEN NEW.origin = 'user' THEN 'payment_refund_requested' ELSE 'payment_external_cancel' END,
    CASE WHEN NEW.origin = 'user' THEN 'info' ELSE 'warning' END,
    CASE NEW.origin
      WHEN 'user' THEN '충전 환불 요청'
      WHEN 'partial_cancel' THEN '결제사 부분취소 감지 — 확인 필요'
      ELSE '결제사 취소 감지 — 확인 필요'
    END,
    NULLIF(concat_ws(' · ', '환불 금액 ' || NEW.refund_amount || '원', NEW.last_error_code), ''),
    '/admin/refunds',
    'refund_requests',
    NEW.id,
    'refunds.payment',
    'prefund:' || NEW.id
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_event_on_payment_refund_inserted: % %', SQLSTATE, SQLERRM;
  RETURN NULL;
END;
$fn_admin_event_on_payment_refund_inserted$;

-- 충전 환불이 retryable_failed·manual_review로 바뀔 때, 또는 그 상태에서 고객 요청이 결제사 취소 건으로 바뀔 때(origin 변경). 키에 전이 시각(분)을 넣어, 해소 뒤 다시 실패하면 다시 울린다.
CREATE FUNCTION public.admin_event_on_payment_refund_needs_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_admin_event_on_payment_refund_needs_action$
BEGIN
  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  VALUES (
    'payment_refund_needs_action',
    'warning',
    CASE
      WHEN NEW.status = 'retryable_failed' THEN '충전 환불 처리 실패 — 다시 시도 필요'
      WHEN NEW.origin <> 'user' THEN '결제사 취소 감지 — 수동 확인 필요'
      ELSE '충전 환불 수동 확인 필요'
    END,
    NULLIF(concat_ws(' · ', '환불 금액 ' || NEW.refund_amount || '원', NEW.last_error_code), ''),
    '/admin/refunds',
    'refund_requests',
    NEW.id,
    'refunds.payment',
    'prefund:' || NEW.id || ':' || NEW.status || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MI')
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_event_on_payment_refund_needs_action: % %', SQLSTATE, SQLERRM;
  RETURN NULL;
END;
$fn_admin_event_on_payment_refund_needs_action$;

CREATE FUNCTION public.admin_event_on_payment_manual_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_admin_event_on_payment_manual_review$
BEGIN
  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  VALUES (
    'payment_manual_review',
    'warning',
    '결제 주문 수동 확인 필요',
    format('주문 %s · %s원', NEW.order_id, NEW.expected_amount)
      || COALESCE(' · ' || NEW.failure_code, ''),
    '/admin/refunds',
    'payment_orders',
    NEW.id,
    'refunds.payment',
    'order:' || NEW.id || ':manual_review:' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MI')
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_event_on_payment_manual_review: % %', SQLSTATE, SQLERRM;
  RETURN NULL;
END;
$fn_admin_event_on_payment_manual_review$;

-- 결제 경보 INSERT. 코드별 통지 방식은 설정 행에서 읽고, 행·키가 없거나 읽기에 실패하면 'full'.
CREATE FUNCTION public.admin_event_on_payment_alert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_admin_event_on_payment_alert$
DECLARE
  v_delivery text;
BEGIN
  BEGIN
    SELECT s.value -> 'alert_codes' -> NEW.code ->> 'delivery'
      INTO v_delivery
      FROM public.system_settings s
     WHERE s.key = 'admin_alert_settings';
  EXCEPTION WHEN OTHERS THEN
    v_delivery := NULL;
  END;

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, delivery, dedupe_key)
  VALUES (
    'payment_alert',
    CASE WHEN NEW.severity = 'critical' THEN 'critical' ELSE 'warning' END,
    '결제 경보: ' || NEW.code,
    left(NEW.message, 300),
    '/admin/refunds',
    'payment_reconciliation_alerts',
    NEW.id,
    'refunds.payment',
    CASE WHEN v_delivery = 'screen' THEN 'screen' ELSE 'full' END,
    'alert:' || NEW.id
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_event_on_payment_alert: % %', SQLSTATE, SQLERRM;
  RETURN NULL;
END;
$fn_admin_event_on_payment_alert$;

CREATE FUNCTION public.admin_event_on_sales_switch_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_admin_event_on_sales_switch_changed$
BEGIN
  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, required_permission, dedupe_key)
  VALUES (
    'sales_switch_changed',
    'critical',
    '충전 판매 스위치 변경',
    format(
      '전체 %s · 페이앱 %s · 카카오페이 %s / 처리: %s / %s',
      CASE WHEN NEW.master_accepts_new_orders THEN '켜짐' ELSE '꺼짐' END,
      CASE WHEN NEW.payapp_accepts_new_orders THEN '켜짐' ELSE '꺼짐' END,
      CASE WHEN NEW.kakaopay_accepts_new_orders THEN '켜짐' ELSE '꺼짐' END,
      left(NEW.changed_by, 80),
      left(NEW.change_ticket, 200)
    ),
    '/admin/refunds',
    'payment_runtime_config',
    'refunds.payment',
    'switch:' || to_char(NEW.changed_at AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISSUS')
      || ':' || NEW.master_accepts_new_orders::int || NEW.payapp_accepts_new_orders::int || NEW.kakaopay_accepts_new_orders::int
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_event_on_sales_switch_changed: % %', SQLSTATE, SQLERRM;
  RETURN NULL;
END;
$fn_admin_event_on_sales_switch_changed$;

REVOKE EXECUTE ON FUNCTION public.prevent_admin_event_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_event_on_support_ticket_created() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_event_on_market_refund_requested() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_event_on_payment_refund_inserted() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_event_on_payment_refund_needs_action() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_event_on_payment_manual_review() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_event_on_payment_alert() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.admin_event_on_sales_switch_changed() FROM PUBLIC, anon, authenticated, service_role;

-- 4. 트리거 -----------------------------------------------------------------------------------------------------
-- 상태 전이 트리거는 WHEN 절에서 걸러, 해당 전이가 아닌 UPDATE에서는 함수(와 그 서브트랜잭션)가 실행되지 않는다.
-- payment_orders는 manual_review로 바로 INSERT되는 경로가 없어(prepare_payment_order) INSERT 트리거를 두지 않는다.

CREATE TRIGGER trg_admin_event_support_ticket_created
  AFTER INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.admin_event_on_support_ticket_created();

CREATE TRIGGER trg_admin_event_market_refund_requested
  AFTER INSERT ON public.market_refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.admin_event_on_market_refund_requested();

CREATE TRIGGER trg_admin_event_payment_refund_inserted
  AFTER INSERT ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.admin_event_on_payment_refund_inserted();

CREATE TRIGGER trg_admin_event_payment_refund_needs_action
  AFTER UPDATE ON public.refund_requests
  FOR EACH ROW
  WHEN ((OLD.status IS DISTINCT FROM NEW.status OR OLD.origin IS DISTINCT FROM NEW.origin)
        AND NEW.status IN ('retryable_failed', 'manual_review'))
  EXECUTE FUNCTION public.admin_event_on_payment_refund_needs_action();

CREATE TRIGGER trg_admin_event_payment_manual_review
  AFTER UPDATE ON public.payment_orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'manual_review')
  EXECUTE FUNCTION public.admin_event_on_payment_manual_review();

CREATE TRIGGER trg_admin_event_payment_alert
  AFTER INSERT ON public.payment_reconciliation_alerts
  FOR EACH ROW EXECUTE FUNCTION public.admin_event_on_payment_alert();

CREATE TRIGGER trg_admin_event_sales_switch_changed
  AFTER UPDATE ON public.payment_runtime_config
  FOR EACH ROW
  WHEN (
    OLD.master_accepts_new_orders IS DISTINCT FROM NEW.master_accepts_new_orders
    OR OLD.payapp_accepts_new_orders IS DISTINCT FROM NEW.payapp_accepts_new_orders
    OR OLD.kakaopay_accepts_new_orders IS DISTINCT FROM NEW.kakaopay_accepts_new_orders
  )
  EXECUTE FUNCTION public.admin_event_on_sales_switch_changed();

-- 5. 전송 작업 --------------------------------------------------------------------------------------------------
-- cron만 실행한다. 한 회차에 모인 이벤트를 슬랙 메시지 1개로 보낸다(최대 20건).
-- 재시도: 실패 뒤 15초·1·2·4·8분 기다렸다 다시 보내고, 6번째 시도까지 실패하면 포기한다(gave_up_at + notify_gave_up 이벤트, 화면 전용).
-- 슬랙·하트비트 주소는 오류 기록(last_run_error, last_error)에 남기지 않는다.
CREATE FUNCTION public.dispatch_admin_events()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_dispatch_admin_events$
DECLARE
  v_webhook text;
  v_heartbeat text;
  v_site_url text;
  v_ids uuid[];
  v_has_critical boolean;
  v_text text;
  v_request_id bigint;
  v_run_error text;
  v_heartbeat_error text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('public.dispatch_admin_events', 0)) THEN
    RETURN;
  END IF;

  UPDATE public.admin_event_dispatch_state SET last_run_at = now() WHERE id;

  BEGIN
    -- 붙여 넣을 때 끝에 섞인 공백·줄바꿈을 떼어 낸다.
    SELECT btrim(decrypted_secret, E' \t\r\n')
      INTO v_webhook
      FROM vault.decrypted_secrets
     WHERE name = 'admin_alert_slack_webhook_url';

    IF v_webhook IS NULL OR NOT starts_with(v_webhook, 'https://hooks.slack.com/services/') THEN
      UPDATE public.admin_event_dispatch_state SET last_run_error = 'WEBHOOK_NOT_CONFIGURED' WHERE id;
      RETURN;
    END IF;

    -- 응답 확인: 2xx → 전송 완료
    UPDATE public.admin_event_deliveries d
       SET delivered_at = now(),
           last_error = NULL
      FROM net._http_response r
     WHERE r.id = d.request_id
       AND r.created >= d.requested_at
       AND d.delivered_at IS NULL
       AND d.gave_up_at IS NULL
       AND r.status_code BETWEEN 200 AND 299;

    -- 2xx가 아니거나 요청 자체가 실패 → 다시 보낼 대상(request_id를 비운다)
    UPDATE public.admin_event_deliveries d
       SET request_id = NULL,
           last_error = CASE
             WHEN r.timed_out THEN 'TIMED_OUT'
             WHEN r.status_code IS NOT NULL THEN 'HTTP_' || r.status_code
             ELSE 'REQUEST_ERROR'
           END || ' (request ' || r.id || ')'
      FROM net._http_response r
     WHERE r.id = d.request_id
       AND r.created >= d.requested_at
       AND d.delivered_at IS NULL
       AND d.gave_up_at IS NULL;

    -- 5분이 지나도 응답이 없는 요청이 아직 대기열에 남아 있으면 지운다(전송 워커가 멈췄다 돌아올 때 같은 알림이 여러 번 나가지 않게).
    DELETE FROM net.http_request_queue q
     USING public.admin_event_deliveries d
     WHERE q.id = d.request_id
       AND d.delivered_at IS NULL
       AND d.gave_up_at IS NULL
       AND d.requested_at <= now() - interval '5 minutes';

    -- 5분이 지나도 응답 행이 없음 → 다시 보낼 대상
    UPDATE public.admin_event_deliveries d
       SET request_id = NULL,
           last_error = 'NO_RESPONSE_5M'
     WHERE d.request_id IS NOT NULL
       AND d.delivered_at IS NULL
       AND d.gave_up_at IS NULL
       AND d.requested_at <= now() - interval '5 minutes';

    -- 6번 실패, 또는 재시도 중에 24시간이 지남 → 포기. 포기 알림은 화면 전용이다(슬랙으로 보내면 슬랙 장애 때 포기가 포기를 낳는다).
    WITH gave_up AS (
      UPDATE public.admin_event_deliveries d
         SET gave_up_at = now()
       WHERE d.delivered_at IS NULL
         AND d.gave_up_at IS NULL
         AND d.request_id IS NULL
         AND (d.attempt_count >= 6
              OR EXISTS (SELECT 1 FROM public.admin_events e
                          WHERE e.id = d.event_id AND e.created_at <= now() - interval '24 hours'))
      RETURNING d.event_id
    )
    INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, delivery, dedupe_key)
    SELECT 'notify_gave_up', 'critical', '슬랙 알림 전송 포기', left(e.title, 150), e.link,
           'admin_events', e.id, 'owner', 'screen', 'gaveup:' || e.id
      FROM gave_up g
      JOIN public.admin_events e ON e.id = g.event_id
    ON CONFLICT (dedupe_key) DO NOTHING;

    -- 전송: 아직 보내지 않았거나 재시도 시각이 된 delivery='full' 이벤트
    -- 하루 넘게 묵은 이벤트는 슬랙으로 보내지 않는다(웹훅을 늦게 등록했을 때 옛 알림이 한꺼번에 쏟아지지 않게). 화면 목록에는 남는다.
    SELECT rtrim(s.value ->> 'site_url', '/')
      INTO v_site_url
      FROM public.system_settings s
     WHERE s.key = 'admin_alert_settings';

    IF v_site_url IS NULL OR NOT starts_with(v_site_url, 'https://') THEN
      v_site_url := '';
    END IF;

    SELECT array_agg(b.id),
           bool_or(b.severity = 'critical'),
           string_agg(
             replace(replace(replace(
               CASE b.severity WHEN 'critical' THEN '[긴급] ' WHEN 'warning' THEN '[주의] ' ELSE '[알림] ' END
                 || left(b.title, 150)
                 || COALESCE(E'\n' || NULLIF(left(b.body, 300), ''), '')
                 || E'\n' || v_site_url || b.link,
               '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
             E'\n\n' ORDER BY b.created_at, b.id
           )
      INTO v_ids, v_has_critical, v_text
      FROM (
        SELECT e.id, e.severity, e.title, e.body, e.link, e.created_at
          FROM public.admin_events e
          LEFT JOIN public.admin_event_deliveries d ON d.event_id = e.id
         WHERE e.delivery = 'full'
           AND e.created_at > now() - interval '24 hours'
           AND (
             d.event_id IS NULL
             OR (
               d.delivered_at IS NULL
               AND d.gave_up_at IS NULL
               AND d.request_id IS NULL
               AND d.attempt_count < 6
               AND d.requested_at + CASE d.attempt_count
                     WHEN 1 THEN interval '15 seconds'
                     WHEN 2 THEN interval '1 minute'
                     WHEN 3 THEN interval '2 minutes'
                     WHEN 4 THEN interval '4 minutes'
                     WHEN 5 THEN interval '8 minutes'
                     ELSE interval '16 minutes'
                   END <= now()
             )
           )
         ORDER BY e.created_at, e.id
         LIMIT 20
      ) b;

    IF v_ids IS NOT NULL THEN
      SELECT net.http_post(
        url := v_webhook,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'text',
          CASE WHEN v_has_critical THEN '<!channel> ' ELSE '' END || left(v_text, 15000)
        ),
        timeout_milliseconds := 10000
      ) INTO v_request_id;

      INSERT INTO public.admin_event_deliveries (event_id, channel, request_id, requested_at, attempt_count)
      SELECT unnest(v_ids), 'slack', v_request_id, now(), 1
      ON CONFLICT (event_id) DO UPDATE
        SET request_id = EXCLUDED.request_id,
            requested_at = EXCLUDED.requested_at,
            attempt_count = public.admin_event_deliveries.attempt_count + 1;
    END IF;

    -- 하트비트: 5분에 한 번, 웹훅 설정이 정상이고 최근 24시간 안에 포기한 건이 없을 때만
    -- (포기 기록은 지워지지 않으므로 기간을 두지 않으면 한 번 포기한 뒤 하트비트가 영영 멈춘다)
    IF NOT EXISTS (SELECT 1 FROM public.admin_event_deliveries WHERE gave_up_at > now() - interval '24 hours')
       AND EXISTS (
         SELECT 1 FROM public.admin_event_dispatch_state
          WHERE id AND (last_heartbeat_at IS NULL OR last_heartbeat_at <= now() - interval '5 minutes')
       ) THEN
      -- 하트비트는 보조 수단이다. 주소가 잘못돼도 슬랙 전송(위)이 함께 취소되지 않게 따로 감싼다.
      BEGIN
        SELECT btrim(decrypted_secret, E' \t\r\n')
          INTO v_heartbeat
          FROM vault.decrypted_secrets
         WHERE name = 'admin_alert_heartbeat_url';

        IF v_heartbeat IS NOT NULL AND starts_with(v_heartbeat, 'https://') THEN
          PERFORM net.http_get(url := v_heartbeat, timeout_milliseconds := 10000);
          UPDATE public.admin_event_dispatch_state SET last_heartbeat_at = now() WHERE id;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- 예외 메시지에는 주소가 들어 있으므로 기록하지 않는다.
        v_heartbeat_error := 'HEARTBEAT_FAILED';
      END;
    END IF;

    UPDATE public.admin_event_dispatch_state
       SET last_success_at = now(),
           last_run_error = v_heartbeat_error
     WHERE id;
  EXCEPTION WHEN OTHERS THEN
    v_run_error := left(
      replace(replace(SQLSTATE || ': ' || SQLERRM, COALESCE(v_webhook, ''), '[redacted]'), COALESCE(v_heartbeat, ''), '[redacted]'),
      300
    );
    UPDATE public.admin_event_dispatch_state SET last_run_error = v_run_error WHERE id;
  END;
END;
$fn_dispatch_admin_events$;

REVOKE EXECUTE ON FUNCTION public.dispatch_admin_events() FROM PUBLIC, anon, authenticated, service_role;

-- 6. cron -------------------------------------------------------------------------------------------------------
-- pg_cron 1.6.4: 초 단위 일정('15 seconds') 지원. 같은 jobname으로 다시 실행하면 일정이 바뀐다.
-- 15초 작업의 실행 기록(cron.job_run_details)이 하루 약 5,760행 쌓이므로 이 작업의 7일 지난 기록만 매일 03:17(KST)에 지운다.
DO $schedule$
BEGIN
  PERFORM cron.schedule(
    'admin-events-dispatch',
    '15 seconds',
    $cron_dispatch$SELECT public.dispatch_admin_events();$cron_dispatch$
  );

  PERFORM cron.schedule(
    'admin-events-cron-history-cleanup',
    '17 18 * * *',
    $cron_cleanup$
      DELETE FROM cron.job_run_details
       WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'admin-events-dispatch')
         AND (end_time < now() - interval '7 days'
              -- 끝난 시각이 없는 기록(연결 실패 등)은 7일 안의 가장 오래된 기록보다 앞선 것만 지운다.
              OR (end_time IS NULL AND runid < (
                    SELECT min(runid) FROM cron.job_run_details
                     WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'admin-events-dispatch')
                       AND end_time >= now() - interval '7 days')));
    $cron_cleanup$
  );
END;
$schedule$;

NOTIFY pgrst, 'reload schema';
