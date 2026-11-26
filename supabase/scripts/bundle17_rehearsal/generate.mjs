// 17번 묶음 리허설 생성기(계획 docs/plan-bundle17-product-info.md 5-8: 실제 파일을 실행하고, 사본은 생성기로 만들어 다른 줄을 계약 시험으로 고정).
// 원본(마이그레이션·down)과 예시 묶음(tests/fixtures/bundle17-product-info-examples.json)을 읽어 리허설 SQL 파일을 만든다.
//   node supabase/scripts/bundle17_rehearsal/generate.mjs           → 이 폴더의 *.sql 을 다시 쓴다
//   node supabase/scripts/bundle17_rehearsal/generate.mjs --check   → 다시 만든 값과 파일이 다르면 실패
//   node supabase/scripts/bundle17_rehearsal/generate.mjs --preview → output/b17-product-info-preview.json(개발 미리보기 값, 10-2)
// 실행(운영 DB, postgres): supabase db query --remote --yes -o json --file supabase/scripts/bundle17_rehearsal/<파일>
//   모든 파일은 BEGIN … 마지막 SELECT … ROLLBACK 이다(COMMIT 없음). 결과는 ON COMMIT DROP 임시 표 _rh_log 로 받는다.
//   경우마다 표지 예외(RH_ISOLATE)로 격리한다 — 경우 안에서 만든 행·기록은 그 경우가 끝나면 되돌려진다.
//   계정: @test.com 시험 계정만 쓴다(실회원 id 를 쓰지 않음). 대표·직원 역할은 그 시험 계정을 거래 안에서만 관리자로 바꿔 쓴다. 모자라면
//     'RH FAIL [setup]' 으로 멈춘다. 가입 트리거 경우(P8)만 auth.users 에 rh17-…@test.com 시험 행을 넣는다(거래 안, ROLLBACK).
//   13·14·16번(운영 미적용)에 기대지 않는다: 이 마이그레이션·함수는 그 묶음의 표·함수를 부르지 않는다.
//   지금(낮) 돌려도 되는 파일: a_light.sql — 마이그레이션 light 사본('[17번 기존 표 DDL]' 구역과 그 VERIFY 블록을 뺌):
//     새 표 2개·새 함수·system_settings 행 1개·handle_new_user 교체(함수만, 표 잠금 없음). market_items FK 와 기존 두 표의 트리거는 없다.
//     잠금 트리거 함수는 두 표의 임시 사본(CREATE TEMP TABLE … LIKE … INCLUDING ALL)에 붙여 시험한다(P7). 이름 바꾸기(P3)는 실상품
//     '교과서' 행에만 행 잠금, 이용 근거(P5)는 실상품 행 FOR SHARE 몇 초. down 도 light 사본(기존 표 DDL 구역을 뺌)으로 되돌리기·다시 적용을 본다.
//   새벽에만 돌릴 파일: b_full.sql — 마이그레이션 원본 그대로(FK·트리거 포함) + 적용 절차(이력 schema_migrations INSERT) + light 경우 전부 +
//     실제 두 표의 잠금 트리거(P7F)·down 원본 → 남는 것 0 → 다시 적용(F). 기존 표 잠금이 ROLLBACK 까지 이어지므로 **DB 적용 직전에만** 돌린다.
//   advisory lock 경합(같은 목록의 저장 두 건)은 BEGIN…ROLLBACK 한 거래로 재현할 수 없다 — 계약 시험이 잠금 순서를 단언한다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

export const SOURCES = {
  migration: 'supabase/migrations/20261219100000_bundle17_product_info.sql',
  down: 'supabase/rollback/20261219100000_bundle17_product_info_down.sql',
  examples: 'tests/fixtures/bundle17-product-info-examples.json',
}
export const MIGRATION_VERSION = '20261219100000'
export const MIGRATION_NAME = 'bundle17_product_info'

// light 사본에서 뺄 것(이름으로 찾는다): 마이그레이션의 기존 표 DDL 구역과 그 VERIFY 블록, down 의 기존 표 DDL 구역
export const MIGRATION_LIGHT_REMOVALS = [
  /\n-- 6\. \[17번 기존 표 DDL\] 시작[\s\S]*?\n-- \[17번 기존 표 DDL\] 끝[^\n]*\n/,
  /\n-- 기존 표 DDL 확인\(light 사본은 이 블록을 뺀다\)[^\n]*\nDO \$verify_bundle17_existing_tables\$\n[\s\S]*?\n\$verify_bundle17_existing_tables\$;\n/,
]
export const DOWN_LIGHT_REMOVALS = [
  /\n-- 1\. \[17번 기존 표 DDL\] 시작[\s\S]*?\n-- \[17번 기존 표 DDL\] 끝\n/,
]
// 새로 만드는 표(light 에서 ALTER TABLE·CREATE TRIGGER·REFERENCES 를 걸어도 되는 곳). _rh17_ 표는 경우 안에서 만든다(임시 사본·FK 시험 표).
export const NEW_TABLES = ['public.market_item_attribute_options', 'public.market_item_usage_bases', '_rh17_cat', '_rh17_ft', 'public._rh17_fk']
// light 에 남으면 안 되는 글(기존 표를 잠그는 DDL·이력 표 쓰기·COMMIT)
export const LIGHT_FORBIDDEN = [
  'LOCK TABLE', 'CREATE POLICY', 'ALTER POLICY', 'DROP POLICY', 'DROP TRIGGER', 'ADD COLUMN', 'DROP COLUMN',
  'ON public.market_subproduct_categories', 'ON public.market_file_types', 'ON public.market_items', 'ON public.system_settings',
  'ON public.profiles', 'ON auth.users', 'REFERENCES public.market_items', 'supabase_migrations', 'COMMIT;',
]

