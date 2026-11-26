// 14번 묶음 리허설 생성기(계획 docs/plan-bundle14-notice-faq.md 5-8: 실제 파일을 실행하고, 사본은 생성기로 만들어 다른 줄을 계약 시험으로 고정).
// 원본(마이그레이션·down)과 예시 묶음(tests/fixtures/bundle14-site-board-examples.json)을 읽어 리허설 SQL 파일을 만든다.
//   node supabase/scripts/bundle14_rehearsal/generate.mjs           → 이 폴더의 *.sql 을 다시 쓴다
//   node supabase/scripts/bundle14_rehearsal/generate.mjs --check   → 다시 만든 값과 파일이 다르면 실패
//   node supabase/scripts/bundle14_rehearsal/generate.mjs --preview → output/b14-site-board-preview.json(개발 미리보기 예시 글, 10-2)
// 실행(운영 DB, postgres): supabase db query --remote --yes -o json --file supabase/scripts/bundle14_rehearsal/<파일>
//   모든 파일은 BEGIN … 마지막 SELECT … ROLLBACK 이다(COMMIT 없음). 결과는 ON COMMIT DROP 임시 표 _rh_log 로 받는다.
//   경우마다 표지 예외(RH_ISOLATE)로 격리한다 — 경우 안에서 만든 글·기록은 그 경우가 끝나면 되돌려진다.
//   계정: @test.com 시험 계정만 쓴다(실회원 id 를 쓰지 않음). 대표·직원 역할은 그 시험 계정을 거래 안에서만 관리자로 바꿔 쓴다. 모자라면
//     'RH FAIL [setup]' 으로 멈춘다. 가짜 auth.users 행은 만들지 않는다.
//   13번 묶음(아직 운영 미적용)에 기대지 않는다: 이 마이그레이션·함수는 13번 표·함수를 부르지 않는다(adminRequestMeta 는 코드 쪽 선행 조건).
//   지금(낮) 돌려도 되는 파일: a_light.sql — 마이그레이션 원본 그대로(새 표 2개·새 함수·system_settings 행 1개, 기존 표에 거는 DDL 없음)와
//     경우 A·B1~B8. 되돌리기·다시 적용(B1)도 14번 새 물건과 설정 행 1개만 건드리므로 light 에 넣는다. 시험 계정 행·권한 행의 행 잠금은 몇 초.
//   적용 직전에 돌릴 파일: b_full.sql — light 전부 + 적용 전 down 멈춤(F0) + 실제 적용 절차(이력 schema_migrations INSERT)와
//     되돌리기 뒤 이력 행 지우기·다시 적용(F). 이력 표에 쓰므로(ROLLBACK 되지만) 적용 승인 뒤 적용 직전에만 돌린다.
//   advisory lock 경합(상한 낮추기와 고정의 동시 실행)은 BEGIN…ROLLBACK 한 거래로 재현할 수 없다 — 계약 시험이 잠금 순서를 단언한다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

export const SOURCES = {
  migration: 'supabase/migrations/20261217140000_bundle14_site_board.sql',
  down: 'supabase/rollback/20261217140000_bundle14_site_board_down.sql',
  examples: 'tests/fixtures/bundle14-site-board-examples.json',
}
export const MIGRATION_VERSION = '20261217140000'
export const MIGRATION_NAME = 'bundle14_site_board'

// 새로 만드는 표(light 에서 ALTER TABLE·CREATE TRIGGER·CREATE POLICY·REFERENCES 를 걸어도 되는 곳). _rh14_ 표는 B1 이 거래 안에서 만든다.
export const NEW_TABLES = ['public.site_board_posts', 'public.site_board_post_revisions', 'public._rh14_member_broadcasts', 'public._rh14_broadcast_fk']
// light 파일에 남으면 안 되는 글(기존 표를 잠그는 DDL·이력 표 쓰기·COMMIT)
export const LIGHT_FORBIDDEN = [
  'LOCK TABLE', 'ALTER POLICY', 'DROP POLICY', 'DROP TRIGGER', 'DROP COLUMN', 'ADD COLUMN', 'ON public.profiles', 'ON public.system_settings',
  'ON public.admin_permission_grants', 'ON public.admin_audit_log', 'supabase_migrations', 'COMMIT;',
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
  for (const match of sql.matchAll(/CREATE TRIGGER [a-z_]+\s+[A-Z ]+? ON ([a-z0-9_.]+)/g)) {
    if (!NEW_TABLES.includes(match[1])) throw new Error(`${label} light copy creates a trigger on an existing table: ${match[1]}`)
  }
  for (const match of sql.matchAll(/CREATE POLICY [a-z_]+ ON ([a-z0-9_.]+)/g)) {
    if (!NEW_TABLES.includes(match[1])) throw new Error(`${label} light copy creates a policy on an existing table: ${match[1]}`)
  }
  for (const match of sql.matchAll(/REFERENCES (public\.[a-z0-9_]+)/g)) {
    if (!NEW_TABLES.includes(match[1])) throw new Error(`${label} light copy references an existing table: ${match[1]}`)
  }
  for (const match of sql.matchAll(/DROP TABLE (public\.[a-z0-9_]+)/g)) {
    if (!NEW_TABLES.includes(match[1])) throw new Error(`${label} light copy drops an existing table: ${match[1]}`)
  }
}

export function migrationCopy() {
  const sql = read(SOURCES.migration)
  assertLight(sql, 'migration')
  return sql
}

export function downCopy() {
  const sql = read(SOURCES.down)
  assertLight(sql, 'down')
  return sql
}

// down 의 대표 확인 상수: 바꾸는 줄은 이 한 줄뿐(경우 B1)
export const DOWN_ALLOW_LINE = ['  c_allow_drop_posts constant boolean := false;', '  c_allow_drop_posts constant boolean := true;']

export const EXAMPLES = JSON.parse(read(SOURCES.examples))

function dollar(tag, text) {
  if (text.includes(`$${tag}$`)) throw new Error(`source contains $${tag}$`)
  return `$${tag}$${text}$${tag}$`
}

function sqlString(text) {
  return `'${text.replaceAll("'", "''")}'`
}

const sqlArray = (items) => (items.length === 0 ? 'ARRAY[]::text[]' : `ARRAY[${items.map(sqlString).join(', ')}]::text[]`)

// 작업 기록 details 의 키 목록(제목·본문 원문도 본문 지문도 없음 — 계약 시험과 같은 목록, C 정렬)
export const AUDIT_DETAIL_KEYS = {
  site_board_post_save: ['board', 'body_length', 'body_length_before', 'changed_fields', 'created', 'is_pinned_after',
    'is_pinned_before', 'is_published_after', 'is_published_before', 'post_id', 'request', 'revision_after', 'revision_before', 'revision_row_id',
    'saved_at', 'title_length'],
  site_board_post_delete: ['board', 'body_length', 'deleted_at', 'post_id', 'request', 'revision_after', 'revision_before',
    'revision_row_id', 'title_length', 'was_pinned', 'was_published'],
  site_board_post_reorder: ['board', 'ids_after', 'ids_before', 'reordered_at', 'request', 'scope'],
  site_board_post_redact: ['board', 'post_id', 'reason_code', 'redacted_at', 'request', 'revision_after', 'revision_before', 'revisions_redacted'],
  site_board_content_update: ['after', 'before', 'request', 'revision_after', 'revision_before', 'saved_at'],
}
const keysLiteral = (action) => sqlArray(AUDIT_DETAIL_KEYS[action])

const REQUEST_META = '{"ip": "203.0.113.14", "user_agent": "rh14"}'

