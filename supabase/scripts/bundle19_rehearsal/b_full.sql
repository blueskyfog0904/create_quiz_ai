-- 19번 묶음 리허설: B full — 17·18번 원본(없으면) + 적용 절차(이력 INSERT) + 경우 R1~R6(표시명 스크립트 원본 글자) + down·이력 지우고 다시 적용(F)
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle19_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle19_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: DB 적용 직전(supabase_migrations 이력 표에 씀, 표시명 스크립트가 실상품 전체구매 행을 잠깐 잠금 — ROLLBACK 됨). 17번이 아직 없으면 17번 원본의 기존 표 DDL 잠금이 ROLLBACK 까지 이어지므로 새벽에.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '300s';
CREATE TEMP TABLE _rh_log (n serial PRIMARY KEY, test text NOT NULL, msg text NOT NULL, payload jsonb) ON COMMIT DROP;
CREATE TEMP TABLE _rh_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON _rh_log, _rh_ctx TO PUBLIC;
GRANT USAGE ON SEQUENCE _rh_log_n_seq TO PUBLIC;

CREATE FUNCTION pg_temp.ctx_set(p_k text, p_v text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _rh_ctx (k, v) VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v
$f$;
CREATE FUNCTION pg_temp.ctx(p_k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM _rh_ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.uid(p_k text) RETURNS uuid LANGUAGE sql AS $f$ SELECT v::uuid FROM _rh_ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.fail(p_test text, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  RAISE EXCEPTION 'RH FAIL [%] %', p_test, left(p_msg, 850);
END $f$;
CREATE FUNCTION pg_temp.try_sql(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300) || ' [' || SQLSTATE || ']';
END $f$;
CREATE FUNCTION pg_temp.try_json(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v jsonb;
BEGIN
  EXECUTE p_sql INTO v;
  RETURN 'OK ' || coalesce(v::text, 'null');
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300) || ' [' || SQLSTATE || ']';
END $f$;
CREATE FUNCTION pg_temp.res(p_result text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT substr(p_result, 4)::jsonb $f$;
CREATE FUNCTION pg_temp.expect(p_actual text, p_prefix text, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_actual IS NULL OR p_actual NOT LIKE p_prefix || '%' THEN
    PERFORM pg_temp.fail(p_test, p_msg || ' — 기대 "' || p_prefix || '", 실제 "' || left(coalesce(p_actual, 'NULL'), 400) || '"');
  END IF;
  RETURN p_msg || ' → ' || left(p_actual, 160);
END $f$;
CREATE FUNCTION pg_temp.ensure(p_cond boolean, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_cond IS NOT TRUE THEN
    PERFORM pg_temp.fail(p_test, p_msg);
  END IF;
  RETURN p_msg;
END $f$;
CREATE FUNCTION pg_temp.grants(p_owner uuid, p_staff uuid, p_keys text[]) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.replace_admin_permission_grants(%L, %L, %L::jsonb)', p_owner, p_staff,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('permission', k)), '[]'::jsonb) FROM unnest(p_keys) k)))
$f$;
CREATE FUNCTION pg_temp.audit_count(p_action text) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::integer FROM public.admin_audit_log WHERE action = p_action AND created_at >= now()
$f$;
CREATE FUNCTION pg_temp.audit_keys_ok(p_action text, p_keys text[], p_mode text DEFAULT NULL) RETURNS boolean LANGUAGE sql AS $f$
  SELECT count(*) > 0 AND bool_and(a.reason IS NULL
     AND ARRAY(SELECT k FROM jsonb_object_keys(a.details) k ORDER BY k COLLATE "C") = p_keys)
    FROM public.admin_audit_log a WHERE a.action = p_action AND a.created_at >= now()
     AND (p_mode IS NULL OR a.details ->> 'mode' = p_mode)
$f$;
-- 함수 부르기(plpgsql — 함수는 마이그레이션 뒤에 생긴다): 'OK {json}' 또는 'ERR …'
CREATE FUNCTION pg_temp.reorder(p_actor uuid, p_item uuid, p_ids uuid[], p_request jsonb DEFAULT '{"ip": "203.0.113.19", "user_agent": "rh19"}'::jsonb)
RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  RETURN pg_temp.try_json(format('SELECT public.reorder_market_item_subproducts(%L, %L, %L::uuid[], %L::jsonb)', p_actor, p_item, p_ids, p_request));
END $f$;
CREATE FUNCTION pg_temp.display_rev() RETURNS integer LANGUAGE sql AS $f$
  SELECT (value ->> 'revision')::integer FROM public.system_settings WHERE key = 'market_item_display'
$f$;
CREATE FUNCTION pg_temp.display_value() RETURNS jsonb LANGUAGE sql AS $f$
  SELECT value FROM public.system_settings WHERE key = 'market_item_display'
$f$;
CREATE FUNCTION pg_temp.save_display(p_actor uuid, p_value jsonb, p_revision integer DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  RETURN pg_temp.try_json(format('SELECT public.save_market_item_display(%L, %L, %L::jsonb, %L::jsonb)', p_actor,
    coalesce(p_revision, pg_temp.display_rev()), p_value, '{"ip": "203.0.113.19", "user_agent": "rh19"}'));
END $f$;
-- detail 을 한 키만 바꾼 값(p_path 는 jsonb_set 경로)
CREATE FUNCTION pg_temp.detail_with(p_path text[], p_value jsonb) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('detail', jsonb_set(pg_temp.display_value() -> 'detail', p_path, p_value))
$f$;
-- 서브상품 공개 읽기 순서(market-items-server: sort_order, created_at — 같으면 id)
CREATE FUNCTION pg_temp.public_order(p_item uuid) RETURNS uuid[] LANGUAGE sql AS $f$
  SELECT coalesce(array_agg(s.id ORDER BY s.sort_order, s.created_at, s.id), '{}') FROM public.market_item_subproducts s
   WHERE s.item_id = p_item AND s.deleted_at IS NULL
$f$;
-- 결제 판정(읽기만): 시험 상품 서브상품·전체구매. 줄 이름(optionTitle)을 뺀 값과 줄 이름을 따로 본다.
CREATE FUNCTION pg_temp.evaluate(p_user uuid, p_item uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT public.evaluate_market_targets(p_user,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('targetKind', 'subproduct', 'targetId', s.id) ORDER BY s.id), '[]'::jsonb)
       FROM public.market_item_subproducts s WHERE s.item_id = p_item AND s.deleted_at IS NULL)
    || (SELECT coalesce(jsonb_agg(jsonb_build_object('targetKind', 'bundle', 'targetId', b.id) ORDER BY b.id), '[]'::jsonb)
       FROM public.market_item_bundle_options b WHERE b.item_id = p_item))
$f$;
CREATE FUNCTION pg_temp.without_title(p_rows jsonb) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT coalesce(jsonb_agg(e - 'optionTitle' ORDER BY n), '[]'::jsonb) FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS a(e, n)
$f$;
-- 11번 동의(읽기만, 결제 함수는 부르지 않음): 장바구니 문구·지문과 2판 묶음
CREATE FUNCTION pg_temp.consent_snapshot() RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_policy jsonb := (SELECT value FROM public.system_settings WHERE key = 'market_purchase_policy');
BEGIN
  RETURN pg_temp.try_json(format('SELECT jsonb_build_object(''cart'', public.build_market_cart_texts(%L::jsonb), ''v2'', public.build_checkout_consent_v2(''market'', %L::jsonb, %s))',
    v_policy, v_policy, coalesce((v_policy ->> 'refundDays')::integer, 7)));
END $f$;

SELECT pg_temp.ctx_set('src_17', $rh_src_17$-- 출시 전 작업 순서표 17번 묶음: 상품 정보 입력 보완(계획 docs/plan-bundle17-product-info.md 2판, 5절).
-- 만드는 것:
--   1. 표 market_item_attribute_options(과목별 학년·자료유형·이용 근거 목록, 5-2). 첫 값은 두 과목 같게(11절 초안).
--   2. 표 market_item_usage_bases(상품별 원저작물 이용 근거, 내부 전용, 5-3). 회원 읽기 정책이 없는 별도 표다.
--      두 표 모두 RLS 켬·정책 0, PUBLIC·anon·authenticated·service_role 전부 회수 뒤 service_role 에 SELECT 만(쓰기는 아래 DEFINER 함수만).
--      행위자 칸(updated_by)은 FK 없는 uuid(관리자 계정을 지워도 기록이 남음 — 14번과 같음).
--   3. 설정 행 system_settings.market_item_display(검색·자료 보관함 필터 이름, 두 과목 공통 1행, revision 1 — 있으면 그대로, 5-4).
--   4. 함수(SECURITY DEFINER, search_path 고정, service_role 만 EXECUTE): market_catalog_actor_allowed·save_market_item_option·
--      reorder_market_item_options·save_market_item_usage_basis·save_market_item_display(5-5).
--   5. 잠금 트리거 함수 2개(표마다 따로): 서브상품 구성 slug·파일 유형 code·과목을 바꾸는 UPDATE 와 hard DELETE 를 역할 없이 거절(Q8).
--   6. 가입 트리거 handle_new_user 교체: avatar 메타데이터를 읽지 않고(profiles.avatar_url 은 늘 NULL) search_path 고정(Q9).
-- 계획과 다른 점(구현 메모): market_items 에는 (id, workspace_subject) UNIQUE 가 없어(운영 확인 2026-11-26, PK 만) 복합 FK 를 만들 수 없다.
--   그래서 이용 근거 표는 item_id → market_items(id) ON DELETE CASCADE 하나만 걸고, 과목 칸은 저장 함수가 상품 행에서 읽어 넣는다.
-- 기존 표에 거는 DDL(잠금): market_subproduct_categories·market_file_types 트리거 2개와 이용 근거 표의 market_items FK(SHARE ROW EXCLUSIVE).
--   모두 아래 '[17번 기존 표 DDL]' 한 구역에 모았다(리허설 light 사본은 이 구역과 그 VERIFY 블록을 뺀다). market_items 에 칸·FK 를 더하지 않는다.
-- 잠금 순서: 목록 쓰기 함수는 권한 확인 직후 pg_advisory_xact_lock(hashtext('market_item_options:' || 과목 || ':' || 종류)) 다음 행 잠금.
--   이용 근거는 상품별 advisory lock(같은 상품 첫 저장 두 건의 PK 충돌 방지), 표시 설정은 'market_item_display' advisory lock.
-- 사전 점검 지문: md5(pg_get_functiondef(oid))(2026-11-26 운영 읽기 전용 값, 계획 1절). 다르면 멈춘다.
-- 되돌리기: supabase/rollback/20261219100000_bundle17_product_info_down.sql(코드를 17번 전으로 되돌린 뒤).
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- 0. 사전 점검(5-1) -----------------------------------------------------------------------------------------------
DO $precheck_bundle17_product_info$
DECLARE
  v_new_functions text[] := ARRAY['market_catalog_actor_allowed', 'save_market_item_option', 'reorder_market_item_options',
    'save_market_item_usage_basis', 'save_market_item_display', 'guard_market_subproduct_category_identity', 'guard_market_file_type_identity'];
  v_subject text;
  v_value text;
BEGIN
  IF to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)') IS NULL
     OR md5(pg_get_functiondef(to_regprocedure('public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)')))
        <> 'a42b474d9d95753ffba5041acb0c1c77' THEN
    RAISE EXCEPTION 'PRECHECK: record_admin_audit changed';
  END IF;
  IF to_regprocedure('public.handle_new_user()') IS NULL
     OR md5(pg_get_functiondef('public.handle_new_user()'::regprocedure)) <> '61bc7b1469fb4dd6e795725040efe394' THEN
    RAISE EXCEPTION 'PRECHECK: handle_new_user changed (%)',
      CASE WHEN to_regprocedure('public.handle_new_user()') IS NULL THEN 'missing'
           ELSE md5(pg_get_functiondef('public.handle_new_user()'::regprocedure)) END;
  END IF;
  IF to_regclass('public.admin_permission_grants') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'admin_role')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'withdrawn_at') THEN
    RAISE EXCEPTION 'PRECHECK: admin_permission_grants / profiles.admin_role / profiles.withdrawn_at missing';
  END IF;
  IF to_regclass('public.market_item_attribute_options') IS NOT NULL OR to_regclass('public.market_item_usage_bases') IS NOT NULL THEN
    RAISE EXCEPTION 'PRECHECK: bundle 17 tables already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_new_functions)) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 17 functions already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal
              AND t.tgname IN ('guard_market_subproduct_category_identity', 'guard_market_file_type_identity')) THEN
    RAISE EXCEPTION 'PRECHECK: bundle 17 triggers already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'market_item_display') THEN
    RAISE EXCEPTION 'PRECHECK: market_item_display row already exists';
  END IF;
  -- 코드가 기대는 식별값(slug·code)이 두 과목 모두 있다
  FOREACH v_subject IN ARRAY ARRAY['korean', 'english'] LOOP
    FOREACH v_value IN ARRAY ARRAY['question_pdf', 'question_hwp'] LOOP
      IF NOT EXISTS (SELECT 1 FROM public.market_subproduct_categories c WHERE c.workspace_subject = v_subject AND c.slug = v_value) THEN
        RAISE EXCEPTION 'PRECHECK: market_subproduct_categories %/% missing', v_subject, v_value;
      END IF;
    END LOOP;
    FOREACH v_value IN ARRAY ARRAY['pdf', 'hwp', 'zip'] LOOP
      IF NOT EXISTS (SELECT 1 FROM public.market_file_types f WHERE f.workspace_subject = v_subject AND f.code = v_value) THEN
        RAISE EXCEPTION 'PRECHECK: market_file_types %/% missing', v_subject, v_value;
      END IF;
    END LOOP;
  END LOOP;
END;
$precheck_bundle17_product_info$;

-- [17번] 시작 ---------------------------------------------------------------------------------------------------
-- 1. 목록 표(5-2) — 학년·자료유형·이용 근거. 지우기는 없다(숨김만). 숨긴 항목도 이름을 차지한다. ---------------------------
CREATE TABLE public.market_item_attribute_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_subject text NOT NULL CHECK (workspace_subject IN ('korean', 'english')),
  kind text NOT NULL CHECK (kind IN ('grade', 'material_type', 'usage_basis')),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40 AND label !~ '^[[:space:]]|[[:space:]]$' AND label !~ '[[:cntrl:]]'),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  is_active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT market_item_attribute_options_label_unique UNIQUE (workspace_subject, kind, label)
);

