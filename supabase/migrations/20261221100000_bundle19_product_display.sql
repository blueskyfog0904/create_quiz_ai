-- 출시 전 작업 순서표 19번 묶음: 상품 표시 설정(계획 docs/plan-bundle19-product-display.md 2판, 4절).
-- 하는 것:
--   1. 설정 행 system_settings.market_item_display 에 'detail' 키를 더한다(상세 안내 문구·자료 정보 항목, 4-2). revision + 1.
--      첫 값은 지금 화면 글자 그대로다(샘플 설명만 Q2 새 문장 "샘플 {장수}장을 미리 볼 수 있어요.").
--   2. save_market_item_display 교체(CREATE OR REPLACE, 4-3): p_value 에 없는 최상위 키는 지금 값 그대로 둔다(탭마다 자기 키만 보냄).
--      17번 규칙은 facetLabels·libraryEmptyFilterHint 에만, detail 에는 4-2 규칙(필수 키·infoItems 6개·{장수}·글자 수)만 적용한다.
--   3. 함수 reorder_market_item_subproducts(서브상품 순서, 4-4). SECURITY DEFINER, search_path 고정, service_role 만 EXECUTE.
-- 기존 표 DDL 은 없다(표·칸·트리거·정책·기본값을 바꾸지 않음 — 전체구매 label 칸 기본값도 그대로, 4-5). 설정 행 한 줄 UPDATE 와
--   함수 만들기·교체뿐이라 light 리허설로 충분하다(낮 가능). 결제·환불 함수는 바꾸지 않는다.
-- 잠금: 순서 함수는 상품 행을 FOR NO KEY UPDATE 로 잠근다(같은 상품의 동시 순서 저장을 줄 세움). 계획의 'FOR UPDATE' 대신
--   NO KEY 를 쓴 까닭: 구매 줄·장바구니 INSERT 의 FK 확인(KEY SHARE)을 막지 않으려고(구현 메모).
-- 사전 점검 지문: record_admin_audit = 17·18번과 같은 값, save_market_item_display = 17번 원본을 거래 안에서 적용해 잰 값
--   (2026-11-26 운영 BEGIN…ROLLBACK, 17번 light 사본). 17번 적용 뒤에도 같은 값이어야 한다(다르면 멈춤).
-- 표시명 데이터('전체 한번에 구매하기' → '전체 패키지')는 이 마이그레이션 밖 스크립트다(supabase/scripts/20261221_bundle19_bundle_label.sql,
--   19번 코드 배포 전후 두 번, 4-5·11절).
-- 되돌리기: supabase/rollback/20261221100000_bundle19_product_display_down.sql(19번 코드를 먼저 되돌려 배포한 뒤).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검(4-1) -----------------------------------------------------------------------------------------------
DO $precheck_bundle19_product_display$
DECLARE
  v_value jsonb;
BEGIN
  IF to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)') IS NULL
     OR md5(pg_get_functiondef(to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)')))
        <> 'a42b474d9d95753ffba5041acb0c1c77' THEN
    RAISE EXCEPTION 'PRECHECK: record_admin_audit changed';
  END IF;
  IF to_regprocedure('public.market_catalog_actor_allowed(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: bundle 17 (market_catalog_actor_allowed) missing — apply bundle 17 first';
  END IF;
  IF to_regprocedure('public.duplicate_market_item(uuid,text,uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: bundle 18 (duplicate_market_item) missing — apply bundle 18 first';
  END IF;
  IF to_regprocedure('public.save_market_item_display(uuid,integer,jsonb,jsonb)') IS NULL
     OR md5(pg_get_functiondef('public.save_market_item_display(uuid,integer,jsonb,jsonb)'::regprocedure)) <> '5cd1e1f548bd73aea05f5845a0212a6a' THEN
    RAISE EXCEPTION 'PRECHECK: save_market_item_display is not the bundle 17 definition';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'reorder_market_item_subproducts') THEN
    RAISE EXCEPTION 'PRECHECK: reorder_market_item_subproducts already exists';
  END IF;
  SELECT s.value INTO v_value FROM public.system_settings s WHERE s.key = 'market_item_display';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'revision') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'PRECHECK: market_item_display row missing (bundle 17)';
  END IF;
  IF v_value ? 'detail' THEN
    RAISE EXCEPTION 'PRECHECK: market_item_display already has detail';
  END IF;
  -- VERIFY 가 판이 정확히 1 올랐는지 보도록 적용 전 판을 이 거래 안에만 보관한다
  PERFORM set_config('bundle19.revision_before', v_value ->> 'revision', true);
  -- 순서 함수가 쓰는 칸이 있다(이름이 바뀌었으면 멈춤)
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_item_subproducts'
        AND column_name IN ('id', 'item_id', 'workspace_subject', 'sort_order', 'created_at', 'updated_at', 'deleted_at')) <> 7
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_items'
        AND column_name IN ('id', 'workspace_subject', 'deleted_at')) <> 3 THEN
    RAISE EXCEPTION 'PRECHECK: market_items / market_item_subproducts columns changed';
  END IF;
