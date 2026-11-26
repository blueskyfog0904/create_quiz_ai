// 18번 묶음 리허설 생성기(계획 docs/plan-bundle18-product-upload.md 6-3: 실제 파일을 실행하고, 사본은 생성기로 만들어 계약 시험으로 고정).
//   node supabase/scripts/bundle18_rehearsal/generate.mjs           → 이 폴더의 *.sql 을 다시 쓴다
//   node supabase/scripts/bundle18_rehearsal/generate.mjs --check   → 다시 만든 값과 파일이 다르면 실패
// 실행(운영 DB, postgres): supabase db query --remote --yes -o json --file supabase/scripts/bundle18_rehearsal/<파일>
//   모든 파일은 BEGIN … 마지막 SELECT … ROLLBACK 이다(COMMIT 없음). 결과는 ON COMMIT DROP 임시 표 _rh_log 로 받는다.
//   경우마다 표지 예외(RH_ISOLATE)로 격리한다 — 경우 안에서 만든 행·기록은 그 경우가 끝나면 되돌려진다.
//   계정: @test.com 시험 계정만 쓴다(실회원 id 를 쓰지 않음). 대표·직원 역할은 그 시험 계정을 거래 안에서만 관리자로 바꿔 쓴다.
//   상품: 실상품을 쓰지 않는다. 거래 안에서 시험 원본 상품(rh18-…)·서브상품 구성 3개(사용·비활성·지움)·서브상품·파일 행·전체구매를 새로 만든다.
//   17번이 아직 적용되지 않았으면 17번 사본(light 파일은 17번 light 사본, full 파일은 17번 원본)을 먼저 같은 거래에 넣는다.
//   a_light.sql — 지금(낮) 돌려도 됨: 18번은 함수 하나뿐(표·정책·트리거 없음 — 기존 표 DDL 이 없어 light 사본 = 원본).
//     기존 표에는 새 행 INSERT 만(ROW EXCLUSIVE), 시험 계정 profiles 행 UPDATE 만 한다.
//   b_full.sql — DB 적용 직전: light 경우 전부 + 적용 절차(이력 schema_migrations INSERT)·down·이력 지우고 다시 적용.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrationCopy as bundle17MigrationCopy } from '../bundle17_rehearsal/generate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

export const SOURCES = {
  migration: 'supabase/migrations/20261220100000_bundle18_product_duplicate.sql',
  down: 'supabase/rollback/20261220100000_bundle18_product_duplicate_down.sql',
}
export const MIGRATION_VERSION = '20261220100000'
export const MIGRATION_NAME = 'bundle18_product_duplicate'
// 작업 기록 details 키(C 정렬, 계약 시험과 같은 목록)
export const AUDIT_DETAIL_KEYS = ['bundle_copied', 'mode', 'new_item_id', 'request', 'source_item_id', 'subproduct_count']
// light 에 남으면 안 되는 글(기존 표를 잠그는 DDL·이력 표 쓰기·COMMIT). 17번 사본은 17번 생성기가 따로 검사한다.
export const LIGHT_FORBIDDEN = ['ALTER TABLE', 'CREATE TRIGGER', 'DROP TRIGGER', 'CREATE POLICY', 'DROP POLICY', 'LOCK TABLE', 'CREATE INDEX',
  'DROP TABLE', 'supabase_migrations', 'COMMIT;']

const REQUEST_META = '{"ip": "203.0.113.18", "user_agent": "rh18"}'

function dollar(tag, text) {
  if (text.includes(`$${tag}$`)) throw new Error(`source contains $${tag}$`)
  return `$${tag}$${text}$${tag}$`
}
const sqlString = (text) => `'${text.replaceAll("'", "''")}'`
const sqlArray = (items) => `ARRAY[${items.map(sqlString).join(', ')}]::text[]`

function assertLight(sql, label) {
  const body = sql.replace(/--[^\n]*/g, '')
  for (const word of LIGHT_FORBIDDEN) {
    if (body.includes(word)) throw new Error(`${label} still has ${word}`)
  }
}

