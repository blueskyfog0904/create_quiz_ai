DO $$
DECLARE
  v_content text;
BEGIN
  SELECT value::jsonb #>> '{policyDocuments,refundPolicy,content}'
    INTO v_content
    FROM public.system_settings
   WHERE key = 'site_footer_content';

  IF v_content IS NULL THEN
    RETURN;
  END IF;

  v_content := replace(
    v_content,
    '충전 경로: 로그인 → /pricing → 상품 선택 → /checkout → 토스페이먼츠 결제 → /mypage/credits 확인',
    '충전 경로: 로그인 → /pricing → 상품 선택 → /checkout → 결제수단 선택 및 결제 → /mypage/credits 확인'
  );
  v_content := replace(
    v_content,
    '사용 경로: AI 문제 생성, 문제은행, 시험지 제작, 영어·국어 문제마켓 자료 구매. 사용 내역은 /mypage/credits, 결제 상태는 /mypage/payments에서 확인합니다.',
    '사용 경로: 영어·국어 문제마켓 자료 구매. 사용 내역은 /mypage/credits, 결제 상태는 /mypage/payments에서 확인합니다.'
  );
  v_content := replace(
    v_content,
    '신용·체크카드 및 계약된 카카오페이·네이버페이·페이코·토스페이를 지원합니다. 계좌이체·가상계좌는 지원하지 않으며 하나카드와 일부 카드사는 제한될 수 있습니다.',
    '일반결제는 신용·체크카드 및 계약된 네이버페이·페이코·토스페이를 지원합니다. 카카오페이 직접결제는 별도 운영 승인이 완료된 경우 카카오페이머니만 제공합니다. 계좌이체·퀵계좌이체·가상계좌는 지원하지 않으며 하나카드와 일부 카드사는 제한될 수 있습니다.'
  );

  UPDATE public.system_settings
     SET value = jsonb_set(
           value::jsonb,
           '{policyDocuments,refundPolicy,content}',
           to_jsonb(v_content),
           false
         ),
         updated_at = now()
   WHERE key = 'site_footer_content';
END;
$$;
