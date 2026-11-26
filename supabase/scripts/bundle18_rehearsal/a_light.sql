-- 18번 묶음 리허설: A light — 17번 사본(없으면) + 18번 원본, 경우 D0~D9
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle18_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle18_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: 지금(낮) 돌려도 됨: 함수 하나 만들기(표 잠금 없음)·기존 표에는 새 행 INSERT 만·시험 계정 행 UPDATE. 이력 표는 쓰지 않는다.
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
CREATE FUNCTION pg_temp.audit_ok(p_action text, p_keys text[]) RETURNS boolean LANGUAGE sql AS $f$
  SELECT count(*) > 0 AND bool_and(a.reason IS NULL
     AND ARRAY(SELECT k FROM jsonb_object_keys(a.details) k ORDER BY k COLLATE "C") = p_keys
     AND jsonb_typeof(a.details -> 'request') = 'object')
    FROM public.admin_audit_log a WHERE a.action = p_action AND a.created_at >= now()
$f$;
-- 복제 함수 부르기(plpgsql — 함수는 마이그레이션 뒤에 생긴다): 'OK {json}' 또는 'ERR …'
CREATE FUNCTION pg_temp.dup(p_actor uuid, p_subject text, p_item uuid, p_mode text, p_request jsonb DEFAULT '{"ip": "203.0.113.18", "user_agent": "rh18"}'::jsonb)
RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  RETURN pg_temp.try_json(format('SELECT public.duplicate_market_item(%L, %L, %L, %L, %L::jsonb)', p_actor, p_subject, p_item, p_mode, p_request));
END $f$;
-- 서브상품을 원본 공개 읽기 순서(sort_order, created_at — 같으면 id)로 펼친 글
CREATE FUNCTION pg_temp.subs(p_item uuid) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT coalesce(jsonb_agg(jsonb_build_object('title', s.title, 'category_id', s.category_id, 'price', s.price_credits, 'active', s.is_active,
    'description', s.description, 'notice_label', s.purchase_notice_label, 'notice_text', s.purchase_notice_text)
    ORDER BY s.sort_order, s.created_at, s.id), '[]'::jsonb)
    FROM public.market_item_subproducts s WHERE s.item_id = p_item AND s.deleted_at IS NULL
$f$;

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


NOTIFY pgrst, 'reload schema';
$rh_src_17$);
SELECT pg_temp.ctx_set('src_migration', $rh_src_migration$-- 출시 전 작업 순서표 18번 묶음: 상품 업로드 개선(계획 docs/plan-bundle18-product-upload.md 3판, 6절).
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
$rh_src_migration$);
SELECT pg_temp.ctx_set('src_down', $rh_src_down$-- 18번 묶음 되돌리기(supabase/migrations/20261220100000_bundle18_product_duplicate.sql 의 down). 계획 docs/plan-bundle18-product-upload.md 6-3.
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
$rh_src_down$);
SELECT pg_temp.ctx_set('mode', 'light');

-- ===== 17번(앞 묶음) — 없으면 light 사본(기존 표 DDL 구역을 뺌)을 같은 거래에 넣는다 =====
DO $rh_apply_17$
BEGIN
  IF to_regprocedure('public.market_catalog_actor_allowed(uuid)') IS NULL THEN
    PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_17')), 'OK', 'setup', '17번 사본 적용');
    INSERT INTO _rh_log (test, msg) VALUES ('setup', '17번 미적용 — 17번 사본을 먼저 넣음');
  ELSE
    INSERT INTO _rh_log (test, msg) VALUES ('setup', '17번 적용됨 — 건너뜀');
  END IF;
END
$rh_apply_17$;

-- ===== 18번 마이그레이션(원본 그대로 — 함수 하나, 기존 표 DDL 없음) =====
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


