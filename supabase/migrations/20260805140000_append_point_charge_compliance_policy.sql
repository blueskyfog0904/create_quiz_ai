DO $$
DECLARE
  v_refund_append text := E'\n\n## 포인트 충전 심사 필수 안내\n- 충전된 포인트의 이용기간과 환불가능기간은 결제시점으로부터 1년 이내로 제한됩니다.\n- 크레딧은 자동결제가 아닌 1회 충전 상품이며, 1회 충전금액은 100,000원 이하로 제한됩니다.\n- 충전 크레딧은 결제한 계정에 귀속되며 회원 간 양도·이전 또는 현금 교환이 불가합니다.\n- 구매 후 7일 이내이고 해당 충전 크레딧을 전혀 사용하지 않은 경우에만 환불을 요청할 수 있습니다.\n- 승인된 환불은 반드시 결제 당시 사용한 원 결제수단으로 처리합니다.\n- 충전 경로: 로그인 → /pricing → 상품 선택 → /checkout → 토스페이먼츠 결제 → /mypage/credits 확인\n- 사용 경로: AI 문제 생성, 문제은행, 시험지 제작, 영어·국어 문제마켓 자료 구매. 사용 내역은 /mypage/credits, 결제 상태는 /mypage/payments에서 확인합니다.\n- 신용·체크카드 및 계약된 카카오페이·네이버페이·페이코·토스페이를 지원합니다. 계좌이체·가상계좌는 지원하지 않으며 하나카드와 일부 카드사는 제한될 수 있습니다.';
  v_service_append text := E'\n\n## 크레딧(충전형 포인트) 이용조건\n충전된 포인트의 이용기간과 환불가능기간은 결제시점으로부터 1년 이내로 제한됩니다. 크레딧은 자동결제가 아닌 1회 충전 상품이고, 1회 충전금액은 100,000원 이하이며 회원 간 양도·이전이 불가합니다. 세부 충전 경로, 사용 경로 및 원 결제수단 환불 기준은 취소/환불정책을 따릅니다.';
BEGIN
  UPDATE public.system_settings
     SET value = jsonb_set(
           value::jsonb,
           '{policyDocuments}',
           jsonb_set(
             COALESCE(value::jsonb -> 'policyDocuments', '{}'::jsonb),
             '{refundPolicy}',
             jsonb_set(
               COALESCE(
                 value::jsonb -> 'policyDocuments' -> 'refundPolicy',
                 '{}'::jsonb
               ),
               '{content}',
               to_jsonb(
                 COALESCE(
                   value::jsonb #>> '{policyDocuments,refundPolicy,content}',
                   ''
                 ) || v_refund_append
               ),
               true
             ),
             true
           ),
           true
         ),
         updated_at = now()
   WHERE key = 'site_footer_content'
     AND COALESCE(
       value::jsonb #>> '{policyDocuments,refundPolicy,content}',
       ''
     ) NOT LIKE '%충전된 포인트의 이용기간과 환불가능기간은 결제시점으로부터 1년 이내로 제한됩니다.%';

  UPDATE public.system_settings
     SET value = jsonb_set(
           value::jsonb,
           '{policyDocuments}',
           jsonb_set(
             COALESCE(value::jsonb -> 'policyDocuments', '{}'::jsonb),
             '{serviceTerms}',
             jsonb_set(
               COALESCE(
                 value::jsonb -> 'policyDocuments' -> 'serviceTerms',
                 '{}'::jsonb
               ),
               '{content}',
               to_jsonb(
                 COALESCE(
                   value::jsonb #>> '{policyDocuments,serviceTerms,content}',
                   ''
                 ) || v_service_append
               ),
               true
             ),
             true
           ),
           true
         ),
         updated_at = now()
   WHERE key = 'site_footer_content'
     AND COALESCE(
       value::jsonb #>> '{policyDocuments,serviceTerms,content}',
       ''
     ) NOT LIKE '%충전된 포인트의 이용기간과 환불가능기간은 결제시점으로부터 1년 이내로 제한됩니다.%';
END;
$$;
