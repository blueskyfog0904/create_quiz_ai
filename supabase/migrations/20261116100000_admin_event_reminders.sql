-- 미답변 재알림(계획 4-3절 "재알림", DB-A2).
-- 배경: 문의·환불이 접수될 때 알림은 한 번만 울린다. 그때 놓치면 관리자가 화면을 열어 보기 전까지 다시 알 길이 없다.
-- 흐름: 10분마다 도는 remind_unanswered_admin_work()가 "접수 후 기준 시간이 지났는데 아직 처리 대기"인 건마다
--       admin_events에 1행을 넣는다 → 관리자 화면 알림과 슬랙 전송은 DB-A1(20261113210000)의 것을 그대로 탄다.
-- 대상(관리자 화면의 처리 대기 건수와 같은 조건):
--   문의            support_tickets          status='pending' 이고 회원이 지우지 않은 것      기준: created_at
--   문제마켓 환불   market_refund_requests   status='pending'                                기준: created_at
--   충전 환불       refund_requests          status='pending_review'                         기준: created_at
--                                            status='retryable_failed'·'manual_review'       기준: updated_at(그 상태가 된 뒤로)
--   한계: updated_at은 행이 고쳐질 때마다 새로 찍힌다. 그 상태에서 행이 계속 고쳐지면 기준 시간이 다시 시작된다
--         (화면의 처리 대기 건수에는 계속 잡힌다).
-- 같은 건은 한국 날짜 기준 하루 한 번만(dedupe_key = '<종류>:<id>:<YYYY-MM-DD>'). 처리될 때까지 매일 다시 울린다.
-- 보내는 시간대 밖(기본 21시~다음 날 9시)에는 만들지 않는다. 밤사이 기준을 넘긴 건은 아침 첫 실행 때 한꺼번에 만들어지고,
--   슬랙 전송 작업이 한 회차에 모인 이벤트를 메시지 하나로 묶는다.
-- 설정(데이터): system_settings 'admin_alert_settings'.reminders
--   support_after_hours(문의 기준 시간), refund_after_hours(환불 기준 시간), send_from_hour·send_until_hour(한국 시각, 이상~미만)
--   이 키가 없으면 함수는 아무것도 하지 않는다. 값이 잘못되면 예외를 낸다(cron 실행 기록에 실패로 남는다).
--   이 행은 브라우저 세션으로 바꿀 수 없다(DB-A1의 제한 정책). 바꿀 때는 마이그레이션으로 한다.
-- 잠금: system_settings의 설정 행 하나만 고친다. 결제 테이블은 읽기만 하고 잠그지 않는다.
-- cron: 5분 주기 결제 작업과 겹치지 않게 매시 3·13·23·33·43·53분에 돈다. 실행 기록은 하루 144행(결제 작업보다 적다)이라 따로 지우지 않는다.
-- 제목·본문에는 회원 이메일·전화번호·문의 본문·환불 사유를 넣지 않는다(슬랙으로 나간다).
-- 선행: 20261113210000_admin_events (admin_events 표와 설정 행).
-- 되돌리기: supabase/rollback/20261116100000_admin_event_reminders_down.sql (이미 만들어진 재알림 이벤트는 남는다 — 추가 전용 표)
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. 설정 -------------------------------------------------------------------------------------------------------
-- 설정 행이 없거나 reminders가 이미 있으면 실패한다(되돌리기가 이 키를 지우므로, 이 파일이 만든 값임을 보장한다).
DO $settings$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.system_settings
     SET value = value || '{"reminders": {"support_after_hours": 4, "refund_after_hours": 24, "send_from_hour": 9, "send_until_hour": 21}}'::jsonb,
         description = '관리자 알림 설정: site_url(슬랙 링크의 사이트 주소), alert_codes(결제 경보 코드별 통지 방식 screen|full, 없으면 full), '
           || 'reminders(미답변 재알림: support_after_hours·refund_after_hours 기준 시간, send_from_hour·send_until_hour 보내는 한국 시각)',
         updated_at = now()
   WHERE key = 'admin_alert_settings'
     AND NOT (value ? 'reminders');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'ADMIN_ALERT_SETTINGS_ROW_NOT_READY';
  END IF;
END;
$settings$;

-- 2. 함수 -------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.remind_unanswered_admin_work()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_remind_unanswered_admin_work$
DECLARE
  v_cfg jsonb;
  v_support_hours numeric;
  v_refund_hours numeric;
  v_from_hour numeric;
  v_until_hour numeric;
  v_now timestamptz := now();
  v_kst timestamp := now() AT TIME ZONE 'Asia/Seoul';
  v_day text;
