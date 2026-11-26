-- 11번 묶음 리허설: A light — 마이그레이션 사본(표 잠금 DDL 뺌)·스크립트 A·B·되돌림·down·다시 적용, 기록 함수는 같은 본문의 pg_temp 사본 + 임시 표(R0~R10)
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle11_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle11_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: 지금 돌려도 됨(CREATE/DROP FUNCTION·설정 행 잠금·임시 표뿐 — LOCK/ALTER TABLE·TRIGGER·POLICY 없음). 실제 표 칸·잠금은 새벽의 b_full 이 본다.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '180s';
CREATE TEMP TABLE _rh_log (n serial PRIMARY KEY, test text NOT NULL, msg text NOT NULL, payload jsonb) ON COMMIT DROP;
CREATE TEMP TABLE _rh_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.ctx_set(p_k text, p_v text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _rh_ctx (k, v) VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v
$f$;
CREATE FUNCTION pg_temp.ctx(p_k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM _rh_ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.fail(p_test text, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  RAISE EXCEPTION 'RH FAIL [%] %', p_test, left(p_msg, 850);
END $f$;
-- 동적 SQL 을 실행하고 'OK' 또는 'ERR 메시지'(앞 300자)를 돌려준다. 실패하면 그 문장의 변경은 되돌려진다.
CREATE FUNCTION pg_temp.try_sql(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300);
END $f$;
CREATE FUNCTION pg_temp.expect(p_actual text, p_prefix text, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_actual IS NULL OR p_actual NOT LIKE p_prefix || '%' THEN
    PERFORM pg_temp.fail(p_test, p_msg || ' — 기대 "' || p_prefix || '", 실제 "' || left(coalesce(p_actual, 'NULL'), 400) || '"');
  END IF;
  RETURN p_msg || ' → ' || left(p_actual, 120);
END $f$;
CREATE FUNCTION pg_temp.ensure(p_cond boolean, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_cond IS NOT TRUE THEN
    PERFORM pg_temp.fail(p_test, p_msg);
  END IF;
  RETURN p_msg;
END $f$;
CREATE FUNCTION pg_temp.subst_once(p_src text, p_from text, p_to text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_from = '' OR (length(p_src) - length(replace(p_src, p_from, ''))) / length(p_from) <> 1 THEN
    RAISE EXCEPTION 'RH FAIL copy line not found exactly once: %', left(p_from, 200);
  END IF;
  RETURN replace(p_src, p_from, p_to);
END $f$;
CREATE FUNCTION pg_temp.md5_of(p_sig text) RETURNS text LANGUAGE sql AS $f$
  SELECT CASE WHEN to_regprocedure(p_sig) IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(to_regprocedure(p_sig))) END
$f$;
CREATE FUNCTION pg_temp.policy(p_key text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT value FROM public.system_settings WHERE key = p_key $f$;
CREATE FUNCTION pg_temp.set_policy(p_key text, p_value jsonb) RETURNS void LANGUAGE sql AS $f$
  UPDATE public.system_settings SET value = p_value WHERE key = p_key
$f$;
-- 2판 묶음에서 원문을 다시 만든다(5-1 과 같은 줄 규칙) — 기록의 consent_details.consent 로 notice_sha256 을 다시 계산할 때 쓴다.
CREATE FUNCTION pg_temp.consent_text(p_consent jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT array_to_string(ARRAY[p_consent ->> 'consentTitle']
    || ARRAY(SELECT e.value #>> '{}' FROM jsonb_array_elements(p_consent -> 'consentSummary') WITH ORDINALITY e(value, n) ORDER BY e.n)
    || ARRAY(SELECT l FROM jsonb_array_elements(p_consent -> 'consentItems') WITH ORDINALITY i(value, n),
               LATERAL (SELECT i.value ->> 'label' AS l, 0 AS o
                        UNION ALL SELECT t.value #>> '{}', t.n FROM jsonb_array_elements(CASE WHEN i.value ->> 'view' = 'text' THEN i.value -> 'texts' ELSE '[]'::jsonb END) WITH ORDINALITY t(value, n)
                        UNION ALL SELECT '링크:' || (i.value ->> 'link'), 1 WHERE i.value ->> 'view' = 'link') x
              ORDER BY i.n, x.o), chr(10))
$f$;
CREATE FUNCTION pg_temp.sha(p_text text) RETURNS text LANGUAGE sql AS $f$ SELECT encode(sha256(convert_to(p_text, 'UTF8')), 'hex') $f$;
-- 기록 함수에 넘길 회원: @test.com 시험 계정만 쓴다(실회원 id 는 쓰지 않음). 없으면 멈춘다. 판매 중 충전 상품 하나, 탈퇴 회원 하나(없으면 NULL — 맨 앞 거절만 봄)
CREATE FUNCTION pg_temp.rh_user() RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_id uuid;
BEGIN
  SELECT p.id INTO v_id FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.withdrawn_at IS NULL AND u.email LIKE '%@test.com' ORDER BY u.created_at LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'RH FAIL [setup] @test.com 시험 계정이 없음 — 실회원 id 로 대신하지 않고 멈춘다';
  END IF;
  RETURN v_id;
END $f$;
CREATE FUNCTION pg_temp.rh_plan() RETURNS public.pricing_plans LANGUAGE sql AS $f$
  SELECT * FROM public.pricing_plans WHERE is_active ORDER BY price LIMIT 1
$f$;
CREATE FUNCTION pg_temp.rh_withdrawn_user() RETURNS uuid LANGUAGE sql AS $f$
  SELECT p.id FROM public.profiles p WHERE p.withdrawn_at IS NOT NULL LIMIT 1
$f$;

-- 스크립트 원본 DO 블록(생성기가 원본 파일에서 꺼낸 글 그대로)과 10번 down_b 사전 검사 블록
SELECT pg_temp.ctx_set('src_keys', $rh_src_keys$DO $bundle11_consent_keys$
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
$bundle11_consent_keys$;$rh_src_keys$);
SELECT pg_temp.ctx_set('src_format2', $rh_src_format2$DO $bundle11_consent_format_2$
DECLARE
  c_mode constant text := NULL;
  -- 실행 직전에 읽은 정책 값 md5(md5(value::text)). 다르면 멈춘다.
  c_market_policy_md5 constant text := NULL;
  c_point_policy_md5 constant text := NULL;
  c_tag constant text := 'B11_FORMAT_2';
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
  -- 지금 판이 1 이어야 한다(숫자 비교만)
  IF jsonb_typeof(v_market -> 'consentFormat') IS DISTINCT FROM 'number' OR (v_market ->> 'consentFormat')::numeric <> 1
     OR jsonb_typeof(v_point -> 'consentFormat') IS DISTINCT FROM 'number' OR (v_point ->> 'consentFormat')::numeric <> 1 THEN
    RAISE EXCEPTION '%: consentFormat must be 1 on both policies (market %, point_charge %)', c_tag, v_market -> 'consentFormat', v_point -> 'consentFormat';
  END IF;
  IF public.build_checkout_consent_v2('market', v_market, (v_market ->> 'refundDays')::integer) IS NULL
     OR public.build_checkout_consent_v2('point_charge', v_point, public.point_charge_refund_days()) IS NULL
     OR public.build_market_cart_texts(v_market) IS NULL THEN
    RAISE EXCEPTION '%: consent v2 builder returned NULL — fix the texts or policy documents first', c_tag;
  END IF;

  v_market_new := v_market || jsonb_build_object('consentFormat', 2, 'version', (v_market ->> 'version')::integer + 1);
  v_point_new := v_point || jsonb_build_object('consentFormat', 2, 'version', (v_point ->> 'version')::integer + 1);
  UPDATE public.system_settings SET value = v_market_new, updated_at = now() WHERE key = 'market_purchase_policy';
  UPDATE public.system_settings SET value = v_point_new, updated_at = now() WHERE key = 'point_charge_policy';
  PERFORM public.record_admin_audit(v_actor, 'checkout_consent_format_change', 'system_settings', 'market_purchase_policy', NULL, NULL,
    '11번 결제 동의 방식 1→2(자료) — SQL 스크립트 supabase/scripts/20261216_bundle11_consent_format_2.sql',
    jsonb_build_object('bundle', 'bundle11_consent_format_2', 'before', v_market, 'after', v_market_new, 'saved_at', to_jsonb(clock_timestamp())), NULL);
  PERFORM public.record_admin_audit(v_actor, 'checkout_consent_format_change', 'system_settings', 'point_charge_policy', NULL, NULL,
    '11번 결제 동의 방식 1→2(충전) — SQL 스크립트 supabase/scripts/20261216_bundle11_consent_format_2.sql',
    jsonb_build_object('bundle', 'bundle11_consent_format_2', 'before', v_point, 'after', v_point_new, 'saved_at', to_jsonb(clock_timestamp())), NULL);

  -- VERIFY: 판 2, 다른 키는 그대로
  IF (SELECT value FROM public.system_settings WHERE key = 'market_purchase_policy') IS DISTINCT FROM v_market_new
     OR (SELECT value FROM public.system_settings WHERE key = 'point_charge_policy') IS DISTINCT FROM v_point_new
     OR (v_market_new - ARRAY['consentFormat', 'version']) IS DISTINCT FROM (v_market - ARRAY['consentFormat', 'version'])
     OR (v_point_new - ARRAY['consentFormat', 'version']) IS DISTINCT FROM (v_point - ARRAY['consentFormat', 'version'])
     OR (v_market_new -> 'consentFormat') <> to_jsonb(2) OR (v_point_new -> 'consentFormat') <> to_jsonb(2) THEN
    RAISE EXCEPTION 'VERIFY: consentFormat 2';
  END IF;
  IF (SELECT count(*) FROM public.admin_audit_log WHERE action = 'checkout_consent_format_change' AND details ->> 'bundle' = 'bundle11_consent_format_2'
       AND (details ->> 'saved_at')::timestamptz >= v_started) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: audit rows';
  END IF;
  RAISE NOTICE 'B11_FORMAT_2 OK: consentFormat 2';
END;
$bundle11_consent_format_2$;$rh_src_format2$);
SELECT pg_temp.ctx_set('src_format1', $rh_src_format1$DO $bundle11_consent_format_1$
DECLARE
  c_mode constant text := NULL;
  -- 실행 직전에 읽은 정책 값 md5(md5(value::text)). 다르면 멈춘다.
  c_market_policy_md5 constant text := NULL;
  c_point_policy_md5 constant text := NULL;
  c_tag constant text := 'B11_FORMAT_1';
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
  -- 지금 판이 2 이어야 한다(숫자 비교만)
  IF jsonb_typeof(v_market -> 'consentFormat') IS DISTINCT FROM 'number' OR (v_market ->> 'consentFormat')::numeric <> 2
     OR jsonb_typeof(v_point -> 'consentFormat') IS DISTINCT FROM 'number' OR (v_point ->> 'consentFormat')::numeric <> 2 THEN
    RAISE EXCEPTION '%: consentFormat must be 2 on both policies (market %, point_charge %)', c_tag, v_market -> 'consentFormat', v_point -> 'consentFormat';
  END IF;

  v_market_new := v_market || jsonb_build_object('consentFormat', 1, 'version', (v_market ->> 'version')::integer + 1);
  v_point_new := v_point || jsonb_build_object('consentFormat', 1, 'version', (v_point ->> 'version')::integer + 1);
  UPDATE public.system_settings SET value = v_market_new, updated_at = now() WHERE key = 'market_purchase_policy';
  UPDATE public.system_settings SET value = v_point_new, updated_at = now() WHERE key = 'point_charge_policy';
  PERFORM public.record_admin_audit(v_actor, 'checkout_consent_format_change', 'system_settings', 'market_purchase_policy', NULL, NULL,
    '11번 결제 동의 방식 2→1(자료) — SQL 스크립트 supabase/scripts/20261216_bundle11_consent_format_1.sql',
    jsonb_build_object('bundle', 'bundle11_consent_format_1', 'before', v_market, 'after', v_market_new, 'saved_at', to_jsonb(clock_timestamp())), NULL);
  PERFORM public.record_admin_audit(v_actor, 'checkout_consent_format_change', 'system_settings', 'point_charge_policy', NULL, NULL,
    '11번 결제 동의 방식 2→1(충전) — SQL 스크립트 supabase/scripts/20261216_bundle11_consent_format_1.sql',
    jsonb_build_object('bundle', 'bundle11_consent_format_1', 'before', v_point, 'after', v_point_new, 'saved_at', to_jsonb(clock_timestamp())), NULL);

  -- VERIFY: 판 1, 다른 키는 그대로
  IF (SELECT value FROM public.system_settings WHERE key = 'market_purchase_policy') IS DISTINCT FROM v_market_new
     OR (SELECT value FROM public.system_settings WHERE key = 'point_charge_policy') IS DISTINCT FROM v_point_new
     OR (v_market_new - ARRAY['consentFormat', 'version']) IS DISTINCT FROM (v_market - ARRAY['consentFormat', 'version'])
     OR (v_point_new - ARRAY['consentFormat', 'version']) IS DISTINCT FROM (v_point - ARRAY['consentFormat', 'version'])
     OR (v_market_new -> 'consentFormat') <> to_jsonb(1) OR (v_point_new -> 'consentFormat') <> to_jsonb(1) THEN
    RAISE EXCEPTION 'VERIFY: consentFormat 1';
  END IF;
  IF (SELECT count(*) FROM public.admin_audit_log WHERE action = 'checkout_consent_format_change' AND details ->> 'bundle' = 'bundle11_consent_format_1'
       AND (details ->> 'saved_at')::timestamptz >= v_started) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: audit rows';
  END IF;
  RAISE NOTICE 'B11_FORMAT_1 OK: consentFormat 1';
END;
$bundle11_consent_format_1$;$rh_src_format1$);
SELECT pg_temp.ctx_set('src_down_b_precheck', $rh_src_down_b$DO $down_b_precheck$
DECLARE
  v_new text[][] := ARRAY[
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '657bbb07ae4b250a2697f21e2aa805e9'],
    ARRAY['public.apply_payapp_feedback(text,text,text,text,integer,integer,integer,integer,timestamp with time zone,timestamp with time zone)', '1859412411fc132dacfae4ca7a89eba4'],
    ARRAY['public.retry_payapp_fulfillment(uuid)', '93cde859327328f598e71059dcc04e6d'],
    ARRAY['public.resolve_payment_order_review(uuid,text,uuid,text,text,timestamp with time zone,text)', 'cbe116d85e140991d5993b5563296b37'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '93e0bd5e41969f66f296f4353f3feeb9'],
    ARRAY['public.begin_payapp_request(uuid)', '679b4474c0dc42de11e5e9a14a7d1d4d'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', 'be4403fd993c45d618950a5908a91591'],
    ARRAY['public.process_payapp_cancellation(uuid)', 'e0f752c7759626790a2afb86eab6aee6'],
    ARRAY['public.payapp_sales_resume_blockers()', 'edbb1eb553719198ffa9f9bc0d3aca4c'],
    ARRAY['public.enforce_payment_reconciliation_health()', 'e563ade9c072b09e26844b655e918755'],
    ARRAY['public.prevent_payment_order_snapshot_update()', '940bcad422d63c58e5d31c5756b0d473'],
    ARRAY['public.consent_record_internal(uuid,jsonb,text)', '61a9beb9d7f94cf6b0ed9b4518b52b44'],
    ARRAY['public.guard_user_consents_mutation()', '4ba21dab0a28e0c117bbead375a3fc8f'],
    ARRAY['public.guard_market_purchase_notice_acks_mutation()', '3959ac2b8139d0f81365df59ed67ef10'],
    ARRAY['public.prevent_admin_event_mutation()', 'f35f60e1461e49138635ffd4a11a27f9'],
    ARRAY['public.remind_unanswered_admin_work()', 'b950b1bfecc0ed4d470293508c0e2a60'],
    ARRAY['public.guard_support_ticket_revisions_mutation()', '1a8d96fc0bfe469e491b86c2f866e3bd'],
    ARRAY['public.cancel_incomplete_kakao_signup(uuid)', 'a83431d12c4686a0fbe57976a82038fe'],
    ARRAY['public.complete_kakao_signup_with_consents(uuid,jsonb,text,text,text,text)', 'a43e805089f08a12e22721168dbe962a'],
    ARRAY['public.consent_eligible_member_count()', '4b1c6999080f9bf6978be808997fd9ac']
  ];
  i integer;
BEGIN
  FOR i IN 1 .. array_length(v_new, 1) LOOP
    IF md5(pg_get_functiondef(v_new[i][1]::regprocedure)) <> v_new[i][2] THEN
      RAISE EXCEPTION 'DOWN_B_BLOCKED: % is not the bundle 10 definition', v_new[i][1];
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.withdrawn_member_records) THEN
    RAISE EXCEPTION 'DOWN_B_BLOCKED: withdrawn member records exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.member_withdrawal_requests) THEN
    RAISE EXCEPTION 'DOWN_B_BLOCKED: withdrawal requests exist';
  END IF;
END;
$down_b_precheck$;$rh_src_down_b$);
SELECT pg_temp.ctx_set('src_down', $rh_src_down$-- 11번 묶음 되돌리기(supabase/migrations/20261216100000_checkout_consent_v2.sql 의 down). 계획 docs/plan-bundle11-checkout-simplify.md 5-5·10절.
-- 하는 일: 두 기록 함수를 바탕 정의(10번 운영 값, md5 fa6a7edd…·be4403fd…)로 되돌리고(4인자를 지우고 3인자·GRANT 를 되돌림),
--   새 내부 함수 build_checkout_consent_v2·build_market_cart_texts 를 지운다. 칸(consent_format·consent_details·문서 지문)은 지우지 않는다
--   (증빙, 옛 함수에 해 없음 — 옛 함수의 INSERT 는 새 칸을 적지 않아 기본값 1·NULL 이 들어간다).
-- 순서(10절 되돌리기): ① 되돌림 스크립트(판 1) → ② 장바구니·충전이 1판인지 확인 → ③ 11번 커밋만 revert 배포 → ④ 이 파일(③ 뒤에만).
--   새 코드인 채 이 파일을 돌리면 자료는 4인자 함수가 없어, 충전은 consentFormat 키가 없어 503 으로 닫힌다(막히는 쪽).
--   10번을 되돌려야 하면 이 파일을 먼저 돌린다(10번 _down_b 는 충전 함수가 10번 값일 때만 돈다).
-- 사전 검사: 네 함수가 11번 값일 때만 진행한다. 이 파일은 이력 행을 지우지 않는다. 다시 적용하려면 같은 거래에서 schema_migrations 의
--   '20261216100000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다(15번 down 머리말과 같은 방법 — 이력이 남은 채 db push 하면 건너뛴다).
-- 잠금: 함수만 바꾼다(표 잠금 없음). 그래도 실회원이 적은 새벽에 돌린다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $precheck_checkout_consent_v2_down$
DECLARE
  v_pairs text[][] := ARRAY[
    ARRAY['public.record_purchase_notice_ack(uuid,uuid,text,text)', '9d2cb23a7aa16e45970525248bcc4435'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', '4b23fdf6b9c7bcf76e39ee5b7b1a629f'],
    ARRAY['public.build_checkout_consent_v2(text,jsonb,integer)', '3fd97051955741db213297804131c1e3'],
    ARRAY['public.build_market_cart_texts(jsonb)', '604251e0a0b5f85b58aaeccb0c593d05']
  ];
  i integer;
BEGIN
  IF to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: 3-argument record_purchase_notice_ack already exists (not the bundle 11 state)';
  END IF;
  FOR i IN 1 .. array_length(v_pairs, 1) LOOP
    IF to_regprocedure(v_pairs[i][1]) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_pairs[i][1]))) <> v_pairs[i][2] THEN
      RAISE EXCEPTION 'DOWN PRECHECK: % is not the bundle 11 definition (%)', v_pairs[i][1],
        CASE WHEN to_regprocedure(v_pairs[i][1]) IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(to_regprocedure(v_pairs[i][1]))) END;
    END IF;
  END LOOP;
END;
$precheck_checkout_consent_v2_down$;

-- [11번] 시작: 바탕 정의로 되돌림 ----------------------------------------------------------------------------------
DROP FUNCTION public.record_purchase_notice_ack(uuid, uuid, text, text);
CREATE OR REPLACE FUNCTION public.record_purchase_notice_ack(p_user_id uuid, p_idempotency_key uuid, p_notice_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing_sha text;
  v_value jsonb;
  v_days_numeric numeric;
  v_days integer;
  v_label text;
  v_notice text;
  v_text text;
  v_sha text;
  v_inserted_id uuid;
  v_details jsonb;
BEGIN
  -- ① 입력 검사
  IF p_user_id IS NULL OR p_idempotency_key IS NULL OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID');
  END IF;

  -- ② 같은 키로 이미 기록했고 지문이 같으면 그대로 통과(402 뒤 다시 누르기, 503 뒤 재시도)
  SELECT a.notice_sha256 INTO v_existing_sha
    FROM public.market_purchase_notice_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  IF FOUND AND v_existing_sha = p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', true, 'replay', true);
  END IF;

  -- ③ 지금 정책: refundDays 는 숫자·정수·양수, 두 문구는 비어 있지 않은 글자
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'market_purchase_policy';
  IF v_value IS NULL OR jsonb_typeof(v_value) <> 'object'
     OR jsonb_typeof(v_value -> 'refundDays') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v_value -> 'checkboxLabel') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_value -> 'confirmNotice') IS DISTINCT FROM 'string' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
  END IF;
  v_days_numeric := (v_value ->> 'refundDays')::numeric;
  IF v_days_numeric <> trunc(v_days_numeric) OR v_days_numeric <= 0 OR v_days_numeric > 3650 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
  END IF;
  v_days := v_days_numeric::integer;
  v_label := replace(v_value ->> 'checkboxLabel', '{자료환불기간}', v_days::text);
  v_notice := replace(v_value ->> 'confirmNotice', '{자료환불기간}', v_days::text);
  IF btrim(v_label) = '' OR btrim(v_notice) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
  END IF;
  v_text := v_label || chr(10) || v_notice;
  v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
  v_details := jsonb_build_object('checkboxLabel', v_label, 'confirmNotice', v_notice, 'noticeSha256', v_sha, 'refundDays', v_days);

  -- ④ 같은 키를 다른 화면(지문)으로 다시 쓰면 거절 — 화면은 새 키를 만든다
  IF v_existing_sha IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details);
  END IF;

  -- ⑤ 화면에 보인 문구가 지금 문구와 다르면 거절
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details);
  END IF;

  -- ⑥ 기록
  INSERT INTO public.market_purchase_notice_acks (user_id, idempotency_key, notice_sha256, notice_text, refund_days)
  VALUES (p_user_id, p_idempotency_key, v_sha, v_text, v_days)
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted_id;
  IF v_inserted_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false);
  END IF;

  SELECT a.notice_sha256 INTO v_existing_sha
    FROM public.market_purchase_notice_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  IF v_existing_sha = p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', true, 'replay', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_purchase_notice_ack(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_purchase_notice_ack(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_point_charge_checkout_ack(p_user_id uuid, p_checkout_attempt_id uuid, p_plan_id uuid, p_expected_amount integer, p_expected_credits integer, p_notice_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing public.point_charge_checkout_acks%ROWTYPE;
  v_value jsonb;
  v_items jsonb;
  v_days integer;
  v_parts text[];
  v_part text;
  v_key text;
  v_text text;
  v_sha text;
  v_plan public.pricing_plans%ROWTYPE;
  v_details jsonb;
  v_policy_sha text;
  v_inserted uuid;
BEGIN
  IF p_user_id IS NULL OR p_checkout_attempt_id IS NULL OR p_plan_id IS NULL OR p_expected_amount IS NULL OR p_expected_credits IS NULL
     OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID');
  END IF;
  -- [10번] 시작
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.withdrawn_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MEMBER_WITHDRAWN');
  END IF;
  -- [10번] 끝

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;

  -- 지금 정책(필수 키·자리표시 규칙 — TS 저장 검사와 같음)
  v_days := public.point_charge_refund_days();
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'point_charge_policy';
  v_items := v_value -> 'checkoutItems';
  IF v_days IS NULL OR jsonb_typeof(v_items) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
  END IF;
  v_parts := ARRAY[v_value ->> 'checkoutTitle', v_items ->> 'product', v_items ->> 'validity', v_items ->> 'refund',
                   v_items ->> 'restriction', v_items ->> 'otherCases', v_value ->> 'minorNotice', v_value ->> 'agreeLabel'];
  FOREACH v_part IN ARRAY v_parts LOOP
    IF v_part IS NULL OR v_part !~ '\S' OR replace(v_part, '{충전환불기간}', '') ~ '[{}]' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
    END IF;
  END LOOP;
  IF strpos(v_items ->> 'refund', '{충전환불기간}') = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
  END IF;
  v_text := array_to_string(ARRAY(SELECT replace(x, '{충전환불기간}', v_days::text) FROM unnest(v_parts) WITH ORDINALITY AS t(x, n) ORDER BY n), chr(10));
  v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');

  SELECT * INTO v_plan FROM public.pricing_plans p WHERE p.id = p_plan_id;
  v_details := jsonb_build_object(
    'checkoutTitle', replace(v_value ->> 'checkoutTitle', '{충전환불기간}', v_days::text),
    'checkoutItems', jsonb_build_object(
      'product', replace(v_items ->> 'product', '{충전환불기간}', v_days::text),
      'validity', replace(v_items ->> 'validity', '{충전환불기간}', v_days::text),
      'refund', replace(v_items ->> 'refund', '{충전환불기간}', v_days::text),
      'restriction', replace(v_items ->> 'restriction', '{충전환불기간}', v_days::text),
      'otherCases', replace(v_items ->> 'otherCases', '{충전환불기간}', v_days::text)),
    'minorNotice', replace(v_value ->> 'minorNotice', '{충전환불기간}', v_days::text),
    'agreeLabel', replace(v_value ->> 'agreeLabel', '{충전환불기간}', v_days::text),
    'noticeSha256', v_sha, 'refundDays', v_days,
    'plan', CASE WHEN v_plan.id IS NULL THEN NULL ELSE jsonb_build_object('price', v_plan.price, 'credits', v_plan.credits) END);

  IF v_plan.id IS NULL OR NOT v_plan.is_active THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_UNAVAILABLE', 'details', v_details);
  END IF;
  IF v_plan.price <> p_expected_amount OR v_plan.credits <> p_expected_credits THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_CHANGED', 'details', v_details);
  END IF;
  -- 같은 시도의 재요청: 요금제가 그대로일 때만(위 검사 뒤) 같은 기록으로 본다.
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
       AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
      RETURN jsonb_build_object('ok', true, 'replay', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details);
  END IF;
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details);
  END IF;

  SELECT s.content_sha256 INTO v_policy_sha FROM public.policy_document_snapshots s
   WHERE s.doc_key = 'refundPolicy' ORDER BY s.seq DESC LIMIT 1;

  INSERT INTO public.point_charge_checkout_acks (user_id, checkout_attempt_id, plan_id, plan_name, amount, credits, refund_days,
                                                 notice_text, notice_sha256, refund_policy_sha256)
  VALUES (p_user_id, p_checkout_attempt_id, v_plan.id, v_plan.name, v_plan.price, v_plan.credits, v_days, v_text, v_sha, v_policy_sha)
  ON CONFLICT (user_id, checkout_attempt_id) DO NOTHING
  RETURNING id INTO v_inserted;
  IF v_inserted IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false);
  END IF;

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;
  IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
     AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
    RETURN jsonb_build_object('ok', true, 'replay', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_point_charge_checkout_ack(uuid, uuid, uuid, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_point_charge_checkout_ack(uuid, uuid, uuid, integer, integer, text) TO service_role;

DROP FUNCTION public.build_checkout_consent_v2(text, jsonb, integer);
DROP FUNCTION public.build_market_cart_texts(jsonb);
-- [11번] 끝 --------------------------------------------------------------------------------------------------------

DO $verify_checkout_consent_v2_down$
DECLARE
  v_sig text;
BEGIN
  IF to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text,text)') IS NOT NULL
     OR to_regprocedure('public.build_checkout_consent_v2(text,jsonb,integer)') IS NOT NULL
     OR to_regprocedure('public.build_market_cart_texts(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'DOWN VERIFY: bundle 11 functions remain';
  END IF;
  IF md5(pg_get_functiondef('public.record_purchase_notice_ack(uuid,uuid,text)'::regprocedure)) <> 'fa6a7edd836f21422d52dd184afb079b'
     OR md5(pg_get_functiondef('public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)'::regprocedure)) <> 'be4403fd993c45d618950a5908a91591' THEN
    RAISE EXCEPTION 'DOWN VERIFY: base md5';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY['public.record_purchase_notice_ack(uuid,uuid,text)', 'public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)'] LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = v_sig::regprocedure) IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
       OR has_function_privilege('anon', v_sig, 'EXECUTE') OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'DOWN VERIFY: % ACL', v_sig;
    END IF;
  END LOOP;
  -- 칸은 남는다
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
       AND ((table_name = 'market_purchase_notice_acks' AND column_name IN ('refund_policy_sha256', 'terms_policy_sha256', 'consent_format', 'consent_details'))
         OR (table_name = 'point_charge_checkout_acks' AND column_name IN ('terms_policy_sha256', 'consent_format', 'consent_details')))) < 0 THEN
    RAISE EXCEPTION 'DOWN VERIFY: consent columns must stay';
  END IF;
END;
$verify_checkout_consent_v2_down$;

NOTIFY pgrst, 'reload schema';
$rh_src_down$);
SELECT pg_temp.ctx_set('src_bundle9_point', $rh_src_b9$CREATE OR REPLACE FUNCTION public.record_point_charge_checkout_ack(p_user_id uuid, p_checkout_attempt_id uuid, p_plan_id uuid,
                                                                    p_expected_amount integer, p_expected_credits integer, p_notice_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_rpcca$
DECLARE
  v_existing public.point_charge_checkout_acks%ROWTYPE;
  v_value jsonb;
  v_items jsonb;
  v_days integer;
  v_parts text[];
  v_part text;
  v_key text;
  v_text text;
  v_sha text;
  v_plan public.pricing_plans%ROWTYPE;
  v_details jsonb;
  v_policy_sha text;
  v_inserted uuid;
BEGIN
  IF p_user_id IS NULL OR p_checkout_attempt_id IS NULL OR p_plan_id IS NULL OR p_expected_amount IS NULL OR p_expected_credits IS NULL
     OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID');
  END IF;

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;

  -- 지금 정책(필수 키·자리표시 규칙 — TS 저장 검사와 같음)
  v_days := public.point_charge_refund_days();
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'point_charge_policy';
  v_items := v_value -> 'checkoutItems';
  IF v_days IS NULL OR jsonb_typeof(v_items) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
  END IF;
  v_parts := ARRAY[v_value ->> 'checkoutTitle', v_items ->> 'product', v_items ->> 'validity', v_items ->> 'refund',
                   v_items ->> 'restriction', v_items ->> 'otherCases', v_value ->> 'minorNotice', v_value ->> 'agreeLabel'];
  FOREACH v_part IN ARRAY v_parts LOOP
    IF v_part IS NULL OR v_part !~ '\S' OR replace(v_part, '{충전환불기간}', '') ~ '[{}]' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
    END IF;
  END LOOP;
  IF strpos(v_items ->> 'refund', '{충전환불기간}') = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE');
  END IF;
  v_text := array_to_string(ARRAY(SELECT replace(x, '{충전환불기간}', v_days::text) FROM unnest(v_parts) WITH ORDINALITY AS t(x, n) ORDER BY n), chr(10));
  v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');

  SELECT * INTO v_plan FROM public.pricing_plans p WHERE p.id = p_plan_id;
  v_details := jsonb_build_object(
    'checkoutTitle', replace(v_value ->> 'checkoutTitle', '{충전환불기간}', v_days::text),
    'checkoutItems', jsonb_build_object(
      'product', replace(v_items ->> 'product', '{충전환불기간}', v_days::text),
      'validity', replace(v_items ->> 'validity', '{충전환불기간}', v_days::text),
      'refund', replace(v_items ->> 'refund', '{충전환불기간}', v_days::text),
      'restriction', replace(v_items ->> 'restriction', '{충전환불기간}', v_days::text),
      'otherCases', replace(v_items ->> 'otherCases', '{충전환불기간}', v_days::text)),
    'minorNotice', replace(v_value ->> 'minorNotice', '{충전환불기간}', v_days::text),
    'agreeLabel', replace(v_value ->> 'agreeLabel', '{충전환불기간}', v_days::text),
    'noticeSha256', v_sha, 'refundDays', v_days,
    'plan', CASE WHEN v_plan.id IS NULL THEN NULL ELSE jsonb_build_object('price', v_plan.price, 'credits', v_plan.credits) END);

  IF v_plan.id IS NULL OR NOT v_plan.is_active THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_UNAVAILABLE', 'details', v_details);
  END IF;
  IF v_plan.price <> p_expected_amount OR v_plan.credits <> p_expected_credits THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_CHANGED', 'details', v_details);
  END IF;
  -- 같은 시도의 재요청: 요금제가 그대로일 때만(위 검사 뒤) 같은 기록으로 본다.
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
       AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
      RETURN jsonb_build_object('ok', true, 'replay', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details);
  END IF;
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details);
  END IF;

  SELECT s.content_sha256 INTO v_policy_sha FROM public.policy_document_snapshots s
   WHERE s.doc_key = 'refundPolicy' ORDER BY s.seq DESC LIMIT 1;

  INSERT INTO public.point_charge_checkout_acks (user_id, checkout_attempt_id, plan_id, plan_name, amount, credits, refund_days,
                                                 notice_text, notice_sha256, refund_policy_sha256)
  VALUES (p_user_id, p_checkout_attempt_id, v_plan.id, v_plan.name, v_plan.price, v_plan.credits, v_days, v_text, v_sha, v_policy_sha)
  ON CONFLICT (user_id, checkout_attempt_id) DO NOTHING
  RETURNING id INTO v_inserted;
  IF v_inserted IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false);
  END IF;

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;
  IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
     AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
    RETURN jsonb_build_object('ok', true, 'replay', true);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details);
END;
$fn_rpcca$;$rh_src_b9$);

