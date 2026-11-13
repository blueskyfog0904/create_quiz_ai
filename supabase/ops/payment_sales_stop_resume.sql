-- 충전 판매 중지·재개(운영자용). Supabase SQL Editor에서 필요한 문장 하나만 골라 실행한다.
-- 함수 정의: supabase/migrations/20261113180000_payment_sales_stop_resume.sql
-- 범위: 'master' = 전체, 'payapp' = 페이앱만. 처리자·사유는 반드시 적는다(판매 스위치에 기록으로 남는다).
-- 기록 칸은 하나뿐이라 마지막 변경 1건만 남는다(자동 점검이 뒤에 끄면 그 기록으로 바뀐다). 자동 점검의 사유는 결제 경보에도 남는다.

-- 1) 지금 상태 보기
SELECT master_accepts_new_orders, payapp_accepts_new_orders, changed_at, changed_by, change_ticket
  FROM public.payment_runtime_config
 WHERE id = true;

-- 2) 중지 (관리자 화면의 "충전 판매 중지" 버튼과 같은 동작. 이미 결제된 건의 지급·취소 처리는 계속된다)
--    중지 전에 결제창을 연 고객은 주문 만료(30분) 전까지 결제를 마칠 수 있고, 그 건은 정상 지급된다.
-- SELECT public.stop_payment_sales('master', '처리자 이름', '중지 사유');
-- SELECT public.stop_payment_sales('payapp', '처리자 이름', '중지 사유');

-- 3) 재개 전 확인: 숫자가 모두 0이고 scheduler_unhealthy가 false여야 재개된다
-- SELECT public.payapp_sales_resume_blockers();
--    미해소 결제 경보도 함께 본다(재개를 막지는 않지만, 원인을 확인하고 관리자 화면에서 해소한 뒤 재개한다)
-- SELECT code, severity, message, created_at FROM public.payment_reconciliation_alerts WHERE resolved_at IS NULL ORDER BY created_at;

-- 4) 재개 (막는 조건이 남아 있으면 PAYMENT_SALES_RESUME_BLOCKED 오류로 거부되고, DETAIL에 남은 건수가 나온다)
--    자동 점검이 껐다면 보통 페이앱 스위치가 꺼진 것이다. 버튼으로 껐다면 전체 스위치가 꺼진 것이다. 1)에서 false인 쪽을 켠다.
--    둘 다 false면 둘 다 켜야 판매가 재개된다. 켠 뒤 1)로 다시 확인한다.
--    PAYMENT_SALES_CONFIG_INCOMPLETE = 페이앱 가맹점 ID가 비어 있음, PAYMENT_SALES_ALREADY_ON = 그 범위는 이미 켜져 있음.
-- SELECT public.resume_payment_sales('payapp', '처리자 이름', '재개 사유(원인과 조치)');
-- SELECT public.resume_payment_sales('master', '처리자 이름', '재개 사유(원인과 조치)');
