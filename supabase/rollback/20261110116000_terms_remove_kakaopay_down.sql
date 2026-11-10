-- 20261110116000_terms_remove_kakaopay 되돌리기.
-- 지운 카카오페이 문구 세 조각을 원래대로 되돌린다. 결과가 적용 전 값과 같아야 하므로(md5 0eaa00b3…)
-- 적용 뒤에 관리자 화면에서 약관을 고쳤다면 멈춘다. 그때는 적용 전 원문
-- supabase/rollback/20261110116000_terms_remove_kakaopay_before.json(md5 0eaa00b3…, value::text 그대로)과
-- 현재 값을 비교해 관리자 수정 내용을 확인한 뒤 손으로 되돌린다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  c_original_md5 constant text := '0eaa00b3ac686387a4c9110b2fc085ca';
  c_refund_pg_old constant text := '결제대행사(페이앱) 또는 카카오페이를 통해';
  c_refund_pg_new constant text := '결제대행사(페이앱)를 통해';
  c_refund_methods_old constant text := '휴대폰 결제와 카카오페이를 사용할 수 있습니다.';
  c_refund_methods_new constant text := '휴대폰 결제를 사용할 수 있습니다.';
  c_privacy_old constant text :=
    E'\n'
    || '- (주)카카오페이: 카카오페이 결제 승인, 결제 결과 확인 및 환불 처리 '
    || '(제공 정보: 주문번호, 상품명, 결제금액, 가명 처리된 회원 식별값)';
  -- 지운 줄은 바로 앞 페이앱 위탁 줄의 끝 뒤에 있었다.
  c_privacy_anchor constant text := '(제공 정보: 주문번호, 상품명, 결제금액, 휴대폰 번호)';
  v_value jsonb;
  v_refund text;
  v_privacy text;
  v_restored jsonb;
BEGIN
  SELECT value INTO v_value
    FROM public.system_settings
   WHERE key = 'site_footer_content'
   FOR UPDATE;

  v_refund := replace(replace(v_value #>> '{policyDocuments,refundPolicy,content}',
                              c_refund_methods_new, c_refund_methods_old),
                      c_refund_pg_new, c_refund_pg_old);
  v_privacy := replace(v_value #>> '{policyDocuments,privacyPolicy,content}',
                       c_privacy_anchor, c_privacy_anchor || c_privacy_old);
  v_restored := jsonb_set(
    jsonb_set(v_value, '{policyDocuments,refundPolicy,content}', to_jsonb(v_refund)),
    '{policyDocuments,privacyPolicy,content}', to_jsonb(v_privacy));

  IF md5(v_restored::text) IS DISTINCT FROM c_original_md5 THEN
    RAISE EXCEPTION 'ROLLBACK: footer content was edited after DB13; restore manually';
  END IF;

  UPDATE public.system_settings
     SET value = v_restored,
         updated_at = now()
   WHERE key = 'site_footer_content';
END;
$$;

NOTIFY pgrst, 'reload schema';