-- 스크립트 사본: 바꾸는 줄은 SCRIPT_LINES 세 줄뿐. p_md5: NULL 이면 지금 정책 값 md5(실행 직전에 읽은 값), 아니면 그 글자(틀린 md5 경우).
CREATE FUNCTION pg_temp.script_sql(p_which text, p_mode text DEFAULT 'apply', p_md5 text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v text := pg_temp.ctx('src_' || p_which);
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'RH FAIL unknown script %', p_which;
  END IF;
  v := pg_temp.subst_once(v, '  c_mode constant text := NULL;', '  c_mode constant text := ' || quote_nullable(p_mode) || ';');
  v := pg_temp.subst_once(v, '  c_market_policy_md5 constant text := NULL;', '  c_market_policy_md5 constant text := '
    || coalesce(quote_literal(p_md5), quote_literal(md5(pg_temp.policy('market_purchase_policy')::text))) || ';');
  v := pg_temp.subst_once(v, '  c_point_policy_md5 constant text := NULL;', '  c_point_policy_md5 constant text := '
    || coalesce(quote_literal(p_md5), quote_literal(md5(pg_temp.policy('point_charge_policy')::text))) || ';');
  RETURN v;
END $f$;

-- ===== 마이그레이션 전: 옛 함수(10번) 거절 응답 담기 + down 사전 검사는 11번 전 상태에서 멈춰야 함(R6) =====
DO $rh_capture$
DECLARE
  v_user uuid := pg_temp.rh_user();
  v_plan public.pricing_plans := pg_temp.rh_plan();
  v_r jsonb;
BEGIN
  IF v_user IS NULL OR v_plan.id IS NULL THEN
    PERFORM pg_temp.fail('R0', '회원 또는 판매 중 충전 상품이 없음');
  END IF;
  IF pg_temp.md5_of('public.record_purchase_notice_ack(uuid,uuid,text)') <> 'fa6a7edd836f21422d52dd184afb079b'
     OR pg_temp.md5_of('public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)') <> 'be4403fd993c45d618950a5908a91591' THEN
    PERFORM pg_temp.fail('R0', '마이그레이션 전 함수가 10번 값이 아님');
  END IF;
  v_r := public.record_purchase_notice_ack(v_user, gen_random_uuid(), repeat('0', 64));
  PERFORM pg_temp.ensure(v_r ->> 'code' = 'NOTICE_CHANGED', 'R0', '옛 자료 함수 거절');
  PERFORM pg_temp.ctx_set('old_market_changed', v_r::text);
  v_r := public.record_point_charge_checkout_ack(v_user, gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, repeat('0', 64));
  PERFORM pg_temp.ensure(v_r ->> 'code' = 'NOTICE_CHANGED', 'R0', '옛 충전 함수 NOTICE_CHANGED');
  PERFORM pg_temp.ctx_set('old_point_changed', v_r::text);
  v_r := public.record_point_charge_checkout_ack(v_user, gen_random_uuid(), v_plan.id, v_plan.price + 1, v_plan.credits, repeat('0', 64));
  PERFORM pg_temp.ensure(v_r ->> 'code' = 'PLAN_CHANGED', 'R0', '옛 충전 함수 PLAN_CHANGED');
  PERFORM pg_temp.ctx_set('old_point_plan_changed', v_r::text);
  PERFORM pg_temp.ctx_set('market_v1_sha', (pg_temp.ctx('old_market_changed')::jsonb) #>> '{details,noticeSha256}');
  PERFORM pg_temp.ctx_set('point_v1_sha', (pg_temp.ctx('old_point_changed')::jsonb) #>> '{details,noticeSha256}');
  INSERT INTO _rh_log (test, msg) VALUES ('R0', '옛 함수 거절 응답 담음(기록 없음)');
END
$rh_capture$;

DO $rh_r6_down_before$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
BEGIN
  BEGIN

    v_r := pg_temp.try_sql(pg_temp.ctx('src_down'));
    v_log := v_log || pg_temp.expect(v_r, 'ERR DOWN PRECHECK', 'R6', '11번 전 상태에서 down 사전 검사 멈춤');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R6', m FROM unnest(v_log) m;
END
$rh_r6_down_before$;

DO $rh_r8_bundle9$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
BEGIN
  BEGIN

    EXECUTE pg_temp.ctx('src_bundle9_point');
    v_log := v_log || pg_temp.ensure(pg_temp.md5_of('public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)') = '0047854ac79ddae6fba6dde114fb575d',
      'R8', '충전 함수를 10번 전 정의(0047854a…)로 바꿈');
    v_r := pg_temp.try_sql($rh_r8_copy$-- 출시 전 작업 순서표 11번 묶음: 결제 화면 단순화 — 동의 2판(접는 동의)(계획 docs/plan-bundle11-checkout-simplify.md 13판 5절).
-- 만드는 것:
--   1. 칸: market_purchase_notice_acks(refund_policy_sha256·terms_policy_sha256·consent_format·consent_details),
--      point_charge_checkout_acks(terms_policy_sha256·consent_format·consent_details). 칸은 down 이 지우지 않는다(증빙).
--      consent_format 은 상수 기본값 1 이라 표를 다시 쓰지 않고, 추가 전용 가드 트리거와 부딪치지 않는다.
--   2. 내부 함수(ACL postgres 만): build_market_cart_texts(장바구니 문구 검사·지문), build_checkout_consent_v2(2판 문구 검사·링크 문서 검사·원문·묶음).
--      둘 다 판(consentFormat)을 보지 않는다. TS(src/lib/checkout-consent.ts)와 같은 규칙이다.
--   3. 재정의: record_purchase_notice_ack 3인자 → 4인자(p_cart_texts_sha256 DEFAULT NULL — 옛 코드의 이름 인자 3개 호출은 기본값으로 맞음),
--      record_point_charge_checkout_ack(6인자 그대로). 판 분기, 2판 기록 칸, 장바구니 문구 대조, 모든 응답에 consentFormat 키.
-- 정책에 consentFormat 이 없으면(스크립트 A 전) 1판 그대로라 화면·기록 변화가 없다(옛 코드 호출은 cartTexts null 로 기록).
-- 함수 지문은 md5(pg_get_functiondef(oid)) — 9·10번과 같은 측정. 사전 값이 다르면 멈춘다.
-- 잠금: 두 기록 표에 ACCESS EXCLUSIVE(칸 추가 — 거래 끝까지 읽기도 막음). 새벽에 짧게 적용하고, 잡지 못하면(lock_timeout 3초) 전체가 취소된다.
-- 다시 적용: down 없이 같은 파일을 다시 실행해도 멈추지 않는다(사전 검사가 이 파일의 새 값도 받음). 이력을 다시 넣으려면 10번 머리말과 같이
--   같은 거래에서 schema_migrations 의 '20261216100000' 행을 지운 뒤 이 파일과 이력 INSERT 를 넣는다.
-- 되돌리기: supabase/rollback/20261216100000_checkout_consent_v2_down.sql(코드를 11번 전으로 되돌린 뒤에만, 10절 되돌리기 순서).
--   10번을 되돌려야 하면 이 down 을 먼저 한다(10번 _down_b 는 충전 함수가 10번 값일 때만 돈다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- 잠그는 순서: 자료 동의 기록 → 충전 동의 기록(교착 방지).

-- 0. 사전 점검 -------------------------------------------------------------------------------------------------
DO $precheck_checkout_consent_v2$
DECLARE
  -- 바꾸는 함수: {서명, 바탕 값(없으면 ''), 이 파일의 새 값}
  v_changed text[][] := ARRAY[
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', 'be4403fd993c45d618950a5908a91591', '4b23fdf6b9c7bcf76e39ee5b7b1a629f'],
    ARRAY['public.build_checkout_consent_v2(text,jsonb,integer)', '', '3fd97051955741db213297804131c1e3'],
    ARRAY['public.build_market_cart_texts(jsonb)', '', '604251e0a0b5f85b58aaeccb0c593d05']
  ];
  -- 그대로여야 함(계획 5-5, 2026-11-26 운영 값)
  v_same text[][] := ARRAY[
    ARRAY['public.checkout_market_selection(uuid,text,uuid,jsonb,uuid)', '0cda5ff7689d998cc6cf2fd213b0004d'],
    ARRAY['public.get_point_charge_refund_eligibility(uuid,uuid)', '60fc28afe44e7be776c189265e87b6ec'],
    ARRAY['public.point_charge_refund_days()', '7ab4d40c1634ade20de86517fa13cd40'],
    ARRAY['public.guard_point_charge_checkout_acks_mutation()', 'c7ef25308c6c0aa2920991965fb87ab0'],
    ARRAY['public.guard_market_purchase_notice_acks_mutation()', '3959ac2b8139d0f81365df59ed67ef10'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '93e0bd5e41969f66f296f4353f3feeb9'],
    ARRAY['public.begin_payapp_request(uuid)', '679b4474c0dc42de11e5e9a14a7d1d4d'],
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '657bbb07ae4b250a2697f21e2aa805e9'],
    ARRAY['public.market_purchase_refund_days()', '5d4030e7bedbace6189cefed80c3d27b'],
    ARRAY['public.record_policy_document_snapshots()', '4ffeca80346467f928c0a6f50b69018d'],
    ARRAY['public.prevent_policy_document_snapshot_mutation()', 'b1449554c094a90be7a6c864f367fdf8'],
    ARRAY['public.member_withdrawal_facts(uuid,boolean)', 'a7674770964dac2fe5c9179b8403c3b4'],
    ARRAY['public.get_member_withdrawal_preview(uuid,boolean)', '3a2e2c2f6eb6ecb15defe0879c88e0fc'],
    ARRAY['public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)', '1346d870d3623abae580a011b0484339']
  ];
  v_old regprocedure := to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)');
  v_new regprocedure := to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text,text)');
  v_md5 text;
  i integer;
BEGIN
  -- 자료 기록 함수: 3인자(바탕 값)나 4인자(이 파일 값) 중 정확히 하나만 있어야 한다.
  IF (v_old IS NULL) = (v_new IS NULL) THEN
    RAISE EXCEPTION 'PRECHECK: record_purchase_notice_ack must exist with exactly one of 3/4 arguments';
  END IF;
  IF v_old IS NOT NULL AND md5(pg_get_functiondef(v_old)) <> 'fa6a7edd836f21422d52dd184afb079b' THEN
    RAISE EXCEPTION 'PRECHECK: record_purchase_notice_ack(uuid,uuid,text) changed (%)', md5(pg_get_functiondef(v_old));
  END IF;
  IF v_new IS NOT NULL AND md5(pg_get_functiondef(v_new)) <> '9d2cb23a7aa16e45970525248bcc4435' THEN
    RAISE EXCEPTION 'PRECHECK: record_purchase_notice_ack(uuid,uuid,text,text) changed (%)', md5(pg_get_functiondef(v_new));
  END IF;
  FOR i IN 1 .. array_length(v_changed, 1) LOOP
    IF to_regprocedure(v_changed[i][1]) IS NULL THEN
      IF v_changed[i][2] <> '' THEN
        RAISE EXCEPTION 'PRECHECK: % missing', v_changed[i][1];
      END IF;
      CONTINUE;
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(v_changed[i][1])));
    IF v_md5 IS DISTINCT FROM v_changed[i][2] AND v_md5 IS DISTINCT FROM v_changed[i][3] THEN
      RAISE EXCEPTION 'PRECHECK: % changed (%)', v_changed[i][1], v_md5;
    END IF;
  END LOOP;
  FOR i IN 1 .. array_length(v_same, 1) LOOP
    IF to_regprocedure(v_same[i][1]) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) <> v_same[i][2] THEN
      RAISE EXCEPTION 'PRECHECK: % changed (%)', v_same[i][1], md5(pg_get_functiondef(to_regprocedure(v_same[i][1])));
    END IF;
  END LOOP;
  IF to_regclass('public.policy_document_snapshots') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'site_footer_content') THEN
    RAISE EXCEPTION 'PRECHECK: policy document snapshots / site_footer_content missing';
  END IF;
END;
$precheck_checkout_consent_v2$;

-- [11번] 시작 ---------------------------------------------------------------------------------------------------
-- 1. 기록 칸(5-3) -----------------------------------------------------------------------------------------------



-- 2. 장바구니 문구 검사·지문(4-3 끝, 5-4). 어기면 NULL. 지문 = sha256(안내 LF 정가 확인), trim 없음. ----------------------
CREATE OR REPLACE FUNCTION public.build_market_cart_texts(p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_build_market_cart_texts$
DECLARE
  v_key text;
  v_text text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
    RETURN NULL;
  END IF;
  FOREACH v_key IN ARRAY ARRAY['cartCheckoutNotice', 'partialOwnedConfirmLabel'] LOOP
    IF jsonb_typeof(p_value -> v_key) IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_text := p_value ->> v_key;
    IF v_text !~ '[^ \t\n\r]' OR char_length(v_text) > 300 OR strpos(v_text, chr(10)) > 0 OR v_text ~ '[{}]' THEN
      RETURN NULL;
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'cartCheckoutNotice', p_value ->> 'cartCheckoutNotice',
    'partialOwnedConfirmLabel', p_value ->> 'partialOwnedConfirmLabel',
    'cartTextsSha256', encode(sha256(convert_to((p_value ->> 'cartCheckoutNotice') || chr(10) || (p_value ->> 'partialOwnedConfirmLabel'), 'UTF8')), 'hex'));
END;
$fn_build_market_cart_texts$;
REVOKE ALL ON FUNCTION public.build_market_cart_texts(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- 3. 2판 검사·원문·묶음(4-3 (S)~(g), 5-1·5-2). 성공 {text, details}, 어기면 NULL. 판을 보지 않는다. --------------------
--   p_kind 'market'(자료, {자료환불기간}) | 'point_charge'(충전, {충전환불기간}·{충전유효기간}=1). p_refund_days: 자료 refundDays, 충전 point_charge_refund_days().
--   링크 문서((g))는 정규화하지 않은 바닥글 원본(site_footer_content.value.policyDocuments.<키>)과 그 문서의 사본이 있는지로 본다.
CREATE OR REPLACE FUNCTION public.build_checkout_consent_v2(p_kind text, p_value jsonb, p_refund_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_build_checkout_consent_v2$
DECLARE
  c_years constant text := '1';
  v_days text;
  v_roles text[];
  v_required boolean[];
  v_role_ph text[];
  v_targets text[];
  v_required_targets text[];
  v_summary jsonb;
  v_items jsonb;
  v_item jsonb;
  v_target_json jsonb;
  v_key text;
  v_view text;
  v_link text;
  v_line text;
  v_body text;
  v_total integer := 0;
  v_one_line text[] := '{}';
  v_one_line_max integer[] := '{}';
  v_keys text[] := '{}';
  v_used_targets text[] := '{}';
  v_used_links text[] := '{}';
  v_summary_out jsonb := '[]'::jsonb;
  v_items_out jsonb := '[]'::jsonb;
  v_texts_out jsonb;
  v_lines text[];
  v_footer jsonb;
  v_doc jsonb;
  v_text text;
  v_details jsonb;
  i integer;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('market', 'point_charge') OR p_value IS NULL OR jsonb_typeof(p_value) <> 'object'
     OR p_refund_days IS NULL OR p_refund_days <= 0 THEN
    RETURN NULL;
  END IF;
  v_days := p_refund_days::text;
  IF p_kind = 'market' THEN
    v_roles := ARRAY['refundPeriod', 'restriction', 'note'];
    v_required := ARRAY[true, true, false];
    v_role_ph := ARRAY['{자료환불기간}', '', ''];
    v_targets := ARRAY['confirmNotice', 'usageScopeNotice', 'downloadPeriodNotice'];
    v_required_targets := ARRAY['confirmNotice'];
  ELSE
    v_roles := ARRAY['refundPeriod', 'restriction', 'validity', 'minor', 'note'];
    v_required := ARRAY[true, true, true, true, false];
    v_role_ph := ARRAY['{충전환불기간}', '', '{충전유효기간}', '', ''];
    v_targets := ARRAY['checkoutItems.product', 'checkoutItems.validity', 'checkoutItems.refund', 'checkoutItems.restriction',
                       'checkoutItems.otherCases', 'minorNotice'];
    v_required_targets := v_targets;
  END IF;

  -- (a) 제목(한 줄 규칙은 아래 (S1) 에서 함께)
  IF jsonb_typeof(p_value -> 'consentTitle') IS DISTINCT FROM 'string' THEN
    RETURN NULL;
  END IF;
  IF strpos(p_value ->> 'consentTitle', '[필수]') > 0 THEN
    RETURN NULL;
  END IF;
  v_one_line := v_one_line || (p_value ->> 'consentTitle');
  v_one_line_max := v_one_line_max || 26;

  -- (b) 요약 줄: 객체, 모르는 키 없음, 역할 순서, 선택 역할은 키가 없을 때만 빠짐
  v_summary := p_value -> 'consentSummary';
  IF jsonb_typeof(v_summary) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_summary) k WHERE NOT (k = ANY (v_roles))) THEN
    RETURN NULL;
  END IF;
  FOR i IN 1 .. array_length(v_roles, 1) LOOP
    IF NOT (v_summary ? v_roles[i]) THEN
      IF v_required[i] THEN
        RETURN NULL;
      END IF;
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_summary -> v_roles[i]) IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_line := v_summary ->> v_roles[i];
    IF v_role_ph[i] <> '' AND strpos(v_line, v_role_ph[i]) = 0 THEN
      RETURN NULL;
    END IF;
    v_one_line := v_one_line || v_line;
    v_one_line_max := v_one_line_max || 120;
    v_total := v_total + char_length(v_line);
    v_summary_out := v_summary_out || to_jsonb(CASE p_kind
      WHEN 'market' THEN replace(v_line, '{자료환불기간}', v_days)
      ELSE replace(replace(v_line, '{충전환불기간}', v_days), '{충전유효기간}', c_years) END);
  END LOOP;
  IF p_kind = 'market' AND v_total > 220 THEN
    RETURN NULL;
  END IF;

  -- (d)(e) 항목: 1~6개, 정확한 키 모양, key 규칙·중복 없음, textKeys 1~6개·전체 중복 없음·가리킬 수 있는 본문만, link 는 각각 한 번까지
  v_items := p_value -> 'consentItems';
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_items) < 1 OR jsonb_array_length(v_items) > 6 THEN
    RETURN NULL;
  END IF;
  FOR v_item IN SELECT e.value FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR jsonb_typeof(v_item -> 'view') IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_view := v_item ->> 'view';
    IF v_view NOT IN ('text', 'link')
       OR (SELECT string_agg(k COLLATE "C", ',' ORDER BY k COLLATE "C") FROM jsonb_object_keys(v_item) k)
          IS DISTINCT FROM (CASE v_view WHEN 'text' THEN 'key,label,textKeys,view' ELSE 'key,label,link,view' END) THEN
      RETURN NULL;
    END IF;
    IF jsonb_typeof(v_item -> 'key') IS DISTINCT FROM 'string' OR jsonb_typeof(v_item -> 'label') IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_key := v_item ->> 'key';
    IF v_key !~ '^[a-z][A-Za-z0-9]{0,29}$' OR v_key = ANY (v_keys) THEN
      RETURN NULL;
    END IF;
    v_keys := v_keys || v_key;
    v_one_line := v_one_line || (v_item ->> 'label');
    v_one_line_max := v_one_line_max || 30;
    IF v_view = 'text' THEN
      IF jsonb_typeof(v_item -> 'textKeys') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_item -> 'textKeys') < 1 OR jsonb_array_length(v_item -> 'textKeys') > 6 THEN
        RETURN NULL;
      END IF;
      v_texts_out := '[]'::jsonb;
      FOR v_target_json IN SELECT t.value FROM jsonb_array_elements(v_item -> 'textKeys') WITH ORDINALITY AS t(value, n) ORDER BY t.n LOOP
        IF jsonb_typeof(v_target_json) IS DISTINCT FROM 'string' OR NOT ((v_target_json #>> '{}') = ANY (v_targets))
           OR (v_target_json #>> '{}') = ANY (v_used_targets) THEN
          RETURN NULL;
        END IF;
        v_used_targets := v_used_targets || (v_target_json #>> '{}');
        -- (e) 정해진 잎만 읽는다(일반 경로 풀이 금지)
        v_target_json := CASE v_target_json #>> '{}'
          WHEN 'confirmNotice' THEN p_value -> 'confirmNotice'
          WHEN 'usageScopeNotice' THEN p_value -> 'usageScopeNotice'
          WHEN 'downloadPeriodNotice' THEN p_value -> 'downloadPeriodNotice'
          WHEN 'checkoutItems.product' THEN p_value -> 'checkoutItems' -> 'product'
          WHEN 'checkoutItems.validity' THEN p_value -> 'checkoutItems' -> 'validity'
          WHEN 'checkoutItems.refund' THEN p_value -> 'checkoutItems' -> 'refund'
          WHEN 'checkoutItems.restriction' THEN p_value -> 'checkoutItems' -> 'restriction'
          WHEN 'checkoutItems.otherCases' THEN p_value -> 'checkoutItems' -> 'otherCases'
          WHEN 'minorNotice' THEN p_value -> 'minorNotice'
        END;
        -- (S) 본문: 글자, 비지 않음, 채운 뒤 중괄호 없음(LF 는 허용)
        IF jsonb_typeof(v_target_json) IS DISTINCT FROM 'string' THEN
          RETURN NULL;
        END IF;
        v_body := v_target_json #>> '{}';
        IF v_body !~ '[^ \t\n\r]' THEN
          RETURN NULL;
        END IF;
        IF (CASE p_kind WHEN 'market' THEN replace(v_body, '{자료환불기간}', '')
            ELSE replace(replace(v_body, '{충전환불기간}', ''), '{충전유효기간}', '') END) ~ '[{}]' THEN
          RETURN NULL;
        END IF;
        v_texts_out := v_texts_out || to_jsonb(CASE p_kind
          WHEN 'market' THEN replace(v_body, '{자료환불기간}', v_days)
          ELSE replace(replace(v_body, '{충전환불기간}', v_days), '{충전유효기간}', c_years) END);
      END LOOP;
      v_items_out := v_items_out || jsonb_build_array(jsonb_build_object(
        'key', v_key,
        'label', CASE p_kind WHEN 'market' THEN replace(v_item ->> 'label', '{자료환불기간}', v_days)
                 ELSE replace(replace(v_item ->> 'label', '{충전환불기간}', v_days), '{충전유효기간}', c_years) END,
        'view', 'text',
        'texts', v_texts_out));
    ELSE
      IF jsonb_typeof(v_item -> 'link') IS DISTINCT FROM 'string' THEN
        RETURN NULL;
      END IF;
      v_link := v_item ->> 'link';
      IF v_link NOT IN ('refundPolicy', 'serviceTerms') OR v_link = ANY (v_used_links) THEN
        RETURN NULL;
      END IF;
      v_used_links := v_used_links || v_link;
      v_items_out := v_items_out || jsonb_build_array(jsonb_build_object(
        'key', v_key,
        'label', CASE p_kind WHEN 'market' THEN replace(v_item ->> 'label', '{자료환불기간}', v_days)
                 ELSE replace(replace(v_item ->> 'label', '{충전환불기간}', v_days), '{충전유효기간}', c_years) END,
        'view', 'link',
        'link', v_link));
    END IF;
  END LOOP;

  -- (f) 포함: 필수 본문과 두 링크
  IF NOT (v_required_targets <@ v_used_targets) OR NOT (ARRAY['refundPolicy', 'serviceTerms'] <@ v_used_links) THEN
    RETURN NULL;
  END IF;

  -- (S)(S1)(c) 한 줄 칸(제목·요약 줄·항목 이름): 1~최대 글자(채우기 전 코드포인트), 비지 않음, LF 없음, 채운 뒤 중괄호 없음, 숫자·기간 낱말 없음
  FOR i IN 1 .. array_length(v_one_line, 1) LOOP
    v_line := v_one_line[i];
    IF char_length(v_line) < 1 OR char_length(v_line) > v_one_line_max[i]
       OR v_line !~ '[^ \t\n\r]'
       OR strpos(v_line, chr(10)) > 0
       OR (CASE p_kind WHEN 'market' THEN replace(v_line, '{자료환불기간}', '')
           ELSE replace(replace(v_line, '{충전환불기간}', ''), '{충전유효기간}', '') END) ~ '[{}]'
       OR v_line ~ '[0-9０-９]'
       OR v_line ~ '([일이삼사오육칠팔구십백]+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|서른)[ \t\n]*(일째|일|년|개월|달|주일|주|시간)'
       OR v_line ~ '(하루|이틀|사흘|나흘|열흘|보름|한 해)' THEN
      RETURN NULL;
    END IF;
  END LOOP;

  -- (g) 링크 문서가 보여야 함: 원본 객체, enabled 정확히 true, label·content 비지 않은 글자, 사본 하나 이상
  SELECT s.value INTO v_footer FROM public.system_settings s WHERE s.key = 'site_footer_content';
  FOREACH v_link IN ARRAY ARRAY['refundPolicy', 'serviceTerms'] LOOP
    v_doc := v_footer -> 'policyDocuments' -> v_link;
    IF jsonb_typeof(v_doc) IS DISTINCT FROM 'object'
       OR (v_doc -> 'enabled') IS DISTINCT FROM 'true'::jsonb
       OR jsonb_typeof(v_doc -> 'label') IS DISTINCT FROM 'string' OR (v_doc ->> 'label') !~ '[^ \t\n\r]'
       OR jsonb_typeof(v_doc -> 'content') IS DISTINCT FROM 'string' OR (v_doc ->> 'content') !~ '[^ \t\n\r]'
       OR NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots d WHERE d.doc_key = v_link) THEN
      RETURN NULL;
    END IF;
  END LOOP;

  -- 원문(5-1): 제목, 요약 줄, 항목마다 이름 + (본문들 | '링크:' + 키), LF 로 잇는다(끝 LF 없음, trim·정규화 없음)
  v_lines := ARRAY[CASE p_kind WHEN 'market' THEN replace(p_value ->> 'consentTitle', '{자료환불기간}', v_days)
                   ELSE replace(replace(p_value ->> 'consentTitle', '{충전환불기간}', v_days), '{충전유효기간}', c_years) END];
  v_lines := v_lines || ARRAY(SELECT e.value #>> '{}' FROM jsonb_array_elements(v_summary_out) WITH ORDINALITY AS e(value, n) ORDER BY e.n);
  FOR v_item IN SELECT e.value FROM jsonb_array_elements(v_items_out) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    v_lines := v_lines || (v_item ->> 'label');
    IF v_item ->> 'view' = 'text' THEN
      v_lines := v_lines || ARRAY(SELECT t.value #>> '{}' FROM jsonb_array_elements(v_item -> 'texts') WITH ORDINALITY AS t(value, n) ORDER BY t.n);
    ELSE
      v_lines := v_lines || ('링크:' || (v_item ->> 'link'));
    END IF;
  END LOOP;
  v_text := array_to_string(v_lines, chr(10));
  v_details := jsonb_build_object(
    'consentFormat', 2,
    'consentTitle', v_lines[1],
    'consentSummary', v_summary_out,
    'consentItems', v_items_out,
    'noticeSha256', encode(sha256(convert_to(v_text, 'UTF8')), 'hex'),
    'refundDays', p_refund_days);
  RETURN jsonb_build_object('text', v_text, 'details', v_details);
END;
$fn_build_checkout_consent_v2$;
REVOKE ALL ON FUNCTION public.build_checkout_consent_v2(text, jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;

-- 4. 자료 구매 고지 동의 기록(3인자 → 4인자). 같은 거래에서 옛 서명을 지우고 만든다(다시 실행해도 멈추지 않음). ------------------
DROP FUNCTION IF EXISTS public.record_purchase_notice_ack(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.record_purchase_notice_ack(p_user_id uuid, p_idempotency_key uuid, p_notice_sha256 text, p_cart_texts_sha256 text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing_sha text;
  v_value jsonb;
  v_days_numeric numeric;
  v_days integer;
  v_label text;
  v_notice text;
  v_text text;
  v_sha text;
  v_inserted_id uuid;
  v_details jsonb;
  -- [11번] 시작
  v_existing_format smallint;
  v_existing_cart text;
  v_format smallint;
  v_built jsonb;
  v_cart jsonb;
  v_refund_doc text;
  v_terms_doc text;
  -- [11번] 끝
BEGIN
  -- ① 입력 검사
  IF p_user_id IS NULL OR p_idempotency_key IS NULL OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$'
     -- [11번] 시작
     OR (p_cart_texts_sha256 IS NOT NULL AND p_cart_texts_sha256 !~ '^[0-9a-f]{64}$') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID', 'consentFormat', NULL);
    -- [11번] 끝
  END IF;

  -- ② 같은 키로 이미 기록했고 지문이 같으면 그대로 통과(402 뒤 다시 누르기, 503 뒤 재시도)
  -- [11번] 장바구니 문구 지문도 같아야 한다(NULL 끼리도 같음 — 옛 코드의 재시도가 replay 로 끝나게)
  SELECT a.notice_sha256, a.consent_format, a.consent_details -> 'cartTexts' ->> 'cartTextsSha256'
    INTO v_existing_sha, v_existing_format, v_existing_cart
    FROM public.market_purchase_notice_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  IF FOUND AND v_existing_sha = p_notice_sha256 AND v_existing_cart IS NOT DISTINCT FROM p_cart_texts_sha256 THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing_format);
  END IF;

  -- ③ 지금 정책: 판(consentFormat), refundDays 는 숫자·정수·양수
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'market_purchase_policy';
  -- [11번] 시작: 판 — 없거나 숫자 1 → 1, 숫자 2 → 2, 그 밖 → 닫힘(consentFormat null)
  v_format := CASE
    WHEN v_value IS NULL OR jsonb_typeof(v_value) <> 'object' THEN NULL
    WHEN NOT (v_value ? 'consentFormat') THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 1 THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 2 THEN 2
  END;
  IF v_format IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', NULL);
  END IF;
  -- [11번] 끝
  IF jsonb_typeof(v_value -> 'refundDays') IS DISTINCT FROM 'number' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', v_format);
  END IF;
  v_days_numeric := (v_value ->> 'refundDays')::numeric;
  IF v_days_numeric <> trunc(v_days_numeric) OR v_days_numeric <= 0 OR v_days_numeric > 3650 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', v_format);
  END IF;
  v_days := v_days_numeric::integer;
  -- [11번] 시작: 장바구니 문구(판과 관계없음)
  v_cart := public.build_market_cart_texts(v_value);
  IF v_format = 2 THEN
    -- 2판: 묶음(문구·링크 문서 검사 포함)과 두 문서 지문. 사본이 없으면 NULL 로 두지 않고 닫는다.
    v_built := public.build_checkout_consent_v2('market', v_value, v_days);
    SELECT d.content_sha256 INTO v_refund_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'refundPolicy' ORDER BY d.seq DESC LIMIT 1;
    SELECT d.content_sha256 INTO v_terms_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'serviceTerms' ORDER BY d.seq DESC LIMIT 1;
    IF v_built IS NULL OR v_refund_doc IS NULL OR v_terms_doc IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_text := v_built ->> 'text';
    v_details := v_built -> 'details';
    v_sha := v_details ->> 'noticeSha256';
  ELSE
  -- [11번] 끝
    -- 1판: 두 문구는 비어 있지 않은 글자(지금 규칙 그대로)
    IF jsonb_typeof(v_value -> 'checkboxLabel') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_value -> 'confirmNotice') IS DISTINCT FROM 'string' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_label := replace(v_value ->> 'checkboxLabel', '{자료환불기간}', v_days::text);
    v_notice := replace(v_value ->> 'confirmNotice', '{자료환불기간}', v_days::text);
    IF btrim(v_label) = '' OR btrim(v_notice) = '' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_text := v_label || chr(10) || v_notice;
    v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
    v_details := jsonb_build_object('checkboxLabel', v_label, 'confirmNotice', v_notice, 'noticeSha256', v_sha, 'refundDays', v_days,
                                    'consentFormat', 1);
  END IF;

  -- ④ 같은 키를 다른 화면(지문)으로 다시 쓰면 거절 — 화면은 새 키를 만든다
  IF v_existing_sha IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;

  -- ⑤ 화면에 보인 문구가 지금 문구와 다르면 거절
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;
  -- [11번] 시작: 화면에 보인 장바구니 문구가 지금 문구와 다르거나 지금 문구가 규칙 위반이면 기록하지 않고 거절(인자 NULL = 옛 코드는 지금처럼 기록)
  IF p_cart_texts_sha256 IS NOT NULL AND (v_cart IS NULL OR (v_cart ->> 'cartTextsSha256') <> p_cart_texts_sha256) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;
  -- [11번] 끝

  -- ⑥ 기록
  INSERT INTO public.market_purchase_notice_acks (user_id, idempotency_key, notice_sha256, notice_text, refund_days,
                                                  consent_format, refund_policy_sha256, terms_policy_sha256, consent_details)
  VALUES (p_user_id, p_idempotency_key, v_sha, v_text, v_days,
          v_format, CASE WHEN v_format = 2 THEN v_refund_doc END, CASE WHEN v_format = 2 THEN v_terms_doc END,
          CASE WHEN v_format = 2
               THEN jsonb_build_object('cartTexts', CASE WHEN p_cart_texts_sha256 IS NULL THEN NULL ELSE v_cart END,
                                       'consent', v_details - 'noticeSha256' - 'plan')
               ELSE jsonb_build_object('cartTexts', CASE WHEN p_cart_texts_sha256 IS NULL THEN NULL ELSE v_cart END) END)
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted_id;
  IF v_inserted_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false, 'consentFormat', v_format);
  END IF;

  SELECT a.notice_sha256, a.consent_format, a.consent_details -> 'cartTexts' ->> 'cartTextsSha256'
    INTO v_existing_sha, v_existing_format, v_existing_cart
    FROM public.market_purchase_notice_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  IF v_existing_sha = p_notice_sha256 AND v_existing_cart IS NOT DISTINCT FROM p_cart_texts_sha256 THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing_format);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_purchase_notice_ack(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_purchase_notice_ack(uuid, uuid, text, text) TO service_role;

-- 5. 충전 결제 전 확인 동의 기록(6인자 그대로). 탈퇴 거절은 맨 앞 그대로. ----------------------------------------------
CREATE OR REPLACE FUNCTION public.record_point_charge_checkout_ack(p_user_id uuid, p_checkout_attempt_id uuid, p_plan_id uuid, p_expected_amount integer, p_expected_credits integer, p_notice_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing public.point_charge_checkout_acks%ROWTYPE;
  v_value jsonb;
  v_items jsonb;
  v_days integer;
  v_parts text[];
  v_part text;
  v_key text;
  v_text text;
  v_sha text;
  v_plan public.pricing_plans%ROWTYPE;
  v_details jsonb;
  v_policy_sha text;
  v_inserted uuid;
  -- [11번] 시작
  v_format smallint;
  v_built jsonb;
  v_terms_doc text;
  -- [11번] 끝
BEGIN
  IF p_user_id IS NULL OR p_checkout_attempt_id IS NULL OR p_plan_id IS NULL OR p_expected_amount IS NULL OR p_expected_credits IS NULL
     OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID', 'consentFormat', NULL);
  END IF;
  -- [10번] 시작
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.withdrawn_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MEMBER_WITHDRAWN', 'consentFormat', NULL);
  END IF;
  -- [10번] 끝

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;

  -- 지금 정책(필수 키·자리표시 규칙 — TS 저장 검사와 같음)
  v_days := public.point_charge_refund_days();
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'point_charge_policy';
  -- [11번] 시작: 판 — 없거나 숫자 1 → 1, 숫자 2 → 2, 그 밖 → 닫힘(consentFormat null)
  v_format := CASE
    WHEN v_value IS NULL OR jsonb_typeof(v_value) <> 'object' THEN NULL
    WHEN NOT (v_value ? 'consentFormat') THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 1 THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 2 THEN 2
  END;
  IF v_format IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', NULL);
  END IF;
  SELECT * INTO v_plan FROM public.pricing_plans p WHERE p.id = p_plan_id;
  IF v_format = 2 THEN
    -- 2판: 묶음(문구·링크 문서 검사 포함)과 이용약관 문서 지문. 사본이 없으면 NULL 로 두지 않고 닫는다.
    IF v_days IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_built := public.build_checkout_consent_v2('point_charge', v_value, v_days);
    SELECT d.content_sha256 INTO v_terms_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'serviceTerms' ORDER BY d.seq DESC LIMIT 1;
    IF v_built IS NULL OR v_terms_doc IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots d WHERE d.doc_key = 'refundPolicy') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_text := v_built ->> 'text';
    v_sha := v_built #>> '{details,noticeSha256}';
    v_details := (v_built -> 'details') || jsonb_build_object(
      'plan', CASE WHEN v_plan.id IS NULL THEN NULL ELSE jsonb_build_object('price', v_plan.price, 'credits', v_plan.credits) END);
  ELSE
  -- [11번] 끝
    v_items := v_value -> 'checkoutItems';
    IF v_days IS NULL OR jsonb_typeof(v_items) IS DISTINCT FROM 'object' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_parts := ARRAY[v_value ->> 'checkoutTitle', v_items ->> 'product', v_items ->> 'validity', v_items ->> 'refund',
                     v_items ->> 'restriction', v_items ->> 'otherCases', v_value ->> 'minorNotice', v_value ->> 'agreeLabel'];
    FOREACH v_part IN ARRAY v_parts LOOP
      IF v_part IS NULL OR v_part !~ '\S' OR replace(v_part, '{충전환불기간}', '') ~ '[{}]' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
      END IF;
    END LOOP;
    IF strpos(v_items ->> 'refund', '{충전환불기간}') = 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_text := array_to_string(ARRAY(SELECT replace(x, '{충전환불기간}', v_days::text) FROM unnest(v_parts) WITH ORDINALITY AS t(x, n) ORDER BY n), chr(10));
    v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');

    v_details := jsonb_build_object(
      'checkoutTitle', replace(v_value ->> 'checkoutTitle', '{충전환불기간}', v_days::text),
      'checkoutItems', jsonb_build_object(
        'product', replace(v_items ->> 'product', '{충전환불기간}', v_days::text),
        'validity', replace(v_items ->> 'validity', '{충전환불기간}', v_days::text),
        'refund', replace(v_items ->> 'refund', '{충전환불기간}', v_days::text),
        'restriction', replace(v_items ->> 'restriction', '{충전환불기간}', v_days::text),
        'otherCases', replace(v_items ->> 'otherCases', '{충전환불기간}', v_days::text)),
      'minorNotice', replace(v_value ->> 'minorNotice', '{충전환불기간}', v_days::text),
      'agreeLabel', replace(v_value ->> 'agreeLabel', '{충전환불기간}', v_days::text),
      'noticeSha256', v_sha, 'refundDays', v_days,
      'plan', CASE WHEN v_plan.id IS NULL THEN NULL ELSE jsonb_build_object('price', v_plan.price, 'credits', v_plan.credits) END,
      'consentFormat', 1);
  END IF;

  IF v_plan.id IS NULL OR NOT v_plan.is_active THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_UNAVAILABLE', 'details', v_details, 'consentFormat', v_format);
  END IF;
  IF v_plan.price <> p_expected_amount OR v_plan.credits <> p_expected_credits THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_CHANGED', 'details', v_details, 'consentFormat', v_format);
  END IF;
  -- 같은 시도의 재요청: 요금제가 그대로일 때만(위 검사 뒤) 같은 기록으로 본다.
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
       AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
      RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing.consent_format);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'consentFormat', v_format);
  END IF;
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'consentFormat', v_format);
  END IF;

  SELECT s.content_sha256 INTO v_policy_sha FROM public.policy_document_snapshots s
   WHERE s.doc_key = 'refundPolicy' ORDER BY s.seq DESC LIMIT 1;

  INSERT INTO public.point_charge_checkout_acks (user_id, checkout_attempt_id, plan_id, plan_name, amount, credits, refund_days,
                                                 notice_text, notice_sha256, refund_policy_sha256,
                                                 terms_policy_sha256, consent_format, consent_details)
  VALUES (p_user_id, p_checkout_attempt_id, v_plan.id, v_plan.name, v_plan.price, v_plan.credits, v_days, v_text, v_sha, v_policy_sha,
          CASE WHEN v_format = 2 THEN v_terms_doc END, v_format,
          CASE WHEN v_format = 2 THEN jsonb_build_object('consent', v_details - 'noticeSha256' - 'plan') END)
  ON CONFLICT (user_id, checkout_attempt_id) DO NOTHING
  RETURNING id INTO v_inserted;
  IF v_inserted IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false, 'consentFormat', v_format);
  END IF;

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;
  IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
     AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing.consent_format);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'consentFormat', v_format);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_point_charge_checkout_ack(uuid, uuid, uuid, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_point_charge_checkout_ack(uuid, uuid, uuid, integer, integer, text) TO service_role;
-- [11번] 끝 -----------------------------------------------------------------------------------------------------

-- 6. VERIFY ------------------------------------------------------------------------------------------------------
DO $verify_checkout_consent_v2$
DECLARE
  v_new text[][] := ARRAY[
    ARRAY['public.record_purchase_notice_ack(uuid,uuid,text,text)', '9d2cb23a7aa16e45970525248bcc4435', '{postgres=X/postgres,service_role=X/postgres}'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', '4b23fdf6b9c7bcf76e39ee5b7b1a629f', '{postgres=X/postgres,service_role=X/postgres}'],
    ARRAY['public.build_checkout_consent_v2(text,jsonb,integer)', '3fd97051955741db213297804131c1e3', '{postgres=X/postgres}'],
    ARRAY['public.build_market_cart_texts(jsonb)', '604251e0a0b5f85b58aaeccb0c593d05', '{postgres=X/postgres}']
  ];
  v_vector jsonb := $vector${
    "consentFormat": 2, "consentTitle": "주문 내용·충전 조건 확인 및 결제 동의",
    "consentSummary": {"refundPeriod": "{충전환불기간}일째 되는 날까지 신청할 수 있어요.", "restriction": "하나라도 쓰면 취소할 수 없어요.",
                       "validity": "{충전유효기간}년 동안 쓸 수 있어요.", "minor": "미성년자는 취소할 수 있어요."},
    "checkoutItems": {"product": "상품 A", "validity": "기간 B", "refund": "환불 {충전환불기간}일\n둘째 줄", "restriction": "제한 C", "otherCases": "기타 D"},
    "minorNotice": "미성년 E",
    "consentItems": [
      {"key": "product", "label": "충전 상품 안내", "view": "text", "textKeys": ["checkoutItems.product", "checkoutItems.validity"]},
      {"key": "refund", "label": "취소·환불 안내", "view": "text", "textKeys": ["checkoutItems.refund", "checkoutItems.restriction", "checkoutItems.otherCases"]},
      {"key": "minor", "label": "미성년자 결제 취소 안내", "view": "text", "textKeys": ["minorNotice"]},
      {"key": "refundPolicy", "label": "취소·환불정책", "view": "link", "link": "refundPolicy"},
      {"key": "terms", "label": "서비스 이용약관", "view": "link", "link": "serviceTerms"}]}$vector$;
  v_links_visible boolean;
  v_result jsonb;
  v_sig text;
  i integer;
BEGIN
  IF to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: 3-argument record_purchase_notice_ack must be gone';
  END IF;
  FOR i IN 1 .. array_length(v_new, 1) LOOP
    v_sig := v_new[i][1];
    IF to_regprocedure(v_sig) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_sig))) <> v_new[i][2] THEN
      RAISE EXCEPTION 'VERIFY: % md5 (%)', v_sig, md5(pg_get_functiondef(to_regprocedure(v_sig)));
    END IF;
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v_sig)) IS DISTINCT FROM v_new[i][3] THEN
      RAISE EXCEPTION 'VERIFY: % ACL (%)', v_sig, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v_sig));
    END IF;
    IF has_function_privilege('anon', v_sig, 'EXECUTE') OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % must not be executable by API roles', v_sig;
    END IF;
  END LOOP;
  IF has_function_privilege('service_role', 'public.build_checkout_consent_v2(text,jsonb,integer)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.build_market_cart_texts(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: internal builders must not be executable by service_role';
  END IF;

  -- 칸·CHECK
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_purchase_notice_acks'
       AND column_name IN ('refund_policy_sha256', 'terms_policy_sha256', 'consent_format', 'consent_details')) < 0
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'point_charge_checkout_acks'
       AND column_name IN ('terms_policy_sha256', 'consent_format', 'consent_details')) < 0
     OR (SELECT count(*) FROM pg_constraint WHERE conname IN ('market_purchase_notice_acks_consent_format_check',
                                                              'point_charge_checkout_acks_consent_format_check')) < 0 THEN
    RAISE EXCEPTION 'VERIFY: consent columns / checks';
  END IF;

  -- 옛 코드 호출(이름 인자 3개·6인자)은 입력 검사에서 consentFormat null 키와 함께 돌아온다(기록 없음).
  v_result := public.record_purchase_notice_ack(p_user_id => NULL, p_idempotency_key => NULL, p_notice_sha256 => 'x');
  IF v_result ->> 'code' IS DISTINCT FROM 'NOTICE_INPUT_INVALID' OR NOT (v_result ? 'consentFormat') OR (v_result -> 'consentFormat') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'VERIFY: market 3 named arguments → %', v_result;
  END IF;
  v_result := public.record_point_charge_checkout_ack(NULL, NULL, NULL, NULL, NULL, 'x');
  IF v_result ->> 'code' IS DISTINCT FROM 'NOTICE_INPUT_INVALID' OR NOT (v_result ? 'consentFormat') THEN
    RAISE EXCEPTION 'VERIFY: point charge 6 arguments → %', v_result;
  END IF;

  -- 5-1 시험 벡터(링크 문서가 보일 때만 — 닫혀 있으면 NULL 이어야 함)
  SELECT bool_and(jsonb_typeof(d) = 'object' AND (d -> 'enabled') = 'true'::jsonb
                  AND jsonb_typeof(d -> 'label') = 'string' AND (d ->> 'label') ~ '[^ \t\n\r]'
                  AND jsonb_typeof(d -> 'content') = 'string' AND (d ->> 'content') ~ '[^ \t\n\r]'
                  AND EXISTS (SELECT 1 FROM public.policy_document_snapshots s WHERE s.doc_key = k))
    INTO v_links_visible
    FROM public.system_settings ss, unnest(ARRAY['refundPolicy', 'serviceTerms']) k, LATERAL (SELECT ss.value -> 'policyDocuments' -> k AS d) x
   WHERE ss.key = 'site_footer_content';
  v_result := public.build_checkout_consent_v2('point_charge', v_vector, 7);
  IF v_links_visible IS TRUE THEN
    IF v_result #>> '{details,noticeSha256}' IS DISTINCT FROM '2e53f470c92dfba92ee637f86c592f5b5545b46ef37b883eb856f30c7bc56cd7'
       OR encode(sha256(convert_to(v_result ->> 'text', 'UTF8')), 'hex') IS DISTINCT FROM '2e53f470c92dfba92ee637f86c592f5b5545b46ef37b883eb856f30c7bc56cd7' THEN
      RAISE EXCEPTION 'VERIFY: consent vector → %', left(coalesce(v_result::text, 'NULL'), 600);
    END IF;
  ELSIF v_result IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: consent builder must close when link documents are hidden';
  END IF;
  -- 장바구니 문구 지문(앞뒤 공백 그대로, trim 없음)
  v_result := public.build_market_cart_texts(jsonb_build_object('cartCheckoutNotice', ' 앞 공백 안내', 'partialOwnedConfirmLabel', '뒤 공백 확인 '));
  IF v_result ->> 'cartTextsSha256' IS DISTINCT FROM encode(sha256(convert_to(' 앞 공백 안내' || chr(10) || '뒤 공백 확인 ', 'UTF8')), 'hex')
     OR public.build_market_cart_texts(jsonb_build_object('cartCheckoutNotice', '줄' || chr(10) || '바꿈', 'partialOwnedConfirmLabel', 'x')) IS NOT NULL
     OR public.build_market_cart_texts(jsonb_build_object('cartCheckoutNotice', '{x}', 'partialOwnedConfirmLabel', 'x')) IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: cart texts builder';
  END IF;
