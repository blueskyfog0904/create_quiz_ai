-- 19번 묶음 되돌리기(supabase/migrations/20261221100000_bundle19_product_display.sql 의 down). 계획 docs/plan-bundle19-product-display.md 4-6.
-- 19번 코드(상세 안내 문구·자료 정보 항목 읽기, 서브상품 순서 route, 관리자 탭)를 먼저 되돌려 배포한 뒤에만 실행한다.
--   (새 코드는 detail 키가 없으면 상세의 샘플 줄·자료 정보를 숨기고, 순서 route 는 함수가 없어 500 이 된다.)
-- 하는 것: ① reorder_market_item_subproducts 지우기 ② save_market_item_display 를 17번 정의로(아래 전문 — 17번 마이그레이션 4-5 와 글자까지 같음)
--   ③ 설정 행에서 detail 키만 빼고 revision + 1(17번 키는 그대로).
-- 하지 않는 것: 바뀐 서브상품 순서는 되돌리지 않는다(작업 기록 market_subproduct_reorder 의 before 에 이전 순서가 있다 — 표시만의 차이).
--   전체구매 표시명은 되돌림 스크립트(supabase/scripts/20261221_bundle19_bundle_label_revert.sql)로 따로 되돌린다.
-- 17번 down 은 19번판 save_market_item_display(본문에 detail)·reorder_market_item_subproducts 가 있으면 멈춘다 — 17번을 되돌리려면 18·19번 down 을 먼저.
-- 이 파일은 이력 행을 지우지 않는다. 다시 적용하려면 같은 거래에서 schema_migrations 의 '20261221100000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $precheck_bundle19_product_display_down$
BEGIN
  IF to_regprocedure('public.reorder_market_item_subproducts(uuid,uuid,uuid[],jsonb)') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: reorder_market_item_subproducts missing (not the bundle 19 state)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.save_market_item_display(uuid,integer,jsonb,jsonb)')
                  AND p.prosrc ~ 'detail') THEN
    RAISE EXCEPTION 'DOWN PRECHECK: save_market_item_display is not the bundle 19 definition';
  END IF;
END;
$precheck_bundle19_product_display_down$;

-- [19번] 시작: 되돌림 ----------------------------------------------------------------------------------------------
-- 1. 순서 함수
DROP FUNCTION public.reorder_market_item_subproducts(uuid, uuid, uuid[], jsonb);

-- 2. 표시 설정 저장을 17번 정의로(CREATE OR REPLACE — 권한 proacl 은 그대로). 아래 전문은 17번 마이그레이션 4-5 원문이다.
CREATE OR REPLACE FUNCTION public.save_market_item_display(p_actor_id uuid, p_expected_revision integer, p_value jsonb, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_market_item_display$
DECLARE
  v_facet_keys text[] := ARRAY['category', 'type', 'year', 'grade'];
  v_old jsonb;
  v_revision integer;
  v_facets jsonb := '{}'::jsonb;
  v_hint text;
  v_new jsonb;
  v_key text;
  v_text text;
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
  IF p_value IS NULL OR jsonb_typeof(p_value) <> 'object' OR jsonb_typeof(p_value -> 'facetLabels') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_INPUT_INVALID:value';
  END IF;

  -- 필터 이름: 비지 않은 한 줄 글, 20자 이하, {type} 자리표시 없음
  FOREACH v_key IN ARRAY v_facet_keys LOOP
    v_text := CASE WHEN jsonb_typeof(p_value -> 'facetLabels' -> v_key) = 'string' THEN btrim(p_value -> 'facetLabels' ->> v_key) END;
    IF v_text IS NULL OR v_text = '' OR char_length(v_text) > 20 OR v_text ~ '[[:cntrl:]]' OR strpos(v_text, '{type}') > 0 THEN
      RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_INPUT_INVALID:facetLabels.%', v_key;
    END IF;
    v_facets := v_facets || jsonb_build_object(v_key, v_text);
  END LOOP;
  -- 보관함 빈 화면 안내: 비지 않은 한 줄 글, 60자 이하({type} 은 있어도 없어도 됨)
  v_hint := CASE WHEN jsonb_typeof(p_value -> 'libraryEmptyFilterHint') = 'string' THEN btrim(p_value ->> 'libraryEmptyFilterHint') END;
  IF v_hint IS NULL OR v_hint = '' OR char_length(v_hint) > 60 OR v_hint ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'MARKET_ITEM_DISPLAY_INPUT_INVALID:libraryEmptyFilterHint';
  END IF;

  v_new := v_old || jsonb_build_object('revision', v_revision + 1, 'facetLabels', v_facets, 'libraryEmptyFilterHint', v_hint);
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

-- 3. 설정 행에서 detail 키만 뺀다(판 + 1, 다른 키 그대로)
UPDATE public.system_settings s
   SET value = (s.value - 'detail') || jsonb_build_object('revision', (s.value ->> 'revision')::integer + 1),
       updated_at = clock_timestamp()
 WHERE s.key = 'market_item_display' AND s.value ? 'detail';
-- [19번] 끝 -----------------------------------------------------------------------------------------------------

DO $verify_bundle19_product_display_down$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'reorder_market_item_subproducts') THEN
    RAISE EXCEPTION 'DOWN VERIFY: reorder_market_item_subproducts remains';
  END IF;
  IF md5(pg_get_functiondef('public.save_market_item_display(uuid,integer,jsonb,jsonb)'::regprocedure)) <> '5cd1e1f548bd73aea05f5845a0212a6a' THEN
    RAISE EXCEPTION 'DOWN VERIFY: save_market_item_display is not the bundle 17 definition';
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'market_item_display' AND value ? 'detail') THEN
    RAISE EXCEPTION 'DOWN VERIFY: market_item_display still has detail';
  END IF;
END;
$verify_bundle19_product_display_down$;

NOTIFY pgrst, 'reload schema';
