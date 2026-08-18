CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE public.payment_reconciliation_scheduler (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  lease_owner uuid,
  lease_expires_at timestamptz,
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_completed_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_error_code text,
  last_error_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.payment_reconciliation_scheduler (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.payment_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'skipped')),
  batch_limit integer NOT NULL CHECK (batch_limit BETWEEN 1 AND 50),
  backlog_at_start integer NOT NULL DEFAULT 0 CHECK (backlog_at_start >= 0),
  processed_count integer NOT NULL DEFAULT 0 CHECK (processed_count >= 0),
  succeeded_count integer NOT NULL DEFAULT 0 CHECK (succeeded_count >= 0),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  manual_review_count integer NOT NULL DEFAULT 0 CHECK (manual_review_count >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.payment_reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.payment_reconciliation_runs(id) ON DELETE RESTRICT,
  payment_order_id uuid NOT NULL REFERENCES public.payment_orders(id) ON DELETE RESTRICT,
  order_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('toss', 'kakaopay')),
  outcome text NOT NULL,
  error_code text,
  error_message text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, payment_order_id)
);

CREATE TABLE public.payment_reconciliation_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warning', 'critical')),
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX payment_reconciliation_alerts_active_code_key
  ON public.payment_reconciliation_alerts(code)
  WHERE resolved_at IS NULL;
CREATE INDEX payment_reconciliation_runs_started_at_idx
  ON public.payment_reconciliation_runs(started_at DESC);
CREATE INDEX payment_reconciliation_items_order_idx
  ON public.payment_reconciliation_items(payment_order_id, processed_at DESC);

ALTER TABLE public.payment_reconciliation_scheduler ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_reconciliation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_reconciliation_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_reconciliation_scheduler
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.payment_reconciliation_runs
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.payment_reconciliation_items
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.payment_reconciliation_alerts
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.payment_reconciliation_scheduler TO service_role;
GRANT SELECT ON TABLE public.payment_reconciliation_runs TO service_role;
GRANT SELECT ON TABLE public.payment_reconciliation_items TO service_role;
GRANT SELECT ON TABLE public.payment_reconciliation_alerts TO service_role;

