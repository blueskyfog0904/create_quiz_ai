// 19번 묶음 리허설 생성기(계획 docs/plan-bundle19-product-display.md 4-6: 실제 파일을 실행하고, 사본은 생성기로 만들어 계약 시험으로 고정).
//   node supabase/scripts/bundle19_rehearsal/generate.mjs           → 이 폴더의 *.sql 을 다시 쓴다
//   node supabase/scripts/bundle19_rehearsal/generate.mjs --check   → 다시 만든 값과 파일이 다르면 실패
//   node supabase/scripts/bundle19_rehearsal/generate.mjs --preview → output/b19-product-display-preview.json(개발 미리보기 값, 9-2)
// 실행(운영 DB, postgres): supabase db query --remote --yes -o json --file supabase/scripts/bundle19_rehearsal/<파일>
//   모든 파일은 BEGIN … 마지막 SELECT … ROLLBACK 이다(COMMIT 없음). 결과는 ON COMMIT DROP 임시 표 _rh_log 로 받는다.
//   경우마다 표지 예외(RH_ISOLATE)로 격리한다 — 경우 안에서 만든 행·기록·행 잠금은 그 경우가 끝나면 되돌려진다.
//   계정: @test.com 시험 계정만 쓴다(실회원 id 를 쓰지 않음). 대표·직원 역할은 그 시험 계정을 거래 안에서만 관리자로 바꿔 쓴다.
//   상품: 실상품을 쓰지 않는다. 거래 안에서 시험 상품(rh19-…)·서브상품 구성 3개·서브상품·파일 행·전체구매를 새로 만든다.
//   17·18번이 아직 적용되지 않았으면 그 사본(light 파일은 17번 light 사본·18번 원본, full 파일은 둘 다 원본)을 먼저 같은 거래에 넣는다.
//   a_light.sql — 지금(낮) 돌려도 됨: 19번은 설정 행 한 줄 UPDATE·함수 만들기·교체뿐(기존 표 DDL 없음 — light 사본 = 원본).
//     표시명 스크립트(R5·R6)는 대상 글자를 시험 글자('rh19 …')로 바꾼 사본을 돌려 실상품 행을 건드리지 않는다.
//   b_full.sql — DB 적용 직전(새벽): light 경우 전부 + 적용 절차(이력 INSERT)·down·이력 지우고 다시 적용(F).
//     표시명 스크립트는 원본 글자 그대로(실상품 행 포함 — ROLLBACK 됨)로 돌려 실제 건수에서 대조·VERIFY 를 본다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildPreviewData as bundle17PreviewData,
  downCopy as bundle17DownCopy,
  migrationCopy as bundle17MigrationCopy,
  seedDisplayFromMigration as bundle17SeedDisplay,
} from '../bundle17_rehearsal/generate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

export const SOURCES = {
  migration: 'supabase/migrations/20261221100000_bundle19_product_display.sql',
  down: 'supabase/rollback/20261221100000_bundle19_product_display_down.sql',
  bundle18: 'supabase/migrations/20261220100000_bundle18_product_duplicate.sql',
  label: 'supabase/scripts/20261221_bundle19_bundle_label.sql',
  labelRevert: 'supabase/scripts/20261221_bundle19_bundle_label_revert.sql',
}
export const MIGRATION_VERSION = '20261221100000'
export const MIGRATION_NAME = 'bundle19_product_display'
export const BUNDLE17_DISPLAY_FINGERPRINT = '5cd1e1f548bd73aea05f5845a0212a6a'
export const OLD_BUNDLE_LABEL = '전체 한번에 구매하기'
export const NEW_BUNDLE_LABEL = '전체 패키지'
// light 에서 표시명 스크립트가 대상으로 삼는 시험 글자(실상품 행은 이 글자가 아니다)
export const REHEARSAL_OLD_LABEL = 'rh19 전체 한번에 구매하기'
// 작업 기록 details 키(C 정렬, 계약 시험과 같은 목록)
export const AUDIT_DETAIL_KEYS = {
  market_subproduct_reorder: ['after', 'before', 'item_id', 'request'],
  market_item_display_update: ['after', 'before', 'request', 'revision_after', 'revision_before', 'saved_at'],
  market_bundle_label_bulk_update_apply: ['count', 'ids', 'mode', 'new_label', 'old_label'],
  market_bundle_label_bulk_update_revert: ['count', 'ids', 'kept_ids', 'mode', 'new_label', 'old_label'],
}
// light 에 남으면 안 되는 글(기존 표를 잠그는 DDL·기본값 바꾸기·이력 표 쓰기·COMMIT). 17번 사본은 17번 생성기가 따로 검사한다.
export const LIGHT_FORBIDDEN = ['ALTER TABLE', 'CREATE TRIGGER', 'DROP TRIGGER', 'CREATE POLICY', 'DROP POLICY', 'LOCK TABLE', 'CREATE INDEX',
  'DROP TABLE', 'SET DEFAULT', 'supabase_migrations', 'COMMIT;']