COMMENT ON TABLE public.market_item_attribute_options IS
  '17번: 상품 학년·자료유형·이용 근거(내부) 목록(과목별). 쓰기는 save_market_item_option·reorder_market_item_options 함수만(service_role 은 SELECT 만).';

ALTER TABLE public.market_item_attribute_options ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.market_item_attribute_options FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.market_item_attribute_options TO service_role;

-- 첫 값(11절 초안, 두 과목 같게). 최종 이름은 대표가 '상품 표시 설정'에서 고친다.
INSERT INTO public.market_item_attribute_options (workspace_subject, kind, label, sort_order)
SELECT s.subject, o.kind, o.label, o.sort_order
  FROM (VALUES ('korean'), ('english')) AS s(subject)
  CROSS JOIN jsonb_to_recordset($json_bundle17_options$
[
  { "kind": "grade", "label": "1학년", "sort_order": 1 },
  { "kind": "grade", "label": "2학년", "sort_order": 2 },
  { "kind": "grade", "label": "3학년", "sort_order": 3 },
  { "kind": "grade", "label": "전체", "sort_order": 4 },
  { "kind": "material_type", "label": "수능특강", "sort_order": 1 },
  { "kind": "material_type", "label": "교과서", "sort_order": 2 },
  { "kind": "material_type", "label": "모의고사", "sort_order": 3 },
  { "kind": "material_type", "label": "부교재", "sort_order": 4 },
  { "kind": "usage_basis", "label": "자체 제작(원저작물 없음)", "sort_order": 1 },
  { "kind": "usage_basis", "label": "저작권자 이용 허락(계약·서면)", "sort_order": 2 },
  { "kind": "usage_basis", "label": "공개 이용 허락(공공누리·CC 등)", "sort_order": 3 },
  { "kind": "usage_basis", "label": "기타(메모에 근거)", "sort_order": 4 },
  { "kind": "usage_basis", "label": "확인 중", "sort_order": 5 }
]
$json_bundle17_options$::jsonb) AS o(kind text, label text, sort_order integer)
ON CONFLICT (workspace_subject, kind, label) DO NOTHING;

