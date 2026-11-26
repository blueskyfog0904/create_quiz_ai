-- 출시 전 작업 순서표 17번 묶음: 상품 정보 입력 보완(계획 docs/plan-bundle17-product-info.md 2판, 5절).
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
