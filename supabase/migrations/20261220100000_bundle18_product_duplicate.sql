-- 출시 전 작업 순서표 18번 묶음: 상품 업로드 개선(계획 docs/plan-bundle18-product-upload.md 3판, 6절).
-- 만드는 것: 함수 하나 duplicate_market_item(복제·같은 구성으로 다음 상품). 표·정책·트리거·기존 표 DDL 은 없다.
--   SECURITY DEFINER, search_path 고정, service_role 만 EXECUTE. 행위자 판정은 17번 market_catalog_actor_allowed.
--   상품·서브상품·전체구매를 한 거래로 만들거나 하나도 만들지 않는다(중간 실패 = 전체 되돌림). 새 상품은 늘 임시저장(draft·manual).
--   판매 파일(market_subproduct_files)·샘플·후기·조회 기록·이용 근거는 복사하지 않는다. Storage 를 건드리지 않는다.
--   결제·환불 함수는 바꾸지 않는다(사본은 임시저장이고 파일이 없어 evaluate_market_targets 가 '살 수 없음'으로 본다).
-- 잠금: 원본 상품 행 FOR SHARE(원본은 바꾸지 않음). 새 행 INSERT 만 한다. 함수 만들기는 표를 잠그지 않는다(light 리허설로 충분).
-- 사전 점검 지문: record_admin_audit md5(pg_get_functiondef) = 17번과 같은 값(2026-11-26 운영 읽기 전용).
-- 되돌리기: supabase/rollback/20261220100000_bundle18_product_duplicate_down.sql(복제 route·버튼을 먼저 되돌려 배포한 뒤).
--   17번 down 은 이 함수 이름이 있으면 멈추므로, 17번을 되돌리려면 이 down 을 먼저 적용한다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검(6-1) -----------------------------------------------------------------------------------------------
DO $precheck_bundle18_product_duplicate$
BEGIN
  IF to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)') IS NULL
     OR md5(pg_get_functiondef(to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)')))
        <> 'a42b474d9d95753ffba5041acb0c1c77' THEN
    RAISE EXCEPTION 'PRECHECK: record_admin_audit changed';
  END IF;
  IF to_regprocedure('public.market_catalog_actor_allowed(uuid)') IS NULL OR to_regclass('public.market_item_usage_bases') IS NULL THEN
    RAISE EXCEPTION 'PRECHECK: bundle 17 (market_catalog_actor_allowed / market_item_usage_bases) missing — apply bundle 17 first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'duplicate_market_item') THEN
    RAISE EXCEPTION 'PRECHECK: duplicate_market_item already exists';
  END IF;
  -- 함수가 쓰는 칸이 있다(이름이 바뀌었으면 멈춤)
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_items'
        AND column_name IN ('workspace_subject', 'subject_code', 'category_item_id', 'menu_entry_id', 'title', 'summary', 'description',
          'thumbnail_image_id', 'thumbnail_url', 'exam_year', 'exam_month', 'grade_level', 'source_type', 'source_1', 'source_2', 'source_3',
          'source_4', 'question_count', 'pdf_price', 'hwp_price', 'zip_price', 'status', 'draft_source', 'is_active', 'published_at',
          'view_count', 'sort_order', 'created_by', 'updated_by', 'deleted_at')) <> 30
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_item_subproducts'
        AND column_name IN ('item_id', 'workspace_subject', 'category_id', 'title', 'description', 'purchase_notice_label',
          'purchase_notice_text', 'price_credits', 'is_active', 'sort_order', 'deleted_at')) <> 11
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_item_bundle_options'
        AND column_name IN ('item_id', 'workspace_subject', 'label', 'description', 'price_credits', 'is_active', 'updated_at')) <> 7 THEN
    RAISE EXCEPTION 'PRECHECK: market_items / market_item_subproducts / market_item_bundle_options columns changed';
  END IF;
END
$precheck_bundle18_product_duplicate$;