-- 2. 상품별 이용 근거(5-3, 내부 전용) — 상품 FK 는 아래 '[17번 기존 표 DDL]' 구역에서 건다. ---------------------------------
CREATE TABLE public.market_item_usage_bases (
  item_id uuid PRIMARY KEY,
  workspace_subject text NOT NULL CHECK (workspace_subject IN ('korean', 'english')),
  basis_option_id uuid NOT NULL REFERENCES public.market_item_attribute_options(id),
  note text CHECK (note IS NULL OR (char_length(note) BETWEEN 1 AND 2000)),
  evidence_ref text CHECK (evidence_ref IS NULL OR (char_length(evidence_ref) BETWEEN 1 AND 300 AND evidence_ref !~ '[[:cntrl:]]')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE public.market_item_usage_bases IS
  '17번: 상품별 원저작물 이용 근거(내부 전용 — 회원 읽기 정책 없음). 쓰기는 save_market_item_usage_basis 함수만(service_role 은 SELECT 만).';

ALTER TABLE public.market_item_usage_bases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.market_item_usage_bases FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.market_item_usage_bases TO service_role;

-- 3. 설정 행(5-4, 11절 초안) — 두 과목 공통 1행. 주소 키(type 등)는 코드에 두고 이름만 여기 둔다. ---------------------------------
INSERT INTO public.system_settings (key, value, description)
VALUES ('market_item_display', $json_market_item_display$
{
  "revision": 1,
  "facetLabels": { "category": "카테고리", "type": "구성", "year": "연도", "grade": "학년" },
  "libraryEmptyFilterHint": "검색어나 {type} 필터를 바꿔 보세요."
}
$json_market_item_display$::jsonb, '17번: 검색·자료 보관함 필터 이름(국어·영어 공통, 저장은 save_market_item_display 만)')
ON CONFLICT (key) DO NOTHING;

-- 4. 함수(5-5) ----------------------------------------------------------------------------------------------------
-- 4-1. 행위자 판정: 12번 member_suspension_actor_allowed 와 같은 꼴. admin_role 이 빈 관리자는 거절. 18·19번 함수도 이것을 쓴다.
CREATE FUNCTION public.market_catalog_actor_allowed(p_actor_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_market_catalog_actor_allowed$
  SELECT p_actor_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = p_actor_id AND p.is_admin IS TRUE AND p.withdrawn_at IS NULL
       AND (p.admin_role = 'owner'
            OR (p.admin_role = 'staff'
                AND EXISTS (SELECT 1 FROM public.admin_permission_grants g WHERE g.user_id = p.id AND g.permission = 'products.edit'))))
$fn_market_catalog_actor_allowed$;

-- 4-2. 목록 항목 저장(새 항목·고침). 순서: 요청 정보 → 행위자 → 과목·종류 → advisory lock → 행 FOR UPDATE(판·과목·종류) →
--      이름 다듬기·검사 → 중복 → 바뀐 것 없음이면 그대로 → 저장 → 이름이 바뀌면 그 값을 쓰는 상품도 바꿈 → 작업 기록(같은 거래).
--      오류: MARKET_OPTION_INPUT_INVALID:칸, MARKET_OPTION_NOT_FOUND, MARKET_OPTION_REVISION_CONFLICT, MARKET_OPTION_DUPLICATE.
CREATE FUNCTION public.save_market_item_option(p_actor_id uuid, p_id uuid, p_expected_revision integer, p_subject text, p_kind text,
  p_label text, p_is_active boolean, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_market_item_option$
DECLARE
  v_old public.market_item_attribute_options%ROWTYPE;
  v_new public.market_item_attribute_options%ROWTYPE;
  v_created boolean := p_id IS NULL;
  v_label text;
  v_renamed integer := 0;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'MARKET_OPTION_INPUT_INVALID:request';
  END IF;
  IF NOT public.market_catalog_actor_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'MARKET_CATALOG_ACTOR_NOT_ALLOWED';
  END IF;
  IF p_subject IS NULL OR p_subject NOT IN ('korean', 'english') THEN
    RAISE EXCEPTION 'MARKET_OPTION_INPUT_INVALID:subject';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('grade', 'material_type', 'usage_basis') THEN
    RAISE EXCEPTION 'MARKET_OPTION_INPUT_INVALID:kind';
  END IF;
  -- 잠금 순서: 권한 확인 직후, 행 FOR UPDATE·중복 검사·순서 계산보다 먼저
  PERFORM pg_advisory_xact_lock(hashtext('market_item_options:' || p_subject || ':' || p_kind));

  IF v_created THEN
    IF p_expected_revision IS NOT NULL THEN
      RAISE EXCEPTION 'MARKET_OPTION_INPUT_INVALID:revision';
    END IF;
  ELSE
    SELECT * INTO v_old FROM public.market_item_attribute_options WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'MARKET_OPTION_NOT_FOUND';
    END IF;
    -- 과목·종류는 바꾸지 못한다
    IF v_old.workspace_subject <> p_subject OR v_old.kind <> p_kind THEN
      RAISE EXCEPTION 'MARKET_OPTION_INPUT_INVALID:scope';
    END IF;
    IF p_expected_revision IS DISTINCT FROM v_old.revision THEN
      RAISE EXCEPTION 'MARKET_OPTION_REVISION_CONFLICT';
    END IF;
  END IF;

  -- 이름: 앞뒤 공백 정리(NFC), 1~40자, 제어 문자(줄바꿈 포함) 없음 — src/lib/market-item-options.ts 와 같은 규칙
  v_label := normalize(regexp_replace(COALESCE(p_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), NFC);
  IF v_label = '' OR char_length(v_label) > 40 OR v_label ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'MARKET_OPTION_INPUT_INVALID:label';
  END IF;
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'MARKET_OPTION_INPUT_INVALID:isActive';
  END IF;
  -- 같은 과목·종류에 같은 이름(숨김 포함)이 있으면 거절
  IF EXISTS (SELECT 1 FROM public.market_item_attribute_options o
              WHERE o.workspace_subject = p_subject AND o.kind = p_kind AND o.label = v_label AND o.id IS DISTINCT FROM p_id) THEN
    RAISE EXCEPTION 'MARKET_OPTION_DUPLICATE';
  END IF;

  IF NOT v_created AND v_old.label = v_label AND v_old.is_active = p_is_active THEN
    RETURN jsonb_build_object('changed', false, 'created', false, 'id', v_old.id, 'revision', v_old.revision, 'renamedItemCount', 0);
  END IF;

  IF v_created THEN
    INSERT INTO public.market_item_attribute_options (workspace_subject, kind, label, sort_order, is_active, revision, updated_by, created_at, updated_at)
    VALUES (p_subject, p_kind, v_label,
      COALESCE((SELECT max(o.sort_order) FROM public.market_item_attribute_options o WHERE o.workspace_subject = p_subject AND o.kind = p_kind), 0) + 1,
      p_is_active, 1, p_actor_id, v_now, v_now)
    RETURNING * INTO v_new;
  ELSE
    UPDATE public.market_item_attribute_options
       SET label = v_label, is_active = p_is_active, revision = revision + 1, updated_by = p_actor_id, updated_at = v_now
     WHERE id = p_id
    RETURNING * INTO v_new;
    -- 이름을 바꾸면 그 값을 쓰는 상품도 바꾼다(행 잠금만). 이용 근거 목록은 상품 칸이 아니라 id 로 이어져 있어 건드리지 않는다.
    IF v_old.label <> v_label THEN
      IF p_kind = 'grade' THEN
        UPDATE public.market_items SET grade_level = v_label WHERE workspace_subject = p_subject AND grade_level = v_old.label;
        GET DIAGNOSTICS v_renamed = ROW_COUNT;
      ELSIF p_kind = 'material_type' THEN
        UPDATE public.market_items SET source_type = v_label WHERE workspace_subject = p_subject AND source_type = v_old.label;
        GET DIAGNOSTICS v_renamed = ROW_COUNT;
      END IF;
    END IF;
  END IF;

  PERFORM public.record_admin_audit(p_actor_id, 'market_item_option_save', 'market_item_option', v_new.id::text, NULL, NULL, NULL,
    jsonb_build_object(
      'subject', p_subject,
      'kind', p_kind,
      'option_id', v_new.id,
      'created', v_created,
      'revision_before', v_old.revision,
      'revision_after', v_new.revision,
      'before', CASE WHEN v_created THEN NULL ELSE jsonb_build_object('label', v_old.label, 'is_active', v_old.is_active) END,
      'after', jsonb_build_object('label', v_new.label, 'is_active', v_new.is_active),
      'renamed_item_count', v_renamed,
      'request', p_request_meta,
      'saved_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true, 'created', v_created, 'id', v_new.id, 'revision', v_new.revision, 'renamedItemCount', v_renamed);
END;
$fn_save_market_item_option$;

-- 4-3. 목록 순서: id 집합이 그 과목·종류 전체(숨김 포함)와 정확히 같아야 한다(빠짐·더함·중복·다른 과목 → MARKET_OPTION_REORDER_MISMATCH).
--      판(revision)은 바꾸지 않는다(이름·사용 여부 편집과 겹치지 않음).
CREATE FUNCTION public.reorder_market_item_options(p_actor_id uuid, p_subject text, p_kind text, p_ids uuid[], p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_reorder_market_item_options$
DECLARE
  v_before uuid[];
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'MARKET_OPTION_INPUT_INVALID:request';
  END IF;
  IF NOT public.market_catalog_actor_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'MARKET_CATALOG_ACTOR_NOT_ALLOWED';
  END IF;
  IF p_subject IS NULL OR p_subject NOT IN ('korean', 'english') THEN
    RAISE EXCEPTION 'MARKET_OPTION_INPUT_INVALID:subject';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('grade', 'material_type', 'usage_basis') THEN
    RAISE EXCEPTION 'MARKET_OPTION_INPUT_INVALID:kind';
  END IF;
  -- 잠금 순서: 권한 확인 직후, 행 FOR UPDATE 보다 먼저(항목 저장과 같은 잠금)
  PERFORM pg_advisory_xact_lock(hashtext('market_item_options:' || p_subject || ':' || p_kind));

  IF p_ids IS NULL OR cardinality(p_ids) = 0 OR cardinality(p_ids) > 200 OR array_position(p_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'MARKET_OPTION_INPUT_INVALID:ids';
  END IF;

  PERFORM 1 FROM public.market_item_attribute_options o WHERE o.workspace_subject = p_subject AND o.kind = p_kind FOR UPDATE;
  SELECT COALESCE(array_agg(o.id ORDER BY o.sort_order, o.id), '{}') INTO v_before
    FROM public.market_item_attribute_options o
   WHERE o.workspace_subject = p_subject AND o.kind = p_kind;

  IF cardinality(p_ids) <> cardinality(v_before)
     OR (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> cardinality(p_ids)
     OR (SELECT array_agg(x ORDER BY x) FROM unnest(p_ids) x) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(v_before) x) THEN
    RAISE EXCEPTION 'MARKET_OPTION_REORDER_MISMATCH';
  END IF;
  IF p_ids = v_before THEN
    RETURN jsonb_build_object('changed', false);
  END IF;

  UPDATE public.market_item_attribute_options o
     SET sort_order = r.ord, updated_by = p_actor_id, updated_at = v_now
    FROM unnest(p_ids) WITH ORDINALITY AS r(id, ord)
   WHERE o.id = r.id AND o.sort_order IS DISTINCT FROM r.ord;

  PERFORM public.record_admin_audit(p_actor_id, 'market_item_option_reorder', 'market_item_option', p_subject || ':' || p_kind, NULL, NULL, NULL,
    jsonb_build_object(
      'subject', p_subject,
      'kind', p_kind,
      'ids_before', to_jsonb(v_before),
      'ids_after', to_jsonb(p_ids),
      'request', p_request_meta,
      'reordered_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true);
END;
$fn_reorder_market_item_options$;

-- 4-4. 상품별 이용 근거 저장(새로·고침). 상품 행을 FOR SHARE 로 잠가 과목을 읽는다. 근거 항목은 같은 과목·usage_basis 종류여야 하고,
--      숨긴 항목은 지금 근거와 같을 때만 그대로 둘 수 있다. 메모는 늘 선택이다(Q5 — '기타' 같은 항목의 필수 여부를 코드에 두지 않음).
--      기록에는 before·after 전문(회사 내부 업무 기록, 칸 옆에 '개인정보는 넣지 마세요' 안내).
CREATE FUNCTION public.save_market_item_usage_basis(p_actor_id uuid, p_item_id uuid, p_expected_revision integer, p_basis_option_id uuid,
  p_note text, p_evidence_ref text, p_request_meta jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $fn_save_market_item_usage_basis$
DECLARE
  v_subject text;
  v_option public.market_item_attribute_options%ROWTYPE;
  v_old public.market_item_usage_bases%ROWTYPE;
  v_new public.market_item_usage_bases%ROWTYPE;
  v_old_label text;
  v_created boolean;
  v_note text;
  v_evidence text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_request_meta IS NULL OR jsonb_typeof(p_request_meta) <> 'object' THEN
    RAISE EXCEPTION 'MARKET_USAGE_BASIS_INPUT_INVALID:request';
  END IF;
  IF NOT public.market_catalog_actor_allowed(p_actor_id) THEN
    RAISE EXCEPTION 'MARKET_CATALOG_ACTOR_NOT_ALLOWED';
  END IF;
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'MARKET_USAGE_BASIS_INPUT_INVALID:itemId';
  END IF;
  -- 잠금 순서: 권한 확인 직후 상품별 advisory lock → 상품 행 FOR SHARE → 근거 항목 FOR SHARE → 근거 행 FOR UPDATE
  PERFORM pg_advisory_xact_lock(hashtext('market_item_usage_basis:' || p_item_id::text));

  SELECT i.workspace_subject INTO v_subject FROM public.market_items i WHERE i.id = p_item_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MARKET_ITEM_NOT_FOUND';
  END IF;

  SELECT * INTO v_option FROM public.market_item_attribute_options o WHERE o.id = p_basis_option_id FOR SHARE;
  IF NOT FOUND OR v_option.workspace_subject <> v_subject OR v_option.kind <> 'usage_basis' THEN
    RAISE EXCEPTION 'MARKET_USAGE_BASIS_INPUT_INVALID:basisOptionId';
  END IF;

  SELECT * INTO v_old FROM public.market_item_usage_bases b WHERE b.item_id = p_item_id FOR UPDATE;
  v_created := NOT FOUND;
  IF v_created THEN
    IF p_expected_revision IS NOT NULL THEN
      RAISE EXCEPTION 'MARKET_USAGE_BASIS_REVISION_CONFLICT';
    END IF;
  ELSIF p_expected_revision IS DISTINCT FROM v_old.revision THEN
    RAISE EXCEPTION 'MARKET_USAGE_BASIS_REVISION_CONFLICT';
  END IF;

  -- 숨긴 근거 항목은 새로 고를 수 없다(지금 근거와 같으면 그대로 둠)
  IF NOT v_option.is_active AND (v_created OR v_old.basis_option_id <> v_option.id) THEN
    RAISE EXCEPTION 'MARKET_USAGE_BASIS_INPUT_INVALID:basisOptionId';
  END IF;

  -- 메모: 앞뒤 공백 정리(줄바꿈 허용), 0~2000자. 증빙 위치: 한 줄, 0~300자. 빈 값은 NULL.
  v_note := NULLIF(regexp_replace(replace(replace(COALESCE(p_note, ''), E'\r\n', E'\n'), E'\r', E'\n'), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  IF v_note IS NOT NULL AND char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'MARKET_USAGE_BASIS_INPUT_INVALID:note';
  END IF;
  v_evidence := NULLIF(regexp_replace(COALESCE(p_evidence_ref, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  IF v_evidence IS NOT NULL AND (char_length(v_evidence) > 300 OR v_evidence ~ '[[:cntrl:]]') THEN
    RAISE EXCEPTION 'MARKET_USAGE_BASIS_INPUT_INVALID:evidenceRef';
  END IF;

  IF NOT v_created AND v_old.basis_option_id = v_option.id AND v_old.note IS NOT DISTINCT FROM v_note
     AND v_old.evidence_ref IS NOT DISTINCT FROM v_evidence AND v_old.workspace_subject = v_subject THEN
    RETURN jsonb_build_object('changed', false, 'created', false, 'revision', v_old.revision);
  END IF;

  IF v_created THEN
    INSERT INTO public.market_item_usage_bases (item_id, workspace_subject, basis_option_id, note, evidence_ref, revision, updated_by, updated_at)
    VALUES (p_item_id, v_subject, v_option.id, v_note, v_evidence, 1, p_actor_id, v_now)
    RETURNING * INTO v_new;
  ELSE
    SELECT o.label INTO v_old_label FROM public.market_item_attribute_options o WHERE o.id = v_old.basis_option_id;
    UPDATE public.market_item_usage_bases
       SET workspace_subject = v_subject, basis_option_id = v_option.id, note = v_note, evidence_ref = v_evidence,
           revision = revision + 1, updated_by = p_actor_id, updated_at = v_now
     WHERE item_id = p_item_id
    RETURNING * INTO v_new;
  END IF;

  PERFORM public.record_admin_audit(p_actor_id, 'market_item_usage_basis_save', 'market_item', p_item_id::text, NULL, NULL, NULL,
    jsonb_build_object(
      'item_id', p_item_id,
      'subject', v_subject,
      'created', v_created,
      'revision_before', v_old.revision,
      'revision_after', v_new.revision,
      'before', CASE WHEN v_created THEN NULL ELSE jsonb_build_object('basis_option_id', v_old.basis_option_id, 'basis_label', v_old_label,
                  'note', v_old.note, 'evidence_ref', v_old.evidence_ref) END,
      'after', jsonb_build_object('basis_option_id', v_new.basis_option_id, 'basis_label', v_option.label,
                  'note', v_new.note, 'evidence_ref', v_new.evidence_ref),
      'request', p_request_meta,
      'saved_at', v_now),
    NULL);

  RETURN jsonb_build_object('changed', true, 'created', v_created, 'revision', v_new.revision);
END;
$fn_save_market_item_usage_basis$;

-- 4-5. 표시 설정 저장(관리자 '검색 필터 이름' 탭, 두 과목 공통 행): 판 비교, 필수 키(MARKET_ITEM_DISPLAY_REQUIRED_KEYS 와 같은 목록) 빈 값 거부,
--      칸별 상한(필터 이름 1~20자 한 줄·{type} 없음, 보관함 안내 1~60자 한 줄·{type} 은 이 칸에서만). 이 함수는 17번 키만 다시 만들고
--      설정 행의 다른 키는 저장된 값 그대로 둔다(19번이 더하는 키는 19번 함수가 다룬다).
CREATE FUNCTION public.save_market_item_display(p_actor_id uuid, p_expected_revision integer, p_value jsonb, p_request_meta jsonb)
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

-- 4-6. 식별값 잠금 트리거 함수(표마다 따로 — 한 함수에서 OLD.slug·OLD.code 를 함께 쓰면 없는 칸 오류로 정상 UPDATE 까지 막힌다).
--      UPDATE 는 식별 칸(slug·code)·과목이 바뀔 때, DELETE 는 늘 거절한다. 역할을 가리지 않는다(Q8 — service_role·postgres 포함).
--      이름·설명·순서·사용 여부·deleted_at 은 그대로 고칠 수 있다. 꼭 바꿔야 하면 새벽에 트리거를 잠깐 끄는 런북 절차(계획 13절 7).
CREATE FUNCTION public.guard_market_subproduct_category_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_market_subproduct_category_identity$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'MARKET_IDENTIFIER_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.slug IS DISTINCT FROM OLD.slug OR NEW.workspace_subject IS DISTINCT FROM OLD.workspace_subject THEN
    RAISE EXCEPTION 'MARKET_IDENTIFIER_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn_guard_market_subproduct_category_identity$;

CREATE FUNCTION public.guard_market_file_type_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $fn_guard_market_file_type_identity$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'MARKET_IDENTIFIER_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.code IS DISTINCT FROM OLD.code OR NEW.workspace_subject IS DISTINCT FROM OLD.workspace_subject THEN
    RAISE EXCEPTION 'MARKET_IDENTIFIER_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn_guard_market_file_type_identity$;

-- 4-7. 함수 권한: PUBLIC·anon·authenticated(와 기본 권한으로 받은 service_role)을 회수한 뒤 service_role 만 EXECUTE. 트리거 함수는 아무도.
REVOKE ALL ON FUNCTION public.market_catalog_actor_allowed(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_market_item_option(uuid, uuid, integer, text, text, text, boolean, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reorder_market_item_options(uuid, text, text, uuid[], jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_market_item_usage_basis(uuid, uuid, integer, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_market_item_display(uuid, integer, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_market_subproduct_category_identity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_market_file_type_identity() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.market_catalog_actor_allowed(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_market_item_option(uuid, uuid, integer, text, text, text, boolean, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reorder_market_item_options(uuid, text, text, uuid[], jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_market_item_usage_basis(uuid, uuid, integer, uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_market_item_display(uuid, integer, jsonb, jsonb) TO service_role;

-- 5. 가입 트리거 교체(5-5, 4번 계획 0절 ②의 남은 일): avatar 메타데이터(avatar_url·picture·kakao_account.profile.profile_image_url)를
--    읽지 않는다(profiles.avatar_url 은 칸 기본값 NULL). 나머지 글자는 그대로 두고 search_path 만 고정한다(Q9).
--    함수 안은 모두 public. 을 붙였거나 내장 함수라 동작이 같다. 옛 정의 전문은 down 파일에 있다. 권한(proacl)은 CREATE OR REPLACE 가 그대로 둔다.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_provider text;
  v_kakao_id text;
  v_kakao_email text;
  v_phone text;
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

  v_signup_completed := case when v_provider = 'kakao' then false else true end;

  insert into public.profiles (
    id,
    email,
    phone,
    kakao_id,
    kakao_email,
    provider,
    signup_completed
  )
  values (
    new.id,
    coalesce(new.email, v_kakao_email),
    v_phone,
    v_kakao_id,
    v_kakao_email,
    v_provider,
    v_signup_completed
  );

  return new;
end;
$function$;

-- 6. [17번 기존 표 DDL] 시작 — 짧은 잠금(새벽, lock_timeout 3초). 리허설 light 사본은 이 구역과 아래 VERIFY 블록을 뺀다. ------------
--    이용 근거 → 상품 FK(market_items 에 SHARE ROW EXCLUSIVE — 읽기는 막지 않음). 이력 없는 상품을 완전 삭제하면 근거도 함께 지워진다.
ALTER TABLE public.market_item_usage_bases
  ADD CONSTRAINT market_item_usage_bases_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.market_items(id) ON DELETE CASCADE;
--    식별값 잠금 트리거(BEFORE UPDATE OF 식별 칸·과목 OR DELETE). 앱 삭제는 deleted_at UPDATE 라 영향이 없다.
CREATE TRIGGER guard_market_subproduct_category_identity
  BEFORE UPDATE OF slug, workspace_subject OR DELETE ON public.market_subproduct_categories
  FOR EACH ROW EXECUTE FUNCTION public.guard_market_subproduct_category_identity();
CREATE TRIGGER guard_market_file_type_identity
  BEFORE UPDATE OF code, workspace_subject OR DELETE ON public.market_file_types
  FOR EACH ROW EXECUTE FUNCTION public.guard_market_file_type_identity();
-- [17번 기존 표 DDL] 끝 -------------------------------------------------------------------------------------------

-- 7. VERIFY(5-6) ---------------------------------------------------------------------------------------------------
DO $verify_bundle17_product_info$
DECLARE
  v_rel text;
  v_fn text;
  v_value jsonb;
  v_key text;
  v_src text;
  v_functions text[] := ARRAY[
    'public.market_catalog_actor_allowed(uuid)',
    'public.save_market_item_option(uuid,uuid,integer,text,text,text,boolean,jsonb)',
    'public.reorder_market_item_options(uuid,text,text,uuid[],jsonb)',
    'public.save_market_item_usage_basis(uuid,uuid,integer,uuid,text,text,jsonb)',
    'public.save_market_item_display(uuid,integer,jsonb,jsonb)'];
BEGIN
  -- 표 2개: RLS·정책 0·권한 = service_role SELECT 만(anon·authenticated·PUBLIC 0)
  FOREACH v_rel IN ARRAY ARRAY['public.market_item_attribute_options', 'public.market_item_usage_bases'] LOOP
    IF to_regclass(v_rel) IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_rel))
       OR (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid = to_regclass(v_rel)) <> 0
       OR NOT has_table_privilege('service_role', v_rel, 'SELECT')
       OR has_table_privilege('service_role', v_rel, 'INSERT') OR has_table_privilege('service_role', v_rel, 'UPDATE')
       OR has_table_privilege('service_role', v_rel, 'DELETE') OR has_table_privilege('service_role', v_rel, 'TRUNCATE')
       OR has_table_privilege('anon', v_rel, 'SELECT') OR has_table_privilege('anon', v_rel, 'INSERT')
       OR has_table_privilege('authenticated', v_rel, 'SELECT') OR has_table_privilege('authenticated', v_rel, 'INSERT')
       OR has_table_privilege('authenticated', v_rel, 'UPDATE') OR has_table_privilege('authenticated', v_rel, 'DELETE')
       OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = to_regclass(v_rel) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'VERIFY: % table / RLS / privileges', v_rel;
    END IF;
  END LOOP;
  -- CHECK·UNIQUE·FK: 목록 표는 FK 0·UNIQUE 1, 근거 표는 목록 표를 가리키는 FK 1개(상품 FK 는 아래 기존 표 블록이 본다)
  IF (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.market_item_attribute_options'::regclass AND c.contype = 'c') <> 5
     OR (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.market_item_attribute_options'::regclass AND c.contype = 'u') <> 1
     OR (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.market_item_attribute_options'::regclass AND c.contype = 'f') <> 0
     OR (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.market_item_usage_bases'::regclass AND c.contype = 'c') <> 4
     OR (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.market_item_usage_bases'::regclass AND c.contype = 'f'
           AND c.confrelid = 'public.market_item_attribute_options'::regclass) <> 1
     OR EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.market_item_usage_bases'::regclass AND c.contype = 'f'
           AND c.confrelid NOT IN ('public.market_item_attribute_options'::regclass, 'public.market_items'::regclass)) THEN
    RAISE EXCEPTION 'VERIFY: bundle 17 CHECK / UNIQUE / FK';
  END IF;
  -- 함수 5개: SECURITY DEFINER·search_path·EXECUTE 는 service_role 만. 트리거 함수 2개는 아무도, search_path 고정.
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF to_regprocedure(v_fn) IS NULL
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn)) IS NOT TRUE
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig))
       OR NOT has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_fn) AND a.grantee = 0) THEN
      RAISE EXCEPTION 'VERIFY: % SECURITY DEFINER / search_path / EXECUTE', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY['public.guard_market_subproduct_category_identity()', 'public.guard_market_file_type_identity()'] LOOP
    IF to_regprocedure(v_fn) IS NULL
       OR has_function_privilege('service_role', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(v_fn) AND 'search_path=public, pg_temp' = ANY (p.proconfig)) THEN
      RAISE EXCEPTION 'VERIFY: % guard function privileges / search_path', v_fn;
    END IF;
  END LOOP;
  -- 첫 값: 두 과목 같음(종류·이름·순서)
  IF (SELECT array_agg(o.kind || ':' || o.label || ':' || o.sort_order ORDER BY o.kind, o.sort_order, o.label)
        FROM public.market_item_attribute_options o WHERE o.workspace_subject = 'korean')
     IS DISTINCT FROM
     (SELECT array_agg(o.kind || ':' || o.label || ':' || o.sort_order ORDER BY o.kind, o.sort_order, o.label)
        FROM public.market_item_attribute_options o WHERE o.workspace_subject = 'english')
     OR (SELECT count(DISTINCT o.kind) FROM public.market_item_attribute_options o) <> 3 THEN
    RAISE EXCEPTION 'VERIFY: seed options differ between subjects';
  END IF;
  -- 지금 상품의 비지 않은 학년·자료유형 값이 모두 그 과목 목록에 있다(빠지면 적용 실패)
  SELECT i.workspace_subject || ':' || COALESCE(i.grade_level, '') || '/' || COALESCE(i.source_type, '') INTO v_key
    FROM public.market_items i
   WHERE (NULLIF(i.grade_level, '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.market_item_attribute_options o
            WHERE o.workspace_subject = i.workspace_subject AND o.kind = 'grade' AND o.label = i.grade_level))
      OR (NULLIF(i.source_type, '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.market_item_attribute_options o
            WHERE o.workspace_subject = i.workspace_subject AND o.kind = 'material_type' AND o.label = i.source_type))
   LIMIT 1;
  IF v_key IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY: product value missing from seed options (%)', v_key;
  END IF;
  -- 설정 행: revision·필수 키(MARKET_ITEM_DISPLAY_REQUIRED_KEYS)·상한
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'market_item_display';
  IF v_value IS NULL OR jsonb_typeof(v_value -> 'revision') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'VERIFY: market_item_display shape';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['category', 'type', 'year', 'grade'] LOOP
    IF jsonb_typeof(v_value -> 'facetLabels' -> v_key) IS DISTINCT FROM 'string' OR btrim(v_value -> 'facetLabels' ->> v_key) = ''
       OR char_length(v_value -> 'facetLabels' ->> v_key) > 20 THEN
      RAISE EXCEPTION 'VERIFY: market_item_display facetLabels.%', v_key;
    END IF;
  END LOOP;
  IF jsonb_typeof(v_value -> 'libraryEmptyFilterHint') IS DISTINCT FROM 'string' OR btrim(v_value ->> 'libraryEmptyFilterHint') = ''
     OR char_length(v_value ->> 'libraryEmptyFilterHint') > 60 THEN
    RAISE EXCEPTION 'VERIFY: market_item_display libraryEmptyFilterHint';
  END IF;
  -- 가입 트리거: avatar 글자 없음·search_path 고정·SECURITY DEFINER·트리거가 이 함수를 가리킴
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = 'public.handle_new_user()'::regprocedure;
  IF strpos(lower(v_src), 'avatar') > 0
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'public.handle_new_user()'::regprocedure AND 'search_path=public, pg_temp' = ANY (p.proconfig))
     OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.handle_new_user()'::regprocedure) IS NOT TRUE
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_created'
                     AND t.tgfoid = 'public.handle_new_user()'::regprocedure) THEN
    RAISE EXCEPTION 'VERIFY: handle_new_user';
  END IF;
END;
$verify_bundle17_product_info$;

-- 기존 표 DDL 확인(light 사본은 이 블록을 뺀다): 상품 FK(CASCADE)·잠금 트리거 2개가 있고 사용 중
DO $verify_bundle17_existing_tables$
BEGIN
  IF (SELECT count(*) FROM pg_constraint c WHERE c.conrelid = 'public.market_item_usage_bases'::regclass AND c.contype = 'f'
        AND c.confrelid = 'public.market_items'::regclass AND c.confdeltype = 'c') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: market_item_usage_bases → market_items FK (CASCADE)';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.market_subproduct_categories'::regclass AND NOT t.tgisinternal
        AND t.tgenabled = 'O' AND t.tgname = 'guard_market_subproduct_category_identity'
        AND t.tgfoid = 'public.guard_market_subproduct_category_identity()'::regprocedure) <> 1
     OR (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.market_file_types'::regclass AND NOT t.tgisinternal
        AND t.tgenabled = 'O' AND t.tgname = 'guard_market_file_type_identity'
        AND t.tgfoid = 'public.guard_market_file_type_identity()'::regprocedure) <> 1 THEN
    RAISE EXCEPTION 'VERIFY: identity guard triggers';
  END IF;
END;
$verify_bundle17_existing_tables$;

NOTIFY pgrst, 'reload schema';
$rh_src_17$);
SELECT pg_temp.ctx_set('src_17_down', $rh_src_17_down$-- 17번 묶음 되돌리기(supabase/migrations/20261219100000_bundle17_product_info.sql 의 down). 계획 docs/plan-bundle17-product-info.md 5-6.
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
$rh_src_17_down$);
SELECT pg_temp.ctx_set('src_18', $rh_src_18$-- 출시 전 작업 순서표 18번 묶음: 상품 업로드 개선(계획 docs/plan-bundle18-product-upload.md 3판, 6절).
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
$rh_src_18$);
SELECT pg_temp.ctx_set('src_migration', $rh_src_migration$-- 출시 전 작업 순서표 19번 묶음: 상품 표시 설정(계획 docs/plan-bundle19-product-display.md 2판, 4절).
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
$rh_src_migration$);
SELECT pg_temp.ctx_set('src_down', $rh_src_down$-- 19번 묶음 되돌리기(supabase/migrations/20261221100000_bundle19_product_display.sql 의 down). 계획 docs/plan-bundle19-product-display.md 4-6.
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
$rh_src_down$);
SELECT pg_temp.ctx_set('src_label', $rh_src_label$DO $bundle19_bundle_label$
DECLARE
  -- [실행 직전 채움] ---------------------------------------------------------------------------------------------
  c_actor_id constant uuid := pg_temp.uid('owner');
  c_expected_count constant integer := (SELECT count(*)::integer FROM public.market_item_bundle_options WHERE label = '전체 한번에 구매하기');
  c_expected_ids_md5 constant text := (SELECT md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) FROM public.market_item_bundle_options WHERE label = '전체 한번에 구매하기');
  -- -------------------------------------------------------------------------------------------------------------
  c_old_label constant text := '전체 한번에 구매하기';
  c_new_label constant text := '전체 패키지';
  v_ids uuid[];
  v_updated integer;
BEGIN
  IF c_actor_id IS NULL OR c_expected_count IS NULL OR c_expected_ids_md5 IS NULL THEN
    RAISE EXCEPTION 'BUNDLE_LABEL: fill c_actor_id / c_expected_count / c_expected_ids_md5 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner' AND p.withdrawn_at IS NULL) THEN
    RAISE EXCEPTION 'BUNDLE_LABEL: c_actor_id is not an active owner';
  END IF;

  -- 대상 행을 잠그고 센다(id 순서로 잠가 다른 거래와 엇갈리지 않게)
  SELECT coalesce(array_agg(b.id ORDER BY b.id), '{}') INTO v_ids
    FROM (SELECT o.id FROM public.market_item_bundle_options o WHERE o.label = c_old_label ORDER BY o.id FOR UPDATE) b;
  IF cardinality(v_ids) <> c_expected_count
     OR md5(coalesce(array_to_string(v_ids, ','), '')) <> c_expected_ids_md5 THEN
    RAISE EXCEPTION 'BUNDLE_LABEL: target rows changed (now % rows) — count again and refill the constants', cardinality(v_ids);
  END IF;
  IF cardinality(v_ids) = 0 THEN
    RAISE NOTICE 'BUNDLE_LABEL: nothing to change';
    RETURN;
  END IF;

  PERFORM public.record_admin_audit(c_actor_id, 'market_bundle_label_bulk_update', 'market_item_bundle_options', 'bulk', NULL, NULL, NULL,
    jsonb_build_object('mode', 'apply', 'ids', to_jsonb(v_ids), 'old_label', c_old_label, 'new_label', c_new_label, 'count', cardinality(v_ids)),
    NULL);
  -- updated_at 은 표의 기존 트리거(trg_market_item_bundle_options_updated_at)가 바꾼다(표시만, 금액·판정과 무관)
  UPDATE public.market_item_bundle_options o SET label = c_new_label WHERE o.id = ANY (v_ids) AND o.label = c_old_label;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- VERIFY: 대상 0건, 바뀐 건수 = 기록 건수
  IF EXISTS (SELECT 1 FROM public.market_item_bundle_options o WHERE o.id = ANY (v_ids) AND o.label = c_old_label)
     OR v_updated <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'BUNDLE_LABEL VERIFY: updated % of % rows', v_updated, cardinality(v_ids);
  END IF;
  RAISE NOTICE 'BUNDLE_LABEL: % rows → %', v_updated, c_new_label;
END
$bundle19_bundle_label$;$rh_src_label$);
SELECT pg_temp.ctx_set('src_label_raw', $rh_src_label_raw$DO $bundle19_bundle_label$
DECLARE
  -- [실행 직전 채움] ---------------------------------------------------------------------------------------------
  c_actor_id constant uuid := NULL;
  c_expected_count constant integer := NULL;
  c_expected_ids_md5 constant text := NULL;
  -- -------------------------------------------------------------------------------------------------------------
  c_old_label constant text := '전체 한번에 구매하기';
  c_new_label constant text := '전체 패키지';
  v_ids uuid[];
  v_updated integer;
BEGIN
  IF c_actor_id IS NULL OR c_expected_count IS NULL OR c_expected_ids_md5 IS NULL THEN
    RAISE EXCEPTION 'BUNDLE_LABEL: fill c_actor_id / c_expected_count / c_expected_ids_md5 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner' AND p.withdrawn_at IS NULL) THEN
    RAISE EXCEPTION 'BUNDLE_LABEL: c_actor_id is not an active owner';
  END IF;

  -- 대상 행을 잠그고 센다(id 순서로 잠가 다른 거래와 엇갈리지 않게)
  SELECT coalesce(array_agg(b.id ORDER BY b.id), '{}') INTO v_ids
    FROM (SELECT o.id FROM public.market_item_bundle_options o WHERE o.label = c_old_label ORDER BY o.id FOR UPDATE) b;
  IF cardinality(v_ids) <> c_expected_count
     OR md5(coalesce(array_to_string(v_ids, ','), '')) <> c_expected_ids_md5 THEN
    RAISE EXCEPTION 'BUNDLE_LABEL: target rows changed (now % rows) — count again and refill the constants', cardinality(v_ids);
  END IF;
  IF cardinality(v_ids) = 0 THEN
    RAISE NOTICE 'BUNDLE_LABEL: nothing to change';
    RETURN;
  END IF;

  PERFORM public.record_admin_audit(c_actor_id, 'market_bundle_label_bulk_update', 'market_item_bundle_options', 'bulk', NULL, NULL, NULL,
    jsonb_build_object('mode', 'apply', 'ids', to_jsonb(v_ids), 'old_label', c_old_label, 'new_label', c_new_label, 'count', cardinality(v_ids)),
    NULL);
  -- updated_at 은 표의 기존 트리거(trg_market_item_bundle_options_updated_at)가 바꾼다(표시만, 금액·판정과 무관)
  UPDATE public.market_item_bundle_options o SET label = c_new_label WHERE o.id = ANY (v_ids) AND o.label = c_old_label;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- VERIFY: 대상 0건, 바뀐 건수 = 기록 건수
  IF EXISTS (SELECT 1 FROM public.market_item_bundle_options o WHERE o.id = ANY (v_ids) AND o.label = c_old_label)
     OR v_updated <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'BUNDLE_LABEL VERIFY: updated % of % rows', v_updated, cardinality(v_ids);
  END IF;
  RAISE NOTICE 'BUNDLE_LABEL: % rows → %', v_updated, c_new_label;
END
$bundle19_bundle_label$;$rh_src_label_raw$);
SELECT pg_temp.ctx_set('src_label_revert', $rh_src_label_revert$DO $bundle19_bundle_label_revert$
DECLARE
  -- [실행 직전 채움] ---------------------------------------------------------------------------------------------
  c_actor_id constant uuid := pg_temp.uid('owner');
  -- -------------------------------------------------------------------------------------------------------------
  c_applied_label constant text := '전체 패키지';
  c_restore_label constant text := '전체 한번에 구매하기';
  v_last_revert timestamptz;
  v_applied uuid[];
  v_ids uuid[];
  v_kept uuid[];
  v_updated integer;
BEGIN
  IF c_actor_id IS NULL THEN
    RAISE EXCEPTION 'BUNDLE_LABEL_REVERT: fill c_actor_id first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c_actor_id AND p.is_admin IS TRUE AND p.admin_role = 'owner' AND p.withdrawn_at IS NULL) THEN
    RAISE EXCEPTION 'BUNDLE_LABEL_REVERT: c_actor_id is not an active owner';
  END IF;

  SELECT max(a.created_at) INTO v_last_revert
    FROM public.admin_audit_log a WHERE a.action = 'market_bundle_label_bulk_update' AND a.details ->> 'mode' = 'revert';
  SELECT coalesce(array_agg(DISTINCT t.x::uuid ORDER BY t.x::uuid), '{}') INTO v_applied
    FROM public.admin_audit_log a CROSS JOIN LATERAL jsonb_array_elements_text(a.details -> 'ids') AS t(x)
   WHERE a.action = 'market_bundle_label_bulk_update' AND a.details ->> 'mode' = 'apply'
     AND (v_last_revert IS NULL OR a.created_at > v_last_revert);
  IF cardinality(v_applied) = 0 THEN
    RAISE EXCEPTION 'BUNDLE_LABEL_REVERT: no apply record to revert';
  END IF;

  -- 지금도 새 글자인 행만(행 잠금), 나머지는 남긴다
  SELECT coalesce(array_agg(b.id ORDER BY b.id), '{}') INTO v_ids
    FROM (SELECT o.id FROM public.market_item_bundle_options o
           WHERE o.id = ANY (v_applied) AND o.label = c_applied_label ORDER BY o.id FOR UPDATE) b;
  SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO v_kept FROM unnest(v_applied) x WHERE NOT (x = ANY (v_ids));

  PERFORM public.record_admin_audit(c_actor_id, 'market_bundle_label_bulk_update', 'market_item_bundle_options', 'bulk', NULL, NULL, NULL,
    jsonb_build_object('mode', 'revert', 'ids', to_jsonb(v_ids), 'kept_ids', to_jsonb(v_kept),
      'old_label', c_applied_label, 'new_label', c_restore_label, 'count', cardinality(v_ids)),
    NULL);
  UPDATE public.market_item_bundle_options o SET label = c_restore_label WHERE o.id = ANY (v_ids) AND o.label = c_applied_label;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'BUNDLE_LABEL_REVERT VERIFY: updated % of % rows', v_updated, cardinality(v_ids);
  END IF;
  RAISE NOTICE 'BUNDLE_LABEL_REVERT: % rows restored, % rows kept (changed by admin in between)', v_updated, cardinality(v_kept);
END
$bundle19_bundle_label_revert$;$rh_src_label_revert$);
SELECT pg_temp.ctx_set('old_label', '전체 한번에 구매하기');
SELECT pg_temp.ctx_set('mode', 'full');

-- ===== 17·18번(앞 묶음) — 없으면 17·18번 원본을 같은 거래에 넣는다 =====
DO $rh_apply_previous$
BEGIN
  IF to_regprocedure('public.market_catalog_actor_allowed(uuid)') IS NULL THEN
    PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_17')), 'OK', 'setup', '17번 사본 적용');
    INSERT INTO _rh_log (test, msg) VALUES ('setup', '17번 미적용 — 17번 사본을 먼저 넣음');
  ELSE
    INSERT INTO _rh_log (test, msg) VALUES ('setup', '17번 적용됨 — 건너뜀');
  END IF;
  IF to_regprocedure('public.duplicate_market_item(uuid,text,uuid,text,jsonb)') IS NULL THEN
    PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_18')), 'OK', 'setup', '18번 원본 적용');
    INSERT INTO _rh_log (test, msg) VALUES ('setup', '18번 미적용 — 18번 원본을 먼저 넣음');
  ELSE
    INSERT INTO _rh_log (test, msg) VALUES ('setup', '18번 적용됨 — 건너뜀');
  END IF;
  -- 19번 적용 전(17번 상태) 값: R1 down 대조용
  PERFORM pg_temp.ctx_set('s0_value', (SELECT value::text FROM public.system_settings WHERE key = 'market_item_display'));
  PERFORM pg_temp.ctx_set('s0_fp', md5(pg_get_functiondef('public.save_market_item_display(uuid,integer,jsonb,jsonb)'::regprocedure)));
  INSERT INTO _rh_log (test, msg, payload) VALUES ('setup', '19번 적용 전 save_market_item_display 지문',
    jsonb_build_object('fp', pg_temp.ctx('s0_fp'), 'expected', '5cd1e1f548bd73aea05f5845a0212a6a'));
END
$rh_apply_previous$;

DO $rh_before$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_k jsonb;
  v_n integer;
  v_rev integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
  v_s1 uuid := pg_temp.uid('s1');
  v_s2 uuid := pg_temp.uid('s2');
  v_s3 uuid := pg_temp.uid('s3');
  v_sd uuid := pg_temp.uid('sd');
  v_b1 uuid := pg_temp.uid('b1');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK:', 'F0', '적용 전 down 멈춤');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261221100000'), 'F0', '이력 행 없음');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'F0', m FROM unnest(v_log) m;
END
$rh_before$;

-- ===== 19번 마이그레이션(원본 그대로 — 설정 행 UPDATE·함수, 기존 표 DDL 없음) =====
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


INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261221100000', 'bundle19_product_display');

-- ===== 계정(@test.com 시험 계정 4개)·시험 자료(거래 안에서 새로 만듦) =====
DO $rh_setup$
DECLARE
  v_pool uuid[];
  v_c1 uuid;
  v_c2 uuid;
  v_c3 uuid;
  v_a uuid;
  v_b uuid;
  v_s1 uuid;
  v_s2 uuid;
  v_s3 uuid;
  v_sd uuid;
  v_b1 uuid;
  v_ft uuid;
  v_t timestamptz := now() - interval '1 day';
BEGIN
  SELECT coalesce(array_agg(p.id ORDER BY u.created_at), '{}') INTO v_pool
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.email LIKE '%@test.com' AND p.withdrawn_at IS NULL AND p.is_admin IS NOT TRUE AND p.signup_completed IS TRUE;
  IF cardinality(v_pool) < 4 THEN
    RAISE EXCEPTION 'RH FAIL [setup] @test.com 시험 계정이 모자람(%개, 필요 4) — 실회원 id 로 대신하지 않고 멈춘다', cardinality(v_pool);
  END IF;
  PERFORM pg_temp.ctx_set('owner', v_pool[1]::text);
  PERFORM pg_temp.ctx_set('staff', v_pool[2]::text);
  PERFORM pg_temp.ctx_set('E', v_pool[3]::text);
  PERFORM pg_temp.ctx_set('X', v_pool[4]::text);
  UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = v_pool[1];
  UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = v_pool[2];
  PERFORM pg_temp.expect(pg_temp.grants(v_pool[1], v_pool[2], ARRAY['products.edit']), 'OK', 'setup', '직원에게 products.edit');

  -- 서브상품 구성 3개(국어, 모두 사용) — 한 상품에 같은 구성의 사용 중 서브상품은 하나라서 구성을 나눈다
  INSERT INTO public.market_subproduct_categories (workspace_subject, name, slug, is_active, sort_order)
  VALUES ('korean', 'rh19 구성 1', 'rh19-c1', true, 900) RETURNING id INTO v_c1;
  INSERT INTO public.market_subproduct_categories (workspace_subject, name, slug, is_active, sort_order)
  VALUES ('korean', 'rh19 구성 2', 'rh19-c2', true, 901) RETURNING id INTO v_c2;
  INSERT INTO public.market_subproduct_categories (workspace_subject, name, slug, is_active, sort_order)
  VALUES ('korean', 'rh19 구성 3', 'rh19-c3', true, 902) RETURNING id INTO v_c3;

  -- 상품 A: 공개. 서브상품 s1(사용, 0)·s2(사용 안 함, 0)·s3(사용, 1)·sd(지움). 판매 파일 1개(s1). 전체구매(옛 글자).
  INSERT INTO public.market_items (workspace_subject, subject_code, category_item_id, title, status, draft_source, is_active, published_at,
    created_by, updated_by, created_at, updated_at)
  VALUES ('korean', 'korean', (SELECT c.id FROM public.market_category_items c WHERE c.workspace_subject = 'korean' ORDER BY c.id LIMIT 1),
    'rh19 상품 A', 'published', 'manual', true, v_t, v_pool[1], v_pool[1], v_t, v_t)
  RETURNING id INTO v_a;
  INSERT INTO public.market_item_subproducts (item_id, workspace_subject, category_id, title, price_credits, is_active, sort_order, created_at, updated_at)
  VALUES (v_a, 'korean', v_c1, 'rh19 s1', 1000, true, 0, v_t, v_t) RETURNING id INTO v_s1;
  INSERT INTO public.market_item_subproducts (item_id, workspace_subject, category_id, title, price_credits, is_active, sort_order, created_at, updated_at)
  VALUES (v_a, 'korean', v_c2, 'rh19 s2', 2000, false, 0, v_t + interval '1 minute', v_t + interval '1 minute') RETURNING id INTO v_s2;
  INSERT INTO public.market_item_subproducts (item_id, workspace_subject, category_id, title, price_credits, is_active, sort_order, created_at, updated_at)
  VALUES (v_a, 'korean', v_c3, 'rh19 s3', 3000, true, 1, v_t, v_t) RETURNING id INTO v_s3;
  INSERT INTO public.market_item_subproducts (item_id, workspace_subject, category_id, title, price_credits, is_active, sort_order, created_at, updated_at, deleted_at)
  VALUES (v_a, 'korean', v_c1, 'rh19 sd(지움)', 4000, false, 5, v_t, v_t, now()) RETURNING id INTO v_sd;
  SELECT f.id INTO v_ft FROM public.market_file_types f WHERE f.workspace_subject = 'korean' AND f.code = 'pdf' AND f.deleted_at IS NULL LIMIT 1;
  IF v_ft IS NULL THEN
    RAISE EXCEPTION 'RH FAIL [setup] 국어 pdf 파일 유형이 없다';
  END IF;
  INSERT INTO public.market_subproduct_files (item_id, subproduct_id, workspace_subject, file_type_id, original_file_name, storage_bucket, storage_path)
  VALUES (v_a, v_s1, 'korean', v_ft, 'rh19.pdf', 'market-files', 'rh19/never-uploaded.pdf');
  INSERT INTO public.market_item_bundle_options (item_id, workspace_subject, label, price_credits, is_active, created_at, updated_at)
  VALUES (v_a, 'korean', pg_temp.ctx('old_label'), 3500, true, v_t, v_t);

  -- 상품 B: 서브상품 b1 하나(다른 상품 서브상품 섞기 시험), 전체구매(옛 글자 — 되돌림 사이에 관리자가 고칠 행)
  INSERT INTO public.market_items (workspace_subject, subject_code, title, status, draft_source, created_by, updated_by)
  VALUES ('korean', 'korean', 'rh19 상품 B', 'draft', 'manual', v_pool[1], v_pool[1]) RETURNING id INTO v_b;
  INSERT INTO public.market_item_subproducts (item_id, workspace_subject, category_id, title, price_credits, is_active, sort_order)
  VALUES (v_b, 'korean', v_c1, 'rh19 b1', 500, true, 0) RETURNING id INTO v_b1;
  INSERT INTO public.market_item_bundle_options (item_id, workspace_subject, label, price_credits, is_active)
  VALUES (v_b, 'korean', pg_temp.ctx('old_label'), 400, true);

  PERFORM pg_temp.ctx_set('A', v_a::text);
  PERFORM pg_temp.ctx_set('B', v_b::text);
  PERFORM pg_temp.ctx_set('s1', v_s1::text);
  PERFORM pg_temp.ctx_set('s2', v_s2::text);
  PERFORM pg_temp.ctx_set('s3', v_s3::text);
  PERFORM pg_temp.ctx_set('sd', v_sd::text);
  PERFORM pg_temp.ctx_set('b1', v_b1::text);
  INSERT INTO _rh_log (test, msg, payload) VALUES ('setup', '시험 계정(@test.com)·시험 상품 2개(rh19)',
    jsonb_build_object('pool', cardinality(v_pool), 'A_public_order', to_jsonb(pg_temp.public_order(v_a))));
END
$rh_setup$;

DO $rh_r1$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_k jsonb;
  v_n integer;
  v_rev integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
  v_s1 uuid := pg_temp.uid('s1');
  v_s2 uuid := pg_temp.uid('s2');
  v_s3 uuid := pg_temp.uid('s3');
  v_sd uuid := pg_temp.uid('sd');
  v_b1 uuid := pg_temp.uid('b1');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK:', 'R1', '다시 적용 거절');
    v_log := v_log || pg_temp.ensure(NOT has_function_privilege('anon', 'public.reorder_market_item_subproducts(uuid,uuid,uuid[],jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.reorder_market_item_subproducts(uuid,uuid,uuid[],jsonb)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.reorder_market_item_subproducts(uuid,uuid,uuid[],jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.save_market_item_display(uuid,integer,jsonb,jsonb)', 'EXECUTE'), 'R1', 'EXECUTE 는 service_role 만');
    v_log := v_log || pg_temp.ensure(pg_temp.ctx('s0_fp') = '5cd1e1f548bd73aea05f5845a0212a6a', 'R1', '적용 전 지문 = 사전 점검 상수');
    v_log := v_log || pg_temp.ensure(pg_temp.display_rev() = (pg_temp.ctx('s0_value')::jsonb ->> 'revision')::integer + 1
      AND (pg_temp.display_value() - 'revision' - 'detail') = (pg_temp.ctx('s0_value')::jsonb - 'revision'), 'R1', '판 +1, 17번 키 그대로');
    v_log := v_log || pg_temp.ensure(current_setting('bundle19.revision_before')::integer = (pg_temp.ctx('s0_value')::jsonb ->> 'revision')::integer
      AND pg_temp.display_rev() = current_setting('bundle19.revision_before')::integer + 1, 'R1', 'VERIFY 의 적용 전 판 보관 = 17번 상태 판(정확히 +1)');
    v_log := v_log || pg_temp.ensure(pg_temp.display_value() -> 'detail' -> 'sampleDescription' = to_jsonb('샘플 {장수}장을 미리 볼 수 있어요.'::text)
      AND jsonb_array_length(pg_temp.display_value() -> 'detail' -> 'infoItems') = 6, 'R1', '첫 값(샘플 문장·infoItems 6개)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_17_down')), 'ERR DOWN PRECHECK: bundle 18/19 functions exist', 'R1', '19번 상태에서 17번 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'R1', 'down');
    v_log := v_log || pg_temp.ensure(to_regprocedure('public.reorder_market_item_subproducts(uuid,uuid,uuid[],jsonb)') IS NULL
      AND md5(pg_get_functiondef('public.save_market_item_display(uuid,integer,jsonb,jsonb)'::regprocedure)) = '5cd1e1f548bd73aea05f5845a0212a6a'
      AND (pg_temp.display_value() - 'revision') = (pg_temp.ctx('s0_value')::jsonb - 'revision')
      AND pg_temp.display_rev() = (pg_temp.ctx('s0_value')::jsonb ->> 'revision')::integer + 2, 'R1', 'down → 17번 상태(행 값·함수 지문, 판 +2)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK:', 'R1', '없을 때 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'R1', '다시 적용(VERIFY 통과)');
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
  v_k jsonb;
  v_n integer;
  v_rev integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
  v_s1 uuid := pg_temp.uid('s1');
  v_s2 uuid := pg_temp.uid('s2');
  v_s3 uuid := pg_temp.uid('s3');
  v_sd uuid := pg_temp.uid('sd');
  v_b1 uuid := pg_temp.uid('b1');
BEGIN
  BEGIN

    v_rev := pg_temp.display_rev();
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, jsonb_build_object('detail', pg_temp.display_value() -> 'detail')), 'OK {"changed": false', 'R2', '같은 값 저장 → 바뀐 것 없음');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_staff, pg_temp.detail_with('{sampleTitle}', '"  rh19 제목  "')), 'OK {"changed": true', 'R2', '직원 detail 저장');
    v_log := v_log || pg_temp.ensure(pg_temp.display_rev() = v_rev + 1 AND pg_temp.display_value() -> 'detail' ->> 'sampleTitle' = 'rh19 제목', 'R2', '판 +1, 앞뒤 공백 정리');
    v_k := pg_temp.display_value();
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, jsonb_build_object('facetLabels', v_k -> 'facetLabels' || '{"type": "rh19 구성"}', 'libraryEmptyFilterHint', v_k -> 'libraryEmptyFilterHint')), 'OK {"changed": true', 'R2', '17번 키만 저장');
    v_log := v_log || pg_temp.ensure(pg_temp.display_value() -> 'detail' = v_k -> 'detail' AND pg_temp.display_value() -> 'facetLabels' ->> 'type' = 'rh19 구성', 'R2', '17번 키만 → detail 그대로');
    v_k := pg_temp.display_value();
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{bundleDefaultTitle}', '"rh19 묶음"')), 'OK {"changed": true', 'R2', 'detail 만 저장');
    v_log := v_log || pg_temp.ensure(pg_temp.display_value() -> 'facetLabels' = v_k -> 'facetLabels'
      AND pg_temp.display_value() -> 'libraryEmptyFilterHint' = v_k -> 'libraryEmptyFilterHint', 'R2', 'detail 만 → 17번 키 그대로');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{sampleButton}', '"샘플 {장수}장"')), 'OK', 'R2', '받는 키의 {장수} 허용');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, jsonb_build_object('detail', jsonb_set(pg_temp.display_value() -> 'detail', '{infoItems}',
      (SELECT jsonb_agg(e) FROM jsonb_array_elements(pg_temp.display_value() -> 'detail' -> 'infoItems') WITH ORDINALITY AS a(e, n) WHERE n > 1)))),
      'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.infoItems', 'R2', 'infoItems 빠짐 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{infoItems,1,key}', '"subject"')),
      'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.infoItems', 'R2', 'infoItems 겹침 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{infoItems,1,key}', '"publisher"')),
      'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.infoItems', 'R2', 'infoItems 모르는 key 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{infoItems,0,visible}', '"yes"')),
      'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.infoItems.visible', 'R2', 'visible 은 true/false');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{sampleDescription}', '"샘플 {페이지}장"')),
      'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.sampleDescription', 'R2', '모르는 자리표시 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{sampleTitle}', '"샘플 {장수}장"')),
      'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.sampleTitle', 'R2', '받지 않는 키의 {장수} 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{bundleDefaultTitle}', '"{type} 묶음"')),
      'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.bundleDefaultTitle', 'R2', 'detail 의 {type} 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{hwpPdfNoticeText}', to_jsonb(repeat('가', 201)))),
      'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.hwpPdfNoticeText', 'R2', '201자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{hwpPdfNoticeText}', to_jsonb(repeat('가', 200)))), 'OK', 'R2', '200자 허용');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{sampleRowButton}', to_jsonb(repeat('가', 31)))),
      'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.sampleRowButton', 'R2', '짧은 글 31자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{sampleTitle}', to_jsonb(E'샘플\n제목'::text))),
      'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.sampleTitle', 'R2', '줄바꿈 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{summaryLabels,unknown}', '" "')),
      'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.summaryLabels.unknown', 'R2', '빈 요약 이름 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, '{}'::jsonb), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:value', 'R2', '빈 값 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, '{"revision": 9}'::jsonb), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:value', 'R2', '모르는 최상위 키 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{sampleTitle}', '"rh19 충돌"'), pg_temp.display_rev() - 1),
      'ERR MARKET_ITEM_DISPLAY_REVISION_CONFLICT', 'R2', '판 충돌');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_e, pg_temp.detail_with('{sampleTitle}', '"rh19 회원"')), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'R2', '일반 회원 거절');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_item_display_update') = 5
      AND pg_temp.audit_keys_ok('market_item_display_update', ARRAY['after', 'before', 'request', 'revision_after', 'revision_before', 'saved_at']::text[]), 'R2', '성공 5건만 기록·details 키');
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
  v_k jsonb;
  v_n integer;
  v_rev integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
  v_s1 uuid := pg_temp.uid('s1');
  v_s2 uuid := pg_temp.uid('s2');
  v_s3 uuid := pg_temp.uid('s3');
  v_sd uuid := pg_temp.uid('sd');
  v_b1 uuid := pg_temp.uid('b1');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, v_a, ARRAY[v_s3, v_s1, v_s2]), 'OK {"changed": true', 'R3', '대표 성공(사용 안 함 포함)');
    v_log := v_log || pg_temp.ensure((SELECT array_agg(s.sort_order ORDER BY s.sort_order) FROM public.market_item_subproducts s
      WHERE s.item_id = v_a AND s.deleted_at IS NULL) = ARRAY[10, 20, 30]
      AND (SELECT s.sort_order FROM public.market_item_subproducts s WHERE s.id = v_s3) = 10
      AND (SELECT s.sort_order FROM public.market_item_subproducts s WHERE s.id = v_sd) = 5, 'R3', '10·20·30, 지운 서브상품은 그대로');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_staff, v_a, ARRAY[v_s3, v_s1, v_s2]), 'OK {"changed": false', 'R3', '같은 순서 다시 저장 → 바뀐 것 없음');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_staff, v_a, ARRAY[v_s1, v_s3, v_s2]), 'OK {"changed": true', 'R3', 'products.edit 직원 성공');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_e, v_a, ARRAY[v_s1, v_s3, v_s2]), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'R3', '일반 회원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(NULL, v_a, ARRAY[v_s1, v_s3, v_s2]), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'R3', '행위자 없음 거절');
    UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = v_x;
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_x, ARRAY['content.manage']), 'OK', 'R3', 'content.manage 만 주기');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_x, v_a, ARRAY[v_s1, v_s3, v_s2]), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'R3', '권한 없는 직원 거절');
    UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = v_x;
    PERFORM set_config('app.member_withdrawal_bypass', v_x::text, true);
    UPDATE public.profiles SET withdrawn_at = now() WHERE id = v_x;
    PERFORM set_config('app.member_withdrawal_bypass', '', true);
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_x, v_a, ARRAY[v_s1, v_s3, v_s2]), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'R3', '탈퇴한 대표 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, v_a, ARRAY[v_s1, v_s3]), 'ERR MARKET_SUBPRODUCT_REORDER_MISMATCH', 'R3', '빠짐 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, v_a, ARRAY[v_s1, v_s3, v_s2, v_b1]), 'ERR MARKET_SUBPRODUCT_REORDER_MISMATCH', 'R3', '더함 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, v_a, ARRAY[v_s1, v_s3, v_b1]), 'ERR MARKET_SUBPRODUCT_REORDER_MISMATCH', 'R3', '다른 상품 서브상품 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, v_a, ARRAY[v_s1, v_s3, v_sd]), 'ERR MARKET_SUBPRODUCT_REORDER_MISMATCH', 'R3', '지운 서브상품 넣기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, v_a, ARRAY[v_s1, v_s1, v_s3]), 'ERR MARKET_SUBPRODUCT_REORDER_MISMATCH', 'R3', '겹침 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, v_a, ARRAY[v_s1, NULL, v_s3]::uuid[]), 'ERR MARKET_SUBPRODUCT_REORDER_INPUT_INVALID:ids', 'R3', 'NULL id 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, v_a, ARRAY[]::uuid[]), 'ERR MARKET_SUBPRODUCT_REORDER_INPUT_INVALID:ids', 'R3', '빈 목록 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, v_a, ARRAY[v_s1, v_s3, v_s2], NULL), 'ERR MARKET_SUBPRODUCT_REORDER_INPUT_INVALID:request', 'R3', '요청 정보 필수');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, gen_random_uuid(), ARRAY[v_s1]), 'ERR MARKET_ITEM_NOT_FOUND', 'R3', '없는 상품');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_subproduct_reorder') = 2
      AND pg_temp.audit_keys_ok('market_subproduct_reorder', ARRAY['after', 'before', 'item_id', 'request']::text[])
      AND EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action = 'market_subproduct_reorder' AND a.created_at >= now()
        AND a.actor_id = v_owner AND a.target_type = 'market_item' AND a.target_id = v_a::text
        AND a.details -> 'before' = to_jsonb(ARRAY[v_s1, v_s2, v_s3]) AND a.details -> 'after' = to_jsonb(ARRAY[v_s3, v_s1, v_s2])),
      'R3', '성공 2건만 기록(같은 순서는 기록 없음)·before/after');
    UPDATE public.market_items SET deleted_at = now() WHERE id = v_a;
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, v_a, ARRAY[v_s1, v_s3, v_s2]), 'ERR MARKET_ITEM_NOT_FOUND', 'R3', '지운 상품 거절');
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
  v_k jsonb;
  v_n integer;
  v_rev integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
  v_s1 uuid := pg_temp.uid('s1');
  v_s2 uuid := pg_temp.uid('s2');
  v_s3 uuid := pg_temp.uid('s3');
  v_sd uuid := pg_temp.uid('sd');
  v_b1 uuid := pg_temp.uid('b1');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure(pg_temp.public_order(v_a) = ARRAY[v_s1, v_s2, v_s3], 'R4', '저장 전 공개 순서(0·0·1, 같은 값은 만든 순서)');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, v_a, ARRAY[v_s2, v_s3, v_s1]), 'OK', 'R4', '순서 저장');
    v_log := v_log || pg_temp.ensure(pg_temp.public_order(v_a) = ARRAY[v_s2, v_s3, v_s1], 'R4', '공개 읽기 = 새 순서');
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
  v_k jsonb;
  v_n integer;
  v_rev integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
  v_s1 uuid := pg_temp.uid('s1');
  v_s2 uuid := pg_temp.uid('s2');
  v_s3 uuid := pg_temp.uid('s3');
  v_sd uuid := pg_temp.uid('sd');
  v_b1 uuid := pg_temp.uid('b1');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_label_raw')), 'ERR BUNDLE_LABEL: fill', 'R5', '상수가 비면 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(replace(pg_temp.ctx('src_label'), 'c_expected_count constant integer := (', 'c_expected_count constant integer := 1 + (')),
      'ERR BUNDLE_LABEL: target rows changed', 'R5', '건수가 다르면 멈춤');
    SELECT count(*)::integer INTO v_n FROM public.market_item_bundle_options WHERE label = pg_temp.ctx('old_label');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_label')), 'OK', 'R5', '실행(대상 ' || v_n || '건)');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM public.market_item_bundle_options WHERE label = pg_temp.ctx('old_label'))
      AND (SELECT count(*) FROM public.market_item_bundle_options WHERE item_id IN (v_a, v_b) AND label = '전체 패키지') = 2, 'R5', '대상 0건, 시험 행 2개 새 글자');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_bundle_label_bulk_update') = 1
      AND pg_temp.audit_keys_ok('market_bundle_label_bulk_update', ARRAY['count', 'ids', 'mode', 'new_label', 'old_label']::text[], 'apply')
      AND (SELECT (a.details ->> 'count')::integer = v_n AND jsonb_array_length(a.details -> 'ids') = v_n FROM public.admin_audit_log a
            WHERE a.action = 'market_bundle_label_bulk_update' AND a.created_at >= now()), 'R5', '기록 1건, 건수 = 바뀐 수');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_label')), 'OK', 'R5', '두 번째 실행(대상 0 — 바꿀 것 없음)');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_bundle_label_bulk_update') = 1, 'R5', '대상 0이면 기록 없음');
    UPDATE public.market_item_bundle_options SET label = 'rh19 관리자가 고친 이름' WHERE item_id = v_b;
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_label_revert')), 'OK', 'R5', '되돌림');
    v_log := v_log || pg_temp.ensure((SELECT label FROM public.market_item_bundle_options WHERE item_id = v_a) = pg_temp.ctx('old_label')
      AND (SELECT label FROM public.market_item_bundle_options WHERE item_id = v_b) = 'rh19 관리자가 고친 이름'
      AND (SELECT count(*) FROM public.market_item_bundle_options WHERE label = pg_temp.ctx('old_label')) = v_n - 1, 'R5', '되돌림 → 원래 글자, 그 사이 고친 행은 남김');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_bundle_label_bulk_update') = 2
      AND pg_temp.audit_keys_ok('market_bundle_label_bulk_update', ARRAY['count', 'ids', 'kept_ids', 'mode', 'new_label', 'old_label']::text[], 'revert')
      AND EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action = 'market_bundle_label_bulk_update' AND a.created_at >= now()
        AND a.details ->> 'mode' = 'revert' AND a.details -> 'kept_ids' = to_jsonb(ARRAY[(SELECT id FROM public.market_item_bundle_options WHERE item_id = v_b)])
        AND (a.details ->> 'count')::integer = v_n - 1), 'R5', '되돌림 기록 1건(남긴 행 id)');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R5', m FROM unnest(v_log) m;