function assertLight(source, label) {
  // 주석(-- …)은 보지 않는다(설명 글에 금지어가 있다)
  const sql = source.replace(/--[^\n]*/g, '')
  for (const word of LIGHT_FORBIDDEN) {
    if (sql.includes(word)) throw new Error(`${label} light copy still has ${word}`)
  }
  for (const match of sql.matchAll(/ALTER TABLE ([a-z0-9_.]+)/g)) {
    if (!NEW_TABLES.includes(match[1])) throw new Error(`${label} light copy alters an existing table: ${match[1]}`)
  }
  for (const match of sql.matchAll(/CREATE TRIGGER \w+[\s\S]*?\bON ([a-z0-9_.]+)/g)) {
    if (!NEW_TABLES.includes(match[1])) throw new Error(`${label} light copy creates a trigger on an existing table: ${match[1]}`)
  }
  for (const match of sql.matchAll(/REFERENCES ((?:public\.)?[a-z0-9_]+)/g)) {
    if (!NEW_TABLES.includes(match[1])) throw new Error(`${label} light copy references an existing table: ${match[1]}`)
  }
  for (const match of sql.matchAll(/DROP TABLE ((?:public\.)?[a-z0-9_]+)/g)) {
    if (!NEW_TABLES.includes(match[1])) throw new Error(`${label} light copy drops an existing table: ${match[1]}`)
  }
}

function strip(sql, removals, label) {
  let out = sql
  for (const re of removals) {
    if (!re.test(out)) throw new Error(`${label} light copy: ${re} not found`)
    out = out.replace(re, '\n')
  }
  return out
}

export function migrationCopy(kind) {
  const sql = read(SOURCES.migration)
  if (kind === 'full') return sql
  if (kind !== 'light') throw new Error(`unknown migration copy ${kind}`)
  const light = strip(sql, MIGRATION_LIGHT_REMOVALS, 'migration')
  assertLight(light, 'migration')
  return light
}

export function downCopy(kind) {
  const sql = read(SOURCES.down)
  if (kind === 'full') return sql
  if (kind !== 'light') throw new Error(`unknown down copy ${kind}`)
  const light = strip(sql, DOWN_LIGHT_REMOVALS, 'down')
  assertLight(light, 'down')
  return light
}

// down 에 있는 handle_new_user 옛 정의(CREATE OR REPLACE … $function$;) — P8 이 옛 함수와 새 함수의 결과를 대조한다.
export function oldHandleNewUserDefinition() {
  const sql = read(SOURCES.down)
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.handle_new_user()')
  const end = sql.indexOf('$function$;', start)
  if (start < 0 || end < 0) throw new Error('old handle_new_user not found in down')
  return sql.slice(start, end + '$function$;'.length)
}

// down 의 대표 확인 상수: 바꾸는 줄은 이 한 줄뿐(경우 B1)
export const DOWN_ALLOW_LINE = ['  c_allow_drop_usage_bases constant boolean := false;', '  c_allow_drop_usage_bases constant boolean := true;']

export const EXAMPLES = JSON.parse(read(SOURCES.examples))

// 마이그레이션 첫 값(목록·표시 설정) — 미리보기·계약 시험이 같이 쓴다
export function seedOptionsFromMigration() {
  const match = read(SOURCES.migration).match(/\$json_bundle17_options\$([\s\S]*?)\$json_bundle17_options\$/)
  if (!match) throw new Error('seed options not found in migration')
  return JSON.parse(match[1])
}
export function seedDisplayFromMigration() {
  const match = read(SOURCES.migration).match(/\$json_market_item_display\$([\s\S]*?)\$json_market_item_display\$/)
  if (!match) throw new Error('seed display not found in migration')
  return JSON.parse(match[1])
}

function dollar(tag, text) {
  if (text.includes(`$${tag}$`)) throw new Error(`source contains $${tag}$`)
  return `$${tag}$${text}$${tag}$`
}

function sqlString(text) {
  return `'${text.replaceAll("'", "''")}'`
}

const sqlArray = (items) => (items.length === 0 ? 'ARRAY[]::text[]' : `ARRAY[${items.map(sqlString).join(', ')}]::text[]`)

