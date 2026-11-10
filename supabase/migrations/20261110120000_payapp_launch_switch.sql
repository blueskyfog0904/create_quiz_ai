-- 페이앱 출시 스위치. 계획 5.3·8단계, 체크리스트 출시 2.
-- payapp_merchant_id를 Vercel Production PAYAPP_USERID와 같은 값으로 설정하고 페이앱 신규 주문을 연다.
-- 이전 값(2026-10-21 06:55 UTC 확인):
--   payapp_merchant_id NULL, payapp_accepts_new_orders false, master_accepts_new_orders true,
--   changed_at 2026-08-18 08:46:39 UTC, changed_by 'codex_phase6_local_ui_check',
--   change_ticket 'PHASE6_LOCAL_UI_CHECK_COMPLETE'
-- 출시 1의 사전 점검 중 취소 표식 미처리 0건과 미해소 경보 0건을 여기서 다시 확인하고, 아니면 아무것도 바꾸지 않는다.
-- 나머지(페이앱 주문·manual_review 0건, 대사 스케줄러 정상, 경보 해소 메모)는 적용 직전에 수동으로 확인한다.
-- 되돌리기(스위치 off): supabase/rollback/20261110120000_payapp_launch_switch_down.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  c_merchant_id constant text := 'summersuninst';
  v_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.payment_orders po
      JOIN public.payment_provider_transactions ppt ON ppt.payment_order_id = po.id
     WHERE po.provider = 'payapp'
       AND ((ppt.cancel_feedback_recorded_at <= now() - interval '10 minutes' AND ppt.cancel_processed_at IS NULL)
         OR (ppt.partial_cancel_feedback_recorded_at <= now() - interval '10 minutes' AND ppt.partial_cancel_processed_at IS NULL))
  ) THEN
    RAISE EXCEPTION 'PAYAPP_LAUNCH_PRECHECK: unprocessed payapp cancel feedback';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payment_reconciliation_alerts WHERE resolved_at IS NULL) THEN
    RAISE EXCEPTION 'PAYAPP_LAUNCH_PRECHECK: unresolved payment alerts';
  END IF;

  UPDATE public.payment_runtime_config
     SET payapp_merchant_id = c_merchant_id,
         payapp_accepts_new_orders = true,
         changed_at = now(),
         changed_by = 'migration_20261110120000_payapp_launch_switch',
         change_ticket = 'PAYAPP_LAUNCH'
   WHERE id = true
     AND master_accepts_new_orders = true
     AND payapp_accepts_new_orders = false
     AND payapp_merchant_id IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PAYAPP_LAUNCH: runtime config is not in the pre-launch state';
  END IF;
END;
$$;