END
$rh_r5$;

DO $rh_r6$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_k jsonb;
  v_n integer;
  v_rev integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
  v_s1 uuid := pg_temp.uid('s1');
  v_s2 uuid := pg_temp.uid('s2');
  v_s3 uuid := pg_temp.uid('s3');
  v_sd uuid := pg_temp.uid('sd');
  v_b1 uuid := pg_temp.uid('b1');
BEGIN
  BEGIN

    v_j := pg_temp.evaluate(v_e, v_a);
    v_r := pg_temp.consent_snapshot();
    v_log := v_log || pg_temp.ensure((SELECT e ->> 'optionTitle' FROM jsonb_array_elements(v_j) e WHERE e ->> 'targetKind' = 'bundle') = pg_temp.ctx('old_label'),
      'R6', '스크립트 전 묶음 줄 이름 = 옛 글자');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_label')), 'OK', 'R6', '표시명 스크립트');
    v_k := pg_temp.evaluate(v_e, v_a);
    v_log := v_log || pg_temp.ensure(pg_temp.without_title(v_j) = pg_temp.without_title(v_k), 'R6', '판정 값(가격·살 수 있음·사유) 같음');
    v_log := v_log || pg_temp.ensure((SELECT e ->> 'optionTitle' FROM jsonb_array_elements(v_k) e WHERE e ->> 'targetKind' = 'bundle') = '전체 패키지',
      'R6', '묶음 줄 이름만 새 글자');
    v_log := v_log || pg_temp.ensure(pg_temp.consent_snapshot() = v_r, 'R6', '동의 문구·지문(장바구니·2판) 글자까지 같음');
    -- 경우 안의 INSERT 는 격리로 되돌려지므로 근거는 v_log 글로 남긴다
    v_log := v_log || ('묶음 판정 전 ' || (SELECT (e - 'targetId' - 'itemId' - 'workspaceSubject')::text FROM jsonb_array_elements(v_j) e WHERE e ->> 'targetKind' = 'bundle'));
    v_log := v_log || ('묶음 판정 뒤 ' || (SELECT (e - 'targetId' - 'itemId' - 'workspaceSubject')::text FROM jsonb_array_elements(v_k) e WHERE e ->> 'targetKind' = 'bundle'));
    v_log := v_log || ('동의 묶음(앞부분) ' || left(v_r, 200));
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'R6', m FROM unnest(v_log) m;
END
$rh_r6$;