// 작업 기록 details 의 키 목록(계약 시험과 같은 목록, C 정렬)
export const AUDIT_DETAIL_KEYS = {
  market_item_option_save: ['after', 'before', 'created', 'kind', 'option_id', 'renamed_item_count', 'request', 'revision_after', 'revision_before',
    'saved_at', 'subject'],
  market_item_option_reorder: ['ids_after', 'ids_before', 'kind', 'reordered_at', 'request', 'subject'],
  market_item_usage_basis_save: ['after', 'before', 'created', 'item_id', 'request', 'revision_after', 'revision_before', 'saved_at', 'subject'],
  market_item_display_update: ['after', 'before', 'request', 'revision_after', 'revision_before', 'saved_at'],
}
const keysLiteral = (action) => sqlArray(AUDIT_DETAIL_KEYS[action])

const REQUEST_META = '{"ip": "203.0.113.17", "user_agent": "rh17"}'

// ── 공통 머리 ─────────────────────────────────────────────────────────────────────────────────────
function prelude({ title, when, mode }) {
  return `-- 17번 묶음 리허설: ${title}
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle17_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle17_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
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
    p_actor, p_id, p_rev, p_subject, p_kind, p_label, p_active, ${sqlString(REQUEST_META)}))
$f$;
CREATE FUNCTION pg_temp.reorder(p_actor uuid, p_subject text, p_kind text, p_ids uuid[]) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.reorder_market_item_options(%L, %L, %L, %L::uuid[], %L::jsonb)', p_actor, p_subject, p_kind, p_ids, ${sqlString(REQUEST_META)}))
$f$;
CREATE FUNCTION pg_temp.basis(p_actor uuid, p_item uuid, p_rev integer, p_option uuid, p_note text DEFAULT '', p_evidence text DEFAULT '') RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.save_market_item_usage_basis(%L, %L, %L, %L, %L, %L, %L::jsonb)',
    p_actor, p_item, p_rev, p_option, p_note, p_evidence, ${sqlString(REQUEST_META)}))
$f$;
CREATE FUNCTION pg_temp.display(p_actor uuid, p_rev integer, p_value jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.save_market_item_display(%L, %L, %L::jsonb, %L::jsonb)', p_actor, p_rev, p_value, ${sqlString(REQUEST_META)}))
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
SELECT pg_temp.ctx_set('src_migration', ${dollar('rh_src_migration', migrationCopy(mode))});
SELECT pg_temp.ctx_set('src_down', ${dollar('rh_src_down', downCopy(mode))});
SELECT pg_temp.ctx_set('src_old_handle_new_user', ${dollar('rh_src_old_handle_new_user', oldHandleNewUserDefinition())});
SELECT pg_temp.ctx_set('mode', ${sqlString(mode)});

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
`
}

// 경우 하나를 격리한다: 안에서 남긴 상태는 표지 예외 RH_ISOLATE 로 되돌리고, 로그(변수 v_log)만 남긴다.
function isolatedCase(tag, test, body, declare = '') {
  return `
DO $${tag}$
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
${declare}BEGIN
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

const FOOT = `
SELECT n, test, msg, payload FROM _rh_log ORDER BY n;
ROLLBACK;
`

// 관리자 역할(거래 안에서만): 대표·직원(products.edit)
const ROLES = `
DO $rh_roles$
BEGIN
  UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = pg_temp.uid('owner');
  UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = pg_temp.uid('staff');
  PERFORM pg_temp.expect(pg_temp.grants(pg_temp.uid('owner'), pg_temp.uid('staff'), ARRAY['products.edit']), 'OK', 'setup', '직원에게 products.edit');
END
$rh_roles$;
`

// ── 경우 A·P0: 적용 직후(다시 적용 거절·첫 값·설정 행·지문) ───────────────────────────────────────────────────
const CASE_A = `
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
`

// ── P0: 사전 점검 멈춤(적용 전 상태를 거래 안에서 만들어 본다 — down 뒤 지문·식별값) ───────────────────────────────────
function caseP0() {
  const down = `pg_temp.subst_once(pg_temp.ctx('src_down'), ${sqlString(DOWN_ALLOW_LINE[0])}, ${sqlString(DOWN_ALLOW_LINE[1])})`
  return isolatedCase('rh_p0', 'P0', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(${down}), 'OK', 'P0', 'down(적용 전 상태로)');
    EXECUTE 'CREATE OR REPLACE FUNCTION public.record_admin_audit(p_actor_id uuid, p_action text, p_target_type text, p_target_id text, p_target_user_id uuid, p_amount integer, p_reason text, p_details jsonb, p_request_id text) RETURNS uuid LANGUAGE sql AS $x$ SELECT NULL::uuid $x$';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: record_admin_audit changed', 'P0', '기록 함수 지문 다르면 멈춤');`)
    + isolatedCase('rh_p0b', 'P0', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(${down}), 'OK', 'P0', 'down(적용 전 상태로)');
    EXECUTE 'INSERT INTO public.system_settings (key, value) VALUES (''market_item_display'', ''{}''::jsonb)';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: market_item_display row already exists', 'P0', '설정 행이 이미 있으면 멈춤');`)
    + isolatedCase('rh_p0c', 'P0', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(${down}), 'OK', 'P0', 'down(적용 전 상태로)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'P0', '적용 전 상태에서 다시 적용(VERIFY 통과)');`)
}

