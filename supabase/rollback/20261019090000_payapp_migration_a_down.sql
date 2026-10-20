-- 마이그레이션 A(20261019090000_payapp_migration_a) 되돌리기. 운영 적용 뒤 버전에 맞춰 파일명을 바꾼다.
-- 체크리스트 0-10: 아래 전제 조건이 모두 0건일 때만 실행한다. 그 뒤로는 스위치를 끄고 앞으로 고친다.
-- 단계 4 코드(카카오 부분취소 표식 호출)가 배포됐으면 코드를 먼저 되돌린다.

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE
  public.payment_orders,
  public.payment_provider_transactions,
  public.refund_requests,
  public.checkout_attempts,
  public.payment_reconciliation_items,
  public.payment_runtime_config
  IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payment_orders WHERE provider = 'payapp') THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED: payapp orders exist';
  END IF;
  IF EXISTS (
    SELECT cancel_idempotency_key FROM public.refund_requests
     WHERE cancel_idempotency_key IS NOT NULL
     GROUP BY 1 HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED: duplicate refund idempotency keys';
  END IF;
  IF EXISTS (SELECT 1 FROM public.refund_requests WHERE origin <> 'user') THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED: quarantine origin refund requests exist';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payment_provider_transactions
     WHERE partial_cancel_feedback_recorded_at IS NOT NULL
        OR cancel_feedback_recorded_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED: cancel markers exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_admin_actions) THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED: payment_admin_actions has rows (export first)';
  END IF;
END;
$$;

-- 1. 트리거 함수를 먼저 이전 정의로 되돌린다(컬럼을 지우기 전에).
CREATE OR REPLACE FUNCTION public.prevent_payment_order_snapshot_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.plan_name_snapshot IS DISTINCT FROM OLD.plan_name_snapshot
     OR NEW.expected_amount IS DISTINCT FROM OLD.expected_amount
     OR NEW.expected_credits IS DISTINCT FROM OLD.expected_credits
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.environment IS DISTINCT FROM OLD.environment
     OR NEW.provider_environment IS DISTINCT FROM OLD.provider_environment
     OR NEW.mid IS DISTINCT FROM OLD.mid
     OR NEW.provider_merchant_id IS DISTINCT FROM OLD.provider_merchant_id
     OR NEW.partner_order_id IS DISTINCT FROM OLD.partner_order_id
     OR NEW.partner_user_id IS DISTINCT FROM OLD.partner_user_id
     OR NEW.tax_free_amount IS DISTINCT FROM OLD.tax_free_amount
     OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount
     OR NEW.checkout_attempt_id IS DISTINCT FROM OLD.checkout_attempt_id
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.checkout_expires_at IS DISTINCT FROM OLD.checkout_expires_at
     OR NEW.ready_requested_at IS DISTINCT FROM OLD.ready_requested_at
     OR NEW.ready_expires_at IS DISTINCT FROM OLD.ready_expires_at THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_IMMUTABLE_SNAPSHOT';
  END IF;

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.prevent_payment_provider_identifier_replacement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF (OLD.provider_transaction_id IS NOT NULL
      AND NEW.provider_transaction_id IS DISTINCT FROM OLD.provider_transaction_id)
     OR (OLD.provider_approval_id IS NOT NULL
         AND NEW.provider_approval_id IS DISTINCT FROM OLD.provider_approval_id)
     OR (OLD.callback_state_hash IS NOT NULL
         AND NEW.callback_state_hash IS DISTINCT FROM OLD.callback_state_hash)
     OR (OLD.result_token_hash IS NOT NULL
         AND NEW.result_token_hash IS DISTINCT FROM OLD.result_token_hash) THEN
    RAISE EXCEPTION 'PAYMENT_PROVIDER_IDENTIFIER_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. 새 함수 삭제(호출자 먼저, 지급 내부 함수는 나중에)