-- ===== 계정(@test.com 시험 계정 4개)·시험 자료(거래 안에서 새로 만듦) =====
DO $rh_setup$
DECLARE
  v_pool uuid[];
  v_cat_active uuid;
  v_cat_inactive uuid;
  v_cat_deleted uuid;
  v_src uuid;
  v_src_b uuid;
  v_src_c uuid;
  v_sub_a uuid;
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

  -- 서브상품 구성 3개(국어): 사용·비활성·지움
  INSERT INTO public.market_subproduct_categories (workspace_subject, name, slug, is_active, sort_order)
  VALUES ('korean', 'rh18 사용 구성', 'rh18-active', true, 900) RETURNING id INTO v_cat_active;
  INSERT INTO public.market_subproduct_categories (workspace_subject, name, slug, is_active, sort_order)
  VALUES ('korean', 'rh18 비활성 구성', 'rh18-inactive', false, 901) RETURNING id INTO v_cat_inactive;
  INSERT INTO public.market_subproduct_categories (workspace_subject, name, slug, is_active, sort_order, deleted_at)
  VALUES ('korean', 'rh18 지운 구성', 'rh18-deleted', false, 902, now()) RETURNING id INTO v_cat_deleted;

  -- 원본 A: 공개, 제목 118자, 모든 칸, 이미지, 서브상품 5행(복사 3·지운 구성 1·지운 서브상품 1), 파일 1, 전체구매(사용 1 + 옛 비사용 1)
  INSERT INTO public.market_items (workspace_subject, subject_code, category_item_id, title, summary, description, thumbnail_image_id,
    exam_year, exam_month, grade_level, source_type, source_1, source_2, source_3, source_4, question_count, status, draft_source, is_active,
    published_at, view_count, sort_order, created_by, updated_by, created_at, updated_at)
  VALUES ('korean', 'english',
    (SELECT c.id FROM public.market_category_items c WHERE c.workspace_subject = 'korean' ORDER BY c.id LIMIT 1),
    repeat('가', 118), 'rh18 요약', 'rh18 설명', (SELECT m.id FROM public.market_images m ORDER BY m.created_at, m.id LIMIT 1),
    2025, 3, '고1', 'rh18 자료유형', 'rh18 출처1', 'rh18 출처2', 'rh18 출처3', 'rh18 출처4', 24, 'published', 'manual', true,
    v_t, 7, 3, v_pool[1], v_pool[1], v_t, v_t)
  RETURNING id INTO v_src;
  -- sort_order 가 겹치고 created_at 도 같은 두 행(a·b) → id 순. d 는 같은 구성의 비사용 행.
  INSERT INTO public.market_item_subproducts (item_id, workspace_subject, category_id, title, description, purchase_notice_label,
    purchase_notice_text, price_credits, is_active, sort_order, created_at, updated_at)
  VALUES (v_src, 'korean', v_cat_active, 'rh18 a', 'a 설명', 'PDF 포함', 'a 안내', 1000, true, 0, v_t, v_t)
  RETURNING id INTO v_sub_a;
  INSERT INTO public.market_item_subproducts (item_id, workspace_subject, category_id, title, price_credits, is_active, sort_order, created_at, updated_at)
  VALUES (v_src, 'korean', v_cat_inactive, 'rh18 b', 2000, true, 0, v_t, v_t),
         (v_src, 'korean', v_cat_active, 'rh18 d', 3000, false, 3, v_t, v_t),
         (v_src, 'korean', v_cat_deleted, 'rh18 c(지운 구성)', 4000, true, 1, v_t, v_t);
  INSERT INTO public.market_item_subproducts (item_id, workspace_subject, category_id, title, price_credits, is_active, sort_order, created_at, updated_at, deleted_at)
  VALUES (v_src, 'korean', v_cat_active, 'rh18 e(지운 서브상품)', 5000, false, 2, v_t, v_t, now());
  SELECT f.id INTO v_ft FROM public.market_file_types f WHERE f.workspace_subject = 'korean' AND f.deleted_at IS NULL ORDER BY f.sort_order, f.id LIMIT 1;
  IF v_ft IS NULL THEN
    RAISE EXCEPTION 'RH FAIL [setup] 국어 파일 유형이 없다';
  END IF;
  INSERT INTO public.market_subproduct_files (item_id, subproduct_id, workspace_subject, file_type_id, original_file_name, storage_bucket, storage_path)
  VALUES (v_src, v_sub_a, 'korean', v_ft, 'rh18.pdf', 'market-files', 'rh18/never-uploaded.pdf');
  INSERT INTO public.market_item_bundle_options (item_id, workspace_subject, label, description, price_credits, is_active, created_at, updated_at)
  VALUES (v_src, 'korean', 'rh18 전체(사용)', '사용 중', 9000, true, v_t, v_t),
         (v_src, 'korean', 'rh18 전체(옛 비사용)', '옛 행', 1, false, v_t + interval '1 hour', v_t + interval '1 hour');

  -- 원본 B: 전체구매가 비사용 행 둘(최근 것만 복사). 원본 C: 전체구매 없음.
  INSERT INTO public.market_items (workspace_subject, subject_code, title, status, draft_source, created_by, updated_by)
  VALUES ('korean', 'korean', 'rh18 원본 B', 'draft', 'manual', v_pool[1], v_pool[1]) RETURNING id INTO v_src_b;
  INSERT INTO public.market_item_bundle_options (item_id, workspace_subject, label, price_credits, is_active, created_at, updated_at)
  VALUES (v_src_b, 'korean', 'rh18 B 옛', 100, false, v_t, v_t),
         (v_src_b, 'korean', 'rh18 B 최근', 200, false, v_t + interval '2 hour', v_t + interval '2 hour');
  INSERT INTO public.market_items (workspace_subject, subject_code, title, status, draft_source, created_by, updated_by)
  VALUES ('korean', 'korean', 'rh18 원본 C', 'draft', 'manual', v_pool[1], v_pool[1]) RETURNING id INTO v_src_c;

  -- 원본 A 의 이용 근거(17번 함수) — 사본에는 없어야 한다(D6)
  PERFORM pg_temp.expect(pg_temp.try_json(format('SELECT public.save_market_item_usage_basis(%L, %L, NULL, %L, %L, %L, %L::jsonb)',
    v_pool[1], v_src, (SELECT o.id FROM public.market_item_attribute_options o WHERE o.workspace_subject = 'korean' AND o.kind = 'usage_basis'
      AND o.is_active ORDER BY o.sort_order LIMIT 1), 'rh18', '', '{"ip": "203.0.113.18", "user_agent": "rh18"}')), 'OK', 'setup', '원본 A 이용 근거 저장');

  PERFORM pg_temp.ctx_set('src', v_src::text);
  PERFORM pg_temp.ctx_set('src_b', v_src_b::text);
  PERFORM pg_temp.ctx_set('src_c', v_src_c::text);
  PERFORM pg_temp.ctx_set('cat_inactive', v_cat_inactive::text);
  PERFORM pg_temp.ctx_set('src_row', (SELECT to_jsonb(i)::text FROM public.market_items i WHERE i.id = v_src));
  PERFORM pg_temp.ctx_set('src_subs', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)::text FROM public.market_item_subproducts s WHERE s.item_id = v_src));
  INSERT INTO _rh_log (test, msg, payload) VALUES ('setup', '시험 계정(@test.com)·시험 원본 상품 3개(rh18)', jsonb_build_object('pool', cardinality(v_pool)));
