-- 11번 묶음 스크립트 B: 결제 동의를 접는 동의(2판)로 바꾼다(두 정책 consentFormat 1 → 2).
-- 근거: 계획 docs/plan-bundle11-checkout-simplify.md 5-6·10절 6~7단계. 마이그레이션이 아니다.
-- 언제: 10절 단계 6(운영 값으로 서버 계산 = DB 계산 대조)을 마친 뒤에만, 새벽. 단계 6 부터 이 스크립트 끝까지 관리자 문구 저장 금지.
-- 실행 방식: c_mode = 'apply', c_market_policy_md5·c_point_policy_md5 = 단계 6 에서 대조한 정책 값 md5(다르면 멈추고 단계 6 을 다시 한다).
-- 사전 검사: 네 함수 md5, 두 정책 판 1, build_checkout_consent_v2 두 정책 모두 NULL 아님, 정책 값 md5.
-- 하는 일: 판 2, version +1. 열려 있던 실회원 화면은 결제 때 409 로 새 판을 받아 한 번 다시 동의한다.
-- 작업 기록: checkout_consent_format_change(before·after 전체, bundle 'bundle11_consent_format_2').
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $bundle11_consent_format_2$
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
$bundle11_consent_format_2$;

COMMIT;

-- 확인 조회(읽기만): 판·편집 번호·정책 값 md5 와 이 스크립트의 마지막 기록
SELECT s.key, s.value -> 'consentFormat' AS consent_format, s.value -> 'version' AS version, md5(s.value::text) AS value_md5,
       (SELECT a.created_at FROM public.admin_audit_log a WHERE a.target_id = s.key AND a.details ->> 'bundle' = 'bundle11_consent_format_2'
         ORDER BY (a.details ->> 'saved_at')::timestamptz DESC LIMIT 1) AS last_script_audit
  FROM public.system_settings s WHERE s.key IN ('market_purchase_policy', 'point_charge_policy') ORDER BY s.key;