export function migrationSource() {
  const sql = read(SOURCES.migration)
  assertLight(sql, 'bundle 18 migration')
  return sql
}
export function downSource() {
  const sql = read(SOURCES.down)
  return sql
}

function prelude({ title, when, mode }) {
  return `-- 18번 묶음 리허설: ${title}
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle18_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle18_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: ${when}
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
CREATE FUNCTION pg_temp.dup(p_actor uuid, p_subject text, p_item uuid, p_mode text, p_request jsonb DEFAULT ${sqlString(REQUEST_META)}::jsonb)
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

SELECT pg_temp.ctx_set('src_17', ${dollar('rh_src_17', bundle17MigrationCopy(mode))});
SELECT pg_temp.ctx_set('src_migration', ${dollar('rh_src_migration', migrationSource())});
SELECT pg_temp.ctx_set('src_down', ${dollar('rh_src_down', downSource())});
SELECT pg_temp.ctx_set('mode', ${sqlString(mode)});
`
}

// 17번이 아직 없으면 17번 사본을 먼저 넣는다(운영 미적용 2026-11-26). 있으면 건너뛴다.
const APPLY_17 = (mode) => `
-- ===== 17번(앞 묶음) — 없으면 ${mode === 'light' ? 'light 사본(기존 표 DDL 구역을 뺌)' : '원본'}을 같은 거래에 넣는다 =====
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
`

const SETUP = `
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
      AND o.is_active ORDER BY o.sort_order LIMIT 1), 'rh18', '', ${sqlString(REQUEST_META)})), 'OK', 'setup', '원본 A 이용 근거 저장');

  PERFORM pg_temp.ctx_set('src', v_src::text);
  PERFORM pg_temp.ctx_set('src_b', v_src_b::text);
  PERFORM pg_temp.ctx_set('src_c', v_src_c::text);
  PERFORM pg_temp.ctx_set('cat_inactive', v_cat_inactive::text);
  PERFORM pg_temp.ctx_set('src_row', (SELECT to_jsonb(i)::text FROM public.market_items i WHERE i.id = v_src));
  PERFORM pg_temp.ctx_set('src_subs', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)::text FROM public.market_item_subproducts s WHERE s.item_id = v_src));
  INSERT INTO _rh_log (test, msg, payload) VALUES ('setup', '시험 계정(@test.com)·시험 원본 상품 3개(rh18)', jsonb_build_object('pool', cardinality(v_pool)));
END
$rh_setup$;
`

function isolatedCase(tag, test, body) {
  return `
DO $${tag}$
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
${body}
    RAISE EXCEPTION 'RH_ISOLATE';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'RH_ISOLATE' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO _rh_log (test, msg) SELECT ${sqlString(test)}, m FROM unnest(v_log) m;
END
$${tag}$;
`
}

// D0: 적용 직후(VERIFY 는 마이그레이션 안 블록)·다시 적용 거절·함수 지문·권한
const CASE_D0 = `
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
`

const D1 = isolatedCase('rh_d1', 'D1', `
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
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_item_duplicate') = 2, 'D1', '성공 2건만 기록');`)

const D2 = isolatedCase('rh_d2', 'D2', `
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
      AND (SELECT count(*) FROM public.market_item_sample_pages p WHERE p.item_id = v_new) = 0, 'D2', '파일·샘플 0');`)