const REQUEST_META = '{"ip": "203.0.113.19", "user_agent": "rh19"}'

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
  assertLight(sql, 'bundle 19 migration')
  return sql
}
export function downSource() {
  const sql = read(SOURCES.down)
  assertLight(sql, 'bundle 19 down')
  return sql
}
function bundle18Source() {
  const sql = read(SOURCES.bundle18)
  assertLight(sql, 'bundle 18 migration')
  return sql
}

// 마이그레이션 첫 값(detail) — 미리보기·계약 시험이 같이 쓴다
export function seedDetailFromMigration() {
  const match = read(SOURCES.migration).match(/\$json_bundle19_detail\$([\s\S]*?)\$json_bundle19_detail\$/)
  if (!match) throw new Error('seed detail not found in migration')
  return JSON.parse(match[1])
}

// 표시명 스크립트의 DO 블록(BEGIN·SET LOCAL·마지막 SELECT·COMMIT 을 뺀 본문)
function scriptBlock(path, tag) {
  const sql = read(path)
  const start = sql.indexOf(`DO $${tag}$`)
  const endMarker = `$${tag}$;`
  const end = sql.indexOf(endMarker, start + tag.length + 5)
  if (start < 0 || end < 0) throw new Error(`${path}: DO block ${tag} not found`)
  const block = sql.slice(start, end + endMarker.length)
  assertLight(block, path)
  return block
}

function replaceOnce(text, from, to, label) {
  const count = text.split(from).length - 1
  if (count !== 1) throw new Error(`${label}: expected exactly one "${from}" (found ${count})`)
  return text.replace(from, to)
}

// 리허설용 상수 채우기: 행위자 = 거래 안의 시험 대표, 건수·md5 = 그 자리에서 센 값. light 는 대상 글자를 시험 글자로 바꾼다.
export function labelScriptCopy(mode) {
  const oldLabel = mode === 'light' ? REHEARSAL_OLD_LABEL : OLD_BUNDLE_LABEL
  let block = scriptBlock(SOURCES.label, 'bundle19_bundle_label')
  block = replaceOnce(block, 'c_actor_id constant uuid := NULL;', "c_actor_id constant uuid := pg_temp.uid('owner');", 'label')
  block = replaceOnce(block, 'c_expected_count constant integer := NULL;',
    `c_expected_count constant integer := (SELECT count(*)::integer FROM public.market_item_bundle_options WHERE label = ${sqlString(oldLabel)});`, 'label')
  block = replaceOnce(block, 'c_expected_ids_md5 constant text := NULL;',
    `c_expected_ids_md5 constant text := (SELECT md5(coalesce(string_agg(id::text, ',' ORDER BY id), '')) FROM public.market_item_bundle_options WHERE label = ${sqlString(oldLabel)});`, 'label')
  if (mode === 'light') {
    block = replaceOnce(block, `c_old_label constant text := ${sqlString(OLD_BUNDLE_LABEL)};`, `c_old_label constant text := ${sqlString(REHEARSAL_OLD_LABEL)};`, 'label')
  }
  return block
}
export function labelScriptRaw() {
  return scriptBlock(SOURCES.label, 'bundle19_bundle_label')
}
export function labelRevertCopy(mode) {
  let block = scriptBlock(SOURCES.labelRevert, 'bundle19_bundle_label_revert')
  block = replaceOnce(block, 'c_actor_id constant uuid := NULL;', "c_actor_id constant uuid := pg_temp.uid('owner');", 'revert')
  if (mode === 'light') {
    block = replaceOnce(block, `c_restore_label constant text := ${sqlString(OLD_BUNDLE_LABEL)};`, `c_restore_label constant text := ${sqlString(REHEARSAL_OLD_LABEL)};`, 'revert')
  }
  return block
}

