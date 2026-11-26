-- 17번 묶음 리허설: B full — 원본 적용(FK·트리거) + 적용 절차(이력 INSERT) + light 경우 전부 + 실제 두 표 잠금 트리거(P7F)·down 원본·다시 적용(F)
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle17_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle17_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: 새벽, DB 적용 직전에만(market_items·market_subproduct_categories·market_file_types 잠금이 ROLLBACK 까지 이어짐, supabase_migrations 이력 표에 씀 — ROLLBACK 됨).
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
-- 동적 SQL 을 실행하고 'OK' 또는 'ERR 메시지 [SQLSTATE]'(앞 300자)를 돌려준다. 실패하면 그 문장의 변경은 되돌려진다.
CREATE FUNCTION pg_temp.try_sql(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300) || ' [' || SQLSTATE || ']';
END $f$;
-- 결과(jsonb)를 돌려주는 함수 호출: 'OK {json}' 또는 'ERR 메시지'
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
CREATE FUNCTION pg_temp.new_id(p_result text) RETURNS uuid LANGUAGE sql AS $f$ SELECT (substr(p_result, 4)::jsonb ->> 'id')::uuid $f$;
CREATE FUNCTION pg_temp.expect(p_actual text, p_prefix text, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_actual IS NULL OR p_actual NOT LIKE p_prefix || '%' THEN
    PERFORM pg_temp.fail(p_test, p_msg || ' — 기대 "' || p_prefix || '", 실제 "' || left(coalesce(p_actual, 'NULL'), 400) || '"');
  END IF;
  RETURN p_msg || ' → ' || left(p_actual, 120);
END $f$;
CREATE FUNCTION pg_temp.ensure(p_cond boolean, p_test text, p_msg text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_cond IS NOT TRUE THEN
    PERFORM pg_temp.fail(p_test, p_msg);
  END IF;
  RETURN p_msg;
END $f$;
CREATE FUNCTION pg_temp.subst_once(p_src text, p_from text, p_to text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_from = '' OR (length(p_src) - length(replace(p_src, p_from, ''))) / length(p_from) <> 1 THEN
    RAISE EXCEPTION 'RH FAIL copy line not found exactly once: %', left(p_from, 200);
  END IF;
  RETURN replace(p_src, p_from, p_to);
END $f$;
CREATE FUNCTION pg_temp.grants(p_owner uuid, p_staff uuid, p_keys text[]) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.replace_admin_permission_grants(%L, %L, %L::jsonb)', p_owner, p_staff,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('permission', k)), '[]'::jsonb) FROM unnest(p_keys) k)))
$f$;
-- 이 거래에서 남긴 작업 기록(created_at 기본값 now() = 거래 시작 시각, 앞 경우들은 되돌려져 없다)
CREATE FUNCTION pg_temp.audit_count(p_action text) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::integer FROM public.admin_audit_log WHERE action = p_action AND created_at >= now()
$f$;
-- 그 종류의 기록이 모두: reason NULL, details 키가 정한 목록과 같음, request 가 객체
CREATE FUNCTION pg_temp.audit_ok(p_action text, p_keys text[]) RETURNS boolean LANGUAGE sql AS $f$
  SELECT count(*) > 0 AND bool_and(a.reason IS NULL
     AND ARRAY(SELECT k FROM jsonb_object_keys(a.details) k ORDER BY k COLLATE "C") = p_keys
     AND jsonb_typeof(a.details -> 'request') = 'object')
    FROM public.admin_audit_log a WHERE a.action = p_action AND a.created_at >= now()
$f$;
-- 목록 항목 저장(결과 'OK {json}' 또는 'ERR …')
CREATE FUNCTION pg_temp.opt(p_actor uuid, p_subject text, p_kind text, p_label text, p_id uuid DEFAULT NULL, p_rev integer DEFAULT NULL,
  p_active boolean DEFAULT true) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.save_market_item_option(%L, %L, %L, %L, %L, %L, %L, %L::jsonb)',
    p_actor, p_id, p_rev, p_subject, p_kind, p_label, p_active, '{"ip": "203.0.113.17", "user_agent": "rh17"}'))
$f$;
CREATE FUNCTION pg_temp.reorder(p_actor uuid, p_subject text, p_kind text, p_ids uuid[]) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.reorder_market_item_options(%L, %L, %L, %L::uuid[], %L::jsonb)', p_actor, p_subject, p_kind, p_ids, '{"ip": "203.0.113.17", "user_agent": "rh17"}'))
$f$;
CREATE FUNCTION pg_temp.basis(p_actor uuid, p_item uuid, p_rev integer, p_option uuid, p_note text DEFAULT '', p_evidence text DEFAULT '') RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.save_market_item_usage_basis(%L, %L, %L, %L, %L, %L, %L::jsonb)',
    p_actor, p_item, p_rev, p_option, p_note, p_evidence, '{"ip": "203.0.113.17", "user_agent": "rh17"}'))
