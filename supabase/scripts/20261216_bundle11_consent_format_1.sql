-- 11번 묶음 되돌림 스크립트: 결제 동의를 펼친 고지(1판)로 되돌린다(두 정책 consentFormat 2 → 1, 2판 키는 남김).
-- 근거: 계획 docs/plan-bundle11-checkout-simplify.md 5-6·10절 되돌리기 1단계. 마이그레이션이 아니다.
-- 2판이 닫힌 때(링크 문서 꺼짐·키 깨짐)가 가장 필요한 때라 build_checkout_consent_v2 결과를 보지 않는다.
-- 실행 방식: c_mode = 'apply', c_market_policy_md5·c_point_policy_md5 = 실행 직전에 읽은 정책 값 md5. 실행 전부터 끝까지 관리자 문구 저장 금지.
-- 사전 검사: 네 함수 md5(11번 down 상태에서는 여기서 멈춘다 — 다시 적용 전에는 돌릴 수 없다), 두 정책 판 2, 정책 값 md5.
-- 하는 일: 판 1, version +1. 장바구니·충전은 캐시가 없어 다음 읽기부터 1판, 열린 화면은 결제 때 409 로 1판을 받는다.
-- 작업 기록: checkout_consent_format_change(before·after 전체, bundle 'bundle11_consent_format_1').
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $bundle11_consent_format_1$
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
$bundle11_consent_format_1$;

COMMIT;

-- 확인 조회(읽기만): 판·편집 번호·정책 값 md5 와 이 스크립트의 마지막 기록
SELECT s.key, s.value -> 'consentFormat' AS consent_format, s.value -> 'version' AS version, md5(s.value::text) AS value_md5,
       (SELECT a.created_at FROM public.admin_audit_log a WHERE a.target_id = s.key AND a.details ->> 'bundle' = 'bundle11_consent_format_1'
         ORDER BY (a.details ->> 'saved_at')::timestamptz DESC LIMIT 1) AS last_script_audit
  FROM public.system_settings s WHERE s.key IN ('market_purchase_policy', 'point_charge_policy') ORDER BY s.key;