END
$rh_setup$;

DO $rh_d0$
BEGIN
  PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: duplicate_market_item already exists', 'D0', '다시 적용 거절');
  PERFORM pg_temp.ensure(NOT has_function_privilege('anon', 'public.duplicate_market_item(uuid,text,uuid,text,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.duplicate_market_item(uuid,text,uuid,text,jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.duplicate_market_item(uuid,text,uuid,text,jsonb)', 'EXECUTE'), 'D0', 'EXECUTE 는 service_role 만');
  INSERT INTO _rh_log (test, msg, payload)
  SELECT 'D0', '적용 뒤 함수 지문(md5(pg_get_functiondef))', jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'duplicate_market_item';
  INSERT INTO _rh_log (test, msg) VALUES ('D0', 'VERIFY 통과(마이그레이션 안 블록)·다시 적용 거절·권한');
END
$rh_d0$;

DO $rh_d1$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_new uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_src uuid := pg_temp.uid('src');
  v_src_b uuid := pg_temp.uid('src_b');
  v_src_c uuid := pg_temp.uid('src_c');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.dup(v_owner, 'korean', v_src, 'copy'), 'OK', 'D1', '대표 성공');
    v_log := v_log || pg_temp.expect(pg_temp.dup(v_staff, 'korean', v_src, 'next'), 'OK', 'D1', 'products.edit 직원 성공');
    v_log := v_log || pg_temp.expect(pg_temp.dup(v_e, 'korean', v_src, 'copy'), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'D1', '일반 회원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.dup(NULL, 'korean', v_src, 'copy'), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'D1', '행위자 없음 거절');
    UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = v_x;
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_x, ARRAY['content.manage']), 'OK', 'D1', 'content.manage 만 주기');
    v_log := v_log || pg_temp.expect(pg_temp.dup(v_x, 'korean', v_src, 'copy'), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'D1', '권한 없는 직원 거절');
    UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = v_x;
    PERFORM set_config('app.member_withdrawal_bypass', v_x::text, true);
    UPDATE public.profiles SET withdrawn_at = now() WHERE id = v_x;
    PERFORM set_config('app.member_withdrawal_bypass', '', true);
    v_log := v_log || pg_temp.expect(pg_temp.dup(v_x, 'korean', v_src, 'copy'), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'D1', '탈퇴한 대표 거절');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_item_duplicate') = 2, 'D1', '성공 2건만 기록');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D1', m FROM unnest(v_log) m;