const D3 = isolatedCase('rh_d3', 'D3', `
    v_r := pg_temp.dup(v_owner, 'korean', v_src, 'copy');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'D3', 'copy');
    v_new := (pg_temp.res(v_r) ->> 'item_id')::uuid;
    v_log := v_log || pg_temp.ensure(EXISTS (SELECT 1 FROM public.market_items n, public.market_items s WHERE n.id = v_new AND s.id = v_src
      AND n.title = repeat('가', 115) || ' (사본)' AND char_length(n.title) = 120
      AND n.summary = s.summary AND n.description = s.description AND n.question_count = s.question_count
      AND n.thumbnail_image_id IS NOT DISTINCT FROM s.thumbnail_image_id AND n.status = 'draft' AND n.draft_source = 'manual'
      AND n.menu_entry_id IS NULL AND n.thumbnail_url IS NULL), 'D3', '제목 118자 → 120자 안 사본, 요약·설명·문항 수·이미지 같음, draft');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.market_subproduct_files f WHERE f.item_id = v_new) = 0
      AND (SELECT count(*) FROM public.market_item_sample_pages p WHERE p.item_id = v_new) = 0, 'D3', '파일·샘플 0');`)

const D4 = isolatedCase('rh_d4', 'D4', `
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
      AND (SELECT count(*) FROM public.market_item_subproducts s WHERE s.item_id = v_new) = 0, 'D4', '전체구매 없음 → 0행');`)

const D5 = isolatedCase('rh_d5', 'D5', `
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
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_item_duplicate') = 1, 'D5', '거절은 기록 없음(성공 1건만)');`)

const D6 = isolatedCase('rh_d6', 'D6', `
    v_new := (pg_temp.res(pg_temp.dup(v_owner, 'korean', v_src, 'copy')) ->> 'item_id')::uuid;
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.market_item_usage_bases b WHERE b.item_id = v_src) = 1
      AND (SELECT count(*) FROM public.market_item_usage_bases b WHERE b.item_id = v_new) = 0, 'D6', '원본 근거 1행, 사본 근거 0행');`)

const D7 = isolatedCase('rh_d7', 'D7', `
    v_new := (pg_temp.res(pg_temp.dup(v_owner, 'korean', v_src, 'copy')) ->> 'item_id')::uuid;
    SELECT public.evaluate_market_targets(v_e, (SELECT jsonb_agg(jsonb_build_object('targetKind', 'subproduct', 'targetId', s.id))
      FROM public.market_item_subproducts s WHERE s.item_id = v_new)
      || (SELECT coalesce(jsonb_agg(jsonb_build_object('targetKind', 'bundle', 'targetId', b.id)), '[]'::jsonb)
      FROM public.market_item_bundle_options b WHERE b.item_id = v_new)) INTO v_j;
    v_log := v_log || pg_temp.ensure(jsonb_array_length(v_j) = 4 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_j) e
      WHERE (e ->> 'available')::boolean OR (e ->> 'purchasable')::boolean OR e ->> 'reason' IS DISTINCT FROM 'UNAVAILABLE'),
      'D7', '사본 서브상품 3·전체구매 1 모두 살 수 없음(UNAVAILABLE — 공개 아님·파일 없음)');`)

const D8 = isolatedCase('rh_d8', 'D8', `
    v_new := (pg_temp.res(pg_temp.dup(v_owner, 'korean', v_src, 'next')) ->> 'item_id')::uuid;
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_item_duplicate') = 1
      AND pg_temp.audit_ok('market_item_duplicate', ${sqlArray(AUDIT_DETAIL_KEYS)})
      AND EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action = 'market_item_duplicate' AND a.created_at >= now()
        AND a.target_type = 'market_item' AND a.target_id = v_new::text AND a.actor_id = v_owner
        AND a.details ->> 'mode' = 'next' AND (a.details ->> 'source_item_id')::uuid = v_src AND (a.details ->> 'new_item_id')::uuid = v_new
        AND (a.details ->> 'subproduct_count')::integer = 3 AND (a.details ->> 'bundle_copied')::boolean), 'D8', '기록 1건·details 키·값');`)