END;
$verify_checkout_consent_v2$;

NOTIFY pgrst, 'reload schema';
$rh_r8_copy$);
    v_log := v_log || pg_temp.expect(v_r, 'ERR PRECHECK: public.record_point_charge_checkout_ack', 'R8', '10번 전 충전 함수면 11번 사전 검사 멈춤');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R8', m FROM unnest(v_log) m;
END
$rh_r8_bundle9$;

-- ===== 11번 마이그레이션 사본(light: LOCK TABLE·ALTER TABLE·CHECK·COMMENT·칸 VERIFY 뺌) =====
-- 출시 전 작업 순서표 11번 묶음: 결제 화면 단순화 — 동의 2판(접는 동의)(계획 docs/plan-bundle11-checkout-simplify.md 13판 5절).
-- 만드는 것:
--   1. 칸: market_purchase_notice_acks(refund_policy_sha256·terms_policy_sha256·consent_format·consent_details),
--      point_charge_checkout_acks(terms_policy_sha256·consent_format·consent_details). 칸은 down 이 지우지 않는다(증빙).
--      consent_format 은 상수 기본값 1 이라 표를 다시 쓰지 않고, 추가 전용 가드 트리거와 부딪치지 않는다.
--   2. 내부 함수(ACL postgres 만): build_market_cart_texts(장바구니 문구 검사·지문), build_checkout_consent_v2(2판 문구 검사·링크 문서 검사·원문·묶음).
--      둘 다 판(consentFormat)을 보지 않는다. TS(src/lib/checkout-consent.ts)와 같은 규칙이다.
--   3. 재정의: record_purchase_notice_ack 3인자 → 4인자(p_cart_texts_sha256 DEFAULT NULL — 옛 코드의 이름 인자 3개 호출은 기본값으로 맞음),
--      record_point_charge_checkout_ack(6인자 그대로). 판 분기, 2판 기록 칸, 장바구니 문구 대조, 모든 응답에 consentFormat 키.
-- 정책에 consentFormat 이 없으면(스크립트 A 전) 1판 그대로라 화면·기록 변화가 없다(옛 코드 호출은 cartTexts null 로 기록).
-- 함수 지문은 md5(pg_get_functiondef(oid)) — 9·10번과 같은 측정. 사전 값이 다르면 멈춘다.
-- 잠금: 두 기록 표에 ACCESS EXCLUSIVE(칸 추가 — 거래 끝까지 읽기도 막음). 새벽에 짧게 적용하고, 잡지 못하면(lock_timeout 3초) 전체가 취소된다.
-- 다시 적용: down 없이 같은 파일을 다시 실행해도 멈추지 않는다(사전 검사가 이 파일의 새 값도 받음). 이력을 다시 넣으려면 10번 머리말과 같이
--   같은 거래에서 schema_migrations 의 '20261216100000' 행을 지운 뒤 이 파일과 이력 INSERT 를 넣는다.
-- 되돌리기: supabase/rollback/20261216100000_checkout_consent_v2_down.sql(코드를 11번 전으로 되돌린 뒤에만, 10절 되돌리기 순서).
--   10번을 되돌려야 하면 이 down 을 먼저 한다(10번 _down_b 는 충전 함수가 10번 값일 때만 돈다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- 잠그는 순서: 자료 동의 기록 → 충전 동의 기록(교착 방지).

-- 0. 사전 점검 -------------------------------------------------------------------------------------------------
DO $precheck_checkout_consent_v2$
DECLARE
  -- 바꾸는 함수: {서명, 바탕 값(없으면 ''), 이 파일의 새 값}
  v_changed text[][] := ARRAY[
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', 'be4403fd993c45d618950a5908a91591', '4b23fdf6b9c7bcf76e39ee5b7b1a629f'],
    ARRAY['public.build_checkout_consent_v2(text,jsonb,integer)', '', '3fd97051955741db213297804131c1e3'],
    ARRAY['public.build_market_cart_texts(jsonb)', '', '604251e0a0b5f85b58aaeccb0c593d05']
  ];
  -- 그대로여야 함(계획 5-5, 2026-11-26 운영 값)
  v_same text[][] := ARRAY[
    ARRAY['public.checkout_market_selection(uuid,text,uuid,jsonb,uuid)', '0cda5ff7689d998cc6cf2fd213b0004d'],
    ARRAY['public.get_point_charge_refund_eligibility(uuid,uuid)', '60fc28afe44e7be776c189265e87b6ec'],
    ARRAY['public.point_charge_refund_days()', '7ab4d40c1634ade20de86517fa13cd40'],
    ARRAY['public.guard_point_charge_checkout_acks_mutation()', 'c7ef25308c6c0aa2920991965fb87ab0'],
    ARRAY['public.guard_market_purchase_notice_acks_mutation()', '3959ac2b8139d0f81365df59ed67ef10'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '93e0bd5e41969f66f296f4353f3feeb9'],
    ARRAY['public.begin_payapp_request(uuid)', '679b4474c0dc42de11e5e9a14a7d1d4d'],
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '657bbb07ae4b250a2697f21e2aa805e9'],
    ARRAY['public.market_purchase_refund_days()', '5d4030e7bedbace6189cefed80c3d27b'],
    ARRAY['public.record_policy_document_snapshots()', '4ffeca80346467f928c0a6f50b69018d'],
    ARRAY['public.prevent_policy_document_snapshot_mutation()', 'b1449554c094a90be7a6c864f367fdf8'],
    ARRAY['public.member_withdrawal_facts(uuid,boolean)', 'a7674770964dac2fe5c9179b8403c3b4'],
    ARRAY['public.get_member_withdrawal_preview(uuid,boolean)', '3a2e2c2f6eb6ecb15defe0879c88e0fc'],
    ARRAY['public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)', '1346d870d3623abae580a011b0484339']
  ];
  v_old regprocedure := to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)');
  v_new regprocedure := to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text,text)');
  v_md5 text;
  i integer;
BEGIN
  -- 자료 기록 함수: 3인자(바탕 값)나 4인자(이 파일 값) 중 정확히 하나만 있어야 한다.
  IF (v_old IS NULL) = (v_new IS NULL) THEN
    RAISE EXCEPTION 'PRECHECK: record_purchase_notice_ack must exist with exactly one of 3/4 arguments';
  END IF;
  IF v_old IS NOT NULL AND md5(pg_get_functiondef(v_old)) <> 'fa6a7edd836f21422d52dd184afb079b' THEN
    RAISE EXCEPTION 'PRECHECK: record_purchase_notice_ack(uuid,uuid,text) changed (%)', md5(pg_get_functiondef(v_old));
  END IF;
  IF v_new IS NOT NULL AND md5(pg_get_functiondef(v_new)) <> '9d2cb23a7aa16e45970525248bcc4435' THEN
    RAISE EXCEPTION 'PRECHECK: record_purchase_notice_ack(uuid,uuid,text,text) changed (%)', md5(pg_get_functiondef(v_new));
  END IF;
  FOR i IN 1 .. array_length(v_changed, 1) LOOP
    IF to_regprocedure(v_changed[i][1]) IS NULL THEN
      IF v_changed[i][2] <> '' THEN
        RAISE EXCEPTION 'PRECHECK: % missing', v_changed[i][1];
      END IF;
      CONTINUE;
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(v_changed[i][1])));
    IF v_md5 IS DISTINCT FROM v_changed[i][2] AND v_md5 IS DISTINCT FROM v_changed[i][3] THEN
      RAISE EXCEPTION 'PRECHECK: % changed (%)', v_changed[i][1], v_md5;
    END IF;
  END LOOP;
  FOR i IN 1 .. array_length(v_same, 1) LOOP
    IF to_regprocedure(v_same[i][1]) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) <> v_same[i][2] THEN
      RAISE EXCEPTION 'PRECHECK: % changed (%)', v_same[i][1], md5(pg_get_functiondef(to_regprocedure(v_same[i][1])));
    END IF;
  END LOOP;
  IF to_regclass('public.policy_document_snapshots') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'site_footer_content') THEN
    RAISE EXCEPTION 'PRECHECK: policy document snapshots / site_footer_content missing';
  END IF;
END;
$precheck_checkout_consent_v2$;

-- [11번] 시작 ---------------------------------------------------------------------------------------------------
-- 1. 기록 칸(5-3) -----------------------------------------------------------------------------------------------



-- 2. 장바구니 문구 검사·지문(4-3 끝, 5-4). 어기면 NULL. 지문 = sha256(안내 LF 정가 확인), trim 없음. ----------------------
CREATE OR REPLACE FUNCTION public.build_market_cart_texts(p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_build_market_cart_texts$
DECLARE
  v_key text;
  v_text text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
    RETURN NULL;
  END IF;
  FOREACH v_key IN ARRAY ARRAY['cartCheckoutNotice', 'partialOwnedConfirmLabel'] LOOP
    IF jsonb_typeof(p_value -> v_key) IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_text := p_value ->> v_key;
    IF v_text !~ '[^ \t\n\r]' OR char_length(v_text) > 300 OR strpos(v_text, chr(10)) > 0 OR v_text ~ '[{}]' THEN
      RETURN NULL;
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'cartCheckoutNotice', p_value ->> 'cartCheckoutNotice',
    'partialOwnedConfirmLabel', p_value ->> 'partialOwnedConfirmLabel',
    'cartTextsSha256', encode(sha256(convert_to((p_value ->> 'cartCheckoutNotice') || chr(10) || (p_value ->> 'partialOwnedConfirmLabel'), 'UTF8')), 'hex'));
END;
$fn_build_market_cart_texts$;
REVOKE ALL ON FUNCTION public.build_market_cart_texts(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- 3. 2판 검사·원문·묶음(4-3 (S)~(g), 5-1·5-2). 성공 {text, details}, 어기면 NULL. 판을 보지 않는다. --------------------
--   p_kind 'market'(자료, {자료환불기간}) | 'point_charge'(충전, {충전환불기간}·{충전유효기간}=1). p_refund_days: 자료 refundDays, 충전 point_charge_refund_days().
--   링크 문서((g))는 정규화하지 않은 바닥글 원본(site_footer_content.value.policyDocuments.<키>)과 그 문서의 사본이 있는지로 본다.
CREATE OR REPLACE FUNCTION public.build_checkout_consent_v2(p_kind text, p_value jsonb, p_refund_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_build_checkout_consent_v2$
DECLARE
  c_years constant text := '1';
  v_days text;
  v_roles text[];
  v_required boolean[];
  v_role_ph text[];
  v_targets text[];
  v_required_targets text[];
  v_summary jsonb;
  v_items jsonb;
  v_item jsonb;
  v_target_json jsonb;
  v_key text;
  v_view text;
  v_link text;
  v_line text;
  v_body text;
  v_total integer := 0;
  v_one_line text[] := '{}';
  v_one_line_max integer[] := '{}';
  v_keys text[] := '{}';
  v_used_targets text[] := '{}';
  v_used_links text[] := '{}';
  v_summary_out jsonb := '[]'::jsonb;
  v_items_out jsonb := '[]'::jsonb;
  v_texts_out jsonb;
  v_lines text[];
  v_footer jsonb;
  v_doc jsonb;
  v_text text;
  v_details jsonb;
  i integer;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('market', 'point_charge') OR p_value IS NULL OR jsonb_typeof(p_value) <> 'object'
     OR p_refund_days IS NULL OR p_refund_days <= 0 THEN
    RETURN NULL;
  END IF;
  v_days := p_refund_days::text;
  IF p_kind = 'market' THEN
    v_roles := ARRAY['refundPeriod', 'restriction', 'note'];
    v_required := ARRAY[true, true, false];
    v_role_ph := ARRAY['{자료환불기간}', '', ''];
    v_targets := ARRAY['confirmNotice', 'usageScopeNotice', 'downloadPeriodNotice'];
    v_required_targets := ARRAY['confirmNotice'];
  ELSE
    v_roles := ARRAY['refundPeriod', 'restriction', 'validity', 'minor', 'note'];
    v_required := ARRAY[true, true, true, true, false];
    v_role_ph := ARRAY['{충전환불기간}', '', '{충전유효기간}', '', ''];
    v_targets := ARRAY['checkoutItems.product', 'checkoutItems.validity', 'checkoutItems.refund', 'checkoutItems.restriction',
                       'checkoutItems.otherCases', 'minorNotice'];
    v_required_targets := v_targets;
  END IF;

  -- (a) 제목(한 줄 규칙은 아래 (S1) 에서 함께)
  IF jsonb_typeof(p_value -> 'consentTitle') IS DISTINCT FROM 'string' THEN
    RETURN NULL;
  END IF;
  IF strpos(p_value ->> 'consentTitle', '[필수]') > 0 THEN
    RETURN NULL;
  END IF;
  v_one_line := v_one_line || (p_value ->> 'consentTitle');
  v_one_line_max := v_one_line_max || 26;

  -- (b) 요약 줄: 객체, 모르는 키 없음, 역할 순서, 선택 역할은 키가 없을 때만 빠짐
  v_summary := p_value -> 'consentSummary';
  IF jsonb_typeof(v_summary) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_summary) k WHERE NOT (k = ANY (v_roles))) THEN
    RETURN NULL;
  END IF;
  FOR i IN 1 .. array_length(v_roles, 1) LOOP
    IF NOT (v_summary ? v_roles[i]) THEN
      IF v_required[i] THEN
        RETURN NULL;
      END IF;
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_summary -> v_roles[i]) IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_line := v_summary ->> v_roles[i];
    IF v_role_ph[i] <> '' AND strpos(v_line, v_role_ph[i]) = 0 THEN
      RETURN NULL;
    END IF;
    v_one_line := v_one_line || v_line;
    v_one_line_max := v_one_line_max || 120;
    v_total := v_total + char_length(v_line);
    v_summary_out := v_summary_out || to_jsonb(CASE p_kind
      WHEN 'market' THEN replace(v_line, '{자료환불기간}', v_days)
      ELSE replace(replace(v_line, '{충전환불기간}', v_days), '{충전유효기간}', c_years) END);
  END LOOP;
  IF p_kind = 'market' AND v_total > 220 THEN
    RETURN NULL;
  END IF;

  -- (d)(e) 항목: 1~6개, 정확한 키 모양, key 규칙·중복 없음, textKeys 1~6개·전체 중복 없음·가리킬 수 있는 본문만, link 는 각각 한 번까지
  v_items := p_value -> 'consentItems';
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_items) < 1 OR jsonb_array_length(v_items) > 6 THEN
    RETURN NULL;
  END IF;
  FOR v_item IN SELECT e.value FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR jsonb_typeof(v_item -> 'view') IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_view := v_item ->> 'view';
    IF v_view NOT IN ('text', 'link')
       OR (SELECT string_agg(k COLLATE "C", ',' ORDER BY k COLLATE "C") FROM jsonb_object_keys(v_item) k)
          IS DISTINCT FROM (CASE v_view WHEN 'text' THEN 'key,label,textKeys,view' ELSE 'key,label,link,view' END) THEN
      RETURN NULL;
    END IF;
    IF jsonb_typeof(v_item -> 'key') IS DISTINCT FROM 'string' OR jsonb_typeof(v_item -> 'label') IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_key := v_item ->> 'key';
    IF v_key !~ '^[a-z][A-Za-z0-9]{0,29}$' OR v_key = ANY (v_keys) THEN
      RETURN NULL;
    END IF;
    v_keys := v_keys || v_key;
    v_one_line := v_one_line || (v_item ->> 'label');
    v_one_line_max := v_one_line_max || 30;
    IF v_view = 'text' THEN
      IF jsonb_typeof(v_item -> 'textKeys') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_item -> 'textKeys') < 1 OR jsonb_array_length(v_item -> 'textKeys') > 6 THEN
        RETURN NULL;
      END IF;
      v_texts_out := '[]'::jsonb;
      FOR v_target_json IN SELECT t.value FROM jsonb_array_elements(v_item -> 'textKeys') WITH ORDINALITY AS t(value, n) ORDER BY t.n LOOP
        IF jsonb_typeof(v_target_json) IS DISTINCT FROM 'string' OR NOT ((v_target_json #>> '{}') = ANY (v_targets))
           OR (v_target_json #>> '{}') = ANY (v_used_targets) THEN
          RETURN NULL;
        END IF;
        v_used_targets := v_used_targets || (v_target_json #>> '{}');
        -- (e) 정해진 잎만 읽는다(일반 경로 풀이 금지)
        v_target_json := CASE v_target_json #>> '{}'
          WHEN 'confirmNotice' THEN p_value -> 'confirmNotice'
          WHEN 'usageScopeNotice' THEN p_value -> 'usageScopeNotice'
          WHEN 'downloadPeriodNotice' THEN p_value -> 'downloadPeriodNotice'
          WHEN 'checkoutItems.product' THEN p_value -> 'checkoutItems' -> 'product'
          WHEN 'checkoutItems.validity' THEN p_value -> 'checkoutItems' -> 'validity'
          WHEN 'checkoutItems.refund' THEN p_value -> 'checkoutItems' -> 'refund'
          WHEN 'checkoutItems.restriction' THEN p_value -> 'checkoutItems' -> 'restriction'
          WHEN 'checkoutItems.otherCases' THEN p_value -> 'checkoutItems' -> 'otherCases'
          WHEN 'minorNotice' THEN p_value -> 'minorNotice'
        END;
        -- (S) 본문: 글자, 비지 않음, 채운 뒤 중괄호 없음(LF 는 허용)
        IF jsonb_typeof(v_target_json) IS DISTINCT FROM 'string' THEN
          RETURN NULL;
        END IF;
        v_body := v_target_json #>> '{}';
        IF v_body !~ '[^ \t\n\r]' THEN
          RETURN NULL;
        END IF;
        IF (CASE p_kind WHEN 'market' THEN replace(v_body, '{자료환불기간}', '')
            ELSE replace(replace(v_body, '{충전환불기간}', ''), '{충전유효기간}', '') END) ~ '[{}]' THEN
          RETURN NULL;
        END IF;
        v_texts_out := v_texts_out || to_jsonb(CASE p_kind
          WHEN 'market' THEN replace(v_body, '{자료환불기간}', v_days)
          ELSE replace(replace(v_body, '{충전환불기간}', v_days), '{충전유효기간}', c_years) END);
      END LOOP;
      v_items_out := v_items_out || jsonb_build_array(jsonb_build_object(
        'key', v_key,
        'label', CASE p_kind WHEN 'market' THEN replace(v_item ->> 'label', '{자료환불기간}', v_days)
                 ELSE replace(replace(v_item ->> 'label', '{충전환불기간}', v_days), '{충전유효기간}', c_years) END,
        'view', 'text',
        'texts', v_texts_out));
    ELSE
      IF jsonb_typeof(v_item -> 'link') IS DISTINCT FROM 'string' THEN
        RETURN NULL;
      END IF;
      v_link := v_item ->> 'link';
      IF v_link NOT IN ('refundPolicy', 'serviceTerms') OR v_link = ANY (v_used_links) THEN
        RETURN NULL;
      END IF;
      v_used_links := v_used_links || v_link;
      v_items_out := v_items_out || jsonb_build_array(jsonb_build_object(
        'key', v_key,
        'label', CASE p_kind WHEN 'market' THEN replace(v_item ->> 'label', '{자료환불기간}', v_days)
                 ELSE replace(replace(v_item ->> 'label', '{충전환불기간}', v_days), '{충전유효기간}', c_years) END,
        'view', 'link',
        'link', v_link));
    END IF;
  END LOOP;

  -- (f) 포함: 필수 본문과 두 링크
  IF NOT (v_required_targets <@ v_used_targets) OR NOT (ARRAY['refundPolicy', 'serviceTerms'] <@ v_used_links) THEN
    RETURN NULL;
  END IF;

  -- (S)(S1)(c) 한 줄 칸(제목·요약 줄·항목 이름): 1~최대 글자(채우기 전 코드포인트), 비지 않음, LF 없음, 채운 뒤 중괄호 없음, 숫자·기간 낱말 없음
  FOR i IN 1 .. array_length(v_one_line, 1) LOOP
    v_line := v_one_line[i];
    IF char_length(v_line) < 1 OR char_length(v_line) > v_one_line_max[i]
       OR v_line !~ '[^ \t\n\r]'
       OR strpos(v_line, chr(10)) > 0
       OR (CASE p_kind WHEN 'market' THEN replace(v_line, '{자료환불기간}', '')
           ELSE replace(replace(v_line, '{충전환불기간}', ''), '{충전유효기간}', '') END) ~ '[{}]'
       OR v_line ~ '[0-9０-９]'
       OR v_line ~ '([일이삼사오육칠팔구십백]+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|서른)[ \t\n]*(일째|일|년|개월|달|주일|주|시간)'
       OR v_line ~ '(하루|이틀|사흘|나흘|열흘|보름|한 해)' THEN
      RETURN NULL;
    END IF;
  END LOOP;

  -- (g) 링크 문서가 보여야 함: 원본 객체, enabled 정확히 true, label·content 비지 않은 글자, 사본 하나 이상
  SELECT s.value INTO v_footer FROM public.system_settings s WHERE s.key = 'site_footer_content';
  FOREACH v_link IN ARRAY ARRAY['refundPolicy', 'serviceTerms'] LOOP
    v_doc := v_footer -> 'policyDocuments' -> v_link;
    IF jsonb_typeof(v_doc) IS DISTINCT FROM 'object'
       OR (v_doc -> 'enabled') IS DISTINCT FROM 'true'::jsonb
       OR jsonb_typeof(v_doc -> 'label') IS DISTINCT FROM 'string' OR (v_doc ->> 'label') !~ '[^ \t\n\r]'
       OR jsonb_typeof(v_doc -> 'content') IS DISTINCT FROM 'string' OR (v_doc ->> 'content') !~ '[^ \t\n\r]'
       OR NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots d WHERE d.doc_key = v_link) THEN
      RETURN NULL;
    END IF;
  END LOOP;

  -- 원문(5-1): 제목, 요약 줄, 항목마다 이름 + (본문들 | '링크:' + 키), LF 로 잇는다(끝 LF 없음, trim·정규화 없음)
  v_lines := ARRAY[CASE p_kind WHEN 'market' THEN replace(p_value ->> 'consentTitle', '{자료환불기간}', v_days)
                   ELSE replace(replace(p_value ->> 'consentTitle', '{충전환불기간}', v_days), '{충전유효기간}', c_years) END];
  v_lines := v_lines || ARRAY(SELECT e.value #>> '{}' FROM jsonb_array_elements(v_summary_out) WITH ORDINALITY AS e(value, n) ORDER BY e.n);
  FOR v_item IN SELECT e.value FROM jsonb_array_elements(v_items_out) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    v_lines := v_lines || (v_item ->> 'label');
    IF v_item ->> 'view' = 'text' THEN
      v_lines := v_lines || ARRAY(SELECT t.value #>> '{}' FROM jsonb_array_elements(v_item -> 'texts') WITH ORDINALITY AS t(value, n) ORDER BY t.n);
    ELSE
      v_lines := v_lines || ('링크:' || (v_item ->> 'link'));
    END IF;
  END LOOP;
  v_text := array_to_string(v_lines, chr(10));
  v_details := jsonb_build_object(
    'consentFormat', 2,
    'consentTitle', v_lines[1],
    'consentSummary', v_summary_out,
    'consentItems', v_items_out,
    'noticeSha256', encode(sha256(convert_to(v_text, 'UTF8')), 'hex'),
    'refundDays', p_refund_days);
  RETURN jsonb_build_object('text', v_text, 'details', v_details);
END;
$fn_build_checkout_consent_v2$;
REVOKE ALL ON FUNCTION public.build_checkout_consent_v2(text, jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;

-- 4. 자료 구매 고지 동의 기록(3인자 → 4인자). 같은 거래에서 옛 서명을 지우고 만든다(다시 실행해도 멈추지 않음). ------------------
DROP FUNCTION IF EXISTS public.record_purchase_notice_ack(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.record_purchase_notice_ack(p_user_id uuid, p_idempotency_key uuid, p_notice_sha256 text, p_cart_texts_sha256 text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing_sha text;
  v_value jsonb;
  v_days_numeric numeric;
  v_days integer;
  v_label text;
  v_notice text;
  v_text text;
  v_sha text;
  v_inserted_id uuid;
  v_details jsonb;
  -- [11번] 시작
  v_existing_format smallint;
  v_existing_cart text;
  v_format smallint;
  v_built jsonb;
  v_cart jsonb;
  v_refund_doc text;
  v_terms_doc text;
  -- [11번] 끝
BEGIN
  -- ① 입력 검사
  IF p_user_id IS NULL OR p_idempotency_key IS NULL OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$'
     -- [11번] 시작
     OR (p_cart_texts_sha256 IS NOT NULL AND p_cart_texts_sha256 !~ '^[0-9a-f]{64}$') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID', 'consentFormat', NULL);
    -- [11번] 끝
  END IF;

  -- ② 같은 키로 이미 기록했고 지문이 같으면 그대로 통과(402 뒤 다시 누르기, 503 뒤 재시도)
  -- [11번] 장바구니 문구 지문도 같아야 한다(NULL 끼리도 같음 — 옛 코드의 재시도가 replay 로 끝나게)
  SELECT a.notice_sha256, a.consent_format, a.consent_details -> 'cartTexts' ->> 'cartTextsSha256'
    INTO v_existing_sha, v_existing_format, v_existing_cart
    FROM public.market_purchase_notice_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  IF FOUND AND v_existing_sha = p_notice_sha256 AND v_existing_cart IS NOT DISTINCT FROM p_cart_texts_sha256 THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing_format);
  END IF;

  -- ③ 지금 정책: 판(consentFormat), refundDays 는 숫자·정수·양수
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'market_purchase_policy';
  -- [11번] 시작: 판 — 없거나 숫자 1 → 1, 숫자 2 → 2, 그 밖 → 닫힘(consentFormat null)
  v_format := CASE
    WHEN v_value IS NULL OR jsonb_typeof(v_value) <> 'object' THEN NULL
    WHEN NOT (v_value ? 'consentFormat') THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 1 THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 2 THEN 2
  END;
  IF v_format IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', NULL);
  END IF;
  -- [11번] 끝
  IF jsonb_typeof(v_value -> 'refundDays') IS DISTINCT FROM 'number' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', v_format);
  END IF;
  v_days_numeric := (v_value ->> 'refundDays')::numeric;
  IF v_days_numeric <> trunc(v_days_numeric) OR v_days_numeric <= 0 OR v_days_numeric > 3650 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', v_format);
  END IF;
  v_days := v_days_numeric::integer;
  -- [11번] 시작: 장바구니 문구(판과 관계없음)
  v_cart := public.build_market_cart_texts(v_value);
  IF v_format = 2 THEN
    -- 2판: 묶음(문구·링크 문서 검사 포함)과 두 문서 지문. 사본이 없으면 NULL 로 두지 않고 닫는다.
    v_built := public.build_checkout_consent_v2('market', v_value, v_days);
    SELECT d.content_sha256 INTO v_refund_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'refundPolicy' ORDER BY d.seq DESC LIMIT 1;
    SELECT d.content_sha256 INTO v_terms_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'serviceTerms' ORDER BY d.seq DESC LIMIT 1;
    IF v_built IS NULL OR v_refund_doc IS NULL OR v_terms_doc IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_text := v_built ->> 'text';
    v_details := v_built -> 'details';
    v_sha := v_details ->> 'noticeSha256';
  ELSE
  -- [11번] 끝
    -- 1판: 두 문구는 비어 있지 않은 글자(지금 규칙 그대로)
    IF jsonb_typeof(v_value -> 'checkboxLabel') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_value -> 'confirmNotice') IS DISTINCT FROM 'string' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_label := replace(v_value ->> 'checkboxLabel', '{자료환불기간}', v_days::text);
    v_notice := replace(v_value ->> 'confirmNotice', '{자료환불기간}', v_days::text);
    IF btrim(v_label) = '' OR btrim(v_notice) = '' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_text := v_label || chr(10) || v_notice;
    v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
    v_details := jsonb_build_object('checkboxLabel', v_label, 'confirmNotice', v_notice, 'noticeSha256', v_sha, 'refundDays', v_days,
                                    'consentFormat', 1);
  END IF;

  -- ④ 같은 키를 다른 화면(지문)으로 다시 쓰면 거절 — 화면은 새 키를 만든다
  IF v_existing_sha IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;

  -- ⑤ 화면에 보인 문구가 지금 문구와 다르면 거절
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;
  -- [11번] 시작: 화면에 보인 장바구니 문구가 지금 문구와 다르거나 지금 문구가 규칙 위반이면 기록하지 않고 거절(인자 NULL = 옛 코드는 지금처럼 기록)
  IF p_cart_texts_sha256 IS NOT NULL AND (v_cart IS NULL OR (v_cart ->> 'cartTextsSha256') <> p_cart_texts_sha256) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;
  -- [11번] 끝

  -- ⑥ 기록
  INSERT INTO public.market_purchase_notice_acks (user_id, idempotency_key, notice_sha256, notice_text, refund_days,
                                                  consent_format, refund_policy_sha256, terms_policy_sha256, consent_details)
  VALUES (p_user_id, p_idempotency_key, v_sha, v_text, v_days,
          v_format, CASE WHEN v_format = 2 THEN v_refund_doc END, CASE WHEN v_format = 2 THEN v_terms_doc END,
          CASE WHEN v_format = 2
               THEN jsonb_build_object('cartTexts', CASE WHEN p_cart_texts_sha256 IS NULL THEN NULL ELSE v_cart END,
                                       'consent', v_details - 'noticeSha256' - 'plan')
               ELSE jsonb_build_object('cartTexts', CASE WHEN p_cart_texts_sha256 IS NULL THEN NULL ELSE v_cart END) END)
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted_id;
  IF v_inserted_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false, 'consentFormat', v_format);
  END IF;

  SELECT a.notice_sha256, a.consent_format, a.consent_details -> 'cartTexts' ->> 'cartTextsSha256'
    INTO v_existing_sha, v_existing_format, v_existing_cart
    FROM public.market_purchase_notice_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  IF v_existing_sha = p_notice_sha256 AND v_existing_cart IS NOT DISTINCT FROM p_cart_texts_sha256 THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing_format);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_purchase_notice_ack(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_purchase_notice_ack(uuid, uuid, text, text) TO service_role;

-- 5. 충전 결제 전 확인 동의 기록(6인자 그대로). 탈퇴 거절은 맨 앞 그대로. ----------------------------------------------
CREATE OR REPLACE FUNCTION public.record_point_charge_checkout_ack(p_user_id uuid, p_checkout_attempt_id uuid, p_plan_id uuid, p_expected_amount integer, p_expected_credits integer, p_notice_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing public.point_charge_checkout_acks%ROWTYPE;
  v_value jsonb;
  v_items jsonb;
  v_days integer;
  v_parts text[];
  v_part text;
  v_key text;
  v_text text;
  v_sha text;
  v_plan public.pricing_plans%ROWTYPE;
  v_details jsonb;
  v_policy_sha text;
  v_inserted uuid;
  -- [11번] 시작
  v_format smallint;
  v_built jsonb;
  v_terms_doc text;
  -- [11번] 끝
BEGIN
  IF p_user_id IS NULL OR p_checkout_attempt_id IS NULL OR p_plan_id IS NULL OR p_expected_amount IS NULL OR p_expected_credits IS NULL
     OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID', 'consentFormat', NULL);
  END IF;
  -- [10번] 시작
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.withdrawn_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MEMBER_WITHDRAWN', 'consentFormat', NULL);
  END IF;
  -- [10번] 끝

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;

  -- 지금 정책(필수 키·자리표시 규칙 — TS 저장 검사와 같음)
  v_days := public.point_charge_refund_days();
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'point_charge_policy';
  -- [11번] 시작: 판 — 없거나 숫자 1 → 1, 숫자 2 → 2, 그 밖 → 닫힘(consentFormat null)
  v_format := CASE
    WHEN v_value IS NULL OR jsonb_typeof(v_value) <> 'object' THEN NULL
    WHEN NOT (v_value ? 'consentFormat') THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 1 THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 2 THEN 2
  END;
  IF v_format IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', NULL);
  END IF;
  SELECT * INTO v_plan FROM public.pricing_plans p WHERE p.id = p_plan_id;
  IF v_format = 2 THEN
    -- 2판: 묶음(문구·링크 문서 검사 포함)과 이용약관 문서 지문. 사본이 없으면 NULL 로 두지 않고 닫는다.
    IF v_days IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_built := public.build_checkout_consent_v2('point_charge', v_value, v_days);
    SELECT d.content_sha256 INTO v_terms_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'serviceTerms' ORDER BY d.seq DESC LIMIT 1;
    IF v_built IS NULL OR v_terms_doc IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots d WHERE d.doc_key = 'refundPolicy') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_text := v_built ->> 'text';
    v_sha := v_built #>> '{details,noticeSha256}';
    v_details := (v_built -> 'details') || jsonb_build_object(
      'plan', CASE WHEN v_plan.id IS NULL THEN NULL ELSE jsonb_build_object('price', v_plan.price, 'credits', v_plan.credits) END);
  ELSE
  -- [11번] 끝
    v_items := v_value -> 'checkoutItems';
    IF v_days IS NULL OR jsonb_typeof(v_items) IS DISTINCT FROM 'object' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_parts := ARRAY[v_value ->> 'checkoutTitle', v_items ->> 'product', v_items ->> 'validity', v_items ->> 'refund',
                     v_items ->> 'restriction', v_items ->> 'otherCases', v_value ->> 'minorNotice', v_value ->> 'agreeLabel'];
    FOREACH v_part IN ARRAY v_parts LOOP
      IF v_part IS NULL OR v_part !~ '\S' OR replace(v_part, '{충전환불기간}', '') ~ '[{}]' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
      END IF;
    END LOOP;
    IF strpos(v_items ->> 'refund', '{충전환불기간}') = 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_text := array_to_string(ARRAY(SELECT replace(x, '{충전환불기간}', v_days::text) FROM unnest(v_parts) WITH ORDINALITY AS t(x, n) ORDER BY n), chr(10));
    v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');

    v_details := jsonb_build_object(
      'checkoutTitle', replace(v_value ->> 'checkoutTitle', '{충전환불기간}', v_days::text),
      'checkoutItems', jsonb_build_object(
        'product', replace(v_items ->> 'product', '{충전환불기간}', v_days::text),
        'validity', replace(v_items ->> 'validity', '{충전환불기간}', v_days::text),
        'refund', replace(v_items ->> 'refund', '{충전환불기간}', v_days::text),
        'restriction', replace(v_items ->> 'restriction', '{충전환불기간}', v_days::text),
        'otherCases', replace(v_items ->> 'otherCases', '{충전환불기간}', v_days::text)),
      'minorNotice', replace(v_value ->> 'minorNotice', '{충전환불기간}', v_days::text),
      'agreeLabel', replace(v_value ->> 'agreeLabel', '{충전환불기간}', v_days::text),
      'noticeSha256', v_sha, 'refundDays', v_days,
      'plan', CASE WHEN v_plan.id IS NULL THEN NULL ELSE jsonb_build_object('price', v_plan.price, 'credits', v_plan.credits) END,
      'consentFormat', 1);
  END IF;

  IF v_plan.id IS NULL OR NOT v_plan.is_active THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_UNAVAILABLE', 'details', v_details, 'consentFormat', v_format);
  END IF;
  IF v_plan.price <> p_expected_amount OR v_plan.credits <> p_expected_credits THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_CHANGED', 'details', v_details, 'consentFormat', v_format);
  END IF;
  -- 같은 시도의 재요청: 요금제가 그대로일 때만(위 검사 뒤) 같은 기록으로 본다.
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
       AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
      RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing.consent_format);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'consentFormat', v_format);
  END IF;
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'consentFormat', v_format);
  END IF;

  SELECT s.content_sha256 INTO v_policy_sha FROM public.policy_document_snapshots s
   WHERE s.doc_key = 'refundPolicy' ORDER BY s.seq DESC LIMIT 1;

  INSERT INTO public.point_charge_checkout_acks (user_id, checkout_attempt_id, plan_id, plan_name, amount, credits, refund_days,
                                                 notice_text, notice_sha256, refund_policy_sha256,
                                                 terms_policy_sha256, consent_format, consent_details)
  VALUES (p_user_id, p_checkout_attempt_id, v_plan.id, v_plan.name, v_plan.price, v_plan.credits, v_days, v_text, v_sha, v_policy_sha,
          CASE WHEN v_format = 2 THEN v_terms_doc END, v_format,
          CASE WHEN v_format = 2 THEN jsonb_build_object('consent', v_details - 'noticeSha256' - 'plan') END)
  ON CONFLICT (user_id, checkout_attempt_id) DO NOTHING
  RETURNING id INTO v_inserted;
  IF v_inserted IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false, 'consentFormat', v_format);
  END IF;

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;
  IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
     AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing.consent_format);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'consentFormat', v_format);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_point_charge_checkout_ack(uuid, uuid, uuid, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_point_charge_checkout_ack(uuid, uuid, uuid, integer, integer, text) TO service_role;
-- [11번] 끝 -----------------------------------------------------------------------------------------------------

-- 6. VERIFY ------------------------------------------------------------------------------------------------------
DO $verify_checkout_consent_v2$
DECLARE
  v_new text[][] := ARRAY[
    ARRAY['public.record_purchase_notice_ack(uuid,uuid,text,text)', '9d2cb23a7aa16e45970525248bcc4435', '{postgres=X/postgres,service_role=X/postgres}'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', '4b23fdf6b9c7bcf76e39ee5b7b1a629f', '{postgres=X/postgres,service_role=X/postgres}'],
    ARRAY['public.build_checkout_consent_v2(text,jsonb,integer)', '3fd97051955741db213297804131c1e3', '{postgres=X/postgres}'],
    ARRAY['public.build_market_cart_texts(jsonb)', '604251e0a0b5f85b58aaeccb0c593d05', '{postgres=X/postgres}']
  ];
  v_vector jsonb := $vector${
    "consentFormat": 2, "consentTitle": "주문 내용·충전 조건 확인 및 결제 동의",
    "consentSummary": {"refundPeriod": "{충전환불기간}일째 되는 날까지 신청할 수 있어요.", "restriction": "하나라도 쓰면 취소할 수 없어요.",
                       "validity": "{충전유효기간}년 동안 쓸 수 있어요.", "minor": "미성년자는 취소할 수 있어요."},
    "checkoutItems": {"product": "상품 A", "validity": "기간 B", "refund": "환불 {충전환불기간}일\n둘째 줄", "restriction": "제한 C", "otherCases": "기타 D"},
    "minorNotice": "미성년 E",
    "consentItems": [
      {"key": "product", "label": "충전 상품 안내", "view": "text", "textKeys": ["checkoutItems.product", "checkoutItems.validity"]},
      {"key": "refund", "label": "취소·환불 안내", "view": "text", "textKeys": ["checkoutItems.refund", "checkoutItems.restriction", "checkoutItems.otherCases"]},
      {"key": "minor", "label": "미성년자 결제 취소 안내", "view": "text", "textKeys": ["minorNotice"]},
      {"key": "refundPolicy", "label": "취소·환불정책", "view": "link", "link": "refundPolicy"},
      {"key": "terms", "label": "서비스 이용약관", "view": "link", "link": "serviceTerms"}]}$vector$;
  v_links_visible boolean;
  v_result jsonb;
  v_sig text;
  i integer;
BEGIN
  IF to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: 3-argument record_purchase_notice_ack must be gone';
  END IF;
  FOR i IN 1 .. array_length(v_new, 1) LOOP
    v_sig := v_new[i][1];
    IF to_regprocedure(v_sig) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_sig))) <> v_new[i][2] THEN
      RAISE EXCEPTION 'VERIFY: % md5 (%)', v_sig, md5(pg_get_functiondef(to_regprocedure(v_sig)));
    END IF;
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v_sig)) IS DISTINCT FROM v_new[i][3] THEN
      RAISE EXCEPTION 'VERIFY: % ACL (%)', v_sig, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v_sig));
    END IF;
    IF has_function_privilege('anon', v_sig, 'EXECUTE') OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % must not be executable by API roles', v_sig;
    END IF;
  END LOOP;
  IF has_function_privilege('service_role', 'public.build_checkout_consent_v2(text,jsonb,integer)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.build_market_cart_texts(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: internal builders must not be executable by service_role';
  END IF;

  -- 칸·CHECK
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_purchase_notice_acks'
       AND column_name IN ('refund_policy_sha256', 'terms_policy_sha256', 'consent_format', 'consent_details')) < 0
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'point_charge_checkout_acks'
       AND column_name IN ('terms_policy_sha256', 'consent_format', 'consent_details')) < 0
     OR (SELECT count(*) FROM pg_constraint WHERE conname IN ('market_purchase_notice_acks_consent_format_check',
                                                              'point_charge_checkout_acks_consent_format_check')) < 0 THEN
    RAISE EXCEPTION 'VERIFY: consent columns / checks';
  END IF;

  -- 옛 코드 호출(이름 인자 3개·6인자)은 입력 검사에서 consentFormat null 키와 함께 돌아온다(기록 없음).
  v_result := public.record_purchase_notice_ack(p_user_id => NULL, p_idempotency_key => NULL, p_notice_sha256 => 'x');
  IF v_result ->> 'code' IS DISTINCT FROM 'NOTICE_INPUT_INVALID' OR NOT (v_result ? 'consentFormat') OR (v_result -> 'consentFormat') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'VERIFY: market 3 named arguments → %', v_result;
  END IF;
  v_result := public.record_point_charge_checkout_ack(NULL, NULL, NULL, NULL, NULL, 'x');
  IF v_result ->> 'code' IS DISTINCT FROM 'NOTICE_INPUT_INVALID' OR NOT (v_result ? 'consentFormat') THEN
    RAISE EXCEPTION 'VERIFY: point charge 6 arguments → %', v_result;
  END IF;

  -- 5-1 시험 벡터(링크 문서가 보일 때만 — 닫혀 있으면 NULL 이어야 함)
  SELECT bool_and(jsonb_typeof(d) = 'object' AND (d -> 'enabled') = 'true'::jsonb
                  AND jsonb_typeof(d -> 'label') = 'string' AND (d ->> 'label') ~ '[^ \t\n\r]'
                  AND jsonb_typeof(d -> 'content') = 'string' AND (d ->> 'content') ~ '[^ \t\n\r]'
                  AND EXISTS (SELECT 1 FROM public.policy_document_snapshots s WHERE s.doc_key = k))
    INTO v_links_visible
    FROM public.system_settings ss, unnest(ARRAY['refundPolicy', 'serviceTerms']) k, LATERAL (SELECT ss.value -> 'policyDocuments' -> k AS d) x
   WHERE ss.key = 'site_footer_content';
  v_result := public.build_checkout_consent_v2('point_charge', v_vector, 7);
  IF v_links_visible IS TRUE THEN
    IF v_result #>> '{details,noticeSha256}' IS DISTINCT FROM '2e53f470c92dfba92ee637f86c592f5b5545b46ef37b883eb856f30c7bc56cd7'
       OR encode(sha256(convert_to(v_result ->> 'text', 'UTF8')), 'hex') IS DISTINCT FROM '2e53f470c92dfba92ee637f86c592f5b5545b46ef37b883eb856f30c7bc56cd7' THEN
      RAISE EXCEPTION 'VERIFY: consent vector → %', left(coalesce(v_result::text, 'NULL'), 600);
    END IF;
  ELSIF v_result IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: consent builder must close when link documents are hidden';
  END IF;
  -- 장바구니 문구 지문(앞뒤 공백 그대로, trim 없음)
  v_result := public.build_market_cart_texts(jsonb_build_object('cartCheckoutNotice', ' 앞 공백 안내', 'partialOwnedConfirmLabel', '뒤 공백 확인 '));
  IF v_result ->> 'cartTextsSha256' IS DISTINCT FROM encode(sha256(convert_to(' 앞 공백 안내' || chr(10) || '뒤 공백 확인 ', 'UTF8')), 'hex')
     OR public.build_market_cart_texts(jsonb_build_object('cartCheckoutNotice', '줄' || chr(10) || '바꿈', 'partialOwnedConfirmLabel', 'x')) IS NOT NULL
     OR public.build_market_cart_texts(jsonb_build_object('cartCheckoutNotice', '{x}', 'partialOwnedConfirmLabel', 'x')) IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: cart texts builder';
  END IF;
