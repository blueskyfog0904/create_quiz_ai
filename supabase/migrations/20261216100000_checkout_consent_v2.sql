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
LOCK TABLE public.market_purchase_notice_acks IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.point_charge_checkout_acks IN ACCESS EXCLUSIVE MODE;

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
ALTER TABLE public.market_purchase_notice_acks
  ADD COLUMN IF NOT EXISTS refund_policy_sha256 text,
  ADD COLUMN IF NOT EXISTS terms_policy_sha256 text,
  ADD COLUMN IF NOT EXISTS consent_format smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS consent_details jsonb;
ALTER TABLE public.point_charge_checkout_acks
  ADD COLUMN IF NOT EXISTS terms_policy_sha256 text,
  ADD COLUMN IF NOT EXISTS consent_format smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS consent_details jsonb;

DO $add_consent_format_checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.market_purchase_notice_acks'::regclass
                  AND conname = 'market_purchase_notice_acks_consent_format_check') THEN
    ALTER TABLE public.market_purchase_notice_acks
      ADD CONSTRAINT market_purchase_notice_acks_consent_format_check CHECK (consent_format IN (1, 2));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.point_charge_checkout_acks'::regclass
                  AND conname = 'point_charge_checkout_acks_consent_format_check') THEN
    ALTER TABLE public.point_charge_checkout_acks
      ADD CONSTRAINT point_charge_checkout_acks_consent_format_check CHECK (consent_format IN (1, 2));
  END IF;
END;
$add_consent_format_checks$;

COMMENT ON COLUMN public.market_purchase_notice_acks.consent_format IS '11번: 동의 판(1 펼친 고지, 2 접는 동의).';
COMMENT ON COLUMN public.market_purchase_notice_acks.consent_details IS '11번: {cartTexts: 그때 장바구니 결제 칸 문구와 지문 | null, consent: 2판 묶음(noticeSha256 뺌) — 2판만}.';
COMMENT ON COLUMN public.point_charge_checkout_acks.consent_details IS '11번: {consent: 2판 묶음(noticeSha256·plan 뺌)} — 2판만, 1판은 NULL.';

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
       AND column_name IN ('refund_policy_sha256', 'terms_policy_sha256', 'consent_format', 'consent_details')) <> 4
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'point_charge_checkout_acks'
       AND column_name IN ('terms_policy_sha256', 'consent_format', 'consent_details')) <> 3
     OR (SELECT count(*) FROM pg_constraint WHERE conname IN ('market_purchase_notice_acks_consent_format_check',
                                                              'point_charge_checkout_acks_consent_format_check')) <> 2 THEN
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