END
$rh_d1$;

DO $rh_d2$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_new uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_src uuid := pg_temp.uid('src');
  v_src_b uuid := pg_temp.uid('src_b');
  v_src_c uuid := pg_temp.uid('src_c');
BEGIN
  BEGIN

    v_r := pg_temp.dup(v_staff, 'korean', v_src, 'next');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'D2', 'next');
    v_j := pg_temp.res(v_r);
    v_new := (v_j ->> 'item_id')::uuid;
    v_log := v_log || pg_temp.ensure((v_j ->> 'subproduct_count')::integer = 3 AND (v_j ->> 'skipped_subproduct_count')::integer = 1
      AND (v_j ->> 'bundle_copied')::boolean, 'D2', '결과: 서브상품 3·건너뜀 1(지운 구성)·전체구매 복사');
    v_log := v_log || pg_temp.ensure(EXISTS (SELECT 1 FROM public.market_items n, public.market_items s WHERE n.id = v_new AND s.id = v_src
      AND n.title = '새 상품' AND n.summary IS NULL AND n.description IS NULL AND n.question_count IS NULL AND n.thumbnail_image_id IS NULL
      AND n.thumbnail_url IS NULL AND n.menu_entry_id IS NULL AND n.status = 'draft' AND n.draft_source = 'manual' AND n.is_active
      AND n.published_at IS NULL AND n.view_count = 0 AND n.sort_order = 0 AND n.pdf_price = 0 AND n.hwp_price = 0 AND n.zip_price = 0
      AND n.created_by = v_staff AND n.updated_by = v_staff AND n.deleted_at IS NULL
      AND n.workspace_subject = s.workspace_subject AND n.subject_code = s.subject_code AND n.category_item_id IS NOT DISTINCT FROM s.category_item_id
      AND n.exam_year = s.exam_year AND n.exam_month = s.exam_month AND n.grade_level = s.grade_level AND n.source_type = s.source_type
      AND n.source_1 = s.source_1 AND n.source_2 = s.source_2 AND n.source_3 = s.source_3 AND n.source_4 = s.source_4), 'D2',
      '새 상품 칸: 제목 새 상품·요약·설명·문항 수·이미지·게시판 NULL, draft·manual, 카테고리·자료 정보·출처·과목 같음');
    v_log := v_log || pg_temp.ensure(pg_temp.subs(v_new) = (SELECT jsonb_agg(e) FROM jsonb_array_elements(pg_temp.subs(v_src)) e
        WHERE (e ->> 'category_id')::uuid IN (SELECT c.id FROM public.market_subproduct_categories c WHERE c.deleted_at IS NULL)),
      'D2', '서브상품 이름·구성·가격·설명·안내·사용 여부·순서 = 원본 공개 읽기 순서(지운 구성 뺌, 겹친 sort_order 포함)');
    v_log := v_log || pg_temp.ensure((SELECT array_agg(s.sort_order ORDER BY s.sort_order) FROM public.market_item_subproducts s WHERE s.item_id = v_new) = ARRAY[10, 20, 30],
      'D2', '사본 순서 10·20·30');
    v_log := v_log || pg_temp.ensure(EXISTS (SELECT 1 FROM public.market_item_subproducts s WHERE s.item_id = v_new AND s.category_id = pg_temp.uid('cat_inactive')),
      'D2', '비활성 구성 서브상품은 복사');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.market_subproduct_files f WHERE f.item_id = v_new) = 0
      AND (SELECT count(*) FROM public.market_item_sample_pages p WHERE p.item_id = v_new) = 0, 'D2', '파일·샘플 0');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D2', m FROM unnest(v_log) m;
