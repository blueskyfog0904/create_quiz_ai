-- 17번 묶음 되돌리기(supabase/migrations/20261219100000_bundle17_product_info.sql 의 down). 계획 docs/plan-bundle17-product-info.md 5-6.
-- 코드를 17번 전으로 되돌린 뒤에만 실행한다(새 코드는 목록·설정 행이 없으면 상품 저장의 목록 검사와 '상품 표시 설정' 화면이 오류가 난다).
-- 머리 확인(하나라도 어기면 멈춤):
--   ① 17번 표 2개가 있음(17번 적용 상태)
--   ② 18·19번 함수가 없음 — plpgsql 본문이라 의존성으로 잡히지 않으므로 이름으로 본다:
--      duplicate_market_item·reorder_market_item_subproducts, 그리고 19번판 save_market_item_display(본문에 detail 글자).
--   ③ 목록 표(market_item_attribute_options)를 가리키는 FK 가운데 17번 근거 표의 것이 아닌 것이 없음.
--   ④ 이용 근거 행이 1건이라도 있으면 대표 확인(c_allow_drop_usage_bases = true) 전 멈춤. 지우기 전에 아래 조회로 CSV 를 꺼내 보관한다.
--        SELECT b.item_id, i.title, b.workspace_subject, o.label AS basis, b.note, b.evidence_ref, b.revision, b.updated_by, b.updated_at
--          FROM public.market_item_usage_bases b
--          JOIN public.market_items i ON i.id = b.item_id
--          JOIN public.market_item_attribute_options o ON o.id = b.basis_option_id
--         ORDER BY b.workspace_subject, i.title;
-- 이름 바꾸기로 바뀐 상품 값(grade_level·source_type)은 되돌리지 않는다(작업 기록 market_item_option_save 의 before 에 옛 이름이 있다).
-- 순서: 잠금 트리거 2개 → 트리거 함수 2개 → 쓰기 함수 → market_item_usage_bases → market_item_attribute_options → 설정 행 → handle_new_user 옛 정의.
-- 이 파일은 이력 행을 지우지 않는다. 다시 적용하려면 같은 거래에서 schema_migrations 의 '20261219100000' 행을 지운 뒤 마이그레이션과 이력 INSERT 를 넣는다.
-- 잠금: 기존 표 두 개의 트리거 지우기와 근거 표 지우기(market_items FK 가 함께 지워짐)는 짧은 ACCESS EXCLUSIVE — '[17번 기존 표 DDL]' 구역(리허설 light 사본은 뺀다).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $precheck_bundle17_product_info_down$
DECLARE
  c_allow_drop_usage_bases constant boolean := false;
  v_later_functions text[] := ARRAY['duplicate_market_item', 'reorder_market_item_subproducts'];
BEGIN
  IF to_regclass('public.market_item_attribute_options') IS NULL OR to_regclass('public.market_item_usage_bases') IS NULL THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 17 tables missing (not the bundle 17 state)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_later_functions))
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'save_market_item_display'
                 AND p.prosrc ~* 'detail') THEN
    RAISE EXCEPTION 'DOWN PRECHECK: bundle 18/19 functions exist — roll back bundle 18/19 first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.contype = 'f' AND c.confrelid = 'public.market_item_attribute_options'::regclass
                AND c.conrelid <> 'public.market_item_usage_bases'::regclass) THEN
    RAISE EXCEPTION 'DOWN PRECHECK: other foreign keys reference market_item_attribute_options — roll back that bundle first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.market_item_usage_bases) AND NOT c_allow_drop_usage_bases THEN
    RAISE EXCEPTION 'DOWN PRECHECK: usage bases exist — export CSV, then owner confirms (c_allow_drop_usage_bases)';
  END IF;
END;
$precheck_bundle17_product_info_down$;

-- [17번] 시작: 되돌림 ----------------------------------------------------------------------------------------------
-- 1. [17번 기존 표 DDL] 시작 — 잠금 트리거 2개
DROP TRIGGER guard_market_subproduct_category_identity ON public.market_subproduct_categories;
DROP TRIGGER guard_market_file_type_identity ON public.market_file_types;
-- [17번 기존 표 DDL] 끝

