-- 20261020090000_payment_alert_resolution 되돌리기.
-- 경보 해소 감사 기록(action='alert_resolved')이 있으면 CHECK를 되돌릴 수 없으므로 멈춘다.
-- (감사 테이블은 append-only라 지우지 않는다. 그 경우 함수만 내리고 CHECK는 둔다.)
-- 순서: 경보 해소 route를 부르는 앱 코드를 먼저 되돌린 뒤 실행한다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DROP FUNCTION IF EXISTS public.resolve_payment_alert(uuid, uuid, text);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payment_admin_actions WHERE action = 'alert_resolved') THEN
    RAISE NOTICE 'ROLLBACK: alert_resolved 감사 기록이 있어 action CHECK는 그대로 둔다';
    RETURN;
  END IF;

  ALTER TABLE public.payment_admin_actions
    DROP CONSTRAINT payment_admin_actions_action_check,
    ADD CONSTRAINT payment_admin_actions_action_check
      CHECK (action IN (
        'paid_confirmed',
        'unpaid_confirmed',
        'cancel_handled',
        'manual_refund_completed',
        'manual_review_refund_rejected'
      ));
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.resolve_payment_alert(uuid, uuid, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: resolve_payment_alert remains';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payment_admin_actions WHERE action = 'alert_resolved')
     AND EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'payment_admin_actions_action_check'
          AND conrelid = 'public.payment_admin_actions'::regclass
          AND pg_get_constraintdef(oid) LIKE '%''alert_resolved''%'
     ) THEN
    RAISE EXCEPTION 'ROLLBACK_VERIFY: action check still allows alert_resolved';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