END;
$verify_checkout_consent_v2$;

NOTIFY pgrst, 'reload schema';


-- ===== light: 실제 기록 표와 같은 칸(11번 칸 포함)의 임시 표, 그 표에 쓰는 기록 함수 사본(본문은 마이그레이션 그대로) =====
CREATE TEMP TABLE rh_market_acks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, idempotency_key uuid NOT NULL,
  notice_sha256 text NOT NULL, notice_text text NOT NULL, refund_days integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  refund_policy_sha256 text, terms_policy_sha256 text, consent_format smallint NOT NULL DEFAULT 1 CHECK (consent_format IN (1, 2)), consent_details jsonb,
  UNIQUE (user_id, idempotency_key)) ON COMMIT DROP;
CREATE TEMP TABLE rh_charge_acks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, checkout_attempt_id uuid NOT NULL, plan_id uuid NOT NULL,
  plan_name text NOT NULL, amount integer NOT NULL, credits integer NOT NULL, refund_days integer NOT NULL,
  notice_text text NOT NULL, notice_sha256 text NOT NULL, refund_policy_sha256 text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  terms_policy_sha256 text, consent_format smallint NOT NULL DEFAULT 1 CHECK (consent_format IN (1, 2)), consent_details jsonb,
  UNIQUE (user_id, checkout_attempt_id)) ON COMMIT DROP;
CREATE FUNCTION pg_temp.rh_rec_m(p_user_id uuid, p_idempotency_key uuid, p_notice_sha256 text, p_cart_texts_sha256 text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing_sha text;
  v_value jsonb;
  v_days_numeric numeric;
  v_days integer;
  v_label text;
  v_notice text;
  v_text text;
  v_sha text;
  v_inserted_id uuid;
  v_details jsonb;
  -- [11번] 시작
  v_existing_format smallint;
  v_existing_cart text;
  v_format smallint;
  v_built jsonb;
  v_cart jsonb;
  v_refund_doc text;
  v_terms_doc text;
  -- [11번] 끝
BEGIN
  -- ① 입력 검사
  IF p_user_id IS NULL OR p_idempotency_key IS NULL OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$'
     -- [11번] 시작
     OR (p_cart_texts_sha256 IS NOT NULL AND p_cart_texts_sha256 !~ '^[0-9a-f]{64}$') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID', 'consentFormat', NULL);
    -- [11번] 끝
  END IF;

  -- ② 같은 키로 이미 기록했고 지문이 같으면 그대로 통과(402 뒤 다시 누르기, 503 뒤 재시도)
  -- [11번] 장바구니 문구 지문도 같아야 한다(NULL 끼리도 같음 — 옛 코드의 재시도가 replay 로 끝나게)
  SELECT a.notice_sha256, a.consent_format, a.consent_details -> 'cartTexts' ->> 'cartTextsSha256'
    INTO v_existing_sha, v_existing_format, v_existing_cart
    FROM pg_temp.rh_market_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  IF FOUND AND v_existing_sha = p_notice_sha256 AND v_existing_cart IS NOT DISTINCT FROM p_cart_texts_sha256 THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing_format);
  END IF;

  -- ③ 지금 정책: 판(consentFormat), refundDays 는 숫자·정수·양수
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'market_purchase_policy';
  -- [11번] 시작: 판 — 없거나 숫자 1 → 1, 숫자 2 → 2, 그 밖 → 닫힘(consentFormat null)
  v_format := CASE
    WHEN v_value IS NULL OR jsonb_typeof(v_value) <> 'object' THEN NULL
    WHEN NOT (v_value ? 'consentFormat') THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 1 THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 2 THEN 2
  END;
  IF v_format IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', NULL);
  END IF;
  -- [11번] 끝
  IF jsonb_typeof(v_value -> 'refundDays') IS DISTINCT FROM 'number' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', v_format);
  END IF;
  v_days_numeric := (v_value ->> 'refundDays')::numeric;
  IF v_days_numeric <> trunc(v_days_numeric) OR v_days_numeric <= 0 OR v_days_numeric > 3650 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', v_format);
  END IF;
  v_days := v_days_numeric::integer;
  -- [11번] 시작: 장바구니 문구(판과 관계없음)
  v_cart := public.build_market_cart_texts(v_value);
  IF v_format = 2 THEN
    -- 2판: 묶음(문구·링크 문서 검사 포함)과 두 문서 지문. 사본이 없으면 NULL 로 두지 않고 닫는다.
    v_built := public.build_checkout_consent_v2('market', v_value, v_days);
    SELECT d.content_sha256 INTO v_refund_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'refundPolicy' ORDER BY d.seq DESC LIMIT 1;
    SELECT d.content_sha256 INTO v_terms_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'serviceTerms' ORDER BY d.seq DESC LIMIT 1;
    IF v_built IS NULL OR v_refund_doc IS NULL OR v_terms_doc IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_text := v_built ->> 'text';
    v_details := v_built -> 'details';
    v_sha := v_details ->> 'noticeSha256';
  ELSE
  -- [11번] 끝
    -- 1판: 두 문구는 비어 있지 않은 글자(지금 규칙 그대로)
    IF jsonb_typeof(v_value -> 'checkboxLabel') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_value -> 'confirmNotice') IS DISTINCT FROM 'string' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_label := replace(v_value ->> 'checkboxLabel', '{자료환불기간}', v_days::text);
    v_notice := replace(v_value ->> 'confirmNotice', '{자료환불기간}', v_days::text);
    IF btrim(v_label) = '' OR btrim(v_notice) = '' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_text := v_label || chr(10) || v_notice;
    v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
    v_details := jsonb_build_object('checkboxLabel', v_label, 'confirmNotice', v_notice, 'noticeSha256', v_sha, 'refundDays', v_days,
                                    'consentFormat', 1);
  END IF;

  -- ④ 같은 키를 다른 화면(지문)으로 다시 쓰면 거절 — 화면은 새 키를 만든다
  IF v_existing_sha IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;

  -- ⑤ 화면에 보인 문구가 지금 문구와 다르면 거절
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;
  -- [11번] 시작: 화면에 보인 장바구니 문구가 지금 문구와 다르거나 지금 문구가 규칙 위반이면 기록하지 않고 거절(인자 NULL = 옛 코드는 지금처럼 기록)
  IF p_cart_texts_sha256 IS NOT NULL AND (v_cart IS NULL OR (v_cart ->> 'cartTextsSha256') <> p_cart_texts_sha256) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;
  -- [11번] 끝

  -- ⑥ 기록
  INSERT INTO pg_temp.rh_market_acks (user_id, idempotency_key, notice_sha256, notice_text, refund_days,
                                                  consent_format, refund_policy_sha256, terms_policy_sha256, consent_details)
  VALUES (p_user_id, p_idempotency_key, v_sha, v_text, v_days,
          v_format, CASE WHEN v_format = 2 THEN v_refund_doc END, CASE WHEN v_format = 2 THEN v_terms_doc END,
          CASE WHEN v_format = 2
               THEN jsonb_build_object('cartTexts', CASE WHEN p_cart_texts_sha256 IS NULL THEN NULL ELSE v_cart END,
                                       'consent', v_details - 'noticeSha256' - 'plan')
               ELSE jsonb_build_object('cartTexts', CASE WHEN p_cart_texts_sha256 IS NULL THEN NULL ELSE v_cart END) END)
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted_id;
  IF v_inserted_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false, 'consentFormat', v_format);
  END IF;

  SELECT a.notice_sha256, a.consent_format, a.consent_details -> 'cartTexts' ->> 'cartTextsSha256'
    INTO v_existing_sha, v_existing_format, v_existing_cart
    FROM pg_temp.rh_market_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  IF v_existing_sha = p_notice_sha256 AND v_existing_cart IS NOT DISTINCT FROM p_cart_texts_sha256 THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing_format);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
END;
$function$;
CREATE FUNCTION pg_temp.rh_rec_p(p_user_id uuid, p_checkout_attempt_id uuid, p_plan_id uuid, p_expected_amount integer, p_expected_credits integer, p_notice_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing pg_temp.rh_charge_acks%ROWTYPE;
  v_value jsonb;
  v_items jsonb;
  v_days integer;
  v_parts text[];
  v_part text;
  v_key text;
  v_text text;
  v_sha text;
  v_plan public.pricing_plans%ROWTYPE;
  v_details jsonb;
  v_policy_sha text;
  v_inserted uuid;
  -- [11번] 시작
  v_format smallint;
  v_built jsonb;
  v_terms_doc text;
  -- [11번] 끝
BEGIN
  IF p_user_id IS NULL OR p_checkout_attempt_id IS NULL OR p_plan_id IS NULL OR p_expected_amount IS NULL OR p_expected_credits IS NULL
     OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID', 'consentFormat', NULL);
  END IF;
  -- [10번] 시작
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.withdrawn_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MEMBER_WITHDRAWN', 'consentFormat', NULL);
  END IF;
  -- [10번] 끝

  SELECT * INTO v_existing FROM pg_temp.rh_charge_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;

  -- 지금 정책(필수 키·자리표시 규칙 — TS 저장 검사와 같음)
  v_days := public.point_charge_refund_days();
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'point_charge_policy';
  -- [11번] 시작: 판 — 없거나 숫자 1 → 1, 숫자 2 → 2, 그 밖 → 닫힘(consentFormat null)
  v_format := CASE
    WHEN v_value IS NULL OR jsonb_typeof(v_value) <> 'object' THEN NULL
    WHEN NOT (v_value ? 'consentFormat') THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 1 THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 2 THEN 2
  END;
  IF v_format IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', NULL);
  END IF;
  SELECT * INTO v_plan FROM public.pricing_plans p WHERE p.id = p_plan_id;
  IF v_format = 2 THEN
    -- 2판: 묶음(문구·링크 문서 검사 포함)과 이용약관 문서 지문. 사본이 없으면 NULL 로 두지 않고 닫는다.
    IF v_days IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_built := public.build_checkout_consent_v2('point_charge', v_value, v_days);
    SELECT d.content_sha256 INTO v_terms_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'serviceTerms' ORDER BY d.seq DESC LIMIT 1;
    IF v_built IS NULL OR v_terms_doc IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots d WHERE d.doc_key = 'refundPolicy') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_text := v_built ->> 'text';
    v_sha := v_built #>> '{details,noticeSha256}';
    v_details := (v_built -> 'details') || jsonb_build_object(
      'plan', CASE WHEN v_plan.id IS NULL THEN NULL ELSE jsonb_build_object('price', v_plan.price, 'credits', v_plan.credits) END);
  ELSE
  -- [11번] 끝
    v_items := v_value -> 'checkoutItems';
    IF v_days IS NULL OR jsonb_typeof(v_items) IS DISTINCT FROM 'object' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_parts := ARRAY[v_value ->> 'checkoutTitle', v_items ->> 'product', v_items ->> 'validity', v_items ->> 'refund',
                     v_items ->> 'restriction', v_items ->> 'otherCases', v_value ->> 'minorNotice', v_value ->> 'agreeLabel'];
    FOREACH v_part IN ARRAY v_parts LOOP
      IF v_part IS NULL OR v_part !~ '\S' OR replace(v_part, '{충전환불기간}', '') ~ '[{}]' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
      END IF;
    END LOOP;
    IF strpos(v_items ->> 'refund', '{충전환불기간}') = 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_text := array_to_string(ARRAY(SELECT replace(x, '{충전환불기간}', v_days::text) FROM unnest(v_parts) WITH ORDINALITY AS t(x, n) ORDER BY n), chr(10));
    v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');

    v_details := jsonb_build_object(
      'checkoutTitle', replace(v_value ->> 'checkoutTitle', '{충전환불기간}', v_days::text),
      'checkoutItems', jsonb_build_object(
        'product', replace(v_items ->> 'product', '{충전환불기간}', v_days::text),
        'validity', replace(v_items ->> 'validity', '{충전환불기간}', v_days::text),
        'refund', replace(v_items ->> 'refund', '{충전환불기간}', v_days::text),
        'restriction', replace(v_items ->> 'restriction', '{충전환불기간}', v_days::text),
        'otherCases', replace(v_items ->> 'otherCases', '{충전환불기간}', v_days::text)),
      'minorNotice', replace(v_value ->> 'minorNotice', '{충전환불기간}', v_days::text),
      'agreeLabel', replace(v_value ->> 'agreeLabel', '{충전환불기간}', v_days::text),
      'noticeSha256', v_sha, 'refundDays', v_days,
      'plan', CASE WHEN v_plan.id IS NULL THEN NULL ELSE jsonb_build_object('price', v_plan.price, 'credits', v_plan.credits) END,
      'consentFormat', 1);
  END IF;

  IF v_plan.id IS NULL OR NOT v_plan.is_active THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_UNAVAILABLE', 'details', v_details, 'consentFormat', v_format);
  END IF;
  IF v_plan.price <> p_expected_amount OR v_plan.credits <> p_expected_credits THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_CHANGED', 'details', v_details, 'consentFormat', v_format);
  END IF;
  -- 같은 시도의 재요청: 요금제가 그대로일 때만(위 검사 뒤) 같은 기록으로 본다.
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
       AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
      RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing.consent_format);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'consentFormat', v_format);
  END IF;
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'consentFormat', v_format);
  END IF;

  SELECT s.content_sha256 INTO v_policy_sha FROM public.policy_document_snapshots s
   WHERE s.doc_key = 'refundPolicy' ORDER BY s.seq DESC LIMIT 1;

  INSERT INTO pg_temp.rh_charge_acks (user_id, checkout_attempt_id, plan_id, plan_name, amount, credits, refund_days,
                                                 notice_text, notice_sha256, refund_policy_sha256,
                                                 terms_policy_sha256, consent_format, consent_details)
  VALUES (p_user_id, p_checkout_attempt_id, v_plan.id, v_plan.name, v_plan.price, v_plan.credits, v_days, v_text, v_sha, v_policy_sha,
          CASE WHEN v_format = 2 THEN v_terms_doc END, v_format,
          CASE WHEN v_format = 2 THEN jsonb_build_object('consent', v_details - 'noticeSha256' - 'plan') END)
  ON CONFLICT (user_id, checkout_attempt_id) DO NOTHING
  RETURNING id INTO v_inserted;
  IF v_inserted IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false, 'consentFormat', v_format);
  END IF;

  SELECT * INTO v_existing FROM pg_temp.rh_charge_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;
  IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
     AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing.consent_format);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'consentFormat', v_format);
END;
$function$;
CREATE FUNCTION pg_temp.rh_rec_m_step6(p_user_id uuid, p_idempotency_key uuid, p_notice_sha256 text, p_cart_texts_sha256 text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing_sha text;
  v_value jsonb;
  v_days_numeric numeric;
  v_days integer;
  v_label text;
  v_notice text;
  v_text text;
  v_sha text;
  v_inserted_id uuid;
  v_details jsonb;
  -- [11번] 시작
  v_existing_format smallint;
  v_existing_cart text;
  v_format smallint;
  v_built jsonb;
  v_cart jsonb;
  v_refund_doc text;
  v_terms_doc text;
  -- [11번] 끝
BEGIN
  -- ① 입력 검사
  IF p_user_id IS NULL OR p_idempotency_key IS NULL OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$'
     -- [11번] 시작
     OR (p_cart_texts_sha256 IS NOT NULL AND p_cart_texts_sha256 !~ '^[0-9a-f]{64}$') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID', 'consentFormat', NULL);
    -- [11번] 끝
  END IF;

  -- ② 같은 키로 이미 기록했고 지문이 같으면 그대로 통과(402 뒤 다시 누르기, 503 뒤 재시도)
  -- [11번] 장바구니 문구 지문도 같아야 한다(NULL 끼리도 같음 — 옛 코드의 재시도가 replay 로 끝나게)
  SELECT a.notice_sha256, a.consent_format, a.consent_details -> 'cartTexts' ->> 'cartTextsSha256'
    INTO v_existing_sha, v_existing_format, v_existing_cart
    FROM pg_temp.rh_market_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  -- (rh step6 사본: ② replay 를 건너뛴다)
  v_existing_sha := NULL;

  -- ③ 지금 정책: 판(consentFormat), refundDays 는 숫자·정수·양수
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'market_purchase_policy';
  -- [11번] 시작: 판 — 없거나 숫자 1 → 1, 숫자 2 → 2, 그 밖 → 닫힘(consentFormat null)
  v_format := CASE
    WHEN v_value IS NULL OR jsonb_typeof(v_value) <> 'object' THEN NULL
    WHEN NOT (v_value ? 'consentFormat') THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 1 THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 2 THEN 2
  END;
  IF v_format IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', NULL);
  END IF;
  -- [11번] 끝
  IF jsonb_typeof(v_value -> 'refundDays') IS DISTINCT FROM 'number' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', v_format);
  END IF;
  v_days_numeric := (v_value ->> 'refundDays')::numeric;
  IF v_days_numeric <> trunc(v_days_numeric) OR v_days_numeric <= 0 OR v_days_numeric > 3650 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', v_format);
  END IF;
  v_days := v_days_numeric::integer;
  -- [11번] 시작: 장바구니 문구(판과 관계없음)
  v_cart := public.build_market_cart_texts(v_value);
  IF v_format = 2 THEN
    -- 2판: 묶음(문구·링크 문서 검사 포함)과 두 문서 지문. 사본이 없으면 NULL 로 두지 않고 닫는다.
    v_built := public.build_checkout_consent_v2('market', v_value, v_days);
    SELECT d.content_sha256 INTO v_refund_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'refundPolicy' ORDER BY d.seq DESC LIMIT 1;
    SELECT d.content_sha256 INTO v_terms_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'serviceTerms' ORDER BY d.seq DESC LIMIT 1;
    IF v_built IS NULL OR v_refund_doc IS NULL OR v_terms_doc IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_text := v_built ->> 'text';
    v_details := v_built -> 'details';
    v_sha := v_details ->> 'noticeSha256';
  ELSE
  -- [11번] 끝
    -- 1판: 두 문구는 비어 있지 않은 글자(지금 규칙 그대로)
    IF jsonb_typeof(v_value -> 'checkboxLabel') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_value -> 'confirmNotice') IS DISTINCT FROM 'string' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_label := replace(v_value ->> 'checkboxLabel', '{자료환불기간}', v_days::text);
    v_notice := replace(v_value ->> 'confirmNotice', '{자료환불기간}', v_days::text);
    IF btrim(v_label) = '' OR btrim(v_notice) = '' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_text := v_label || chr(10) || v_notice;
    v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
    v_details := jsonb_build_object('checkboxLabel', v_label, 'confirmNotice', v_notice, 'noticeSha256', v_sha, 'refundDays', v_days,
                                    'consentFormat', 1);
  END IF;

  -- ④ 같은 키를 다른 화면(지문)으로 다시 쓰면 거절 — 화면은 새 키를 만든다
  IF v_existing_sha IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;

  -- ⑤ 화면에 보인 문구가 지금 문구와 다르면 거절
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;
  -- [11번] 시작: 화면에 보인 장바구니 문구가 지금 문구와 다르거나 지금 문구가 규칙 위반이면 기록하지 않고 거절(인자 NULL = 옛 코드는 지금처럼 기록)
  IF p_cart_texts_sha256 IS NOT NULL AND (v_cart IS NULL OR (v_cart ->> 'cartTextsSha256') <> p_cart_texts_sha256) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;
  -- [11번] 끝

  -- ⑥ 기록
  INSERT INTO pg_temp.rh_market_acks (user_id, idempotency_key, notice_sha256, notice_text, refund_days,
                                                  consent_format, refund_policy_sha256, terms_policy_sha256, consent_details)
  VALUES (p_user_id, p_idempotency_key, v_sha, v_text, v_days,
          v_format, CASE WHEN v_format = 2 THEN v_refund_doc END, CASE WHEN v_format = 2 THEN v_terms_doc END,
          CASE WHEN v_format = 2
               THEN jsonb_build_object('cartTexts', CASE WHEN p_cart_texts_sha256 IS NULL THEN NULL ELSE v_cart END,
                                       'consent', v_details - 'noticeSha256' - 'plan')
               ELSE jsonb_build_object('cartTexts', CASE WHEN p_cart_texts_sha256 IS NULL THEN NULL ELSE v_cart END) END)
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted_id;
  IF v_inserted_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false, 'consentFormat', v_format);
  END IF;

  SELECT a.notice_sha256, a.consent_format, a.consent_details -> 'cartTexts' ->> 'cartTextsSha256'
    INTO v_existing_sha, v_existing_format, v_existing_cart
    FROM pg_temp.rh_market_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  IF v_existing_sha = p_notice_sha256 AND v_existing_cart IS NOT DISTINCT FROM p_cart_texts_sha256 THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing_format);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
END;
$function$;