$f$;
CREATE FUNCTION pg_temp.display(p_actor uuid, p_rev integer, p_value jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.save_market_item_display(%L, %L, %L::jsonb, %L::jsonb)', p_actor, p_rev, p_value, '{"ip": "203.0.113.17", "user_agent": "rh17"}'))
$f$;
-- 새 표를 읽는 도우미는 plpgsql(만들 때 본문을 검사하지 않음 — 표는 마이그레이션 뒤에 생긴다)
CREATE FUNCTION pg_temp.opt_id(p_subject text, p_kind text, p_label text) RETURNS uuid LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (SELECT id FROM public.market_item_attribute_options WHERE workspace_subject = p_subject AND kind = p_kind AND label = p_label);
END $f$;
CREATE FUNCTION pg_temp.opt_rev(p_id uuid) RETURNS integer LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (SELECT revision FROM public.market_item_attribute_options WHERE id = p_id);
END $f$;
CREATE FUNCTION pg_temp.opt_ids(p_subject text, p_kind text) RETURNS uuid[] LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (SELECT coalesce(array_agg(id ORDER BY sort_order, id), '{}') FROM public.market_item_attribute_options WHERE workspace_subject = p_subject AND kind = p_kind);
END $f$;
CREATE FUNCTION pg_temp.display_value() RETURNS jsonb LANGUAGE sql AS $f$ SELECT value FROM public.system_settings WHERE key = 'market_item_display' $f$;
CREATE FUNCTION pg_temp.display_rev() RETURNS integer LANGUAGE sql AS $f$ SELECT (value ->> 'revision')::integer FROM public.system_settings WHERE key = 'market_item_display' $f$;
-- 상품 저장 route 의 학년·자료유형 규칙(TS checkMarketItemOptionValue 와 같음): 빈 값 통과, 지금 값과 같으면 통과, 아니면 사용 중 목록에 있어야 함
CREATE FUNCTION pg_temp.route_ok(p_subject text, p_kind text, p_value text, p_current text) RETURNS boolean LANGUAGE plpgsql AS $f$
DECLARE
  v text := normalize(btrim(coalesce(p_value, '')), NFC);
BEGIN
  RETURN v = '' OR (p_current IS NOT NULL AND normalize(btrim(p_current), NFC) = v)
    OR EXISTS (SELECT 1 FROM public.market_item_attribute_options o
                WHERE o.workspace_subject = p_subject AND o.kind = p_kind AND o.label = v AND o.is_active);
END $f$;
-- 화면 세션처럼(역할 + JWT claims) 한 값을 읽는다: 'OK 값' 또는 'ERR … [SQLSTATE]'. 끝나면 역할·claims 를 되돌린다.
CREATE FUNCTION pg_temp.as_session(p_sub uuid, p_role text, p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v text;
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN p_sub IS NULL THEN '' ELSE jsonb_build_object('sub', p_sub, 'role', p_role)::text END, true);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql INTO v;
    RESET ROLE;
    v := 'OK ' || coalesce(v, 'null');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    v := 'ERR ' || left(SQLERRM, 300) || ' [' || SQLSTATE || ']';
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
END $f$;

-- 원본 사본(생성기가 원본 파일에서 꺼낸 글 그대로)
SELECT pg_temp.ctx_set('src_migration', $rh_src_migration$-- 출시 전 작업 순서표 17번 묶음: 상품 정보 입력 보완(계획 docs/plan-bundle17-product-info.md 2판, 5절).
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
$rh_src_migration$);
SELECT pg_temp.ctx_set('src_down', $rh_src_down$-- 17번 묶음 되돌리기(supabase/migrations/20261219100000_bundle17_product_info.sql 의 down). 계획 docs/plan-bundle17-product-info.md 5-6.
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
$rh_src_down$);
SELECT pg_temp.ctx_set('src_old_handle_new_user', $rh_src_old_handle_new_user$CREATE OR REPLACE FUNCTION public.handle_new_user()
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
$function$;$rh_src_old_handle_new_user$);
SELECT pg_temp.ctx_set('mode', 'full');

-- ===== 계정: @test.com 시험 계정만(관리자·탈퇴 아님, 가입 완료) 4개 — 대표(owner)·직원(staff)·회원(E)·행위자 예시용(X).
--       모자라면 멈춘다(실회원 id 로 대신하지 않음). 상품은 실상품을 읽기·행 잠금으로만 쓴다(국어 '교과서' 1행·영어 1행). =====
DO $rh_setup$
DECLARE
  v_pool uuid[];
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
  PERFORM pg_temp.ctx_set('item_ko', (SELECT id::text FROM public.market_items WHERE workspace_subject = 'korean' ORDER BY created_at, id LIMIT 1));
  PERFORM pg_temp.ctx_set('item_en', (SELECT id::text FROM public.market_items WHERE workspace_subject = 'english' ORDER BY created_at, id LIMIT 1));
  IF pg_temp.ctx('item_ko') IS NULL OR pg_temp.ctx('item_en') IS NULL THEN
    RAISE EXCEPTION 'RH FAIL [setup] 국어·영어 상품이 각각 1개 이상 있어야 한다';
  END IF;
  INSERT INTO _rh_log (test, msg, payload) VALUES ('setup', '시험 계정 배정(@test.com 만)', jsonb_build_object('pool', cardinality(v_pool)));
END
$rh_setup$;

DO $rh_before$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: bundle 17 tables missing', 'F0', '적용 전 down 멈춤');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20261219100000'), 'F0', '이력 행 없음');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'F0', m FROM unnest(v_log) m;
END
$rh_before$;

-- ===== 17번 마이그레이션(원본 그대로) =====
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


INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261219100000', 'bundle17_product_info');

DO $rh_roles$
BEGIN
  UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = pg_temp.uid('owner');
  UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = pg_temp.uid('staff');
  PERFORM pg_temp.expect(pg_temp.grants(pg_temp.uid('owner'), pg_temp.uid('staff'), ARRAY['products.edit']), 'OK', 'setup', '직원에게 products.edit');
END
$rh_roles$;

DO $rh_a$
BEGIN
  PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: handle_new_user changed', 'P0', '다시 적용 거절(가입 함수 지문이 이미 바뀜)');
  PERFORM pg_temp.ensure((SELECT count(*) FROM public.market_item_attribute_options) = 26
    AND (SELECT count(*) FROM public.market_item_attribute_options WHERE workspace_subject = 'korean' AND kind = 'usage_basis') = 5
    AND pg_temp.display_rev() = 1 AND pg_temp.display_value() #>> '{facetLabels,type}' = '구성', 'A', '첫 값 26개(두 과목 13개씩)·설정 행 revision 1·구성');
  PERFORM pg_temp.ensure((SELECT count(*) FROM public.market_item_usage_bases) = 0, 'A', '이용 근거 0행');
  INSERT INTO _rh_log (test, msg, payload)
  SELECT 'A', '적용 뒤 함수 지문(md5(pg_get_functiondef))', jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('market_catalog_actor_allowed', 'save_market_item_option',
     'reorder_market_item_options', 'save_market_item_usage_basis', 'save_market_item_display', 'guard_market_subproduct_category_identity',
     'guard_market_file_type_identity', 'handle_new_user');
  INSERT INTO _rh_log (test, msg) VALUES ('A', 'VERIFY 통과(마이그레이션 안 블록)·다시 적용 거절·첫 값·설정 행');
END
$rh_a$;

DO $rh_p0$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.subst_once(pg_temp.ctx('src_down'), '  c_allow_drop_usage_bases constant boolean := false;', '  c_allow_drop_usage_bases constant boolean := true;')), 'OK', 'P0', 'down(적용 전 상태로)');
    EXECUTE 'CREATE OR REPLACE FUNCTION public.record_admin_audit(p_actor_id uuid, p_action text, p_target_type text, p_target_id text, p_target_user_id uuid, p_amount integer, p_reason text, p_details jsonb, p_request_id text) RETURNS uuid LANGUAGE sql AS $x$ SELECT NULL::uuid $x$';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: record_admin_audit changed', 'P0', '기록 함수 지문 다르면 멈춤');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P0', m FROM unnest(v_log) m;
END
$rh_p0$;

DO $rh_p0b$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.subst_once(pg_temp.ctx('src_down'), '  c_allow_drop_usage_bases constant boolean := false;', '  c_allow_drop_usage_bases constant boolean := true;')), 'OK', 'P0', 'down(적용 전 상태로)');
    EXECUTE 'INSERT INTO public.system_settings (key, value) VALUES (''market_item_display'', ''{}''::jsonb)';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: market_item_display row already exists', 'P0', '설정 행이 이미 있으면 멈춤');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P0', m FROM unnest(v_log) m;
END
$rh_p0b$;

DO $rh_p0c$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.subst_once(pg_temp.ctx('src_down'), '  c_allow_drop_usage_bases constant boolean := false;', '  c_allow_drop_usage_bases constant boolean := true;')), 'OK', 'P0', 'down(적용 전 상태로)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'P0', '적용 전 상태에서 다시 적용(VERIFY 통과)');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P0', m FROM unnest(v_log) m;
END
$rh_p0c$;

DO $rh_p1_0$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_p := v_owner;
    v_log := v_log || pg_temp.ensure(public.market_catalog_actor_allowed(v_p) IS TRUE, 'P1', '대표 — 판정 통과');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_p, 'korean', 'grade', '권한 시험'), 'OK', 'P1', '대표 — 목록 저장');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_p, 'korean', 'grade', pg_temp.opt_ids('korean', 'grade')), 'OK', 'P1', '대표 — 순서');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_p, v_item_ko, NULL, pg_temp.opt_id('korean', 'usage_basis', '확인 중')), 'OK', 'P1', '대표 — 이용 근거');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_p, 1, pg_temp.display_value()), 'OK', 'P1', '대표 — 표시 설정');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P1', m FROM unnest(v_log) m;
END
$rh_p1_0$;