function prelude({ title, when, mode }) {
  return `-- 19번 묶음 리허설: ${title}
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle19_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle19_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
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
CREATE FUNCTION pg_temp.audit_keys_ok(p_action text, p_keys text[], p_mode text DEFAULT NULL) RETURNS boolean LANGUAGE sql AS $f$
  SELECT count(*) > 0 AND bool_and(a.reason IS NULL
     AND ARRAY(SELECT k FROM jsonb_object_keys(a.details) k ORDER BY k COLLATE "C") = p_keys)
    FROM public.admin_audit_log a WHERE a.action = p_action AND a.created_at >= now()
     AND (p_mode IS NULL OR a.details ->> 'mode' = p_mode)
$f$;
-- 함수 부르기(plpgsql — 함수는 마이그레이션 뒤에 생긴다): 'OK {json}' 또는 'ERR …'
CREATE FUNCTION pg_temp.reorder(p_actor uuid, p_item uuid, p_ids uuid[], p_request jsonb DEFAULT ${sqlString(REQUEST_META)}::jsonb)
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
    coalesce(p_revision, pg_temp.display_rev()), p_value, ${sqlString(REQUEST_META)}));
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

SELECT pg_temp.ctx_set('src_17', ${dollar('rh_src_17', bundle17MigrationCopy(mode))});
SELECT pg_temp.ctx_set('src_17_down', ${dollar('rh_src_17_down', bundle17DownCopy(mode))});
SELECT pg_temp.ctx_set('src_18', ${dollar('rh_src_18', bundle18Source())});
SELECT pg_temp.ctx_set('src_migration', ${dollar('rh_src_migration', migrationSource())});
SELECT pg_temp.ctx_set('src_down', ${dollar('rh_src_down', downSource())});
SELECT pg_temp.ctx_set('src_label', ${dollar('rh_src_label', labelScriptCopy(mode))});
SELECT pg_temp.ctx_set('src_label_raw', ${dollar('rh_src_label_raw', labelScriptRaw())});
SELECT pg_temp.ctx_set('src_label_revert', ${dollar('rh_src_label_revert', labelRevertCopy(mode))});
SELECT pg_temp.ctx_set('old_label', ${sqlString(mode === 'light' ? REHEARSAL_OLD_LABEL : OLD_BUNDLE_LABEL)});
SELECT pg_temp.ctx_set('mode', ${sqlString(mode)});
`
}

// 17·18번이 아직 없으면 사본을 먼저 넣는다(운영 미적용 2026-11-26). 있으면 건너뛴다.
const APPLY_PREVIOUS = (mode) => `
-- ===== 17·18번(앞 묶음) — 없으면 ${mode === 'light' ? '17번 light 사본(기존 표 DDL 구역을 뺌)·18번 원본' : '17·18번 원본'}을 같은 거래에 넣는다 =====
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
    jsonb_build_object('fp', pg_temp.ctx('s0_fp'), 'expected', ${sqlString(BUNDLE17_DISPLAY_FINGERPRINT)}));
END
$rh_apply_previous$;
`

const SETUP = `
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
`