END
$rh_d2$;

DO $rh_d3$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_new uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_src uuid := pg_temp.uid('src');
  v_src_b uuid := pg_temp.uid('src_b');
  v_src_c uuid := pg_temp.uid('src_c');
BEGIN
  BEGIN

    v_r := pg_temp.dup(v_owner, 'korean', v_src, 'copy');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'D3', 'copy');
    v_new := (pg_temp.res(v_r) ->> 'item_id')::uuid;
    v_log := v_log || pg_temp.ensure(EXISTS (SELECT 1 FROM public.market_items n, public.market_items s WHERE n.id = v_new AND s.id = v_src
      AND n.title = repeat('가', 115) || ' (사본)' AND char_length(n.title) = 120
      AND n.summary = s.summary AND n.description = s.description AND n.question_count = s.question_count
      AND n.thumbnail_image_id IS NOT DISTINCT FROM s.thumbnail_image_id AND n.status = 'draft' AND n.draft_source = 'manual'
      AND n.menu_entry_id IS NULL AND n.thumbnail_url IS NULL), 'D3', '제목 118자 → 120자 안 사본, 요약·설명·문항 수·이미지 같음, draft');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.market_subproduct_files f WHERE f.item_id = v_new) = 0
      AND (SELECT count(*) FROM public.market_item_sample_pages p WHERE p.item_id = v_new) = 0, 'D3', '파일·샘플 0');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D3', m FROM unnest(v_log) m;
END
$rh_d3$;

DO $rh_d4$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_new uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_src uuid := pg_temp.uid('src');
  v_src_b uuid := pg_temp.uid('src_b');
  v_src_c uuid := pg_temp.uid('src_c');