DO $rh_p1_1$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_p := v_staff;
    v_log := v_log || pg_temp.ensure(public.market_catalog_actor_allowed(v_p) IS TRUE, 'P1', 'products.edit 직원 — 판정 통과');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_p, 'korean', 'grade', '권한 시험'), 'OK', 'P1', 'products.edit 직원 — 목록 저장');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_p, 'korean', 'grade', pg_temp.opt_ids('korean', 'grade')), 'OK', 'P1', 'products.edit 직원 — 순서');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_p, v_item_ko, NULL, pg_temp.opt_id('korean', 'usage_basis', '확인 중')), 'OK', 'P1', 'products.edit 직원 — 이용 근거');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_p, 1, pg_temp.display_value()), 'OK', 'P1', 'products.edit 직원 — 표시 설정');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P1', m FROM unnest(v_log) m;
END
$rh_p1_1$;

DO $rh_p1_2$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = v_x;
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_x, ARRAY['content.manage']), 'OK', 'P1', 'content.manage 만 주기');
    v_p := v_x;
    v_log := v_log || pg_temp.ensure(public.market_catalog_actor_allowed(v_p) IS FALSE, 'P1', '권한 없는 직원(content.manage 만) — 판정 거절');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_p, 'korean', 'grade', '권한 시험'), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '권한 없는 직원(content.manage 만) — 목록 저장');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_p, 'korean', 'grade', pg_temp.opt_ids('korean', 'grade')), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '권한 없는 직원(content.manage 만) — 순서');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_p, v_item_ko, NULL, pg_temp.opt_id('korean', 'usage_basis', '확인 중')), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '권한 없는 직원(content.manage 만) — 이용 근거');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_p, 1, pg_temp.display_value()), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '권한 없는 직원(content.manage 만) — 표시 설정');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P1', m FROM unnest(v_log) m;
END
$rh_p1_2$;

DO $rh_p1_3$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = v_x;
    PERFORM set_config('app.member_withdrawal_bypass', v_x::text, true);
    UPDATE public.profiles SET withdrawn_at = now() WHERE id = v_x;
    PERFORM set_config('app.member_withdrawal_bypass', '', true);
    v_p := v_x;
    v_log := v_log || pg_temp.ensure(public.market_catalog_actor_allowed(v_p) IS FALSE, 'P1', '탈퇴한 대표 — 판정 거절');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_p, 'korean', 'grade', '권한 시험'), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '탈퇴한 대표 — 목록 저장');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_p, 'korean', 'grade', pg_temp.opt_ids('korean', 'grade')), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '탈퇴한 대표 — 순서');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_p, v_item_ko, NULL, pg_temp.opt_id('korean', 'usage_basis', '확인 중')), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '탈퇴한 대표 — 이용 근거');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_p, 1, pg_temp.display_value()), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '탈퇴한 대표 — 표시 설정');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P1', m FROM unnest(v_log) m;
END
$rh_p1_3$;

DO $rh_p1_4$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = v_x;
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_x, ARRAY['products.edit']), 'OK', 'P1', 'products.edit 주기');
    UPDATE public.profiles SET is_admin = false, admin_role = NULL WHERE id = v_x;
    v_p := v_x;
    v_log := v_log || pg_temp.ensure(public.market_catalog_actor_allowed(v_p) IS FALSE, 'P1', '권한 행만 남은 옛 직원(관리자 아님) — 판정 거절');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_p, 'korean', 'grade', '권한 시험'), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '권한 행만 남은 옛 직원(관리자 아님) — 목록 저장');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_p, 'korean', 'grade', pg_temp.opt_ids('korean', 'grade')), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '권한 행만 남은 옛 직원(관리자 아님) — 순서');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_p, v_item_ko, NULL, pg_temp.opt_id('korean', 'usage_basis', '확인 중')), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '권한 행만 남은 옛 직원(관리자 아님) — 이용 근거');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_p, 1, pg_temp.display_value()), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '권한 행만 남은 옛 직원(관리자 아님) — 표시 설정');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P1', m FROM unnest(v_log) m;
END
$rh_p1_4$;

DO $rh_p1_5$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_p := v_e;
    v_log := v_log || pg_temp.ensure(public.market_catalog_actor_allowed(v_p) IS FALSE, 'P1', '일반 회원 — 판정 거절');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_p, 'korean', 'grade', '권한 시험'), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '일반 회원 — 목록 저장');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_p, 'korean', 'grade', pg_temp.opt_ids('korean', 'grade')), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '일반 회원 — 순서');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_p, v_item_ko, NULL, pg_temp.opt_id('korean', 'usage_basis', '확인 중')), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '일반 회원 — 이용 근거');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_p, 1, pg_temp.display_value()), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '일반 회원 — 표시 설정');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P1', m FROM unnest(v_log) m;
END
$rh_p1_5$;

DO $rh_p1_6$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_p := gen_random_uuid();
    v_log := v_log || pg_temp.ensure(public.market_catalog_actor_allowed(v_p) IS FALSE, 'P1', '없는 id — 판정 거절');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_p, 'korean', 'grade', '권한 시험'), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '없는 id — 목록 저장');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_p, 'korean', 'grade', pg_temp.opt_ids('korean', 'grade')), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '없는 id — 순서');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_p, v_item_ko, NULL, pg_temp.opt_id('korean', 'usage_basis', '확인 중')), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '없는 id — 이용 근거');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_p, 1, pg_temp.display_value()), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '없는 id — 표시 설정');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P1', m FROM unnest(v_log) m;
END
$rh_p1_6$;

DO $rh_p1_more$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    -- admin_role 빈 관리자: profiles CHECK((is_admin IS TRUE) = (admin_role IS NOT NULL)) 가 이 상태를 막는다(DB 가 TS 보다 엄격)
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.profiles SET is_admin = true, admin_role = NULL WHERE id = %L', v_x)),
      'ERR', 'P1', 'admin_role 빈 관리자 — 상태 자체가 CHECK 로 거절');
    v_log := v_log || pg_temp.expect(pg_temp.opt(NULL, 'korean', 'grade', 'NULL 행위자'), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', 'NULL 행위자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY[]::text[]), 'OK', 'P1', '직원 권한 회수');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_staff, 'korean', 'grade', '회수 뒤'), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '권한 회수 뒤 저장 거절');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P1', m FROM unnest(v_log) m;
END
$rh_p1_more$;