DO $rh_r7_same$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure(to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)') IS NULL
      AND to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text,text)') IS NOT NULL, 'R7', '3인자 없음·4인자만');
    FOR v_j IN SELECT to_jsonb(x) FROM (VALUES
      ('public.record_purchase_notice_ack(uuid,uuid,text,text)', '{postgres=X/postgres,service_role=X/postgres}'),
      ('public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', '{postgres=X/postgres,service_role=X/postgres}'),
      ('public.build_checkout_consent_v2(text,jsonb,integer)', '{postgres=X/postgres}'),
      ('public.build_market_cart_texts(jsonb)', '{postgres=X/postgres}')) x(sig, acl) LOOP
      v_log := v_log || pg_temp.ensure((SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v_j ->> 'sig')) = v_j ->> 'acl'
        AND NOT has_function_privilege('anon', v_j ->> 'sig', 'EXECUTE') AND NOT has_function_privilege('authenticated', v_j ->> 'sig', 'EXECUTE'),
        'R7', 'ACL ' || (v_j ->> 'sig'));
    END LOOP;
    -- 그대로여야 할 함수(생성기가 마이그레이션 사전 검사 v_same 14개 + record_admin_audit 를 그대로 옮김)
    FOR v_j IN SELECT to_jsonb(x) FROM (VALUES
      ('public.checkout_market_selection(uuid,text,uuid,jsonb,uuid)', '0cda5ff7689d998cc6cf2fd213b0004d'),
      ('public.get_point_charge_refund_eligibility(uuid,uuid)', '60fc28afe44e7be776c189265e87b6ec'),
      ('public.point_charge_refund_days()', '7ab4d40c1634ade20de86517fa13cd40'),
      ('public.guard_point_charge_checkout_acks_mutation()', 'c7ef25308c6c0aa2920991965fb87ab0'),
      ('public.guard_market_purchase_notice_acks_mutation()', '3959ac2b8139d0f81365df59ed67ef10'),
      ('public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '93e0bd5e41969f66f296f4353f3feeb9'),
      ('public.begin_payapp_request(uuid)', '679b4474c0dc42de11e5e9a14a7d1d4d'),
      ('public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '657bbb07ae4b250a2697f21e2aa805e9'),
      ('public.market_purchase_refund_days()', '5d4030e7bedbace6189cefed80c3d27b'),
      ('public.record_policy_document_snapshots()', '4ffeca80346467f928c0a6f50b69018d'),
      ('public.prevent_policy_document_snapshot_mutation()', 'b1449554c094a90be7a6c864f367fdf8'),
      ('public.member_withdrawal_facts(uuid,boolean)', 'a7674770964dac2fe5c9179b8403c3b4'),
      ('public.get_member_withdrawal_preview(uuid,boolean)', '3a2e2c2f6eb6ecb15defe0879c88e0fc'),
      ('public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)', '1346d870d3623abae580a011b0484339'),
      ('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)', 'a42b474d9d95753ffba5041acb0c1c77')) x(sig, md5) LOOP
      v_log := v_log || pg_temp.ensure(pg_temp.md5_of(v_j ->> 'sig') = v_j ->> 'md5', 'R7', '그대로 ' || (v_j ->> 'sig'));
    END LOOP;
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R7', m FROM unnest(v_log) m;
END
$rh_r7_same$;

DO $rh_fx_examples$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
BEGIN
  BEGIN

    -- 예시 묶음(tests/fixtures/bundle11-consent-examples.json, TS 단위 시험과 같은 파일): 받음·거절·지문이 TS 와 같다.
    DECLARE
      f jsonb := '{"bases":{"point_charge":{"consentFormat":2,"consentTitle":"주문 내용·충전 조건 확인 및 결제 동의","consentSummary":{"refundPeriod":"{충전환불기간}일째 되는 날까지 신청할 수 있어요.","restriction":"하나라도 쓰면 취소할 수 없어요.","validity":"{충전유효기간}년 동안 쓸 수 있어요.","minor":"미성년자는 취소할 수 있어요."},"checkoutItems":{"product":"상품 A","validity":"기간 B","refund":"환불 {충전환불기간}일\n둘째 줄","restriction":"제한 C","otherCases":"기타 D"},"minorNotice":"미성년 E","consentItems":[{"key":"product","label":"충전 상품 안내","view":"text","textKeys":["checkoutItems.product","checkoutItems.validity"]},{"key":"refund","label":"취소·환불 안내","view":"text","textKeys":["checkoutItems.refund","checkoutItems.restriction","checkoutItems.otherCases"]},{"key":"minor","label":"미성년자 결제 취소 안내","view":"text","textKeys":["minorNotice"]},{"key":"refundPolicy","label":"취소·환불정책","view":"link","link":"refundPolicy"},{"key":"terms","label":"서비스 이용약관","view":"link","link":"serviceTerms"}]},"market":{"consentFormat":2,"consentTitle":"주문 내용·구매 조건 확인 및 동의","consentSummary":{"refundPeriod":"  {자료환불기간}일째 되는 날까지 신청할 수 있어요. ","restriction":"받은 자료는 환불되지 않아요.","note":"하자가 있으면 환불돼요."},"confirmNotice":"환불 안내 본문 {자료환불기간}일\n","usageScopeNotice":"이용 범위 본문","downloadPeriodNotice":"다운로드 본문","consentItems":[{"key":"purchaseNotice","label":"자료 환불 안내","view":"text","textKeys":["confirmNotice","downloadPeriodNotice"]},{"key":"usageScope","label":"자료 이용 범위","view":"text","textKeys":["usageScopeNotice"]},{"key":"refundPolicy","label":"취소·환불정책","view":"link","link":"refundPolicy"},{"key":"terms","label":"서비스 이용약관","view":"link","link":"serviceTerms"}]}},"refundDays":{"point_charge":7,"market":30},"cases":[{"name":"충전 벡터(5-1)","kind":"point_charge","patch":{},"remove":[],"ok":true,"noticeSha256":"2e53f470c92dfba92ee637f86c592f5b5545b46ef37b883eb856f30c7bc56cd7"},{"name":"자료 벡터(note·앞뒤 공백·LF 끝 본문·본문 둘)","kind":"market","patch":{},"remove":[],"ok":true,"noticeSha256":"41a2a90de70e2c7de58ed9a308043efdb7e5d7b04656718212c8e83be13b34fe"},{"name":"자료 note 없음","kind":"market","patch":{"consentSummary":{"refundPeriod":"{자료환불기간}일째 되는 날까지 신청할 수 있어요.","restriction":"받은 자료는 환불되지 않아요."}},"remove":[],"ok":true,"noticeSha256":"4eaaf6b530dff7fe47820b5a8107bfc65897ed1dc06bda9ca8174464d2af0939"},{"name":"충전 note 더함","kind":"point_charge","patch":{"consentSummary":{"refundPeriod":"{충전환불기간}일째 되는 날까지 신청할 수 있어요.","restriction":"하나라도 쓰면 취소할 수 없어요.","validity":"{충전유효기간}년 동안 쓸 수 있어요.","minor":"미성년자는 취소할 수 있어요.","note":"덧붙임 줄이에요."}},"remove":[],"ok":true,"noticeSha256":"b402d1600edc52b4f344a7374fb5bd30988a1e3588ff5a2dc5114fbe2bbe8e41"},{"name":"충전 필수 본문 빠짐(minorNotice 항목 없음)","kind":"point_charge","patch":{"consentItems":[{"key":"product","label":"충전 상품 안내","view":"text","textKeys":["checkoutItems.product","checkoutItems.validity"]},{"key":"refund","label":"취소·환불 안내","view":"text","textKeys":["checkoutItems.refund","checkoutItems.restriction","checkoutItems.otherCases"]},{"key":"refundPolicy","label":"취소·환불정책","view":"link","link":"refundPolicy"},{"key":"terms","label":"서비스 이용약관","view":"link","link":"serviceTerms"}]},"remove":[],"ok":false},{"name":"충전 본문 키 없음","kind":"point_charge","patch":{},"remove":["minorNotice"],"ok":false},{"name":"자료 필수 본문 빠짐(confirmNotice)","kind":"market","patch":{"consentItems":[{"key":"purchaseNotice","label":"자료 환불 안내","view":"text","textKeys":["downloadPeriodNotice"]},{"key":"usageScope","label":"자료 이용 범위","view":"text","textKeys":["usageScopeNotice"]},{"key":"refundPolicy","label":"취소·환불정책","view":"link","link":"refundPolicy"},{"key":"terms","label":"서비스 이용약관","view":"link","link":"serviceTerms"}]},"remove":[],"ok":false},{"name":"충전 요약 줄 빠짐(minor)","kind":"point_charge","patch":{"consentSummary":{"refundPeriod":"{충전환불기간}일째 되는 날까지 신청할 수 있어요.","restriction":"하나라도 쓰면 취소할 수 없어요.","validity":"{충전유효기간}년 동안 쓸 수 있어요."}},"remove":[],"ok":false},{"name":"요약 줄 모르는 역할","kind":"market","patch":{"consentSummary":{"refundPeriod":"  {자료환불기간}일째 되는 날까지 신청할 수 있어요. ","restriction":"받은 자료는 환불되지 않아요.","note":"하자가 있으면 환불돼요.","extra":"모르는 줄"}},"remove":[],"ok":false},{"name":"허용 밖 textKeys(agreeLabel)","kind":"point_charge","patch":{"consentItems":[{"key":"product","label":"충전 상품 안내","view":"text","textKeys":["checkoutItems.product","checkoutItems.validity","agreeLabel"]},{"key":"refund","label":"취소·환불 안내","view":"text","textKeys":["checkoutItems.refund","checkoutItems.restriction","checkoutItems.otherCases"]},{"key":"minor","label":"미성년자 결제 취소 안내","view":"text","textKeys":["minorNotice"]},{"key":"refundPolicy","label":"취소·환불정책","view":"link","link":"refundPolicy"},{"key":"terms","label":"서비스 이용약관","view":"link","link":"serviceTerms"}]},"remove":[],"ok":false},{"name":"객체 textKeys","kind":"market","patch":{"consentItems":[{"key":"purchaseNotice","label":"자료 환불 안내","view":"text","textKeys":{"a":"confirmNotice"}},{"key":"usageScope","label":"자료 이용 범위","view":"text","textKeys":["usageScopeNotice"]},{"key":"refundPolicy","label":"취소·환불정책","view":"link","link":"refundPolicy"},{"key":"terms","label":"서비스 이용약관","view":"link","link":"serviceTerms"}]},"remove":[],"ok":false},{"name":"textKeys 중복(다른 항목)","kind":"market","patch":{"consentItems":[{"key":"purchaseNotice","label":"자료 환불 안내","view":"text","textKeys":["confirmNotice","downloadPeriodNotice"]},{"key":"usageScope","label":"자료 이용 범위","view":"text","textKeys":["confirmNotice"]},{"key":"refundPolicy","label":"취소·환불정책","view":"link","link":"refundPolicy"},{"key":"terms","label":"서비스 이용약관","view":"link","link":"serviceTerms"}]},"remove":[],"ok":false},{"name":"요약 줄 121자","kind":"market","patch":{"consentSummary":{"refundPeriod":"  {자료환불기간}일째 되는 날까지 신청할 수 있어요. ","restriction":"가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가","note":"하자가 있으면 환불돼요."}},"remove":[],"ok":false},{"name":"요약 줄 120자","kind":"point_charge","patch":{"consentSummary":{"refundPeriod":"{충전환불기간}일째 되는 날까지 신청할 수 있어요.","restriction":"가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가","validity":"{충전유효기간}년 동안 쓸 수 있어요.","minor":"미성년자는 취소할 수 있어요."}},"remove":[],"ok":true,"noticeSha256":"44b9858373ffdad227fd25b0c34578e62aab46ab22769da5756f1e6c97c464d5"},{"name":"자료 요약 합계 221자","kind":"market","patch":{"consentSummary":{"refundPeriod":"{자료환불기간}가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가","restriction":"가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가","note":"가가가가가가가가가가가가가"}},"remove":[],"ok":false},{"name":"자료 요약 합계 220자","kind":"market","patch":{"consentSummary":{"refundPeriod":"{자료환불기간}가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가","restriction":"가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가","note":"가가가가가가가가가가가가"}},"remove":[],"ok":true,"noticeSha256":"16c3600b7863e1c6e03e7e9f2a9f994be202de441308a0c18a50d6add9a9d1e7"},{"name":"제목 26자","kind":"market","patch":{"consentTitle":"가가가가가가가가가가가가가가가가가가가가가가가가가가"},"remove":[],"ok":true,"noticeSha256":"c7135047d2fe98e797094459b3499212f498836dc0fd76f6089ea351050d0346"},{"name":"제목 27자","kind":"market","patch":{"consentTitle":"가가가가가가가가가가가가가가가가가가가가가가가가가가가"},"remove":[],"ok":false},{"name":"제목에 [필수]","kind":"market","patch":{"consentTitle":"[필수] 동의"},"remove":[],"ok":false},{"name":"숫자 기간 30일","kind":"market","patch":{"consentSummary":{"refundPeriod":"  {자료환불기간}일째 되는 날까지 신청할 수 있어요. ","restriction":"30일 안에 신청해요.","note":"하자가 있으면 환불돼요."}},"remove":[],"ok":false},{"name":"숫자 기간 전각 １년","kind":"point_charge","patch":{"consentSummary":{"refundPeriod":"{충전환불기간}일째 되는 날까지 신청할 수 있어요.","restriction":"하나라도 쓰면 취소할 수 없어요.","validity":"{충전유효기간}년 동안, 최대 １년","minor":"미성년자는 취소할 수 있어요."}},"remove":[],"ok":false},{"name":"숫자 기간 12개월(제목)","kind":"point_charge","patch":{"consentTitle":"12개월 동의"},"remove":[],"ok":false},{"name":"숫자 기간 일 년","kind":"point_charge","patch":{"consentSummary":{"refundPeriod":"{충전환불기간}일째 되는 날까지 신청할 수 있어요.","restriction":"일 년 동안 쓸 수 있어요.","validity":"{충전유효기간}년 동안 쓸 수 있어요.","minor":"미성년자는 취소할 수 있어요."}},"remove":[],"ok":false},{"name":"숫자 기간 한 달(항목 이름)","kind":"market","patch":{"consentItems":[{"key":"purchaseNotice","label":"한 달 안내","view":"text","textKeys":["confirmNotice","downloadPeriodNotice"]},{"key":"usageScope","label":"자료 이용 범위","view":"text","textKeys":["usageScopeNotice"]},{"key":"refundPolicy","label":"취소·환불정책","view":"link","link":"refundPolicy"},{"key":"terms","label":"서비스 이용약관","view":"link","link":"serviceTerms"}]},"remove":[],"ok":false},{"name":"숫자 기간 이틀","kind":"market","patch":{"consentSummary":{"refundPeriod":"  {자료환불기간}일째 되는 날까지 신청할 수 있어요. ","restriction":"받은 자료는 환불되지 않아요.","note":"이틀 걸려요."}},"remove":[],"ok":false},{"name":"중괄호","kind":"market","patch":{"consentSummary":{"refundPeriod":"  {자료환불기간}일째 되는 날까지 신청할 수 있어요. ","restriction":"받은 자료는 환불되지 않아요.","note":"{모름} 안내"}},"remove":[],"ok":false},{"name":"자료 요약에 충전 자리표시","kind":"market","patch":{"consentSummary":{"refundPeriod":"  {자료환불기간}일째 되는 날까지 신청할 수 있어요. ","restriction":"받은 자료는 환불되지 않아요.","note":"{충전환불기간} 안내"}},"remove":[],"ok":false},{"name":"본문 중괄호","kind":"market","patch":{"usageScopeNotice":"범위 {x}"},"remove":[],"ok":false},{"name":"본문 빈 글자","kind":"market","patch":{"usageScopeNotice":" \n\t"},"remove":[],"ok":false},{"name":"한 줄 칸 LF(제목)","kind":"market","patch":{"consentTitle":"주문\n동의"},"remove":[],"ok":false},{"name":"한 줄 칸 LF(요약)","kind":"point_charge","patch":{"consentSummary":{"refundPeriod":"{충전환불기간}일째 되는 날까지 신청할 수 있어요.","restriction":"줄\n바꿈","validity":"{충전유효기간}년 동안 쓸 수 있어요.","minor":"미성년자는 취소할 수 있어요."}},"remove":[],"ok":false},{"name":"note: null","kind":"market","patch":{"consentSummary":{"refundPeriod":"  {자료환불기간}일째 되는 날까지 신청할 수 있어요. ","restriction":"받은 자료는 환불되지 않아요.","note":null}},"remove":[],"ok":false},{"name":"refundPeriod 자리표시 없음","kind":"market","patch":{"consentSummary":{"refundPeriod":"받지 않은 자료는 신청할 수 있어요.","restriction":"받은 자료는 환불되지 않아요.","note":"하자가 있으면 환불돼요."}},"remove":[],"ok":false},{"name":"충전 validity 자리표시 없음","kind":"point_charge","patch":{"consentSummary":{"refundPeriod":"{충전환불기간}일째 되는 날까지 신청할 수 있어요.","restriction":"하나라도 쓰면 취소할 수 없어요.","validity":"오래 쓸 수 있어요.","minor":"미성년자는 취소할 수 있어요."}},"remove":[],"ok":false},{"name":"링크 하나 빠짐","kind":"market","patch":{"consentItems":[{"key":"purchaseNotice","label":"자료 환불 안내","view":"text","textKeys":["confirmNotice","downloadPeriodNotice"]},{"key":"usageScope","label":"자료 이용 범위","view":"text","textKeys":["usageScopeNotice"]},{"key":"refundPolicy","label":"취소·환불정책","view":"link","link":"refundPolicy"}]},"remove":[],"ok":false},{"name":"링크 두 번","kind":"market","patch":{"consentItems":[{"key":"purchaseNotice","label":"자료 환불 안내","view":"text","textKeys":["confirmNotice","downloadPeriodNotice"]},{"key":"usageScope","label":"자료 이용 범위","view":"text","textKeys":["usageScopeNotice"]},{"key":"refundPolicy","label":"취소·환불정책","view":"link","link":"refundPolicy"},{"key":"terms","label":"서비스 이용약관","view":"link","link":"refundPolicy"}]},"remove":[],"ok":false},{"name":"항목 키 규칙 위반","kind":"market","patch":{"consentItems":[{"key":"Purchase","label":"자료 환불 안내","view":"text","textKeys":["confirmNotice","downloadPeriodNotice"]},{"key":"usageScope","label":"자료 이용 범위","view":"text","textKeys":["usageScopeNotice"]},{"key":"refundPolicy","label":"취소·환불정책","view":"link","link":"refundPolicy"},{"key":"terms","label":"서비스 이용약관","view":"link","link":"serviceTerms"}]},"remove":[],"ok":false},{"name":"항목 키 중복","kind":"market","patch":{"consentItems":[{"key":"purchaseNotice","label":"자료 환불 안내","view":"text","textKeys":["confirmNotice","downloadPeriodNotice"]},{"key":"purchaseNotice","label":"자료 이용 범위","view":"text","textKeys":["usageScopeNotice"]},{"key":"refundPolicy","label":"취소·환불정책","view":"link","link":"refundPolicy"},{"key":"terms","label":"서비스 이용약관","view":"link","link":"serviceTerms"}]},"remove":[],"ok":false},{"name":"항목 남는 키","kind":"market","patch":{"consentItems":[{"key":"purchaseNotice","label":"자료 환불 안내","view":"text","textKeys":["confirmNotice","downloadPeriodNotice"],"extra":1},{"key":"usageScope","label":"자료 이용 범위","view":"text","textKeys":["usageScopeNotice"]},{"key":"refundPolicy","label":"취소·환불정책","view":"link","link":"refundPolicy"},{"key":"terms","label":"서비스 이용약관","view":"link","link":"serviceTerms"}]},"remove":[],"ok":false},{"name":"항목 7개","kind":"point_charge","patch":{"consentItems":[{"key":"product","label":"충전 상품 안내","view":"text","textKeys":["checkoutItems.product","checkoutItems.validity"]},{"key":"refund","label":"취소·환불 안내","view":"text","textKeys":["checkoutItems.refund","checkoutItems.restriction","checkoutItems.otherCases"]},{"key":"minor","label":"미성년자 결제 취소 안내","view":"text","textKeys":["minorNotice"]},{"key":"refundPolicy","label":"취소·환불정책","view":"link","link":"refundPolicy"},{"key":"terms","label":"서비스 이용약관","view":"link","link":"serviceTerms"},{"key":"x1","label":"더","view":"text","textKeys":["checkoutItems.product"]},{"key":"x2","label":"더","view":"link","link":"serviceTerms"}]},"remove":[],"ok":false},{"name":"항목 이름 31자","kind":"market","patch":{"consentItems":[{"key":"purchaseNotice","label":"가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가","view":"text","textKeys":["confirmNotice","downloadPeriodNotice"]},{"key":"usageScope","label":"자료 이용 범위","view":"text","textKeys":["usageScopeNotice"]},{"key":"refundPolicy","label":"취소·환불정책","view":"link","link":"refundPolicy"},{"key":"terms","label":"서비스 이용약관","view":"link","link":"serviceTerms"}]},"remove":[],"ok":false},{"name":"제목 글자 아님","kind":"market","patch":{"consentTitle":1},"remove":[],"ok":false},{"name":"요약 배열","kind":"market","patch":{"consentSummary":["a"]},"remove":[],"ok":false}],"cartCases":[{"name":"앞뒤 공백 그대로","value":{"cartCheckoutNotice":" 앞 공백 안내","partialOwnedConfirmLabel":"뒤 공백 확인 "},"ok":true,"cartTextsSha256":"16d06ad48fd95b1eaf1b49e5ceb490efe3f562b4abb014710424d299cdd18742"},{"name":"초안","value":{"cartCheckoutNotice":"크레딧으로 선택한 자료를 한 번에 구매합니다. 하나라도 구매할 수 없으면 전체 구매가 취소됩니다.","partialOwnedConfirmLabel":"이미 구매한 개별 자료가 포함된 전체 패키지는 기보유분 차감 없이 정가로 구매됨을 확인했습니다."},"ok":true,"cartTextsSha256":"59922cb5009280ae0bcb6520bbbe1a853ec5acb2b1ac2906bf5a41f75e195e8d"},{"name":"300자","value":{"cartCheckoutNotice":"가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가","partialOwnedConfirmLabel":"x"},"ok":true,"cartTextsSha256":"9c60e1b36233a341eb239220f7b760526d867c1e8d61514df6524f201f07d1f1"},{"name":"301자","value":{"cartCheckoutNotice":"가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가","partialOwnedConfirmLabel":"x"},"ok":false},{"name":"LF","value":{"cartCheckoutNotice":"줄\n바꿈","partialOwnedConfirmLabel":"x"},"ok":false},{"name":"중괄호","value":{"cartCheckoutNotice":"{x}","partialOwnedConfirmLabel":"x"},"ok":false},{"name":"빈 글자","value":{"cartCheckoutNotice":" \t","partialOwnedConfirmLabel":"x"},"ok":false},{"name":"키 없음","value":{"cartCheckoutNotice":"안내"},"ok":false},{"name":"숫자 아님","value":{"cartCheckoutNotice":"안내","partialOwnedConfirmLabel":3},"ok":false}],"formatCases":[{"name":"키 없음","raw":"{}","format":1},{"name":"숫자 1","raw":"{\"consentFormat\": 1}","format":1},{"name":"숫자 1.0","raw":"{\"consentFormat\": 1.0}","format":1},{"name":"숫자 2","raw":"{\"consentFormat\": 2}","format":2},{"name":"글자 \"2\"","raw":"{\"consentFormat\": \"2\"}","format":null},{"name":"2.5","raw":"{\"consentFormat\": 2.5}","format":null},{"name":"3","raw":"{\"consentFormat\": 3}","format":null},{"name":"null","raw":"{\"consentFormat\": null}","format":null}]}'::jsonb;
      c jsonb;
      v jsonb;
      k text;
      r jsonb;
      v_ok integer := 0;
    BEGIN
      v_log := v_log || pg_temp.ensure(public.build_checkout_consent_v2('point_charge', f -> 'bases' -> 'point_charge', 7) IS NOT NULL,
        'FX', '약관 문서 두 개가 보이고 사본이 있음(아니면 예시 대조 불가)');
      FOR c IN SELECT x FROM jsonb_array_elements(f -> 'cases') x LOOP
        v := (f -> 'bases' -> (c ->> 'kind')) || (c -> 'patch');
        FOR k IN SELECT jsonb_array_elements_text(c -> 'remove') LOOP
          v := v - k;
        END LOOP;
        r := public.build_checkout_consent_v2(c ->> 'kind', v, (f -> 'refundDays' ->> (c ->> 'kind'))::integer);
        IF (r IS NOT NULL) IS DISTINCT FROM (c -> 'ok')::boolean
           OR (r IS NOT NULL AND (r #>> '{details,noticeSha256}' IS DISTINCT FROM c ->> 'noticeSha256' OR pg_temp.sha(r ->> 'text') <> c ->> 'noticeSha256')) THEN
          PERFORM pg_temp.fail('FX', (c ->> 'name') || ' 기대 ' || (c ->> 'ok') || ', 실제 ' || left(coalesce(r #>> '{details,noticeSha256}', 'NULL'), 70));
        END IF;
        v_ok := v_ok + 1;
      END LOOP;
      FOR c IN SELECT x FROM jsonb_array_elements(f -> 'cartCases') x LOOP
        r := public.build_market_cart_texts(c -> 'value');
        IF (r IS NOT NULL) IS DISTINCT FROM (c -> 'ok')::boolean OR (r IS NOT NULL AND r ->> 'cartTextsSha256' IS DISTINCT FROM c ->> 'cartTextsSha256') THEN
          PERFORM pg_temp.fail('FX', '장바구니 문구 ' || (c ->> 'name'));
        END IF;
        v_ok := v_ok + 1;
      END LOOP;
      v_log := v_log || ('예시 ' || v_ok || '건 TS 와 같음');
    END;
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'FX', m FROM unnest(v_log) m;
END
$rh_fx_examples$;

DO $rh_r0$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_user uuid := pg_temp.rh_user();
  v_plan public.pricing_plans := pg_temp.rh_plan();
  v_key uuid;
  v_key2 uuid;
  v_m jsonb;
  v_p jsonb;
  v_cart jsonb;
  v_row record;
  v_sha text;
  v_footer jsonb := pg_temp.policy('site_footer_content');
BEGIN
  BEGIN

    v_key := gen_random_uuid();
    v_j := pg_temp.rh_rec_m(p_user_id => v_user, p_idempotency_key => v_key, p_notice_sha256 => pg_temp.ctx('market_v1_sha'));
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND (v_j -> 'replay') = 'false'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb, 'R0', '옛 호출(이름 인자 3개) 1판 기록 성공 → ' || v_j::text);
    SELECT * INTO v_row FROM pg_temp.rh_market_acks a WHERE a.user_id = v_user AND a.idempotency_key = v_key;
    v_log := v_log || pg_temp.ensure(v_row.consent_format = 1 AND v_row.refund_policy_sha256 IS NULL AND v_row.terms_policy_sha256 IS NULL
      AND v_row.consent_details = '{"cartTexts": null}'::jsonb AND v_row.notice_sha256 = pg_temp.ctx('market_v1_sha'), 'R0', '자료 새 칸 기본값·cartTexts null');
    v_j := pg_temp.rh_rec_m(p_user_id => v_user, p_idempotency_key => v_key, p_notice_sha256 => pg_temp.ctx('market_v1_sha'));
    v_log := v_log || pg_temp.ensure((v_j -> 'replay') = 'true'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb, 'R0', '옛 호출 같은 키 다시 → replay');
    v_j := pg_temp.rh_rec_m(v_user, gen_random_uuid(), repeat('0', 64));
    v_log := v_log || pg_temp.ensure((v_j -> 'details') - 'consentFormat' = (pg_temp.ctx('old_market_changed')::jsonb) -> 'details'
      AND (v_j #> '{details,consentFormat}') = '1'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb AND v_j ? 'cartTexts', 'R0', '자료 NOTICE_CHANGED 1판 details = 10번 + consentFormat 1');
    v_key := gen_random_uuid();
    v_j := pg_temp.rh_rec_p(v_user, v_key, v_plan.id, v_plan.price, v_plan.credits, pg_temp.ctx('point_v1_sha'));
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb, 'R0', '충전 6인자 1판 기록 성공');
    SELECT * INTO v_row FROM pg_temp.rh_charge_acks a WHERE a.user_id = v_user AND a.checkout_attempt_id = v_key;
    v_log := v_log || pg_temp.ensure(v_row.consent_format = 1 AND v_row.terms_policy_sha256 IS NULL AND v_row.consent_details IS NULL
      AND v_row.refund_policy_sha256 = (SELECT s.content_sha256 FROM public.policy_document_snapshots s WHERE s.doc_key = 'refundPolicy' ORDER BY s.seq DESC LIMIT 1),
      'R0', '충전 새 칸 기본값·환불정책 지문 = 최신 사본');
    v_j := pg_temp.rh_rec_p(v_user, gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, repeat('0', 64));
    v_log := v_log || pg_temp.ensure((v_j -> 'details') - 'consentFormat' = (pg_temp.ctx('old_point_changed')::jsonb) -> 'details', 'R0', '충전 NOTICE_CHANGED 1판 details = 10번 + consentFormat 1');
    v_j := pg_temp.rh_rec_p(v_user, gen_random_uuid(), v_plan.id, v_plan.price + 1, v_plan.credits, repeat('0', 64));
    v_log := v_log || pg_temp.ensure((v_j -> 'details') - 'consentFormat' = (pg_temp.ctx('old_point_plan_changed')::jsonb) -> 'details'
      AND v_j ->> 'code' = 'PLAN_CHANGED', 'R0', '충전 PLAN_CHANGED 1판 details = 10번 + consentFormat 1');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R0', m FROM unnest(v_log) m;
END
$rh_r0$;

DO $rh_r1$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_user uuid := pg_temp.rh_user();
  v_plan public.pricing_plans := pg_temp.rh_plan();
  v_key uuid;
  v_key2 uuid;
  v_m jsonb;
  v_p jsonb;
  v_cart jsonb;
  v_row record;
  v_sha text;
  v_footer jsonb := pg_temp.policy('site_footer_content');
BEGIN
  BEGIN

    v_r := pg_temp.try_sql(pg_temp.script_sql('keys'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R1', '스크립트 A');
    v_m := pg_temp.policy('market_purchase_policy');
    v_cart := public.build_market_cart_texts(v_m);
    v_log := v_log || pg_temp.ensure(public.build_checkout_consent_v2('market', v_m, (v_m ->> 'refundDays')::integer) IS NOT NULL
      AND public.build_checkout_consent_v2('point_charge', pg_temp.policy('point_charge_policy'), public.point_charge_refund_days()) IS NOT NULL
      AND v_cart IS NOT NULL, 'R1', '판 1 인 채 2판 묶음 두 정책·장바구니 문구 NULL 아님');
    v_key := gen_random_uuid();
    v_j := pg_temp.rh_rec_m(v_user, v_key, pg_temp.ctx('market_v1_sha'));
    SELECT * INTO v_row FROM pg_temp.rh_market_acks a WHERE a.user_id = v_user AND a.idempotency_key = v_key;
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND v_row.consent_details = '{"cartTexts": null}'::jsonb, 'R1', '옛 호출 → cartTexts null');
    v_key := gen_random_uuid();
    v_j := pg_temp.rh_rec_m(v_user, v_key, pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256');
    SELECT * INTO v_row FROM pg_temp.rh_market_acks a WHERE a.user_id = v_user AND a.idempotency_key = v_key;
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND v_row.consent_details -> 'cartTexts' = v_cart
      AND v_cart ->> 'cartTextsSha256' = '59922cb5009280ae0bcb6520bbbe1a853ec5acb2b1ac2906bf5a41f75e195e8d', 'R1', '맞는 장바구니 지문 → 전문 기록(지문 = TS 값)');
    v_key := gen_random_uuid();
    v_j := pg_temp.rh_rec_m(v_user, v_key, pg_temp.ctx('market_v1_sha'), repeat('a', 64));
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_CHANGED' AND v_j -> 'cartTexts' = v_cart
      AND NOT EXISTS (SELECT 1 FROM pg_temp.rh_market_acks a WHERE a.user_id = v_user AND a.idempotency_key = v_key), 'R1', '틀린 장바구니 지문 → 기록 없음 + NOTICE_CHANGED + cartTexts');
    -- 관리자 저장 흉내(문구 수정·version +1): 판 1 그대로
    PERFORM pg_temp.set_policy('market_purchase_policy', v_m || jsonb_build_object('consentTitle', '주문 내용 확인 및 동의', 'version', (v_m ->> 'version')::integer + 1));
    v_j := pg_temp.rh_rec_m(v_user, gen_random_uuid(), pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb, 'R1', '관리자 저장 흉내 뒤에도 1판');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R1', m FROM unnest(v_log) m;
END
$rh_r1$;

DO $rh_r2$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_user uuid := pg_temp.rh_user();
  v_plan public.pricing_plans := pg_temp.rh_plan();
  v_key uuid;
  v_key2 uuid;
  v_m jsonb;
  v_p jsonb;
  v_cart jsonb;
  v_row record;
  v_sha text;
  v_footer jsonb := pg_temp.policy('site_footer_content');
BEGIN
  BEGIN

    v_r := pg_temp.try_sql(pg_temp.script_sql('keys'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R2', '스크립트 A');
    v_r := pg_temp.try_sql(pg_temp.script_sql('format2'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R2', '스크립트 B');
    v_m := public.build_checkout_consent_v2('market', pg_temp.policy('market_purchase_policy'), (pg_temp.policy('market_purchase_policy') ->> 'refundDays')::integer);
    v_cart := public.build_market_cart_texts(pg_temp.policy('market_purchase_policy'));
    v_j := pg_temp.rh_rec_m(v_user, gen_random_uuid(), pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_CHANGED' AND (v_j -> 'consentFormat') = '2'::jsonb AND v_j -> 'details' = v_m -> 'details'
      AND NOT (v_j -> 'details' ? 'checkboxLabel') AND NOT (v_j -> 'details' ? 'confirmNotice'), 'R2', '1판 지문 → NOTICE_CHANGED(2판 묶음, 1판 키 없음)');
    v_key := gen_random_uuid();
    v_j := pg_temp.rh_rec_m(v_user, v_key, v_m #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256');
    SELECT * INTO v_row FROM pg_temp.rh_market_acks a WHERE a.user_id = v_user AND a.idempotency_key = v_key;
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND v_row.consent_format = 2
      AND v_row.refund_policy_sha256 = (SELECT s.content_sha256 FROM public.policy_document_snapshots s WHERE s.doc_key = 'refundPolicy' ORDER BY s.seq DESC LIMIT 1)
      AND v_row.terms_policy_sha256 = (SELECT s.content_sha256 FROM public.policy_document_snapshots s WHERE s.doc_key = 'serviceTerms' ORDER BY s.seq DESC LIMIT 1)
      AND pg_temp.sha(pg_temp.consent_text(v_row.consent_details -> 'consent')) = v_row.notice_sha256
      AND pg_temp.consent_text(v_row.consent_details -> 'consent') = v_row.notice_text
      AND NOT (v_row.consent_details -> 'consent' ? 'noticeSha256') AND v_row.consent_details -> 'cartTexts' = v_cart, 'R2', '자료 2판 기록: 판 2·문서 지문 둘·consent 로 다시 만든 원문 sha = notice_sha256');
    v_p := public.build_checkout_consent_v2('point_charge', pg_temp.policy('point_charge_policy'), public.point_charge_refund_days());
    v_key := gen_random_uuid();
    v_j := pg_temp.rh_rec_p(v_user, v_key, v_plan.id, v_plan.price, v_plan.credits, v_p #>> '{details,noticeSha256}');
    SELECT * INTO v_row FROM pg_temp.rh_charge_acks a WHERE a.user_id = v_user AND a.checkout_attempt_id = v_key;
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND v_row.consent_format = 2 AND v_row.refund_days = public.point_charge_refund_days()
      AND v_row.terms_policy_sha256 IS NOT NULL AND v_row.refund_policy_sha256 IS NOT NULL
      AND pg_temp.sha(pg_temp.consent_text(v_row.consent_details -> 'consent')) = v_row.notice_sha256
      AND NOT (v_row.consent_details -> 'consent' ? 'plan'), 'R2', '충전 2판 기록: refund_days·문서 지문·consent 원문 sha');
    v_j := pg_temp.rh_rec_p(v_user, gen_random_uuid(), v_plan.id, v_plan.price + 1, v_plan.credits, v_p #>> '{details,noticeSha256}');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'PLAN_CHANGED' AND (v_j #> '{details,consentFormat}') = '2'::jsonb
      AND (v_j #>> '{details,plan,price}')::integer = v_plan.price AND (v_j -> 'details') - 'plan' = v_p -> 'details', 'R2', 'PLAN_CHANGED 는 2판 + plan');
    v_j := pg_temp.rh_rec_p(v_user, NULL, v_plan.id, v_plan.price, v_plan.credits, 'x');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_INPUT_INVALID' AND (v_j -> 'consentFormat') = 'null'::jsonb, 'R2', '충전 NOTICE_INPUT_INVALID consentFormat null');
    v_j := pg_temp.rh_rec_m(v_user, gen_random_uuid(), 'x');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_INPUT_INVALID' AND (v_j -> 'consentFormat') = 'null'::jsonb, 'R2', '자료 NOTICE_INPUT_INVALID consentFormat null');
    IF pg_temp.rh_withdrawn_user() IS NOT NULL THEN
      v_j := pg_temp.rh_rec_p(pg_temp.rh_withdrawn_user(), gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, v_p #>> '{details,noticeSha256}');
      v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'MEMBER_WITHDRAWN' AND (v_j -> 'consentFormat') = 'null'::jsonb, 'R2', 'MEMBER_WITHDRAWN consentFormat null');
    ELSE
      v_log := v_log || '탈퇴 회원이 없어 MEMBER_WITHDRAWN 은 계약 시험(맨 앞 거절)으로 갈음'::text;
    END IF;
    -- 관리자 저장 흉내(판 2, 문구 수정·version +1): 판 2 그대로, 새 문구로 지문
    PERFORM pg_temp.set_policy('market_purchase_policy', pg_temp.policy('market_purchase_policy')
      || jsonb_build_object('consentTitle', '주문 내용 확인 및 구매 동의', 'version', (pg_temp.policy('market_purchase_policy') ->> 'version')::integer + 1));
    v_j := public.build_checkout_consent_v2('market', pg_temp.policy('market_purchase_policy'), (pg_temp.policy('market_purchase_policy') ->> 'refundDays')::integer);
    v_log := v_log || pg_temp.ensure(v_j #>> '{details,noticeSha256}' <> v_m #>> '{details,noticeSha256}'
      AND (pg_temp.rh_rec_m(v_user, gen_random_uuid(), v_j #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256') -> 'consentFormat') = '2'::jsonb, 'R2', '관리자 저장 흉내 뒤 판 2·새 지문으로 기록');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R2', m FROM unnest(v_log) m;
END
$rh_r2$;

DO $rh_r3$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_user uuid := pg_temp.rh_user();
  v_plan public.pricing_plans := pg_temp.rh_plan();
  v_key uuid;
  v_key2 uuid;
  v_m jsonb;
  v_p jsonb;
  v_cart jsonb;
  v_row record;
  v_sha text;
  v_footer jsonb := pg_temp.policy('site_footer_content');
BEGIN
  BEGIN

    v_r := pg_temp.try_sql(pg_temp.script_sql('keys'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R3', '스크립트 A');
    v_cart := public.build_market_cart_texts(pg_temp.policy('market_purchase_policy'));
    v_key := gen_random_uuid();
    v_j := pg_temp.rh_rec_m(v_user, v_key, pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb, 'R3', '1판 기록(키 K)');
    v_r := pg_temp.try_sql(pg_temp.script_sql('format2'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R3', '스크립트 B');
    v_j := pg_temp.rh_rec_m(v_user, v_key, pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure((v_j -> 'replay') = 'true'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb, 'R3', '판 2 뒤 같은 키·같은 지문 → replay(consentFormat 1)');
    v_j := pg_temp.rh_rec_m(v_user, v_key, repeat('b', 64), v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_KEY_CONFLICT', 'R3', '같은 키·다른 고지 지문 → NOTICE_KEY_CONFLICT');
    v_j := pg_temp.rh_rec_m(v_user, v_key, pg_temp.ctx('market_v1_sha'), repeat('c', 64));
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_KEY_CONFLICT', 'R3', '같은 키·다른 장바구니 지문 → NOTICE_KEY_CONFLICT');
    v_j := pg_temp.rh_rec_m(v_user, v_key, pg_temp.ctx('market_v1_sha'));
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_KEY_CONFLICT', 'R3', '같은 키·장바구니 지문 NULL(기록은 값 있음) → NOTICE_KEY_CONFLICT');
    -- ⑥ 경로: ② 를 건너뛰는 사본으로 겹친 같은 키를 흉내 낸다
    v_m := public.build_checkout_consent_v2('market', pg_temp.policy('market_purchase_policy'), (pg_temp.policy('market_purchase_policy') ->> 'refundDays')::integer);
    v_key2 := gen_random_uuid();
    v_j := pg_temp.rh_rec_m(v_user, v_key2, v_m #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND (v_j -> 'replay') = 'false'::jsonb, 'R3', '2판 기록(키 K2)');
    v_j := pg_temp.rh_rec_m_step6(v_user, v_key2, v_m #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure((v_j -> 'replay') = 'true'::jsonb AND (v_j -> 'consentFormat') = '2'::jsonb, 'R3', '⑥ 경로 같은 값 → replay');
    PERFORM pg_temp.set_policy('market_purchase_policy', pg_temp.policy('market_purchase_policy') || jsonb_build_object('cartCheckoutNotice', '바뀐 안내입니다.'));
    v_cart := public.build_market_cart_texts(pg_temp.policy('market_purchase_policy'));
    v_j := pg_temp.rh_rec_m_step6(v_user, v_key2, v_m #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_KEY_CONFLICT', 'R3', '⑥ 경로 다른 장바구니 지문 → NOTICE_KEY_CONFLICT');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R3', m FROM unnest(v_log) m;
END
$rh_r3$;

DO $rh_r4$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_user uuid := pg_temp.rh_user();
  v_plan public.pricing_plans := pg_temp.rh_plan();
  v_key uuid;
  v_key2 uuid;
  v_m jsonb;
  v_p jsonb;
  v_cart jsonb;
  v_row record;
  v_sha text;
  v_footer jsonb := pg_temp.policy('site_footer_content');
BEGIN
  BEGIN

    IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'policy_upcoming_documents' AND value ->> 'status' = 'upcoming') THEN
      PERFORM pg_temp.fail('R4', '게시 행이 upcoming 이라 링크 문서 경우는 이 파일로 못 돈다 — 새벽에 lock_policy_documents_during_notice 를 그 거래에서만 끄는 사본으로(3절)');
    END IF;
    v_r := pg_temp.try_sql(pg_temp.script_sql('keys'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4', '스크립트 A');
    v_r := pg_temp.try_sql(pg_temp.script_sql('format2'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4', '스크립트 B');
    v_cart := public.build_market_cart_texts(pg_temp.policy('market_purchase_policy'));
    v_m := pg_temp.policy('market_purchase_policy');
    -- 2판 키 깨짐 → 결제만 닫힘, 환불 판정 함수는 새 키를 읽지 않음
    PERFORM pg_temp.set_policy('market_purchase_policy', v_m || jsonb_build_object('consentTitle', repeat('가', 27)));
    v_j := pg_temp.rh_rec_m(v_user, gen_random_uuid(), repeat('0', 64), v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_POLICY_UNAVAILABLE' AND (v_j -> 'consentFormat') = '2'::jsonb
      AND public.market_purchase_refund_days() = (v_m ->> 'refundDays')::integer, 'R4', '2판 키 깨짐 → NOTICE_POLICY_UNAVAILABLE, 환불 기간 판정 그대로');
    PERFORM pg_temp.set_policy('market_purchase_policy', v_m);
    v_p := pg_temp.policy('point_charge_policy');
    PERFORM pg_temp.set_policy('point_charge_policy', v_p - 'consentItems');
    v_j := pg_temp.rh_rec_p(v_user, gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, repeat('0', 64));
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_POLICY_UNAVAILABLE' AND public.point_charge_refund_days() = (v_p ->> 'refundDays')::integer,
      'R4', '충전 2판 키 깨짐 → 닫힘, 충전 환불 일수 그대로');
    PERFORM pg_temp.set_policy('point_charge_policy', v_p);
    -- 링크 문서 닫힘 세 가지(바닥글 원본을 거래 안에서만 바꿈)
    FOR v_j IN SELECT x FROM jsonb_array_elements('[{"path": "{policyDocuments,serviceTerms,enabled}", "value": false},
                                                    {"path": "{policyDocuments,refundPolicy,label}", "value": ""},
                                                    {"path": "{policyDocuments,serviceTerms,content}", "value": " "}]'::jsonb) x LOOP
      v_r := pg_temp.try_sql(format('UPDATE public.system_settings SET value = jsonb_set(value, %L::text[], %L::jsonb) WHERE key = %L',
        v_j ->> 'path', v_j -> 'value', 'site_footer_content'));
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4', '바닥글 ' || (v_j ->> 'path') || ' 바꿈');
      v_log := v_log || pg_temp.ensure(public.build_checkout_consent_v2('market', v_m, (v_m ->> 'refundDays')::integer) IS NULL
        AND (pg_temp.rh_rec_m(v_user, gen_random_uuid(), repeat('0', 64), v_cart ->> 'cartTextsSha256') ->> 'code') = 'NOTICE_POLICY_UNAVAILABLE'
        AND (pg_temp.rh_rec_p(v_user, gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, repeat('0', 64)) ->> 'code') = 'NOTICE_POLICY_UNAVAILABLE',
        'R4', '링크 문서 ' || (v_j ->> 'path') || ' → 2판 닫힘');
      -- 1판은 영향 없음(판을 1 로 바꾸면 기록됨)
      PERFORM pg_temp.set_policy('market_purchase_policy', v_m || '{"consentFormat": 1}'::jsonb);
      v_log := v_log || pg_temp.ensure((pg_temp.rh_rec_m(v_user, gen_random_uuid(), pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256') -> 'ok') = 'true'::jsonb,
        'R4', '같은 상태에서 1판 기록은 됨');
      PERFORM pg_temp.set_policy('market_purchase_policy', v_m);
      PERFORM pg_temp.set_policy('site_footer_content', v_footer);
      v_log := v_log || pg_temp.ensure(pg_temp.policy('site_footer_content') = v_footer, 'R4', '바닥글 원래 값으로');
    END LOOP;
    -- 링크 꺼진 채 스크립트 B 는 사전 검사로 멈춘다(판 1 로 돌린 뒤)
    PERFORM pg_temp.set_policy('market_purchase_policy', v_m || '{"consentFormat": 1}'::jsonb);
    PERFORM pg_temp.set_policy('point_charge_policy', v_p || '{"consentFormat": 1}'::jsonb);
    PERFORM pg_temp.try_sql($u$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,serviceTerms,enabled}', 'false') WHERE key = 'site_footer_content'$u$);
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format2')), 'ERR B11_FORMAT_2: consent v2 builder returned NULL', 'R4', '링크 꺼짐 → 스크립트 B 멈춤');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R4', m FROM unnest(v_log) m;
END
$rh_r4$;

DO $rh_r5$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_user uuid := pg_temp.rh_user();
  v_plan public.pricing_plans := pg_temp.rh_plan();
  v_key uuid;
  v_key2 uuid;
  v_m jsonb;
  v_p jsonb;
  v_cart jsonb;
  v_row record;
  v_sha text;
  v_footer jsonb := pg_temp.policy('site_footer_content');
BEGIN
  BEGIN

    v_r := pg_temp.try_sql(pg_temp.script_sql('keys'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R5', '스크립트 A');
    v_r := pg_temp.try_sql(pg_temp.script_sql('format2'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R5', '스크립트 B');
    v_cart := public.build_market_cart_texts(pg_temp.policy('market_purchase_policy'));
    PERFORM pg_temp.set_policy('market_purchase_policy', pg_temp.policy('market_purchase_policy') || jsonb_build_object('consentTitle', repeat('가', 27)));
    PERFORM pg_temp.try_sql($u$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,refundPolicy,enabled}', 'false') WHERE key = 'site_footer_content'$u$);
    v_log := v_log || pg_temp.ensure((pg_temp.rh_rec_m(v_user, gen_random_uuid(), pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256') ->> 'code') = 'NOTICE_POLICY_UNAVAILABLE',
      'R5', '2판 키 깨짐 + 링크 꺼짐 → 닫힘');
    v_r := pg_temp.try_sql(pg_temp.script_sql('format1'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R5', '되돌림 스크립트(2판이 닫힌 상태에서도 돎)');
    v_j := pg_temp.rh_rec_m(v_user, gen_random_uuid(), pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb, 'R5', '되돌린 뒤 자료 1판 기록 성공');
    v_j := pg_temp.rh_rec_p(v_user, gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, pg_temp.ctx('point_v1_sha'));
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb, 'R5', '되돌린 뒤 충전 1판 기록 성공');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R5', m FROM unnest(v_log) m;
END
$rh_r5$;

DO $rh_r9$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_user uuid := pg_temp.rh_user();
  v_plan public.pricing_plans := pg_temp.rh_plan();
  v_key uuid;
  v_key2 uuid;
  v_m jsonb;
  v_p jsonb;
  v_cart jsonb;
  v_row record;
  v_sha text;
  v_footer jsonb := pg_temp.policy('site_footer_content');
BEGIN
  BEGIN

    v_m := pg_temp.policy('market_purchase_policy');
    v_p := pg_temp.policy('point_charge_policy');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('keys', NULL)), 'ERR B11_KEYS: set c_mode', 'R9', 'A c_mode 없음 → 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('keys', 'apply', 'x')), 'ERR B11_KEYS: policy md5 differs', 'R9', 'A 정책 md5 불일치 → 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format1')), 'ERR B11_FORMAT_1: consentFormat must be 2', 'R9', '판 키 없음(판 1)에서 되돌림 → 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format2')), 'ERR B11_FORMAT_2: consentFormat must be 1', 'R9', 'A 전 B → 멈춤');
    v_log := v_log || pg_temp.ensure(pg_temp.policy('market_purchase_policy') = v_m AND pg_temp.policy('point_charge_policy') = v_p, 'R9', '멈춘 뒤 값 그대로');
    v_r := pg_temp.try_sql(pg_temp.script_sql('keys'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R9', '스크립트 A');
    v_m := pg_temp.policy('market_purchase_policy');
    v_p := pg_temp.policy('point_charge_policy');
    v_log := v_log || pg_temp.ensure((v_m -> 'consentFormat') = '1'::jsonb AND (v_m ->> 'version')::integer = 2 AND (v_p ->> 'version')::integer = 2
      AND (SELECT count(*) FROM public.admin_audit_log WHERE action = 'checkout_consent_keys_seed' AND details ->> 'bundle' = 'bundle11_consent_keys'
           AND details -> 'before' IS NOT NULL AND details -> 'after' = (CASE WHEN target_id = 'market_purchase_policy' THEN v_m ELSE v_p END)) >= 2, 'R9', 'A: 판 1·version +1·작업 기록 before/after 전체');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('keys')), 'ERR B11_KEYS: consentFormat already present', 'R9', 'A 재실행 → 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format1')), 'ERR B11_FORMAT_1: consentFormat must be 2', 'R9', '판 1 에서 되돌림 → 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format2', 'apply', 'x')), 'ERR B11_FORMAT_2: policy md5 differs', 'R9', 'B 정책 md5 불일치 → 멈춤');
    v_r := pg_temp.try_sql(pg_temp.script_sql('format2'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R9', '스크립트 B');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format2')), 'ERR B11_FORMAT_2: consentFormat must be 1', 'R9', 'B 재실행 → 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format1', 'apply', 'x')), 'ERR B11_FORMAT_1: policy md5 differs', 'R9', '되돌림 정책 md5 불일치 → 멈춤');
    v_log := v_log || pg_temp.ensure((pg_temp.policy('market_purchase_policy') -> 'consentFormat') = '2'::jsonb
      AND (pg_temp.policy('market_purchase_policy') ->> 'version')::integer = 3, 'R9', '멈춘 뒤 값 그대로(판 2·version 3)');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R9', m FROM unnest(v_log) m;
END
$rh_r9$;

DO $rh_r10$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_user uuid := pg_temp.rh_user();
  v_plan public.pricing_plans := pg_temp.rh_plan();
  v_key uuid;
  v_key2 uuid;
  v_m jsonb;
  v_p jsonb;
  v_cart jsonb;
  v_row record;
  v_sha text;
  v_footer jsonb := pg_temp.policy('site_footer_content');
BEGIN
  BEGIN

    v_r := pg_temp.try_sql(pg_temp.script_sql('keys'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R10', '스크립트 A');
    v_m := public.build_checkout_consent_v2('market', pg_temp.policy('market_purchase_policy'), (pg_temp.policy('market_purchase_policy') ->> 'refundDays')::integer);
    v_cart := public.build_market_cart_texts(pg_temp.policy('market_purchase_policy'));
    v_key := gen_random_uuid();
    v_j := pg_temp.rh_rec_m(v_user, v_key, v_m #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_CHANGED' AND (v_j #> '{details,consentFormat}') = '1'::jsonb
      AND NOT EXISTS (SELECT 1 FROM pg_temp.rh_market_acks a WHERE a.user_id = v_user AND a.idempotency_key = v_key), 'R10', '판 1 + 2판 지문(자료) → NOTICE_CHANGED·기록 없음');
    v_p := public.build_checkout_consent_v2('point_charge', pg_temp.policy('point_charge_policy'), public.point_charge_refund_days());
    v_key2 := gen_random_uuid();
    v_j := pg_temp.rh_rec_p(v_user, v_key2, v_plan.id, v_plan.price, v_plan.credits, v_p #>> '{details,noticeSha256}');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_CHANGED'
      AND NOT EXISTS (SELECT 1 FROM pg_temp.rh_charge_acks a WHERE a.user_id = v_user AND a.checkout_attempt_id = v_key2), 'R10', '판 1 + 2판 지문(충전) → NOTICE_CHANGED·기록 없음');
    -- 두 번째 클릭(409 의 1판 details 로 만든 1판 지문): DB 만으로는 기록된다 → 막는 것은 스위치가 켜진 감싸개(11-1 단위 시험)
    v_j := pg_temp.rh_rec_m(v_user, gen_random_uuid(), (pg_temp.rh_rec_m(v_user, gen_random_uuid(), v_m #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256')) #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb, 'R10', '두 번째 클릭(1판 지문)은 DB 만으로 기록됨 — 감싸개가 RPC 전에 막아야 함');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R10', m FROM unnest(v_log) m;
END
$rh_r10$;

DO $rh_fx_format$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_user uuid := pg_temp.rh_user();
  v_plan public.pricing_plans := pg_temp.rh_plan();
  v_key uuid;
  v_key2 uuid;
  v_m jsonb;
  v_p jsonb;
  v_cart jsonb;
  v_row record;
  v_sha text;
  v_footer jsonb := pg_temp.policy('site_footer_content');
BEGIN
  BEGIN

    v_r := pg_temp.try_sql(pg_temp.script_sql('keys'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'FX', '스크립트 A');
    DECLARE
      f jsonb := '[{"name":"키 없음","raw":"{}","format":1},{"name":"숫자 1","raw":"{\"consentFormat\": 1}","format":1},{"name":"숫자 1.0","raw":"{\"consentFormat\": 1.0}","format":1},{"name":"숫자 2","raw":"{\"consentFormat\": 2}","format":2},{"name":"글자 \"2\"","raw":"{\"consentFormat\": \"2\"}","format":null},{"name":"2.5","raw":"{\"consentFormat\": 2.5}","format":null},{"name":"3","raw":"{\"consentFormat\": 3}","format":null},{"name":"null","raw":"{\"consentFormat\": null}","format":null}]'::jsonb;
      c jsonb;
    BEGIN
      v_m := pg_temp.policy('market_purchase_policy') - 'consentFormat';
      FOR c IN SELECT x FROM jsonb_array_elements(f) x LOOP
        PERFORM pg_temp.set_policy('market_purchase_policy', v_m || (c ->> 'raw')::jsonb);
        v_j := pg_temp.rh_rec_m(v_user, gen_random_uuid(), repeat('0', 64));
        IF (v_j -> 'consentFormat') IS DISTINCT FROM coalesce(c -> 'format', 'null'::jsonb)
           OR (c -> 'format' = 'null'::jsonb AND v_j ->> 'code' <> 'NOTICE_POLICY_UNAVAILABLE') THEN
          PERFORM pg_temp.fail('FX', '판 값 ' || (c ->> 'name') || ' → ' || v_j::text);
        END IF;
        v_log := v_log || ('판 값 ' || (c ->> 'name') || ' → ' || coalesce(v_j ->> 'consentFormat', 'null') || ' ' || (v_j ->> 'code'));
      END LOOP;
    END;
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'FX', m FROM unnest(v_log) m;
END
$rh_fx_format$;

DO $rh_r6$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
BEGIN
  BEGIN

    v_r := pg_temp.try_sql(pg_temp.ctx('src_down'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R6', 'down 실행');
    v_log := v_log || pg_temp.ensure(to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)') IS NOT NULL
      AND to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text,text)') IS NULL
      AND to_regprocedure('public.build_checkout_consent_v2(text,jsonb,integer)') IS NULL
      AND pg_temp.md5_of('public.record_purchase_notice_ack(uuid,uuid,text)') = 'fa6a7edd836f21422d52dd184afb079b'
      AND pg_temp.md5_of('public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)') = 'be4403fd993c45d618950a5908a91591',
      'R6', 'down 뒤 3인자만·md5 바탕 값·내부 함수 없음');
    v_j := public.record_point_charge_checkout_ack(NULL, NULL, NULL, NULL, NULL, 'x');
    v_log := v_log || pg_temp.ensure(NOT (v_j ? 'consentFormat'), 'R6', 'down 뒤 충전 응답에 consentFormat 없음');
    v_j := public.record_purchase_notice_ack(pg_temp.rh_user(), gen_random_uuid(), repeat('e', 64));
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_CHANGED' AND (v_j -> 'details') = (pg_temp.ctx('old_market_changed')::jsonb) -> 'details',
      'R6', '옛 함수는 2판(다른) 지문을 1판 details 로 거절');
    v_r := pg_temp.try_sql(pg_temp.ctx('src_down'));
    v_log := v_log || pg_temp.expect(v_r, 'ERR DOWN PRECHECK', 'R6', 'down 두 번 → 사전 검사 멈춤');
    v_r := pg_temp.try_sql(pg_temp.ctx('src_down_b_precheck'));
    v_log := v_log || pg_temp.ensure(v_r NOT LIKE '%record_point_charge_checkout_ack%', 'R8', '11번 down 뒤 10번 down_b 사전 검사는 충전 함수 검사를 지남 → ' || left(v_r, 120));
    v_r := pg_temp.try_sql($rh_r6_copy$-- 출시 전 작업 순서표 11번 묶음: 결제 화면 단순화 — 동의 2판(접는 동의)(계획 docs/plan-bundle11-checkout-simplify.md 13판 5절).
-- 만드는 것:
--   1. 칸: market_purchase_notice_acks(refund_policy_sha256·terms_policy_sha256·consent_format·consent_details),
--      point_charge_checkout_acks(terms_policy_sha256·consent_format·consent_details). 칸은 down 이 지우지 않는다(증빙).
--      consent_format 은 상수 기본값 1 이라 표를 다시 쓰지 않고, 추가 전용 가드 트리거와 부딪치지 않는다.
--   2. 내부 함수(ACL postgres 만): build_market_cart_texts(장바구니 문구 검사·지문), build_checkout_consent_v2(2판 문구 검사·링크 문서 검사·원문·묶음).
--      둘 다 판(consentFormat)을 보지 않는다. TS(src/lib/checkout-consent.ts)와 같은 규칙이다.
--   3. 재정의: record_purchase_notice_ack 3인자 → 4인자(p_cart_texts_sha256 DEFAULT NULL — 옛 코드의 이름 인자 3개 호출은 기본값으로 맞음),
--      record_point_charge_checkout_ack(6인자 그대로). 판 분기, 2판 기록 칸, 장바구니 문구 대조, 모든 응답에 consentFormat 키.
-- 정책에 consentFormat 이 없으면(스크립트 A 전) 1판 그대로라 화면·기록 변화가 없다(옛 코드 호출은 cartTexts null 로 기록).
-- 함수 지문은 md5(pg_get_functiondef(oid)) — 9·10번과 같은 측정. 사전 값이 다르면 멈춘다.
-- 잠금: 두 기록 표에 ACCESS EXCLUSIVE(칸 추가 — 거래 끝까지 읽기도 막음). 새벽에 짧게 적용하고, 잡지 못하면(lock_timeout 3초) 전체가 취소된다.
-- 다시 적용: down 없이 같은 파일을 다시 실행해도 멈추지 않는다(사전 검사가 이 파일의 새 값도 받음). 이력을 다시 넣으려면 10번 머리말과 같이
--   같은 거래에서 schema_migrations 의 '20261216100000' 행을 지운 뒤 이 파일과 이력 INSERT 를 넣는다.
-- 되돌리기: supabase/rollback/20261216100000_checkout_consent_v2_down.sql(코드를 11번 전으로 되돌린 뒤에만, 10절 되돌리기 순서).
--   10번을 되돌려야 하면 이 down 을 먼저 한다(10번 _down_b 는 충전 함수가 10번 값일 때만 돈다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- 잠그는 순서: 자료 동의 기록 → 충전 동의 기록(교착 방지).

-- 0. 사전 점검 -------------------------------------------------------------------------------------------------
DO $precheck_checkout_consent_v2$
DECLARE
  -- 바꾸는 함수: {서명, 바탕 값(없으면 ''), 이 파일의 새 값}
  v_changed text[][] := ARRAY[
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', 'be4403fd993c45d618950a5908a91591', '4b23fdf6b9c7bcf76e39ee5b7b1a629f'],
    ARRAY['public.build_checkout_consent_v2(text,jsonb,integer)', '', '3fd97051955741db213297804131c1e3'],
    ARRAY['public.build_market_cart_texts(jsonb)', '', '604251e0a0b5f85b58aaeccb0c593d05']
  ];
  -- 그대로여야 함(계획 5-5, 2026-11-26 운영 값)
  v_same text[][] := ARRAY[
    ARRAY['public.checkout_market_selection(uuid,text,uuid,jsonb,uuid)', '0cda5ff7689d998cc6cf2fd213b0004d'],
    ARRAY['public.get_point_charge_refund_eligibility(uuid,uuid)', '60fc28afe44e7be776c189265e87b6ec'],
    ARRAY['public.point_charge_refund_days()', '7ab4d40c1634ade20de86517fa13cd40'],
    ARRAY['public.guard_point_charge_checkout_acks_mutation()', 'c7ef25308c6c0aa2920991965fb87ab0'],
    ARRAY['public.guard_market_purchase_notice_acks_mutation()', '3959ac2b8139d0f81365df59ed67ef10'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '93e0bd5e41969f66f296f4353f3feeb9'],
    ARRAY['public.begin_payapp_request(uuid)', '679b4474c0dc42de11e5e9a14a7d1d4d'],
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '657bbb07ae4b250a2697f21e2aa805e9'],
    ARRAY['public.market_purchase_refund_days()', '5d4030e7bedbace6189cefed80c3d27b'],
    ARRAY['public.record_policy_document_snapshots()', '4ffeca80346467f928c0a6f50b69018d'],
    ARRAY['public.prevent_policy_document_snapshot_mutation()', 'b1449554c094a90be7a6c864f367fdf8'],
    ARRAY['public.member_withdrawal_facts(uuid,boolean)', 'a7674770964dac2fe5c9179b8403c3b4'],
    ARRAY['public.get_member_withdrawal_preview(uuid,boolean)', '3a2e2c2f6eb6ecb15defe0879c88e0fc'],
    ARRAY['public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)', '1346d870d3623abae580a011b0484339']
  ];
  v_old regprocedure := to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)');
  v_new regprocedure := to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text,text)');
  v_md5 text;
  i integer;
BEGIN
  -- 자료 기록 함수: 3인자(바탕 값)나 4인자(이 파일 값) 중 정확히 하나만 있어야 한다.
  IF (v_old IS NULL) = (v_new IS NULL) THEN
    RAISE EXCEPTION 'PRECHECK: record_purchase_notice_ack must exist with exactly one of 3/4 arguments';
  END IF;
  IF v_old IS NOT NULL AND md5(pg_get_functiondef(v_old)) <> 'fa6a7edd836f21422d52dd184afb079b' THEN
    RAISE EXCEPTION 'PRECHECK: record_purchase_notice_ack(uuid,uuid,text) changed (%)', md5(pg_get_functiondef(v_old));
  END IF;
  IF v_new IS NOT NULL AND md5(pg_get_functiondef(v_new)) <> '9d2cb23a7aa16e45970525248bcc4435' THEN
    RAISE EXCEPTION 'PRECHECK: record_purchase_notice_ack(uuid,uuid,text,text) changed (%)', md5(pg_get_functiondef(v_new));
  END IF;
  FOR i IN 1 .. array_length(v_changed, 1) LOOP
    IF to_regprocedure(v_changed[i][1]) IS NULL THEN
      IF v_changed[i][2] <> '' THEN
        RAISE EXCEPTION 'PRECHECK: % missing', v_changed[i][1];
      END IF;
      CONTINUE;
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(v_changed[i][1])));
    IF v_md5 IS DISTINCT FROM v_changed[i][2] AND v_md5 IS DISTINCT FROM v_changed[i][3] THEN
      RAISE EXCEPTION 'PRECHECK: % changed (%)', v_changed[i][1], v_md5;
    END IF;
  END LOOP;
  FOR i IN 1 .. array_length(v_same, 1) LOOP
    IF to_regprocedure(v_same[i][1]) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) <> v_same[i][2] THEN
      RAISE EXCEPTION 'PRECHECK: % changed (%)', v_same[i][1], md5(pg_get_functiondef(to_regprocedure(v_same[i][1])));
    END IF;
  END LOOP;
  IF to_regclass('public.policy_document_snapshots') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'site_footer_content') THEN
    RAISE EXCEPTION 'PRECHECK: policy document snapshots / site_footer_content missing';
  END IF;
END;
$precheck_checkout_consent_v2$;

-- [11번] 시작 ---------------------------------------------------------------------------------------------------
-- 1. 기록 칸(5-3) -----------------------------------------------------------------------------------------------



-- 2. 장바구니 문구 검사·지문(4-3 끝, 5-4). 어기면 NULL. 지문 = sha256(안내 LF 정가 확인), trim 없음. ----------------------
CREATE OR REPLACE FUNCTION public.build_market_cart_texts(p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_build_market_cart_texts$
DECLARE
  v_key text;
  v_text text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
    RETURN NULL;
  END IF;
  FOREACH v_key IN ARRAY ARRAY['cartCheckoutNotice', 'partialOwnedConfirmLabel'] LOOP
    IF jsonb_typeof(p_value -> v_key) IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_text := p_value ->> v_key;
    IF v_text !~ '[^ \t\n\r]' OR char_length(v_text) > 300 OR strpos(v_text, chr(10)) > 0 OR v_text ~ '[{}]' THEN
      RETURN NULL;
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'cartCheckoutNotice', p_value ->> 'cartCheckoutNotice',
    'partialOwnedConfirmLabel', p_value ->> 'partialOwnedConfirmLabel',
    'cartTextsSha256', encode(sha256(convert_to((p_value ->> 'cartCheckoutNotice') || chr(10) || (p_value ->> 'partialOwnedConfirmLabel'), 'UTF8')), 'hex'));
END;
$fn_build_market_cart_texts$;
REVOKE ALL ON FUNCTION public.build_market_cart_texts(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- 3. 2판 검사·원문·묶음(4-3 (S)~(g), 5-1·5-2). 성공 {text, details}, 어기면 NULL. 판을 보지 않는다. --------------------
--   p_kind 'market'(자료, {자료환불기간}) | 'point_charge'(충전, {충전환불기간}·{충전유효기간}=1). p_refund_days: 자료 refundDays, 충전 point_charge_refund_days().
--   링크 문서((g))는 정규화하지 않은 바닥글 원본(site_footer_content.value.policyDocuments.<키>)과 그 문서의 사본이 있는지로 본다.
CREATE OR REPLACE FUNCTION public.build_checkout_consent_v2(p_kind text, p_value jsonb, p_refund_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_build_checkout_consent_v2$
DECLARE
  c_years constant text := '1';
  v_days text;
  v_roles text[];
  v_required boolean[];
  v_role_ph text[];
  v_targets text[];
  v_required_targets text[];
  v_summary jsonb;
  v_items jsonb;
  v_item jsonb;
  v_target_json jsonb;
  v_key text;
  v_view text;
  v_link text;
  v_line text;
  v_body text;
  v_total integer := 0;
  v_one_line text[] := '{}';
  v_one_line_max integer[] := '{}';
  v_keys text[] := '{}';
  v_used_targets text[] := '{}';
  v_used_links text[] := '{}';
  v_summary_out jsonb := '[]'::jsonb;
  v_items_out jsonb := '[]'::jsonb;
  v_texts_out jsonb;
  v_lines text[];
  v_footer jsonb;
  v_doc jsonb;
  v_text text;
  v_details jsonb;
  i integer;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('market', 'point_charge') OR p_value IS NULL OR jsonb_typeof(p_value) <> 'object'
     OR p_refund_days IS NULL OR p_refund_days <= 0 THEN
    RETURN NULL;
  END IF;
  v_days := p_refund_days::text;
  IF p_kind = 'market' THEN
    v_roles := ARRAY['refundPeriod', 'restriction', 'note'];
    v_required := ARRAY[true, true, false];
    v_role_ph := ARRAY['{자료환불기간}', '', ''];
    v_targets := ARRAY['confirmNotice', 'usageScopeNotice', 'downloadPeriodNotice'];
    v_required_targets := ARRAY['confirmNotice'];
  ELSE
    v_roles := ARRAY['refundPeriod', 'restriction', 'validity', 'minor', 'note'];
    v_required := ARRAY[true, true, true, true, false];
    v_role_ph := ARRAY['{충전환불기간}', '', '{충전유효기간}', '', ''];
    v_targets := ARRAY['checkoutItems.product', 'checkoutItems.validity', 'checkoutItems.refund', 'checkoutItems.restriction',
                       'checkoutItems.otherCases', 'minorNotice'];
    v_required_targets := v_targets;
  END IF;

  -- (a) 제목(한 줄 규칙은 아래 (S1) 에서 함께)
  IF jsonb_typeof(p_value -> 'consentTitle') IS DISTINCT FROM 'string' THEN
    RETURN NULL;
  END IF;
  IF strpos(p_value ->> 'consentTitle', '[필수]') > 0 THEN
    RETURN NULL;
  END IF;
  v_one_line := v_one_line || (p_value ->> 'consentTitle');
  v_one_line_max := v_one_line_max || 26;

  -- (b) 요약 줄: 객체, 모르는 키 없음, 역할 순서, 선택 역할은 키가 없을 때만 빠짐
  v_summary := p_value -> 'consentSummary';
  IF jsonb_typeof(v_summary) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_summary) k WHERE NOT (k = ANY (v_roles))) THEN
    RETURN NULL;
  END IF;
  FOR i IN 1 .. array_length(v_roles, 1) LOOP
    IF NOT (v_summary ? v_roles[i]) THEN
      IF v_required[i] THEN
        RETURN NULL;
      END IF;
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_summary -> v_roles[i]) IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_line := v_summary ->> v_roles[i];
    IF v_role_ph[i] <> '' AND strpos(v_line, v_role_ph[i]) = 0 THEN
      RETURN NULL;
    END IF;
    v_one_line := v_one_line || v_line;
    v_one_line_max := v_one_line_max || 120;
    v_total := v_total + char_length(v_line);
    v_summary_out := v_summary_out || to_jsonb(CASE p_kind
      WHEN 'market' THEN replace(v_line, '{자료환불기간}', v_days)
      ELSE replace(replace(v_line, '{충전환불기간}', v_days), '{충전유효기간}', c_years) END);
  END LOOP;
  IF p_kind = 'market' AND v_total > 220 THEN
    RETURN NULL;
  END IF;

  -- (d)(e) 항목: 1~6개, 정확한 키 모양, key 규칙·중복 없음, textKeys 1~6개·전체 중복 없음·가리킬 수 있는 본문만, link 는 각각 한 번까지
  v_items := p_value -> 'consentItems';
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_items) < 1 OR jsonb_array_length(v_items) > 6 THEN
    RETURN NULL;
  END IF;
  FOR v_item IN SELECT e.value FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR jsonb_typeof(v_item -> 'view') IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_view := v_item ->> 'view';
    IF v_view NOT IN ('text', 'link')
       OR (SELECT string_agg(k COLLATE "C", ',' ORDER BY k COLLATE "C") FROM jsonb_object_keys(v_item) k)
          IS DISTINCT FROM (CASE v_view WHEN 'text' THEN 'key,label,textKeys,view' ELSE 'key,label,link,view' END) THEN
      RETURN NULL;
    END IF;
    IF jsonb_typeof(v_item -> 'key') IS DISTINCT FROM 'string' OR jsonb_typeof(v_item -> 'label') IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_key := v_item ->> 'key';
    IF v_key !~ '^[a-z][A-Za-z0-9]{0,29}$' OR v_key = ANY (v_keys) THEN
      RETURN NULL;
    END IF;
    v_keys := v_keys || v_key;
    v_one_line := v_one_line || (v_item ->> 'label');
    v_one_line_max := v_one_line_max || 30;
    IF v_view = 'text' THEN
      IF jsonb_typeof(v_item -> 'textKeys') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_item -> 'textKeys') < 1 OR jsonb_array_length(v_item -> 'textKeys') > 6 THEN
        RETURN NULL;
      END IF;
      v_texts_out := '[]'::jsonb;
      FOR v_target_json IN SELECT t.value FROM jsonb_array_elements(v_item -> 'textKeys') WITH ORDINALITY AS t(value, n) ORDER BY t.n LOOP
        IF jsonb_typeof(v_target_json) IS DISTINCT FROM 'string' OR NOT ((v_target_json #>> '{}') = ANY (v_targets))
           OR (v_target_json #>> '{}') = ANY (v_used_targets) THEN
          RETURN NULL;
        END IF;
        v_used_targets := v_used_targets || (v_target_json #>> '{}');
        -- (e) 정해진 잎만 읽는다(일반 경로 풀이 금지)
        v_target_json := CASE v_target_json #>> '{}'
          WHEN 'confirmNotice' THEN p_value -> 'confirmNotice'
          WHEN 'usageScopeNotice' THEN p_value -> 'usageScopeNotice'
          WHEN 'downloadPeriodNotice' THEN p_value -> 'downloadPeriodNotice'
          WHEN 'checkoutItems.product' THEN p_value -> 'checkoutItems' -> 'product'
          WHEN 'checkoutItems.validity' THEN p_value -> 'checkoutItems' -> 'validity'
          WHEN 'checkoutItems.refund' THEN p_value -> 'checkoutItems' -> 'refund'
          WHEN 'checkoutItems.restriction' THEN p_value -> 'checkoutItems' -> 'restriction'
          WHEN 'checkoutItems.otherCases' THEN p_value -> 'checkoutItems' -> 'otherCases'
          WHEN 'minorNotice' THEN p_value -> 'minorNotice'
        END;
        -- (S) 본문: 글자, 비지 않음, 채운 뒤 중괄호 없음(LF 는 허용)
        IF jsonb_typeof(v_target_json) IS DISTINCT FROM 'string' THEN
          RETURN NULL;
        END IF;
        v_body := v_target_json #>> '{}';
        IF v_body !~ '[^ \t\n\r]' THEN
          RETURN NULL;
        END IF;
        IF (CASE p_kind WHEN 'market' THEN replace(v_body, '{자료환불기간}', '')
            ELSE replace(replace(v_body, '{충전환불기간}', ''), '{충전유효기간}', '') END) ~ '[{}]' THEN
          RETURN NULL;
        END IF;
        v_texts_out := v_texts_out || to_jsonb(CASE p_kind
          WHEN 'market' THEN replace(v_body, '{자료환불기간}', v_days)
          ELSE replace(replace(v_body, '{충전환불기간}', v_days), '{충전유효기간}', c_years) END);
      END LOOP;
      v_items_out := v_items_out || jsonb_build_array(jsonb_build_object(
        'key', v_key,
        'label', CASE p_kind WHEN 'market' THEN replace(v_item ->> 'label', '{자료환불기간}', v_days)
                 ELSE replace(replace(v_item ->> 'label', '{충전환불기간}', v_days), '{충전유효기간}', c_years) END,
        'view', 'text',
        'texts', v_texts_out));
    ELSE
      IF jsonb_typeof(v_item -> 'link') IS DISTINCT FROM 'string' THEN
        RETURN NULL;
      END IF;
      v_link := v_item ->> 'link';
      IF v_link NOT IN ('refundPolicy', 'serviceTerms') OR v_link = ANY (v_used_links) THEN
        RETURN NULL;
      END IF;
      v_used_links := v_used_links || v_link;
      v_items_out := v_items_out || jsonb_build_array(jsonb_build_object(
        'key', v_key,
        'label', CASE p_kind WHEN 'market' THEN replace(v_item ->> 'label', '{자료환불기간}', v_days)
                 ELSE replace(replace(v_item ->> 'label', '{충전환불기간}', v_days), '{충전유효기간}', c_years) END,
        'view', 'link',
        'link', v_link));
    END IF;
  END LOOP;

  -- (f) 포함: 필수 본문과 두 링크
  IF NOT (v_required_targets <@ v_used_targets) OR NOT (ARRAY['refundPolicy', 'serviceTerms'] <@ v_used_links) THEN
    RETURN NULL;
  END IF;

  -- (S)(S1)(c) 한 줄 칸(제목·요약 줄·항목 이름): 1~최대 글자(채우기 전 코드포인트), 비지 않음, LF 없음, 채운 뒤 중괄호 없음, 숫자·기간 낱말 없음
  FOR i IN 1 .. array_length(v_one_line, 1) LOOP
    v_line := v_one_line[i];
    IF char_length(v_line) < 1 OR char_length(v_line) > v_one_line_max[i]
       OR v_line !~ '[^ \t\n\r]'
       OR strpos(v_line, chr(10)) > 0
       OR (CASE p_kind WHEN 'market' THEN replace(v_line, '{자료환불기간}', '')
           ELSE replace(replace(v_line, '{충전환불기간}', ''), '{충전유효기간}', '') END) ~ '[{}]'
       OR v_line ~ '[0-9０-９]'
       OR v_line ~ '([일이삼사오육칠팔구십백]+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|서른)[ \t\n]*(일째|일|년|개월|달|주일|주|시간)'
       OR v_line ~ '(하루|이틀|사흘|나흘|열흘|보름|한 해)' THEN
      RETURN NULL;
    END IF;
  END LOOP;

  -- (g) 링크 문서가 보여야 함: 원본 객체, enabled 정확히 true, label·content 비지 않은 글자, 사본 하나 이상
  SELECT s.value INTO v_footer FROM public.system_settings s WHERE s.key = 'site_footer_content';
  FOREACH v_link IN ARRAY ARRAY['refundPolicy', 'serviceTerms'] LOOP
    v_doc := v_footer -> 'policyDocuments' -> v_link;
    IF jsonb_typeof(v_doc) IS DISTINCT FROM 'object'
       OR (v_doc -> 'enabled') IS DISTINCT FROM 'true'::jsonb
       OR jsonb_typeof(v_doc -> 'label') IS DISTINCT FROM 'string' OR (v_doc ->> 'label') !~ '[^ \t\n\r]'
       OR jsonb_typeof(v_doc -> 'content') IS DISTINCT FROM 'string' OR (v_doc ->> 'content') !~ '[^ \t\n\r]'
       OR NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots d WHERE d.doc_key = v_link) THEN
      RETURN NULL;
    END IF;
  END LOOP;

  -- 원문(5-1): 제목, 요약 줄, 항목마다 이름 + (본문들 | '링크:' + 키), LF 로 잇는다(끝 LF 없음, trim·정규화 없음)
  v_lines := ARRAY[CASE p_kind WHEN 'market' THEN replace(p_value ->> 'consentTitle', '{자료환불기간}', v_days)
                   ELSE replace(replace(p_value ->> 'consentTitle', '{충전환불기간}', v_days), '{충전유효기간}', c_years) END];
  v_lines := v_lines || ARRAY(SELECT e.value #>> '{}' FROM jsonb_array_elements(v_summary_out) WITH ORDINALITY AS e(value, n) ORDER BY e.n);
  FOR v_item IN SELECT e.value FROM jsonb_array_elements(v_items_out) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    v_lines := v_lines || (v_item ->> 'label');
    IF v_item ->> 'view' = 'text' THEN
      v_lines := v_lines || ARRAY(SELECT t.value #>> '{}' FROM jsonb_array_elements(v_item -> 'texts') WITH ORDINALITY AS t(value, n) ORDER BY t.n);
    ELSE
      v_lines := v_lines || ('링크:' || (v_item ->> 'link'));
    END IF;
  END LOOP;
  v_text := array_to_string(v_lines, chr(10));
  v_details := jsonb_build_object(
    'consentFormat', 2,
    'consentTitle', v_lines[1],
    'consentSummary', v_summary_out,
    'consentItems', v_items_out,
    'noticeSha256', encode(sha256(convert_to(v_text, 'UTF8')), 'hex'),
    'refundDays', p_refund_days);
  RETURN jsonb_build_object('text', v_text, 'details', v_details);
END;
$fn_build_checkout_consent_v2$;
REVOKE ALL ON FUNCTION public.build_checkout_consent_v2(text, jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;

-- 4. 자료 구매 고지 동의 기록(3인자 → 4인자). 같은 거래에서 옛 서명을 지우고 만든다(다시 실행해도 멈추지 않음). ------------------
DROP FUNCTION IF EXISTS public.record_purchase_notice_ack(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.record_purchase_notice_ack(p_user_id uuid, p_idempotency_key uuid, p_notice_sha256 text, p_cart_texts_sha256 text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing_sha text;
  v_value jsonb;
  v_days_numeric numeric;
  v_days integer;
  v_label text;
  v_notice text;
  v_text text;
  v_sha text;
  v_inserted_id uuid;
  v_details jsonb;
  -- [11번] 시작
  v_existing_format smallint;
  v_existing_cart text;
  v_format smallint;
  v_built jsonb;
  v_cart jsonb;
  v_refund_doc text;
  v_terms_doc text;
  -- [11번] 끝
BEGIN
  -- ① 입력 검사
  IF p_user_id IS NULL OR p_idempotency_key IS NULL OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$'
     -- [11번] 시작
     OR (p_cart_texts_sha256 IS NOT NULL AND p_cart_texts_sha256 !~ '^[0-9a-f]{64}$') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID', 'consentFormat', NULL);
    -- [11번] 끝
  END IF;

  -- ② 같은 키로 이미 기록했고 지문이 같으면 그대로 통과(402 뒤 다시 누르기, 503 뒤 재시도)
  -- [11번] 장바구니 문구 지문도 같아야 한다(NULL 끼리도 같음 — 옛 코드의 재시도가 replay 로 끝나게)
  SELECT a.notice_sha256, a.consent_format, a.consent_details -> 'cartTexts' ->> 'cartTextsSha256'
    INTO v_existing_sha, v_existing_format, v_existing_cart
    FROM public.market_purchase_notice_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  IF FOUND AND v_existing_sha = p_notice_sha256 AND v_existing_cart IS NOT DISTINCT FROM p_cart_texts_sha256 THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing_format);
  END IF;

  -- ③ 지금 정책: 판(consentFormat), refundDays 는 숫자·정수·양수
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'market_purchase_policy';
  -- [11번] 시작: 판 — 없거나 숫자 1 → 1, 숫자 2 → 2, 그 밖 → 닫힘(consentFormat null)
  v_format := CASE
    WHEN v_value IS NULL OR jsonb_typeof(v_value) <> 'object' THEN NULL
    WHEN NOT (v_value ? 'consentFormat') THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 1 THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 2 THEN 2
  END;
  IF v_format IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', NULL);
  END IF;
  -- [11번] 끝
  IF jsonb_typeof(v_value -> 'refundDays') IS DISTINCT FROM 'number' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', v_format);
  END IF;
  v_days_numeric := (v_value ->> 'refundDays')::numeric;
  IF v_days_numeric <> trunc(v_days_numeric) OR v_days_numeric <= 0 OR v_days_numeric > 3650 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', v_format);
  END IF;
  v_days := v_days_numeric::integer;
  -- [11번] 시작: 장바구니 문구(판과 관계없음)
  v_cart := public.build_market_cart_texts(v_value);
  IF v_format = 2 THEN
    -- 2판: 묶음(문구·링크 문서 검사 포함)과 두 문서 지문. 사본이 없으면 NULL 로 두지 않고 닫는다.
    v_built := public.build_checkout_consent_v2('market', v_value, v_days);
    SELECT d.content_sha256 INTO v_refund_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'refundPolicy' ORDER BY d.seq DESC LIMIT 1;
    SELECT d.content_sha256 INTO v_terms_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'serviceTerms' ORDER BY d.seq DESC LIMIT 1;
    IF v_built IS NULL OR v_refund_doc IS NULL OR v_terms_doc IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_text := v_built ->> 'text';
    v_details := v_built -> 'details';
    v_sha := v_details ->> 'noticeSha256';
  ELSE
  -- [11번] 끝
    -- 1판: 두 문구는 비어 있지 않은 글자(지금 규칙 그대로)
    IF jsonb_typeof(v_value -> 'checkboxLabel') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_value -> 'confirmNotice') IS DISTINCT FROM 'string' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_label := replace(v_value ->> 'checkboxLabel', '{자료환불기간}', v_days::text);
    v_notice := replace(v_value ->> 'confirmNotice', '{자료환불기간}', v_days::text);
    IF btrim(v_label) = '' OR btrim(v_notice) = '' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_text := v_label || chr(10) || v_notice;
    v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
    v_details := jsonb_build_object('checkboxLabel', v_label, 'confirmNotice', v_notice, 'noticeSha256', v_sha, 'refundDays', v_days,
                                    'consentFormat', 1);
  END IF;

  -- ④ 같은 키를 다른 화면(지문)으로 다시 쓰면 거절 — 화면은 새 키를 만든다
  IF v_existing_sha IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;

  -- ⑤ 화면에 보인 문구가 지금 문구와 다르면 거절
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;
  -- [11번] 시작: 화면에 보인 장바구니 문구가 지금 문구와 다르거나 지금 문구가 규칙 위반이면 기록하지 않고 거절(인자 NULL = 옛 코드는 지금처럼 기록)
  IF p_cart_texts_sha256 IS NOT NULL AND (v_cart IS NULL OR (v_cart ->> 'cartTextsSha256') <> p_cart_texts_sha256) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;
  -- [11번] 끝

  -- ⑥ 기록
  INSERT INTO public.market_purchase_notice_acks (user_id, idempotency_key, notice_sha256, notice_text, refund_days,
                                                  consent_format, refund_policy_sha256, terms_policy_sha256, consent_details)
  VALUES (p_user_id, p_idempotency_key, v_sha, v_text, v_days,
          v_format, CASE WHEN v_format = 2 THEN v_refund_doc END, CASE WHEN v_format = 2 THEN v_terms_doc END,
          CASE WHEN v_format = 2
               THEN jsonb_build_object('cartTexts', CASE WHEN p_cart_texts_sha256 IS NULL THEN NULL ELSE v_cart END,
                                       'consent', v_details - 'noticeSha256' - 'plan')
               ELSE jsonb_build_object('cartTexts', CASE WHEN p_cart_texts_sha256 IS NULL THEN NULL ELSE v_cart END) END)
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted_id;
  IF v_inserted_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false, 'consentFormat', v_format);
  END IF;

  SELECT a.notice_sha256, a.consent_format, a.consent_details -> 'cartTexts' ->> 'cartTextsSha256'
    INTO v_existing_sha, v_existing_format, v_existing_cart
    FROM public.market_purchase_notice_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  IF v_existing_sha = p_notice_sha256 AND v_existing_cart IS NOT DISTINCT FROM p_cart_texts_sha256 THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing_format);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_purchase_notice_ack(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_purchase_notice_ack(uuid, uuid, text, text) TO service_role;

-- 5. 충전 결제 전 확인 동의 기록(6인자 그대로). 탈퇴 거절은 맨 앞 그대로. ----------------------------------------------
CREATE OR REPLACE FUNCTION public.record_point_charge_checkout_ack(p_user_id uuid, p_checkout_attempt_id uuid, p_plan_id uuid, p_expected_amount integer, p_expected_credits integer, p_notice_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing public.point_charge_checkout_acks%ROWTYPE;
  v_value jsonb;
  v_items jsonb;
  v_days integer;
  v_parts text[];
  v_part text;
  v_key text;
  v_text text;
  v_sha text;
  v_plan public.pricing_plans%ROWTYPE;
  v_details jsonb;
  v_policy_sha text;
  v_inserted uuid;
  -- [11번] 시작
  v_format smallint;
  v_built jsonb;
  v_terms_doc text;
  -- [11번] 끝
BEGIN
  IF p_user_id IS NULL OR p_checkout_attempt_id IS NULL OR p_plan_id IS NULL OR p_expected_amount IS NULL OR p_expected_credits IS NULL
     OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID', 'consentFormat', NULL);
  END IF;
  -- [10번] 시작
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.withdrawn_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MEMBER_WITHDRAWN', 'consentFormat', NULL);
  END IF;
  -- [10번] 끝

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;

  -- 지금 정책(필수 키·자리표시 규칙 — TS 저장 검사와 같음)
  v_days := public.point_charge_refund_days();
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'point_charge_policy';
  -- [11번] 시작: 판 — 없거나 숫자 1 → 1, 숫자 2 → 2, 그 밖 → 닫힘(consentFormat null)
  v_format := CASE
    WHEN v_value IS NULL OR jsonb_typeof(v_value) <> 'object' THEN NULL
    WHEN NOT (v_value ? 'consentFormat') THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 1 THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 2 THEN 2
  END;
  IF v_format IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', NULL);
  END IF;
  SELECT * INTO v_plan FROM public.pricing_plans p WHERE p.id = p_plan_id;
  IF v_format = 2 THEN
    -- 2판: 묶음(문구·링크 문서 검사 포함)과 이용약관 문서 지문. 사본이 없으면 NULL 로 두지 않고 닫는다.
    IF v_days IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_built := public.build_checkout_consent_v2('point_charge', v_value, v_days);
    SELECT d.content_sha256 INTO v_terms_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'serviceTerms' ORDER BY d.seq DESC LIMIT 1;
    IF v_built IS NULL OR v_terms_doc IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots d WHERE d.doc_key = 'refundPolicy') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_text := v_built ->> 'text';
    v_sha := v_built #>> '{details,noticeSha256}';
    v_details := (v_built -> 'details') || jsonb_build_object(
      'plan', CASE WHEN v_plan.id IS NULL THEN NULL ELSE jsonb_build_object('price', v_plan.price, 'credits', v_plan.credits) END);
  ELSE
  -- [11번] 끝
    v_items := v_value -> 'checkoutItems';
    IF v_days IS NULL OR jsonb_typeof(v_items) IS DISTINCT FROM 'object' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_parts := ARRAY[v_value ->> 'checkoutTitle', v_items ->> 'product', v_items ->> 'validity', v_items ->> 'refund',
                     v_items ->> 'restriction', v_items ->> 'otherCases', v_value ->> 'minorNotice', v_value ->> 'agreeLabel'];
    FOREACH v_part IN ARRAY v_parts LOOP
      IF v_part IS NULL OR v_part !~ '\S' OR replace(v_part, '{충전환불기간}', '') ~ '[{}]' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
      END IF;
    END LOOP;
    IF strpos(v_items ->> 'refund', '{충전환불기간}') = 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_text := array_to_string(ARRAY(SELECT replace(x, '{충전환불기간}', v_days::text) FROM unnest(v_parts) WITH ORDINALITY AS t(x, n) ORDER BY n), chr(10));
    v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');

    v_details := jsonb_build_object(
      'checkoutTitle', replace(v_value ->> 'checkoutTitle', '{충전환불기간}', v_days::text),
      'checkoutItems', jsonb_build_object(
        'product', replace(v_items ->> 'product', '{충전환불기간}', v_days::text),
        'validity', replace(v_items ->> 'validity', '{충전환불기간}', v_days::text),
        'refund', replace(v_items ->> 'refund', '{충전환불기간}', v_days::text),
        'restriction', replace(v_items ->> 'restriction', '{충전환불기간}', v_days::text),
        'otherCases', replace(v_items ->> 'otherCases', '{충전환불기간}', v_days::text)),
      'minorNotice', replace(v_value ->> 'minorNotice', '{충전환불기간}', v_days::text),
      'agreeLabel', replace(v_value ->> 'agreeLabel', '{충전환불기간}', v_days::text),
      'noticeSha256', v_sha, 'refundDays', v_days,
      'plan', CASE WHEN v_plan.id IS NULL THEN NULL ELSE jsonb_build_object('price', v_plan.price, 'credits', v_plan.credits) END,
      'consentFormat', 1);
  END IF;

  IF v_plan.id IS NULL OR NOT v_plan.is_active THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_UNAVAILABLE', 'details', v_details, 'consentFormat', v_format);
  END IF;
  IF v_plan.price <> p_expected_amount OR v_plan.credits <> p_expected_credits THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_CHANGED', 'details', v_details, 'consentFormat', v_format);
  END IF;
  -- 같은 시도의 재요청: 요금제가 그대로일 때만(위 검사 뒤) 같은 기록으로 본다.
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
       AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
      RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing.consent_format);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'consentFormat', v_format);
  END IF;
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'consentFormat', v_format);
  END IF;

  SELECT s.content_sha256 INTO v_policy_sha FROM public.policy_document_snapshots s
   WHERE s.doc_key = 'refundPolicy' ORDER BY s.seq DESC LIMIT 1;

  INSERT INTO public.point_charge_checkout_acks (user_id, checkout_attempt_id, plan_id, plan_name, amount, credits, refund_days,
                                                 notice_text, notice_sha256, refund_policy_sha256,
                                                 terms_policy_sha256, consent_format, consent_details)
  VALUES (p_user_id, p_checkout_attempt_id, v_plan.id, v_plan.name, v_plan.price, v_plan.credits, v_days, v_text, v_sha, v_policy_sha,
          CASE WHEN v_format = 2 THEN v_terms_doc END, v_format,
          CASE WHEN v_format = 2 THEN jsonb_build_object('consent', v_details - 'noticeSha256' - 'plan') END)
  ON CONFLICT (user_id, checkout_attempt_id) DO NOTHING
  RETURNING id INTO v_inserted;
  IF v_inserted IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false, 'consentFormat', v_format);
  END IF;

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;
  IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
     AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing.consent_format);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'consentFormat', v_format);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_point_charge_checkout_ack(uuid, uuid, uuid, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_point_charge_checkout_ack(uuid, uuid, uuid, integer, integer, text) TO service_role;
-- [11번] 끝 -----------------------------------------------------------------------------------------------------

-- 6. VERIFY ------------------------------------------------------------------------------------------------------
DO $verify_checkout_consent_v2$
DECLARE
  v_new text[][] := ARRAY[
    ARRAY['public.record_purchase_notice_ack(uuid,uuid,text,text)', '9d2cb23a7aa16e45970525248bcc4435', '{postgres=X/postgres,service_role=X/postgres}'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', '4b23fdf6b9c7bcf76e39ee5b7b1a629f', '{postgres=X/postgres,service_role=X/postgres}'],
    ARRAY['public.build_checkout_consent_v2(text,jsonb,integer)', '3fd97051955741db213297804131c1e3', '{postgres=X/postgres}'],
    ARRAY['public.build_market_cart_texts(jsonb)', '604251e0a0b5f85b58aaeccb0c593d05', '{postgres=X/postgres}']
  ];
  v_vector jsonb := $vector${
    "consentFormat": 2, "consentTitle": "주문 내용·충전 조건 확인 및 결제 동의",
    "consentSummary": {"refundPeriod": "{충전환불기간}일째 되는 날까지 신청할 수 있어요.", "restriction": "하나라도 쓰면 취소할 수 없어요.",
                       "validity": "{충전유효기간}년 동안 쓸 수 있어요.", "minor": "미성년자는 취소할 수 있어요."},
    "checkoutItems": {"product": "상품 A", "validity": "기간 B", "refund": "환불 {충전환불기간}일\n둘째 줄", "restriction": "제한 C", "otherCases": "기타 D"},
    "minorNotice": "미성년 E",
    "consentItems": [
      {"key": "product", "label": "충전 상품 안내", "view": "text", "textKeys": ["checkoutItems.product", "checkoutItems.validity"]},
      {"key": "refund", "label": "취소·환불 안내", "view": "text", "textKeys": ["checkoutItems.refund", "checkoutItems.restriction", "checkoutItems.otherCases"]},
      {"key": "minor", "label": "미성년자 결제 취소 안내", "view": "text", "textKeys": ["minorNotice"]},
      {"key": "refundPolicy", "label": "취소·환불정책", "view": "link", "link": "refundPolicy"},
      {"key": "terms", "label": "서비스 이용약관", "view": "link", "link": "serviceTerms"}]}$vector$;
  v_links_visible boolean;
  v_result jsonb;
  v_sig text;
  i integer;
BEGIN
  IF to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: 3-argument record_purchase_notice_ack must be gone';
  END IF;
  FOR i IN 1 .. array_length(v_new, 1) LOOP
    v_sig := v_new[i][1];
    IF to_regprocedure(v_sig) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_sig))) <> v_new[i][2] THEN
      RAISE EXCEPTION 'VERIFY: % md5 (%)', v_sig, md5(pg_get_functiondef(to_regprocedure(v_sig)));
    END IF;
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v_sig)) IS DISTINCT FROM v_new[i][3] THEN
      RAISE EXCEPTION 'VERIFY: % ACL (%)', v_sig, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v_sig));
    END IF;
    IF has_function_privilege('anon', v_sig, 'EXECUTE') OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % must not be executable by API roles', v_sig;
    END IF;
  END LOOP;
  IF has_function_privilege('service_role', 'public.build_checkout_consent_v2(text,jsonb,integer)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.build_market_cart_texts(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: internal builders must not be executable by service_role';
  END IF;

  -- 칸·CHECK
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_purchase_notice_acks'
       AND column_name IN ('refund_policy_sha256', 'terms_policy_sha256', 'consent_format', 'consent_details')) < 0
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'point_charge_checkout_acks'
       AND column_name IN ('terms_policy_sha256', 'consent_format', 'consent_details')) < 0
     OR (SELECT count(*) FROM pg_constraint WHERE conname IN ('market_purchase_notice_acks_consent_format_check',
                                                              'point_charge_checkout_acks_consent_format_check')) < 0 THEN
    RAISE EXCEPTION 'VERIFY: consent columns / checks';
  END IF;

  -- 옛 코드 호출(이름 인자 3개·6인자)은 입력 검사에서 consentFormat null 키와 함께 돌아온다(기록 없음).
  v_result := public.record_purchase_notice_ack(p_user_id => NULL, p_idempotency_key => NULL, p_notice_sha256 => 'x');
  IF v_result ->> 'code' IS DISTINCT FROM 'NOTICE_INPUT_INVALID' OR NOT (v_result ? 'consentFormat') OR (v_result -> 'consentFormat') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'VERIFY: market 3 named arguments → %', v_result;
  END IF;
  v_result := public.record_point_charge_checkout_ack(NULL, NULL, NULL, NULL, NULL, 'x');
  IF v_result ->> 'code' IS DISTINCT FROM 'NOTICE_INPUT_INVALID' OR NOT (v_result ? 'consentFormat') THEN
    RAISE EXCEPTION 'VERIFY: point charge 6 arguments → %', v_result;
  END IF;

  -- 5-1 시험 벡터(링크 문서가 보일 때만 — 닫혀 있으면 NULL 이어야 함)
  SELECT bool_and(jsonb_typeof(d) = 'object' AND (d -> 'enabled') = 'true'::jsonb
                  AND jsonb_typeof(d -> 'label') = 'string' AND (d ->> 'label') ~ '[^ \t\n\r]'
                  AND jsonb_typeof(d -> 'content') = 'string' AND (d ->> 'content') ~ '[^ \t\n\r]'
                  AND EXISTS (SELECT 1 FROM public.policy_document_snapshots s WHERE s.doc_key = k))
    INTO v_links_visible
    FROM public.system_settings ss, unnest(ARRAY['refundPolicy', 'serviceTerms']) k, LATERAL (SELECT ss.value -> 'policyDocuments' -> k AS d) x
   WHERE ss.key = 'site_footer_content';
  v_result := public.build_checkout_consent_v2('point_charge', v_vector, 7);
  IF v_links_visible IS TRUE THEN
    IF v_result #>> '{details,noticeSha256}' IS DISTINCT FROM '2e53f470c92dfba92ee637f86c592f5b5545b46ef37b883eb856f30c7bc56cd7'
       OR encode(sha256(convert_to(v_result ->> 'text', 'UTF8')), 'hex') IS DISTINCT FROM '2e53f470c92dfba92ee637f86c592f5b5545b46ef37b883eb856f30c7bc56cd7' THEN
      RAISE EXCEPTION 'VERIFY: consent vector → %', left(coalesce(v_result::text, 'NULL'), 600);
    END IF;
  ELSIF v_result IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: consent builder must close when link documents are hidden';
  END IF;
  -- 장바구니 문구 지문(앞뒤 공백 그대로, trim 없음)
  v_result := public.build_market_cart_texts(jsonb_build_object('cartCheckoutNotice', ' 앞 공백 안내', 'partialOwnedConfirmLabel', '뒤 공백 확인 '));
  IF v_result ->> 'cartTextsSha256' IS DISTINCT FROM encode(sha256(convert_to(' 앞 공백 안내' || chr(10) || '뒤 공백 확인 ', 'UTF8')), 'hex')
     OR public.build_market_cart_texts(jsonb_build_object('cartCheckoutNotice', '줄' || chr(10) || '바꿈', 'partialOwnedConfirmLabel', 'x')) IS NOT NULL
     OR public.build_market_cart_texts(jsonb_build_object('cartCheckoutNotice', '{x}', 'partialOwnedConfirmLabel', 'x')) IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: cart texts builder';
  END IF;
END;
$verify_checkout_consent_v2$;

NOTIFY pgrst, 'reload schema';
$rh_r6_copy$);
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R6', 'down 뒤 다시 적용');
    v_r := pg_temp.try_sql($rh_r6_copy2$-- 출시 전 작업 순서표 11번 묶음: 결제 화면 단순화 — 동의 2판(접는 동의)(계획 docs/plan-bundle11-checkout-simplify.md 13판 5절).
-- 만드는 것:
--   1. 칸: market_purchase_notice_acks(refund_policy_sha256·terms_policy_sha256·consent_format·consent_details),
--      point_charge_checkout_acks(terms_policy_sha256·consent_format·consent_details). 칸은 down 이 지우지 않는다(증빙).
--      consent_format 은 상수 기본값 1 이라 표를 다시 쓰지 않고, 추가 전용 가드 트리거와 부딪치지 않는다.
--   2. 내부 함수(ACL postgres 만): build_market_cart_texts(장바구니 문구 검사·지문), build_checkout_consent_v2(2판 문구 검사·링크 문서 검사·원문·묶음).
--      둘 다 판(consentFormat)을 보지 않는다. TS(src/lib/checkout-consent.ts)와 같은 규칙이다.
--   3. 재정의: record_purchase_notice_ack 3인자 → 4인자(p_cart_texts_sha256 DEFAULT NULL — 옛 코드의 이름 인자 3개 호출은 기본값으로 맞음),
--      record_point_charge_checkout_ack(6인자 그대로). 판 분기, 2판 기록 칸, 장바구니 문구 대조, 모든 응답에 consentFormat 키.
-- 정책에 consentFormat 이 없으면(스크립트 A 전) 1판 그대로라 화면·기록 변화가 없다(옛 코드 호출은 cartTexts null 로 기록).
-- 함수 지문은 md5(pg_get_functiondef(oid)) — 9·10번과 같은 측정. 사전 값이 다르면 멈춘다.
-- 잠금: 두 기록 표에 ACCESS EXCLUSIVE(칸 추가 — 거래 끝까지 읽기도 막음). 새벽에 짧게 적용하고, 잡지 못하면(lock_timeout 3초) 전체가 취소된다.
-- 다시 적용: down 없이 같은 파일을 다시 실행해도 멈추지 않는다(사전 검사가 이 파일의 새 값도 받음). 이력을 다시 넣으려면 10번 머리말과 같이
--   같은 거래에서 schema_migrations 의 '20261216100000' 행을 지운 뒤 이 파일과 이력 INSERT 를 넣는다.
-- 되돌리기: supabase/rollback/20261216100000_checkout_consent_v2_down.sql(코드를 11번 전으로 되돌린 뒤에만, 10절 되돌리기 순서).
--   10번을 되돌려야 하면 이 down 을 먼저 한다(10번 _down_b 는 충전 함수가 10번 값일 때만 돈다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
-- 잠그는 순서: 자료 동의 기록 → 충전 동의 기록(교착 방지).

-- 0. 사전 점검 -------------------------------------------------------------------------------------------------
DO $precheck_checkout_consent_v2$
DECLARE
  -- 바꾸는 함수: {서명, 바탕 값(없으면 ''), 이 파일의 새 값}
  v_changed text[][] := ARRAY[
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', 'be4403fd993c45d618950a5908a91591', '4b23fdf6b9c7bcf76e39ee5b7b1a629f'],
    ARRAY['public.build_checkout_consent_v2(text,jsonb,integer)', '', '3fd97051955741db213297804131c1e3'],
    ARRAY['public.build_market_cart_texts(jsonb)', '', '604251e0a0b5f85b58aaeccb0c593d05']
  ];
  -- 그대로여야 함(계획 5-5, 2026-11-26 운영 값)
  v_same text[][] := ARRAY[
    ARRAY['public.checkout_market_selection(uuid,text,uuid,jsonb,uuid)', '0cda5ff7689d998cc6cf2fd213b0004d'],
    ARRAY['public.get_point_charge_refund_eligibility(uuid,uuid)', '60fc28afe44e7be776c189265e87b6ec'],
    ARRAY['public.point_charge_refund_days()', '7ab4d40c1634ade20de86517fa13cd40'],
    ARRAY['public.guard_point_charge_checkout_acks_mutation()', 'c7ef25308c6c0aa2920991965fb87ab0'],
    ARRAY['public.guard_market_purchase_notice_acks_mutation()', '3959ac2b8139d0f81365df59ed67ef10'],
    ARRAY['public.prepare_payment_order(uuid,uuid,text,uuid,text,text,integer,integer,text,text,text,text,text,timestamp with time zone,integer,integer,text,text)', '93e0bd5e41969f66f296f4353f3feeb9'],
    ARRAY['public.begin_payapp_request(uuid)', '679b4474c0dc42de11e5e9a14a7d1d4d'],
    ARRAY['public.payapp_fulfill_order_internal(uuid,timestamp with time zone)', '657bbb07ae4b250a2697f21e2aa805e9'],
    ARRAY['public.market_purchase_refund_days()', '5d4030e7bedbace6189cefed80c3d27b'],
    ARRAY['public.record_policy_document_snapshots()', '4ffeca80346467f928c0a6f50b69018d'],
    ARRAY['public.prevent_policy_document_snapshot_mutation()', 'b1449554c094a90be7a6c864f367fdf8'],
    ARRAY['public.member_withdrawal_facts(uuid,boolean)', 'a7674770964dac2fe5c9179b8403c3b4'],
    ARRAY['public.get_member_withdrawal_preview(uuid,boolean)', '3a2e2c2f6eb6ecb15defe0879c88e0fc'],
    ARRAY['public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)', '1346d870d3623abae580a011b0484339']
  ];
  v_old regprocedure := to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)');
  v_new regprocedure := to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text,text)');
  v_md5 text;
  i integer;
BEGIN
  -- 자료 기록 함수: 3인자(바탕 값)나 4인자(이 파일 값) 중 정확히 하나만 있어야 한다.
  IF (v_old IS NULL) = (v_new IS NULL) THEN
    RAISE EXCEPTION 'PRECHECK: record_purchase_notice_ack must exist with exactly one of 3/4 arguments';
  END IF;
  IF v_old IS NOT NULL AND md5(pg_get_functiondef(v_old)) <> 'fa6a7edd836f21422d52dd184afb079b' THEN
    RAISE EXCEPTION 'PRECHECK: record_purchase_notice_ack(uuid,uuid,text) changed (%)', md5(pg_get_functiondef(v_old));
  END IF;
  IF v_new IS NOT NULL AND md5(pg_get_functiondef(v_new)) <> '9d2cb23a7aa16e45970525248bcc4435' THEN
    RAISE EXCEPTION 'PRECHECK: record_purchase_notice_ack(uuid,uuid,text,text) changed (%)', md5(pg_get_functiondef(v_new));
  END IF;
  FOR i IN 1 .. array_length(v_changed, 1) LOOP
    IF to_regprocedure(v_changed[i][1]) IS NULL THEN
      IF v_changed[i][2] <> '' THEN
        RAISE EXCEPTION 'PRECHECK: % missing', v_changed[i][1];
      END IF;
      CONTINUE;
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(v_changed[i][1])));
    IF v_md5 IS DISTINCT FROM v_changed[i][2] AND v_md5 IS DISTINCT FROM v_changed[i][3] THEN
      RAISE EXCEPTION 'PRECHECK: % changed (%)', v_changed[i][1], v_md5;
    END IF;
  END LOOP;
  FOR i IN 1 .. array_length(v_same, 1) LOOP
    IF to_regprocedure(v_same[i][1]) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_same[i][1]))) <> v_same[i][2] THEN
      RAISE EXCEPTION 'PRECHECK: % changed (%)', v_same[i][1], md5(pg_get_functiondef(to_regprocedure(v_same[i][1])));
    END IF;
  END LOOP;
  IF to_regclass('public.policy_document_snapshots') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'site_footer_content') THEN
    RAISE EXCEPTION 'PRECHECK: policy document snapshots / site_footer_content missing';
  END IF;
END;
$precheck_checkout_consent_v2$;

-- [11번] 시작 ---------------------------------------------------------------------------------------------------
-- 1. 기록 칸(5-3) -----------------------------------------------------------------------------------------------



-- 2. 장바구니 문구 검사·지문(4-3 끝, 5-4). 어기면 NULL. 지문 = sha256(안내 LF 정가 확인), trim 없음. ----------------------
CREATE OR REPLACE FUNCTION public.build_market_cart_texts(p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_build_market_cart_texts$
DECLARE
  v_key text;
  v_text text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN
    RETURN NULL;
  END IF;
  FOREACH v_key IN ARRAY ARRAY['cartCheckoutNotice', 'partialOwnedConfirmLabel'] LOOP
    IF jsonb_typeof(p_value -> v_key) IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_text := p_value ->> v_key;
    IF v_text !~ '[^ \t\n\r]' OR char_length(v_text) > 300 OR strpos(v_text, chr(10)) > 0 OR v_text ~ '[{}]' THEN
      RETURN NULL;
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'cartCheckoutNotice', p_value ->> 'cartCheckoutNotice',
    'partialOwnedConfirmLabel', p_value ->> 'partialOwnedConfirmLabel',
    'cartTextsSha256', encode(sha256(convert_to((p_value ->> 'cartCheckoutNotice') || chr(10) || (p_value ->> 'partialOwnedConfirmLabel'), 'UTF8')), 'hex'));
END;
$fn_build_market_cart_texts$;
REVOKE ALL ON FUNCTION public.build_market_cart_texts(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- 3. 2판 검사·원문·묶음(4-3 (S)~(g), 5-1·5-2). 성공 {text, details}, 어기면 NULL. 판을 보지 않는다. --------------------
--   p_kind 'market'(자료, {자료환불기간}) | 'point_charge'(충전, {충전환불기간}·{충전유효기간}=1). p_refund_days: 자료 refundDays, 충전 point_charge_refund_days().
--   링크 문서((g))는 정규화하지 않은 바닥글 원본(site_footer_content.value.policyDocuments.<키>)과 그 문서의 사본이 있는지로 본다.
CREATE OR REPLACE FUNCTION public.build_checkout_consent_v2(p_kind text, p_value jsonb, p_refund_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $fn_build_checkout_consent_v2$
DECLARE
  c_years constant text := '1';
  v_days text;
  v_roles text[];
  v_required boolean[];
  v_role_ph text[];
  v_targets text[];
  v_required_targets text[];
  v_summary jsonb;
  v_items jsonb;
  v_item jsonb;
  v_target_json jsonb;
  v_key text;
  v_view text;
  v_link text;
  v_line text;
  v_body text;
  v_total integer := 0;
  v_one_line text[] := '{}';
  v_one_line_max integer[] := '{}';
  v_keys text[] := '{}';
  v_used_targets text[] := '{}';
  v_used_links text[] := '{}';
  v_summary_out jsonb := '[]'::jsonb;
  v_items_out jsonb := '[]'::jsonb;
  v_texts_out jsonb;
  v_lines text[];
  v_footer jsonb;
  v_doc jsonb;
  v_text text;
  v_details jsonb;
  i integer;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('market', 'point_charge') OR p_value IS NULL OR jsonb_typeof(p_value) <> 'object'
     OR p_refund_days IS NULL OR p_refund_days <= 0 THEN
    RETURN NULL;
  END IF;
  v_days := p_refund_days::text;
  IF p_kind = 'market' THEN
    v_roles := ARRAY['refundPeriod', 'restriction', 'note'];
    v_required := ARRAY[true, true, false];
    v_role_ph := ARRAY['{자료환불기간}', '', ''];
    v_targets := ARRAY['confirmNotice', 'usageScopeNotice', 'downloadPeriodNotice'];
    v_required_targets := ARRAY['confirmNotice'];
  ELSE
    v_roles := ARRAY['refundPeriod', 'restriction', 'validity', 'minor', 'note'];
    v_required := ARRAY[true, true, true, true, false];
    v_role_ph := ARRAY['{충전환불기간}', '', '{충전유효기간}', '', ''];
    v_targets := ARRAY['checkoutItems.product', 'checkoutItems.validity', 'checkoutItems.refund', 'checkoutItems.restriction',
                       'checkoutItems.otherCases', 'minorNotice'];
    v_required_targets := v_targets;
  END IF;

  -- (a) 제목(한 줄 규칙은 아래 (S1) 에서 함께)
  IF jsonb_typeof(p_value -> 'consentTitle') IS DISTINCT FROM 'string' THEN
    RETURN NULL;
  END IF;
  IF strpos(p_value ->> 'consentTitle', '[필수]') > 0 THEN
    RETURN NULL;
  END IF;
  v_one_line := v_one_line || (p_value ->> 'consentTitle');
  v_one_line_max := v_one_line_max || 26;

  -- (b) 요약 줄: 객체, 모르는 키 없음, 역할 순서, 선택 역할은 키가 없을 때만 빠짐
  v_summary := p_value -> 'consentSummary';
  IF jsonb_typeof(v_summary) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_summary) k WHERE NOT (k = ANY (v_roles))) THEN
    RETURN NULL;
  END IF;
  FOR i IN 1 .. array_length(v_roles, 1) LOOP
    IF NOT (v_summary ? v_roles[i]) THEN
      IF v_required[i] THEN
        RETURN NULL;
      END IF;
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_summary -> v_roles[i]) IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_line := v_summary ->> v_roles[i];
    IF v_role_ph[i] <> '' AND strpos(v_line, v_role_ph[i]) = 0 THEN
      RETURN NULL;
    END IF;
    v_one_line := v_one_line || v_line;
    v_one_line_max := v_one_line_max || 120;
    v_total := v_total + char_length(v_line);
    v_summary_out := v_summary_out || to_jsonb(CASE p_kind
      WHEN 'market' THEN replace(v_line, '{자료환불기간}', v_days)
      ELSE replace(replace(v_line, '{충전환불기간}', v_days), '{충전유효기간}', c_years) END);
  END LOOP;
  IF p_kind = 'market' AND v_total > 220 THEN
    RETURN NULL;
  END IF;

  -- (d)(e) 항목: 1~6개, 정확한 키 모양, key 규칙·중복 없음, textKeys 1~6개·전체 중복 없음·가리킬 수 있는 본문만, link 는 각각 한 번까지
  v_items := p_value -> 'consentItems';
  IF jsonb_typeof(v_items) IS DISTINCT FROM 'array' OR jsonb_array_length(v_items) < 1 OR jsonb_array_length(v_items) > 6 THEN
    RETURN NULL;
  END IF;
  FOR v_item IN SELECT e.value FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR jsonb_typeof(v_item -> 'view') IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_view := v_item ->> 'view';
    IF v_view NOT IN ('text', 'link')
       OR (SELECT string_agg(k COLLATE "C", ',' ORDER BY k COLLATE "C") FROM jsonb_object_keys(v_item) k)
          IS DISTINCT FROM (CASE v_view WHEN 'text' THEN 'key,label,textKeys,view' ELSE 'key,label,link,view' END) THEN
      RETURN NULL;
    END IF;
    IF jsonb_typeof(v_item -> 'key') IS DISTINCT FROM 'string' OR jsonb_typeof(v_item -> 'label') IS DISTINCT FROM 'string' THEN
      RETURN NULL;
    END IF;
    v_key := v_item ->> 'key';
    IF v_key !~ '^[a-z][A-Za-z0-9]{0,29}$' OR v_key = ANY (v_keys) THEN
      RETURN NULL;
    END IF;
    v_keys := v_keys || v_key;
    v_one_line := v_one_line || (v_item ->> 'label');
    v_one_line_max := v_one_line_max || 30;
    IF v_view = 'text' THEN
      IF jsonb_typeof(v_item -> 'textKeys') IS DISTINCT FROM 'array'
         OR jsonb_array_length(v_item -> 'textKeys') < 1 OR jsonb_array_length(v_item -> 'textKeys') > 6 THEN
        RETURN NULL;
      END IF;
      v_texts_out := '[]'::jsonb;
      FOR v_target_json IN SELECT t.value FROM jsonb_array_elements(v_item -> 'textKeys') WITH ORDINALITY AS t(value, n) ORDER BY t.n LOOP
        IF jsonb_typeof(v_target_json) IS DISTINCT FROM 'string' OR NOT ((v_target_json #>> '{}') = ANY (v_targets))
           OR (v_target_json #>> '{}') = ANY (v_used_targets) THEN
          RETURN NULL;
        END IF;
        v_used_targets := v_used_targets || (v_target_json #>> '{}');
        -- (e) 정해진 잎만 읽는다(일반 경로 풀이 금지)
        v_target_json := CASE v_target_json #>> '{}'
          WHEN 'confirmNotice' THEN p_value -> 'confirmNotice'
          WHEN 'usageScopeNotice' THEN p_value -> 'usageScopeNotice'
          WHEN 'downloadPeriodNotice' THEN p_value -> 'downloadPeriodNotice'
          WHEN 'checkoutItems.product' THEN p_value -> 'checkoutItems' -> 'product'
          WHEN 'checkoutItems.validity' THEN p_value -> 'checkoutItems' -> 'validity'
          WHEN 'checkoutItems.refund' THEN p_value -> 'checkoutItems' -> 'refund'
          WHEN 'checkoutItems.restriction' THEN p_value -> 'checkoutItems' -> 'restriction'
          WHEN 'checkoutItems.otherCases' THEN p_value -> 'checkoutItems' -> 'otherCases'
          WHEN 'minorNotice' THEN p_value -> 'minorNotice'
        END;
        -- (S) 본문: 글자, 비지 않음, 채운 뒤 중괄호 없음(LF 는 허용)
        IF jsonb_typeof(v_target_json) IS DISTINCT FROM 'string' THEN
          RETURN NULL;
        END IF;
        v_body := v_target_json #>> '{}';
        IF v_body !~ '[^ \t\n\r]' THEN
          RETURN NULL;
        END IF;
        IF (CASE p_kind WHEN 'market' THEN replace(v_body, '{자료환불기간}', '')
            ELSE replace(replace(v_body, '{충전환불기간}', ''), '{충전유효기간}', '') END) ~ '[{}]' THEN
          RETURN NULL;
        END IF;
        v_texts_out := v_texts_out || to_jsonb(CASE p_kind
          WHEN 'market' THEN replace(v_body, '{자료환불기간}', v_days)
          ELSE replace(replace(v_body, '{충전환불기간}', v_days), '{충전유효기간}', c_years) END);
      END LOOP;
      v_items_out := v_items_out || jsonb_build_array(jsonb_build_object(
        'key', v_key,
        'label', CASE p_kind WHEN 'market' THEN replace(v_item ->> 'label', '{자료환불기간}', v_days)
                 ELSE replace(replace(v_item ->> 'label', '{충전환불기간}', v_days), '{충전유효기간}', c_years) END,
        'view', 'text',
        'texts', v_texts_out));
    ELSE
      IF jsonb_typeof(v_item -> 'link') IS DISTINCT FROM 'string' THEN
        RETURN NULL;
      END IF;
      v_link := v_item ->> 'link';
      IF v_link NOT IN ('refundPolicy', 'serviceTerms') OR v_link = ANY (v_used_links) THEN
        RETURN NULL;
      END IF;
      v_used_links := v_used_links || v_link;
      v_items_out := v_items_out || jsonb_build_array(jsonb_build_object(
        'key', v_key,
        'label', CASE p_kind WHEN 'market' THEN replace(v_item ->> 'label', '{자료환불기간}', v_days)
                 ELSE replace(replace(v_item ->> 'label', '{충전환불기간}', v_days), '{충전유효기간}', c_years) END,
        'view', 'link',
        'link', v_link));
    END IF;
  END LOOP;

  -- (f) 포함: 필수 본문과 두 링크
  IF NOT (v_required_targets <@ v_used_targets) OR NOT (ARRAY['refundPolicy', 'serviceTerms'] <@ v_used_links) THEN
    RETURN NULL;
  END IF;

  -- (S)(S1)(c) 한 줄 칸(제목·요약 줄·항목 이름): 1~최대 글자(채우기 전 코드포인트), 비지 않음, LF 없음, 채운 뒤 중괄호 없음, 숫자·기간 낱말 없음
  FOR i IN 1 .. array_length(v_one_line, 1) LOOP
    v_line := v_one_line[i];
    IF char_length(v_line) < 1 OR char_length(v_line) > v_one_line_max[i]
       OR v_line !~ '[^ \t\n\r]'
       OR strpos(v_line, chr(10)) > 0
       OR (CASE p_kind WHEN 'market' THEN replace(v_line, '{자료환불기간}', '')
           ELSE replace(replace(v_line, '{충전환불기간}', ''), '{충전유효기간}', '') END) ~ '[{}]'
       OR v_line ~ '[0-9０-９]'
       OR v_line ~ '([일이삼사오육칠팔구십백]+|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|서른)[ \t\n]*(일째|일|년|개월|달|주일|주|시간)'
       OR v_line ~ '(하루|이틀|사흘|나흘|열흘|보름|한 해)' THEN
      RETURN NULL;
    END IF;
  END LOOP;

  -- (g) 링크 문서가 보여야 함: 원본 객체, enabled 정확히 true, label·content 비지 않은 글자, 사본 하나 이상
  SELECT s.value INTO v_footer FROM public.system_settings s WHERE s.key = 'site_footer_content';
  FOREACH v_link IN ARRAY ARRAY['refundPolicy', 'serviceTerms'] LOOP
    v_doc := v_footer -> 'policyDocuments' -> v_link;
    IF jsonb_typeof(v_doc) IS DISTINCT FROM 'object'
       OR (v_doc -> 'enabled') IS DISTINCT FROM 'true'::jsonb
       OR jsonb_typeof(v_doc -> 'label') IS DISTINCT FROM 'string' OR (v_doc ->> 'label') !~ '[^ \t\n\r]'
       OR jsonb_typeof(v_doc -> 'content') IS DISTINCT FROM 'string' OR (v_doc ->> 'content') !~ '[^ \t\n\r]'
       OR NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots d WHERE d.doc_key = v_link) THEN
      RETURN NULL;
    END IF;
  END LOOP;

  -- 원문(5-1): 제목, 요약 줄, 항목마다 이름 + (본문들 | '링크:' + 키), LF 로 잇는다(끝 LF 없음, trim·정규화 없음)
  v_lines := ARRAY[CASE p_kind WHEN 'market' THEN replace(p_value ->> 'consentTitle', '{자료환불기간}', v_days)
                   ELSE replace(replace(p_value ->> 'consentTitle', '{충전환불기간}', v_days), '{충전유효기간}', c_years) END];
  v_lines := v_lines || ARRAY(SELECT e.value #>> '{}' FROM jsonb_array_elements(v_summary_out) WITH ORDINALITY AS e(value, n) ORDER BY e.n);
  FOR v_item IN SELECT e.value FROM jsonb_array_elements(v_items_out) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    v_lines := v_lines || (v_item ->> 'label');
    IF v_item ->> 'view' = 'text' THEN
      v_lines := v_lines || ARRAY(SELECT t.value #>> '{}' FROM jsonb_array_elements(v_item -> 'texts') WITH ORDINALITY AS t(value, n) ORDER BY t.n);
    ELSE
      v_lines := v_lines || ('링크:' || (v_item ->> 'link'));
    END IF;
  END LOOP;
  v_text := array_to_string(v_lines, chr(10));
  v_details := jsonb_build_object(
    'consentFormat', 2,
    'consentTitle', v_lines[1],
    'consentSummary', v_summary_out,
    'consentItems', v_items_out,
    'noticeSha256', encode(sha256(convert_to(v_text, 'UTF8')), 'hex'),
    'refundDays', p_refund_days);
  RETURN jsonb_build_object('text', v_text, 'details', v_details);
END;
$fn_build_checkout_consent_v2$;
REVOKE ALL ON FUNCTION public.build_checkout_consent_v2(text, jsonb, integer) FROM PUBLIC, anon, authenticated, service_role;

-- 4. 자료 구매 고지 동의 기록(3인자 → 4인자). 같은 거래에서 옛 서명을 지우고 만든다(다시 실행해도 멈추지 않음). ------------------
DROP FUNCTION IF EXISTS public.record_purchase_notice_ack(uuid, uuid, text);
CREATE OR REPLACE FUNCTION public.record_purchase_notice_ack(p_user_id uuid, p_idempotency_key uuid, p_notice_sha256 text, p_cart_texts_sha256 text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing_sha text;
  v_value jsonb;
  v_days_numeric numeric;
  v_days integer;
  v_label text;
  v_notice text;
  v_text text;
  v_sha text;
  v_inserted_id uuid;
  v_details jsonb;
  -- [11번] 시작
  v_existing_format smallint;
  v_existing_cart text;
  v_format smallint;
  v_built jsonb;
  v_cart jsonb;
  v_refund_doc text;
  v_terms_doc text;
  -- [11번] 끝
BEGIN
  -- ① 입력 검사
  IF p_user_id IS NULL OR p_idempotency_key IS NULL OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$'
     -- [11번] 시작
     OR (p_cart_texts_sha256 IS NOT NULL AND p_cart_texts_sha256 !~ '^[0-9a-f]{64}$') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID', 'consentFormat', NULL);
    -- [11번] 끝
  END IF;

  -- ② 같은 키로 이미 기록했고 지문이 같으면 그대로 통과(402 뒤 다시 누르기, 503 뒤 재시도)
  -- [11번] 장바구니 문구 지문도 같아야 한다(NULL 끼리도 같음 — 옛 코드의 재시도가 replay 로 끝나게)
  SELECT a.notice_sha256, a.consent_format, a.consent_details -> 'cartTexts' ->> 'cartTextsSha256'
    INTO v_existing_sha, v_existing_format, v_existing_cart
    FROM public.market_purchase_notice_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  IF FOUND AND v_existing_sha = p_notice_sha256 AND v_existing_cart IS NOT DISTINCT FROM p_cart_texts_sha256 THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing_format);
  END IF;

  -- ③ 지금 정책: 판(consentFormat), refundDays 는 숫자·정수·양수
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'market_purchase_policy';
  -- [11번] 시작: 판 — 없거나 숫자 1 → 1, 숫자 2 → 2, 그 밖 → 닫힘(consentFormat null)
  v_format := CASE
    WHEN v_value IS NULL OR jsonb_typeof(v_value) <> 'object' THEN NULL
    WHEN NOT (v_value ? 'consentFormat') THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 1 THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 2 THEN 2
  END;
  IF v_format IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', NULL);
  END IF;
  -- [11번] 끝
  IF jsonb_typeof(v_value -> 'refundDays') IS DISTINCT FROM 'number' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', v_format);
  END IF;
  v_days_numeric := (v_value ->> 'refundDays')::numeric;
  IF v_days_numeric <> trunc(v_days_numeric) OR v_days_numeric <= 0 OR v_days_numeric > 3650 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', v_format);
  END IF;
  v_days := v_days_numeric::integer;
  -- [11번] 시작: 장바구니 문구(판과 관계없음)
  v_cart := public.build_market_cart_texts(v_value);
  IF v_format = 2 THEN
    -- 2판: 묶음(문구·링크 문서 검사 포함)과 두 문서 지문. 사본이 없으면 NULL 로 두지 않고 닫는다.
    v_built := public.build_checkout_consent_v2('market', v_value, v_days);
    SELECT d.content_sha256 INTO v_refund_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'refundPolicy' ORDER BY d.seq DESC LIMIT 1;
    SELECT d.content_sha256 INTO v_terms_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'serviceTerms' ORDER BY d.seq DESC LIMIT 1;
    IF v_built IS NULL OR v_refund_doc IS NULL OR v_terms_doc IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_text := v_built ->> 'text';
    v_details := v_built -> 'details';
    v_sha := v_details ->> 'noticeSha256';
  ELSE
  -- [11번] 끝
    -- 1판: 두 문구는 비어 있지 않은 글자(지금 규칙 그대로)
    IF jsonb_typeof(v_value -> 'checkboxLabel') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_value -> 'confirmNotice') IS DISTINCT FROM 'string' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_label := replace(v_value ->> 'checkboxLabel', '{자료환불기간}', v_days::text);
    v_notice := replace(v_value ->> 'confirmNotice', '{자료환불기간}', v_days::text);
    IF btrim(v_label) = '' OR btrim(v_notice) = '' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_text := v_label || chr(10) || v_notice;
    v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
    v_details := jsonb_build_object('checkboxLabel', v_label, 'confirmNotice', v_notice, 'noticeSha256', v_sha, 'refundDays', v_days,
                                    'consentFormat', 1);
  END IF;

  -- ④ 같은 키를 다른 화면(지문)으로 다시 쓰면 거절 — 화면은 새 키를 만든다
  IF v_existing_sha IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;

  -- ⑤ 화면에 보인 문구가 지금 문구와 다르면 거절
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;
  -- [11번] 시작: 화면에 보인 장바구니 문구가 지금 문구와 다르거나 지금 문구가 규칙 위반이면 기록하지 않고 거절(인자 NULL = 옛 코드는 지금처럼 기록)
  IF p_cart_texts_sha256 IS NOT NULL AND (v_cart IS NULL OR (v_cart ->> 'cartTextsSha256') <> p_cart_texts_sha256) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
  END IF;
  -- [11번] 끝

  -- ⑥ 기록
  INSERT INTO public.market_purchase_notice_acks (user_id, idempotency_key, notice_sha256, notice_text, refund_days,
                                                  consent_format, refund_policy_sha256, terms_policy_sha256, consent_details)
  VALUES (p_user_id, p_idempotency_key, v_sha, v_text, v_days,
          v_format, CASE WHEN v_format = 2 THEN v_refund_doc END, CASE WHEN v_format = 2 THEN v_terms_doc END,
          CASE WHEN v_format = 2
               THEN jsonb_build_object('cartTexts', CASE WHEN p_cart_texts_sha256 IS NULL THEN NULL ELSE v_cart END,
                                       'consent', v_details - 'noticeSha256' - 'plan')
               ELSE jsonb_build_object('cartTexts', CASE WHEN p_cart_texts_sha256 IS NULL THEN NULL ELSE v_cart END) END)
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted_id;
  IF v_inserted_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false, 'consentFormat', v_format);
  END IF;

  SELECT a.notice_sha256, a.consent_format, a.consent_details -> 'cartTexts' ->> 'cartTextsSha256'
    INTO v_existing_sha, v_existing_format, v_existing_cart
    FROM public.market_purchase_notice_acks a
   WHERE a.user_id = p_user_id AND a.idempotency_key = p_idempotency_key;
  IF v_existing_sha = p_notice_sha256 AND v_existing_cart IS NOT DISTINCT FROM p_cart_texts_sha256 THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing_format);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'cartTexts', v_cart, 'consentFormat', v_format);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_purchase_notice_ack(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_purchase_notice_ack(uuid, uuid, text, text) TO service_role;

-- 5. 충전 결제 전 확인 동의 기록(6인자 그대로). 탈퇴 거절은 맨 앞 그대로. ----------------------------------------------
CREATE OR REPLACE FUNCTION public.record_point_charge_checkout_ack(p_user_id uuid, p_checkout_attempt_id uuid, p_plan_id uuid, p_expected_amount integer, p_expected_credits integer, p_notice_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing public.point_charge_checkout_acks%ROWTYPE;
  v_value jsonb;
  v_items jsonb;
  v_days integer;
  v_parts text[];
  v_part text;
  v_key text;
  v_text text;
  v_sha text;
  v_plan public.pricing_plans%ROWTYPE;
  v_details jsonb;
  v_policy_sha text;
  v_inserted uuid;
  -- [11번] 시작
  v_format smallint;
  v_built jsonb;
  v_terms_doc text;
  -- [11번] 끝
BEGIN
  IF p_user_id IS NULL OR p_checkout_attempt_id IS NULL OR p_plan_id IS NULL OR p_expected_amount IS NULL OR p_expected_credits IS NULL
     OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_INPUT_INVALID', 'consentFormat', NULL);
  END IF;
  -- [10번] 시작
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.withdrawn_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MEMBER_WITHDRAWN', 'consentFormat', NULL);
  END IF;
  -- [10번] 끝

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;

  -- 지금 정책(필수 키·자리표시 규칙 — TS 저장 검사와 같음)
  v_days := public.point_charge_refund_days();
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'point_charge_policy';
  -- [11번] 시작: 판 — 없거나 숫자 1 → 1, 숫자 2 → 2, 그 밖 → 닫힘(consentFormat null)
  v_format := CASE
    WHEN v_value IS NULL OR jsonb_typeof(v_value) <> 'object' THEN NULL
    WHEN NOT (v_value ? 'consentFormat') THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 1 THEN 1
    WHEN jsonb_typeof(v_value -> 'consentFormat') = 'number' AND (v_value ->> 'consentFormat')::numeric = 2 THEN 2
  END;
  IF v_format IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', NULL);
  END IF;
  SELECT * INTO v_plan FROM public.pricing_plans p WHERE p.id = p_plan_id;
  IF v_format = 2 THEN
    -- 2판: 묶음(문구·링크 문서 검사 포함)과 이용약관 문서 지문. 사본이 없으면 NULL 로 두지 않고 닫는다.
    IF v_days IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_built := public.build_checkout_consent_v2('point_charge', v_value, v_days);
    SELECT d.content_sha256 INTO v_terms_doc FROM public.policy_document_snapshots d
     WHERE d.doc_key = 'serviceTerms' ORDER BY d.seq DESC LIMIT 1;
    IF v_built IS NULL OR v_terms_doc IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.policy_document_snapshots d WHERE d.doc_key = 'refundPolicy') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 2);
    END IF;
    v_text := v_built ->> 'text';
    v_sha := v_built #>> '{details,noticeSha256}';
    v_details := (v_built -> 'details') || jsonb_build_object(
      'plan', CASE WHEN v_plan.id IS NULL THEN NULL ELSE jsonb_build_object('price', v_plan.price, 'credits', v_plan.credits) END);
  ELSE
  -- [11번] 끝
    v_items := v_value -> 'checkoutItems';
    IF v_days IS NULL OR jsonb_typeof(v_items) IS DISTINCT FROM 'object' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_parts := ARRAY[v_value ->> 'checkoutTitle', v_items ->> 'product', v_items ->> 'validity', v_items ->> 'refund',
                     v_items ->> 'restriction', v_items ->> 'otherCases', v_value ->> 'minorNotice', v_value ->> 'agreeLabel'];
    FOREACH v_part IN ARRAY v_parts LOOP
      IF v_part IS NULL OR v_part !~ '\S' OR replace(v_part, '{충전환불기간}', '') ~ '[{}]' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
      END IF;
    END LOOP;
    IF strpos(v_items ->> 'refund', '{충전환불기간}') = 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_POLICY_UNAVAILABLE', 'consentFormat', 1);
    END IF;
    v_text := array_to_string(ARRAY(SELECT replace(x, '{충전환불기간}', v_days::text) FROM unnest(v_parts) WITH ORDINALITY AS t(x, n) ORDER BY n), chr(10));
    v_sha := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');

    v_details := jsonb_build_object(
      'checkoutTitle', replace(v_value ->> 'checkoutTitle', '{충전환불기간}', v_days::text),
      'checkoutItems', jsonb_build_object(
        'product', replace(v_items ->> 'product', '{충전환불기간}', v_days::text),
        'validity', replace(v_items ->> 'validity', '{충전환불기간}', v_days::text),
        'refund', replace(v_items ->> 'refund', '{충전환불기간}', v_days::text),
        'restriction', replace(v_items ->> 'restriction', '{충전환불기간}', v_days::text),
        'otherCases', replace(v_items ->> 'otherCases', '{충전환불기간}', v_days::text)),
      'minorNotice', replace(v_value ->> 'minorNotice', '{충전환불기간}', v_days::text),
      'agreeLabel', replace(v_value ->> 'agreeLabel', '{충전환불기간}', v_days::text),
      'noticeSha256', v_sha, 'refundDays', v_days,
      'plan', CASE WHEN v_plan.id IS NULL THEN NULL ELSE jsonb_build_object('price', v_plan.price, 'credits', v_plan.credits) END,
      'consentFormat', 1);
  END IF;

  IF v_plan.id IS NULL OR NOT v_plan.is_active THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_UNAVAILABLE', 'details', v_details, 'consentFormat', v_format);
  END IF;
  IF v_plan.price <> p_expected_amount OR v_plan.credits <> p_expected_credits THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PLAN_CHANGED', 'details', v_details, 'consentFormat', v_format);
  END IF;
  -- 같은 시도의 재요청: 요금제가 그대로일 때만(위 검사 뒤) 같은 기록으로 본다.
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
       AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
      RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing.consent_format);
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'consentFormat', v_format);
  END IF;
  IF v_sha <> p_notice_sha256 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_CHANGED', 'details', v_details, 'consentFormat', v_format);
  END IF;

  SELECT s.content_sha256 INTO v_policy_sha FROM public.policy_document_snapshots s
   WHERE s.doc_key = 'refundPolicy' ORDER BY s.seq DESC LIMIT 1;

  INSERT INTO public.point_charge_checkout_acks (user_id, checkout_attempt_id, plan_id, plan_name, amount, credits, refund_days,
                                                 notice_text, notice_sha256, refund_policy_sha256,
                                                 terms_policy_sha256, consent_format, consent_details)
  VALUES (p_user_id, p_checkout_attempt_id, v_plan.id, v_plan.name, v_plan.price, v_plan.credits, v_days, v_text, v_sha, v_policy_sha,
          CASE WHEN v_format = 2 THEN v_terms_doc END, v_format,
          CASE WHEN v_format = 2 THEN jsonb_build_object('consent', v_details - 'noticeSha256' - 'plan') END)
  ON CONFLICT (user_id, checkout_attempt_id) DO NOTHING
  RETURNING id INTO v_inserted;
  IF v_inserted IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false, 'consentFormat', v_format);
  END IF;

  SELECT * INTO v_existing FROM public.point_charge_checkout_acks a
   WHERE a.user_id = p_user_id AND a.checkout_attempt_id = p_checkout_attempt_id;
  IF v_existing.notice_sha256 = p_notice_sha256 AND v_existing.plan_id = p_plan_id
     AND v_existing.amount = p_expected_amount AND v_existing.credits = p_expected_credits THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing.consent_format);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'NOTICE_KEY_CONFLICT', 'details', v_details, 'consentFormat', v_format);
END;
$function$;
REVOKE ALL ON FUNCTION public.record_point_charge_checkout_ack(uuid, uuid, uuid, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_point_charge_checkout_ack(uuid, uuid, uuid, integer, integer, text) TO service_role;
-- [11번] 끝 -----------------------------------------------------------------------------------------------------

-- 6. VERIFY ------------------------------------------------------------------------------------------------------
DO $verify_checkout_consent_v2$
DECLARE
  v_new text[][] := ARRAY[
    ARRAY['public.record_purchase_notice_ack(uuid,uuid,text,text)', '9d2cb23a7aa16e45970525248bcc4435', '{postgres=X/postgres,service_role=X/postgres}'],
    ARRAY['public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', '4b23fdf6b9c7bcf76e39ee5b7b1a629f', '{postgres=X/postgres,service_role=X/postgres}'],
    ARRAY['public.build_checkout_consent_v2(text,jsonb,integer)', '3fd97051955741db213297804131c1e3', '{postgres=X/postgres}'],
    ARRAY['public.build_market_cart_texts(jsonb)', '604251e0a0b5f85b58aaeccb0c593d05', '{postgres=X/postgres}']
  ];
  v_vector jsonb := $vector${
    "consentFormat": 2, "consentTitle": "주문 내용·충전 조건 확인 및 결제 동의",
    "consentSummary": {"refundPeriod": "{충전환불기간}일째 되는 날까지 신청할 수 있어요.", "restriction": "하나라도 쓰면 취소할 수 없어요.",
                       "validity": "{충전유효기간}년 동안 쓸 수 있어요.", "minor": "미성년자는 취소할 수 있어요."},
    "checkoutItems": {"product": "상품 A", "validity": "기간 B", "refund": "환불 {충전환불기간}일\n둘째 줄", "restriction": "제한 C", "otherCases": "기타 D"},
    "minorNotice": "미성년 E",
    "consentItems": [
      {"key": "product", "label": "충전 상품 안내", "view": "text", "textKeys": ["checkoutItems.product", "checkoutItems.validity"]},
      {"key": "refund", "label": "취소·환불 안내", "view": "text", "textKeys": ["checkoutItems.refund", "checkoutItems.restriction", "checkoutItems.otherCases"]},
      {"key": "minor", "label": "미성년자 결제 취소 안내", "view": "text", "textKeys": ["minorNotice"]},
      {"key": "refundPolicy", "label": "취소·환불정책", "view": "link", "link": "refundPolicy"},
      {"key": "terms", "label": "서비스 이용약관", "view": "link", "link": "serviceTerms"}]}$vector$;
  v_links_visible boolean;
  v_result jsonb;
  v_sig text;
  i integer;
BEGIN
  IF to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: 3-argument record_purchase_notice_ack must be gone';
  END IF;
  FOR i IN 1 .. array_length(v_new, 1) LOOP
    v_sig := v_new[i][1];
    IF to_regprocedure(v_sig) IS NULL OR md5(pg_get_functiondef(to_regprocedure(v_sig))) <> v_new[i][2] THEN
      RAISE EXCEPTION 'VERIFY: % md5 (%)', v_sig, md5(pg_get_functiondef(to_regprocedure(v_sig)));
    END IF;
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v_sig)) IS DISTINCT FROM v_new[i][3] THEN
      RAISE EXCEPTION 'VERIFY: % ACL (%)', v_sig, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v_sig));
    END IF;
    IF has_function_privilege('anon', v_sig, 'EXECUTE') OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY: % must not be executable by API roles', v_sig;
    END IF;
  END LOOP;
  IF has_function_privilege('service_role', 'public.build_checkout_consent_v2(text,jsonb,integer)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.build_market_cart_texts(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: internal builders must not be executable by service_role';
  END IF;

  -- 칸·CHECK
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_purchase_notice_acks'
       AND column_name IN ('refund_policy_sha256', 'terms_policy_sha256', 'consent_format', 'consent_details')) < 0
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'point_charge_checkout_acks'
       AND column_name IN ('terms_policy_sha256', 'consent_format', 'consent_details')) < 0
     OR (SELECT count(*) FROM pg_constraint WHERE conname IN ('market_purchase_notice_acks_consent_format_check',
                                                              'point_charge_checkout_acks_consent_format_check')) < 0 THEN
    RAISE EXCEPTION 'VERIFY: consent columns / checks';
  END IF;

  -- 옛 코드 호출(이름 인자 3개·6인자)은 입력 검사에서 consentFormat null 키와 함께 돌아온다(기록 없음).
  v_result := public.record_purchase_notice_ack(p_user_id => NULL, p_idempotency_key => NULL, p_notice_sha256 => 'x');
  IF v_result ->> 'code' IS DISTINCT FROM 'NOTICE_INPUT_INVALID' OR NOT (v_result ? 'consentFormat') OR (v_result -> 'consentFormat') <> 'null'::jsonb THEN
    RAISE EXCEPTION 'VERIFY: market 3 named arguments → %', v_result;
  END IF;
  v_result := public.record_point_charge_checkout_ack(NULL, NULL, NULL, NULL, NULL, 'x');
  IF v_result ->> 'code' IS DISTINCT FROM 'NOTICE_INPUT_INVALID' OR NOT (v_result ? 'consentFormat') THEN
    RAISE EXCEPTION 'VERIFY: point charge 6 arguments → %', v_result;
  END IF;

  -- 5-1 시험 벡터(링크 문서가 보일 때만 — 닫혀 있으면 NULL 이어야 함)
  SELECT bool_and(jsonb_typeof(d) = 'object' AND (d -> 'enabled') = 'true'::jsonb
                  AND jsonb_typeof(d -> 'label') = 'string' AND (d ->> 'label') ~ '[^ \t\n\r]'
                  AND jsonb_typeof(d -> 'content') = 'string' AND (d ->> 'content') ~ '[^ \t\n\r]'
                  AND EXISTS (SELECT 1 FROM public.policy_document_snapshots s WHERE s.doc_key = k))
    INTO v_links_visible
    FROM public.system_settings ss, unnest(ARRAY['refundPolicy', 'serviceTerms']) k, LATERAL (SELECT ss.value -> 'policyDocuments' -> k AS d) x
   WHERE ss.key = 'site_footer_content';
  v_result := public.build_checkout_consent_v2('point_charge', v_vector, 7);
  IF v_links_visible IS TRUE THEN
    IF v_result #>> '{details,noticeSha256}' IS DISTINCT FROM '2e53f470c92dfba92ee637f86c592f5b5545b46ef37b883eb856f30c7bc56cd7'
       OR encode(sha256(convert_to(v_result ->> 'text', 'UTF8')), 'hex') IS DISTINCT FROM '2e53f470c92dfba92ee637f86c592f5b5545b46ef37b883eb856f30c7bc56cd7' THEN
      RAISE EXCEPTION 'VERIFY: consent vector → %', left(coalesce(v_result::text, 'NULL'), 600);
    END IF;
  ELSIF v_result IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: consent builder must close when link documents are hidden';
  END IF;
  -- 장바구니 문구 지문(앞뒤 공백 그대로, trim 없음)
  v_result := public.build_market_cart_texts(jsonb_build_object('cartCheckoutNotice', ' 앞 공백 안내', 'partialOwnedConfirmLabel', '뒤 공백 확인 '));
  IF v_result ->> 'cartTextsSha256' IS DISTINCT FROM encode(sha256(convert_to(' 앞 공백 안내' || chr(10) || '뒤 공백 확인 ', 'UTF8')), 'hex')
     OR public.build_market_cart_texts(jsonb_build_object('cartCheckoutNotice', '줄' || chr(10) || '바꿈', 'partialOwnedConfirmLabel', 'x')) IS NOT NULL
     OR public.build_market_cart_texts(jsonb_build_object('cartCheckoutNotice', '{x}', 'partialOwnedConfirmLabel', 'x')) IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: cart texts builder';
  END IF;
END;
$verify_checkout_consent_v2$;

NOTIFY pgrst, 'reload schema';
$rh_r6_copy2$);
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R6', 'down 없이 같은 파일 다시 실행');
    v_log := v_log || pg_temp.ensure(pg_temp.md5_of('public.record_purchase_notice_ack(uuid,uuid,text,text)') = '9d2cb23a7aa16e45970525248bcc4435'
      AND to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)') IS NULL, 'R6', '다시 적용 뒤 4인자만·11번 md5');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R6', m FROM unnest(v_log) m;
END
$rh_r6$;

DO $rh_r6_format2_down$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_user uuid := pg_temp.rh_user();
  v_plan public.pricing_plans := pg_temp.rh_plan();
  v_m jsonb;
  v_p jsonb;
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('keys')), 'OK', 'R6', '스크립트 A');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format2')), 'OK', 'R6', '스크립트 B(판 2)');
    v_p := public.build_checkout_consent_v2('point_charge', pg_temp.policy('point_charge_policy'), public.point_charge_refund_days());
    v_m := public.build_checkout_consent_v2('market', pg_temp.policy('market_purchase_policy'), (pg_temp.policy('market_purchase_policy') ->> 'refundDays')::integer);
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'R6', '판 2 인 채 down');
    v_j := public.record_purchase_notice_ack(v_user, gen_random_uuid(), v_m #>> '{details,noticeSha256}');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_CHANGED' AND v_j -> 'details' = (pg_temp.ctx('old_market_changed')::jsonb) -> 'details',
      'R6', 'down·판 2: 옛 자료 함수는 2판 지문을 1판 details 로 거절');
    v_j := public.record_point_charge_checkout_ack(v_user, gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, v_p #>> '{details,noticeSha256}');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_CHANGED' AND NOT (v_j -> 'details' ? 'consentFormat')
      AND v_j #>> '{details,noticeSha256}' = pg_temp.ctx('point_v1_sha'), 'R6', 'down·판 2: 옛 충전 함수는 2판 지문을 1판 details 로 거절');
    v_log := v_log || 'down·판 2 의 옛 함수 1판 기록(실제 표 INSERT)은 b_full 에서 본다'::text;
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R6', m FROM unnest(v_log) m;
END
$rh_r6_format2_down$;

DO $rh_r8_down_b$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
BEGIN
  BEGIN

    v_r := pg_temp.try_sql(pg_temp.ctx('src_down_b_precheck'));
    v_log := v_log || pg_temp.expect(v_r, 'ERR DOWN_B_BLOCKED: public.record_point_charge_checkout_ack', 'R8', '11번 적용 상태에서 10번 down_b 사전 검사 멈춤');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R8', m FROM unnest(v_log) m;
END
$rh_r8_down_b$;

SELECT n, test, msg, payload FROM _rh_log ORDER BY n;
ROLLBACK;