// ── P1: 권한 ─────────────────────────────────────────────────────────────────────────────────────
const ACTORS = [
  { name: '대표', setup: '', allowed: true, who: 'v_owner' },
  { name: 'products.edit 직원', setup: '', allowed: true, who: 'v_staff' },
  { name: '권한 없는 직원(content.manage 만)', allowed: false, who: 'v_x',
    setup: `    UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = v_x;
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_x, ARRAY['content.manage']), 'OK', 'P1', 'content.manage 만 주기');\n` },
  { name: '탈퇴한 대표', allowed: false, who: 'v_x',
    setup: `    UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = v_x;
    PERFORM set_config('app.member_withdrawal_bypass', v_x::text, true);
    UPDATE public.profiles SET withdrawn_at = now() WHERE id = v_x;
    PERFORM set_config('app.member_withdrawal_bypass', '', true);\n` },
  { name: '권한 행만 남은 옛 직원(관리자 아님)', allowed: false, who: 'v_x',
    setup: `    UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = v_x;
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_x, ARRAY['products.edit']), 'OK', 'P1', 'products.edit 주기');
    UPDATE public.profiles SET is_admin = false, admin_role = NULL WHERE id = v_x;\n` },
  { name: '일반 회원', setup: '', allowed: false, who: 'v_e' },
  { name: '없는 id', setup: '', allowed: false, who: 'gen_random_uuid()' },
]

function caseP1() {
  const blocks = ACTORS.map((actor, index) => isolatedCase(`rh_p1_${index}`, 'P1', `
${actor.setup}    v_p := ${actor.who};
    v_log := v_log || pg_temp.ensure(public.market_catalog_actor_allowed(v_p) IS ${actor.allowed ? 'TRUE' : 'FALSE'}, 'P1', ${sqlString(`${actor.name} — 판정 ${actor.allowed ? '통과' : '거절'}`)});
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_p, 'korean', 'grade', '권한 시험'), ${sqlString(actor.allowed ? 'OK' : 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED')}, 'P1', ${sqlString(`${actor.name} — 목록 저장`)});
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_p, 'korean', 'grade', pg_temp.opt_ids('korean', 'grade')), ${sqlString(actor.allowed ? 'OK' : 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED')}, 'P1', ${sqlString(`${actor.name} — 순서`)});
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_p, v_item_ko, NULL, pg_temp.opt_id('korean', 'usage_basis', '확인 중')), ${sqlString(actor.allowed ? 'OK' : 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED')}, 'P1', ${sqlString(`${actor.name} — 이용 근거`)});
    v_log := v_log || pg_temp.expect(pg_temp.display(v_p, 1, pg_temp.display_value()), ${sqlString(actor.allowed ? 'OK' : 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED')}, 'P1', ${sqlString(`${actor.name} — 표시 설정`)});`))
  return blocks.join('') + isolatedCase('rh_p1_more', 'P1', `
    -- admin_role 빈 관리자: profiles CHECK((is_admin IS TRUE) = (admin_role IS NOT NULL)) 가 이 상태를 막는다(DB 가 TS 보다 엄격)
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.profiles SET is_admin = true, admin_role = NULL WHERE id = %L', v_x)),
      'ERR', 'P1', 'admin_role 빈 관리자 — 상태 자체가 CHECK 로 거절');
    v_log := v_log || pg_temp.expect(pg_temp.opt(NULL, 'korean', 'grade', 'NULL 행위자'), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', 'NULL 행위자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY[]::text[]), 'OK', 'P1', '직원 권한 회수');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_staff, 'korean', 'grade', '회수 뒤'), 'ERR MARKET_CATALOG_ACTOR_NOT_ALLOWED', 'P1', '권한 회수 뒤 저장 거절');`)
}

// ── P2: 목록 저장 + route 검사 예시 묶음(TS 와 같은 표) ───────────────────────────────────────────────
function caseP2() {
  const main = isolatedCase('rh_p2', 'P2', `
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
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'grade', E'1학년\\n반'), 'ERR MARKET_OPTION_INPUT_INVALID:label', 'P2', '줄바꿈 거절');
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
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('market_item_option_save', ${keysLiteral('market_item_option_save')}), 'P10', 'market_item_option_save 기록 키·request');
    v_log := v_log || pg_temp.ensure((SELECT bool_and(a.details ->> 'subject' IN ('korean', 'english') AND a.target_type = 'market_item_option')
      FROM public.admin_audit_log a WHERE a.action = 'market_item_option_save' AND a.created_at >= now()), 'P10', '기록 대상·과목');`)
  const examples = EXAMPLES.optionValueChecks.map((example, index) => {
    const other = example.subject === 'korean' ? 'english' : 'korean'
    let setup = ''
    if (example.hide) {
      setup += `    v_id := pg_temp.opt_id(${sqlString(example.subject)}, ${sqlString(example.kind)}, ${sqlString(example.hide)});
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, ${sqlString(example.subject)}, ${sqlString(example.kind)}, ${sqlString(example.hide)}, v_id, pg_temp.opt_rev(v_id), false), 'OK', 'P2', ${sqlString(`${example.name} — 숨기기`)});\n`
    }
    if (example.addOther) {
      setup += `    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, ${sqlString(other)}, ${sqlString(example.kind)}, ${sqlString(example.addOther)}), 'OK', 'P2', ${sqlString(`${example.name} — 다른 과목에만 더하기`)});\n`
    }
    const current = example.current === null ? 'NULL' : sqlString(example.current)
    return isolatedCase(`rh_p2_ex_${index}`, 'P2', `
${setup}    v_log := v_log || pg_temp.ensure(pg_temp.route_ok(${sqlString(example.subject)}, ${sqlString(example.kind)}, ${sqlString(example.value)}, ${current}) IS ${example.ok ? 'TRUE' : 'FALSE'},
      'P2', ${sqlString(`route 검사 예시: ${example.name} → ${example.ok ? '통과' : '거절'}`)});`)
  })
  return main + examples.join('')
}