DO $rh_p2$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_r := pg_temp.opt(v_owner, 'korean', 'material_type', ' 내신 대비 ');
    v_log := v_log || pg_temp.expect(v_r, 'OK {"id"', 'P2', '새 항목(앞뒤 공백 정리)');
    v_id := pg_temp.new_id(v_r);
    v_log := v_log || pg_temp.ensure((SELECT label = '내신 대비' AND sort_order = 5 AND revision = 1 AND is_active AND updated_by = v_owner
      FROM public.market_item_attribute_options WHERE id = v_id), 'P2', '맨 뒤(5번째)·판 1·이름 다듬음');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'material_type', '내신 대비', v_id, 9), 'ERR MARKET_OPTION_REVISION_CONFLICT', 'P2', '판 충돌');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'material_type', '교과서'), 'ERR MARKET_OPTION_DUPLICATE', 'P2', '중복 이름');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'material_type', '내신 대비', v_id, 1, false), 'OK', 'P2', '숨김');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'material_type', '내신 대비'), 'ERR MARKET_OPTION_DUPLICATE', 'P2', '숨긴 항목과 같은 이름도 중복');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'english', 'material_type', '내신 대비'), 'OK', 'P2', '다른 과목은 같은 이름 가능');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'grade', E'1학년\n반'), 'ERR MARKET_OPTION_INPUT_INVALID:label', 'P2', '줄바꿈 거절');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'grade', repeat('가', 41)), 'ERR MARKET_OPTION_INPUT_INVALID:label', 'P2', '41자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'grade', repeat('가', 40)), 'OK', 'P2', '40자 통과');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'grade', '   '), 'ERR MARKET_OPTION_INPUT_INVALID:label', 'P2', '빈 이름 거절');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'grade', 'x', NULL, 1), 'ERR MARKET_OPTION_INPUT_INVALID:revision', 'P2', '새 항목에 판 거절');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'english', 'material_type', '내신 대비', v_id, 2, false), 'ERR MARKET_OPTION_INPUT_INVALID:scope', 'P2', '과목 바꾸기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'grade', '내신 대비', v_id, 2, false), 'ERR MARKET_OPTION_INPUT_INVALID:scope', 'P2', '종류 바꾸기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'gradez', 'x'), 'ERR MARKET_OPTION_INPUT_INVALID:kind', 'P2', '모르는 종류 거절');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'grade', 'x', gen_random_uuid(), 1), 'ERR MARKET_OPTION_NOT_FOUND', 'P2', '없는 항목');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_market_item_option(%L, NULL, NULL, %L, %L, %L, true, NULL)', v_owner, 'korean', 'grade', 'x')),
      'ERR MARKET_OPTION_INPUT_INVALID:request', 'P2', '요청 정보 없음 거절');
    -- 바뀐 것 없음: 기록 0
    v_n := pg_temp.audit_count('market_item_option_save');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'material_type', ' 내신 대비', v_id, 2, false), 'OK {"id"', 'P2', '바뀐 것 없음');
    v_log := v_log || pg_temp.ensure((pg_temp.res(pg_temp.opt(v_owner, 'korean', 'material_type', '내신 대비', v_id, 2, false)) ->> 'changed')::boolean IS FALSE
      AND pg_temp.audit_count('market_item_option_save') = v_n AND pg_temp.opt_rev(v_id) = 2, 'P2', '바뀐 것 없음 → changed false·기록 0·판 그대로');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('market_item_option_save', ARRAY['after', 'before', 'created', 'kind', 'option_id', 'renamed_item_count', 'request', 'revision_after', 'revision_before', 'saved_at', 'subject']::text[]), 'P10', 'market_item_option_save 기록 키·request');
    v_log := v_log || pg_temp.ensure((SELECT bool_and(a.details ->> 'subject' IN ('korean', 'english') AND a.target_type = 'market_item_option')
      FROM public.admin_audit_log a WHERE a.action = 'market_item_option_save' AND a.created_at >= now()), 'P10', '기록 대상·과목');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P2', m FROM unnest(v_log) m;
END
$rh_p2$;

DO $rh_p2_ex_0$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure(pg_temp.route_ok('korean', 'grade', '2학년', NULL) IS TRUE,
      'P2', 'route 검사 예시: 목록에 있음 → 통과');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P2', m FROM unnest(v_log) m;
END
$rh_p2_ex_0$;

DO $rh_p2_ex_1$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure(pg_temp.route_ok('english', 'material_type', '  모의고사 ', NULL) IS TRUE,
      'P2', 'route 검사 예시: 목록에 있음(앞뒤 공백) → 통과');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P2', m FROM unnest(v_log) m;
END
$rh_p2_ex_1$;

DO $rh_p2_ex_2$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure(pg_temp.route_ok('korean', 'grade', '', '전체') IS TRUE,
      'P2', 'route 검사 예시: 빈 값(선택 안 함) → 통과');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P2', m FROM unnest(v_log) m;
END
$rh_p2_ex_2$;

DO $rh_p2_ex_3$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure(pg_temp.route_ok('korean', 'grade', '4학년', NULL) IS FALSE,
      'P2', 'route 검사 예시: 목록에 없음 → 거절');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P2', m FROM unnest(v_log) m;
END
$rh_p2_ex_3$;

DO $rh_p2_ex_4$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_id := pg_temp.opt_id('korean', 'material_type', '부교재');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'material_type', '부교재', v_id, pg_temp.opt_rev(v_id), false), 'OK', 'P2', '숨김인데 지금 값과 같음 — 숨기기');
    v_log := v_log || pg_temp.ensure(pg_temp.route_ok('korean', 'material_type', '부교재', '부교재') IS TRUE,
      'P2', 'route 검사 예시: 숨김인데 지금 값과 같음 → 통과');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P2', m FROM unnest(v_log) m;
END
$rh_p2_ex_4$;

DO $rh_p2_ex_5$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_id := pg_temp.opt_id('korean', 'material_type', '부교재');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'material_type', '부교재', v_id, pg_temp.opt_rev(v_id), false), 'OK', 'P2', '숨김이고 지금 값과 다름 — 숨기기');
    v_log := v_log || pg_temp.ensure(pg_temp.route_ok('korean', 'material_type', '부교재', '교과서') IS FALSE,
      'P2', 'route 검사 예시: 숨김이고 지금 값과 다름 → 거절');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P2', m FROM unnest(v_log) m;
END
$rh_p2_ex_5$;

DO $rh_p2_ex_6$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure(pg_temp.route_ok('english', 'grade', '고1', '고1') IS TRUE,
      'P2', 'route 검사 예시: 목록에 없는 옛 값과 같음 → 통과');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P2', m FROM unnest(v_log) m;
END
$rh_p2_ex_6$;

DO $rh_p2_ex_7$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'material_type', '국어 전용 시험 유형'), 'OK', 'P2', '다른 과목 이름 — 다른 과목에만 더하기');
    v_log := v_log || pg_temp.ensure(pg_temp.route_ok('english', 'material_type', '국어 전용 시험 유형', NULL) IS FALSE,
      'P2', 'route 검사 예시: 다른 과목 이름 → 거절');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P2', m FROM unnest(v_log) m;
END
$rh_p2_ex_7$;

DO $rh_p2_ex_8$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure(pg_temp.route_ok('korean', 'grade', '교과서', NULL) IS FALSE,
      'P2', 'route 검사 예시: 다른 종류 이름 → 거절');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P2', m FROM unnest(v_log) m;
END
$rh_p2_ex_8$;

DO $rh_p3$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_n := (SELECT count(*) FROM public.market_items WHERE workspace_subject = 'korean' AND source_type = '교과서');
    v_log := v_log || pg_temp.ensure(v_n >= 1, 'P3', '국어 교과서 상품 ' || v_n || '개');
    v_q := pg_temp.opt_id('english', 'material_type', '교과서');
    v_id := pg_temp.opt_id('korean', 'material_type', '교과서');
    v_r := pg_temp.opt(v_owner, 'korean', 'material_type', '교과서(시험)', v_id, 1);
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'P3', '국어 교과서 → 교과서(시험)');
    v_log := v_log || pg_temp.ensure((pg_temp.res(v_r) ->> 'renamedItemCount')::integer = v_n, 'P3', '응답 renamedItemCount = 그 과목 상품 수');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.market_items WHERE workspace_subject = 'korean' AND source_type = '교과서(시험)') = v_n
      AND NOT EXISTS (SELECT 1 FROM public.market_items WHERE workspace_subject = 'korean' AND source_type = '교과서'), 'P3', '그 과목 상품 값이 함께 바뀜');
    v_log := v_log || pg_temp.ensure((SELECT label FROM public.market_item_attribute_options WHERE id = v_q) = '교과서', 'P3', '다른 과목 같은 이름 항목은 그대로');
    v_log := v_log || pg_temp.ensure((SELECT (a.details ->> 'renamed_item_count')::integer = v_n AND a.details #>> '{before,label}' = '교과서'
        AND a.details #>> '{after,label}' = '교과서(시험)'
      FROM public.admin_audit_log a WHERE a.action = 'market_item_option_save' AND a.created_at >= now() AND a.target_id = v_id::text), 'P3', '기록 renamed_item_count·before·after');
    -- 이용 근거 목록 이름 바꾸기는 상품 칸을 건드리지 않는다
    v_id := pg_temp.opt_id('korean', 'usage_basis', '확인 중');
    v_r := pg_temp.opt(v_owner, 'korean', 'usage_basis', '확인 중(시험)', v_id, 1);
    v_log := v_log || pg_temp.ensure((pg_temp.res(v_r) ->> 'renamedItemCount')::integer = 0, 'P3', '이용 근거 이름 바꾸기는 상품 0개');
    -- 숨김만 바꾸면 상품 값은 그대로
    v_id := pg_temp.opt_id('korean', 'material_type', '교과서(시험)');
    v_r := pg_temp.opt(v_owner, 'korean', 'material_type', '교과서(시험)', v_id, 2, false);
    v_log := v_log || pg_temp.ensure((pg_temp.res(v_r) ->> 'renamedItemCount')::integer = 0
      AND (SELECT count(*) FROM public.market_items WHERE workspace_subject = 'korean' AND source_type = '교과서(시험)') = v_n, 'P3', '숨기기는 상품 값을 바꾸지 않음');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P3', m FROM unnest(v_log) m;