END
$precheck_bundle19_product_display$;

-- [19번] 시작 ---------------------------------------------------------------------------------------------------
-- 1. 설정 행에 detail 더하기(4-2). infoItems 배열 순서가 상세 '자료 상세 정보' 표의 순서다. 최종 문구는 대표가 '상품 표시 설정'에서 고친다.
UPDATE public.system_settings s
   SET value = s.value || jsonb_build_object('revision', (s.value ->> 'revision')::integer + 1, 'detail', $json_bundle19_detail$
{
  "sampleTitle": "무료 샘플 미리보기",
  "sampleTitleEmpty": "샘플 준비 중",
  "sampleDescription": "샘플 {장수}장을 미리 볼 수 있어요.",
  "sampleDescriptionLegacy": "기존 샘플 PDF는 판매용 PDF 재업로드 후 JPG 미리보기로 대체됩니다.",
  "sampleDescriptionEmpty": "현재 이 자료는 미리보기를 제공하지 않습니다.",
  "sampleRowButton": "샘플 보기",
  "sampleButton": "샘플 {장수}장 보기",
  "sampleButtonEmpty": "샘플 없음",
  "hwpPdfNoticeLabel": "PDF 포함",
  "hwpPdfNoticeText": "편집 가능한 HWP와 문제(PDF)를 함께 제공합니다. PDF는 따로 구매하지 않아도 됩니다.",
  "bundleDefaultTitle": "전체 패키지",
  "summaryLabels": { "questionCount": "포함 문항", "samplePages": "샘플 페이지", "unknown": "정보 없음", "noSample": "제공 없음" },
  "infoItems": [
    { "key": "subject", "label": "과목", "visible": true },
    { "key": "grade", "label": "학년", "visible": true },
    { "key": "sources", "label": "출처", "visible": true },
    { "key": "materialType", "label": "자료유형", "visible": true },
    { "key": "questionCount", "label": "문항 수", "visible": true },
    { "key": "registeredAt", "label": "등록일자", "visible": true }
  ]
}
$json_bundle19_detail$::jsonb),
       updated_at = clock_timestamp()
 WHERE s.key = 'market_item_display';