// ── P3: 이름 바꾸기 ────────────────────────────────────────────────────────────────────────────────
function caseP3() {
  return isolatedCase('rh_p3', 'P3', `
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
      AND (SELECT count(*) FROM public.market_items WHERE workspace_subject = 'korean' AND source_type = '교과서(시험)') = v_n, 'P3', '숨기기는 상품 값을 바꾸지 않음');`)
}

// ── P4: 순서 ───────────────────────────────────────────────────────────────────────────────────────
function caseP4() {
  return isolatedCase('rh_p4', 'P4', `
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
      AND pg_temp.audit_ok('market_item_option_reorder', ${keysLiteral('market_item_option_reorder')}), 'P10', 'market_item_option_reorder 기록 1건·키·request');`)
}

// ── P5: 이용 근거 ────────────────────────────────────────────────────────────────────────────────────
function caseP5() {
  return isolatedCase('rh_p5', 'P5', `
    v_p := pg_temp.opt_id('korean', 'usage_basis', '확인 중');
    v_q := pg_temp.opt_id('korean', 'usage_basis', '자체 제작(원저작물 없음)');
    v_r := pg_temp.basis(v_staff, v_item_ko, NULL, v_p, '  메모 첫 줄' || E'\\n' || '둘째 줄  ', ' 드라이브/계약/1.pdf ');
    v_log := v_log || pg_temp.expect(v_r, 'OK {"changed": true, "created": true, "revision": 1}', 'P5', '새로(직원)');
    v_log := v_log || pg_temp.ensure((SELECT workspace_subject = 'korean' AND basis_option_id = v_p AND note = '메모 첫 줄' || E'\\n' || '둘째 줄'
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
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, 3, v_p, '', '위치' || E'\\n' || '둘째'), 'ERR MARKET_USAGE_BASIS_INPUT_INVALID:evidenceRef', 'P5', '증빙 위치 줄바꿈 거절');
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
      AND pg_temp.audit_ok('market_item_usage_basis_save', ${keysLiteral('market_item_usage_basis_save')})
      AND (SELECT bool_and(a.target_type = 'market_item' AND a.details #>> '{after,basis_label}' IS NOT NULL) FROM public.admin_audit_log a
            WHERE a.action = 'market_item_usage_basis_save' AND a.created_at >= now()), 'P10', 'market_item_usage_basis_save 기록 5건·키·근거 이름');`)
}

// ── P6: 표시 설정 ────────────────────────────────────────────────────────────────────────────────────
function caseP6() {
  return isolatedCase('rh_p6', 'P6', `
    v_j := pg_temp.display_value();
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, v_j), 'OK {"changed": false, "revision": 1}', 'P6', '첫 값 그대로 저장 → 성공(바뀐 것 없음)');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, jsonb_set(v_j, '{facetLabels,type}', '""')), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:facetLabels.type', 'P6', '필수 키 빈 값 거절');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, v_j #- '{facetLabels,grade}'), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:facetLabels.grade', 'P6', '필수 키 빠짐 거절');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, jsonb_set(v_j, '{facetLabels,type}', '"{type} 필터"')), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:facetLabels.type', 'P6', '필터 이름의 {type} 거절');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, jsonb_set(v_j, '{facetLabels,year}', to_jsonb(repeat('가', 21)))), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:facetLabels.year', 'P6', '필터 이름 21자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, jsonb_set(v_j, '{libraryEmptyFilterHint}', to_jsonb(repeat('가', 61)))), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:libraryEmptyFilterHint', 'P6', '안내 61자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, jsonb_set(v_j, '{libraryEmptyFilterHint}', to_jsonb('한 줄' || E'\\n' || '둘째'))), 'ERR MARKET_ITEM_DISPLAY_INPUT_INVALID:libraryEmptyFilterHint', 'P6', '안내 줄바꿈 거절');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, jsonb_set(v_j, '{libraryEmptyFilterHint}', to_jsonb(repeat('가', 60)))), 'OK {"changed": true, "revision": 2}', 'P6', '안내 60자 통과·판 +1');
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 1, v_j), 'ERR MARKET_ITEM_DISPLAY_REVISION_CONFLICT', 'P6', '판 충돌');
    -- 설정 행의 다른 키(19번이 더할 키 자리)는 이 함수가 그대로 둔다
    UPDATE public.system_settings SET value = value || '{"rh17Other": {"keep": true}}'::jsonb WHERE key = 'market_item_display';
    v_log := v_log || pg_temp.expect(pg_temp.display(v_owner, 2, jsonb_set(v_j, '{facetLabels,type}', '"구성(시험)"') || '{"rh17Other": "덮어쓰기 시도"}'), 'OK {"changed": true, "revision": 3}', 'P6', '필터 이름 저장');
    v_log := v_log || pg_temp.ensure(pg_temp.display_value() -> 'rh17Other' = '{"keep": true}'::jsonb AND pg_temp.display_value() #>> '{facetLabels,type}' = '구성(시험)'
      AND pg_temp.display_rev() = 3, 'P6', '다른 키는 저장된 값 그대로(넘긴 값으로 덮지 않음)');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('market_item_display_update') = 2
      AND pg_temp.audit_ok('market_item_display_update', ${keysLiteral('market_item_display_update')}), 'P10', 'market_item_display_update 기록 2건·키·request');`)
}