END
$rh_p3$;

DO $rh_p4$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_id := pg_temp.opt_id('korean', 'grade', '2학년');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'grade', '2학년', v_id, 1, false), 'OK', 'P4', '2학년 숨김');
    v_ids := pg_temp.opt_ids('korean', 'grade');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'korean', 'grade', v_ids[1:3]), 'ERR MARKET_OPTION_REORDER_MISMATCH', 'P4', '빠짐 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'korean', 'grade', v_ids || gen_random_uuid()), 'ERR MARKET_OPTION_REORDER_MISMATCH', 'P4', '더함 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'korean', 'grade', v_ids[1:3] || pg_temp.opt_id('english', 'grade', '전체')), 'ERR MARKET_OPTION_REORDER_MISMATCH', 'P4', '다른 과목 id 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'korean', 'grade', v_ids[1:3] || v_ids[1]), 'ERR MARKET_OPTION_REORDER_MISMATCH', 'P4', '중복 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'korean', 'grade', ARRAY[]::uuid[]), 'ERR MARKET_OPTION_INPUT_INVALID:ids', 'P4', '빈 목록 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'korean', 'grade', v_ids), 'OK {"changed": false}', 'P4', '같은 순서는 changed false');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'korean', 'grade', ARRAY[v_ids[4], v_ids[3], v_ids[2], v_ids[1]]), 'OK {"changed": true}', 'P4', '숨김 포함 순서 저장');
    v_log := v_log || pg_temp.ensure(pg_temp.opt_ids('korean', 'grade') = ARRAY[v_ids[4], v_ids[3], v_ids[2], v_ids[1]]
      AND (SELECT array_agg(label ORDER BY sort_order, id) FROM public.market_item_attribute_options WHERE workspace_subject = 'english' AND kind = 'grade') = ARRAY['1학년', '2학년', '3학년', '전체'],
      'P4', '저장된 순서·다른 과목 그대로');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_item_option_reorder') = 1
      AND pg_temp.audit_ok('market_item_option_reorder', ARRAY['ids_after', 'ids_before', 'kind', 'reordered_at', 'request', 'subject']::text[]), 'P10', 'market_item_option_reorder 기록 1건·키·request');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P4', m FROM unnest(v_log) m;
END
$rh_p4$;

DO $rh_p5$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_p := pg_temp.opt_id('korean', 'usage_basis', '확인 중');
    v_q := pg_temp.opt_id('korean', 'usage_basis', '자체 제작(원저작물 없음)');
    v_r := pg_temp.basis(v_staff, v_item_ko, NULL, v_p, '  메모 첫 줄' || E'\n' || '둘째 줄  ', ' 드라이브/계약/1.pdf ');
    v_log := v_log || pg_temp.expect(v_r, 'OK {"changed": true, "created": true, "revision": 1}', 'P5', '새로(직원)');
    v_log := v_log || pg_temp.ensure((SELECT workspace_subject = 'korean' AND basis_option_id = v_p AND note = '메모 첫 줄' || E'\n' || '둘째 줄'
      AND evidence_ref = '드라이브/계약/1.pdf' AND revision = 1 AND updated_by = v_staff FROM public.market_item_usage_bases WHERE item_id = v_item_ko), 'P5', '과목은 상품 행에서·메모 줄바꿈 유지·앞뒤 공백 정리');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, NULL, v_q), 'ERR MARKET_USAGE_BASIS_REVISION_CONFLICT', 'P5', '이미 있는데 판 없이 → 충돌');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, 7, v_q), 'ERR MARKET_USAGE_BASIS_REVISION_CONFLICT', 'P5', '판 충돌');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, 1, v_q, '', ''), 'OK {"changed": true, "created": false, "revision": 2}', 'P5', '고침(판 2, 빈 메모는 NULL)');
    v_log := v_log || pg_temp.ensure((SELECT note IS NULL AND evidence_ref IS NULL FROM public.market_item_usage_bases WHERE item_id = v_item_ko), 'P5', '빈 메모·증빙 → NULL');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, 2, v_q), 'OK {"changed": false', 'P5', '바뀐 것 없음');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, 2, pg_temp.opt_id('english', 'usage_basis', '확인 중')), 'ERR MARKET_USAGE_BASIS_INPUT_INVALID:basisOptionId', 'P5', '다른 과목 항목 거절');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, 2, pg_temp.opt_id('korean', 'grade', '1학년')), 'ERR MARKET_USAGE_BASIS_INPUT_INVALID:basisOptionId', 'P5', '다른 종류 항목 거절');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, 2, gen_random_uuid()), 'ERR MARKET_USAGE_BASIS_INPUT_INVALID:basisOptionId', 'P5', '없는 항목 거절');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, 2, v_p, repeat('가', 2001)), 'ERR MARKET_USAGE_BASIS_INPUT_INVALID:note', 'P5', '메모 2001자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, 2, v_p, repeat('가', 2000)), 'OK', 'P5', '메모 2000자 통과');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, 3, v_p, '', '위치' || E'\n' || '둘째'), 'ERR MARKET_USAGE_BASIS_INPUT_INVALID:evidenceRef', 'P5', '증빙 위치 줄바꿈 거절');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, 3, v_p, '', repeat('a', 301)), 'ERR MARKET_USAGE_BASIS_INPUT_INVALID:evidenceRef', 'P5', '증빙 위치 301자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, gen_random_uuid(), NULL, v_p), 'ERR MARKET_ITEM_NOT_FOUND', 'P5', '상품 없음 거절');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, NULL, NULL, v_p), 'ERR MARKET_USAGE_BASIS_INPUT_INVALID:itemId', 'P5', '상품 id 없음 거절');
    -- 숨긴 근거: 지금 근거와 같으면 그대로 둘 수 있고, 새로 고를 수는 없다
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'usage_basis', '확인 중', v_p, 1, false), 'OK', 'P5', '확인 중 숨김');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, 3, v_p, '메모만 고침'), 'OK {"changed": true, "created": false, "revision": 4}', 'P5', '숨긴 지금 근거는 그대로 두고 다른 칸 고침');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_en, NULL, pg_temp.opt_id('english', 'usage_basis', '확인 중')), 'OK {"changed": true, "created": true', 'P5', '영어 상품 새로');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'english', 'usage_basis', '기타(메모에 근거)', pg_temp.opt_id('english', 'usage_basis', '기타(메모에 근거)'), 1, false), 'OK', 'P5', '영어 기타 숨김');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_en, 1, pg_temp.opt_id('english', 'usage_basis', '기타(메모에 근거)')), 'ERR MARKET_USAGE_BASIS_INPUT_INVALID:basisOptionId', 'P5', '숨긴 항목은 새로 고를 수 없음');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_item_usage_basis_save') = 5
      AND pg_temp.audit_ok('market_item_usage_basis_save', ARRAY['after', 'before', 'created', 'item_id', 'request', 'revision_after', 'revision_before', 'saved_at', 'subject']::text[])
      AND (SELECT bool_and(a.target_type = 'market_item' AND a.details #>> '{after,basis_label}' IS NOT NULL) FROM public.admin_audit_log a
            WHERE a.action = 'market_item_usage_basis_save' AND a.created_at >= now()), 'P10', 'market_item_usage_basis_save 기록 5건·키·근거 이름');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P5', m FROM unnest(v_log) m;