BEGIN
  SELECT s.value -> 'reminders'
    INTO v_cfg
    FROM public.system_settings s
   WHERE s.key = 'admin_alert_settings';

  IF v_cfg IS NULL THEN
    RETURN;
  END IF;

  IF jsonb_typeof(v_cfg -> 'support_after_hours') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_cfg -> 'refund_after_hours') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_cfg -> 'send_from_hour') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_cfg -> 'send_until_hour') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'ADMIN_REMINDER_SETTINGS_INVALID';
  END IF;

  v_support_hours := (v_cfg ->> 'support_after_hours')::numeric;
  v_refund_hours := (v_cfg ->> 'refund_after_hours')::numeric;
  v_from_hour := (v_cfg ->> 'send_from_hour')::numeric;
  v_until_hour := (v_cfg ->> 'send_until_hour')::numeric;

  IF v_support_hours <= 0 OR v_refund_hours <= 0
     OR v_from_hour < 0 OR v_until_hour > 24 OR v_from_hour >= v_until_hour THEN
    RAISE EXCEPTION 'ADMIN_REMINDER_SETTINGS_INVALID';
  END IF;

  -- 보내는 시간대(한국 시각, 이상~미만) 밖이면 만들지 않는다.
  IF extract(hour FROM v_kst) < v_from_hour OR extract(hour FROM v_kst) >= v_until_hour THEN
    RETURN;
  END IF;

  v_day := to_char(v_kst, 'YYYY-MM-DD');

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  SELECT
    'support_unanswered',
    'info',
    '답변 대기 문의'
      || COALESCE(' [' || COALESCE(
           t.category_snapshot ->> 'name',
           (SELECT c.name FROM public.support_ticket_categories c WHERE c.id = t.category_id)
         ) || ']', '')
      || ' ' || left(regexp_replace(t.subject, '\s+', ' ', 'g'), 30),
    format('접수 후 %s시간 지남', floor(extract(epoch FROM v_now - t.created_at) / 3600)),
    '/admin/support',
    'support_tickets',
    t.id,
    'support.manage',
    'support_unanswered:' || t.id || ':' || v_day
  FROM public.support_tickets t
  WHERE t.status = 'pending'
    AND t.is_deleted_by_user = false
    AND t.created_at <= v_now - make_interval(secs => (v_support_hours * 3600)::double precision)
  ON CONFLICT (dedupe_key) DO NOTHING;

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  SELECT
    'refund_unanswered',
    'info',
    '처리 대기 문제마켓 환불',
    format('요청 %s크레딧 · 접수 후 %s시간 지남',
           r.requested_refund_credits,
           floor(extract(epoch FROM v_now - r.created_at) / 3600)),
    '/admin/refunds',
    'market_refund_requests',
    r.id,
    'refunds.market',
    'refund_unanswered:' || r.id || ':' || v_day
  FROM public.market_refund_requests r
  WHERE r.status = 'pending'
    AND r.created_at <= v_now - make_interval(secs => (v_refund_hours * 3600)::double precision)
  ON CONFLICT (dedupe_key) DO NOTHING;

  INSERT INTO public.admin_events (kind, severity, title, body, link, ref_table, ref_id, required_permission, dedupe_key)
  SELECT
    'refund_unanswered',
    'info',
    CASE WHEN r.status = 'pending_review' THEN '처리 대기 충전 환불' ELSE '확인이 필요한 충전 환불' END,
    concat_ws(' · ',
      '환불 금액 ' || r.refund_amount || '원',
      format('%s시간 지남', floor(extract(epoch FROM v_now - s.since) / 3600))),
    '/admin/refunds',
    'refund_requests',
    r.id,
    'refunds.payment',
    'refund_unanswered:' || r.id || ':' || v_day
  FROM public.refund_requests r
  CROSS JOIN LATERAL (
    SELECT CASE WHEN r.status = 'pending_review' THEN r.created_at ELSE COALESCE(r.updated_at, r.created_at) END AS since
  ) s
  WHERE r.status IN ('pending_review', 'retryable_failed', 'manual_review')
    AND s.since <= v_now - make_interval(secs => (v_refund_hours * 3600)::double precision)
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$fn_remind_unanswered_admin_work$;

REVOKE EXECUTE ON FUNCTION public.remind_unanswered_admin_work() FROM PUBLIC, anon, authenticated, service_role;

-- 3. cron -------------------------------------------------------------------------------------------------------
DO $schedule$
BEGIN
  PERFORM cron.schedule(
    'admin-events-remind',
    '3-59/10 * * * *',
    $cron_remind$SELECT public.remind_unanswered_admin_work();$cron_remind$
  );
END;
$schedule$;
