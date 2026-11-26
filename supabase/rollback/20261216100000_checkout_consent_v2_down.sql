-- 11번 묶음 되돌리기(supabase/migrations/20261216100000_checkout_consent_v2.sql 의 down). 계획 docs/plan-bundle11-checkout-simplify.md 5-5·10절.
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
         OR (table_name = 'point_charge_checkout_acks' AND column_name IN ('terms_policy_sha256', 'consent_format', 'consent_details')))) <> 7 THEN
    RAISE EXCEPTION 'DOWN VERIFY: consent columns must stay';
  END IF;
END;
$verify_checkout_consent_v2_down$;

NOTIFY pgrst, 'reload schema';