END
$rh_p5$;

DO $rh_p6$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_j := pg_temp.display_value();
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, v_j), 'OK {"changed": false, "revision": 1}', 'P6', '첫 값 그대로 저장 → 성공(바뀐 것 없음)');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, jsonb_set(v_j, '{facetLabels,type}', '""')), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:facetLabels.type', 'P6', '필수 키 빈 값 거절');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, v_j #- '{facetLabels,grade}'), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:facetLabels.grade', 'P6', '필수 키 빠짐 거절');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, jsonb_set(v_j, '{facetLabels,type}', '"{type} 필터"')), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:facetLabels.type', 'P6', '필터 이름의 {type} 거절');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, jsonb_set(v_j, '{facetLabels,year}', to_jsonb(repeat('가', 21)))), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:facetLabels.year', 'P6', '필터 이름 21자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, jsonb_set(v_j, '{libraryEmptyFilterHint}', to_jsonb(repeat('가', 61)))), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:libraryEmptyFilterHint', 'P6', '안내 61자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, jsonb_set(v_j, '{libraryEmptyFilterHint}', to_jsonb('한 줄' || E'\n' || '둘째'))), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:libraryEmptyFilterHint', 'P6', '안내 줄바꿈 거절');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, jsonb_set(v_j, '{libraryEmptyFilterHint}', to_jsonb(repeat('가', 60)))), 'OK {"changed": true, "revision": 2}', 'P6', '안내 60자 통과·판 +1');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, v_j), 'ERR MARKET_ITEM_DISPLAY_REVISION_CONFLICT', 'P6', '판 충돌');
    -- 설정 행의 다른 키(19번이 더할 키 자리)는 이 함수가 그대로 둔다
    UPDATE public.system_settings SET value = value || '{"rh17Other": {"keep": true}}'::jsonb WHERE key = 'market_item_display';
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 2, jsonb_set(v_j, '{facetLabels,type}', '"구성(시험)"') || '{"rh17Other": "덮어쓰기 시도"}'), 'OK {"changed": true, "revision": 3}', 'P6', '필터 이름 저장');
    v_log := v_log || pg_temp.ensure(pg_temp.display_value() -> 'rh17Other' = '{"keep": true}'::jsonb AND pg_temp.display_value() #>> '{facetLabels,type}' = '구성(시험)'
      AND pg_temp.display_rev() = 3, 'P6', '다른 키는 저장된 값 그대로(넘긴 값으로 덮지 않음)');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_item_display_update') = 2
      AND pg_temp.audit_ok('market_item_display_update', ARRAY['after', 'before', 'request', 'revision_after', 'revision_before', 'saved_at']::text[]), 'P10', 'market_item_display_update 기록 2건·키·request');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P6', m FROM unnest(v_log) m;
END
$rh_p6$;

DO $rh_p7$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
  v_q_text text;
BEGIN
  BEGIN

    CREATE TEMP TABLE _rh17_cat (LIKE public.market_subproduct_categories INCLUDING ALL);
    CREATE TEMP TABLE _rh17_ft (LIKE public.market_file_types INCLUDING ALL);
    INSERT INTO _rh17_cat SELECT * FROM public.market_subproduct_categories;
    INSERT INTO _rh17_ft SELECT * FROM public.market_file_types;
    CREATE TRIGGER guard_rh17_cat BEFORE UPDATE OF slug, workspace_subject OR DELETE ON _rh17_cat
      FOR EACH ROW EXECUTE FUNCTION public.guard_market_subproduct_category_identity();
    CREATE TRIGGER guard_rh17_ft BEFORE UPDATE OF code, workspace_subject OR DELETE ON _rh17_ft
      FOR EACH ROW EXECUTE FUNCTION public.guard_market_file_type_identity();
    GRANT ALL ON _rh17_cat, _rh17_ft TO service_role;
    FOREACH v_q_text IN ARRAY ARRAY['postgres', 'service_role'] LOOP
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, v_q_text, 'WITH u AS (UPDATE _rh17_cat SET slug = slug || ''_x'' WHERE slug = ''question_pdf'' RETURNING 1) SELECT count(*)::text FROM u'),
        'ERR MARKET_IDENTIFIER_LOCKED', 'P7', v_q_text || ' 구성 slug 바꾸기 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, v_q_text, 'WITH u AS (UPDATE _rh17_cat SET workspace_subject = CASE workspace_subject WHEN ''korean'' THEN ''english'' ELSE ''korean'' END WHERE slug = ''workbook'' RETURNING 1) SELECT count(*)::text FROM u'),
        'ERR MARKET_IDENTIFIER_LOCKED', 'P7', v_q_text || ' 구성 과목만 바꾸기 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, v_q_text, 'WITH d AS (DELETE FROM _rh17_cat WHERE slug = ''question_hwp'' RETURNING 1) SELECT count(*)::text FROM d'),
        'ERR MARKET_IDENTIFIER_LOCKED', 'P7', v_q_text || ' 구성 hard DELETE 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, v_q_text, 'WITH u AS (UPDATE _rh17_cat SET name = name || '' '', description = ''d'', sort_order = sort_order + 1, is_active = NOT is_active, deleted_at = now(), slug = slug RETURNING 1) SELECT count(*)::text FROM u'),
        'OK', 'P7', v_q_text || ' 구성 이름·설명·순서·사용 여부·deleted_at(slug 같은 값) 통과');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, v_q_text, 'WITH u AS (UPDATE _rh17_ft SET code = ''pdf2'' WHERE code = ''pdf'' RETURNING 1) SELECT count(*)::text FROM u'),
        'ERR MARKET_IDENTIFIER_LOCKED', 'P7', v_q_text || ' 파일 유형 code 바꾸기 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, v_q_text, 'WITH u AS (UPDATE _rh17_ft SET workspace_subject = CASE workspace_subject WHEN ''korean'' THEN ''english'' ELSE ''korean'' END WHERE code = ''zip'' RETURNING 1) SELECT count(*)::text FROM u'),
        'ERR MARKET_IDENTIFIER_LOCKED', 'P7', v_q_text || ' 파일 유형 과목만 바꾸기 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, v_q_text, 'WITH d AS (DELETE FROM _rh17_ft WHERE code = ''zip'' AND workspace_subject = ''english'' RETURNING 1) SELECT count(*)::text FROM d'),
        'ERR MARKET_IDENTIFIER_LOCKED', 'P7', v_q_text || ' 파일 유형 hard DELETE 거절(영어 zip)');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, v_q_text, 'WITH u AS (UPDATE _rh17_ft SET label = label || '' '', sort_order = sort_order + 1, is_active = NOT is_active, deleted_at = now() RETURNING 1) SELECT count(*)::text FROM u'),
        'OK', 'P7', v_q_text || ' 파일 유형 표시명·순서·사용 여부·deleted_at 통과');
    END LOOP;
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', 'SELECT public.guard_market_file_type_identity()::text'), 'ERR', 'P9', '잠금 트리거 함수는 아무도 직접 못 부름');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P7', m FROM unnest(v_log) m;
END
$rh_p7$;