// ── P7: 잠금 트리거(임시 사본 — light·full 모두) ─────────────────────────────────────────────────────────
const P7_TEMP = isolatedCase('rh_p7', 'P7', `
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
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', 'SELECT public.guard_market_file_type_identity()::text'), 'ERR', 'P9', '잠금 트리거 함수는 아무도 직접 못 부름');`, `  v_q_text text;
`)

// ── P7F(full 전용): 실제 두 표의 잠금 트리거 ────────────────────────────────────────────────────────────
const P7_REAL = isolatedCase('rh_p7f', 'P7F', `
    FOREACH v_q_text IN ARRAY ARRAY['postgres', 'service_role'] LOOP
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, v_q_text, 'WITH u AS (UPDATE public.market_subproduct_categories SET slug = slug || ''_x'' WHERE slug = ''question_pdf'' AND workspace_subject = ''korean'' RETURNING 1) SELECT count(*)::text FROM u'),
        'ERR MARKET_IDENTIFIER_LOCKED', 'P7F', v_q_text || ' 실제 구성 slug 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, v_q_text, 'WITH d AS (DELETE FROM public.market_file_types WHERE code = ''zip'' AND workspace_subject = ''english'' RETURNING 1) SELECT count(*)::text FROM d'),
        'ERR MARKET_IDENTIFIER_LOCKED', 'P7F', v_q_text || ' 실제 파일 유형 hard DELETE 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, v_q_text, 'WITH u AS (UPDATE public.market_file_types SET code = code WHERE workspace_subject = ''korean'' RETURNING 1) SELECT count(*)::text FROM u'),
        'OK', 'P7F', v_q_text || ' 실제 파일 유형 code 같은 값 UPDATE 통과');
    END LOOP;
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', 'WITH u AS (UPDATE public.market_subproduct_categories SET slug = ''x'' RETURNING 1) SELECT count(*)::text FROM u'),
      'ERR MARKET_IDENTIFIER_LOCKED', 'P7F', '대표 세션(브라우저, RLS 쓰기 허용) slug 바꾸기도 거절');`, `  v_q_text text;
`)

// ── P8: 가입 트리거(시험 auth.users 행 — 거래 안) ─────────────────────────────────────────────────────────
const P8_VARIANTS = [
  { name: '카카오', app: { provider: 'kakao' }, user: {
    avatar_url: 'https://example.test/a.png', picture: 'https://example.test/p.png', kakao_id: 'rh17-kakao-1', kakao_email: 'rh17-k@test.com',
    phone: '010-0000-0000', kakao_account: { email: 'rh17-ka@test.com', phone_number: '010-0000-0001', profile: { profile_image_url: 'https://example.test/k.png' } },
  } },
  { name: '이메일', app: { provider: 'email' }, user: { avatar_url: 'https://example.test/a2.png', picture: 'https://example.test/p2.png' } },
]
function caseP8() {
  return P8_VARIANTS.map((variant, index) => isolatedCase(`rh_p8_${index}`, 'P8', `
    v_id := gen_random_uuid();
    v_p := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rh17-new-' || left(v_id::text, 8) || '@test.com',
      ${sqlString(JSON.stringify(variant.app))}::jsonb, ${sqlString(JSON.stringify(variant.user))}::jsonb, now(), now());
    v_log := v_log || pg_temp.ensure((SELECT avatar_url IS NULL FROM public.profiles WHERE id = v_id), 'P8', ${sqlString(`${variant.name} — 새 함수: avatar_url NULL`)});
    -- 옛 함수(down 원문)로 같은 메타데이터 시험 행을 하나 더 넣어 나머지 칸을 대조한다
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_old_handle_new_user')), 'OK', 'P8', '옛 함수로 잠깐 되돌림(이 경우 안에서만)');
    INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (v_p, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rh17-old-' || left(v_p::text, 8) || '@test.com',
      ${sqlString(JSON.stringify(variant.app))}::jsonb, ${sqlString(JSON.stringify(variant.user))}::jsonb, now(), now());
    v_log := v_log || pg_temp.ensure((SELECT avatar_url IS NOT NULL FROM public.profiles WHERE id = v_p), 'P8', ${sqlString(`${variant.name} — 옛 함수는 avatar 를 읽었음(대조 기준)`)});
    v_log := v_log || pg_temp.ensure((SELECT (n.phone, n.kakao_id, n.provider, n.signup_completed) IS NOT DISTINCT FROM (o.phone, o.kakao_id, o.provider, o.signup_completed)
        AND (n.kakao_email = o.kakao_email OR (n.kakao_email LIKE 'rh17-new-%' AND o.kakao_email LIKE 'rh17-old-%'))
      FROM public.profiles n, public.profiles o WHERE n.id = v_id AND o.id = v_p), 'P8', ${sqlString(`${variant.name} — provider·kakao_id·kakao_email·phone·signup_completed 옛 함수와 같음`)});
    INSERT INTO _rh_log (test, msg, payload) SELECT 'P8', ${sqlString(`${variant.name} 새 함수 결과`)},
      jsonb_build_object('provider', provider, 'signup_completed', signup_completed, 'kakao_id', kakao_id, 'avatar_url', avatar_url) FROM public.profiles WHERE id = v_id;`)).join('')
}