-- [18번] 시작 ---------------------------------------------------------------------------------------------------
-- 1. 복제 함수(6-2). p_mode: 'next'(같은 구성으로 다음 상품) · 'copy'(목록 [복제]).
--    순서: 요청 정보 → 행위자 → 입력 → 원본 FOR SHARE(지운 상품·다른 과목이면 없음) → 새 상품 → 서브상품(지운 구성은 건너뜀) →
--    전체구매 1행 → 작업 기록(같은 거래).
--    오류: MARKET_DUPLICATE_INPUT_INVALID:칸, MARKET_CATALOG_ACTOR_NOT_ALLOWED, MARKET_DUPLICATE_SOURCE_NOT_FOUND.
--    과목 비교는 workspace_subject 만(운영 국어 상품 다수의 subject_code 가 'english' 로 남아 있어 subject_code 는 원본 그대로 복사만 함).
CREATE FUNCTION public.duplicate_market_item(p_actor_id uuid, p_subject text, p_source_item_id uuid, p_mode text, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_duplicate_market_item$
DECLARE
  c_copy_suffix constant text := ' (사본)';
  c_title_max constant integer := 120;
  c_next_title constant text := '새 상품';
  v_src public.market_items%ROWTYPE;
  v_new_id uuid;
  v_title text;
  v_subproduct_count integer := 0;
  v_skipped_count integer := 0;
  v_bundle public.market_item_bundle_options%ROWTYPE;
  v_bundle_copied boolean := false;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'MARKET_DUPLICATE_INPUT_INVALID:request';
  END IF;
  IF NOT public.market_catalog_actor_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'MARKET_CATALOG_ACTOR_NOT_ALLOWED';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('next', 'copy') THEN
    RAISE EXCEPTION 'MARKET_DUPLICATE_INPUT_INVALID:mode';
  END IF;
  IF p_subject IS NULL OR p_subject NOT IN ('korean', 'english') THEN
    RAISE EXCEPTION 'MARKET_DUPLICATE_INPUT_INVALID:subject';
  END IF;
  IF p_source_item_id IS NULL THEN
    RAISE EXCEPTION 'MARKET_DUPLICATE_INPUT_INVALID:itemId';
  END IF;

  SELECT * INTO v_src FROM public.market_items i WHERE i.id = p_source_item_id FOR SHARE;
  IF NOT FOUND OR v_src.deleted_at IS NOT NULL OR v_src.workspace_subject <> p_subject THEN
    RAISE EXCEPTION 'MARKET_DUPLICATE_SOURCE_NOT_FOUND';
  END IF;

  -- 제목: copy 는 원본을 (상한 − 접미사 길이)자로 자른 뒤 ' (사본)', next 는 '새 상품'(화면이 제목 칸을 비우고 초점을 둔다)
  v_title := CASE WHEN p_mode = 'copy'
    THEN left(v_src.title, c_title_max - char_length(c_copy_suffix)) || c_copy_suffix
    ELSE c_next_title END;

  -- 새 상품: 카테고리·자료 정보(연도·월·학년·자료유형)·출처 1~4 는 두 방식 모두, 요약·설명·문항 수·상품 이미지는 copy 만.
  -- 게시판 연결(menu_entry_id)·옛 이미지 칸(thumbnail_url)·옛 가격 칸은 새 상품 규칙대로 비운다(createMarketItem 과 같음).
  INSERT INTO public.market_items (
    workspace_subject, subject_code, category_item_id, menu_entry_id, title, summary, description, thumbnail_image_id, thumbnail_url,
    exam_year, exam_month, grade_level, source_type, source_1, source_2, source_3, source_4, question_count,
    pdf_price, hwp_price, zip_price, status, draft_source, is_active, published_at, view_count, sort_order,
    created_by, updated_by, created_at, updated_at)
  VALUES (
    v_src.workspace_subject, v_src.subject_code, v_src.category_item_id, NULL, v_title,
    CASE WHEN p_mode = 'copy' THEN v_src.summary END,
    CASE WHEN p_mode = 'copy' THEN v_src.description END,
    CASE WHEN p_mode = 'copy' THEN v_src.thumbnail_image_id END,
    NULL,
    v_src.exam_year, v_src.exam_month, v_src.grade_level, v_src.source_type, v_src.source_1, v_src.source_2, v_src.source_3, v_src.source_4,
    CASE WHEN p_mode = 'copy' THEN v_src.question_count END,
    0, 0, 0, 'draft', 'manual', true, NULL, 0, 0,
    p_actor_id, p_actor_id, v_now, v_now)
  RETURNING id INTO v_new_id;

  -- 서브상품: 지우지 않은 행(사용 여부 그대로). 지운 구성의 서브상품은 건너뛰고 센다. 비활성 구성은 복사한다(화면이 표시).
  -- 순서는 원본 (sort_order, created_at, id) 순번 × 10(한 거래 안 created_at 이 같아도 흔들리지 않게).
  WITH source_rows AS (
    SELECT s.*, ROW_NUMBER() OVER (ORDER BY s.sort_order, s.created_at, s.id) AS rn
      FROM public.market_item_subproducts s
      JOIN public.market_subproduct_categories c ON c.id = s.category_id AND c.workspace_subject = s.workspace_subject
     WHERE s.item_id = v_src.id AND s.workspace_subject = v_src.workspace_subject
       AND s.deleted_at IS NULL AND c.deleted_at IS NULL
  )
  INSERT INTO public.market_item_subproducts (
    item_id, workspace_subject, category_id, title, description, purchase_notice_label, purchase_notice_text,
    price_credits, is_active, sort_order, created_at, updated_at)
  SELECT v_new_id, r.workspace_subject, r.category_id, r.title, r.description, r.purchase_notice_label, r.purchase_notice_text,
         r.price_credits, r.is_active, (10 * r.rn)::integer, v_now, v_now
    FROM source_rows r;
  GET DIAGNOSTICS v_subproduct_count = ROW_COUNT;

  SELECT count(*)::integer INTO v_skipped_count
    FROM public.market_item_subproducts s
    JOIN public.market_subproduct_categories c ON c.id = s.category_id AND c.workspace_subject = s.workspace_subject
   WHERE s.item_id = v_src.id AND s.workspace_subject = v_src.workspace_subject
     AND s.deleted_at IS NULL AND c.deleted_at IS NOT NULL;

  -- 전체구매: 사용 중인 행이 있으면 그 행, 없으면 updated_at 이 가장 최근인 1행(사용 여부·가격·표시명·설명)
  SELECT * INTO v_bundle
    FROM public.market_item_bundle_options b
   WHERE b.item_id = v_src.id AND b.workspace_subject = v_src.workspace_subject
   ORDER BY b.is_active DESC, b.updated_at DESC, b.id
   LIMIT 1;
  IF FOUND THEN
    INSERT INTO public.market_item_bundle_options (item_id, workspace_subject, label, description, price_credits, is_active, created_at, updated_at)
    VALUES (v_new_id, v_src.workspace_subject, v_bundle.label, v_bundle.description, v_bundle.price_credits, v_bundle.is_active, v_now, v_now);
    v_bundle_copied := true;
  END IF;

  PERFORM public.record_admin_audit(p_actor_id, 'market_item_duplicate', 'market_item', v_new_id::text, NULL, NULL, NULL,
    jsonb_build_object(
      'mode', p_mode,
      'source_item_id', v_src.id,
      'new_item_id', v_new_id,
      'subproduct_count', v_subproduct_count,
      'bundle_copied', v_bundle_copied,
      'request', p_request_meta),
    NULL);

  RETURN jsonb_build_object('item_id', v_new_id, 'subproduct_count', v_subproduct_count,
    'skipped_subproduct_count', v_skipped_count, 'bundle_copied', v_bundle_copied);
END;
$fn_duplicate_market_item$;

-- 2. 함수 권한: PUBLIC·anon·authenticated(와 기본 권한으로 받은 service_role)을 회수한 뒤 service_role 만 EXECUTE.
REVOKE ALL ON FUNCTION public.duplicate_market_item(uuid, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.duplicate_market_item(uuid, text, uuid, text, jsonb) TO service_role;
-- [18번] 끝 -----------------------------------------------------------------------------------------------------

-- 3. VERIFY(6-3) ---------------------------------------------------------------------------------------------------
DO $verify_bundle18_product_duplicate$
DECLARE
  v_fn constant text := 'public.duplicate_market_item(uuid,text,uuid,text,jsonb)';
BEGIN
  IF to_regprocedure(v_fn) IS NULL
     OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'duplicate_market_item') <> 1
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT TRUE
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig))
     OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_fn) AND a.grantee = 0) THEN
    RAISE EXCEPTION 'VERIFY: % SECURITY DEFINER / search_path / EXECUTE', v_fn;
  END IF;
END;
$verify_bundle18_product_duplicate$;

NOTIFY pgrst, 'reload schema';