DO $rh_p8_0$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_id := gen_random_uuid();
    v_p := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rh17-new-' || left(v_id::text, 8) || '@test.com',
      '{"provider":"kakao"}'::jsonb, '{"avatar_url":"https://example.test/a.png","picture":"https://example.test/p.png","kakao_id":"rh17-kakao-1","kakao_email":"rh17-k@test.com","phone":"010-0000-0000","kakao_account":{"email":"rh17-ka@test.com","phone_number":"010-0000-0001","profile":{"profile_image_url":"https://example.test/k.png"}}}'::jsonb, now(), now());
    v_log := v_log || pg_temp.ensure((SELECT avatar_url IS NULL FROM public.profiles WHERE id = v_id), 'P8', '카카오 — 새 함수: avatar_url NULL');
    -- 옛 함수(down 원문)로 같은 메타데이터 시험 행을 하나 더 넣어 나머지 칸을 대조한다
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_old_handle_new_user')), 'OK', 'P8', '옛 함수로 잠깐 되돌림(이 경우 안에서만)');
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (v_p, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rh17-old-' || left(v_p::text, 8) || '@test.com',
      '{"provider":"kakao"}'::jsonb, '{"avatar_url":"https://example.test/a.png","picture":"https://example.test/p.png","kakao_id":"rh17-kakao-1","kakao_email":"rh17-k@test.com","phone":"010-0000-0000","kakao_account":{"email":"rh17-ka@test.com","phone_number":"010-0000-0001","profile":{"profile_image_url":"https://example.test/k.png"}}}'::jsonb, now(), now());
    v_log := v_log || pg_temp.ensure((SELECT avatar_url IS NOT NULL FROM public.profiles WHERE id = v_p), 'P8', '카카오 — 옛 함수는 avatar 를 읽었음(대조 기준)');
    v_log := v_log || pg_temp.ensure((SELECT (n.phone, n.kakao_id, n.provider, n.signup_completed) IS NOT DISTINCT FROM (o.phone, o.kakao_id, o.provider, o.signup_completed)
        AND (n.kakao_email = o.kakao_email OR (n.kakao_email LIKE 'rh17-new-%' AND o.kakao_email LIKE 'rh17-old-%'))
      FROM public.profiles n, public.profiles o WHERE n.id = v_id AND o.id = v_p), 'P8', '카카오 — provider·kakao_id·kakao_email·phone·signup_completed 옛 함수와 같음');
    INSERT INTO _rh_log (test, msg, payload) SELECT 'P8', '카카오 새 함수 결과',
      jsonb_build_object('provider', provider, 'signup_completed', signup_completed, 'kakao_id', kakao_id, 'avatar_url', avatar_url) FROM public.profiles WHERE id = v_id;
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P8', m FROM unnest(v_log) m;
END
$rh_p8_0$;

DO $rh_p8_1$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_id := gen_random_uuid();
    v_p := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rh17-new-' || left(v_id::text, 8) || '@test.com',
      '{"provider":"email"}'::jsonb, '{"avatar_url":"https://example.test/a2.png","picture":"https://example.test/p2.png"}'::jsonb, now(), now());
    v_log := v_log || pg_temp.ensure((SELECT avatar_url IS NULL FROM public.profiles WHERE id = v_id), 'P8', '이메일 — 새 함수: avatar_url NULL');
    -- 옛 함수(down 원문)로 같은 메타데이터 시험 행을 하나 더 넣어 나머지 칸을 대조한다
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_old_handle_new_user')), 'OK', 'P8', '옛 함수로 잠깐 되돌림(이 경우 안에서만)');
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (v_p, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rh17-old-' || left(v_p::text, 8) || '@test.com',
      '{"provider":"email"}'::jsonb, '{"avatar_url":"https://example.test/a2.png","picture":"https://example.test/p2.png"}'::jsonb, now(), now());
    v_log := v_log || pg_temp.ensure((SELECT avatar_url IS NOT NULL FROM public.profiles WHERE id = v_p), 'P8', '이메일 — 옛 함수는 avatar 를 읽었음(대조 기준)');
    v_log := v_log || pg_temp.ensure((SELECT (n.phone, n.kakao_id, n.provider, n.signup_completed) IS NOT DISTINCT FROM (o.phone, o.kakao_id, o.provider, o.signup_completed)
        AND (n.kakao_email = o.kakao_email OR (n.kakao_email LIKE 'rh17-new-%' AND o.kakao_email LIKE 'rh17-old-%'))
      FROM public.profiles n, public.profiles o WHERE n.id = v_id AND o.id = v_p), 'P8', '이메일 — provider·kakao_id·kakao_email·phone·signup_completed 옛 함수와 같음');
    INSERT INTO _rh_log (test, msg, payload) SELECT 'P8', '이메일 새 함수 결과',
      jsonb_build_object('provider', provider, 'signup_completed', signup_completed, 'kakao_id', kakao_id, 'avatar_url', avatar_url) FROM public.profiles WHERE id = v_id;
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P8', m FROM unnest(v_log) m;
END
$rh_p8_1$;

DO $rh_p9$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
  v_q_text text;
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, NULL, pg_temp.opt_id('korean', 'usage_basis', '확인 중'), '내부 메모'), 'OK', 'P9', '근거 1행');
    FOREACH v_q_text IN ARRAY ARRAY['public.market_item_attribute_options', 'public.market_item_usage_bases'] LOOP
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', format('SELECT count(*)::text FROM %s', v_q_text)), 'ERR', 'P9', v_q_text || ' anon SELECT 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(v_e, 'authenticated', format('SELECT count(*)::text FROM %s', v_q_text)), 'ERR', 'P9', v_q_text || ' 회원 세션 SELECT 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', format('SELECT count(*)::text FROM %s', v_q_text)), 'ERR', 'P9', v_q_text || ' 대표 세션 SELECT 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', format('SELECT count(*)::text FROM %s', v_q_text)), 'OK', 'P9', v_q_text || ' service_role SELECT');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', format('WITH d AS (DELETE FROM %s RETURNING 1) SELECT count(*)::text FROM d', v_q_text)), 'ERR', 'P9', v_q_text || ' service_role DELETE 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', format('WITH u AS (UPDATE %s SET revision = revision RETURNING 1) SELECT count(*)::text FROM u', v_q_text)), 'ERR', 'P9', v_q_text || ' service_role UPDATE 거절');
    END LOOP;
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role',
      format('WITH i AS (INSERT INTO public.market_item_attribute_options (workspace_subject, kind, label) VALUES (%L, %L, %L) RETURNING 1) SELECT count(*)::text FROM i', 'korean', 'grade', 'x')),
      'ERR', 'P9', 'service_role 목록 INSERT 거절');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role',
      format('WITH i AS (INSERT INTO public.market_item_usage_bases (item_id, workspace_subject, basis_option_id) VALUES (%L, %L, %L) RETURNING 1) SELECT count(*)::text FROM i',
        v_item_en, 'english', pg_temp.opt_id('english', 'usage_basis', '확인 중'))), 'ERR', 'P9', 'service_role 근거 INSERT 거절');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_e, 'authenticated', format('SELECT public.market_catalog_actor_allowed(%L)::text', v_owner)), 'ERR', 'P9', 'authenticated 는 행위자 판정을 부를 수 없음');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', 'SELECT public.save_market_item_display(NULL, 1, ''{}''::jsonb, ''{}''::jsonb)::text'), 'ERR', 'P9', 'anon 은 표시 설정 함수를 부를 수 없음');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated',
      format('SELECT public.save_market_item_usage_basis(%L, %L, NULL, %L, %L, %L, %L::jsonb)::text', v_owner, v_item_en, pg_temp.opt_id('english', 'usage_basis', '확인 중'), '', '', '{}')),
      'ERR', 'P9', 'authenticated 는 근거 저장 함수를 부를 수 없음');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role',
      format('SELECT public.save_market_item_option(%L, NULL, NULL, %L, %L, %L, true, %L::jsonb)::text', v_owner, 'english', 'grade', 'service 항목', '{}')),
      'OK', 'P9', 'service_role 은 저장 함수를 부름');
    -- 회원이 공개 상품 행을 읽어도 이용 근거는 없다(내부 전용 표 — market_items 에 새 칸 없음)
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'market_items'
      AND (column_name LIKE '%usage%' OR column_name LIKE '%basis%')), 'P9', 'market_items 에 이용 근거 칸 없음');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P9', m FROM unnest(v_log) m;
