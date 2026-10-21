-- 20261021110000_payapp_launch_switch 되돌리기(체크리스트 출시 5: 스위치 off).
-- 페이앱 신규 주문만 닫는다. 이미 결제창에 들어간 주문의 결제완료·취소 통보와 환불은 이 스위치와 무관하게 계속 처리된다.
-- payapp_merchant_id는 남긴다. 신규 주문은 payapp_accepts_new_orders=false로 막히고,
-- 나중에 다시 열 때 같은 값을 비교할 수 있게 하기 위해서다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.payment_runtime_config
     SET payapp_accepts_new_orders = false,
         changed_at = now(),
         changed_by = 'rollback_20261021110000_payapp_launch_switch',
         change_ticket = 'PAYAPP_LAUNCH_ROLLBACK'
   WHERE id = true
     AND payapp_accepts_new_orders = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'ROLLBACK: payapp switch is already off';
  END IF;
END;
$$;