function isolatedCase(tag, test, body) {
  return `
DO $${tag}$
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

// R1: 적용 직후(VERIFY 는 마이그레이션 안 블록)·다시 적용 거절·권한·첫 값·17번 down 멈춤 → down 이 17번 상태로 → 다시 적용
const R1 = isolatedCase('rh_r1', 'R1', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK:', 'R1', '다시 적용 거절');
    v_log := v_log || pg_temp.ensure(NOT has_function_privilege('anon', 'public.reorder_market_item_subproducts(uuid,uuid,uuid[],jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.reorder_market_item_subproducts(uuid,uuid,uuid[],jsonb)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.reorder_market_item_subproducts(uuid,uuid,uuid[],jsonb)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.save_market_item_display(uuid,integer,jsonb,jsonb)', 'EXECUTE'), 'R1', 'EXECUTE 는 service_role 만');
    v_log := v_log || pg_temp.ensure(pg_temp.ctx('s0_fp') = ${sqlString(BUNDLE17_DISPLAY_FINGERPRINT)}, 'R1', '적용 전 지문 = 사전 점검 상수');
    v_log := v_log || pg_temp.ensure(pg_temp.display_rev() = (pg_temp.ctx('s0_value')::jsonb ->> 'revision')::integer + 1
      AND (pg_temp.display_value() - 'revision' - 'detail') = (pg_temp.ctx('s0_value')::jsonb - 'revision'), 'R1', '판 +1, 17번 키 그대로');
    v_log := v_log || pg_temp.ensure(current_setting('bundle19.revision_before')::integer = (pg_temp.ctx('s0_value')::jsonb ->> 'revision')::integer
      AND pg_temp.display_rev() = current_setting('bundle19.revision_before')::integer + 1, 'R1', 'VERIFY 의 적용 전 판 보관 = 17번 상태 판(정확히 +1)');
    v_log := v_log || pg_temp.ensure(pg_temp.display_value() -> 'detail' -> 'sampleDescription' = to_jsonb('샘플 {장수}장을 미리 볼 수 있어요.'::text)
      AND jsonb_array_length(pg_temp.display_value() -> 'detail' -> 'infoItems') = 6, 'R1', '첫 값(샘플 문장·infoItems 6개)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_17_down')), 'ERR DOWN PRECHECK: bundle 18/19 functions exist', 'R1', '19번 상태에서 17번 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'R1', 'down');
    v_log := v_log || pg_temp.ensure(to_regprocedure('public.reorder_market_item_subproducts(uuid,uuid,uuid[],jsonb)') IS NULL
      AND md5(pg_get_functiondef('public.save_market_item_display(uuid,integer,jsonb,jsonb)'::regprocedure)) = ${sqlString(BUNDLE17_DISPLAY_FINGERPRINT)}
      AND (pg_temp.display_value() - 'revision') = (pg_temp.ctx('s0_value')::jsonb - 'revision')
      AND pg_temp.display_rev() = (pg_temp.ctx('s0_value')::jsonb ->> 'revision')::integer + 2, 'R1', 'down → 17번 상태(행 값·함수 지문, 판 +2)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK:', 'R1', '없을 때 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'R1', '다시 적용(VERIFY 통과)');`)

// R2: 표시 설정 저장 — 합치기 규칙·검사·판 충돌·권한·기록
const R2 = isolatedCase('rh_r2', 'R2', `
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
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{sampleTitle}', to_jsonb(E'샘플\\n제목'::text))),
      'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.sampleTitle', 'R2', '줄바꿈 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{summaryLabels,unknown}', '" "')),
      'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:detail.summaryLabels.unknown', 'R2', '빈 요약 이름 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, '{}'::jsonb), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:value', 'R2', '빈 값 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, '{"revision": 9}'::jsonb), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:value', 'R2', '모르는 최상위 키 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_owner, pg_temp.detail_with('{sampleTitle}', '"rh19 충돌"'), pg_temp.display_rev() - 1),
      'ERR MARKET_ITEM_DISPLAY_REVISION_CONFLICT', 'R2', '판 충돌');
    v_log := v_log || pg_temp.expect(pg_temp.save_display(v_e, pg_temp.detail_with('{sampleTitle}', '"rh19 회원"')), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'R2', '일반 회원 거절');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_item_display_update') = 5
      AND pg_temp.audit_keys_ok('market_item_display_update', ${sqlArray(AUDIT_DETAIL_KEYS.market_item_display_update)}), 'R2', '성공 5건만 기록·details 키');`)

// R3: 서브상품 순서 — 권한(17번 P1 과 같은 표)·집합 불일치·지운 서브상품·사용 안 함 포함·같은 순서 → 기록 0·10×순번
const R3 = isolatedCase('rh_r3', 'R3', `
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
      AND pg_temp.audit_keys_ok('market_subproduct_reorder', ${sqlArray(AUDIT_DETAIL_KEYS.market_subproduct_reorder)})
      AND EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action = 'market_subproduct_reorder' AND a.created_at >= now()
        AND a.actor_id = v_owner AND a.target_type = 'market_item' AND a.target_id = v_a::text
        AND a.details -> 'before' = to_jsonb(ARRAY[v_s1, v_s2, v_s3]) AND a.details -> 'after' = to_jsonb(ARRAY[v_s3, v_s1, v_s2])),
      'R3', '성공 2건만 기록(같은 순서는 기록 없음)·before/after');
    UPDATE public.market_items SET deleted_at = now() WHERE id = v_a;
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, v_a, ARRAY[v_s1, v_s3, v_s2]), 'ERR MARKET_ITEM_NOT_FOUND', 'R3', '지운 상품 거절');`)