DROP FUNCTION public.resolve_payment_order_review(uuid, text, uuid, text, text, timestamp with time zone, text);
DROP FUNCTION public.complete_manual_point_charge_refund(uuid, uuid, text, text, integer, integer);
DROP FUNCTION public.requeue_stuck_point_charge_refund(uuid);
DROP FUNCTION public.quarantine_kakaopay_partial_cancellation(uuid, text, integer);
DROP FUNCTION public.record_kakaopay_partial_cancel_marker(uuid, text);
DROP FUNCTION public.process_payapp_cancellation(uuid);
DROP FUNCTION public.quarantine_payapp_partial_cancellation(uuid);
DROP FUNCTION public.mark_payapp_order_terminal(uuid, text, text, text, text);
DROP FUNCTION public.retry_payapp_fulfillment(uuid);
DROP FUNCTION public.apply_payapp_feedback(text, text, text, text, integer, integer, integer, integer, timestamp with time zone, timestamp with time zone);
DROP FUNCTION public.fail_payapp_request(uuid, text, text);
DROP FUNCTION public.store_payapp_request(uuid, text, text);
DROP FUNCTION public.begin_payapp_request(uuid);
DROP FUNCTION public.payapp_fulfill_order_internal(uuid, timestamp with time zone);
DROP FUNCTION public.record_payment_alert(text, text, text, jsonb);

-- 3. 지우고 다시 만드는 함수: 기본 권한이 PUBLIC·anon·authenticated를 다시 열므로 먼저 회수한 뒤 준다.
DROP FUNCTION public.prepare_payment_order(uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text, timestamp with time zone, integer, integer, text, text);
CREATE OR REPLACE FUNCTION public.prepare_payment_order(p_user_id uuid, p_checkout_attempt_id uuid, p_provider text, p_plan_id uuid, p_order_id text, p_plan_name_snapshot text, p_expected_amount integer, p_expected_credits integer, p_provider_environment text, p_provider_merchant_id text, p_request_fingerprint text, p_confirm_idempotency_key text, p_cancel_idempotency_key text, p_expires_at timestamp with time zone, p_tax_free_amount integer, p_vat_amount integer, p_partner_user_id text)
 RETURNS payment_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_attempt public.checkout_attempts%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
BEGIN
  IF p_provider NOT IN ('toss', 'kakaopay')
     OR p_provider_environment NOT IN ('test', 'live')
     OR NULLIF(BTRIM(p_provider_merchant_id), '') IS NULL
     OR NULLIF(BTRIM(p_request_fingerprint), '') IS NULL
     OR p_expected_amount NOT BETWEEN 1 AND 100000
     OR p_expected_credits < 1
     OR p_tax_free_amount NOT BETWEEN 0 AND p_expected_amount
     OR p_vat_amount NOT BETWEEN 0 AND p_expected_amount
     OR p_expires_at <= now()
     OR (p_provider = 'kakaopay' AND (
       NULLIF(BTRIM(p_partner_user_id), '') IS NULL
       OR p_tax_free_amount <> 0
       OR p_vat_amount <> round(p_expected_amount::numeric / 11)::integer
     )) THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_INPUT_INVALID';
  END IF;

  INSERT INTO public.checkout_attempts (
    user_id,
    checkout_attempt_id,
    claimed_provider,
    plan_id,
    request_fingerprint,
    expires_at
  ) VALUES (
    p_user_id,
    p_checkout_attempt_id,
    p_provider,
    p_plan_id,
    p_request_fingerprint,
    p_expires_at
  )
  ON CONFLICT (user_id, checkout_attempt_id) DO NOTHING;

  SELECT *
    INTO v_attempt
    FROM public.checkout_attempts
   WHERE user_id = p_user_id
     AND checkout_attempt_id = p_checkout_attempt_id
   FOR UPDATE;

  IF v_attempt.claimed_provider IS DISTINCT FROM p_provider
     OR v_attempt.plan_id IS DISTINCT FROM p_plan_id
     OR v_attempt.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
    RAISE EXCEPTION 'PAYMENT_ATTEMPT_PAYLOAD_CONFLICT';
  END IF;

  IF v_attempt.payment_order_id IS NOT NULL THEN
    SELECT *
      INTO v_order
      FROM public.payment_orders
     WHERE id = v_attempt.payment_order_id;

    RETURN v_order;
  END IF;

  INSERT INTO public.payment_orders (
    user_id,
    order_id,
    plan_id,
    plan_name_snapshot,
    expected_amount,
    expected_credits,
    provider,
    environment,
    provider_environment,
    mid,
    provider_merchant_id,
    partner_order_id,
    partner_user_id,
    tax_free_amount,
    vat_amount,
    status,
    request_fingerprint,
    checkout_attempt_id,
    confirm_idempotency_key,
    cancel_idempotency_key,
    expires_at,
    checkout_expires_at,
    ready_requested_at,
    ready_expires_at
  ) VALUES (
    p_user_id,
    p_order_id,
    p_plan_id,
    p_plan_name_snapshot,
    p_expected_amount,
    p_expected_credits,
    p_provider,
    p_provider_environment,
    p_provider_environment,
    CASE WHEN p_provider = 'toss' THEN p_provider_merchant_id ELSE NULL END,
    p_provider_merchant_id,
    p_order_id,
    CASE WHEN p_provider = 'kakaopay' THEN p_partner_user_id ELSE NULL END,
    p_tax_free_amount,
    p_vat_amount,
    CASE WHEN p_provider = 'kakaopay' THEN 'preparing' ELSE 'ready' END,
    p_request_fingerprint,
    v_attempt.id,
    p_confirm_idempotency_key,
    p_cancel_idempotency_key,
    p_expires_at,
    p_expires_at,
    CASE WHEN p_provider = 'kakaopay' THEN now() ELSE NULL END,
    CASE WHEN p_provider = 'kakaopay' THEN p_expires_at ELSE NULL END
  )
  RETURNING * INTO v_order;

  UPDATE public.checkout_attempts
     SET payment_order_id = v_order.id,
         updated_at = now()
   WHERE id = v_attempt.id;

  RETURN v_order;
