-- 충전 판매를 사람이 멈추고 다시 여는 함수(계획 W0-7·U0-7, DB-0).
-- 배경: 판매 스위치(payment_runtime_config)는 자동 점검(enforce_payment_reconciliation_health)만 끌 수 있었고,
--       사람이 급히 멈추거나, 자동으로 꺼진 뒤 다시 여는 정해진 방법이 없었다.
-- 추가:
--   stop_payment_sales(범위, 처리자, 사유)   : 판매를 끈다. 관리자 화면의 "충전 판매 중지" 버튼(service_role)과 SQL Editor에서 쓴다.
--   payapp_sales_resume_blockers()          : 자동 점검이 페이앱 판매를 끄는 조건이 지금 몇 건인지 센다(조건은 자동 점검과 같게 유지).
--   resume_payment_sales(범위, 처리자, 사유) : 막는 조건이 0건일 때만 판매를 켠다. SQL Editor 전용(service_role에 권한을 주지 않는다).
-- 범위: 'master' = 전체 스위치, 'payapp' = 페이앱 스위치. 카카오페이는 쓰지 않으므로 다루지 않는다(꺼진 채 그대로).
-- 판매를 꺼도 이미 결제된 건의 지급·취소 처리는 계속된다(새 주문만 막는다).
-- 사용법: supabase/ops/payment_sales_stop_resume.sql
-- 되돌리기: supabase/rollback/20261113180000_payment_sales_stop_resume_down.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE FUNCTION public.stop_payment_sales(p_scope text, p_changed_by text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_config public.payment_runtime_config%ROWTYPE;
  v_changed boolean;
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN ('master', 'payapp') THEN
    RAISE EXCEPTION 'PAYMENT_SALES_SCOPE_INVALID';
  END IF;
  IF btrim(COALESCE(p_changed_by, '')) = '' OR btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'PAYMENT_SALES_REASON_REQUIRED';
  END IF;

  -- 그 범위가 이미 꺼져 있으면 아무것도 바꾸지 않는다(같은 범위를 처음 끈 사람·사유를 덮어쓰지 않는다).
  -- 처리자·사유 칸은 하나뿐이라, 다른 범위의 변경이나 자동 점검이 뒤에 오면 마지막 것만 남는다.
  UPDATE public.payment_runtime_config
     SET master_accepts_new_orders = master_accepts_new_orders AND p_scope <> 'master',
         payapp_accepts_new_orders = payapp_accepts_new_orders AND p_scope <> 'payapp',
         changed_at = now(),
         changed_by = left(btrim(p_changed_by), 200),
         change_ticket = left('MANUAL_STOP: ' || btrim(p_reason), 500)
   WHERE id = true
     AND ((p_scope = 'master' AND master_accepts_new_orders)
       OR (p_scope = 'payapp' AND payapp_accepts_new_orders));
  v_changed := FOUND;

  SELECT * INTO v_config FROM public.payment_runtime_config WHERE id = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_RUNTIME_CONFIG_MISSING';
  END IF;

  RETURN jsonb_build_object(
    'changed', v_changed,
    'master_accepts_new_orders', v_config.master_accepts_new_orders,
    'payapp_accepts_new_orders', v_config.payapp_accepts_new_orders,
    'changed_at', v_config.changed_at,
    'changed_by', v_config.changed_by,
    'change_ticket', v_config.change_ticket
  );
END;
$function$;

-- 아래 네 조건은 enforce_payment_reconciliation_health의 "페이앱 블록"과 같아야 한다(tests/payment-sales-ops-contract.test.mjs가 확인).
CREATE FUNCTION public.payapp_sales_resume_blockers()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scheduler public.payment_reconciliation_scheduler%ROWTYPE;
  v_scheduler_stale boolean;
  v_payapp_unfulfilled_count integer;
  v_payapp_money_review_count integer;
  v_payapp_cancel_active_count integer;
BEGIN
  SELECT *
    INTO v_scheduler
    FROM public.payment_reconciliation_scheduler
   WHERE id = 1;

  v_scheduler_stale := v_scheduler.last_started_at IS NOT NULL
    AND (
      v_scheduler.last_succeeded_at IS NULL
      OR v_scheduler.last_succeeded_at <= now() - interval '15 minutes'
    );

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
    COUNT(*) FILTER (WHERE cs.status = 'active')::integer
    INTO v_payapp_cancel_active_count
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

  RETURN jsonb_build_object(
    'paid_unfulfilled_count', v_payapp_unfulfilled_count,
    'money_review_count', v_payapp_money_review_count,
    'cancel_unprocessed_active_count', v_payapp_cancel_active_count,
    -- 점검 작업 기록 행이 없으면 건강하다고 볼 근거가 없으므로 막는다.
    'scheduler_unhealthy', COALESCE(v_scheduler_stale OR v_scheduler.consecutive_failures >= 3, true),
    'consecutive_failures', v_scheduler.consecutive_failures,
    'last_succeeded_at', v_scheduler.last_succeeded_at
  );
END;
$function$;

CREATE FUNCTION public.resume_payment_sales(p_scope text, p_changed_by text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_config public.payment_runtime_config%ROWTYPE;
  v_blockers jsonb;
BEGIN
  IF p_scope IS NULL OR p_scope NOT IN ('master', 'payapp') THEN
    RAISE EXCEPTION 'PAYMENT_SALES_SCOPE_INVALID';
  END IF;
  IF btrim(COALESCE(p_changed_by, '')) = '' OR btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'PAYMENT_SALES_REASON_REQUIRED';
  END IF;

  SELECT * INTO v_config FROM public.payment_runtime_config WHERE id = true FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_RUNTIME_CONFIG_MISSING';
  END IF;

  IF (p_scope = 'master' AND v_config.master_accepts_new_orders)
     OR (p_scope = 'payapp' AND v_config.payapp_accepts_new_orders) THEN
    RAISE EXCEPTION 'PAYMENT_SALES_ALREADY_ON';
  END IF;

  -- 페이앱 가맹점 ID가 비어 있으면 주문을 받을 수 없으므로 켜지 않는다.
  -- (accepted_provider_environment는 카카오페이용 값이라 보지 않는다. 페이앱 주문 경로도 보지 않는다.)
  IF btrim(COALESCE(v_config.payapp_merchant_id, '')) = '' THEN
    RAISE EXCEPTION 'PAYMENT_SALES_CONFIG_INCOMPLETE';
  END IF;

  -- 자동 점검이 다시 끌 상태라면 켜지 않는다. 무엇이 막는지는 DETAIL에 적는다.
  v_blockers := public.payapp_sales_resume_blockers();
  IF (v_blockers ->> 'paid_unfulfilled_count')::integer > 0
     OR (v_blockers ->> 'money_review_count')::integer > 0
     OR (v_blockers ->> 'cancel_unprocessed_active_count')::integer > 0
     OR (v_blockers ->> 'scheduler_unhealthy')::boolean THEN
    RAISE EXCEPTION 'PAYMENT_SALES_RESUME_BLOCKED' USING DETAIL = v_blockers::text;
  END IF;

  UPDATE public.payment_runtime_config
     SET master_accepts_new_orders = master_accepts_new_orders OR p_scope = 'master',
         payapp_accepts_new_orders = payapp_accepts_new_orders OR p_scope = 'payapp',
         changed_at = now(),
         changed_by = left(btrim(p_changed_by), 200),
         change_ticket = left('MANUAL_RESUME: ' || btrim(p_reason), 500)
   WHERE id = true
  RETURNING * INTO v_config;

  RETURN jsonb_build_object(
    'changed', true,
    'master_accepts_new_orders', v_config.master_accepts_new_orders,
    'payapp_accepts_new_orders', v_config.payapp_accepts_new_orders,
    'changed_at', v_config.changed_at,
    'changed_by', v_config.changed_by,
    'change_ticket', v_config.change_ticket
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.stop_payment_sales(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stop_payment_sales(text, text, text) TO service_role;
-- 재개와 재개 조건 조회는 SQL Editor(postgres)에서만 쓴다.
REVOKE ALL ON FUNCTION public.payapp_sales_resume_blockers() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resume_payment_sales(text, text, text) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