DO $rh_f$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_k jsonb;
  v_n integer;
  v_rev integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
  v_s1 uuid := pg_temp.uid('s1');
  v_s2 uuid := pg_temp.uid('s2');
  v_s3 uuid := pg_temp.uid('s3');
  v_sd uuid := pg_temp.uid('sd');
  v_b1 uuid := pg_temp.uid('b1');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'F', 'down 원본');
    DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261221100000';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'F', '이력 행 지운 뒤 다시 적용');
    INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261221100000', 'bundle19_product_display');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, v_a, ARRAY[v_s3, v_s1, v_s2]), 'OK', 'F', '다시 적용 뒤 순서 저장');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'F', m FROM unnest(v_log) m;
END
$rh_f$;

DO $rh_leftover$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_k jsonb;
  v_n integer;
  v_rev integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
  v_s1 uuid := pg_temp.uid('s1');
  v_s2 uuid := pg_temp.uid('s2');
  v_s3 uuid := pg_temp.uid('s3');
  v_sd uuid := pg_temp.uid('sd');
  v_b1 uuid := pg_temp.uid('b1');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_subproduct_reorder') = 0 AND pg_temp.audit_count('market_bundle_label_bulk_update') = 0
      AND pg_temp.audit_count('market_item_display_update') = 0
      AND (SELECT count(*) FROM public.market_item_bundle_options WHERE label = pg_temp.ctx('old_label') AND item_id IN (v_a, v_b)) = 2
      AND pg_temp.public_order(v_a) = ARRAY[v_s1, v_s2, v_s3], 'Z', '경우 밖에 남은 기록·바뀐 행 0(ROLLBACK 전)');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'Z', m FROM unnest(v_log) m;
END
$rh_leftover$;

SELECT n, test, msg, payload FROM _rh_log ORDER BY n;
ROLLBACK;
