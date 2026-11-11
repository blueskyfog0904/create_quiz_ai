-- 20261111100000_payment_method_descriptions 되돌리기. 이 마이그레이션이 넣은 문구 그대로인 행만 다시 비운다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

UPDATE public.payment_methods AS m
   SET description = NULL,
       updated_at = now()
  FROM (VALUES
    ('card', '국내 모든 신용·체크카드'),
    ('naverpay', '네이버페이 포인트·연결 카드로 결제'),
    ('tosspay', '토스 간편결제')
  ) AS v(code, description)
 WHERE m.provider = 'payapp'
   AND m.code = v.code
   AND m.description = v.description;
