-- 20261021100000_payapp_migration_b1_terms 되돌리기.
-- B1이 바꾼 네 조각을 원래 문구로 되돌린다. 결과가 B1 직전 값과 같아야 하므로(md5 9b4ee824…)
-- B1 뒤에 관리자 화면에서 약관을 고쳤다면 멈춘다. 그때는 B1 직전 원문
-- supabase/rollback/20261021100000_payapp_migration_b1_terms_before.json(md5 9b4ee824…, value::text 그대로)과
-- 현재 값을 비교해 관리자 수정 내용을 확인한 뒤 손으로 되돌린다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  c_original_md5 constant text := '9b4ee824c49a68bc44809efe8163557d';
  c_refund_pg_old constant text := '토스페이먼츠 등 결제대행사를 통해';
  c_refund_pg_new constant text := '결제대행사(페이앱) 또는 카카오페이를 통해';
  c_refund_methods_old constant text :=
    '- 일반결제는 신용·체크카드 및 계약된 네이버페이·페이코·토스페이를 지원합니다. '
    || '카카오페이 직접결제는 별도 운영 승인이 완료된 경우 카카오페이머니만 제공합니다. '
    || '계좌이체·퀵계좌이체·가상계좌는 지원하지 않으며 하나카드와 일부 카드사는 제한될 수 있습니다.';
  c_refund_methods_new constant text :=
    '- 포인트 충전에는 신용·체크카드, 네이버페이, 토스페이, 휴대폰 결제와 카카오페이를 사용할 수 있습니다. '
    || '계좌이체, 가상계좌 등 그 밖의 결제수단은 지원하지 않습니다.'
    || E'\n'
    || '- 휴대폰 결제는 결제한 달이 지나면 승인 취소가 되지 않을 수 있으며, 이 경우 회사가 별도 확인 후 환불합니다.';
  c_refund_original_old constant text := '- 승인된 환불은 반드시 결제 당시 사용한 원 결제수단으로 처리합니다.';
  c_refund_original_new constant text := '- 승인된 환불은 결제 당시 사용한 원 결제수단으로 처리하는 것을 원칙으로 합니다.';
  c_privacy_old constant text := '- 토스페이먼츠: 크레딧 결제 승인, 결제수단 처리, 결제 결과 확인 및 환불 처리';
  c_privacy_new constant text :=
    '- (주)유디아이디(페이앱): 크레딧 결제 승인, 결제수단 처리, 결제 결과 통보 및 환불 처리 '
    || '(제공 정보: 주문번호, 상품명, 결제금액, 휴대폰 번호)'
    || E'\n'
    || '- (주)카카오페이: 카카오페이 결제 승인, 결제 결과 확인 및 환불 처리 '
    || '(제공 정보: 주문번호, 상품명, 결제금액, 가명 처리된 회원 식별값)';
  v_value jsonb;
  v_refund text;
  v_privacy text;
  v_restored jsonb;
BEGIN
  SELECT value INTO v_value
    FROM public.system_settings
   WHERE key = 'site_footer_content'
   FOR UPDATE;

  v_refund := replace(replace(replace(v_value #>> '{policyDocuments,refundPolicy,content}',
                                      c_refund_original_new, c_refund_original_old),
                              c_refund_methods_new, c_refund_methods_old),
                      c_refund_pg_new, c_refund_pg_old);
  v_privacy := replace(v_value #>> '{policyDocuments,privacyPolicy,content}', c_privacy_new, c_privacy_old);
  v_restored := jsonb_set(
    jsonb_set(v_value, '{policyDocuments,refundPolicy,content}', to_jsonb(v_refund)),
    '{policyDocuments,privacyPolicy,content}', to_jsonb(v_privacy));

  IF md5(v_restored::text) IS DISTINCT FROM c_original_md5 THEN
    RAISE EXCEPTION 'ROLLBACK: footer content was edited after B1; restore manually';
  END IF;

  UPDATE public.system_settings
     SET value = v_restored,
         updated_at = now()
   WHERE key = 'site_footer_content';
END;
$$;

NOTIFY pgrst, 'reload schema';