// R4: 순서 저장 뒤 공개 읽기 쿼리(sort_order, created_at)가 새 순서
const R4 = isolatedCase('rh_r4', 'R4', `
    v_log := v_log || pg_temp.ensure(pg_temp.public_order(v_a) = ARRAY[v_s1, v_s2, v_s3], 'R4', '저장 전 공개 순서(0·0·1, 같은 값은 만든 순서)');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, v_a, ARRAY[v_s2, v_s3, v_s1]), 'OK', 'R4', '순서 저장');
    v_log := v_log || pg_temp.ensure(pg_temp.public_order(v_a) = ARRAY[v_s2, v_s3, v_s1], 'R4', '공개 읽기 = 새 순서');`)

// R5: 표시명 스크립트 — 상수 비면 멈춤·건수 대조·실행 뒤 대상 0·기록 1건·되돌림(그 사이 고친 행은 남김)
const R5 = isolatedCase('rh_r5', 'R5', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_label_raw')), 'ERR BUNDLE_LABEL: fill', 'R5', '상수가 비면 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(replace(pg_temp.ctx('src_label'), 'c_expected_count constant integer := (', 'c_expected_count constant integer := 1 + (')),
      'ERR BUNDLE_LABEL: target rows changed', 'R5', '건수가 다르면 멈춤');
    SELECT count(*)::integer INTO v_n FROM public.market_item_bundle_options WHERE label = pg_temp.ctx('old_label');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_label')), 'OK', 'R5', '실행(대상 ' || v_n || '건)');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM public.market_item_bundle_options WHERE label = pg_temp.ctx('old_label'))
      AND (SELECT count(*) FROM public.market_item_bundle_options WHERE item_id IN (v_a, v_b) AND label = ${sqlString(NEW_BUNDLE_LABEL)}) = 2, 'R5', '대상 0건, 시험 행 2개 새 글자');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_bundle_label_bulk_update') = 1
      AND pg_temp.audit_keys_ok('market_bundle_label_bulk_update', ${sqlArray(AUDIT_DETAIL_KEYS.market_bundle_label_bulk_update_apply)}, 'apply')
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
      AND pg_temp.audit_keys_ok('market_bundle_label_bulk_update', ${sqlArray(AUDIT_DETAIL_KEYS.market_bundle_label_bulk_update_revert)}, 'revert')
      AND EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action = 'market_bundle_label_bulk_update' AND a.created_at >= now()
        AND a.details ->> 'mode' = 'revert' AND a.details -> 'kept_ids' = to_jsonb(ARRAY[(SELECT id FROM public.market_item_bundle_options WHERE item_id = v_b)])
        AND (a.details ->> 'count')::integer = v_n - 1), 'R5', '되돌림 기록 1건(남긴 행 id)');`)

// R6: 결제 판정·동의 — 스크립트 전후 가격·살 수 있음 값이 같고 줄 이름만 바뀜, 동의 문구·지문이 글자까지 같음(읽기만)
const R6 = isolatedCase('rh_r6', 'R6', `
    v_j := pg_temp.evaluate(v_e, v_a);
    v_r := pg_temp.consent_snapshot();
    v_log := v_log || pg_temp.ensure((SELECT e ->> 'optionTitle' FROM jsonb_array_elements(v_j) e WHERE e ->> 'targetKind' = 'bundle') = pg_temp.ctx('old_label'),
      'R6', '스크립트 전 묶음 줄 이름 = 옛 글자');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_label')), 'OK', 'R6', '표시명 스크립트');
    v_k := pg_temp.evaluate(v_e, v_a);
    v_log := v_log || pg_temp.ensure(pg_temp.without_title(v_j) = pg_temp.without_title(v_k), 'R6', '판정 값(가격·살 수 있음·사유) 같음');
    v_log := v_log || pg_temp.ensure((SELECT e ->> 'optionTitle' FROM jsonb_array_elements(v_k) e WHERE e ->> 'targetKind' = 'bundle') = ${sqlString(NEW_BUNDLE_LABEL)},
      'R6', '묶음 줄 이름만 새 글자');
    v_log := v_log || pg_temp.ensure(pg_temp.consent_snapshot() = v_r, 'R6', '동의 문구·지문(장바구니·2판) 글자까지 같음');
    -- 경우 안의 INSERT 는 격리로 되돌려지므로 근거는 v_log 글로 남긴다
    v_log := v_log || ('묶음 판정 전 ' || (SELECT (e - 'targetId' - 'itemId' - 'workspaceSubject')::text FROM jsonb_array_elements(v_j) e WHERE e ->> 'targetKind' = 'bundle'));
    v_log := v_log || ('묶음 판정 뒤 ' || (SELECT (e - 'targetId' - 'itemId' - 'workspaceSubject')::text FROM jsonb_array_elements(v_k) e WHERE e ->> 'targetKind' = 'bundle'));
    v_log := v_log || ('동의 묶음(앞부분) ' || left(v_r, 200));`)

const LEFTOVER = isolatedCase('rh_leftover', 'Z', `
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_subproduct_reorder') = 0 AND pg_temp.audit_count('market_bundle_label_bulk_update') = 0
      AND pg_temp.audit_count('market_item_display_update') = 0
      AND (SELECT count(*) FROM public.market_item_bundle_options WHERE label = pg_temp.ctx('old_label') AND item_id IN (v_a, v_b)) = 2
      AND pg_temp.public_order(v_a) = ARRAY[v_s1, v_s2, v_s3], 'Z', '경우 밖에 남은 기록·바뀐 행 0(ROLLBACK 전)');`)

const BEFORE_APPLY = isolatedCase('rh_before', 'F0', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK:', 'F0', '적용 전 down 멈춤');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = ${sqlString(MIGRATION_VERSION)}), 'F0', '이력 행 없음');`)