-- 2. 트리거 함수·쓰기 함수
DROP FUNCTION public.guard_market_subproduct_category_identity();
DROP FUNCTION public.guard_market_file_type_identity();
DROP FUNCTION public.save_market_item_display(uuid, integer, jsonb, jsonb);
DROP FUNCTION public.save_market_item_usage_basis(uuid, uuid, integer, uuid, text, text, jsonb);
DROP FUNCTION public.reorder_market_item_options(uuid, text, text, uuid[], jsonb);
DROP FUNCTION public.save_market_item_option(uuid, uuid, integer, text, text, text, boolean, jsonb);
DROP FUNCTION public.market_catalog_actor_allowed(uuid);

-- 3. 표(근거 표 먼저 — 목록 표를 가리킨다)
DROP TABLE public.market_item_usage_bases;
DROP TABLE public.market_item_attribute_options;

-- 4. 설정 행
DELETE FROM public.system_settings WHERE key = 'market_item_display';

-- 5. 가입 트리거 옛 정의(2026-11-26 운영 pg_get_functiondef 원문 그대로 — md5 61bc7b1469fb4dd6e795725040efe394)
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_provider text;
  v_kakao_id text;
  v_kakao_email text;
  v_phone text;
  v_avatar_url text;
  v_signup_completed boolean;
begin
  v_provider := coalesce(
    nullif(btrim(new.raw_app_meta_data ->> 'provider'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'provider'), ''),
    'email'
  );

  v_kakao_id := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'kakao_id'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'provider_id'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'sub'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'id'), ''),
    nullif(btrim(new.raw_app_meta_data ->> 'provider_id'), ''),
    nullif(btrim(new.raw_app_meta_data ->> 'provider_uid'), ''),
    nullif(btrim(new.raw_app_meta_data ->> 'sub'), '')
  );

  v_kakao_email := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'kakao_email'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'email'), ''),
    nullif(btrim(new.raw_user_meta_data -> 'kakao_account' ->> 'email'), ''),
    nullif(btrim(new.email), '')
  );

  v_phone := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'phone'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'phone_number'), ''),
    nullif(btrim(new.raw_user_meta_data -> 'kakao_account' ->> 'phone_number'), '')
  );

  v_avatar_url := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'picture'), ''),
    nullif(btrim(new.raw_user_meta_data -> 'kakao_account' -> 'profile' ->> 'profile_image_url'), '')
  );

  v_signup_completed := case when v_provider = 'kakao' then false else true end;

  insert into public.profiles (
    id,
    email,
    phone,
    avatar_url,
    kakao_id,
    kakao_email,
    provider,
    signup_completed
  )
  values (
    new.id,
    coalesce(new.email, v_kakao_email),
    v_phone,
    v_avatar_url,
    v_kakao_id,
    v_kakao_email,
    v_provider,
    v_signup_completed
  );

  return new;
end;
$function$;

DO $verify_bundle17_product_info_down$
BEGIN
  IF to_regclass('public.market_item_attribute_options') IS NOT NULL OR to_regclass('public.market_item_usage_bases') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (
       'market_catalog_actor_allowed', 'save_market_item_option', 'reorder_market_item_options', 'save_market_item_usage_basis',
       'save_market_item_display', 'guard_market_subproduct_category_identity', 'guard_market_file_type_identity'))
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal
                 AND t.tgname IN ('guard_market_subproduct_category_identity', 'guard_market_file_type_identity'))
     OR EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'market_item_display') THEN
    RAISE EXCEPTION 'DOWN VERIFY: bundle 17 objects remain';
  END IF;
  IF md5(pg_get_functiondef('public.handle_new_user()'::regprocedure)) <> '61bc7b1469fb4dd6e795725040efe394' THEN
    RAISE EXCEPTION 'DOWN VERIFY: handle_new_user is not the old definition (%)', md5(pg_get_functiondef('public.handle_new_user()'::regprocedure));
  END IF;
END;
$verify_bundle17_product_info_down$;

NOTIFY pgrst, 'reload schema';
