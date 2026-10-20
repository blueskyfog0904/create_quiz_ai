-- 관리자 결제 경보 해소 (사용자 결정 2026-10-20).
-- 주문과 연결되지 않은 경보(주문 없는 통보, 이미 끝난 주문의 이상 등)는 resolve_payment_order_review로 해소할 수 없다.
-- 미해소 경보는 code당 1건만 둘 수 있어, 남아 있으면 같은 code의 새 경보가 기록되지 않는다.
-- 그래서 처리자·메모를 받아 경보 1건을 해소하고 감사 기록을 남기는 함수를 둔다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.payment_admin_actions
  DROP CONSTRAINT payment_admin_actions_action_check,
  ADD CONSTRAINT payment_admin_actions_action_check
    CHECK (action IN (
      'paid_confirmed',
      'unpaid_confirmed',
      'cancel_handled',
      'manual_refund_completed',
      'manual_review_refund_rejected',
      'alert_resolved'
    ));

CREATE FUNCTION public.resolve_payment_alert(
  p_alert_id uuid,
  p_actor_id uuid,
  p_note text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_alert public.payment_reconciliation_alerts%ROWTYPE;
  v_payment_order_id uuid;
  v_order_status text;
  v_order_failure_code text;
BEGIN
  IF p_alert_id IS NULL
     OR p_actor_id IS NULL
     OR NULLIF(BTRIM(p_note), '') IS NULL
     OR length(p_note) > 500 THEN
    RAISE EXCEPTION 'PAYMENT_ALERT_INPUT_INVALID';
  END IF;

  SELECT * INTO v_alert
    FROM public.payment_reconciliation_alerts
   WHERE id = p_alert_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_ALERT_NOT_FOUND';
  END IF;

  -- 이미 해소된 경보는 그대로 둔다(멱등).
  IF v_alert.resolved_at IS NOT NULL THEN
    RETURN jsonb_build_object('resolved', false, 'already_resolved', true);
  END IF;

  -- 경보 details의 주문 id는 감사 기록 연결용이다. uuid가 아니면 비워 둔다.
  IF v_alert.details->>'payment_order_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_payment_order_id := (v_alert.details->>'payment_order_id')::uuid;
    -- 해소 당시 주문 상태를 감사에 남긴다(잠금 없이 읽기만 한다).
    SELECT status, failure_code
      INTO v_order_status, v_order_failure_code
      FROM public.payment_orders
     WHERE id = v_payment_order_id;
  END IF;

  UPDATE public.payment_reconciliation_alerts
     SET resolved_at = now(),
         details = details || jsonb_build_object('resolved_by', p_actor_id, 'resolution_note', p_note)
   WHERE id = v_alert.id;

  INSERT INTO public.payment_admin_actions (
    actor_id,
    action,
    payment_order_id,
    before_state,
    after_state,
    note,
    details
  ) VALUES (
    p_actor_id,
    'alert_resolved',
    v_payment_order_id,
    jsonb_build_object(
      'alert_id', v_alert.id,
      'code', v_alert.code,
      'resolved_at', NULL,
      'order_status', v_order_status,
      'failure_code', v_order_failure_code
    ),
    jsonb_build_object('resolved_at', now()),
    p_note,
    jsonb_build_object(
      'alert_id', v_alert.id,
      'code', v_alert.code,
      'severity', v_alert.severity,
      'alert_created_at', v_alert.created_at,
      'alert_message', v_alert.message,
      'alert_details', v_alert.details
    )
  );

  RETURN jsonb_build_object('resolved', true, 'already_resolved', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_payment_alert(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_payment_alert(uuid, uuid, text) TO service_role;

-- 검증
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'resolve_payment_alert') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: resolve_payment_alert overloads';
  END IF;

  IF (SELECT proacl::text FROM pg_proc WHERE oid = 'public.resolve_payment_alert(uuid, uuid, text)'::regprocedure)
       IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.resolve_payment_alert(uuid, uuid, text)'::regprocedure)
     OR NOT (SELECT COALESCE(proconfig, '{}') @> ARRAY['search_path=public, pg_temp']
               FROM pg_proc WHERE oid = 'public.resolve_payment_alert(uuid, uuid, text)'::regprocedure) THEN
    RAISE EXCEPTION 'VERIFY: resolve_payment_alert privileges';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'payment_admin_actions_action_check'
       AND conrelid = 'public.payment_admin_actions'::regclass
       AND convalidated
       AND pg_get_constraintdef(oid) LIKE '%''alert_resolved''%'
  ) THEN
    RAISE EXCEPTION 'VERIFY: payment_admin_actions action check';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