BEGIN
  BEGIN

    v_r := pg_temp.dup(v_owner, 'korean', v_src, 'copy');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'D4', '원본 A(사용 1 + 더 최근 비사용 1)');
    v_new := (pg_temp.res(v_r) ->> 'item_id')::uuid;
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.market_item_bundle_options b WHERE b.item_id = v_new) = 1
      AND EXISTS (SELECT 1 FROM public.market_item_bundle_options b WHERE b.item_id = v_new AND b.label = 'rh18 전체(사용)' AND b.is_active
        AND b.price_credits = 9000 AND b.description = '사용 중'), 'D4', '사용 중 행 복사');
    v_r := pg_temp.dup(v_owner, 'korean', v_src_b, 'next');
    v_new := (pg_temp.res(v_r) ->> 'item_id')::uuid;
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.market_item_bundle_options b WHERE b.item_id = v_new) = 1
      AND EXISTS (SELECT 1 FROM public.market_item_bundle_options b WHERE b.item_id = v_new AND b.label = 'rh18 B 최근' AND NOT b.is_active
        AND b.price_credits = 200), 'D4', '비사용 행만 여럿 → 가장 최근 1행');
    v_r := pg_temp.dup(v_owner, 'korean', v_src_c, 'copy');
    v_new := (pg_temp.res(v_r) ->> 'item_id')::uuid;
    v_log := v_log || pg_temp.ensure(NOT (pg_temp.res(v_r) ->> 'bundle_copied')::boolean
      AND (SELECT count(*) FROM public.market_item_bundle_options b WHERE b.item_id = v_new) = 0
      AND (SELECT count(*) FROM public.market_item_subproducts s WHERE s.item_id = v_new) = 0, 'D4', '전체구매 없음 → 0행');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D4', m FROM unnest(v_log) m;
END
$rh_d4$;

DO $rh_d5$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_new uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_src uuid := pg_temp.uid('src');
  v_src_b uuid := pg_temp.uid('src_b');
  v_src_c uuid := pg_temp.uid('src_c');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.dup(v_owner, 'english', v_src, 'copy'), 'ERR MARKET_DUPLICATE_SOURCE_NOT_FOUND', 'D5', '과목이 원본과 다름 거절');
    v_log := v_log || pg_temp.expect(pg_temp.dup(v_owner, 'korean', gen_random_uuid(), 'copy'), 'ERR MARKET_DUPLICATE_SOURCE_NOT_FOUND', 'D5', '없는 id 거절');
    v_log := v_log || pg_temp.expect(pg_temp.dup(v_owner, 'korean', v_src, 'move'), 'ERR MARKET_DUPLICATE_INPUT_INVALID:mode', 'D5', 'mode 두 값만');
    v_log := v_log || pg_temp.expect(pg_temp.dup(v_owner, 'math', v_src, 'copy'), 'ERR MARKET_DUPLICATE_INPUT_INVALID:subject', 'D5', '과목 두 값만');
    v_log := v_log || pg_temp.expect(pg_temp.dup(v_owner, 'korean', v_src, 'copy', NULL), 'ERR MARKET_DUPLICATE_INPUT_INVALID:request', 'D5', '요청 정보 필수');
    v_log := v_log || pg_temp.expect(pg_temp.dup(v_owner, 'korean', v_src, 'next'), 'OK', 'D5', '정상 복제 1번');
    v_log := v_log || pg_temp.ensure((SELECT to_jsonb(i) FROM public.market_items i WHERE i.id = v_src) = pg_temp.ctx('src_row')::jsonb
      AND (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.market_item_subproducts s WHERE s.item_id = v_src) = pg_temp.ctx('src_subs')::jsonb,
      'D5', '원본 상품·서브상품 행 그대로(updated_at 포함)');
    UPDATE public.market_items SET deleted_at = now() WHERE id = v_src;
    v_log := v_log || pg_temp.expect(pg_temp.dup(v_owner, 'korean', v_src, 'copy'), 'ERR MARKET_DUPLICATE_SOURCE_NOT_FOUND', 'D5', '지운 상품 거절');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_item_duplicate') = 1, 'D5', '거절은 기록 없음(성공 1건만)');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D5', m FROM unnest(v_log) m;
END
$rh_d5$;

DO $rh_d6$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_new uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_src uuid := pg_temp.uid('src');
  v_src_b uuid := pg_temp.uid('src_b');
  v_src_c uuid := pg_temp.uid('src_c');
BEGIN
  BEGIN

    v_new := (pg_temp.res(pg_temp.dup(v_owner, 'korean', v_src, 'copy')) ->> 'item_id')::uuid;
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.market_item_usage_bases b WHERE b.item_id = v_src) = 1
      AND (SELECT count(*) FROM public.market_item_usage_bases b WHERE b.item_id = v_new) = 0, 'D6', '원본 근거 1행, 사본 근거 0행');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D6', m FROM unnest(v_log) m;