// ── P9: 권한 표(표·함수) ────────────────────────────────────────────────────────────────────────────
function caseP9() {
  return isolatedCase('rh_p9', 'P9', `
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
      AND (column_name LIKE '%usage%' OR column_name LIKE '%basis%')), 'P9', 'market_items 에 이용 근거 칸 없음');`, `  v_q_text text;
`)
}

// ── B1: 되돌리기·다시 적용, 멈춤 조건(근거 행·18·19번 함수·다른 FK) ────────────────────────────────────────────
function caseB1() {
  const downAllowed = `pg_temp.subst_once(pg_temp.ctx('src_down'), ${sqlString(DOWN_ALLOW_LINE[0])}, ${sqlString(DOWN_ALLOW_LINE[1])})`
  return isolatedCase('rh_b1_rows', 'B1', `
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, NULL, pg_temp.opt_id('korean', 'usage_basis', '확인 중')), 'OK', 'B1', '근거 1행');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: usage bases exist', 'B1', '근거 행 있으면 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(${downAllowed}), 'OK', 'B1', '대표 확인 뒤 down 통과');`)
    + isolatedCase('rh_b1_18', 'B1', `
    EXECUTE 'CREATE FUNCTION public.duplicate_market_item() RETURNS void LANGUAGE sql AS $x$ SELECT $x$';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: bundle 18/19 functions exist', 'B1', '18번 함수(duplicate_market_item) 있으면 멈춤');
    EXECUTE 'DROP FUNCTION public.duplicate_market_item()';
    EXECUTE 'CREATE FUNCTION public.reorder_market_item_subproducts() RETURNS void LANGUAGE sql AS $x$ SELECT $x$';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: bundle 18/19 functions exist', 'B1', '18번 함수(reorder_market_item_subproducts) 있으면 멈춤');`)
    + isolatedCase('rh_b1_19', 'B1', `
    EXECUTE 'CREATE OR REPLACE FUNCTION public.save_market_item_display(p_actor_id uuid, p_expected_revision integer, p_value jsonb, p_request_meta jsonb) RETURNS jsonb LANGUAGE sql AS $x$ SELECT jsonb_build_object(''detail'', 1) $x$';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: bundle 18/19 functions exist', 'B1', '19번판 표시 설정 함수(본문에 detail) 있으면 멈춤');`)
    + isolatedCase('rh_b1_fk', 'B1', `
    EXECUTE 'CREATE TABLE public._rh17_fk (id serial PRIMARY KEY, option_id uuid REFERENCES public.market_item_attribute_options(id))';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: other foreign keys reference market_item_attribute_options', 'B1', '다른 FK 있으면 멈춤');`)
    + isolatedCase('rh_b1', 'B1', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'B1', '근거 없는 상태 down 은 확인 상수 없이 통과');
    v_log := v_log || pg_temp.ensure(to_regclass('public.market_item_attribute_options') IS NULL AND to_regclass('public.market_item_usage_bases') IS NULL
      AND to_regprocedure('public.market_catalog_actor_allowed(uuid)') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN ('guard_market_subproduct_category_identity', 'guard_market_file_type_identity'))
      AND NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'market_item_display')
      AND md5(pg_get_functiondef('public.handle_new_user()'::regprocedure)) = '61bc7b1469fb4dd6e795725040efe394', 'B1', '남는 것 0·가입 함수 옛 지문');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: bundle 17 tables missing', 'B1', '두 번째 down 은 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'B1', '다시 적용(VERIFY 통과)');
    v_log := v_log || pg_temp.expect(pg_temp.opt(v_owner, 'korean', 'grade', '다시 적용 뒤'), 'OK', 'B1', '다시 적용 뒤 저장');`)
}

// 끝에 남은 것: 경우는 모두 격리돼 있어 첫 값 26행·근거 0행·이 거래의 17번 기록 0·설정 행 revision 1 이어야 한다.
const LEFTOVER = isolatedCase('rh_leftover', 'Z', `
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.market_item_attribute_options) = 26 AND (SELECT count(*) FROM public.market_item_usage_bases) = 0
      AND (SELECT count(*) FROM public.admin_audit_log WHERE action LIKE 'market_item_%' AND created_at >= now()) = 0
      AND pg_temp.display_rev() = 1
      AND NOT EXISTS (SELECT 1 FROM public.market_items WHERE source_type = '교과서(시험)'), 'Z', '경우 밖에 남은 항목·근거·17번 기록 0, 설정 행 revision 1, 상품 값 그대로(ROLLBACK 전)');`)

// ── full 전용: 적용 전 down 멈춤, 실제 적용 절차(이력 INSERT), 되돌리기 뒤 이력 행 지우기·다시 적용 ───────────────────────────
const BEFORE_APPLY = isolatedCase('rh_before', 'F0', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: bundle 17 tables missing', 'F0', '적용 전 down 멈춤');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = ${sqlString(MIGRATION_VERSION)}), 'F0', '이력 행 없음');`)