// ── 공통 머리 ─────────────────────────────────────────────────────────────────────────────────────
function prelude({ title, when, mode }) {
  return `-- 14번 묶음 리허설: ${title}
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle14_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle14_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
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
-- 그 종류의 기록이 모두: reason NULL, details 키가 정한 목록과 같음, request 가 객체, 넘긴 제목·본문 글이 들어 있지 않음
CREATE FUNCTION pg_temp.audit_ok(p_action text, p_keys text[], p_forbidden text[]) RETURNS boolean LANGUAGE sql AS $f$
  SELECT count(*) > 0 AND bool_and(a.reason IS NULL
     AND ARRAY(SELECT k FROM jsonb_object_keys(a.details) k ORDER BY k COLLATE "C") = p_keys
     AND jsonb_typeof(a.details -> 'request') = 'object'
     AND NOT EXISTS (SELECT 1 FROM unnest(p_forbidden) f WHERE strpos(a.details::text, f) > 0))
    FROM public.admin_audit_log a WHERE a.action = p_action AND a.created_at >= now()
$f$;
-- 글 저장(결과 'OK {json}' 또는 'ERR …')
CREATE FUNCTION pg_temp.save(p_actor uuid, p_board text, p_title text, p_body text, p_id uuid DEFAULT NULL, p_rev integer DEFAULT NULL,
  p_link text DEFAULT NULL, p_label text DEFAULT NULL, p_cat text DEFAULT NULL, p_pinned boolean DEFAULT false, p_published boolean DEFAULT true)
  RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.save_site_board_post(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L::jsonb)',
    p_actor, p_id, p_rev, p_board, p_title, p_body, p_link, p_label, p_cat, p_pinned, p_published, ${sqlString(REQUEST_META)}))
$f$;
CREATE FUNCTION pg_temp.del(p_actor uuid, p_id uuid, p_rev integer) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.delete_site_board_post(%L, %L, %L, %L::jsonb)', p_actor, p_id, p_rev, ${sqlString(REQUEST_META)}))
$f$;
CREATE FUNCTION pg_temp.reorder(p_actor uuid, p_board text, p_scope text, p_ids uuid[]) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.reorder_site_board_posts(%L, %L, %L, %L::uuid[], %L::jsonb)', p_actor, p_board, p_scope, p_ids, ${sqlString(REQUEST_META)}))
$f$;
CREATE FUNCTION pg_temp.redact(p_actor uuid, p_id uuid, p_code text DEFAULT 'pii') RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.redact_site_board_post(%L, %L, %L, %L::jsonb)', p_actor, p_id, p_code, ${sqlString(REQUEST_META)}))
$f$;
CREATE FUNCTION pg_temp.content(p_actor uuid, p_rev integer, p_value jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.save_site_board_content(%L, %L, %L::jsonb, %L::jsonb)', p_actor, p_rev, p_value, ${sqlString(REQUEST_META)}))
$f$;
-- 새 표를 읽는 도우미는 plpgsql(만들 때 본문을 검사하지 않음 — 표는 마이그레이션 뒤에 생긴다)
CREATE FUNCTION pg_temp.rev(p_id uuid) RETURNS integer LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (SELECT revision FROM public.site_board_posts WHERE id = p_id);
END $f$;
CREATE FUNCTION pg_temp.content_value() RETURNS jsonb LANGUAGE sql AS $f$ SELECT value FROM public.system_settings WHERE key = 'site_board_content' $f$;
CREATE FUNCTION pg_temp.content_rev() RETURNS integer LANGUAGE sql AS $f$ SELECT (value ->> 'revision')::integer FROM public.system_settings WHERE key = 'site_board_content' $f$;
-- 회원 공지 목록 순서(코드 site-board-server.ts 와 같은 규칙: 고정 sort_order,id → 비고정 published_at DESC,id)
CREATE FUNCTION pg_temp.notice_order() RETURNS uuid[] LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (SELECT coalesce(array_agg(id ORDER BY NOT is_pinned, CASE WHEN is_pinned THEN sort_order END, CASE WHEN NOT is_pinned THEN published_at END DESC, id), '{}')
            FROM public.site_board_posts WHERE board = 'notice' AND is_published AND deleted_at IS NULL);
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
SELECT pg_temp.ctx_set('src_migration', ${dollar('rh_src_migration', migrationCopy())});
SELECT pg_temp.ctx_set('src_down', ${dollar('rh_src_down', downCopy())});
SELECT pg_temp.ctx_set('mode', ${sqlString(mode)});

-- ===== 계정: @test.com 시험 계정만(관리자·탈퇴 아님, 가입 완료) 4개 — 대표(owner)·직원(staff)·회원(E)·행위자 예시용(X).
--       모자라면 멈춘다(실회원 id 로 대신하지 않음). =====
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
  v_at timestamptz;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_x uuid := pg_temp.uid('X');
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

const APPLY = `
-- ===== 14번 마이그레이션(원본 그대로) =====
${'' /* 아래 원본 글은 생성기가 그대로 붙인다 */}`

// 관리자 역할(거래 안에서만): 대표·직원(content.manage)
const ROLES = `
DO $rh_roles$
BEGIN
  UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = pg_temp.uid('owner');
  UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = pg_temp.uid('staff');
  PERFORM pg_temp.expect(pg_temp.grants(pg_temp.uid('owner'), pg_temp.uid('staff'), ARRAY['content.manage']), 'OK', 'setup', '직원에게 content.manage');
END
$rh_roles$;
`

// ── 경우 A: 적용 직후(다시 적용 거절·설정 행·지문) ───────────────────────────────────────────────────────
const CASE_A = `
DO $rh_a$
BEGIN
  PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: bundle 14 tables already exist', 'A', '다시 적용 거절');
  PERFORM pg_temp.ensure(pg_temp.content_rev() = 1 AND jsonb_array_length(pg_temp.content_value() #> '{faq,categories}') = 4
    AND (pg_temp.content_value() #>> '{notice,maxPinned}')::integer = 5, 'A', '설정 행 revision 1·FAQ 분류 4개·고정 상한 5');
  INSERT INTO _rh_log (test, msg, payload)
  SELECT 'A', '적용 뒤 함수 지문(md5(pg_get_functiondef))', jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('site_board_actor_allowed', 'member_facing_text_pii_hits', 'save_site_board_post',
     'delete_site_board_post', 'reorder_site_board_posts', 'redact_site_board_post', 'save_site_board_content', 'guard_site_board_post_revisions_mutation');
  INSERT INTO _rh_log (test, msg) VALUES ('A', 'VERIFY 통과(마이그레이션 안 블록)·다시 적용 거절·설정 행');
END
$rh_a$;
`

// ── 경우 B1: 되돌리기·다시 적용, 멈춤 조건(16번 함수·다른 FK·글 있음), 16번 down 뒤 상태는 통과 ───────────────────────────
function caseB1() {
  return isolatedCase('rh_b1', 'B1', `
    -- 글이 있으면 멈춤(대표 확인 상수 전)
    v_r := pg_temp.save(v_owner, 'notice', '되돌리기 시험 공지', '본문');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'B1', '글 1건');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: posts exist', 'B1', '글 있으면 down 멈춤');
    -- 16번 함수(이름)가 있으면 멈춤
    EXECUTE 'CREATE FUNCTION public.send_member_broadcast() RETURNS void LANGUAGE sql AS $x$ SELECT $x$';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.subst_once(pg_temp.ctx('src_down'), ${sqlString(DOWN_ALLOW_LINE[0])}, ${sqlString(DOWN_ALLOW_LINE[1])})),
      'ERR DOWN PRECHECK: bundle 16 functions exist', 'B1', '16번 함수 있으면 멈춤');
    EXECUTE 'DROP FUNCTION public.send_member_broadcast()';
    EXECUTE 'CREATE FUNCTION public.reject_point_charge_refund(uuid, uuid, text, text, jsonb) RETURNS void LANGUAGE sql AS $x$ SELECT $x$';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.subst_once(pg_temp.ctx('src_down'), ${sqlString(DOWN_ALLOW_LINE[0])}, ${sqlString(DOWN_ALLOW_LINE[1])})),
      'ERR DOWN PRECHECK: bundle 16 functions exist', 'B1', '5인자 reject_point_charge_refund 있으면 멈춤');
    EXECUTE 'DROP FUNCTION public.reject_point_charge_refund(uuid, uuid, text, text, jsonb)';
    -- 판 이력 표가 아닌 FK 가 글 표를 가리키면 멈춤
    EXECUTE 'CREATE TABLE public._rh14_broadcast_fk (id serial PRIMARY KEY, post_id uuid REFERENCES public.site_board_posts(id))';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.subst_once(pg_temp.ctx('src_down'), ${sqlString(DOWN_ALLOW_LINE[0])}, ${sqlString(DOWN_ALLOW_LINE[1])})),
      'ERR DOWN PRECHECK: other foreign keys reference site_board_posts', 'B1', '다른 FK 있으면 멈춤');
    EXECUTE 'DROP TABLE public._rh14_broadcast_fk';
    -- 16번 down 뒤 상태(기록 표만 남고 FK 없음)는 통과 — 판 이력 표의 FK 는 세지 않는다
    EXECUTE 'CREATE TABLE public._rh14_member_broadcasts (id serial PRIMARY KEY, post_id uuid)';
    EXECUTE format('INSERT INTO public._rh14_member_broadcasts (post_id) VALUES (%L)', pg_temp.new_id(v_r));
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.subst_once(pg_temp.ctx('src_down'), ${sqlString(DOWN_ALLOW_LINE[0])}, ${sqlString(DOWN_ALLOW_LINE[1])})),
      'OK', 'B1', '16번 down 뒤 상태(기록 표만, FK 없음)·대표 확인 뒤 down 통과');
    v_log := v_log || pg_temp.ensure(to_regclass('public.site_board_posts') IS NULL AND to_regclass('public.site_board_post_revisions') IS NULL
      AND to_regprocedure('public.member_facing_text_pii_hits(text)') IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'site_board_content'), 'B1', '남는 것 0(표·함수·설정 행)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'B1', '다시 적용(VERIFY 통과)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'B1', '글 없는 상태 down 은 확인 상수 없이 통과');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: bundle 14 tables missing', 'B1', '두 번째 down 은 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'B1', '다시 적용');`)
}

// ── 경우 B2: 권한(예시 묶음 actors 와 같은 표) ───────────────────────────────────────────────────────
function caseB2() {
  const blocks = EXAMPLES.actors.map((example, index) => {
    const label = example.name
    let setup = ''
    if (example.dbBlocked) {
      return isolatedCase(`rh_b2_${index}`, 'B2', `
    -- ${label}: profiles CHECK((is_admin IS TRUE) = (admin_role IS NOT NULL)) 가 이 상태를 막는다(DB 가 TS 보다 엄격)
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.profiles SET is_admin = true, admin_role = NULL WHERE id = %L', v_x)),
      'ERR', 'B2', ${sqlString(`${label} — 상태 자체가 CHECK 로 거절`)});
    v_log := v_log || pg_temp.ensure(public.site_board_actor_allowed(v_x) IS FALSE, 'B2', ${sqlString(`${label} — 판정 거절`)});`)
    }
    if (example.isAdmin || example.staleGrant) {
      const role = example.staleGrant ? 'staff' : example.adminRole
      setup += `    UPDATE public.profiles SET is_admin = true, admin_role = ${sqlString(role)} WHERE id = v_x;\n`
      if (example.grants.length > 0) {
        setup += `    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_x, ${sqlArray(example.grants)}), 'OK', 'B2', ${sqlString(`${label} — 권한 주기`)});\n`
      }
      if (example.staleGrant) {
        setup += `    UPDATE public.profiles SET is_admin = false, admin_role = NULL WHERE id = v_x;\n`
        setup += `    v_log := v_log || pg_temp.ensure(EXISTS (SELECT 1 FROM public.admin_permission_grants g WHERE g.user_id = v_x AND g.permission = 'content.manage'), 'B2', ${sqlString(`${label} — 권한 행 남음`)});\n`
      }
    }
    if (example.withdrawn) {
      setup += `    PERFORM set_config('app.member_withdrawal_bypass', v_x::text, true);\n    UPDATE public.profiles SET withdrawn_at = now() WHERE id = v_x;\n    PERFORM set_config('app.member_withdrawal_bypass', '', true);\n`
    }
    return isolatedCase(`rh_b2_${index}`, 'B2', `