END
$rh_d6$;

DO $rh_d7$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_new uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_src uuid := pg_temp.uid('src');
  v_src_b uuid := pg_temp.uid('src_b');
  v_src_c uuid := pg_temp.uid('src_c');
BEGIN
  BEGIN

    v_new := (pg_temp.res(pg_temp.dup(v_owner, 'korean', v_src, 'copy')) ->> 'item_id')::uuid;
    SELECT public.evaluate_market_targets(v_e, (SELECT jsonb_agg(jsonb_build_object('targetKind', 'subproduct', 'targetId', s.id))
      FROM public.market_item_subproducts s WHERE s.item_id = v_new)
      || (SELECT coalesce(jsonb_agg(jsonb_build_object('targetKind', 'bundle', 'targetId', b.id)), '[]'::jsonb)
      FROM public.market_item_bundle_options b WHERE b.item_id = v_new)) INTO v_j;
    v_log := v_log || pg_temp.ensure(jsonb_array_length(v_j) = 4 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_j) e
      WHERE (e ->> 'available')::boolean OR (e ->> 'purchasable')::boolean OR e ->> 'reason' IS DISTINCT FROM 'UNAVAILABLE'),
      'D7', '사본 서브상품 3·전체구매 1 모두 살 수 없음(UNAVAILABLE — 공개 아님·파일 없음)');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D7', m FROM unnest(v_log) m;
END
$rh_d7$;

DO $rh_d8$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_new uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_src uuid := pg_temp.uid('src');
  v_src_b uuid := pg_temp.uid('src_b');
  v_src_c uuid := pg_temp.uid('src_c');
BEGIN
  BEGIN

    v_new := (pg_temp.res(pg_temp.dup(v_owner, 'korean', v_src, 'next')) ->> 'item_id')::uuid;
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_item_duplicate') = 1
      AND pg_temp.audit_ok('market_item_duplicate', ARRAY['bundle_copied', 'mode', 'new_item_id', 'request', 'source_item_id', 'subproduct_count']::text[])
      AND EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action = 'market_item_duplicate' AND a.created_at >= now()
        AND a.target_type = 'market_item' AND a.target_id = v_new::text AND a.actor_id = v_owner
        AND a.details ->> 'mode' = 'next' AND (a.details ->> 'source_item_id')::uuid = v_src AND (a.details ->> 'new_item_id')::uuid = v_new
        AND (a.details ->> 'subproduct_count')::integer = 3 AND (a.details ->> 'bundle_copied')::boolean), 'D8', '기록 1건·details 키·값');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D8', m FROM unnest(v_log) m;
END
$rh_d8$;

DO $rh_d9$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_new uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_src uuid := pg_temp.uid('src');
  v_src_b uuid := pg_temp.uid('src_b');
  v_src_c uuid := pg_temp.uid('src_c');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'D9', 'down(함수만 지움)');
    v_log := v_log || pg_temp.ensure(to_regprocedure('public.duplicate_market_item(uuid,text,uuid,text,jsonb)') IS NULL, 'D9', '함수 없음');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: duplicate_market_item missing', 'D9', '없을 때 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'D9', '다시 적용(VERIFY 통과)');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'D9', m FROM unnest(v_log) m;
END
$rh_d9$;

DO $rh_leftover$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_new uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_src uuid := pg_temp.uid('src');
  v_src_b uuid := pg_temp.uid('src_b');
  v_src_c uuid := pg_temp.uid('src_c');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_item_duplicate') = 0
      AND (SELECT count(*) FROM public.market_items i WHERE i.created_at >= now() AND i.title IN ('새 상품', repeat('가', 115) || ' (사본)')) = 0,
      'Z', '경우 밖에 남은 사본·기록 0(ROLLBACK 전)');
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