CREATE OR REPLACE FUNCTION public.payment_reconciliation_backlog_count()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.start_payment_reconciliation_run(
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_scheduler public.payment_reconciliation_scheduler%ROWTYPE;
  v_run_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_backlog integer;
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
         updated_at = v_now
   WHERE id = 1;

  RETURN jsonb_build_object(
    'acquired', true,
    'run_id', v_run_id,
    'backlog', v_backlog,
    'lease_expires_at', v_now + interval '4 minutes'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_payment_reconciliation_batch(
  p_run_id uuid,
  p_limit integer
)
RETURNS TABLE(order_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.record_payment_reconciliation_result(
  p_run_id uuid,
  p_order_id text,
  p_outcome text,
  p_error_code text,
  p_error_message text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.payment_orders%ROWTYPE;
  v_inserted boolean;
  v_retry boolean := p_outcome IN ('provider_not_final', 'retry_required');
  v_delay_seconds integer;
BEGIN
  SELECT *
    INTO v_order
    FROM public.payment_orders
   WHERE order_id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.payment_reconciliation_items (
    run_id,
    payment_order_id,
    order_id,
    provider,
    outcome,
    error_code,
    error_message
  ) VALUES (
    p_run_id,
    v_order.id,
    v_order.order_id,
    v_order.provider,
    p_outcome,
    NULLIF(LEFT(COALESCE(p_error_code, ''), 100), ''),
    NULLIF(LEFT(COALESCE(p_error_message, ''), 500), '')
  )
  ON CONFLICT (run_id, payment_order_id) DO NOTHING;

  GET DIAGNOSTICS v_delay_seconds = ROW_COUNT;
  v_inserted := v_delay_seconds = 1;
  IF NOT v_inserted THEN
    RETURN false;
  END IF;

  v_delay_seconds := LEAST(
    3600,
    POWER(2::numeric, LEAST(v_order.reconcile_attempt_count, 6))::integer * 60
  );

  UPDATE public.payment_orders
     SET last_reconciled_at = now(),
         next_reconcile_at = CASE
           WHEN v_retry THEN now() + make_interval(secs => v_delay_seconds)
           ELSE NULL
         END,
         last_reconcile_error_code = CASE WHEN v_retry THEN p_error_code ELSE NULL END,
         last_reconcile_error_message = CASE WHEN v_retry THEN p_error_message ELSE NULL END
   WHERE id = v_order.id;

  UPDATE public.payment_provider_transactions
     SET last_reconciled_at = now(),
         next_reconcile_at = CASE
           WHEN v_retry THEN now() + make_interval(secs => v_delay_seconds)
           ELSE NULL
         END,
         last_error_code = CASE WHEN v_retry THEN p_error_code ELSE NULL END,
         last_error_message = CASE WHEN v_retry THEN p_error_message ELSE NULL END,
         reconcile_attempt_count = reconcile_attempt_count + 1,
         updated_at = now()
   WHERE payment_order_id = v_order.id;

  UPDATE public.payment_webhook_events
     SET processing_status = CASE WHEN v_retry THEN 'failed' ELSE 'completed' END,
         processed_at = CASE WHEN v_retry THEN processed_at ELSE now() END,
         last_error_code = CASE WHEN v_retry THEN p_error_code ELSE NULL END
   WHERE order_id = v_order.order_id
     AND processing_status IN ('pending', 'failed');

  UPDATE public.payment_reconciliation_runs
     SET processed_count = processed_count + 1,
         succeeded_count = succeeded_count + CASE
           WHEN p_outcome IN (
             'already_completed',
             'payment_fulfilled',
             'refund_finalized',
             'payment_failed',
             'payment_expired'
           ) THEN 1 ELSE 0 END,
         retry_count = retry_count + CASE WHEN v_retry THEN 1 ELSE 0 END,
         manual_review_count = manual_review_count + CASE
           WHEN p_outcome = 'manual_review' THEN 1 ELSE 0 END,
         heartbeat_at = now()
   WHERE id = p_run_id
     AND status = 'running';

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_payment_reconciliation_terminal(
  p_payment_order_id uuid,
  p_status text,
  p_provider_status text,
  p_failure_code text,
  p_failure_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.enforce_payment_reconciliation_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.finish_payment_reconciliation_run(
  p_run_id uuid,
  p_success boolean,
  p_error_code text,
  p_error_message text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.payment_reconciliation_runs%ROWTYPE;
  v_health jsonb;
BEGIN
  SELECT *
    INTO v_run
    FROM public.payment_reconciliation_runs
   WHERE id = p_run_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_RECONCILIATION_RUN_NOT_FOUND';
  END IF;

  IF v_run.status <> 'running' THEN
    RETURN jsonb_build_object('already_completed', true, 'status', v_run.status);
  END IF;

  UPDATE public.payment_reconciliation_runs
     SET status = CASE
           WHEN NOT p_success THEN 'failed'
           WHEN retry_count > 0 OR manual_review_count > 0 THEN 'partial'
           ELSE 'succeeded'
         END,
         completed_at = now(),
         heartbeat_at = now(),
         lease_expires_at = now(),
         last_error_code = NULLIF(LEFT(COALESCE(p_error_code, ''), 100), ''),
         last_error_message = NULLIF(LEFT(COALESCE(p_error_message, ''), 500), '')
   WHERE id = p_run_id;

  UPDATE public.payment_reconciliation_scheduler
     SET lease_owner = NULL,
         lease_expires_at = NULL,
         last_completed_at = now(),
         last_succeeded_at = CASE WHEN p_success THEN now() ELSE last_succeeded_at END,
         consecutive_failures = CASE WHEN p_success THEN 0 ELSE consecutive_failures + 1 END,
         last_error_code = CASE WHEN p_success THEN NULL ELSE p_error_code END,
         last_error_message = CASE WHEN p_success THEN NULL ELSE p_error_message END,
         updated_at = now()
   WHERE id = 1
     AND lease_owner = p_run_id;

  v_health := public.enforce_payment_reconciliation_health();

  RETURN jsonb_build_object(
    'already_completed', false,
    'run_id', p_run_id,
    'processed', v_run.processed_count,
    'health', v_health
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_payment_reconciliation_health()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'last_started_at', prs.last_started_at,
    'last_succeeded_at', prs.last_succeeded_at,
    'last_completed_at', prs.last_completed_at,
    'consecutive_failures', prs.consecutive_failures,
    'backlog', public.payment_reconciliation_backlog_count(),
    'active_alerts', (
      SELECT COUNT(*)
        FROM public.payment_reconciliation_alerts pra
       WHERE pra.resolved_at IS NULL
    )
  )
    FROM public.payment_reconciliation_scheduler prs
   WHERE prs.id = 1;
$$;

REVOKE EXECUTE ON FUNCTION public.payment_reconciliation_backlog_count()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.start_payment_reconciliation_run(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_payment_reconciliation_batch(uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_payment_reconciliation_result(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_payment_reconciliation_terminal(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_payment_reconciliation_health()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.finish_payment_reconciliation_run(uuid, boolean, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_payment_reconciliation_health()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.start_payment_reconciliation_run(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_payment_reconciliation_batch(uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_payment_reconciliation_result(uuid, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_payment_reconciliation_terminal(uuid, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_payment_reconciliation_run(uuid, boolean, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_payment_reconciliation_health()
  TO service_role;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid
    INTO v_job_id
    FROM cron.job
   WHERE jobname = 'payment-reconciliation-health-5m';

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'payment-reconciliation-health-5m',
    '*/5 * * * *',
    'SELECT public.enforce_payment_reconciliation_health();'
  );

  SELECT jobid
    INTO v_job_id
    FROM cron.job
   WHERE jobname = 'payment-reconciliation-http-5m';

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  IF EXISTS (
       SELECT 1 FROM vault.decrypted_secrets
        WHERE name = 'payment_reconcile_origin'
     )
     AND EXISTS (
       SELECT 1 FROM vault.decrypted_secrets
        WHERE name = 'payment_reconcile_cron_secret'
     ) THEN
    PERFORM cron.schedule(
      'payment-reconciliation-http-5m',
      '*/5 * * * *',
      $cron$
        SELECT net.http_post(
          url := (
            SELECT decrypted_secret
              FROM vault.decrypted_secrets
             WHERE name = 'payment_reconcile_origin'
          ) || '/api/internal/payments/reconcile',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              SELECT decrypted_secret
                FROM vault.decrypted_secrets
               WHERE name = 'payment_reconcile_cron_secret'
            )
          ),
          body := jsonb_build_object('limit', 20),
          timeout_milliseconds := 55000
        );
      $cron$
    );
  END IF;
END;
$$;