END
$rh_p9$;

DO $rh_b1_rows$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, NULL, pg_temp.opt_id('korean', 'usage_basis', '확인 중')), 'OK', 'B1', '근거 1행');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: usage bases exist', 'B1', '근거 행 있으면 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.subst_once(pg_temp.ctx('src_down'), '  c_allow_drop_usage_bases constant boolean := false;', '  c_allow_drop_usage_bases constant boolean := true;')), 'OK', 'B1', '대표 확인 뒤 down 통과');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B1', m FROM unnest(v_log) m;
END
$rh_b1_rows$;

DO $rh_b1_18$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    EXECUTE 'CREATE FUNCTION public.duplicate_market_item() RETURNS void LANGUAGE sql AS $x$ SELECT $x$';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: bundle 18/19 functions exist', 'B1', '18번 함수(duplicate_market_item) 있으면 멈춤');
    EXECUTE 'DROP FUNCTION public.duplicate_market_item()';
    EXECUTE 'CREATE FUNCTION public.reorder_market_item_subproducts() RETURNS void LANGUAGE sql AS $x$ SELECT $x$';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: bundle 18/19 functions exist', 'B1', '18번 함수(reorder_market_item_subproducts) 있으면 멈춤');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B1', m FROM unnest(v_log) m;
END
$rh_b1_18$;

DO $rh_b1_19$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    EXECUTE 'CREATE OR REPLACE FUNCTION public.save_market_item_display(p_actor_id uuid, p_expected_revision integer, p_value jsonb, p_request_meta jsonb) RETURNS jsonb LANGUAGE sql AS $x$ SELECT jsonb_build_object(''detail'', 1) $x$';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: bundle 18/19 functions exist', 'B1', '19번판 표시 설정 함수(본문에 detail) 있으면 멈춤');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B1', m FROM unnest(v_log) m;
END
$rh_b1_19$;

DO $rh_b1_fk$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    EXECUTE 'CREATE TABLE public._rh17_fk (id serial PRIMARY KEY, option_id uuid REFERENCES public.market_item_attribute_options(id))';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: other foreign keys reference market_item_attribute_options', 'B1', '다른 FK 있으면 멈춤');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B1', m FROM unnest(v_log) m;
END
$rh_b1_fk$;

DO $rh_b1$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'B1', '근거 없는 상태 down 은 확인 상수 없이 통과');
    v_log := v_log || pg_temp.ensure(to_regclass('public.market_item_attribute_options') IS NULL AND to_regclass('public.market_item_usage_bases') IS NULL
      AND to_regprocedure('public.market_catalog_actor_allowed(uuid)') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN ('guard_market_subproduct_category_identity', 'guard_market_file_type_identity'))
      AND NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'market_item_display')
      AND md5(pg_get_functiondef('public.handle_new_user()'::regprocedure)) = '61bc7b1469fb4dd6e795725040efe394', 'B1', '남는 것 0·가입 함수 옛 지문');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: bundle 17 tables missing', 'B1', '두 번째 down 은 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'B1', '다시 적용(VERIFY 통과)');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'grade', '다시 적용 뒤'), 'OK', 'B1', '다시 적용 뒤 저장');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'B1', m FROM unnest(v_log) m;
END
$rh_b1$;

DO $rh_p7f$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
  v_q_text text;
BEGIN
  BEGIN

    FOREACH v_q_text IN ARRAY ARRAY['postgres', 'service_role'] LOOP
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, v_q_text, 'WITH u AS (UPDATE public.market_subproduct_categories SET slug = slug || ''_x'' WHERE slug = ''question_pdf'' AND workspace_subject = ''korean'' RETURNING 1) SELECT count(*)::text FROM u'),
        'ERR MARKET_IDENTIFIER_LOCKED', 'P7F', v_q_text || ' 실제 구성 slug 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, v_q_text, 'WITH d AS (DELETE FROM public.market_file_types WHERE code = ''zip'' AND workspace_subject = ''english'' RETURNING 1) SELECT count(*)::text FROM d'),
        'ERR MARKET_IDENTIFIER_LOCKED', 'P7F', v_q_text || ' 실제 파일 유형 hard DELETE 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, v_q_text, 'WITH u AS (UPDATE public.market_file_types SET code = code WHERE workspace_subject = ''korean'' RETURNING 1) SELECT count(*)::text FROM u'),
        'OK', 'P7F', v_q_text || ' 실제 파일 유형 code 같은 값 UPDATE 통과');
    END LOOP;
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', 'WITH u AS (UPDATE public.market_subproduct_categories SET slug = ''x'' RETURNING 1) SELECT count(*)::text FROM u'),
      'ERR MARKET_IDENTIFIER_LOCKED', 'P7F', '대표 세션(브라우저, RLS 쓰기 허용) slug 바꾸기도 거절');
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT 'P7F', m FROM unnest(v_log) m;
END
$rh_p7f$;

DO $rh_f$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'F', 'down 원본(근거 없음 — 트리거·FK 포함)');
    DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261219100000';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'F', '이력 행 지운 뒤 다시 적용');
    INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261219100000', 'bundle17_product_info');
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, NULL, pg_temp.opt_id('korean', 'usage_basis', '확인 중')), 'OK', 'F', '다시 적용 뒤 근거 저장');
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
  v_id uuid;
  v_p uuid;
  v_q uuid;
  v_ids uuid[];
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
  v_item_ko uuid := pg_temp.uid('item_ko');
  v_item_en uuid := pg_temp.uid('item_en');
BEGIN
  BEGIN

    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.market_item_attribute_options) = 26 AND (SELECT count(*) FROM public.market_item_usage_bases) = 0
      AND (SELECT count(*) FROM public.admin_audit_log WHERE action LIKE 'market_item_%' AND created_at >= now()) = 0
      AND pg_temp.display_rev() = 1
      AND NOT EXISTS (SELECT 1 FROM public.market_items WHERE source_type = '교과서(시험)'), 'Z', '경우 밖에 남은 항목·근거·17번 기록 0, 설정 행 revision 1, 상품 값 그대로(ROLLBACK 전)');
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