-- 2. 표시 설정 저장 교체(4-3). 순서: 요청 정보 → 행위자 → advisory lock → 행 FOR UPDATE → 판 비교 → 받은 최상위 키마다 검사·다시 만들기
--    (없는 키는 그대로) → 바뀐 것 없음이면 그대로 → 저장 → 작업 기록(같은 거래, 종류는 17번과 같은 market_item_display_update).
--    detail 규칙: 짧은 글(제목·이름·버튼) 1~30자, 긴 글(설명·안내) 1~200자, 모두 한 줄. 자리표시는 {장수} 만, sampleDescription·
--    sampleButton 두 키에서만 받는다(그 밖의 {…} 꼴은 거절). infoItems 는 6개 key 가 정확히 한 번씩(배열 순서 = 화면 순서).
--    받은 detail 은 아는 키만 다시 만든다(모르는 키는 버림). 필수 키 목록은 src/lib/market-item-options.ts MARKET_ITEM_DISPLAY_REQUIRED_KEYS.
CREATE OR REPLACE FUNCTION public.save_market_item_display(p_actor_id uuid, p_expected_revision integer, p_value jsonb, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_market_item_display$
DECLARE
  v_facet_keys text[] := ARRAY['category', 'type', 'year', 'grade'];
  v_detail_short_keys text[] := ARRAY['sampleTitle', 'sampleTitleEmpty', 'sampleRowButton', 'sampleButton', 'sampleButtonEmpty',
    'hwpPdfNoticeLabel', 'bundleDefaultTitle'];
  v_detail_long_keys text[] := ARRAY['sampleDescription', 'sampleDescriptionLegacy', 'sampleDescriptionEmpty', 'hwpPdfNoticeText'];
  v_detail_count_keys text[] := ARRAY['sampleDescription', 'sampleButton'];
  v_summary_keys text[] := ARRAY['questionCount', 'samplePages', 'unknown', 'noSample'];
  v_info_keys text[] := ARRAY['subject', 'grade', 'sources', 'materialType', 'questionCount', 'registeredAt'];
  v_old jsonb;
  v_revision integer;
  v_patch jsonb := '{}'::jsonb;
  v_facets jsonb;
  v_hint text;
  v_detail jsonb;
  v_summary jsonb;
  v_items jsonb;
  v_item jsonb;
  v_in jsonb;
  v_new jsonb;
  v_key text;
  v_text text;
  v_max integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_INPUT_INVALID:request';
  END IF;
  IF NOT public.market_catalog_actor_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'MARKET_CATALOG_ACTOR_NOT_ALLOWED';
  END IF;
  -- 잠금 순서: 권한 확인 직후, 설정 행 FOR UPDATE 보다 먼저
  PERFORM pg_advisory_xact_lock(hashtext('market_item_display'));

  SELECT s.value INTO v_old FROM public.system_settings s WHERE s.key = 'market_item_display' FOR UPDATE;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_MISSING';
  END IF;
  v_revision := CASE WHEN jsonb_typeof(v_old -> 'revision') = 'number' THEN (v_old ->> 'revision')::integer END;
  IF p_expected_revision IS NULL OR p_expected_revision IS DISTINCT FROM v_revision THEN
    RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_REVISION_CONFLICT';
  END IF;
  -- 받는 최상위 키는 세 가지뿐이고 하나 이상 있어야 한다
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object'
     OR NOT (p_value ? 'facetLabels' OR p_value ? 'libraryEmptyFilterHint' OR p_value ? 'detail')
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_value) k WHERE k NOT IN ('facetLabels', 'libraryEmptyFilterHint', 'detail')) THEN
    RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_INPUT_INVALID:value';
  END IF;

  -- 17번 키(받았을 때만): 필터 이름은 비지 않은 한 줄 글, 20자 이하, {type} 없음. 보관함 안내는 60자 이하({type} 가능).
  IF p_value ? 'facetLabels' THEN
    IF jsonb_typeof(p_value -> 'facetLabels') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_INPUT_INVALID:value';
    END IF;
    v_facets := '{}'::jsonb;
    FOREACH v_key IN ARRAY v_facet_keys LOOP
      v_text := CASE WHEN jsonb_typeof(p_value -> 'facetLabels' -> v_key) = 'string' THEN btrim(p_value -> 'facetLabels' ->> v_key) END;
      IF v_text IS NULL OR v_text = '' OR char_length(v_text) > 20 OR v_text ~ '[[:cntrl:]]' OR strpos(v_text, '{type}') > 0 THEN
        RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_INPUT_INVALID:facetLabels.%', v_key;
      END IF;
      v_facets := v_facets || jsonb_build_object(v_key, v_text);
    END LOOP;
    v_patch := v_patch || jsonb_build_object('facetLabels', v_facets);
  END IF;
  IF p_value ? 'libraryEmptyFilterHint' THEN
    v_hint := CASE WHEN jsonb_typeof(p_value -> 'libraryEmptyFilterHint') = 'string' THEN btrim(p_value ->> 'libraryEmptyFilterHint') END;
    IF v_hint IS NULL OR v_hint = '' OR char_length(v_hint) > 60 OR v_hint ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_INPUT_INVALID:libraryEmptyFilterHint';
    END IF;
    v_patch := v_patch || jsonb_build_object('libraryEmptyFilterHint', v_hint);
  END IF;

  -- 19번 detail(받았을 때만, 전체를 다시 만든다)
  IF p_value ? 'detail' THEN
    v_in := p_value -> 'detail';
    IF jsonb_typeof(v_in) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_INPUT_INVALID:detail';
    END IF;
    v_detail := '{}'::jsonb;
    FOREACH v_key IN ARRAY v_detail_short_keys || v_detail_long_keys LOOP
      v_max := CASE WHEN v_key = ANY (v_detail_long_keys) THEN 200 ELSE 30 END;
      v_text := CASE WHEN jsonb_typeof(v_in -> v_key) = 'string' THEN btrim(v_in ->> v_key) END;
      IF v_text IS NULL OR v_text = '' OR char_length(v_text) > v_max OR v_text ~ '[[:cntrl:]]'
         OR (CASE WHEN v_key = ANY (v_detail_count_keys) THEN replace(v_text, '{장수}', '') ELSE v_text END) ~ '\{[^{}]*\}' THEN
        RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.%', v_key;
      END IF;
      v_detail := v_detail || jsonb_build_object(v_key, v_text);
    END LOOP;
    IF jsonb_typeof(v_in -> 'summaryLabels') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.summaryLabels';
    END IF;
    v_summary := '{}'::jsonb;
    FOREACH v_key IN ARRAY v_summary_keys LOOP
      v_text := CASE WHEN jsonb_typeof(v_in -> 'summaryLabels' -> v_key) = 'string' THEN btrim(v_in -> 'summaryLabels' ->> v_key) END;
      IF v_text IS NULL OR v_text = '' OR char_length(v_text) > 30 OR v_text ~ '[[:cntrl:]]' OR v_text ~ '\{[^{}]*\}' THEN
        RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.summaryLabels.%', v_key;
      END IF;
      v_summary := v_summary || jsonb_build_object(v_key, v_text);
    END LOOP;
    v_detail := v_detail || jsonb_build_object('summaryLabels', v_summary);
    -- 자료 정보 항목: 6개 key 가 정확히 한 번씩(빠짐·겹침·모르는 key 거절), 이름 1~30자 한 줄, 보이기는 true/false
    IF jsonb_typeof(v_in -> 'infoItems') IS DISTINCT FROM 'array' OR jsonb_array_length(v_in -> 'infoItems') <> cardinality(v_info_keys)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_in -> 'infoItems') e
                   WHERE jsonb_typeof(e) <> 'object' OR jsonb_typeof(e -> 'key') IS DISTINCT FROM 'string' OR NOT (e ->> 'key' = ANY (v_info_keys)))
       OR (SELECT count(DISTINCT e ->> 'key') FROM jsonb_array_elements(v_in -> 'infoItems') e) <> cardinality(v_info_keys) THEN
      RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.infoItems';
    END IF;
    v_items := '[]'::jsonb;
    FOR v_item IN SELECT e FROM jsonb_array_elements(v_in -> 'infoItems') WITH ORDINALITY AS a(e, n) ORDER BY a.n LOOP
      v_text := CASE WHEN jsonb_typeof(v_item -> 'label') = 'string' THEN btrim(v_item ->> 'label') END;
      IF v_text IS NULL OR v_text = '' OR char_length(v_text) > 30 OR v_text ~ '[[:cntrl:]]' OR v_text ~ '\{[^{}]*\}' THEN
        RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.infoItems.label';
      END IF;
      IF jsonb_typeof(v_item -> 'visible') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.infoItems.visible';
      END IF;
      v_items := v_items || jsonb_build_array(jsonb_build_object('key', v_item ->> 'key', 'label', v_text, 'visible', (v_item ->> 'visible')::boolean));
    END LOOP;
    v_detail := v_detail || jsonb_build_object('infoItems', v_items);
    v_patch := v_patch || jsonb_build_object('detail', v_detail);
  END IF;

  v_new := v_old || v_patch || jsonb_build_object('revision', v_revision + 1);
  IF (v_new - 'revision') = (v_old - 'revision') THEN
    RETURN jsonb_build_object('changed', false, 'revision', v_revision);
  END IF;

  UPDATE public.system_settings SET value = v_new, updated_at = v_now WHERE key = 'market_item_display';

  PERFORM public.record_admin_audit(p_actor_id, 'market_item_display_update', 'system_settings', 'market_item_display', NULL, NULL, NULL,
    jsonb_build_object(
      'revision_before', v_revision,
      'revision_after', v_revision + 1,
      'before', v_old,
      'after', v_new,
      'request', p_request_meta,
      'saved_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true, 'revision', v_revision + 1);
END;
$fn_save_market_item_display$;

-- 3. 서브상품 순서(4-4). 순서: 요청 정보 → 행위자 → 입력 → 상품 행 FOR NO KEY UPDATE(지운 상품이면 없음) → 지우지 않은 서브상품 전부(사용 안 함 포함)와
--    p_ids 집합 대조(빠짐·더함·겹침·다른 상품·지운 서브상품 → MISMATCH) → 이미 그 순서·값이면 기록 없이 돌려줌 → sort_order = 10 × 순번 →
--    작업 기록(같은 거래). 결제·환불 판정은 서브상품 sort_order 를 읽지 않는다(운영 pg_proc 확인, 계획 1절).
--    오류: MARKET_SUBPRODUCT_REORDER_INPUT_INVALID:칸, MARKET_CATALOG_ACTOR_NOT_ALLOWED, MARKET_ITEM_NOT_FOUND, MARKET_SUBPRODUCT_REORDER_MISMATCH.
CREATE FUNCTION public.reorder_market_item_subproducts(p_actor_id uuid, p_item_id uuid, p_ids uuid[], p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_reorder_market_item_subproducts$
DECLARE
  v_subject text;
  v_before uuid[];
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'MARKET_SUBPRODUCT_REORDER_INPUT_INVALID:request';
  END IF;
  IF NOT public.market_catalog_actor_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'MARKET_CATALOG_ACTOR_NOT_ALLOWED';
  END IF;
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'MARKET_SUBPRODUCT_REORDER_INPUT_INVALID:itemId';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 200 OR array_position(p_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'MARKET_SUBPRODUCT_REORDER_INPUT_INVALID:ids';
  END IF;

  SELECT i.workspace_subject INTO v_subject FROM public.market_items i WHERE i.id = p_item_id AND i.deleted_at IS NULL FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MARKET_ITEM_NOT_FOUND';
  END IF;

  SELECT COALESCE(array_agg(s.id ORDER BY s.sort_order, s.created_at, s.id), '{}') INTO v_before
    FROM public.market_item_subproducts s
   WHERE s.item_id = p_item_id AND s.workspace_subject = v_subject AND s.deleted_at IS NULL;

  IF cardinality(p_ids) <> cardinality(v_before)
     OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> cardinality(p_ids)
     OR (SELECT array_agg(x ORDER BY x) FROM unnest(p_ids) x) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(v_before) x) THEN
    RAISE EXCEPTION 'MARKET_SUBPRODUCT_REORDER_MISMATCH';
  END IF;
  IF p_ids = v_before AND NOT EXISTS (
       SELECT 1 FROM unnest(p_ids) WITH ORDINALITY AS r(id, ord)
         JOIN public.market_item_subproducts s ON s.id = r.id
        WHERE s.sort_order IS DISTINCT FROM (10 * r.ord)::integer) THEN
    RETURN jsonb_build_object('changed', false);
  END IF;

  UPDATE public.market_item_subproducts s
     SET sort_order = (10 * r.ord)::integer, updated_at = v_now
    FROM unnest(p_ids) WITH ORDINALITY AS r(id, ord)
   WHERE s.id = r.id AND s.sort_order IS DISTINCT FROM (10 * r.ord)::integer;

  PERFORM public.record_admin_audit(p_actor_id, 'market_subproduct_reorder', 'market_item', p_item_id::text, NULL, NULL, NULL,
    jsonb_build_object(
      'item_id', p_item_id,
      'before', to_jsonb(v_before),
      'after', to_jsonb(p_ids),
      'request', p_request_meta),
    NULL);

  RETURN jsonb_build_object('changed', true);
END;
$fn_reorder_market_item_subproducts$;

-- 4. 함수 권한: 새 함수는 PUBLIC·anon·authenticated(와 기본 권한으로 받은 service_role)을 회수한 뒤 service_role 만 EXECUTE.
--    save_market_item_display 는 CREATE OR REPLACE 라 17번 권한(proacl)이 그대로 남는다(아래 VERIFY 가 본다).
REVOKE ALL ON FUNCTION public.reorder_market_item_subproducts(uuid, uuid, uuid[], jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reorder_market_item_subproducts(uuid, uuid, uuid[], jsonb) TO service_role;
-- [19번] 끝 -----------------------------------------------------------------------------------------------------

-- 5. VERIFY(4-6) ---------------------------------------------------------------------------------------------------
DO $verify_bundle19_product_display$
DECLARE
  v_fn text;
  v_value jsonb;
  v_key text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.save_market_item_display(uuid,integer,jsonb,jsonb)',
                              'public.reorder_market_item_subproducts(uuid,uuid,uuid[],jsonb)'] LOOP
    IF to_regprocedure(v_fn) IS NULL
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT TRUE
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig))
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_fn) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'VERIFY: % SECURITY DEFINER / search_path / EXECUTE', v_fn;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname IN ('save_market_item_display', 'reorder_market_item_subproducts')) <> 2 THEN
    RAISE EXCEPTION 'VERIFY: overloads';
  END IF;
  -- 설정 행: revision 이 적용 전보다 정확히 1 오름(사전 점검이 보관한 값), detail 필수 키(MARKET_ITEM_DISPLAY_REQUIRED_KEYS)·infoItems 6개, 17번 키 그대로
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'market_item_display';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'revision') IS DISTINCT FROM 'number'
     OR (v_value ->> 'revision')::integer IS DISTINCT FROM current_setting('bundle19.revision_before')::integer + 1
     OR jsonb_typeof(v_value -> 'facetLabels') IS DISTINCT FROM 'object' OR jsonb_typeof(v_value -> 'libraryEmptyFilterHint') IS DISTINCT FROM 'string'
     OR jsonb_typeof(v_value -> 'detail') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'VERIFY: market_item_display shape';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['sampleTitle', 'sampleTitleEmpty', 'sampleRowButton', 'sampleButton', 'sampleButtonEmpty', 'hwpPdfNoticeLabel',
      'bundleDefaultTitle', 'sampleDescription', 'sampleDescriptionLegacy', 'sampleDescriptionEmpty', 'hwpPdfNoticeText'] LOOP
    IF jsonb_typeof(v_value -> 'detail' -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value -> 'detail' ->> v_key) = '' THEN
      RAISE EXCEPTION 'VERIFY: market_item_display detail.%', v_key;
    END IF;
  END LOOP;
  FOREACH v_key IN ARRAY ARRAY['questionCount', 'samplePages', 'unknown', 'noSample'] LOOP
    IF jsonb_typeof(v_value -> 'detail' -> 'summaryLabels' -> v_key) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'VERIFY: market_item_display detail.summaryLabels.%', v_key;
    END IF;
  END LOOP;
  IF jsonb_typeof(v_value -> 'detail' -> 'infoItems') IS DISTINCT FROM 'array'
     OR (SELECT array_agg(e ->> 'key' ORDER BY e ->> 'key') FROM jsonb_array_elements(v_value -> 'detail' -> 'infoItems') e)
        IS DISTINCT FROM ARRAY['grade', 'materialType', 'questionCount', 'registeredAt', 'sources', 'subject'] THEN
    RAISE EXCEPTION 'VERIFY: market_item_display detail.infoItems';
  END IF;
END;
$verify_bundle19_product_display$;

NOTIFY pgrst, 'reload schema';
