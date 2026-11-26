-- 11번 묶음 스크립트 A: 접는 동의(2판) 문구 키와 장바구니 결제 칸 문구 넣기(판은 1 그대로).
-- 근거: 계획 docs/plan-bundle11-checkout-simplify.md 4-2(초안)·5-6·10절 4단계. 마이그레이션이 아니다(적용 이력에 넣지 않는다).
-- 언제: 11번 마이그레이션 적용 뒤, 11번 코드 배포 전(옛 코드에 보이는 변화 없음 — 옛 코드는 새 키를 읽지 않는다). 다른 묶음 DB 단계와 다른 날 새벽.
-- 실행 전부터 끝까지 관리자 구매 고지·충전 문구 저장 금지(옛 코드의 자료 폼은 version 을 보지 않는다).
-- 실행 방식: 아래 상수를 채운 뒤 운영 SQL 편집기(postgres)에서 파일 전체를 한 번에 실행한다.
--   c_mode = 'apply'(NULL 이면 멈춤), c_market_policy_md5·c_point_policy_md5 = 실행 직전에 읽은 md5(value::text).
--   읽기: SELECT key, md5(value::text) FROM public.system_settings WHERE key IN ('market_purchase_policy', 'point_charge_policy');
-- 사전 검사: 네 함수가 11번 md5, 작업 기록 함수 그대로, 두 정책에 consentFormat 이 없음(있으면 멈춤 — 다시 적용 때는 이 스크립트를 건너뛴다), 정책 값 md5.
-- 하는 일: 4-2 키 + 잔액 부족 충전 안내·두 버튼 이름(cartInsufficientNotice·cartChargeButtonLabel·cartBalanceRecheckLabel, 지문과 무관) + consentFormat 1 + version +1. 1판 키(purchaseCompleteNotice 포함)는 그대로 둔다(상세 문장은 배포 뒤 관리자 화면에서 바꾼다).
-- VERIFY: build_checkout_consent_v2 가 두 정책 모두 NULL 아님(약관 문서가 보여야 함), 1판 키 글자 그대로, 장바구니 문구 규칙 통과.
-- 작업 기록: checkout_consent_keys_seed(이전 값 전체 before, 이후 값 after, bundle 'bundle11_consent_keys').
-- 잠금: 두 정책 행 잠금뿐(몇 밀리초).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $bundle11_consent_keys$
DECLARE
  c_mode constant text := NULL;
  -- 실행 직전에 읽은 정책 값 md5(md5(value::text)). 다르면 멈춘다.
  c_market_policy_md5 constant text := NULL;
  c_point_policy_md5 constant text := NULL;
  c_tag constant text := 'B11_KEYS';
  c_functions constant text[][] := ARRAY[
    ARRAY['public.record_purchase_notice_ack(uuid,uuid,text,text)', '9d2cb23a7aa16e45970525248bcc4435'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', '4b23fdf6b9c7bcf76e39ee5b7b1a629f'],
    ARRAY['public.build_checkout_consent_v2(text,jsonb,integer)', '3fd97051955741db213297804131c1e3'],
    ARRAY['public.build_market_cart_texts(jsonb)', '604251e0a0b5f85b58aaeccb0c593d05'],
    ARRAY['public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)', 'a42b474d9d95753ffba5041acb0c1c77']
  ];
  v_actor uuid;
  v_market jsonb;
  v_point jsonb;
  v_market_new jsonb;
  v_point_new jsonb;
  v_started constant timestamptz := clock_timestamp();
  i integer;
  -- 4-2 초안(대표 승인 2026-11-24, 충전 validity 는 12판 '쓸 수 없어요'). 최종 문구는 배포 뒤 관리자 화면에서 고친다.
  c_market_keys constant jsonb := $market_keys${
    "consentTitle": "주문 내용·구매 조건 확인 및 동의",
    "consentSummary": {
      "refundPeriod": "받지 않은 자료는 구매일 다음 날부터 {자료환불기간}일째 되는 날까지 자료 보관함이나 고객센터로 환불을 신청할 수 있어요.",
      "restriction": "다운로드한 자료는 단순 변심으로 환불되지 않아요. 자료 안의 파일을 하나라도 받으면 그 자료는 받은 것으로 보고, 문제(HWP)를 받으면 함께 든 문제(PDF)도 받은 것으로 봐요.",
      "note": "하자가 있거나 소개 내용과 다른 자료는 다운로드한 뒤에도 환불받을 수 있어요."
    },
    "consentItems": [
      {"key": "purchaseNotice", "label": "자료 환불 안내", "view": "text", "textKeys": ["confirmNotice"]},
      {"key": "usageScope", "label": "자료 이용 범위", "view": "text", "textKeys": ["usageScopeNotice"]},
      {"key": "refundPolicy", "label": "취소·환불정책", "view": "link", "link": "refundPolicy"},
      {"key": "terms", "label": "서비스 이용약관", "view": "link", "link": "serviceTerms"}
    ],
    "cartCheckoutNotice": "크레딧으로 선택한 자료를 한 번에 구매합니다. 하나라도 구매할 수 없으면 전체 구매가 취소됩니다.",
    "partialOwnedConfirmLabel": "이미 구매한 개별 자료가 포함된 전체 패키지는 기보유분 차감 없이 정가로 구매됨을 확인했습니다.",
    "cartInsufficientNotice": "보유 크레딧이 {부족크레딧} 크레딧 부족합니다. 충전한 뒤 결제해 주세요.",
    "cartChargeButtonLabel": "크레딧 충전하기",
    "cartBalanceRecheckLabel": "잔액 다시 확인"
  }$market_keys$;
  c_point_keys constant jsonb := $point_keys${
    "consentTitle": "주문 내용·충전 조건 확인 및 결제 동의",
    "consentSummary": {
      "refundPeriod": "이 충전 건의 크레딧을 하나도 쓰지 않았다면 결제일 다음 날부터 {충전환불기간}일째 되는 날까지 전액 환불을 신청할 수 있어요.",
      "restriction": "이 충전 건의 크레딧을 하나라도 쓰면 단순 변심으로는 취소할 수 없어요.",
      "validity": "충전한 크레딧은 결제한 때부터 {충전유효기간}년 동안 쓸 수 있고, 기간이 지나면 남은 크레딧은 쓸 수 없어요.",
      "minor": "미성년자가 법정대리인 동의 없이 결제했다면 본인이나 법정대리인이 결제를 취소할 수 있어요(예외 있음)."
    },
    "consentItems": [
      {"key": "product", "label": "충전 상품 안내", "view": "text", "textKeys": ["checkoutItems.product", "checkoutItems.validity"]},
      {"key": "refund", "label": "취소·환불 안내", "view": "text", "textKeys": ["checkoutItems.refund", "checkoutItems.restriction", "checkoutItems.otherCases"]},
      {"key": "minor", "label": "미성년자 결제 취소 안내", "view": "text", "textKeys": ["minorNotice"]},
      {"key": "refundPolicy", "label": "취소·환불정책", "view": "link", "link": "refundPolicy"},
      {"key": "terms", "label": "서비스 이용약관", "view": "link", "link": "serviceTerms"}
    ]
  }$point_keys$;
BEGIN
  IF c_mode IS DISTINCT FROM 'apply' THEN
    RAISE EXCEPTION '%: set c_mode to apply', c_tag;
  END IF;
  -- 네 함수가 11번 값, 작업 기록 함수가 그대로(계획 5-5·5-6)
  FOR i IN 1 .. array_length(c_functions, 1) LOOP
    IF to_regprocedure(c_functions[i][1]) IS NULL OR md5(pg_get_functiondef(to_regprocedure(c_functions[i][1]))) <> c_functions[i][2] THEN
      RAISE EXCEPTION '%: % is not the expected definition', c_tag, c_functions[i][1];
    END IF;
  END LOOP;
  IF to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION '%: 3-argument record_purchase_notice_ack exists (bundle 11 migration not applied)', c_tag;
  END IF;
  SELECT p.id INTO v_actor FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND u.last_sign_in_at IS NOT NULL
   ORDER BY u.last_sign_in_at DESC LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION '%: signed-in owner account not found', c_tag;
  END IF;

  -- 잠그는 순서: 자료 → 충전(행 잠금, 몇 밀리초)
  SELECT value INTO v_market FROM public.system_settings WHERE key = 'market_purchase_policy' FOR UPDATE;
  SELECT value INTO v_point FROM public.system_settings WHERE key = 'point_charge_policy' FOR UPDATE;
  IF v_market IS NULL OR v_point IS NULL OR jsonb_typeof(v_market -> 'version') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_point -> 'version') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION '%: policies missing', c_tag;
  END IF;
  IF md5(v_market::text) IS DISTINCT FROM c_market_policy_md5 OR md5(v_point::text) IS DISTINCT FROM c_point_policy_md5 THEN
    RAISE EXCEPTION '%: policy md5 differs (market %, point_charge %) — read again and stop admin saves', c_tag, md5(v_market::text), md5(v_point::text);
  END IF;
  IF (v_market ? 'consentFormat') OR (v_point ? 'consentFormat') THEN
    RAISE EXCEPTION '%: consentFormat already present — script A already ran (skip it when re-applying)', c_tag;
  END IF;

  v_market_new := v_market || c_market_keys || jsonb_build_object('consentFormat', 1, 'version', (v_market ->> 'version')::integer + 1);
  v_point_new := v_point || c_point_keys || jsonb_build_object('consentFormat', 1, 'version', (v_point ->> 'version')::integer + 1);
  UPDATE public.system_settings SET value = v_market_new, updated_at = now() WHERE key = 'market_purchase_policy';
  UPDATE public.system_settings SET value = v_point_new, updated_at = now() WHERE key = 'point_charge_policy';
  PERFORM public.record_admin_audit(v_actor, 'checkout_consent_keys_seed', 'system_settings', 'market_purchase_policy', NULL, NULL,
    '11번 접는 동의 문구 넣기(자료) — SQL 스크립트 supabase/scripts/20261216_bundle11_consent_keys.sql',
    jsonb_build_object('bundle', 'bundle11_consent_keys', 'before', v_market, 'after', v_market_new, 'saved_at', to_jsonb(clock_timestamp())), NULL);
  PERFORM public.record_admin_audit(v_actor, 'checkout_consent_keys_seed', 'system_settings', 'point_charge_policy', NULL, NULL,
    '11번 접는 동의 문구 넣기(충전) — SQL 스크립트 supabase/scripts/20261216_bundle11_consent_keys.sql',
    jsonb_build_object('bundle', 'bundle11_consent_keys', 'before', v_point, 'after', v_point_new, 'saved_at', to_jsonb(clock_timestamp())), NULL);

  -- VERIFY
  IF (SELECT value FROM public.system_settings WHERE key = 'market_purchase_policy') IS DISTINCT FROM v_market_new
     OR (SELECT value FROM public.system_settings WHERE key = 'point_charge_policy') IS DISTINCT FROM v_point_new THEN
    RAISE EXCEPTION 'VERIFY: policies not saved';
  END IF;
  -- 1판 키는 글자 그대로(더한 키와 version 만 다름)
  IF (v_market_new - ARRAY['consentTitle', 'consentSummary', 'consentItems', 'cartCheckoutNotice', 'partialOwnedConfirmLabel', 'cartInsufficientNotice',
                           'cartChargeButtonLabel', 'cartBalanceRecheckLabel',
                           'consentFormat', 'version'])
       IS DISTINCT FROM (v_market - 'version')
     OR (v_point_new - ARRAY['consentTitle', 'consentSummary', 'consentItems', 'consentFormat', 'version']) IS DISTINCT FROM (v_point - 'version')
     OR (v_market_new ->> 'purchaseCompleteNotice') IS DISTINCT FROM (v_market ->> 'purchaseCompleteNotice') THEN
    RAISE EXCEPTION 'VERIFY: version-1 keys changed';
  END IF;
  IF public.build_checkout_consent_v2('market', v_market_new, (v_market_new ->> 'refundDays')::integer) IS NULL
     OR public.build_checkout_consent_v2('point_charge', v_point_new, public.point_charge_refund_days()) IS NULL THEN
    RAISE EXCEPTION 'VERIFY: consent v2 builder returned NULL (check the drafts and that the policy documents are visible)';
  END IF;
  IF public.build_market_cart_texts(v_market_new) IS NULL THEN
    RAISE EXCEPTION 'VERIFY: cart texts rules';
  END IF;
  IF (SELECT count(*) FROM public.admin_audit_log WHERE action = 'checkout_consent_keys_seed' AND details ->> 'bundle' = 'bundle11_consent_keys'
       AND (details ->> 'saved_at')::timestamptz >= v_started) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: audit rows';
  END IF;
  RAISE NOTICE 'B11_KEYS OK: market version %, point_charge version %', v_market_new -> 'version', v_point_new -> 'version';
END;
$bundle11_consent_keys$;

COMMIT;

-- 확인 조회(읽기만): 판·편집 번호·정책 값 md5 와 이 스크립트의 마지막 기록
SELECT s.key, s.value -> 'consentFormat' AS consent_format, s.value -> 'version' AS version, md5(s.value::text) AS value_md5,
       (SELECT a.created_at FROM public.admin_audit_log a WHERE a.target_id = s.key AND a.details ->> 'bundle' = 'bundle11_consent_keys'
         ORDER BY (a.details ->> 'saved_at')::timestamptz DESC LIMIT 1) AS last_script_audit
  FROM public.system_settings s WHERE s.key IN ('market_purchase_policy', 'point_charge_policy') ORDER BY s.key;