// D9: down → 없을 때 down 멈춤 → 다시 적용(VERIFY 통과)
const D9 = isolatedCase('rh_d9', 'D9', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'D9', 'down(함수만 지움)');
    v_log := v_log || pg_temp.ensure(to_regprocedure('public.duplicate_market_item(uuid,text,uuid,text,jsonb)') IS NULL, 'D9', '함수 없음');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: duplicate_market_item missing', 'D9', '없을 때 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'D9', '다시 적용(VERIFY 통과)');`)

const LEFTOVER = isolatedCase('rh_leftover', 'Z', `
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_item_duplicate') = 0
      AND (SELECT count(*) FROM public.market_items i WHERE i.created_at >= now() AND i.title IN ('새 상품', repeat('가', 115) || ' (사본)')) = 0,
      'Z', '경우 밖에 남은 사본·기록 0(ROLLBACK 전)');`)

const BEFORE_APPLY = isolatedCase('rh_before', 'F0', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: duplicate_market_item missing', 'F0', '적용 전 down 멈춤');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = ${sqlString(MIGRATION_VERSION)}), 'F0', '이력 행 없음');`)

const HISTORY_INSERT = `
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (${sqlString(MIGRATION_VERSION)}, ${sqlString(MIGRATION_NAME)});
`

const CASE_F = isolatedCase('rh_f', 'F', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'F', 'down 원본');
    DELETE FROM supabase_migrations.schema_migrations WHERE version = ${sqlString(MIGRATION_VERSION)};
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'F', '이력 행 지운 뒤 다시 적용');
    INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (${sqlString(MIGRATION_VERSION)}, ${sqlString(MIGRATION_NAME)});
    v_log := v_log || pg_temp.expect(pg_temp.dup(v_owner, 'korean', v_src, 'copy'), 'OK', 'F', '다시 적용 뒤 복제');`)

const APPLY_HEAD = `
-- ===== 18번 마이그레이션(원본 그대로 — 함수 하나, 기존 표 DDL 없음) =====
`

const FOOT = `
SELECT n, test, msg, payload FROM _rh_log ORDER BY n;
ROLLBACK;
`

export function buildRehearsalFiles() {
  const cases = CASE_D0 + D1 + D2 + D3 + D4 + D5 + D6 + D7 + D8 + D9
  const light = prelude({
    title: 'A light — 17번 사본(없으면) + 18번 원본, 경우 D0~D9',
    when: '지금(낮) 돌려도 됨: 함수 하나 만들기(표 잠금 없음)·기존 표에는 새 행 INSERT 만·시험 계정 행 UPDATE. 이력 표는 쓰지 않는다.',
    mode: 'light',
  }) + APPLY_17('light') + APPLY_HEAD + migrationSource() + '\n' + SETUP + cases + LEFTOVER + FOOT
  const full = prelude({
    title: 'B full — 17번 원본(없으면) + 적용 절차(이력 INSERT) + 경우 D0~D9 + down·이력 지우고 다시 적용(F)',
    when: 'DB 적용 직전(supabase_migrations 이력 표에 씀 — ROLLBACK 됨). 17번이 아직 없으면 17번 원본의 기존 표 DDL 잠금이 ROLLBACK 까지 이어지므로 새벽에.',
    mode: 'full',
  }) + APPLY_17('full') + BEFORE_APPLY + APPLY_HEAD + migrationSource() + '\n' + HISTORY_INSERT + SETUP + cases + CASE_F + LEFTOVER + FOOT

  const files = { 'a_light.sql': light, 'b_full.sql': full }
  for (const [name, content] of Object.entries(files)) {
    if (/\bCOMMIT\s*;/.test(content)) throw new Error(`${name} contains a COMMIT statement`)
    if (!content.trimEnd().endsWith('ROLLBACK;')) throw new Error(`${name} must end with ROLLBACK`)
  }
  return files
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = buildRehearsalFiles()
  const check = process.argv.includes('--check')
  let stale = 0
  for (const [name, content] of Object.entries(files)) {
    const path = join(HERE, name)
    if (check) {
      let current = ''
      try { current = readFileSync(path, 'utf8') } catch { /* 없음 */ }
      if (current !== content) { stale += 1; console.error(`stale: ${name}`) }
    } else {
      writeFileSync(path, content)
      console.log(`wrote ${name} (${content.split('\n').length} lines)`)
    }
  }
  if (stale) process.exit(1)
}
