-- 결제·크레딧 정합성 수정 마이그레이션 1 (docs/payment-integrity-fixes-plan.md 3.1·3.3).
-- 포함 항목: 2.1(health 통보 미처리 점검), 2.2(경보 중복 제거 키), 2.3(취소 후속 경보 DB 기록·승인취소 뒤 전량 회수),
--   2.7(계좌이체 이중환불 감지), 2.8(관리자 결제확인 주문 자동 취소 금지), 2.9(부분취소 뒤 잔액 price),
--   2.11(payment_orders updated_at 트리거), 2.12(리스 만료 run 닫기), 2.13(health 페이앱 경보 조건별 기록).
-- 함수는 2026-11-10 운영 정의(pg_get_functiondef)를 그대로 복사한 뒤 필요한 줄만 바꿨다. 인자·반환형은 그대로다.
-- 잠금 순서는 운영 앱(finish → health)과 같게 payment_orders → payment_reconciliation_runs → payment_reconciliation_alerts다.
-- 적용: 두 cron 잡(payment-reconciliation-http-5m, payment-reconciliation-health-5m) 실행 직후 SQL Editor에서
--   이 파일 전체와 schema_migrations INSERT를 한 번에 실행한다(계획 6.2).
-- 롤백: supabase/rollback/20261110100000_payment_integrity_fixes_down.sql (마이그레이션 2를 먼저 롤백한 뒤에만).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 1. 사전 점검: 재정의할 함수 8개가 계획 1.4의 운영 정의와 같고, 옛 경보 인덱스와 옛 트리거 정의가 그대로인지 확인한다.
DO $$
DECLARE
  v_check record;
BEGIN
  FOR v_check IN
    SELECT *
      FROM (VALUES
        ('record_payment_alert', 'public.record_payment_alert(text,text,text,jsonb)', 'be5eb4fe912513bce4f4dda7a66a496d'),
        ('enforce_payment_reconciliation_health', 'public.enforce_payment_reconciliation_health()', 'b1adcbe8f84f614c50f3b9c6c293ca9f'),
        ('process_payapp_cancellation', 'public.process_payapp_cancellation(uuid)', 'eb135744b95c98b16890d3e246edb103'),
        ('complete_manual_point_charge_refund', 'public.complete_manual_point_charge_refund(uuid,uuid,text,text,integer,integer)', '4e3d86acac2eaef79368c240aeb4098b'),
        ('apply_payapp_feedback', 'public.apply_payapp_feedback(text,text,text,text,integer,integer,integer,integer,timestamp with time zone,timestamp with time zone)', '353409f7be9226b15837c12eadddcc98'),
        ('claim_point_charge_refund', 'public.claim_point_charge_refund(uuid,uuid,text)', '4a0a7159ef4fe27003040202ae7d9aa8'),
        ('start_payment_reconciliation_run', 'public.start_payment_reconciliation_run(integer)', 'f82adabcf0fee73eef041d730e6add67'),
        ('claim_payment_reconciliation_batch', 'public.claim_payment_reconciliation_batch(uuid,integer)', 'e8179468999a3dae7115ad9a356e5012')
      ) AS t(name, signature, expected_md5)
  LOOP
    IF md5(pg_get_functiondef(to_regprocedure(v_check.signature))) IS DISTINCT FROM v_check.expected_md5 THEN
      RAISE EXCEPTION 'PAYMENT_INTEGRITY_PRECHECK: % definition drifted', v_check.name;
    END IF;
  END LOOP;

  IF to_regclass('public.payment_reconciliation_alerts_active_code_key') IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_INTEGRITY_PRECHECK: payment_reconciliation_alerts_active_code_key missing';
  END IF;

  -- 롤백이 이 정의로 되돌리므로 출발점도 확인한다.
  IF (SELECT pg_get_triggerdef(t.oid)
        FROM pg_trigger t
       WHERE t.tgrelid = 'public.payment_orders'::regclass
         AND t.tgname = 'update_payment_orders_updated_at'
         AND NOT t.tgisinternal)
     IS DISTINCT FROM 'CREATE TRIGGER update_payment_orders_updated_at BEFORE UPDATE ON public.payment_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()' THEN
    RAISE EXCEPTION 'PAYMENT_INTEGRITY_PRECHECK: update_payment_orders_updated_at trigger drifted';
  END IF;
END;
$$;

-- 2. payment_orders 전용 updated_at 트리거(2.11). 대사 기록 열만 바뀐 갱신은 updated_at을 유지한다.
--    공용 update_updated_at_column은 다른 테이블이 쓰므로 건드리지 않는다.
CREATE FUNCTION public.payment_orders_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['updated_at','reconcile_attempt_count','next_reconcile_at','last_reconciled_at',
                            'last_reconcile_error_code','last_reconcile_error_message'])
     = (to_jsonb(OLD) - ARRAY['updated_at','reconcile_attempt_count','next_reconcile_at','last_reconciled_at',
                              'last_reconcile_error_code','last_reconcile_error_message']) THEN
    NEW.updated_at := OLD.updated_at;   -- 대사 기록 열만 바뀐 경우
  ELSE
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

-- 트리거 함수는 직접 호출할 수 없지만 기본 권한으로 붙는 EXECUTE를 다른 새 함수와 같게 걷어 낸다.
REVOKE ALL ON FUNCTION public.payment_orders_touch_updated_at() FROM PUBLIC, anon, authenticated;

-- 같은 이름으로 교체해 prevent_payment_order_snapshot_update 다음 실행 순서를 유지한다(DROP 없이 SHARE ROW EXCLUSIVE).
CREATE OR REPLACE TRIGGER update_payment_orders_updated_at
  BEFORE UPDATE ON public.payment_orders
  FOR EACH ROW EXECUTE FUNCTION public.payment_orders_touch_updated_at();

-- 3. 인덱스: 리스 만료 run 탐색(2.12), 표식 없이 ignored로 닫힌 취소 계열 페이앱 통보 탐색(2.1).
CREATE INDEX payment_reconciliation_runs_running_idx
  ON public.payment_reconciliation_runs (lease_expires_at)
  WHERE status = 'running';

CREATE INDEX payment_webhook_events_ignored_cancel_idx
  ON public.payment_webhook_events (received_at)
  WHERE processing_status = 'ignored'
    AND event_type IN ('PAYAPP_PAY_STATE_9', 'PAYAPP_PAY_STATE_64', 'PAYAPP_PAY_STATE_70', 'PAYAPP_PAY_STATE_71');

-- 4. 백필: 끝나지 않은 채 리스가 만료된 run을 닫는다(2.12). 과거 건이라 스케줄러 연속 실패로는 세지 않는다.
DO $$
DECLARE
  v_closed integer;
BEGIN
  UPDATE public.payment_reconciliation_runs
     SET status = 'failed',
         completed_at = now(),
         last_error_code = 'PAYMENT_RECONCILIATION_RUN_ABANDONED',
         last_error_message = '대사 작업이 끝나지 않은 채 리스가 만료되었습니다.'
   WHERE status = 'running' AND lease_expires_at <= now();

  GET DIAGNOSTICS v_closed = ROW_COUNT;
  RAISE NOTICE 'PAYMENT_INTEGRITY: closed % abandoned reconciliation runs', v_closed;
END;
$$;

-- 5. 경보 중복 제거 키(2.2): 주문 경보는 (code, 주문), 주문 없는 통보 경보는 (code, mul_no),
--    따로 세야 하는 경보는 (code, dedupe_key), 셋 다 없으면 지금처럼 code당 1건.
DROP INDEX public.payment_reconciliation_alerts_active_code_key;

