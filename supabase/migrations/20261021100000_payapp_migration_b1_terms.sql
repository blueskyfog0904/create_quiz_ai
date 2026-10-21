-- 페이앱 전환 마이그레이션 B1 (약관·푸터 문구). 계획 13.3, 체크리스트 B1. 출시 직전에 적용한다.
-- 운영 site_footer_content는 코드 기본값과 다르므로 전체를 바꾸지 않고, 실제 DB 문구의 정해진 경로에서
-- 미리 확인한 조각(각각 정확히 1번 나옴)만 바꾼다.
--   policyDocuments.refundPolicy.content: 결제대행사 문장, 결제수단 안내 줄
--   policyDocuments.privacyPolicy.content: 6조 위탁 목록의 토스페이먼츠 줄
-- dry-run(2026-10-21) 시점 md5와 다르면(관리자 화면에서 고쳤으면) 아무것도 바꾸지 않고 멈춘다.
-- B1 직전 value 원문: supabase/rollback/20261021100000_payapp_migration_b1_terms_before.json (md5 같음)
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  c_expected_md5 constant text := '9b4ee824c49a68bc44809efe8163557d';
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
  c_privacy_old constant text := '- 토스페이먼츠: 크레딧 결제 승인, 결제수단 처리, 결제 결과 확인 및 환불 처리';
  c_privacy_new constant text :=
    '- (주)유디아이디(페이앱): 크레딧 결제 승인, 결제수단 처리, 결제 결과 통보 및 환불 처리 '
    || '(제공 정보: 주문번호, 상품명, 결제금액, 휴대폰 번호)'
    || E'\n'
    || '- (주)카카오페이: 카카오페이 결제 승인, 결제 결과 확인 및 환불 처리';
  v_value jsonb;
  v_refund text;
  v_privacy text;
  v_count integer;
  v_text text;
BEGIN
  SELECT value INTO v_value
    FROM public.system_settings
   WHERE key = 'site_footer_content'
     AND md5(value::text) = c_expected_md5
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B1: site_footer_content changed since dry-run';
  END IF;

  v_refund := v_value #>> '{policyDocuments,refundPolicy,content}';
  v_privacy := v_value #>> '{policyDocuments,privacyPolicy,content}';

  IF (length(v_refund) - length(replace(v_refund, c_refund_pg_old, ''))) / length(c_refund_pg_old) IS DISTINCT FROM 1
     OR (length(v_refund) - length(replace(v_refund, c_refund_methods_old, ''))) / length(c_refund_methods_old) IS DISTINCT FROM 1
     OR (length(v_privacy) - length(replace(v_privacy, c_privacy_old, ''))) / length(c_privacy_old) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'B1: expected fragments not found exactly once';
  END IF;

  v_refund := replace(replace(v_refund, c_refund_pg_old, c_refund_pg_new), c_refund_methods_old, c_refund_methods_new);
  v_privacy := replace(v_privacy, c_privacy_old, c_privacy_new);

  UPDATE public.system_settings
     SET value = jsonb_set(
           jsonb_set(value, '{policyDocuments,refundPolicy,content}', to_jsonb(v_refund)),
           '{policyDocuments,privacyPolicy,content}', to_jsonb(v_privacy)),
         updated_at = now()
   WHERE key = 'site_footer_content'
     AND md5(value::text) = c_expected_md5;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'B1: expected 1 updated row, got %', v_count;
  END IF;

  -- 검증: 검사어가 0건이고 새 문구가 들어갔으며, 고친 두 경로 밖은 그대로다.
  SELECT value::text INTO v_text FROM public.system_settings WHERE key = 'site_footer_content';
  IF v_text ~ '(토스페이먼츠|페이코|일반결제|카카오페이머니만)' THEN
    RAISE EXCEPTION 'VERIFY: old payment wording remains';
  END IF;
  IF position(c_refund_pg_new IN v_text) = 0
     OR position('(주)유디아이디(페이앱)' IN v_text) = 0
     OR position('(주)카카오페이: 카카오페이 결제 승인' IN v_text) = 0
     OR position('휴대폰 결제는 결제한 달이 지나면' IN v_text) = 0 THEN
    RAISE EXCEPTION 'VERIFY: new payment wording missing';
  END IF;
  IF (SELECT value #- '{policyDocuments,refundPolicy,content}' #- '{policyDocuments,privacyPolicy,content}'
        FROM public.system_settings WHERE key = 'site_footer_content')
     IS DISTINCT FROM (v_value #- '{policyDocuments,refundPolicy,content}' #- '{policyDocuments,privacyPolicy,content}') THEN
    RAISE EXCEPTION 'VERIFY: unrelated footer content changed';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