${setup}    v_log := v_log || pg_temp.ensure(public.site_board_actor_allowed(v_x) IS ${example.allowed ? 'TRUE' : 'FALSE'}, 'B2', ${sqlString(`${label} — 판정 ${example.allowed ? '통과' : '거절'}`)});
    v_log := v_log || pg_temp.expect(pg_temp.save(v_x, 'notice', '권한 시험', '본문'), ${sqlString(example.allowed ? 'OK' : 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED')}, 'B2', ${sqlString(`${label} — 저장`)});
    v_log := v_log || pg_temp.expect(pg_temp.content(v_x, 1, pg_temp.content_value()), ${sqlString(example.allowed ? 'OK' : 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED')}, 'B2', ${sqlString(`${label} — 안내 문구 저장`)});`)
  })
  return blocks.join('') + isolatedCase('rh_b2_more', 'B2', `
    v_log := v_log || pg_temp.expect(pg_temp.save(gen_random_uuid(), 'notice', '없는 id', '본문'), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '없는 id 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(NULL, 'notice', 'NULL', '본문'), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', 'NULL 행위자 거절');
    v_r := pg_temp.save(v_staff, 'notice', '직원 글', '본문', NULL, NULL, NULL, NULL, NULL, false, false);
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'B2', 'content.manage 직원 저장(숨김)');
    v_log := v_log || pg_temp.expect(pg_temp.redact(v_staff, pg_temp.new_id(v_r)), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '가림은 직원 거절(대표만)');
    v_log := v_log || pg_temp.expect(pg_temp.redact(v_e, pg_temp.new_id(v_r)), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '가림은 회원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY[]::text[]), 'OK', 'B2', '직원 권한 회수');
    v_log := v_log || pg_temp.expect(pg_temp.del(v_staff, pg_temp.new_id(v_r), 1), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '권한 회수 뒤 삭제 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_staff, 'notice', 'pinned', ARRAY[pg_temp.new_id(v_r)]), 'ERR SITE_BOARD_ACTOR_NOT_ALLOWED', 'B2', '권한 회수 뒤 순서 거절');`)
}

// ── 경우 B3: 저장 ──────────────────────────────────────────────────────────────────────────────
function caseB3() {
  const linkChecks = EXAMPLES.links.map((example) => {
    const url = example.url + 'a'.repeat(example.pad ?? 0)
    const expected = example.ok ? 'OK' : 'ERR SITE_BOARD_INPUT_INVALID:linkUrl'
    return `    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 시험', '본문', NULL, NULL, ${sqlString(url)}, '보기'), ${sqlString(expected)}, 'B3', ${sqlString(`링크 ${JSON.stringify(url).slice(0, 40)}`)});`
  }).join('\n')
  return isolatedCase('rh_b3', 'B3', `
    -- 새 글: revision 1, 판 이력 1행, 처음 게시 날짜, 작업 기록 1건
    v_r := pg_temp.save(v_owner, 'notice', '새 공지 제목 RH14', '새 공지 본문 RH14');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'B3', '새 글');
    v_id := pg_temp.new_id(v_r);
    v_log := v_log || pg_temp.ensure((SELECT revision = 1 AND published_at IS NOT NULL AND content_updated_at IS NULL AND created_by = v_owner AND sort_order = 0
      FROM public.site_board_posts WHERE id = v_id)
      AND (SELECT count(*) FROM public.site_board_post_revisions WHERE post_id = v_id) = 1
      AND pg_temp.audit_count('site_board_post_save') = 1, 'B3', 'revision 1·판 이력 1·게시 날짜·기록 1');
    -- 판 충돌·종류 바꾸기·없는 글
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '고침', '본문', v_id, 9), 'ERR SITE_BOARD_REVISION_CONFLICT', 'B3', '판 다르면 충돌');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '고침', '본문', v_id, NULL), 'ERR SITE_BOARD_REVISION_CONFLICT', 'B3', '판 없으면 충돌');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'faq', '고침', '본문', v_id, 1, NULL, NULL, 'credit'), 'ERR SITE_BOARD_INPUT_INVALID:board', 'B3', '종류 바꾸기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '고침', '본문', gen_random_uuid(), 1), 'ERR SITE_BOARD_POST_NOT_FOUND', 'B3', '없는 글');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '새 글', '본문', NULL, 1), 'ERR SITE_BOARD_INPUT_INVALID:revision', 'B3', '새 글에 판');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'board', '새 글', '본문'), 'ERR SITE_BOARD_INPUT_INVALID:board', 'B3', '모르는 종류');
    -- 바뀐 것 없음: 기록·판 이력 0
    v_r := pg_temp.save(v_owner, 'notice', '  새 공지 제목 RH14  ', E'새 공지 본문 RH14\\n', v_id, 1);
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (pg_temp.res(v_r) -> 'changed') = 'false'::jsonb AND pg_temp.rev(v_id) = 1
      AND (SELECT count(*) FROM public.site_board_post_revisions WHERE post_id = v_id) = 1 AND pg_temp.audit_count('site_board_post_save') = 1,
      'B3', '바뀐 것 없음(다듬은 뒤 같음) → 기록·판 이력 0 ' || left(v_r, 80));
    -- 처음 게시 날짜 유지: 숨김 → 다시 게시
    SELECT published_at INTO v_at FROM public.site_board_posts WHERE id = v_id;
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '새 공지 제목 RH14', '새 공지 본문 RH14', v_id, 1, NULL, NULL, NULL, false, false), 'OK', 'B3', '숨김');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '새 공지 제목 RH14', '새 공지 본문 RH14', v_id, 2), 'OK', 'B3', '다시 게시');
    v_log := v_log || pg_temp.ensure((SELECT published_at = v_at AND content_updated_at IS NULL AND revision = 3 FROM public.site_board_posts WHERE id = v_id),
      'B3', '처음 게시 날짜 유지·게시 여부만 바뀌면 수정 날짜 없음');
    -- 게시 뒤 본문 수정 → content_updated_at, 고정만 바뀌면 그대로
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '새 공지 제목 RH14', '고친 본문 RH14', v_id, 3), 'OK', 'B3', '게시 뒤 본문 수정');
    SELECT content_updated_at INTO v_at FROM public.site_board_posts WHERE id = v_id;
    v_log := v_log || pg_temp.ensure(v_at IS NOT NULL, 'B3', '본문 수정 → 수정 날짜');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '새 공지 제목 RH14', '고친 본문 RH14', v_id, 4, NULL, NULL, NULL, true), 'OK', 'B3', '고정만 바꿈');
    v_log := v_log || pg_temp.ensure((SELECT content_updated_at = v_at FROM public.site_board_posts WHERE id = v_id)
      AND (SELECT count(*) FROM public.site_board_post_revisions WHERE post_id = v_id) = 5, 'B3', '고정만 → 수정 날짜 그대로, 판 이력 5행');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('site_board_post_save', ${keysLiteral('site_board_post_save')}, ARRAY['새 공지 제목 RH14', '새 공지 본문 RH14', '고친 본문 RH14']),
      'B3', '저장 기록 details 키·request·원문 없음');
    v_log := v_log || pg_temp.ensure((SELECT bool_and(r.body_sha256 = encode(sha256(convert_to(r.body, 'UTF8')), 'hex')) FROM public.site_board_post_revisions r WHERE r.post_id = v_id),
      'B3', '판 이력 지문 = 본문 sha256');
    -- 칸별 입력 오류
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '   ', '본문'), 'ERR SITE_BOARD_INPUT_INVALID:title', 'B3', '빈 제목');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', E'두\\n줄', '본문'), 'ERR SITE_BOARD_INPUT_INVALID:title', 'B3', '두 줄 제목');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', repeat('가', 101), '본문'), 'ERR SITE_BOARD_INPUT_INVALID:title', 'B3', '101자 제목');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', repeat('가', 100), '본문'), 'OK', 'B3', '100자 제목');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', ''), 'ERR SITE_BOARD_INPUT_INVALID:body', 'B3', '빈 본문');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', repeat('가', 20001)), 'ERR SITE_BOARD_INPUT_INVALID:body', 'B3', '20001자 본문');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', '본문', NULL, NULL, '/terms', NULL), 'ERR SITE_BOARD_INPUT_INVALID:linkLabel', 'B3', '링크 이름 없음');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', '본문', NULL, NULL, '/terms', repeat('가', 31)), 'ERR SITE_BOARD_INPUT_INVALID:linkLabel', 'B3', '31자 링크 이름');
    v_r := pg_temp.save(v_owner, 'notice', '제목', '본문', NULL, NULL, NULL, '이름만');
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (SELECT link_label IS NULL FROM public.site_board_posts WHERE id = pg_temp.new_id(v_r)), 'B3', '링크 없이 이름만 → 이름 버림');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', '본문', NULL, NULL, NULL, NULL, 'credit'), 'ERR SITE_BOARD_INPUT_INVALID:faqCategoryKey', 'B3', '공지에 분류');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'faq', '질문', '답'), 'ERR SITE_BOARD_INPUT_INVALID:faqCategoryKey', 'B3', 'FAQ 분류 없음');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'faq', '질문', '답', NULL, NULL, NULL, NULL, 'nope'), 'ERR SITE_BOARD_INPUT_INVALID:faqCategoryKey', 'B3', 'FAQ 없는 분류');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'faq', '질문', '답', NULL, NULL, NULL, NULL, 'credit', true), 'ERR SITE_BOARD_INPUT_INVALID:isPinned', 'B3', 'FAQ 고정');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_site_board_post(%L, NULL, NULL, %L, %L, %L, NULL, NULL, NULL, false, true, %L::jsonb)',
      v_owner, 'notice', '제목', '본문', '[]')), 'ERR SITE_BOARD_INPUT_INVALID:request', 'B3', '요청 정보가 객체가 아님');
    -- 삭제한 글 고치기
    v_log := v_log || pg_temp.expect(pg_temp.del(v_owner, v_id, pg_temp.rev(v_id)), 'OK', 'B3', '삭제');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '고침', '본문', v_id, pg_temp.rev(v_id)), 'ERR SITE_BOARD_POST_DELETED', 'B3', '삭제 글 고치기 거절');
    -- 링크 예시 묶음(isAllowedNoticeLink 와 같은 표)
${linkChecks}`)
}

// ── 경우 B4: 개인정보(예시 묶음 pii 와 같은 표, 고객센터 값은 운영 DB 값) ─────────────────────────────────────
function caseB4() {
  const linkChecks = EXAMPLES.linkPii.map((example) => {
    const expected = example.hits.length === 0 ? 'OK' : `ERR SITE_BOARD_PII_SUSPECTED:${[...example.hits].sort().join(',')}`
    return `
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '링크 개인정보', '본문', NULL, NULL, ${sqlString(example.url)}, '보기'), ${sqlString(expected)}, 'B4', ${sqlString(`링크 ${example.url.slice(0, 32)} → ${expected.slice(0, 40)}`)});`
  }).join('')
  const checks = EXAMPLES.pii.map((example) => `
    v_r := replace(replace(replace(replace(${sqlString(example.text)}, '{customerCenterDigits}', v_cc_digits), '{customerCenter}', v_cc), '{orderEmailUpper}', upper(v_mail)), '{orderEmail}', v_mail);
    v_log := v_log || pg_temp.ensure(public.member_facing_text_pii_hits(v_r) = ${sqlArray(example.hits)}, 'B4', ${sqlString(`판정 ${example.text.slice(0, 24)} → [${example.hits.join(',')}]`)});`).join('')
  return isolatedCase('rh_b4', 'B4', `
    v_cc := (SELECT value #>> '{fixedFields,customerCenter,value}' FROM public.system_settings WHERE key = 'site_footer_content');
    v_mail := (SELECT value #>> '{fixedFields,orderEmail,value}' FROM public.system_settings WHERE key = 'site_footer_content');
    v_cc_digits := regexp_replace(coalesce(v_cc, ''), '[^0-9]', '', 'g');
    v_log := v_log || pg_temp.ensure(coalesce(v_cc, '') <> '' AND coalesce(v_mail, '') <> '', 'B4', '하단 정보 고객센터 값 있음(운영 DB)');${checks}
    -- 저장 거절(본문·링크 주소·링크 이름·제목), 응답에는 종류만
    v_r := pg_temp.save(v_owner, 'notice', '제목', '연락은 rh14person@example.com 으로');
    v_log := v_log || pg_temp.expect(v_r, 'ERR SITE_BOARD_PII_SUSPECTED:email', 'B4', '본문 이메일 거절');
    v_log := v_log || pg_temp.ensure(strpos(v_r, 'rh14person') = 0, 'B4', '응답에 글자 없음');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', '본문', NULL, NULL, '/search?q=01012345678', '보기'), 'ERR SITE_BOARD_PII_SUSPECTED:mobile', 'B4', '링크 주소 휴대폰 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', '본문', NULL, NULL, '/terms', 'a@b.co'), 'ERR SITE_BOARD_PII_SUSPECTED:email', 'B4', '링크 이름 이메일 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '주민 900101-1234567', '본문'), 'ERR SITE_BOARD_PII_SUSPECTED:rrn', 'B4', '제목 주민번호 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', '서울 02-123-4567 그리고 010-1234-5678'), 'ERR SITE_BOARD_PII_SUSPECTED:mobile,phone', 'B4', '여러 종류는 이름순 목록');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '제목', '고객센터 ' || v_cc || ' / ' || v_cc_digits || ' / ' || v_mail), 'OK', 'B4', '고객센터 번호(하이픈 있음·없음)·주문 이메일 통과');
    -- 링크 주소는 퍼센트 인코딩을 푼 값도 검사(예시 묶음 linkPii 와 같은 표)${linkChecks}
    -- 설정 문구도 검사
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 1, jsonb_set(pg_temp.content_value(), '{notice,pageDescription}', to_jsonb('문의 010-2222-3333'::text))),
      'ERR SITE_BOARD_PII_SUSPECTED:mobile', 'B4', '설정 문구 휴대폰 거절');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 1, jsonb_set(pg_temp.content_value(), '{faq,categories,0,label}', to_jsonb('x@y.co'::text))),
      'ERR SITE_BOARD_PII_SUSPECTED:email', 'B4', 'FAQ 분류 이름도 검사');`, `  v_cc text;
  v_mail text;
  v_cc_digits text;
`)
}

// ── 경우 B5: 고정·순서 ─────────────────────────────────────────────────────────────────────────────
function caseB5() {
  return isolatedCase('rh_b5', 'B5', `
    -- 고정 5개(그중 1개 숨김) → 6번째 고정 거절(숨긴 고정 포함)
    FOR v_n IN 1 .. 5 LOOP
      v_r := pg_temp.save(v_owner, 'notice', '고정 ' || v_n, '본문', NULL, NULL, NULL, NULL, NULL, true, v_n <> 3);
      PERFORM pg_temp.expect(v_r, 'OK', 'B5', '고정 ' || v_n);
      v_ids := coalesce(v_ids, '{}') || pg_temp.new_id(v_r);
    END LOOP;
    v_log := v_log || pg_temp.ensure((SELECT array_agg(sort_order ORDER BY created_at) FROM public.site_board_posts WHERE id = ANY (v_ids)) = ARRAY[1, 2, 3, 4, 5],
      'B5', '새 고정 글은 고정 맨 뒤(1~5)');
    v_r := pg_temp.save(v_owner, 'notice', '비고정 1', '본문');
    v_p := pg_temp.new_id(v_r);
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '고정 6', '본문', NULL, NULL, NULL, NULL, NULL, true), 'ERR SITE_BOARD_PIN_LIMIT', 'B5', '상한 초과(숨긴 고정 포함)');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '비고정 1', '본문', v_p, 1, NULL, NULL, NULL, true), 'ERR SITE_BOARD_PIN_LIMIT', 'B5', '기존 글 고정도 상한');
    -- 고정 해제 → 0·날짜 자리, 기존 글 고정 → 맨 뒤
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '고정 2', '본문', v_ids[2], 1, NULL, NULL, NULL, false), 'OK', 'B5', '고정 2 해제');
    v_log := v_log || pg_temp.ensure((SELECT sort_order = 0 FROM public.site_board_posts WHERE id = v_ids[2]), 'B5', '해제 → sort_order 0');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '비고정 1', '본문', v_p, 1, NULL, NULL, NULL, true), 'OK', 'B5', '기존 글 고정');
    v_log := v_log || pg_temp.ensure((SELECT sort_order = 6 FROM public.site_board_posts WHERE id = v_p), 'B5', '기존 글 고정 → 고정 맨 뒤(6)');
    v_log := v_log || pg_temp.ensure(pg_temp.notice_order() = ARRAY[v_ids[1], v_ids[4], v_ids[5], v_p, v_ids[2]],
      'B5', '회원 순서: 게시 고정(sort_order) → 비고정(게시일 최신순, 해제한 글은 날짜 자리)');
    -- 순서 바꾸기: 범위 = 미삭제 고정(숨김 포함) [1,3,4,5,p]
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'notice', 'pinned', ARRAY[v_ids[1], v_ids[3], v_ids[4], v_ids[5]]), 'ERR SITE_BOARD_REORDER_MISMATCH', 'B5', '빠짐 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'notice', 'pinned', ARRAY[v_ids[1], v_ids[3], v_ids[4], v_ids[5], v_p, v_ids[2]]), 'ERR SITE_BOARD_REORDER_MISMATCH', 'B5', '더함 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'notice', 'pinned', ARRAY[v_ids[1], v_ids[3], v_ids[4], v_ids[5], v_ids[5]]), 'ERR SITE_BOARD_REORDER_MISMATCH', 'B5', '중복 거절');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'notice', 'faq', ARRAY[v_p]), 'ERR SITE_BOARD_INPUT_INVALID:scope', 'B5', '공지 범위는 pinned 만');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'notice', 'pinned', ARRAY[v_p, v_ids[5], v_ids[4], v_ids[3], v_ids[1]]), 'OK', 'B5', '숨긴 고정 포함 순서 저장');
    v_log := v_log || pg_temp.ensure((SELECT array_agg(id ORDER BY sort_order) FROM public.site_board_posts WHERE board = 'notice' AND is_pinned AND deleted_at IS NULL)
      = ARRAY[v_p, v_ids[5], v_ids[4], v_ids[3], v_ids[1]] AND pg_temp.rev(v_p) = 2 AND pg_temp.audit_count('site_board_post_reorder') = 1,
      'B5', '순서 반영·revision 그대로·기록 1');
    v_r := pg_temp.reorder(v_owner, 'notice', 'pinned', ARRAY[v_p, v_ids[5], v_ids[4], v_ids[3], v_ids[1]]);
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (pg_temp.res(v_r) -> 'changed') = 'false'::jsonb AND pg_temp.audit_count('site_board_post_reorder') = 1, 'B5', '같은 순서 → 기록 없음');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('site_board_post_reorder', ${keysLiteral('site_board_post_reorder')}, ARRAY['고정 1']), 'B5', '순서 기록 details 키');
    -- 상한 낮추기: 지금 고정 5개보다 작게는 거절
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 1, jsonb_set(pg_temp.content_value(), '{notice,maxPinned}', '4')), 'ERR SITE_BOARD_INPUT_INVALID:notice.maxPinned', 'B5', '상한 < 고정 수 거절');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 1, jsonb_set(pg_temp.content_value(), '{notice,maxPinned}', '21')), 'ERR SITE_BOARD_INPUT_INVALID:notice.maxPinned', 'B5', '상한 21 거절');
    -- FAQ: 새 글은 분류 맨 뒤, 분류 바꾸면 새 분류 맨 뒤, 숨긴 FAQ 포함 범위 순서 저장
    v_r := pg_temp.save(v_owner, 'faq', '크레딧 1', '답', NULL, NULL, NULL, NULL, 'credit'); v_q := pg_temp.new_id(v_r);
    v_r := pg_temp.save(v_owner, 'faq', '크레딧 2(숨김)', '답', NULL, NULL, NULL, NULL, 'credit', false, false); v_id := pg_temp.new_id(v_r);
    v_r := pg_temp.save(v_owner, 'faq', '환불 1', '답', NULL, NULL, NULL, NULL, 'refund');
    v_log := v_log || pg_temp.ensure((SELECT sort_order FROM public.site_board_posts WHERE id = v_q) = 1 AND (SELECT sort_order FROM public.site_board_posts WHERE id = v_id) = 2
      AND (SELECT sort_order FROM public.site_board_posts WHERE id = pg_temp.new_id(v_r)) = 1, 'B5', 'FAQ 새 글 → 분류 맨 뒤');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'faq', 'credit', ARRAY[v_id, v_q]), 'OK', 'B5', '숨긴 FAQ 포함 분류 순서 저장');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'faq', '크레딧 1', '답', v_q, 1, NULL, NULL, 'refund'), 'OK', 'B5', 'FAQ 분류 바꿈');
    v_log := v_log || pg_temp.ensure((SELECT sort_order FROM public.site_board_posts WHERE id = v_q) = 2, 'B5', '분류 바꿈 → 새 분류 맨 뒤(2)');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'faq', 'credit', ARRAY[v_id, v_q]), 'ERR SITE_BOARD_REORDER_MISMATCH', 'B5', '옮긴 글은 옛 분류 범위 밖');
    v_log := v_log || pg_temp.expect(pg_temp.reorder(v_owner, 'faq', 'Credit', ARRAY[v_id]), 'ERR SITE_BOARD_INPUT_INVALID:scope', 'B5', 'FAQ 범위 key 형식');`)
}

// ── 경우 B6: 삭제·분류·가림 ───────────────────────────────────────────────────────────────────────────
function caseB6() {
  return isolatedCase('rh_b6', 'B6', `
    -- 삭제: 회원 목록에서 빠짐, 판 이력 1행, 기록(지문·글자 수만)
    v_r := pg_temp.save(v_owner, 'notice', '삭제할 공지 RH14', '삭제할 본문 RH14', NULL, NULL, '/terms', '약관');
    v_id := pg_temp.new_id(v_r);
    v_log := v_log || pg_temp.expect(pg_temp.del(v_owner, v_id, 9), 'ERR SITE_BOARD_REVISION_CONFLICT', 'B6', '삭제 판 충돌');
    v_log := v_log || pg_temp.expect(pg_temp.del(v_owner, v_id, 1), 'OK', 'B6', '삭제');
    v_log := v_log || pg_temp.ensure(NOT (v_id = ANY (pg_temp.notice_order()))
      AND (SELECT deleted_at IS NOT NULL AND NOT is_published AND NOT is_pinned AND sort_order = 0 AND revision = 2 AND deleted_by = v_owner
             FROM public.site_board_posts WHERE id = v_id)
      AND (SELECT count(*) FROM public.site_board_post_revisions WHERE post_id = v_id) = 2, 'B6', '목록에서 빠짐·판 이력 2행');
    v_log := v_log || pg_temp.expect(pg_temp.del(v_owner, v_id, 2), 'ERR SITE_BOARD_POST_DELETED', 'B6', '두 번 삭제 거절');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('site_board_post_delete', ${keysLiteral('site_board_post_delete')}, ARRAY['삭제할 공지 RH14', '삭제할 본문 RH14']),
      'B6', '삭제 기록 details 키·원문 없음');
    -- 분류 사용 중: 숨긴 글만 있어도 지우기 거절, 삭제 글만 남으면 통과
    v_r := pg_temp.save(v_owner, 'faq', '다운로드 질문', '답', NULL, NULL, NULL, NULL, 'download', false, false);
    v_q := pg_temp.new_id(v_r);
    v_j := jsonb_set(pg_temp.content_value(), '{faq,categories}',
      (SELECT jsonb_agg(c) FROM jsonb_array_elements(pg_temp.content_value() #> '{faq,categories}') c WHERE c ->> 'key' <> 'download'));
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 1, v_j), 'ERR SITE_BOARD_CATEGORY_IN_USE:download', 'B6', '숨긴 글 있는 분류 지우기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.del(v_owner, v_q, 1), 'OK', 'B6', '그 글 삭제');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 1, v_j), 'OK', 'B6', '삭제 글만 남은 분류 지우기 통과');
    v_log := v_log || pg_temp.ensure(pg_temp.content_rev() = 2 AND jsonb_array_length(pg_temp.content_value() #> '{faq,categories}') = 3
      AND (SELECT faq_category_key = 'download' FROM public.site_board_posts WHERE id = v_q), 'B6', 'revision 2·분류 3개·삭제 글의 옛 key 그대로');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 1, v_j), 'ERR SITE_BOARD_REVISION_CONFLICT', 'B6', '안내 문구 판 충돌');
    v_r := pg_temp.content(v_owner, 2, pg_temp.content_value());
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (pg_temp.res(v_r) -> 'changed') = 'false'::jsonb AND pg_temp.content_rev() = 2, 'B6', '안내 문구 바뀐 것 없음');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('site_board_content_update') = 1
      AND pg_temp.audit_ok('site_board_content_update', ${keysLiteral('site_board_content_update')}, ARRAY[]::text[]), 'B6', '안내 문구 기록 details 키');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 2, jsonb_set(pg_temp.content_value(), '{faq,categories}', '[{"key":"a","label":"가"},{"key":"a","label":"나"}]')),
      'ERR SITE_BOARD_INPUT_INVALID:faq.categories', 'B6', '분류 key 중복 거절');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 2, jsonb_set(pg_temp.content_value(), '{faq,categories}', '[{"key":"Bad","label":"가"}]')),
      'ERR SITE_BOARD_INPUT_INVALID:faq.categories', 'B6', '분류 key 형식 거절');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 2, jsonb_set(pg_temp.content_value(), '{notice,pageTitle}', '"  "')),
      'ERR SITE_BOARD_INPUT_INVALID:notice.pageTitle', 'B6', '필수 키 빈 값 거절');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 2, pg_temp.content_value() #- '{footer,navLabel}'),
      'ERR SITE_BOARD_INPUT_INVALID:footer.navLabel', 'B6', '필수 키 없음 거절');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 2, jsonb_set(pg_temp.content_value(), '{redactedText}', to_jsonb(repeat('가', 101)))),
      'ERR SITE_BOARD_INPUT_INVALID:redactedText', 'B6', '101자 가림 문구 거절');
    v_log := v_log || pg_temp.expect(pg_temp.content(v_owner, 2, jsonb_set(pg_temp.content_value(), '{redactedText}', to_jsonb(E'두\\n줄'::text))),
      'ERR SITE_BOARD_INPUT_INVALID:redactedText', 'B6', '여러 줄 가림 문구 거절');
    -- 가림: 게시 중 거절 → 숨김 → 가림(모든 판 제목·본문 = 가림 문구, 링크 NULL)
    v_r := pg_temp.save(v_owner, 'notice', '개인정보 실수 RH14', '홍길동 님 안내 RH14', NULL, NULL, '/search?q=hong', '보기');
    v_p := pg_temp.new_id(v_r);
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '개인정보 실수 RH14', '홍길동 님 안내 RH14 고침', v_p, 1, '/search?q=hong', '보기'), 'OK', 'B6', '한 번 고침(판 2)');
    v_log := v_log || pg_temp.expect(pg_temp.redact(v_owner, v_p), 'ERR SITE_BOARD_REDACT_PUBLISHED', 'B6', '게시 중 가림 거절');
    v_log := v_log || pg_temp.expect(pg_temp.redact(v_owner, v_p, 'free text'), 'ERR SITE_BOARD_INPUT_INVALID:reasonCode', 'B6', '정해진 사유 코드만');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '개인정보 실수 RH14', '홍길동 님 안내 RH14 고침', v_p, 2, '/search?q=hong', '보기', NULL, false, false), 'OK', 'B6', '숨김');
    v_r := pg_temp.redact(v_owner, v_p);
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'B6', '가림');
    v_log := v_log || pg_temp.ensure((pg_temp.res(v_r) ->> 'revisionsRedacted')::integer = 3
      AND (SELECT bool_and(r.title = (pg_temp.content_value() ->> 'redactedText') AND r.body = r.title AND r.link_url IS NULL AND r.link_label IS NULL
             AND r.body_sha256 IS NULL AND r.redacted_at IS NOT NULL AND r.redacted_by = v_owner) FROM public.site_board_post_revisions r WHERE r.post_id = v_p)
      AND (SELECT title = (pg_temp.content_value() ->> 'redactedText') AND link_url IS NULL AND redacted_at IS NOT NULL FROM public.site_board_posts WHERE id = v_p),
      'B6', '가림 뒤 판 이력 3행 전부 가림 문구·링크·지문 NULL, 지금 글도');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM public.site_board_post_revisions r WHERE r.post_id = v_p AND (r.body LIKE '%홍길동%' OR r.title LIKE '%RH14%')),
      'B6', '원문이 판 이력에 남지 않음');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('site_board_post_redact', ${keysLiteral('site_board_post_redact')}, ARRAY['홍길동', '개인정보 실수 RH14'])
      AND pg_temp.audit_ok('site_board_post_save', ${keysLiteral('site_board_post_save')}, ARRAY['홍길동', '개인정보 실수 RH14', '/search?q=hong']), 'B6', '가림·저장 기록에 원문 없음');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '되살리기', '본문', v_p, pg_temp.rev(v_p)), 'ERR SITE_BOARD_POST_DELETED', 'B6', '가린 글 고치기 거절');
    v_r := pg_temp.redact(v_owner, v_p);
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (pg_temp.res(v_r) -> 'changed') = 'false'::jsonb AND pg_temp.audit_count('site_board_post_redact') = 1, 'B6', '다시 가림 → 바뀐 것 없음');
    v_log := v_log || pg_temp.expect(pg_temp.del(v_owner, v_p, pg_temp.rev(v_p)), 'OK', 'B6', '가린 글 삭제(판 이력 4행째도 가린 상태)');
    v_log := v_log || pg_temp.ensure((SELECT bool_and(redacted_at IS NOT NULL AND body_sha256 IS NULL) FROM public.site_board_post_revisions WHERE post_id = v_p)
      AND NOT EXISTS (SELECT 1 FROM public.admin_audit_log a WHERE a.action LIKE 'site_board_%' AND a.created_at >= now() AND a.details::text LIKE '%sha256%'),
      'B6', '가린 뒤 판 이력도 가린 표시·지문 NULL, 작업 기록에 지문 없음');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.site_board_post_revisions SET body_sha256 = %L WHERE post_id = %L', repeat('0', 64), v_p)),
      'ERR SITE_BOARD_REVISIONS_APPEND_ONLY', 'B6', '가린 판 이력에 지문 되살리기 거절');
    -- 판 이력 가드: 소유자도 DELETE·TRUNCATE·다른 UPDATE 거절
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('DELETE FROM public.site_board_post_revisions WHERE post_id = %L', v_id)), 'ERR SITE_BOARD_REVISIONS_APPEND_ONLY', 'B6', '판 이력 DELETE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('TRUNCATE public.site_board_post_revisions'), 'ERR SITE_BOARD_REVISIONS_APPEND_ONLY', 'B6', '판 이력 TRUNCATE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.site_board_post_revisions SET title = %L WHERE post_id = %L', '바꿈', v_id)), 'ERR SITE_BOARD_REVISIONS_APPEND_ONLY', 'B6', '판 이력 UPDATE 거절');
    PERFORM set_config('app.site_board_redact', v_id::text, true);
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.site_board_post_revisions SET title = %L, body = %L, link_url = NULL, link_label = NULL, redacted_at = now(), redacted_by = %L, saved_by = %L WHERE post_id = %L',
      pg_temp.content_value() ->> 'redactedText', pg_temp.content_value() ->> 'redactedText', v_owner, v_e, v_id)), 'ERR SITE_BOARD_REVISIONS_APPEND_ONLY', 'B6', '가림 표지가 있어도 다른 칸(saved_by) 바꾸기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.site_board_post_revisions SET title = %L, body = %L, link_url = NULL, link_label = NULL, redacted_at = now(), redacted_by = %L WHERE post_id = %L',
      '다른 글', '다른 글', v_owner, v_id)), 'ERR SITE_BOARD_REVISIONS_APPEND_ONLY', 'B6', '가림 문구가 아닌 글로 바꾸기 거절');
    PERFORM set_config('app.site_board_redact', '', true);`)
}

// ── 경우 B8: 권한 표(표·함수) ───────────────────────────────────────────────────────────────────────
function caseB8() {
  return isolatedCase('rh_b8', 'B8', `
    v_r := pg_temp.save(v_owner, 'notice', '권한 표 시험', '본문');
    v_id := pg_temp.new_id(v_r);
    FOREACH v_q_text IN ARRAY ARRAY['public.site_board_posts', 'public.site_board_post_revisions'] LOOP
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', format('SELECT count(*)::text FROM %s', v_q_text)), 'ERR', 'B8', v_q_text || ' anon SELECT 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', format('SELECT count(*)::text FROM %s', v_q_text)), 'ERR', 'B8', v_q_text || ' 대표 세션 SELECT 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', format('SELECT count(*)::text FROM %s', v_q_text)), 'OK', 'B8', v_q_text || ' service_role SELECT');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', format('WITH d AS (DELETE FROM %s RETURNING 1) SELECT count(*)::text FROM d', v_q_text)), 'ERR', 'B8', v_q_text || ' service_role DELETE 거절');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', format('WITH u AS (UPDATE %s SET title = title RETURNING 1) SELECT count(*)::text FROM u', v_q_text)), 'ERR', 'B8', v_q_text || ' service_role UPDATE 거절');
    END LOOP;
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated',
      format('WITH i AS (INSERT INTO public.site_board_posts (board, title, body, created_by) VALUES (%L, %L, %L, %L) RETURNING 1) SELECT count(*)::text FROM i', 'notice', 't', 'b', v_owner)),
      'ERR', 'B8', 'authenticated INSERT 거절');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role',
      format('WITH i AS (INSERT INTO public.site_board_posts (board, title, body, created_by) VALUES (%L, %L, %L, %L) RETURNING 1) SELECT count(*)::text FROM i', 'notice', 't', 'b', v_owner)),
      'ERR', 'B8', 'service_role INSERT 거절');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role',
      format('WITH i AS (INSERT INTO public.site_board_post_revisions (post_id, revision, title, body, is_pinned, is_published, body_sha256, saved_by) VALUES (%L, 9, %L, %L, false, true, %L, %L) RETURNING 1) SELECT count(*)::text FROM i',
        v_id, 't', 'b', repeat('0', 64), v_owner)), 'ERR', 'B8', 'service_role 판 이력 INSERT 거절');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated',
      format('SELECT public.save_site_board_post(%L, NULL, NULL, %L, %L, %L, NULL, NULL, NULL, false, true, %L::jsonb)::text', v_owner, 'notice', 't', 'b', '{}')),
      'ERR', 'B8', 'authenticated 는 저장 함수를 부를 수 없음');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', 'SELECT public.member_facing_text_pii_hits(''x'')::text'), 'ERR', 'B8', 'anon 은 판정 함수를 부를 수 없음');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', format('SELECT public.site_board_actor_allowed(%L)::text', v_owner)), 'ERR', 'B8', 'authenticated 는 행위자 판정을 부를 수 없음');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role',
      format('SELECT public.save_site_board_post(%L, NULL, NULL, %L, %L, %L, NULL, NULL, NULL, false, true, %L::jsonb)::text', v_owner, 'notice', 'service 글', '본문', '{}')),
      'OK', 'B8', 'service_role 은 저장 함수를 부름');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', 'SELECT public.guard_site_board_post_revisions_mutation()::text'), 'ERR', 'B8', '가드 함수는 아무도 못 부름');`, `  v_q_text text;
`)
}

// 끝에 남은 것: 경우는 모두 격리돼 있어 새 표 행·이 거래의 14번 기록이 0 이어야 한다.
const LEFTOVER = isolatedCase('rh_leftover', 'Z', `
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.site_board_posts) = 0 AND (SELECT count(*) FROM public.site_board_post_revisions) = 0
      AND (SELECT count(*) FROM public.admin_audit_log WHERE action LIKE 'site_board_%' AND created_at >= now()) = 0
      AND pg_temp.content_rev() = 1, 'Z', '경우 밖에 남은 글·판 이력·14번 기록 0, 설정 행 revision 1(ROLLBACK 전)');`)

// ── full 전용: 적용 전 down 멈춤, 실제 적용 절차(이력 INSERT), 되돌리기 뒤 이력 행 지우기·다시 적용 ───────────────────────────
const BEFORE_APPLY = isolatedCase('rh_before', 'F0', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: bundle 14 tables missing', 'F0', '적용 전 down 멈춤');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = ${sqlString(MIGRATION_VERSION)}), 'F0', '이력 행 없음');`)

const HISTORY_INSERT = `
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (${sqlString(MIGRATION_VERSION)}, ${sqlString(MIGRATION_NAME)});
`

const CASE_F = isolatedCase('rh_f', 'F', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'F', 'down(글 없음)');
    DELETE FROM supabase_migrations.schema_migrations WHERE version = ${sqlString(MIGRATION_VERSION)};
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'F', '이력 행 지운 뒤 다시 적용');
    INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (${sqlString(MIGRATION_VERSION)}, ${sqlString(MIGRATION_NAME)});
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, 'notice', '다시 적용 뒤', '본문'), 'OK', 'F', '다시 적용 뒤 저장');`)

export function buildRehearsalFiles() {
  const cases = caseB1() + caseB2() + caseB3() + caseB4() + caseB5() + caseB6() + caseB8()
  const light = prelude({
    title: 'A light — 마이그레이션 원본 그대로, 경우 A·B1~B8(B7 기록은 각 경우 안에서)',
    when: '지금 돌려도 됨(새 표 2개·새 함수·system_settings 행 1개 — 기존 표의 LOCK/ALTER TABLE·TRIGGER·POLICY·FK 없음, 시험 계정 행·권한 행의 행 잠금뿐). 이력 표는 쓰지 않는다.',
    mode: 'light',
  })
    + APPLY + migrationCopy() + '\n'
    + ROLES + CASE_A + cases + LEFTOVER + FOOT
  assertLight(light, 'a_light.sql')

  const full = prelude({
    title: 'B full — light 전부 + 적용 전 down 멈춤(F0)·실제 적용 절차(이력 INSERT)·되돌리기 뒤 이력 행 지우기·다시 적용(F)',
    when: '적용 승인 뒤 적용 직전(supabase_migrations 이력 표에 쓴다 — ROLLBACK 됨). 기존 표에 거는 DDL 은 light 와 같이 없다.',
    mode: 'full',
  })
    + BEFORE_APPLY
    + APPLY + migrationCopy() + '\n'
    + HISTORY_INSERT
    + ROLES + CASE_A + cases + CASE_F + LEFTOVER + FOOT

  const files = { 'a_light.sql': light, 'b_full.sql': full }
  for (const [name, content] of Object.entries(files)) {
    if (/\bCOMMIT\s*;/.test(content)) throw new Error(`${name} contains a COMMIT statement`)
    if (!content.trimEnd().endsWith('ROLLBACK;')) throw new Error(`${name} must end with ROLLBACK`)
  }
  return files
}

// ── 개발 미리보기 예시(10-2, output/ 은 git 에 넣지 않는다) ───────────────────────────────────────────────
export function seedContentFromMigration() {
  const match = read(SOURCES.migration).match(/\$json_site_board_content\$([\s\S]*?)\$json_site_board_content\$/)
  if (!match) throw new Error('seed content not found in migration')
  return JSON.parse(match[1])
}

export function buildPreviewData() {
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const day = (n) => new Date(Date.UTC(2026, 10, 1 + n, 1)).toISOString()
  const base = {
    linkUrl: null, linkLabel: null, faqCategoryKey: null, isPinned: false, sortOrder: 0, isPublished: true, contentUpdatedAt: null,
    revision: 1, deletedAt: null, redactedAt: null, updatedBy: null, updatedByLabel: '미리보기',
  }
  const notices = [
    { ...base, id: id(1), board: 'notice', title: '[고정] 정식 오픈 안내', body: '## 정식 오픈\n써 보시고 불편한 점을 알려 주세요.\n- 첫째 안내\n- 둘째 안내', isPinned: true, sortOrder: 1, publishedAt: day(1), updatedAt: day(1),
      linkUrl: '/terms/upcoming', linkLabel: '바뀌는 약관 보기', contentUpdatedAt: day(3) },
    { ...base, id: id(2), board: 'notice', title: '[고정] 결제 수단 안내', body: '결제 수단 안내 본문입니다.', isPinned: true, sortOrder: 2, publishedAt: day(2), updatedAt: day(2) },
    { ...base, id: id(3), board: 'notice', title: '[고정·숨김] 점검 예정(관리자에게만 보임)', body: '숨긴 고정 글입니다.', isPinned: true, sortOrder: 3, isPublished: false, publishedAt: null, updatedAt: day(2) },
    { ...base, id: id(4), board: 'notice', title: '고정을 푼 옛 공지(날짜 자리)', body: '고정을 풀면 게시일 자리로 갑니다.', publishedAt: day(0), updatedAt: day(4) },
    { ...base, id: id(5), board: 'notice', title: '숨긴 공지', body: '숨김', isPublished: false, publishedAt: day(5), updatedAt: day(5) },
  ]
  for (let n = 1; n <= 21; n += 1) {
    notices.push({ ...base, id: id(100 + n), board: 'notice', title: `일반 공지 ${n}`, body: `일반 공지 ${n} 본문입니다.`, publishedAt: day(5 + n), updatedAt: day(5 + n) })
  }
  const categories = ['credit', 'refund', 'account']
  const faqs = []
  for (let n = 1; n <= 26; n += 1) {
    const key = categories[n % categories.length]
    faqs.push({ ...base, id: id(200 + n), board: 'faq', faqCategoryKey: key, sortOrder: n, title: `${n}번째 질문(${key})`, body: `${n}번째 답입니다.\n- 목록 한 줄`, publishedAt: day(n), updatedAt: day(n) })
  }
  faqs.push({ ...base, id: id(299), board: 'faq', faqCategoryKey: 'credit', sortOrder: 99, title: '숨긴 FAQ(관리자 순서 묶음에만)', body: '숨김', isPublished: false, publishedAt: null, updatedAt: day(1) })
  return {
    _comment: '14번 개발 미리보기 예시(생성 파일). SITE_BOARD_PREVIEW=1 SITE_BOARD_PREVIEW_FILE=output/b14-site-board-preview.json npm run dev',
    content: seedContentFromMigration(),
    posts: [...notices, ...faqs],
    // N6: 쿼리가 붙은 링크·시작 전 예약 팝업도 연결로 본다
    popup: {
      enabled: true, title: '미리보기 팝업', body: '미리보기', linkUrl: `/notices/${id(1).toUpperCase()}/?from=popup#top`, linkLabel: '보기',
      startsAt: '2098-01-01T00:00:00Z', endsAt: '2099-01-01T00:00:00Z', contentSha256: 'a'.repeat(64), revision: 1,
    },
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--preview')) {
    const out = join(ROOT, 'output/b14-site-board-preview.json')
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