END;
$function$;
REVOKE ALL ON FUNCTION public.prepare_payment_order(uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text, timestamp with time zone, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_payment_order(uuid, uuid, text, uuid, text, text, integer, integer, text, text, text, text, text, timestamp with time zone, integer, integer, text) TO service_role;

DROP FUNCTION public.reject_point_charge_refund(uuid, uuid, text, boolean);
CREATE OR REPLACE FUNCTION public.reject_point_charge_refund(p_request_id uuid, p_admin_id uuid, p_admin_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_request public.refund_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND OR v_request.status <> 'pending_review' THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_REJECTABLE';
  END IF;

  UPDATE public.credit_sources
     SET status = 'active'
   WHERE id = v_request.source_id
     AND status = 'pending_refund';

  UPDATE public.refund_requests
     SET status = 'rejected',
         admin_note = p_admin_note,
         processed_by = p_admin_id,
         processed_at = now()
   WHERE id = v_request.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.reject_point_charge_refund(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_point_charge_refund(uuid, uuid, text) TO service_role;

DROP FUNCTION public.get_my_payment_history();
CREATE OR REPLACE FUNCTION public.get_my_payment_history()
 RETURNS TABLE(id uuid, created_at timestamp with time zone, amount integer, status text, payment_method text, order_id text, provider text, provider_status text, approved_at timestamp with time zone, plan_id uuid, plan_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    ph.id,
    ph.created_at,
    ph.amount,
    ph.status,
    ph.payment_method,
    ph.order_id,
    ph.provider,
    ph.provider_status,
    ph.approved_at,
    ph.plan_id,
    pp.name
  FROM public.payment_history ph
  LEFT JOIN public.pricing_plans pp ON pp.id = ph.plan_id
  WHERE ph.user_id = (SELECT auth.uid())
    AND ph.amount > 0
    AND ph.plan_id IS NOT NULL
  ORDER BY ph.created_at DESC;
$function$;
REVOKE ALL ON FUNCTION public.get_my_payment_history() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_payment_history() TO authenticated, service_role;

DROP FUNCTION public.get_my_refund_requests();
CREATE OR REPLACE FUNCTION public.get_my_refund_requests()
 RETURNS TABLE(id uuid, source_id uuid, reason text, status text, refund_amount integer, processed_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    rr.id,
    rr.source_id,
    rr.reason,
    rr.status,
    rr.refund_amount,
    rr.processed_at,
    rr.created_at,
    rr.updated_at
  FROM public.refund_requests rr
  WHERE rr.user_id = (SELECT auth.uid())
  ORDER BY rr.created_at DESC;
$function$;
REVOKE ALL ON FUNCTION public.get_my_refund_requests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_refund_requests() TO authenticated, service_role;

-- 4. CREATE OR REPLACE로 이전 정의 복원(ACL 유지)
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

  RETURN jsonb_build_object(
    'healthy', NOT v_should_disable,
    'backlog', v_backlog,
    'stale_count', v_stale_count,
    'manual_review_count', v_manual_count,
    'consecutive_failures', v_scheduler.consecutive_failures,
    'last_started_at', v_scheduler.last_started_at,
    'last_succeeded_at', v_scheduler.last_succeeded_at,
    'kakaopay_disabled', v_should_disable
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
            )
            OR EXISTS (
              SELECT 1
                FROM public.payment_webhook_events pwe
               WHERE pwe.order_id = po.order_id
                 AND pwe.processing_status IN ('pending', 'failed')
            )
          )
       AND (po.next_reconcile_at IS NULL OR po.next_reconcile_at <= now())
     ORDER BY po.updated_at ASC, po.id ASC
     FOR UPDATE SKIP LOCKED
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

CREATE OR REPLACE FUNCTION public.payment_reconciliation_backlog_count()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COUNT(DISTINCT po.id)::integer
    FROM public.payment_orders po
   WHERE (
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
          )
          OR EXISTS (
            SELECT 1
              FROM public.payment_webhook_events pwe
             WHERE pwe.order_id = po.order_id
               AND pwe.processing_status IN ('pending', 'failed')
          )
        )
     AND (po.next_reconcile_at IS NULL OR po.next_reconcile_at <= now());
$function$;

CREATE OR REPLACE FUNCTION public.mark_payment_reconciliation_terminal(p_payment_order_id uuid, p_status text, p_provider_status text, p_failure_code text, p_failure_message text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
BEGIN
  IF p_status NOT IN ('failed', 'expired', 'manual_review') THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_TERMINAL_STATUS_INVALID';
  END IF;

  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_ORDER_NOT_FOUND';
  END IF;

  IF v_order.status IN ('completed', 'refunded') THEN
    RETURN;
  END IF;

  UPDATE public.payment_orders
     SET status = p_status,
         provider_status = COALESCE(p_provider_status, provider_status),
         failure_code = LEFT(COALESCE(p_failure_code, 'PAYMENT_RECONCILIATION_TERMINAL'), 100),
         failure_message = LEFT(COALESCE(p_failure_message, '결제 상태를 자동으로 확정할 수 없습니다.'), 500),
         next_reconcile_at = NULL,
         last_reconciled_at = now(),
         updated_at = now()
   WHERE id = v_order.id;

  UPDATE public.payment_provider_transactions
     SET provider_status = COALESCE(p_provider_status, provider_status),
         next_reconcile_at = NULL,
         last_reconciled_at = now(),
         last_error_code = LEFT(COALESCE(p_failure_code, 'PAYMENT_RECONCILIATION_TERMINAL'), 100),
         last_error_message = LEFT(COALESCE(p_failure_message, '결제 상태를 자동으로 확정할 수 없습니다.'), 500),
         updated_at = now()
   WHERE payment_order_id = v_order.id;

  UPDATE public.checkout_attempts
     SET status = CASE
           WHEN p_status = 'expired' THEN 'expired'
           WHEN p_status = 'manual_review' THEN 'manual_review'
           ELSE 'cancelled'
         END,
         updated_at = now()
   WHERE id = v_order.checkout_attempt_id
     AND status <> 'completed';
END;
$function$;

CREATE OR REPLACE FUNCTION public.quarantine_external_provider_cancellation(p_payment_order_id uuid, p_provider_cancel_transaction_key text, p_provider_cancelled_at timestamp with time zone, p_provider_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_source public.credit_sources%ROWTYPE;
  v_request public.refund_requests%ROWTYPE;
  v_used_credits integer;
  v_already_quarantined boolean := false;
BEGIN
  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = p_payment_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_NOT_FOUND';
  END IF;

  IF v_order.status = 'refunded' THEN
    RETURN jsonb_build_object('already_completed', true, 'credits_used', false);
  END IF;

  IF NULLIF(BTRIM(p_provider_cancel_transaction_key), '') IS NULL
     OR p_provider_cancelled_at IS NULL
     OR (v_order.provider = 'toss' AND p_provider_status <> 'CANCELED')
     OR (v_order.provider = 'kakaopay' AND p_provider_status <> 'CANCEL_PAYMENT') THEN
    RAISE EXCEPTION 'EXTERNAL_PROVIDER_CANCELLATION_INVALID';
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE payment_order_id = v_order.id
   FOR UPDATE;

  IF NOT FOUND OR v_source.status = 'refunded' THEN
    RAISE EXCEPTION 'EXTERNAL_PROVIDER_CANCELLATION_SOURCE_NOT_FOUND';
  END IF;

  PERFORM 1
    FROM public.profiles
   WHERE id = v_order.user_id
   FOR UPDATE;

  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE source_id = v_source.id
     AND status IN ('pending_review', 'processing', 'retryable_failed', 'manual_review')
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  v_already_quarantined := FOUND
    AND v_request.last_error_code = 'EXTERNAL_PROVIDER_CANCELLATION'
    AND v_request.provider_cancel_transaction_key IS NOT DISTINCT FROM p_provider_cancel_transaction_key;

  IF v_request.id IS NULL THEN
    INSERT INTO public.refund_requests (
      user_id,
      source_id,
      reason,
      status,
      payment_order_id,
      provider,
      refund_amount,
      cancel_idempotency_key,
      provider_cancel_transaction_key,
      provider_cancelled_at,
      last_error_code,
      last_error_message
    ) VALUES (
      v_order.user_id,
      v_source.id,
      '결제사 외부 취소 감지',
      'manual_review',
      v_order.id,
      v_order.provider,
      v_order.expected_amount,
      v_order.cancel_idempotency_key,
      p_provider_cancel_transaction_key,
      p_provider_cancelled_at,
      'EXTERNAL_PROVIDER_CANCELLATION',
      '결제사에서 직접 취소된 거래입니다. 크레딧 회수 상태를 확인하세요.'
    )
    RETURNING * INTO v_request;
  ELSE
    UPDATE public.refund_requests
       SET status = 'manual_review',
           provider_cancel_transaction_key = p_provider_cancel_transaction_key,
           provider_cancelled_at = p_provider_cancelled_at,
           next_attempt_at = NULL,
           last_error_code = 'EXTERNAL_PROVIDER_CANCELLATION',
           last_error_message = '결제사에서 직접 취소된 거래입니다. 크레딧 회수 상태를 확인하세요.'
     WHERE id = v_request.id;
  END IF;

  UPDATE public.credit_sources
     SET status = 'pending_refund'
   WHERE id = v_source.id;

  UPDATE public.payment_orders
     SET status = 'manual_review',
         provider_status = p_provider_status,
         canceled_at = p_provider_cancelled_at,
         failure_code = 'EXTERNAL_PROVIDER_CANCELLATION',
         failure_message = '결제사 외부 취소가 감지되어 크레딧을 격리했습니다.'
   WHERE id = v_order.id;

  UPDATE public.payment_history
     SET provider_status = p_provider_status
   WHERE payment_order_id = v_order.id;

  IF v_order.provider = 'kakaopay' THEN
    UPDATE public.payment_provider_transactions
       SET provider_status = 'CANCEL_PAYMENT',
           last_reconciled_at = now(),
           updated_at = now()
     WHERE payment_order_id = v_order.id
       AND provider = 'kakaopay';
  END IF;

  v_used_credits := v_source.initial_credits - v_source.remaining_credits;

  IF NOT v_already_quarantined THEN
    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      message,
      link,
      is_read
    )
    SELECT
      id,
      'warning',
      '외부 결제 취소 확인 필요',
      format(
        '%s 결제가 외부에서 취소되었습니다. 사용자 %s, 사용 크레딧 %s',
        v_order.provider,
        v_order.user_id,
        v_used_credits
      ),
      '/admin/refunds',
      false
      FROM public.profiles
     WHERE is_admin = true;
  END IF;

  RETURN jsonb_build_object(
    'already_completed', false,
    'already_quarantined', v_already_quarantined,
    'request_id', v_request.id,
    'credits_used', v_used_credits > 0,
    'used_credit_amount', v_used_credits
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_point_charge_refund_eligibility(p_user_id uuid, p_source_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source public.credit_sources%ROWTYPE;
  v_order public.payment_orders%ROWTYPE;
  v_refundable_until timestamptz;
BEGIN
  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = p_source_id
     AND user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_SOURCE_NOT_FOUND');
  END IF;

  IF v_source.payment_order_id IS NULL
     OR v_source.source_category <> 'plan_purchase' THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_PAID_SOURCE_REQUIRED');
  END IF;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_source.payment_order_id
     AND user_id = p_user_id;

  IF NOT FOUND
     OR v_order.status <> 'completed'
     OR v_order.approved_at IS NULL
     OR (
       v_order.provider = 'toss'
       AND v_order.payment_key IS NULL
     )
     OR (
       v_order.provider = 'kakaopay'
       AND NOT EXISTS (
         SELECT 1
           FROM public.payment_provider_transactions ppt
          WHERE ppt.payment_order_id = v_order.id
            AND ppt.provider = 'kakaopay'
            AND ppt.provider_transaction_id IS NOT NULL
            AND ppt.provider_approval_id IS NOT NULL
            AND ppt.provider_status = 'SUCCESS_PAYMENT'
            AND ppt.payment_method_type = 'MONEY'
       )
     ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason_code', 'REFUND_COMPLETED_PAYMENT_REQUIRED');
  END IF;

  v_refundable_until := v_order.approved_at + interval '7 days';

  IF v_source.status <> 'active' THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_SOURCE_NOT_ACTIVE',
      'refundable_until', v_refundable_until
    );
  END IF;

  IF v_source.remaining_credits <> v_source.initial_credits THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_CREDITS_ALREADY_USED',
      'refundable_until', v_refundable_until
    );
  END IF;

  IF v_source.expires_at IS NOT NULL AND v_source.expires_at <= now() THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_SOURCE_EXPIRED',
      'refundable_until', v_refundable_until
    );
  END IF;

  IF now() > v_refundable_until THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason_code', 'REFUND_REQUEST_PERIOD_EXPIRED',
      'refundable_until', v_refundable_until
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'reason_code', null,
    'provider', v_order.provider,
    'refundable_until', v_refundable_until
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

  IF v_order.provider = 'toss' AND v_order.payment_key IS NULL THEN
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

CREATE OR REPLACE FUNCTION public.finalize_point_charge_refund(p_request_id uuid, p_provider_cancel_transaction_key text, p_provider_cancelled_at timestamp with time zone, p_provider_status text)
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
  v_new_balance integer;
BEGIN
  SELECT * INTO v_request
    FROM public.refund_requests
   WHERE id = p_request_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_FOUND';
  END IF;

  IF v_request.status = 'completed' THEN
    SELECT credits INTO v_new_balance
      FROM public.profiles
     WHERE id = v_request.user_id;

    RETURN jsonb_build_object('already_completed', true, 'new_balance', v_new_balance);
  END IF;

  IF v_request.status NOT IN ('processing', 'retryable_failed', 'manual_review')
     OR NULLIF(BTRIM(p_provider_cancel_transaction_key), '') IS NULL
     OR p_provider_cancelled_at IS NULL THEN
    RAISE EXCEPTION 'REFUND_REQUEST_NOT_READY_TO_FINALIZE';
  END IF;

  SELECT * INTO v_source
    FROM public.credit_sources
   WHERE id = v_request.source_id
   FOR UPDATE;

  SELECT * INTO v_order
    FROM public.payment_orders
   WHERE id = v_request.payment_order_id
   FOR UPDATE;

  IF NOT FOUND
     OR v_request.provider IS DISTINCT FROM v_order.provider
     OR v_source.status <> 'pending_refund'
     OR v_source.remaining_credits <> v_source.initial_credits
     OR v_order.status NOT IN ('completed', 'manual_review')
     OR (
       v_request.provider_cancel_transaction_key IS NOT NULL
       AND v_request.provider_cancel_transaction_key IS DISTINCT FROM p_provider_cancel_transaction_key
     ) THEN
    RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
  END IF;

  IF v_order.provider = 'toss' AND p_provider_status <> 'CANCELED' THEN
    RAISE EXCEPTION 'REFUND_PROVIDER_STATUS_INVALID';
  END IF;

  IF v_order.provider = 'kakaopay' AND p_provider_status <> 'CANCEL_PAYMENT' THEN
    RAISE EXCEPTION 'REFUND_PROVIDER_STATUS_INVALID';
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
       OR v_provider_transaction.payment_method_type <> 'MONEY'
       OR v_provider_transaction.provider_status NOT IN ('SUCCESS_PAYMENT', 'CANCEL_PAYMENT') THEN
      RAISE EXCEPTION 'REFUND_REQUEST_REVALIDATION_FAILED';
    END IF;

    UPDATE public.payment_provider_transactions
       SET provider_status = 'CANCEL_PAYMENT',
           last_reconciled_at = now(),
           updated_at = now()
     WHERE id = v_provider_transaction.id;
  END IF;

  PERFORM 1
    FROM public.profiles
   WHERE id = v_request.user_id
   FOR UPDATE;

  UPDATE public.credit_sources
     SET status = 'refunded',
         remaining_credits = 0
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

  UPDATE public.payment_orders
     SET status = 'refunded',
         provider_status = p_provider_status,
         canceled_at = p_provider_cancelled_at
   WHERE id = v_order.id;

  UPDATE public.payment_history
     SET status = 'refunded',
         provider_status = p_provider_status
   WHERE payment_order_id = v_order.id;

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
    -v_source.initial_credits,
    v_new_balance,
    format('원 결제수단 환불 완료 (%s 크레딧)', v_source.initial_credits),
    v_source.id,
    'refund_request',
    v_request.id
  );

  UPDATE public.refund_requests
     SET status = 'completed',
         provider_cancel_transaction_key = p_provider_cancel_transaction_key,
         provider_cancelled_at = p_provider_cancelled_at,
         processed_at = now(),
         next_attempt_at = NULL,
         last_error_code = NULL,
         last_error_message = NULL
   WHERE id = v_request.id;

  UPDATE public.checkout_attempts
     SET status = 'cancelled',
         updated_at = now()
   WHERE id = v_order.checkout_attempt_id;

  RETURN jsonb_build_object('already_completed', false, 'new_balance', v_new_balance);
END;
$function$;


-- 5. 트리거와 감사 테이블
DROP TRIGGER prevent_refund_request_origin_change ON public.refund_requests;
DROP FUNCTION public.prevent_refund_request_origin_change();
DROP TABLE public.payment_admin_actions;
DROP FUNCTION public.prevent_payment_admin_action_mutation();

-- 6. payment_orders
ALTER TABLE public.payment_orders
  DROP CONSTRAINT payment_orders_payment_method_fkey,
  DROP CONSTRAINT payment_orders_payapp_payment_method_check,
  DROP CONSTRAINT payment_orders_provider_check,
  ADD CONSTRAINT payment_orders_provider_check CHECK ((provider = ANY (ARRAY['toss'::text, 'kakaopay'::text]))),
  DROP CONSTRAINT payment_orders_provider_snapshot_check,
  ADD CONSTRAINT payment_orders_provider_snapshot_check CHECK (((provider_environment = environment) AND (((provider = 'toss'::text) AND (mid IS NOT NULL) AND (provider_merchant_id = mid)) OR ((provider = 'kakaopay'::text) AND (mid IS NULL) AND (tax_free_amount = 0) AND (vat_amount = (round(((expected_amount)::numeric / (11)::numeric)))::integer))))),
  ALTER COLUMN provider SET DEFAULT 'toss'::text,
  DROP COLUMN payment_method_code;

-- 7. 나머지 테이블
DROP TABLE public.payment_methods;

ALTER TABLE public.checkout_attempts
  DROP CONSTRAINT checkout_attempts_claimed_provider_check,
  ADD CONSTRAINT checkout_attempts_claimed_provider_check CHECK ((claimed_provider = ANY (ARRAY['toss'::text, 'kakaopay'::text])));

ALTER TABLE public.payment_provider_transactions
  DROP CONSTRAINT payment_provider_transactions_provider_check,
  ADD CONSTRAINT payment_provider_transactions_provider_check CHECK ((provider = ANY (ARRAY['toss'::text, 'kakaopay'::text]))),
  DROP CONSTRAINT payment_provider_transactions_paid_amount_check,
  DROP CONSTRAINT payment_provider_transactions_partial_cancel_amount_check,
  DROP CONSTRAINT payment_provider_transactions_fulfillment_attempt_count_check,
  DROP COLUMN paid_feedback_recorded_at,
  DROP COLUMN paid_amount,
  DROP COLUMN cancel_feedback_recorded_at,
  DROP COLUMN partial_cancel_feedback_recorded_at,
  DROP COLUMN admin_paid_confirmed_at,
  DROP COLUMN fulfillment_attempt_count,
  DROP COLUMN cancel_processed_at,
  DROP COLUMN partial_cancel_processed_at,
  DROP COLUMN provider_paid_at,
  DROP COLUMN provider_cancelled_at,
  DROP COLUMN partial_cancel_amount;

ALTER TABLE public.refund_requests
  DROP CONSTRAINT refund_requests_provider_check,
  ADD CONSTRAINT refund_requests_provider_check CHECK ((provider = ANY (ARRAY['toss'::text, 'kakaopay'::text]))),
  DROP CONSTRAINT refund_requests_origin_check,
  DROP COLUMN origin;

DROP INDEX public.refund_requests_cancel_idempotency_key;
CREATE UNIQUE INDEX refund_requests_cancel_idempotency_key
  ON public.refund_requests (cancel_idempotency_key)
  WHERE cancel_idempotency_key IS NOT NULL;

ALTER TABLE public.payment_reconciliation_items
  DROP CONSTRAINT payment_reconciliation_items_provider_check,
  ADD CONSTRAINT payment_reconciliation_items_provider_check CHECK ((provider = ANY (ARRAY['toss'::text, 'kakaopay'::text])));

ALTER TABLE public.payment_runtime_config
  DROP COLUMN payapp_accepts_new_orders,
  DROP COLUMN payapp_merchant_id;

-- 8. *_credits_once 권한은 되돌리지 않는다(다시 열면 보안 구멍이 복원됨). 필요하면 사용자 결정 후 아래를 실행한다.
-- GRANT EXECUTE ON FUNCTION public.consume_credits_once(uuid, integer, text, uuid, text, text) TO PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.refund_credits_once(uuid, integer, text, uuid, text, text, text, integer) TO anon;

-- 9. 검증
DO $$
DECLARE
  v_text text;
BEGIN
  IF (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'prepare_payment_order' AND pronargs = 17 AND pronargdefaults = 0) <> 1
     OR (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'prepare_payment_order') <> 1
     OR (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'reject_point_charge_refund' AND pronargs = 3) <> 1
     OR (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'reject_point_charge_refund') <> 1 THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: function signatures';
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_text
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prokind = 'f'
     AND p.prosecdef
     AND (p.proacl IS NULL OR p.proacl::text ~ '(\{|,)(=|anon=)X')
     AND p.proname <> 'handle_new_user';
  IF v_text IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: public/anon executable definer functions: %', v_text;
  END IF;

  -- 다시 만든 함수의 GRANT 순서는 운영과 달라질 수 있어 권한 항목을 정렬해 집합으로 비교한다.
  SELECT string_agg(
           p.proname || ' ' || COALESCE((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(p.proacl) a), 'NULL'),
           '; ' ORDER BY p.proname)
    INTO v_text
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('prepare_payment_order', 'reject_point_charge_refund', 'get_my_payment_history', 'get_my_refund_requests');
  IF v_text IS DISTINCT FROM
       'get_my_payment_history authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres; '
       || 'get_my_refund_requests authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres; '
       || 'prepare_payment_order postgres=X/postgres,service_role=X/postgres; '
       || 'reject_point_charge_refund postgres=X/postgres,service_role=X/postgres' THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: recreated function privileges: %', v_text;
  END IF;

  IF (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payment_orders' AND column_name = 'provider') IS DISTINCT FROM '''toss''::text' THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: provider default';
  END IF;

  IF to_regclass('public.payment_methods') IS NOT NULL
     OR to_regclass('public.payment_admin_actions') IS NOT NULL
     OR to_regprocedure('public.apply_payapp_feedback(text, text, text, text, integer, integer, integer, integer, timestamp with time zone, timestamp with time zone)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: new objects remain';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
