-- 20261113190000_disable_kakaopay_payment_method 되돌리기(결제수단 '카카오페이'를 다시 '사용'으로).
-- 이것만으로 카카오페이 결제가 열리지는 않는다(카카오 판매 스위치와 가맹점 설정이 따로 있다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

UPDATE public.payment_methods
   SET is_enabled = true,
       updated_at = now()
 WHERE code = 'kakaopay'
   AND provider = 'kakaopay';