const HISTORY_INSERT = `
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (${sqlString(MIGRATION_VERSION)}, ${sqlString(MIGRATION_NAME)});
`

const CASE_F = isolatedCase('rh_f', 'F', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'F', 'down 원본(근거 없음 — 트리거·FK 포함)');
    DELETE FROM supabase_migrations.schema_migrations WHERE version = ${sqlString(MIGRATION_VERSION)};
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'F', '이력 행 지운 뒤 다시 적용');
    INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (${sqlString(MIGRATION_VERSION)}, ${sqlString(MIGRATION_NAME)});
    v_log := v_log || pg_temp.expect(pg_temp.basis(v_owner, v_item_ko, NULL, pg_temp.opt_id('korean', 'usage_basis', '확인 중')), 'OK', 'F', '다시 적용 뒤 근거 저장');`)

const APPLY_HEAD = (mode) => `
-- ===== 17번 마이그레이션(${mode === 'light' ? 'light 사본 — 기존 표 DDL 구역과 그 VERIFY 블록을 뺌' : '원본 그대로'}) =====
`

export function buildRehearsalFiles() {
  const cases = caseP0() + caseP1() + caseP2() + caseP3() + caseP4() + caseP5() + caseP6() + P7_TEMP + caseP8() + caseP9() + caseB1()
  const light = prelude({
    title: 'A light — 마이그레이션 light 사본, 경우 A·P0~P9·B1(P10 기록은 각 경우 안에서)',
    when: '지금 돌려도 됨(새 표 2개·새 함수·system_settings 행 1개·handle_new_user 교체 — market_items FK·기존 두 표 트리거 없음, 실상품 행 잠금 몇 초). 이력 표는 쓰지 않는다.',
    mode: 'light',
  })
    + APPLY_HEAD('light') + migrationCopy('light') + '\n'
    + ROLES + CASE_A + cases + LEFTOVER + FOOT
  assertLight(light, 'a_light.sql')

  const full = prelude({
    title: 'B full — 원본 적용(FK·트리거) + 적용 절차(이력 INSERT) + light 경우 전부 + 실제 두 표 잠금 트리거(P7F)·down 원본·다시 적용(F)',
    when: '새벽, DB 적용 직전에만(market_items·market_subproduct_categories·market_file_types 잠금이 ROLLBACK 까지 이어짐, supabase_migrations 이력 표에 씀 — ROLLBACK 됨).',
    mode: 'full',
  })
    + BEFORE_APPLY
    + APPLY_HEAD('full') + migrationCopy('full') + '\n'
    + HISTORY_INSERT
    + ROLES + CASE_A + cases + P7_REAL + CASE_F + LEFTOVER + FOOT

  const files = { 'a_light.sql': light, 'b_full.sql': full }
  for (const [name, content] of Object.entries(files)) {
    if (/\bCOMMIT\s*;/.test(content)) throw new Error(`${name} contains a COMMIT statement`)
    if (!content.trimEnd().endsWith('ROLLBACK;')) throw new Error(`${name} must end with ROLLBACK`)
  }
  return files
}

// ── 개발 미리보기 예시(10-2, output/ 은 git 에 넣지 않는다) ───────────────────────────────────────────────
export function buildPreviewData() {
  const options = []
  let n = 0
  for (const subject of ['korean', 'english']) {
    for (const option of seedOptionsFromMigration()) {
      n += 1
      options.push({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, subject, kind: option.kind, label: option.label,
        sortOrder: option.sort_order, isActive: true, revision: 1 })
    }
  }
  // V1: 숨긴 옛 값 표시를 보려고 국어 '부교재'를 숨긴 상태로 둔다
  for (const option of options) {
    if (option.subject === 'korean' && option.kind === 'material_type' && option.label === '부교재') option.isActive = false
  }
  return {
    _comment: '17번 개발 미리보기 값(생성 파일). PRODUCT_INFO_PREVIEW=1 PRODUCT_INFO_PREVIEW_FILE=output/b17-product-info-preview.json npm run dev',
    options,
    display: seedDisplayFromMigration(),
    usageBasis: null,
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--preview')) {
    const out = join(ROOT, 'output/b17-product-info-preview.json')
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
