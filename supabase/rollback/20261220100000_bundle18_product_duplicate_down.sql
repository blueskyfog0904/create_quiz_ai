-- 18번 묶음 되돌리기(supabase/migrations/20261220100000_bundle18_product_duplicate.sql 의 down). 계획 docs/plan-bundle18-product-upload.md 6-3.
-- 복제 route(POST /api/admin/market/items/[id]/duplicate)와 화면 버튼을 먼저 되돌려 배포한 뒤에만 실행한다(함수가 없으면 route 가 500).
-- 함수만 지운다. 이 함수로 만든 사본 상품은 일반 임시 상품이라 남긴다(관리자가 '임시저장' 탭에서 지운다).
-- 17번 down 은 이 함수 이름이 있으면 멈춘다 — 17번을 되돌리려면 이 파일을 먼저 적용한다.
-- 이 파일은 이력 행을 지우지 않는다. 다시 적용하려면 같은 거래에서 schema_migrations 의 '20261220100000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $precheck_bundle18_product_duplicate_down$
BEGIN
  IF to_regprocedure('public.duplicate_market_item(uuid,text,uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: duplicate_market_item missing (not the bundle 18 state)';
  END IF;
END;
$precheck_bundle18_product_duplicate_down$;

-- [18번] 시작: 되돌림 ----------------------------------------------------------------------------------------------
DROP FUNCTION public.duplicate_market_item(uuid, text, uuid, text, jsonb);
-- [18번] 끝 -----------------------------------------------------------------------------------------------------

DO $verify_bundle18_product_duplicate_down$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'duplicate_market_item') THEN
    RAISE EXCEPTION 'DOWN VERIFY: duplicate_market_item remains';
  END IF;
END;
$verify_bundle18_product_duplicate_down$;

NOTIFY pgrst, 'reload schema';