CREATE UNIQUE INDEX payment_reconciliation_alerts_active_key
  ON public.payment_reconciliation_alerts (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', '')))
  WHERE resolved_at IS NULL;

-- 6. 함수 재정의. 모두 SECURITY DEFINER·SET search_path TO 'public', 'pg_temp'를 명시한다. ACL은 CREATE OR REPLACE가 유지한다.

CREATE OR REPLACE FUNCTION public.record_payment_alert(p_code text, p_severity text, p_message text, p_details jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_inserted integer;
BEGIN
  IF NULLIF(BTRIM(p_code), '') IS NULL
     OR p_severity NOT IN ('warning', 'critical')
     OR NULLIF(BTRIM(p_message), '') IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_ALERT_INPUT_INVALID';
  END IF;

  INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
  VALUES (LEFT(p_code, 120), p_severity, LEFT(p_message, 500), COALESCE(p_details, '{}'::jsonb))
  ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_payment_reconciliation_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scheduler public.payment_reconciliation_scheduler%ROWTYPE;
  v_stale_count integer;
  v_manual_count integer;
  v_backlog integer;
  v_scheduler_stale boolean;
  v_should_disable boolean;
  v_code text;
  v_message text;
  v_kakao_marker_active_count integer;
  v_kakao_marker_frozen_count integer;
  v_kakao_marker_disable boolean;
  v_payapp_unfulfilled_count integer;
  v_payapp_money_review_count integer;
  v_payapp_cancel_active_count integer;
  v_payapp_cancel_frozen_count integer;
  v_payapp_scheduler_unhealthy boolean;
  v_payapp_disable boolean;
  v_payapp_code text;
  v_feedback_ack timestamptz;
  v_feedback_unprocessed_count integer;
  v_feedback_latest timestamptz;
BEGIN
  SELECT *
    INTO v_scheduler
    FROM public.payment_reconciliation_scheduler
   WHERE id = 1;

  SELECT COUNT(*)::integer
    INTO v_stale_count
    FROM public.payment_orders
   WHERE provider = 'kakaopay'
     AND status IN ('confirming', 'fulfillment_pending')
     AND updated_at <= now() - interval '10 minutes';

  SELECT COUNT(*)::integer
    INTO v_manual_count
    FROM public.payment_orders
   WHERE provider = 'kakaopay'
     AND status = 'manual_review';

  v_backlog := public.payment_reconciliation_backlog_count();
  v_scheduler_stale := v_scheduler.last_started_at IS NOT NULL
    AND (
      v_scheduler.last_succeeded_at IS NULL
      OR v_scheduler.last_succeeded_at <= now() - interval '15 minutes'
    );
  v_should_disable := v_stale_count > 0
    OR v_manual_count > 0
    OR v_scheduler_stale
    OR v_scheduler.consecutive_failures >= 3;

  IF v_stale_count > 0 THEN
    v_code := 'PAYMENT_RECONCILIATION_STALE_PAYMENT';
    v_message := '10분 이상 완료되지 않은 카카오페이 승인 또는 지급 건이 있습니다.';
  ELSIF v_manual_count > 0 THEN
    v_code := 'PAYMENT_RECONCILIATION_MANUAL_REVIEW';
    v_message := '카카오페이 대사 수동 확인 건이 있습니다.';
  ELSIF v_scheduler.consecutive_failures >= 3 THEN
    v_code := 'PAYMENT_RECONCILIATION_REPEATED_FAILURE';
    v_message := '결제 대사 작업이 3회 연속 실패했습니다.';
  ELSIF v_scheduler_stale THEN
    v_code := 'PAYMENT_RECONCILIATION_SCHEDULER_STALE';
    v_message := '결제 대사 성공 기록이 15분 이상 갱신되지 않았습니다.';
  END IF;

  IF v_should_disable THEN
    UPDATE public.payment_runtime_config
       SET kakaopay_accepts_new_orders = false,
           changed_at = now(),
           changed_by = 'payment_reconciliation_health',
           change_ticket = v_code
     WHERE id = true
       AND kakaopay_accepts_new_orders = true;

    INSERT INTO public.payment_reconciliation_alerts (
      code,
      severity,
      message,
      details
    )
    SELECT
      v_code,
      'critical',
      v_message,
      jsonb_build_object(
        'stale_count', v_stale_count,
        'manual_review_count', v_manual_count,
        'backlog', v_backlog,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    WHERE NOT EXISTS (
      SELECT 1
        FROM public.payment_reconciliation_alerts pra
       WHERE pra.code = v_code
         AND pra.resolved_at IS NULL
    );
  END IF;

  -- 카카오 부분취소 표식 블록: 미처리 표식 + 크레딧 사용 가능이 10분을 넘으면 카카오 판매를 끈다.
  SELECT
    COUNT(*) FILTER (WHERE cs.status = 'active')::integer,
    COUNT(*) FILTER (WHERE cs.status IS DISTINCT FROM 'active')::integer
    INTO v_kakao_marker_active_count, v_kakao_marker_frozen_count
    FROM public.payment_orders po
    JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
    LEFT JOIN public.credit_sources cs ON cs.payment_order_id = po.id
   WHERE po.provider = 'kakaopay'
     AND ppt.partial_cancel_feedback_recorded_at <= now() - interval '10 minutes'
     AND ppt.partial_cancel_processed_at IS NULL;

  v_kakao_marker_disable := v_kakao_marker_active_count > 0;

  IF v_kakao_marker_disable THEN
    UPDATE public.payment_runtime_config
       SET kakaopay_accepts_new_orders = false,
           changed_at = now(),
           changed_by = 'payment_reconciliation_health',
           change_ticket = 'KAKAOPAY_PARTIAL_CANCEL_UNPROCESSED'
     WHERE id = true
       AND kakaopay_accepts_new_orders = true;

    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'KAKAOPAY_PARTIAL_CANCEL_UNPROCESSED',
      'critical',
      '카카오페이 부분취소 처리가 10분 넘게 끝나지 않았고 크레딧을 쓸 수 있는 상태입니다.',
      jsonb_build_object('count', v_kakao_marker_active_count)
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  ELSIF v_kakao_marker_frozen_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'KAKAOPAY_PARTIAL_CANCEL_UNPROCESSED_FROZEN',
      'warning',
      '카카오페이 부분취소 처리가 10분 넘게 끝나지 않았습니다(크레딧은 묶여 있음).',
      jsonb_build_object('count', v_kakao_marker_frozen_count)
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  -- 페이앱 블록: 돈이 걸린 위험만 판매를 끈다.
  SELECT COUNT(*)::integer
    INTO v_payapp_unfulfilled_count
    FROM public.payment_orders po
    JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
   WHERE po.provider = 'payapp'
     AND ppt.paid_feedback_recorded_at <= now() - interval '10 minutes'
     AND po.source_id IS NULL
     AND ppt.cancel_feedback_recorded_at IS NULL
     AND ppt.partial_cancel_feedback_recorded_at IS NULL;

  SELECT COUNT(*)::integer
    INTO v_payapp_money_review_count
    FROM public.payment_orders po
   WHERE po.provider = 'payapp'
     AND po.status = 'manual_review'
     AND po.failure_code IN (
       'PAYAPP_FEEDBACK_MISMATCH',
       'PAYAPP_MUL_NO_CONFLICT',
       'PAYAPP_PARTIAL_CANCEL',
       'PAYAPP_READY_CANCEL_FAILED',
       'PAYAPP_FULFILLMENT_RETRY_EXHAUSTED',
       'PAYAPP_CANCEL_HANDLING_FAILED'
     );

  SELECT
    COUNT(*) FILTER (WHERE cs.status = 'active')::integer,
    COUNT(*) FILTER (WHERE cs.status IS DISTINCT FROM 'active')::integer
    INTO v_payapp_cancel_active_count, v_payapp_cancel_frozen_count
    FROM public.payment_orders po
    JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
    LEFT JOIN public.credit_sources cs ON cs.payment_order_id = po.id
   WHERE po.provider = 'payapp'
     AND (
       (ppt.cancel_feedback_recorded_at <= now() - interval '10 minutes'
        AND ppt.cancel_processed_at IS NULL)
       OR (ppt.partial_cancel_feedback_recorded_at <= now() - interval '10 minutes'
           AND ppt.partial_cancel_processed_at IS NULL)
     );

  v_payapp_scheduler_unhealthy := v_scheduler_stale OR v_scheduler.consecutive_failures >= 3;

  v_payapp_disable := v_payapp_unfulfilled_count > 0
    OR v_payapp_money_review_count > 0
    OR v_payapp_cancel_active_count > 0
    OR v_payapp_scheduler_unhealthy;

  -- change_ticket에 남길 첫 code. 경보는 아래에서 조건마다 따로 남긴다.
  IF v_payapp_unfulfilled_count > 0 THEN
    v_payapp_code := 'PAYAPP_PAID_UNFULFILLED';
  ELSIF v_payapp_cancel_active_count > 0 THEN
    v_payapp_code := 'PAYAPP_CANCEL_UNPROCESSED';
  ELSIF v_payapp_money_review_count > 0 THEN
    v_payapp_code := 'PAYAPP_MONEY_RISK_REVIEW';
  ELSIF v_payapp_scheduler_unhealthy THEN
    v_payapp_code := 'PAYAPP_RECONCILIATION_UNHEALTHY';
  END IF;

  IF v_payapp_disable THEN
    UPDATE public.payment_runtime_config
       SET payapp_accepts_new_orders = false,
           changed_at = now(),
           changed_by = 'payment_reconciliation_health',
           change_ticket = v_payapp_code
     WHERE id = true
       AND payapp_accepts_new_orders = true;
  END IF;

  -- 스케줄러 이상은 기존 블록이 이미 경보를 남기므로 돈 위험 조건만 페이앱 경보로 남긴다.
  -- 조건마다 따로 남겨 한 조건이 다른 조건(특히 취소 미처리)을 가리지 않게 한다.
  IF v_payapp_unfulfilled_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_PAID_UNFULFILLED',
      'critical',
      '결제완료가 기록됐지만 10분 넘게 크레딧이 지급되지 않은 페이앱 건이 있습니다.',
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_cancel_active_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_CANCEL_UNPROCESSED',
      'critical',
      '페이앱 취소 처리가 10분 넘게 끝나지 않았고 크레딧을 쓸 수 있는 상태입니다.',
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_money_review_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_MONEY_RISK_REVIEW',
      'critical',
      '돈이 걸린 페이앱 수동 확인 건이 있습니다.',
      jsonb_build_object(
        'paid_unfulfilled_count', v_payapp_unfulfilled_count,
        'money_review_count', v_payapp_money_review_count,
        'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
        'consecutive_failures', v_scheduler.consecutive_failures,
        'last_succeeded_at', v_scheduler.last_succeeded_at
      )
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  IF v_payapp_cancel_frozen_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES (
      'PAYAPP_CANCEL_UNPROCESSED_FROZEN',
      'warning',
      '페이앱 취소 처리가 10분 넘게 끝나지 않았습니다(크레딧은 묶여 있거나 지급 전).',
      jsonb_build_object('count', v_payapp_cancel_frozen_count)
    )
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  -- 기록되지 않은 페이앱 통보: 경보만 남기고 판매는 끄지 않는다.
  -- 이미 확인(해소)된 경보가 덮은 시각 이후만 센다. 해소하면 다시 울리지 않는다.
  SELECT MAX((details->>'latest_received_at')::timestamptz)
    INTO v_feedback_ack
    FROM public.payment_reconciliation_alerts
   WHERE code = 'PAYAPP_FEEDBACK_UNPROCESSED';

  -- pending·failed는 payment_webhook_events_pending_idx, 표식 없이 ignored로 닫힌 취소 계열 통보는
  -- payment_webhook_events_ignored_cancel_idx를 타도록 두 부분으로 나눈다.
  -- PROCESS: 실패는 표식이 이미 커밋된 경우라 취소 미처리 점검과 대사가 다룬다. 사이트 밖 통보는 뺀다.
  SELECT COUNT(*)::integer, MAX(e.received_at)
    INTO v_feedback_unprocessed_count, v_feedback_latest
    FROM (
      SELECT pwe.received_at
        FROM public.payment_webhook_events pwe
       WHERE pwe.processing_status IN ('pending', 'failed')
         AND pwe.transmission_id LIKE 'payapp:%'
         AND pwe.received_at <= now() - interval '30 minutes'
         AND pwe.received_at > COALESCE(v_feedback_ack, '-infinity'::timestamptz)
         AND (pwe.processing_status = 'pending'
              OR COALESCE(pwe.last_error_code, '') NOT LIKE 'PROCESS:%')
      UNION ALL
      SELECT pwe.received_at
        FROM public.payment_webhook_events pwe
       WHERE pwe.processing_status = 'ignored'
         AND pwe.event_type IN ('PAYAPP_PAY_STATE_9', 'PAYAPP_PAY_STATE_64', 'PAYAPP_PAY_STATE_70', 'PAYAPP_PAY_STATE_71')
         AND pwe.transmission_id LIKE 'payapp:%'
         AND pwe.received_at <= now() - interval '30 minutes'
         AND pwe.received_at > COALESCE(v_feedback_ack, '-infinity'::timestamptz)
         AND COALESCE(pwe.last_error_code, '') <> 'PAYAPP_FOREIGN_FEEDBACK'
    ) e;

  IF v_feedback_unprocessed_count > 0 THEN
    INSERT INTO public.payment_reconciliation_alerts (code, severity, message, details)
    VALUES ('PAYAPP_FEEDBACK_UNPROCESSED', 'critical',
            '30분 넘게 처리되지 않은 페이앱 통보가 있습니다. 페이앱 관리자 내역과 대조하세요.',
            jsonb_build_object('count', v_feedback_unprocessed_count, 'latest_received_at', v_feedback_latest))
    ON CONFLICT (code, (COALESCE(details ->> 'payment_order_id', details ->> 'mul_no', details ->> 'dedupe_key', ''))) WHERE resolved_at IS NULL DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'healthy', NOT (v_should_disable OR v_kakao_marker_disable),
    'backlog', v_backlog,
    'stale_count', v_stale_count,
    'manual_review_count', v_manual_count,
    'consecutive_failures', v_scheduler.consecutive_failures,
    'last_started_at', v_scheduler.last_started_at,
    'last_succeeded_at', v_scheduler.last_succeeded_at,
    'kakaopay_disabled', v_should_disable OR v_kakao_marker_disable,
    'payapp_disabled', v_payapp_disable
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.process_payapp_cancellation(p_payment_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_request public.refund_requests%ROWTYPE;
  v_marker text;
  v_pre_source_id uuid;
  v_pre_request_id uuid;
  v_now_request_id uuid;
  v_result text;
  v_detail jsonb := '{}'::jsonb;
  v_error_state text;
  v_error_message text;
  v_cancel_key text;
  v_alert_code text;
  v_alert_details jsonb;
BEGIN
  -- 잠금 없이 읽어 처리할 표식과 잠글 행을 정한다.
  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id;

  IF v_order.id IS NULL OR v_order.provider <> 'payapp' OR v_ppt.id IS NULL THEN
    RAISE EXCEPTION 'PAYAPP_ORDER_NOT_FOUND';
  END IF;

  IF v_ppt.cancel_feedback_recorded_at IS NOT NULL AND v_ppt.cancel_processed_at IS NULL THEN
    v_marker := 'cancel';
  ELSIF v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL AND v_ppt.partial_cancel_processed_at IS NULL THEN
    v_marker := 'partial_cancel';
  ELSE
    RETURN jsonb_build_object('result', 'nothing_to_process');
  END IF;

  v_pre_source_id := v_order.source_id;
  IF v_pre_source_id IS NOT NULL THEN
    SELECT id INTO v_pre_request_id
      FROM public.refund_requests
     WHERE source_id = v_pre_source_id
       AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
     ORDER BY created_at DESC
     LIMIT 1;
  END IF;

  BEGIN
    -- 환불 순서: refund_requests → credit_sources → payment_orders → payment_provider_transactions → profiles
    IF v_pre_request_id IS NOT NULL THEN
      SELECT * INTO v_request
        FROM public.refund_requests
       WHERE id = v_pre_request_id
       FOR UPDATE;
    END IF;

    IF v_pre_source_id IS NOT NULL THEN
      SELECT * INTO v_source
        FROM public.credit_sources
       WHERE id = v_pre_source_id
       FOR UPDATE;
    END IF;

    SELECT * INTO v_order
      FROM public.payment_orders
     WHERE id = p_payment_order_id
     FOR UPDATE;

    SELECT * INTO v_ppt
      FROM public.payment_provider_transactions
     WHERE payment_order_id = p_payment_order_id
     FOR UPDATE;

    PERFORM 1
      FROM public.profiles
     WHERE id = v_order.user_id
     FOR UPDATE;

    IF v_pre_source_id IS NOT NULL THEN
      SELECT id INTO v_now_request_id
        FROM public.refund_requests
       WHERE source_id = v_pre_source_id
         AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
       ORDER BY created_at DESC
       LIMIT 1;
    END IF;

    -- 잠금 전 판단과 다르면 아무것도 쓰지 않고 재시도한다.
    IF v_order.source_id IS DISTINCT FROM v_pre_source_id
       OR v_now_request_id IS DISTINCT FROM v_pre_request_id
       OR (v_marker = 'cancel' AND v_ppt.cancel_processed_at IS NOT NULL)
       OR (v_marker = 'partial_cancel' AND (
             v_ppt.partial_cancel_processed_at IS NOT NULL
             OR (v_ppt.cancel_feedback_recorded_at IS NOT NULL AND v_ppt.cancel_processed_at IS NULL)
           )) THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'PAYAPP_CANCELLATION_STATE_CHANGED';
    END IF;

    v_cancel_key := 'payapp-cancel:' || v_ppt.provider_transaction_id;

    IF v_marker = 'cancel' THEN
      IF v_order.source_id IS NULL THEN
        -- 지급 전 승인취소: 어떤 경로로도 지급하지 않는다.
        UPDATE public.payment_orders
           SET status = 'failed',
               canceled_at = COALESCE(canceled_at, v_ppt.provider_cancelled_at, now()),
               failure_code = 'PAYAPP_CANCELLED_BEFORE_FULFILLMENT',
               failure_message = '크레딧 지급 전에 페이앱 결제가 취소되었습니다.',
               next_reconcile_at = NULL,
               updated_at = now()
         WHERE id = v_order.id;

        UPDATE public.checkout_attempts
           SET status = 'cancelled',
               updated_at = now()
         WHERE id = v_order.checkout_attempt_id
           AND status <> 'completed';

        v_result := 'cancelled_before_fulfillment';
      ELSIF v_order.status = 'refunded' THEN
        v_result := 'already_refunded';
        IF EXISTS (
          SELECT 1
            FROM public.refund_requests rr
            JOIN public.payment_admin_actions paa
              ON paa.refund_request_id = rr.id
             AND paa.action = 'manual_refund_completed'
           WHERE rr.source_id = v_order.source_id
             AND rr.status = 'completed'
             AND rr.provider_cancel_transaction_key IS NULL
             AND paa.external_method = 'bank_transfer'
        ) THEN
          v_result := 'double_refund_suspected';
        END IF;
      ELSIF v_request.id IS NOT NULL AND v_request.origin IN ('external_cancel', 'partial_cancel') THEN
        v_result := 'already_quarantined';
      ELSIF v_request.id IS NOT NULL
            AND v_request.status = 'manual_review' AND v_request.origin = 'user'
            AND v_ppt.paid_feedback_recorded_at IS NULL
            AND v_ppt.admin_paid_confirmed_at IS NOT NULL THEN
        -- 관리자가 입력한 결제번호라 이 취소가 우리 결제인지 검증되지 않았다. 자동 완료하지 않는다.
        v_result := 'already_quarantined';
        v_detail := jsonb_build_object('reason', 'admin_confirmed_mul_no_unverified');
      ELSIF v_request.id IS NOT NULL
            AND (v_request.status IN ('processing', 'retryable_failed')
                 OR (v_request.status = 'manual_review' AND v_request.origin = 'user')) THEN
        v_detail := public.finalize_point_charge_refund(
          v_request.id,
          v_cancel_key,
          COALESCE(v_ppt.provider_cancelled_at, now()),
          'CANCELED'
        );
        v_result := 'refund_finalized';
        v_detail := v_detail || jsonb_build_object('request_id', v_request.id, 'user_id', v_request.user_id);
      ELSE
        v_detail := public.quarantine_external_provider_cancellation(
          v_order.id,
          v_cancel_key,
          COALESCE(v_ppt.provider_cancelled_at, now()),
          'CANCELED'
        );
        v_result := 'external_cancel_quarantined';
      END IF;

      UPDATE public.payment_provider_transactions
         SET cancel_processed_at = COALESCE(cancel_processed_at, now()),
             updated_at = now()
       WHERE id = v_ppt.id;
    ELSE
      IF v_ppt.cancel_processed_at IS NOT NULL THEN
        -- 승인취소를 이미 처리한 뒤에 온 부분취소: 바꾸지 않고 경보만.
        v_result := 'partial_cancel_after_cancel';
        IF v_order.status = 'refunded' THEN
          v_detail := jsonb_build_object(
            'partial_cancel_amount', v_ppt.partial_cancel_amount,
            'actual_refund_amount', CASE
              WHEN v_ppt.partial_cancel_amount IS NOT NULL
                THEN v_order.expected_amount - v_ppt.partial_cancel_amount
            END
          );
        END IF;
        UPDATE public.payment_provider_transactions
           SET partial_cancel_processed_at = COALESCE(partial_cancel_processed_at, now()),
               updated_at = now()
         WHERE id = v_ppt.id;
      ELSIF v_order.source_id IS NULL THEN
        UPDATE public.payment_orders
           SET status = 'manual_review',
               failure_code = 'PAYAPP_PARTIAL_CANCEL',
               failure_message = '크레딧 지급 전에 페이앱 결제가 부분취소되었습니다.',
               next_reconcile_at = NULL,
               updated_at = now()
         WHERE id = v_order.id;

        UPDATE public.checkout_attempts
           SET status = 'manual_review',
               updated_at = now()
         WHERE id = v_order.checkout_attempt_id
           AND status <> 'completed';

        UPDATE public.payment_provider_transactions
           SET partial_cancel_processed_at = COALESCE(partial_cancel_processed_at, now()),
               updated_at = now()
         WHERE id = v_ppt.id;

        v_result := 'partial_cancel_unpaid';
      ELSE
        v_detail := public.quarantine_payapp_partial_cancellation(v_order.id);
        v_result := CASE
          WHEN v_detail->>'outcome' = 'deferred_refund_processing' THEN 'deferred_refund_processing'
          ELSE 'partial_cancel_quarantined'
        END;
      END IF;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_error_state = RETURNED_SQLSTATE,
        v_error_message = MESSAGE_TEXT;
      IF v_error_state IN ('40P01', '40001', '55P03') THEN
        RAISE;
      END IF;
      v_result := NULL;
  END;

  IF v_result IS NOT NULL THEN
    -- 취소 후속 경보를 처리 시각과 같은 트랜잭션에 남긴다. code·문구는 TS cancellationFollowUps와 같다.
    -- TS가 같은 경보를 다시 기록해도 (code, payment_order_id) 키라 DO NOTHING이 된다.
    v_alert_code := CASE
      WHEN v_result = 'double_refund_suspected' THEN 'PAYAPP_DOUBLE_REFUND_SUSPECTED'
      WHEN v_result = 'already_quarantined' AND v_marker = 'cancel' THEN 'PAYAPP_CANCEL_AFTER_QUARANTINE'
      WHEN v_result = 'partial_cancel_after_cancel' THEN 'PAYAPP_PARTIAL_CANCEL_AFTER_CANCEL'
      WHEN v_result = 'partial_cancel_quarantined' AND v_detail->>'outcome' = 'absorbed_by_refund' THEN 'PAYAPP_PARTIAL_CANCEL_ABSORBED'
      WHEN v_result = 'deferred_refund_processing' THEN 'PAYAPP_PARTIAL_CANCEL_DEFERRED'
      -- 관리자 결제확인 주문에 열린 manual_review·user 요청이 없으면 외부 전취소 격리로 간다.
      -- 결제번호가 페이앱 통보로 검증되지 않았으므로 critical로 남긴다.
      WHEN v_result = 'external_cancel_quarantined'
           AND v_ppt.paid_feedback_recorded_at IS NULL
           AND v_ppt.admin_paid_confirmed_at IS NOT NULL THEN 'PAYAPP_CANCEL_AFTER_QUARANTINE'
    END;

    IF v_alert_code IS NOT NULL THEN
      v_alert_details := jsonb_build_object('order_id', v_order.order_id, 'payment_order_id', v_order.id, 'source', 'process_payapp_cancellation')
        || (COALESCE(v_detail, '{}'::jsonb) - 'request_id' - 'user_id');
      IF v_result = 'external_cancel_quarantined' THEN
        v_alert_details := v_alert_details || jsonb_build_object('reason', 'admin_confirmed_mul_no_unverified');
      END IF;

      PERFORM public.record_payment_alert(
        v_alert_code,
        CASE WHEN v_alert_code IN ('PAYAPP_DOUBLE_REFUND_SUSPECTED', 'PAYAPP_CANCEL_AFTER_QUARANTINE') THEN 'critical' ELSE 'warning' END,
        CASE v_alert_code
          WHEN 'PAYAPP_DOUBLE_REFUND_SUSPECTED' THEN '계좌이체로 환불한 결제가 페이앱에서도 취소되었습니다.'
          WHEN 'PAYAPP_CANCEL_AFTER_QUARANTINE' THEN '수동 확인 중인 결제가 페이앱에서 승인취소되었습니다. 전액 환불 기준으로 처리하세요.'
          WHEN 'PAYAPP_PARTIAL_CANCEL_AFTER_CANCEL' THEN '승인취소를 처리한 결제에 부분취소가 통보되었습니다. 실제 환불액을 확인하세요.'
          WHEN 'PAYAPP_PARTIAL_CANCEL_ABSORBED' THEN '전액 환불된 결제에 부분취소가 통보되었습니다. 실제 환불액을 확인하세요.'
          WHEN 'PAYAPP_PARTIAL_CANCEL_DEFERRED' THEN '환불 처리 중인 결제에 부분취소가 통보되었습니다. 환불이 끝난 뒤 대사가 정리합니다.'
        END,
        v_alert_details
      );
    END IF;

    RETURN jsonb_build_object(
      'result', v_result,
      'marker', v_marker,
      'payment_order_id', v_order.id,
      'order_id', v_order.order_id,
      'user_id', v_order.user_id
    ) || v_detail;
  END IF;

  -- 실패 대체 처리: 크레딧을 묶고 manual_review로 보낸 뒤 처리 시각을 남긴다.
  v_request := NULL;
  v_source := NULL;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id;

  IF v_order.source_id IS NOT NULL THEN
    SELECT * INTO v_request
      FROM public.refund_requests
     WHERE source_id = v_order.source_id
       AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE;

    SELECT * INTO v_source
      FROM public.credit_sources
     WHERE id = v_order.source_id
     FOR UPDATE;
  END IF;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = p_payment_order_id
   FOR UPDATE;

  PERFORM 1
    FROM public.profiles
   WHERE id = v_order.user_id
   FOR UPDATE;

  IF v_source.id IS NOT NULL AND v_source.status <> 'refunded' THEN
    UPDATE public.credit_sources
       SET status = 'pending_refund'
     WHERE id = v_source.id
       AND status = 'active';

    IF v_request.id IS NOT NULL THEN
      UPDATE public.refund_requests
         SET status = 'manual_review',
             next_attempt_at = NULL,
             last_error_code = 'PAYAPP_CANCEL_HANDLING_FAILED',
             last_error_message = LEFT(format('페이앱 취소 처리 실패(%s): %s', v_error_state, v_error_message), 500),
             origin = CASE WHEN origin = 'user' THEN 'external_cancel' ELSE origin END
       WHERE id = v_request.id;
    ELSE
      INSERT INTO public.refund_requests (
        user_id,
        source_id,
        reason,
        status,
        payment_order_id,
        provider,
        refund_amount,
        cancel_idempotency_key,
        last_error_code,
        last_error_message,
        origin
      ) VALUES (
        v_order.user_id,
        v_source.id,
        '결제사 취소 처리 실패',
        'manual_review',
        v_order.id,
        'payapp',
        v_order.expected_amount,
        v_order.cancel_idempotency_key,
        'PAYAPP_CANCEL_HANDLING_FAILED',
        LEFT(format('페이앱 취소 처리 실패(%s): %s', v_error_state, v_error_message), 500),
        'external_cancel'
      );
    END IF;
  END IF;

  IF v_order.status <> 'refunded' THEN
    UPDATE public.payment_orders
       SET status = 'manual_review',
           failure_code = 'PAYAPP_CANCEL_HANDLING_FAILED',
           failure_message = '페이앱 취소 통보를 자동으로 처리하지 못해 크레딧을 격리했습니다.',
           next_reconcile_at = NULL,
           updated_at = now()
     WHERE id = v_order.id;
  END IF;

  UPDATE public.payment_provider_transactions
     SET cancel_processed_at = CASE
           WHEN v_marker = 'cancel' THEN COALESCE(cancel_processed_at, now())
           ELSE cancel_processed_at
         END,
         partial_cancel_processed_at = CASE
           WHEN v_marker = 'partial_cancel' THEN COALESCE(partial_cancel_processed_at, now())
           ELSE partial_cancel_processed_at
         END,
         updated_at = now()
   WHERE id = v_ppt.id;

  -- 실패 대체 처리의 경보도 처리 시각과 같은 트랜잭션에 남긴다(TS cancellationFollowUps와 같은 code·문구).
  PERFORM public.record_payment_alert(
    'PAYAPP_CANCEL_HANDLING_FAILED',
    'critical',
    '페이앱 취소 처리에 실패해 크레딧을 묶고 수동 확인으로 보냈습니다.',
    jsonb_build_object('order_id', v_order.order_id, 'payment_order_id', v_order.id, 'source', 'process_payapp_cancellation',
                       'error_state', v_error_state)
  );

  RETURN jsonb_build_object(
    'result', 'cancel_handling_failed',
    'marker', v_marker,
    'payment_order_id', v_order.id,
    'order_id', v_order.order_id,
    'error_state', v_error_state
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_manual_point_charge_refund(p_request_id uuid, p_admin_id uuid, p_note text, p_external_method text, p_refund_amount integer, p_recovered_credits integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.refund_requests%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_partial boolean;
  v_recovered integer;
  v_remaining_after integer;
  v_used_before integer;
  v_balance_before integer;
  v_new_balance integer;
  v_source_status_after text;
  v_double boolean := false;
BEGIN
  IF p_admin_id IS NULL
     OR NULLIF(BTRIM(p_note), '') IS NULL
     OR p_external_method IS NULL
     OR p_external_method NOT IN ('payapp_cancel_request', 'bank_transfer', 'provider_admin_cancel')
     OR p_refund_amount IS NULL
     OR p_refund_amount NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'MANUAL_REFUND_INPUT_INVALID';
  END IF;

  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_FOUND';
  END IF;

  IF v_request.status = 'completed' THEN
    -- 계좌 송금 외의 방식(결제사 취소 통보, 페이앱 취소 요청, 페이앱 관리자 취소)으로 이미 완료된 요청에
    -- 계좌 송금 완료가 들어오면 이중 환불 의심이다. 같은 계좌 송금의 재클릭은 제외한다.
    IF p_external_method = 'bank_transfer' AND NOT EXISTS (
         SELECT 1 FROM public.payment_admin_actions paa
          WHERE paa.refund_request_id = v_request.id
            AND paa.action = 'manual_refund_completed'
            AND paa.external_method = 'bank_transfer') THEN
      PERFORM public.record_payment_alert('PAYAPP_DOUBLE_REFUND_SUSPECTED', 'critical',
        '이미 다른 방식으로 환불이 완료된 요청에 계좌 송금 완료가 입력되었습니다. 송금했다면 회수가 필요합니다.',
        jsonb_build_object('payment_order_id', v_request.payment_order_id, 'refund_request_id', v_request.id,
                           'actor_id', p_admin_id, 'provider_cancel_transaction_key', v_request.provider_cancel_transaction_key,
                           'dedupe_key', 'refund_request:' || v_request.id::text,
                           'source', 'complete_manual_after_completed'));
      v_double := true;
    END IF;

    SELECT credits INTO v_new_balance
      FROM public.profiles
     WHERE id = v_request.user_id;

    RETURN jsonb_build_object('already_completed', true, 'new_balance', v_new_balance, 'double_refund_suspected', v_double);
  END IF;

  IF v_request.status <> 'manual_review' THEN
    RAISE EXCEPTION 'MANUAL_REFUND_NOT_ALLOWED';
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = v_request.source_id
   FOR UPDATE;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_request.payment_order_id
   FOR UPDATE;

  IF v_order.id IS NOT NULL THEN
    SELECT * INTO v_ppt
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
     FOR UPDATE;
  END IF;

  SELECT credits INTO v_balance_before
    FROM public.profiles
   WHERE id = v_request.user_id
   FOR UPDATE;

  IF v_order.id IS NULL
     OR v_order.status NOT IN ('completed', 'manual_review')
     OR v_source.id IS NULL
     OR v_source.status <> 'pending_refund'
     OR p_refund_amount > v_order.expected_amount THEN
    RAISE EXCEPTION 'MANUAL_REFUND_REVALIDATION_FAILED';
  END IF;

  -- 처리되지 않은 부분취소 표식이 있으면 격리가 끝난 뒤에 완료한다(나중에 원천이 다시 묶이지 않게).
  IF v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
     AND v_ppt.partial_cancel_processed_at IS NULL THEN
    RAISE EXCEPTION 'MANUAL_REFUND_MARKER_PENDING';
  END IF;

  -- 승인취소(전액) 표식이 있으면 PG는 전액 환불이므로 부분 회수를 허용하지 않는다(남은 크레딧 전량 회수).
  v_partial := v_ppt.cancel_feedback_recorded_at IS NULL
    AND COALESCE(
    v_request.origin = 'partial_cancel'
    OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL
    OR v_request.last_error_code IN ('KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW'),
    false
  );

  IF v_partial THEN
    IF p_recovered_credits IS NULL
       OR p_recovered_credits NOT BETWEEN 0 AND v_source.remaining_credits THEN
      RAISE EXCEPTION 'MANUAL_REFUND_RECOVERY_INVALID';
    END IF;
    v_recovered := p_recovered_credits;
  ELSE
    IF p_recovered_credits IS NOT NULL
       AND p_recovered_credits <> v_source.remaining_credits THEN
      RAISE EXCEPTION 'MANUAL_REFUND_RECOVERY_INVALID';
    END IF;
    v_recovered := v_source.remaining_credits;
  END IF;

  v_used_before := v_source.initial_credits - v_source.remaining_credits;
  v_remaining_after := v_source.remaining_credits - v_recovered;
  v_source_status_after := CASE WHEN v_remaining_after > 0 THEN 'active' ELSE 'refunded' END;

  UPDATE public.credit_sources
     SET remaining_credits = v_remaining_after,
         status = v_source_status_after
   WHERE id = v_source.id;

  SELECT COALESCE(SUM(remaining_credits), 0)::integer
    INTO v_new_balance
    FROM public.credit_sources
   WHERE user_id = v_request.user_id
     AND status IN ('active', 'pending_refund')
     AND (expires_at IS NULL OR expires_at > now());

  UPDATE public.profiles
     SET credits = v_new_balance
   WHERE id = v_request.user_id;

  IF v_recovered > 0 THEN
    INSERT INTO public.credit_transactions (
      user_id,
      type,
      amount,
      balance_after,
      description,
      source_id,
      resource_type,
      resource_id
    ) VALUES (
      v_request.user_id,
      'refund',
      -v_recovered,
      v_new_balance,
      format('수동 환불 완료 (%s 크레딧 회수)', v_recovered),
      v_source.id,
      'refund_request',
      v_request.id
    );
  END IF;

  IF v_source_status_after = 'refunded' THEN
    UPDATE public.payment_orders
       SET status = 'refunded',
           canceled_at = COALESCE(canceled_at, now()),
           next_reconcile_at = NULL
     WHERE id = v_order.id;

    UPDATE public.payment_history
       SET status = 'refunded'
     WHERE payment_order_id = v_order.id;

    UPDATE public.checkout_attempts
       SET status = 'cancelled',
           updated_at = now()
     WHERE id = v_order.checkout_attempt_id;
  ELSE
    UPDATE public.payment_orders
       SET status = 'completed',
           failure_code = NULL,
           failure_message = NULL,
           next_reconcile_at = NULL
     WHERE id = v_order.id;
  END IF;

  UPDATE public.refund_requests
     SET status = 'completed',
         refund_amount = p_refund_amount,
         processed_by = p_admin_id,
         processed_at = now(),
         next_attempt_at = NULL
   WHERE id = v_request.id;

  INSERT INTO public.payment_admin_actions (
    actor_id,
    action,
    payment_order_id,
    refund_request_id,
    before_state,
    after_state,
    note,
    recovered_credits,
    unrecovered_credits,
    external_method,
    details
  ) VALUES (
    p_admin_id,
    'manual_refund_completed',
    v_order.id,
    v_request.id,
    jsonb_build_object(
      'request_status', v_request.status,
      'order_status', v_order.status,
      'source_status', v_source.status,
      'remaining_credits', v_source.remaining_credits,
      'profile_credits', v_balance_before
    ),
    jsonb_build_object(
      'request_status', 'completed',
      'order_status', CASE WHEN v_source_status_after = 'refunded' THEN 'refunded' ELSE 'completed' END,
      'source_status', v_source_status_after,
      'remaining_credits', v_remaining_after,
      'profile_credits', v_new_balance
    ),
    p_note,
    v_recovered,
    v_remaining_after,
    p_external_method,
    jsonb_build_object(
      'used_credits_before', v_used_before,
      'refund_amount', p_refund_amount,
      'partial', v_partial,
      'origin', v_request.origin
    )
  );

  RETURN jsonb_build_object(
    'already_completed', false,
    'new_balance', v_new_balance,
    'recovered_credits', v_recovered,
    'remaining_credits', v_remaining_after,
    'user_id', v_request.user_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_payapp_feedback(p_userid text, p_mul_no text, p_orig_mul_no text, p_order_id text, p_pay_state integer, p_price integer, p_orig_price integer, p_pay_type integer, p_pay_date timestamp with time zone, p_canceldate timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_is_marker boolean := p_pay_state IN (9, 64, 70, 71);
  v_lookup_mul_no text;
  v_by_mul_no uuid;
  v_by_order_id uuid;
  v_order_id uuid;
  v_order public.payment_orders%ROWTYPE;
  v_ppt public.payment_provider_transactions%ROWTYPE;
  v_reason text;
  v_status_text text;
  v_already boolean;
  v_expected_pay_types integer[];
  v_pay_type_mismatch boolean := false;
  v_paid_amount_conflict boolean := false;
  v_fulfill jsonb;
  v_error_state text;
BEGIN
  IF p_pay_state IS NULL THEN
    RETURN jsonb_build_object('result', 'ignored', 'reason', 'PAY_STATE_MISSING');
  END IF;

  -- 1. 주문 찾기(잠금 없음). 판단은 2단계에서 잠근 행으로 한다.
  v_lookup_mul_no := CASE WHEN p_pay_state IN (70, 71) THEN p_orig_mul_no ELSE p_mul_no END;

  IF v_lookup_mul_no IS NOT NULL THEN
    SELECT ppt.payment_order_id INTO v_by_mul_no
      FROM public.payment_provider_transactions ppt
     WHERE ppt.provider = 'payapp'
       AND ppt.provider_transaction_id = v_lookup_mul_no;
  END IF;

  IF NULLIF(BTRIM(p_order_id), '') IS NOT NULL THEN
    SELECT po.id INTO v_by_order_id
      FROM public.payment_orders po
     WHERE po.order_id = p_order_id
       AND po.provider = 'payapp';
  END IF;

  IF v_by_mul_no IS NOT NULL AND v_by_order_id IS NOT NULL
     AND v_by_mul_no <> v_by_order_id THEN
    RETURN jsonb_build_object('result', 'ignored', 'reason', 'PAYAPP_ORDER_REFERENCE_MISMATCH');
  END IF;

  v_order_id := COALESCE(v_by_mul_no, v_by_order_id);

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('result', 'order_not_found');
  END IF;

  -- 2·3. 취소 표식 경로: payment_provider_transactions 한 행만 잠그고 주문 행은 쓰지 않는다.
  IF v_is_marker THEN
    SELECT * INTO v_ppt
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order_id
     FOR UPDATE;

    -- 불변 스냅샷 값만 읽는다(잠금 없음).
    SELECT * INTO v_order
      FROM public.payment_orders
     WHERE id = v_order_id;

    IF v_ppt.id IS NULL OR v_ppt.provider <> 'payapp' THEN
      v_reason := 'PAYAPP_TRANSACTION_NOT_FOUND';
    ELSIF p_userid IS DISTINCT FROM v_order.provider_merchant_id THEN
      v_reason := 'PAYAPP_FEEDBACK_MERCHANT_MISMATCH';
    -- 부분취소 뒤 승인취소는 price가 잔액(원금 - 부분취소 금액)으로 올 수 있어 그 값도 받는다.
    -- price가 NULL이면 지금처럼 금액 불일치로 둔다.
    ELSIF p_pay_state IN (9, 64)
      AND p_price IS DISTINCT FROM v_order.expected_amount
      AND NOT (p_price IS NOT NULL
               AND v_ppt.partial_cancel_amount IS NOT NULL
               AND p_price = v_order.expected_amount - v_ppt.partial_cancel_amount) THEN
      v_reason := 'PAYAPP_FEEDBACK_AMOUNT_MISMATCH';
    ELSIF p_pay_state IN (70, 71) AND p_orig_price IS DISTINCT FROM v_order.expected_amount THEN
      v_reason := 'PAYAPP_FEEDBACK_AMOUNT_MISMATCH';
    ELSIF v_lookup_mul_no IS NULL
       OR (v_ppt.provider_transaction_id IS NOT NULL
           AND v_ppt.provider_transaction_id <> v_lookup_mul_no) THEN
      v_reason := 'PAYAPP_FEEDBACK_MUL_NO_MISMATCH';
    END IF;

    IF v_reason IS NOT NULL THEN
      RETURN jsonb_build_object(
        'result', 'ignored',
        'reason', v_reason,
        'payment_order_id', v_order_id,
        'order_id', v_order.order_id
      );
    END IF;

    IF p_pay_state IN (9, 64) THEN
      v_already := v_ppt.cancel_feedback_recorded_at IS NOT NULL;
    ELSE
      v_already := v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL;
      -- 금액은 처음 값만 남기고, 다른 금액이 다시 오면 결과 키로 알려 route가 경보를 남긴다.
      v_paid_amount_conflict := v_ppt.partial_cancel_amount IS NOT NULL
        AND p_price IS DISTINCT FROM v_ppt.partial_cancel_amount;
    END IF;

    BEGIN
      UPDATE public.payment_provider_transactions
         SET provider_transaction_id = COALESCE(provider_transaction_id, v_lookup_mul_no),
             cancel_feedback_recorded_at = CASE
               WHEN p_pay_state IN (9, 64) THEN COALESCE(cancel_feedback_recorded_at, now())
               ELSE cancel_feedback_recorded_at
             END,
             provider_cancelled_at = CASE
               WHEN p_pay_state IN (9, 64) THEN COALESCE(provider_cancelled_at, p_canceldate)
               ELSE provider_cancelled_at
             END,
             partial_cancel_feedback_recorded_at = CASE
               WHEN p_pay_state IN (70, 71) THEN COALESCE(partial_cancel_feedback_recorded_at, now())
               ELSE partial_cancel_feedback_recorded_at
             END,
             -- 부분취소 통보의 price는 취소된 금액이다. 원금 미만일 때만 기록한다.
             partial_cancel_amount = CASE
               WHEN p_pay_state IN (70, 71) AND p_price BETWEEN 1 AND v_order.expected_amount - 1
                 THEN COALESCE(partial_cancel_amount, p_price)
               ELSE partial_cancel_amount
             END,
             -- 표시용 상태는 진행 순위가 낮은 값으로 되돌리지 않는다.
             provider_status = CASE
               WHEN CASE provider_status WHEN '1' THEN 1 WHEN '10' THEN 2 WHEN '8' THEN 3 WHEN '16' THEN 3 WHEN '32' THEN 3 WHEN '4' THEN 4 WHEN '70' THEN 5 WHEN '71' THEN 5 WHEN '9' THEN 6 WHEN '64' THEN 6 ELSE 0 END >= CASE p_pay_state::text WHEN '1' THEN 1 WHEN '10' THEN 2 WHEN '8' THEN 3 WHEN '16' THEN 3 WHEN '32' THEN 3 WHEN '4' THEN 4 WHEN '70' THEN 5 WHEN '71' THEN 5 WHEN '9' THEN 6 WHEN '64' THEN 6 ELSE 0 END
                 THEN provider_status
               ELSE p_pay_state::text
             END,
             updated_at = now()
       WHERE id = v_ppt.id;
    EXCEPTION
      WHEN unique_violation THEN
        RETURN jsonb_build_object(
          'result', 'ignored',
          'reason', 'PAYAPP_MUL_NO_CONFLICT',
          'payment_order_id', v_order_id,
          'order_id', v_order.order_id
        );
    END;

    RETURN jsonb_build_object(
      'result', 'cancel_marker_recorded',
      'marker', CASE WHEN p_pay_state IN (9, 64) THEN 'cancel' ELSE 'partial_cancel' END,
      'already_recorded', v_already,
      'partial_cancel_amount_mismatch', v_paid_amount_conflict,
      'payment_order_id', v_order_id,
      'order_id', v_order.order_id
    );
  END IF;

  -- 2. 그 밖의 상태: payment_orders → payment_provider_transactions 순으로 잠그고 다시 읽는다.
  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_order_id
   FOR UPDATE;

  SELECT * INTO v_ppt
    FROM public.payment_provider_transactions
   WHERE payment_order_id = v_order_id
   FOR UPDATE;

  IF v_order.provider <> 'payapp' OR v_ppt.id IS NULL OR v_ppt.provider <> 'payapp' THEN
    v_reason := 'PAYAPP_TRANSACTION_NOT_FOUND';
  ELSIF p_userid IS DISTINCT FROM v_order.provider_merchant_id THEN
    v_reason := 'PAYAPP_FEEDBACK_MERCHANT_MISMATCH';
  ELSIF p_price IS DISTINCT FROM v_order.expected_amount THEN
    v_reason := 'PAYAPP_FEEDBACK_AMOUNT_MISMATCH';
  ELSIF p_mul_no IS NULL
     OR (v_ppt.provider_transaction_id IS NOT NULL
         AND v_ppt.provider_transaction_id <> p_mul_no) THEN
    v_reason := 'PAYAPP_FEEDBACK_MUL_NO_MISMATCH';
  ELSIF v_ppt.provider_transaction_id IS NULL THEN
    BEGIN
      UPDATE public.payment_provider_transactions
         SET provider_transaction_id = p_mul_no,
             updated_at = now()
       WHERE id = v_ppt.id;
      v_ppt.provider_transaction_id := p_mul_no;
    EXCEPTION
      WHEN unique_violation THEN
        v_reason := 'PAYAPP_MUL_NO_CONFLICT';
    END;
  END IF;

  IF v_reason IS NOT NULL THEN
    -- 미지급 주문이면 manual_review로 보낸다. 지급·환불이 끝난 주문은 바꾸지 않는다.
    IF v_reason <> 'PAYAPP_TRANSACTION_NOT_FOUND'
       AND p_pay_state IN (1, 4, 8, 16, 32)
       AND v_order.source_id IS NULL
       AND v_order.status NOT IN ('completed', 'refunded', 'manual_review') THEN
      UPDATE public.payment_orders
         SET status = 'manual_review',
             failure_code = CASE
               WHEN v_reason = 'PAYAPP_MUL_NO_CONFLICT' THEN 'PAYAPP_MUL_NO_CONFLICT'
               ELSE 'PAYAPP_FEEDBACK_MISMATCH'
             END,
             failure_message = LEFT(format('페이앱 통보 검증 실패: %s', v_reason), 500),
             next_reconcile_at = NULL,
             updated_at = now()
       WHERE id = v_order.id;

      UPDATE public.checkout_attempts
         SET status = 'manual_review',
             updated_at = now()
       WHERE id = v_order.checkout_attempt_id
         AND status <> 'completed';
    END IF;

    RETURN jsonb_build_object(
      'result', 'ignored',
      'reason', v_reason,
      'payment_order_id', v_order_id,
      'order_id', v_order.order_id
    );
  END IF;

  -- 표시용 상태는 진행 순위(1 < 10 < 8·16·32 < 4 < 70·71 < 9·64)가 낮은 값으로 되돌리지 않는다.
  v_status_text := CASE
    WHEN CASE v_ppt.provider_status WHEN '1' THEN 1 WHEN '10' THEN 2 WHEN '8' THEN 3 WHEN '16' THEN 3 WHEN '32' THEN 3 WHEN '4' THEN 4 WHEN '70' THEN 5 WHEN '71' THEN 5 WHEN '9' THEN 6 WHEN '64' THEN 6 ELSE 0 END >= CASE p_pay_state::text WHEN '1' THEN 1 WHEN '10' THEN 2 WHEN '8' THEN 3 WHEN '16' THEN 3 WHEN '32' THEN 3 WHEN '4' THEN 4 WHEN '70' THEN 5 WHEN '71' THEN 5 WHEN '9' THEN 6 WHEN '64' THEN 6 ELSE 0 END
      THEN v_ppt.provider_status
    ELSE p_pay_state::text
  END;

  -- 결제 요청(1): mul_no 저장만 한다.
  IF p_pay_state = 1 THEN
    UPDATE public.payment_provider_transactions
       SET provider_status = v_status_text,
           updated_at = now()
     WHERE id = v_ppt.id;

    RETURN jsonb_build_object(
      'result', 'request_recorded',
      'payment_order_id', v_order.id,
      'order_id', v_order.order_id
    );
  END IF;

  -- 결제완료(4): 기록은 바깥 블록, 지급은 모든 예외를 잡는 서브블록.
  IF p_pay_state = 4 THEN
    IF v_ppt.paid_amount IS NOT NULL AND v_ppt.paid_amount <> p_price THEN
      v_paid_amount_conflict := true;
    END IF;

    UPDATE public.payment_provider_transactions
       SET paid_feedback_recorded_at = COALESCE(paid_feedback_recorded_at, now()),
           provider_paid_at = COALESCE(provider_paid_at, p_pay_date),
           paid_amount = COALESCE(paid_amount, p_price),
           payment_method_type = COALESCE(payment_method_type, p_pay_type::text),
           provider_status = v_status_text,
           updated_at = now()
     WHERE id = v_ppt.id
    RETURNING * INTO v_ppt;

    SELECT pm.provider_pay_types INTO v_expected_pay_types
      FROM public.payment_methods pm
     WHERE pm.code = v_order.payment_method_code
       AND pm.provider = 'payapp';

    v_pay_type_mismatch := p_pay_type IS NULL
      OR v_expected_pay_types IS NULL
      OR NOT (p_pay_type = ANY (v_expected_pay_types));

    IF v_ppt.cancel_feedback_recorded_at IS NOT NULL
       OR v_ppt.partial_cancel_feedback_recorded_at IS NOT NULL THEN
      RETURN jsonb_build_object(
        'result', 'cancelled_before_fulfillment',
        'payment_order_id', v_order.id,
        'order_id', v_order.order_id
      );
    END IF;

    IF v_order.source_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'result', 'already_fulfilled',
        'payment_order_id', v_order.id,
        'order_id', v_order.order_id,
        'paid_amount_conflict', v_paid_amount_conflict
      );
    END IF;

    -- 결제 전 대기 동안 쌓인 대사 백오프를 지워, 지급이 실패하면 다음 회차에 바로 재시도한다.
    UPDATE public.payment_orders
       SET status = 'fulfillment_pending',
           provider_status = v_status_text,
           failure_code = NULL,
           failure_message = NULL,
           next_reconcile_at = NULL,
           reconcile_attempt_count = 0,
           updated_at = now()
     WHERE id = v_order.id;

    BEGIN
      v_fulfill := public.payapp_fulfill_order_internal(
        v_order.id,
        COALESCE(v_ppt.provider_paid_at, v_ppt.paid_feedback_recorded_at)
      );
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_error_state = RETURNED_SQLSTATE;
        v_fulfill := NULL;
    END;

    -- pay_type·금액 기록 불일치 경보와 관리자 알림은 route가 별도 트랜잭션에서 남긴다(5.6).
    RETURN jsonb_build_object(
      'result', CASE WHEN v_fulfill IS NULL THEN 'recorded_pending' ELSE 'fulfilled' END,
      'payment_order_id', v_order.id,
      'order_id', v_order.order_id,
      'user_id', v_order.user_id,
      'fulfillment_error_state', v_error_state,
      'new_balance', v_fulfill->'new_balance',
      'pay_type_mismatch', v_pay_type_mismatch,
      'paid_amount_conflict', v_paid_amount_conflict
    );
  END IF;

  -- 요청 취소(8·16·32): 미결제 주문만 만료한다.
  IF p_pay_state IN (8, 16, 32) THEN
    UPDATE public.payment_provider_transactions
       SET provider_status = v_status_text,
           updated_at = now()
     WHERE id = v_ppt.id;

    IF v_order.source_id IS NULL
       AND v_ppt.paid_feedback_recorded_at IS NULL
       AND v_ppt.admin_paid_confirmed_at IS NULL
       AND v_ppt.cancel_feedback_recorded_at IS NULL
       AND v_ppt.partial_cancel_feedback_recorded_at IS NULL
       AND (
         v_order.status IN ('ready', 'ready_unknown')
         OR (v_order.status = 'manual_review'
             AND v_order.failure_code = 'PAYAPP_READY_CANCEL_FAILED')
       ) THEN
      UPDATE public.payment_orders
         SET status = 'expired',
             provider_status = v_status_text,
             failure_code = 'PAYAPP_REQUEST_CANCELLED',
             failure_message = '페이앱 결제 요청이 취소되었습니다.',
             next_reconcile_at = NULL,
             updated_at = now()
       WHERE id = v_order.id;

      UPDATE public.checkout_attempts
         SET status = 'expired',
             updated_at = now()
       WHERE id = v_order.checkout_attempt_id
         AND status <> 'completed';

      RETURN jsonb_build_object(
        'result', 'expired',
        'payment_order_id', v_order.id,
        'order_id', v_order.order_id
      );
    END IF;

    RETURN jsonb_build_object(
      'result', 'unchanged',
      'payment_order_id', v_order.id,
      'order_id', v_order.order_id
    );
  END IF;

  -- 가상계좌 대기(10)와 그 밖의 상태: 기록만 한다.
  UPDATE public.payment_provider_transactions
     SET provider_status = v_status_text,
         updated_at = now()
   WHERE id = v_ppt.id;

  RETURN jsonb_build_object(
    'result', 'recorded',
    'payment_order_id', v_order.id,
    'order_id', v_order.order_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_point_charge_refund(p_request_id uuid, p_admin_id uuid, p_admin_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.refund_requests%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_provider_transaction public.payment_provider_transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_FOUND';
  END IF;

  IF v_request.status = 'completed' THEN
    RETURN jsonb_build_object(
      'already_completed', true,
      'request_id', v_request.id,
      'provider', v_request.provider
    );
  END IF;

  IF v_request.status NOT IN ('pending_review', 'retryable_failed') THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_CLAIMABLE';
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = v_request.source_id
   FOR UPDATE;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_request.payment_order_id
   FOR UPDATE;

  IF v_source.status <> 'pending_refund'
     OR v_source.remaining_credits <> v_source.initial_credits
     OR v_order.status <> 'completed'
     OR v_order.provider IS DISTINCT FROM v_request.provider THEN
    RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
  END IF;

  -- 토스 결제는 종료했다(마이그레이션 B2). 토스 환불 요청은 처리할 수 없다.
  IF v_order.provider = 'toss' THEN
    RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
  END IF;

  IF v_order.provider = 'kakaopay' THEN
    SELECT * INTO v_provider_transaction
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
       AND provider = 'kakaopay'
     FOR UPDATE;

    IF NOT FOUND
       OR v_provider_transaction.provider_transaction_id IS NULL
       OR v_provider_transaction.provider_approval_id IS NULL
       OR v_provider_transaction.provider_status <> 'SUCCESS_PAYMENT'
       OR v_provider_transaction.payment_method_type <> 'MONEY' THEN
      RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
    END IF;
  END IF;

  IF v_order.provider = 'payapp' THEN
    SELECT * INTO v_provider_transaction
      FROM public.payment_provider_transactions
     WHERE payment_order_id = v_order.id
       AND provider = 'payapp'
     FOR UPDATE;

    IF NOT FOUND
       OR v_provider_transaction.provider_transaction_id IS NULL
       OR (v_provider_transaction.paid_feedback_recorded_at IS NULL
           AND v_provider_transaction.admin_paid_confirmed_at IS NULL)
       OR v_provider_transaction.cancel_feedback_recorded_at IS NOT NULL
       OR v_provider_transaction.partial_cancel_feedback_recorded_at IS NOT NULL THEN
      RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
    END IF;

    -- 관리자가 입력한 결제번호는 페이앱 통보로 검증되지 않았다. 공용 계정이라 자동 취소하지 않고 수동 확인으로 보낸다.
    IF v_provider_transaction.paid_feedback_recorded_at IS NULL
       AND v_provider_transaction.admin_paid_confirmed_at IS NOT NULL THEN
      UPDATE public.refund_requests
         SET status = 'manual_review',
             processed_by = p_admin_id,
             admin_note = p_admin_note,
             next_attempt_at = NULL,
             last_error_code = 'PAYAPP_ADMIN_CONFIRMED_MANUAL_REFUND',
             last_error_message = '관리자가 결제를 확인한 주문이라 자동 취소하지 않습니다. 페이앱 관리자에서 결제번호·금액·결제일을 대조해 취소한 뒤 수동 완료로 처리하세요.'
       WHERE id = v_request.id;
      RETURN jsonb_build_object('already_completed', false, 'manual_review_required', true,
                                'request_id', v_request.id, 'user_id', v_request.user_id, 'provider', 'payapp',
                                'payment_order_id', v_order.id, 'provider_transaction_id', NULL, 'refund_amount', NULL);
    END IF;
  END IF;

  UPDATE public.refund_requests
     SET status = 'processing',
         processed_by = p_admin_id,
         admin_note = p_admin_note,
         attempt_count = attempt_count + 1,
         next_attempt_at = NULL,
         last_error_code = NULL,
         last_error_message = NULL
   WHERE id = v_request.id;

  RETURN jsonb_build_object(
    'already_completed', false,
    'request_id', v_request.id,
    'user_id', v_request.user_id,
    'provider', v_order.provider,
    'payment_order_id', v_order.id,
    'provider_order_id', v_order.order_id,
    'payment_key', CASE WHEN v_order.provider = 'toss' THEN v_order.payment_key ELSE NULL END,
    'provider_transaction_id', v_provider_transaction.provider_transaction_id,
    'provider_approval_id', v_provider_transaction.provider_approval_id,
    'provider_merchant_id', v_order.provider_merchant_id,
    'partner_order_id', v_order.partner_order_id,
    'partner_user_id', v_order.partner_user_id,
    'cancel_idempotency_key', v_request.cancel_idempotency_key,
    'refund_amount', v_request.refund_amount,
    'tax_free_amount', v_order.tax_free_amount,
    'vat_amount', v_order.vat_amount
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_payment_reconciliation_run(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scheduler public.payment_reconciliation_scheduler%ROWTYPE;
  v_run_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_backlog integer;
  v_abandoned boolean;
BEGIN
  IF p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_LIMIT_INVALID';
  END IF;

  SELECT *
    INTO v_scheduler
    FROM public.payment_reconciliation_scheduler
   WHERE id = 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_SCHEDULER_MISSING';
  END IF;

  IF v_scheduler.lease_owner IS NOT NULL
     AND v_scheduler.lease_expires_at > v_now THEN
    INSERT INTO public.payment_reconciliation_runs (
      id,
      status,
      batch_limit,
      lease_expires_at,
      completed_at,
      last_error_code,
      last_error_message
    ) VALUES (
      v_run_id,
      'skipped',
      p_limit,
      v_now,
      v_now,
      'PAYMENT_RECONCILIATION_LEASE_HELD',
      '다른 대사 작업이 실행 중입니다.'
    );

    RETURN jsonb_build_object(
      'acquired', false,
      'run_id', v_run_id,
      'lease_owner', v_scheduler.lease_owner,
      'lease_expires_at', v_scheduler.lease_expires_at
    );
  END IF;

  -- 끝나지 않은 채 리스가 만료된 run을 닫는다. 직전 리스 주인이었으면 연속 실패로 센다.
  UPDATE public.payment_reconciliation_runs
     SET status = 'failed',
         completed_at = v_now,
         last_error_code = 'PAYMENT_RECONCILIATION_RUN_ABANDONED',
         last_error_message = '대사 작업이 끝나지 않은 채 리스가 만료되었습니다.'
   WHERE status = 'running' AND lease_expires_at <= v_now;

  v_abandoned := v_scheduler.lease_owner IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.payment_reconciliation_runs
     WHERE id = v_scheduler.lease_owner AND last_error_code = 'PAYMENT_RECONCILIATION_RUN_ABANDONED' AND completed_at = v_now);

  v_backlog := public.payment_reconciliation_backlog_count();

  INSERT INTO public.payment_reconciliation_runs (
    id,
    status,
    batch_limit,
    backlog_at_start,
    lease_expires_at
  ) VALUES (
    v_run_id,
    'running',
    p_limit,
    v_backlog,
    v_now + interval '4 minutes'
  );

  UPDATE public.payment_reconciliation_scheduler
     SET lease_owner = v_run_id,
         lease_expires_at = v_now + interval '4 minutes',
         last_started_at = v_now,
         consecutive_failures = consecutive_failures + CASE WHEN v_abandoned THEN 1 ELSE 0 END,
         last_error_code = CASE WHEN v_abandoned THEN 'PAYMENT_RECONCILIATION_RUN_ABANDONED' ELSE last_error_code END,
         updated_at = v_now
   WHERE id = 1;

  RETURN jsonb_build_object(
    'acquired', true,
    'run_id', v_run_id,
    'backlog', v_backlog,
    'lease_expires_at', v_now + interval '4 minutes'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_payment_reconciliation_batch(p_run_id uuid, p_limit integer)
 RETURNS TABLE(order_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_LIMIT_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.payment_reconciliation_scheduler prs
     WHERE prs.id = 1
       AND prs.lease_owner = p_run_id
       AND prs.lease_expires_at > now()
  ) THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_LEASE_INVALID';
  END IF;

  UPDATE public.payment_reconciliation_scheduler
     SET lease_expires_at = now() + interval '4 minutes',
         updated_at = now()
   WHERE id = 1
     AND lease_owner = p_run_id;

  UPDATE public.payment_reconciliation_runs
     SET heartbeat_at = now(),
         lease_expires_at = now() + interval '4 minutes'
   WHERE id = p_run_id
     AND status = 'running';

  RETURN QUERY
  WITH candidates AS (
    SELECT po.id
      FROM public.payment_orders po
     WHERE (
            (
              po.status IN (
                'preparing',
                'ready_unknown',
                'ready',
                'confirming',
                'fulfillment_pending',
                'cancel_pending'
              )
              OR EXISTS (
                SELECT 1
                  FROM public.refund_requests rr
                 WHERE rr.payment_order_id = po.id
                   AND rr.status IN ('processing', 'retryable_failed')
                   AND (rr.next_attempt_at IS NULL OR rr.next_attempt_at <= now())
                   AND NOT (rr.provider = 'payapp' AND rr.status = 'retryable_failed')
              )
              OR EXISTS (
                SELECT 1
                  FROM public.payment_webhook_events pwe
                 WHERE pwe.order_id = po.order_id
                   AND pwe.processing_status IN ('pending', 'failed')
              )
            )
            AND (po.next_reconcile_at IS NULL OR po.next_reconcile_at <= now())
          )
        OR (
          po.provider IN ('payapp', 'kakaopay')
          AND EXISTS (
            SELECT 1
              FROM public.payment_provider_transactions ppt
             WHERE ppt.payment_order_id = po.id
               AND (
                 (ppt.cancel_feedback_recorded_at IS NOT NULL AND ppt.cancel_processed_at IS NULL)
                 OR (ppt.partial_cancel_feedback_recorded_at IS NOT NULL AND ppt.partial_cancel_processed_at IS NULL)
               )
          )
        )
     -- claim이 updated_at을 바꾸지 않으므로(트리거 payment_orders_touch_updated_at) 마지막 대사 시각 순으로 돌린다.
     ORDER BY po.last_reconciled_at ASC NULLS FIRST, po.updated_at ASC, po.id ASC
     FOR UPDATE OF po SKIP LOCKED
     LIMIT p_limit
  ), claimed AS (
    UPDATE public.payment_orders po
       SET reconcile_attempt_count = po.reconcile_attempt_count + 1,
           next_reconcile_at = now() + interval '4 minutes',
           updated_at = po.updated_at
      FROM candidates c
     WHERE po.id = c.id
     RETURNING po.order_id
  )
  SELECT claimed.order_id
    FROM claimed;
END;
$function$;

-- 7. 사후 점검(같은 트랜잭션 끝).
DO $$
DECLARE
  v_old_target integer;
  v_abandoned integer;
  v_bad_props integer;
BEGIN
  -- code 단독 ON CONFLICT 대상은 새 인덱스와 추론이 맞지 않아, 그 분기가 처음 실행될 때 예외가 난다.
  -- literal 비교가 아니라 공백 변형까지 잡는 정규식으로 본다.
  SELECT count(*)
    INTO v_old_target
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prokind = 'f'
     AND pg_get_functiondef(p.oid) ~* 'on\s+conflict\s*\(\s*code\s*\)';
  IF v_old_target > 0 THEN
    RAISE EXCEPTION 'PAYMENT_INTEGRITY_POSTCHECK: % functions still use the code-only ON CONFLICT target', v_old_target;
  END IF;

  SELECT count(*)
    INTO v_abandoned
    FROM public.payment_reconciliation_runs
   WHERE status = 'running' AND lease_expires_at <= now();
  IF v_abandoned > 0 THEN
    RAISE EXCEPTION 'PAYMENT_INTEGRITY_POSTCHECK: % abandoned runs remain', v_abandoned;
  END IF;

  SELECT count(*)
    INTO v_bad_props
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN (
       'record_payment_alert',
       'enforce_payment_reconciliation_health',
       'process_payapp_cancellation',
       'complete_manual_point_charge_refund',
       'apply_payapp_feedback',
       'claim_point_charge_refund',
       'start_payment_reconciliation_run',
       'claim_payment_reconciliation_batch'
     )
     AND (NOT p.prosecdef
          OR p.proconfig IS NULL
          OR NOT ('search_path=public, pg_temp' = ANY (p.proconfig)));
  IF v_bad_props > 0 THEN
    RAISE EXCEPTION 'PAYMENT_INTEGRITY_POSTCHECK: % redefined functions lost SECURITY DEFINER or search_path', v_bad_props;
  END IF;
END;
$$;