const HISTORY_INSERT = `
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (${sqlString(MIGRATION_VERSION)}, ${sqlString(MIGRATION_NAME)});
`

const CASE_F = isolatedCase('rh_f', 'F', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'F', 'down 원본');
    DELETE FROM supabase_migrations.schema_migrations WHERE version = ${sqlString(MIGRATION_VERSION)};
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'F', '이력 행 지운 뒤 다시 적용');
    INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (${sqlString(MIGRATION_VERSION)}, ${sqlString(MIGRATION_NAME)});
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, v_a, ARRAY[v_s3, v_s1, v_s2]), 'OK', 'F', '다시 적용 뒤 순서 저장');`)

const APPLY_HEAD = `
-- ===== 19번 마이그레이션(원본 그대로 — 설정 행 UPDATE·함수, 기존 표 DDL 없음) =====
`

const FOOT = `
SELECT n, test, msg, payload FROM _rh_log ORDER BY n;
ROLLBACK;
`

export function buildRehearsalFiles() {
  const cases = R1 + R2 + R3 + R4 + R5 + R6
  const light = prelude({
    title: 'A light — 17·18번 사본(없으면) + 19번 원본, 경우 R1~R6',
    when: '지금(낮) 돌려도 됨: 설정 행 한 줄 UPDATE·함수 만들기(표 잠금 없음)·기존 표에는 새 행 INSERT 와 시험 행 UPDATE 만·시험 계정 행 UPDATE. 이력 표는 쓰지 않는다. 표시명 스크립트는 시험 글자 사본.',
    mode: 'light',
  }) + APPLY_PREVIOUS('light') + APPLY_HEAD + migrationSource() + '\n' + SETUP + cases + LEFTOVER + FOOT
  const full = prelude({
    title: 'B full — 17·18번 원본(없으면) + 적용 절차(이력 INSERT) + 경우 R1~R6(표시명 스크립트 원본 글자) + down·이력 지우고 다시 적용(F)',
    when: 'DB 적용 직전(supabase_migrations 이력 표에 씀, 표시명 스크립트가 실상품 전체구매 행을 잠깐 잠금 — ROLLBACK 됨). 17번이 아직 없으면 17번 원본의 기존 표 DDL 잠금이 ROLLBACK 까지 이어지므로 새벽에.',
    mode: 'full',
  }) + APPLY_PREVIOUS('full') + BEFORE_APPLY + APPLY_HEAD + migrationSource() + '\n' + HISTORY_INSERT + SETUP + cases + CASE_F + LEFTOVER + FOOT

  const files = { 'a_light.sql': light, 'b_full.sql': full }
  for (const [name, content] of Object.entries(files)) {
    if (/\bCOMMIT\s*;/.test(content)) throw new Error(`${name} contains a COMMIT statement`)
    if (!content.trimEnd().endsWith('ROLLBACK;')) throw new Error(`${name} must end with ROLLBACK`)
  }
  return files
}

// ── 개발 미리보기 값(9-2, output/ 은 git 에 넣지 않는다) ───────────────────────────────────────────────────────
// 17번 미리보기 값(목록·이용 근거)에 19번 detail 을 더한 설정 행. PRODUCT_INFO_PREVIEW_FILE·PRODUCT_DISPLAY_PREVIEW_FILE 둘 다 이 파일을 쓴다.
export function buildPreviewData() {
  const base = bundle17PreviewData()
  const display = { ...bundle17SeedDisplay(), revision: 2, detail: seedDetailFromMigration() }
  const id = (n) => `00000000-0000-4000-8000-0000000019${String(n).padStart(2, '0')}`
  const fileType = (n, code, label) => ({ id: id(80 + n), code, label, extension: code, requiredProgram: null })
  const subproduct = (n, slug, name, price, fileTypes, extra = {}) => ({
    id: id(10 + n), itemId: id(1), categoryId: id(20 + n), categoryName: name, categorySlug: slug, title: name, description: null,
    purchaseNoticeLabel: null, purchaseNoticeText: null, priceCredits: price, sortOrder: 10 * n, fileCount: 1, fileTypes,
    files: [{ id: id(40 + n), name: `${name} 예시 파일` }], owned: false, ownedScope: null, upgradePriceCredits: null, purchasedAt: null, ...extra,
  })
  return {
    ...base,
    _comment: '19번 개발 미리보기 값(생성 파일). PRODUCT_INFO_PREVIEW=1 PRODUCT_INFO_PREVIEW_FILE=output/b19-product-display-preview.json '
      + 'PRODUCT_DISPLAY_PREVIEW=1 PRODUCT_DISPLAY_PREVIEW_FILE=output/b19-product-display-preview.json npm run dev',
    display,
    // 상세 미리보기(/preview/solvook-concept/product-display) 예시 상품 — 가짜 id 라 조회 기록 route 는 404(쓰기 없음)
    detailPreview: {
      item: {
        id: id(1), workspace_subject: 'korean', subject_code: 'korean', category_item_id: null, menu_entry_id: null,
        title: '[미리보기] 2025 3월 고1 학력평가 국어 변형 문제', summary: '미리보기 예시 상품입니다. 운영 DB 를 읽지 않습니다.',
        description: '상세 안내 문구·자료 정보 항목·전체구매 제목을 설정 값으로 그립니다.', thumbnail_image_id: null, thumbnail_url: null, thumbnailUrl: null,
        exam_year: 2025, exam_month: 3, grade_level: '1학년', source_type: '모의고사', source_1: '2025 3월 학력평가', source_2: '국어 영역',
        source_3: null, source_4: null, question_count: 45, pdf_price: 0, hwp_price: 0, zip_price: 0, status: 'published', draft_source: 'manual',
        is_active: true, published_at: '2026-11-20T03:00:00.000Z', view_count: 0, sort_order: 0, created_by: null, updated_by: null,
        created_at: '2026-11-20T03:00:00.000Z', updated_at: '2026-11-20T03:00:00.000Z', deleted_at: null,
      },
      subproducts: [
        subproduct(1, 'question_hwp', '문제(HWP)', 3000, [fileType(1, 'hwp', 'HWP'), fileType(2, 'pdf', 'PDF')]),
        subproduct(2, 'workbook', '워크북', 2000, [fileType(2, 'pdf', 'PDF')]),
      ],
      bundle: { id: id(60), itemId: id(1), description: null, priceCredits: 4000, owned: false, purchasedAt: null },
      bundleLabels: { named: '1학기 중간고사 대비 전체 묶음', empty: '', long: '가나다라마바사아자차카타파하'.repeat(3).slice(0, 40) },
    },
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--preview')) {
    const out = join(ROOT, 'output/b19-product-display-preview.json')
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify(buildPreviewData(), null, 2)}\n`)
    console.log(`wrote ${out}`)
    process.exit(0)
  }
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
