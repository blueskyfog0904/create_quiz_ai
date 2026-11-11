-- 결제 화면(B-1 디자인)에서 결제수단마다 한 줄 설명을 보여 준다. 설명은 payment_methods.description(데이터)에 둔다.
-- 설명이 비어 있는 페이앱 카드·네이버페이·토스페이만 채운다. 휴대폰 결제 설명과 다른 행은 건드리지 않는다.
-- 되돌리기: supabase/rollback/20261111100000_payment_method_descriptions_down.sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.payment_methods AS m
     SET description = v.description,
         updated_at = now()
    FROM (VALUES
      ('card', '국내 모든 신용·체크카드'),
      ('naverpay', '네이버페이 포인트·연결 카드로 결제'),
      ('tosspay', '토스 간편결제')
    ) AS v(code, description)
   WHERE m.provider = 'payapp'
     AND m.code = v.code
     AND m.description IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'PAYMENT_METHOD_DESCRIPTIONS: expected 3 rows with empty description, got %', v_count;
  END IF;
END;
$$;
