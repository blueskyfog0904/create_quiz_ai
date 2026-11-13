-- 결제수단 '카카오페이'를 사용 안 함으로 바꾼다(운영 전 데이터 점검 U0-2, 사용자 결정 2026-11-13).
-- 카카오페이는 쓰지 않기로 했고 카카오 판매 스위치(kakaopay_accepts_new_orders)도 꺼져 있지만,
-- 결제수단 표에는 '사용'으로 남아 있었다. 표의 값도 실제와 맞춘다. 행·코드는 지우지 않는다(과거 주문 표시와 재사용 대비).
-- 다시 켜기 / 되돌리기: supabase/rollback/20261113190000_disable_kakaopay_payment_method_down.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

UPDATE public.payment_methods
   SET is_enabled = false,
       updated_at = now()
 WHERE code = 'kakaopay'
   AND provider = 'kakaopay'
   AND is_enabled = true;
