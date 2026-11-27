// 13번 묶음 리허설 생성기(계획 docs/plan-bundle13-cs-tools.md 12-2: 실제 파일을 실행하고, 사본은 생성기로 만들어 다른 줄을 계약 시험으로 고정).
// 원본(마이그레이션 M0~M3·down)을 읽어 리허설 SQL 파일을 만든다.
//   node supabase/scripts/bundle13_rehearsal/generate.mjs          → 이 폴더의 *.sql 을 다시 쓴다
//   node supabase/scripts/bundle13_rehearsal/generate.mjs --check  → 다시 만든 값과 파일이 다르면 실패
// 실행(운영 DB, postgres): supabase db query --remote --yes -o json --file supabase/scripts/bundle13_rehearsal/<파일>
//   모든 파일은 BEGIN … 마지막 SELECT … ROLLBACK 이다(COMMIT 없음). 결과는 ON COMMIT DROP 임시 표 _rh_log 로 받는다.
//   계정: @test.com 시험 계정만 쓴다(실회원 id 를 쓰지 않음). 대표·직원 역할은 그 시험 계정을 거래 안에서만 관리자로 바꿔 쓴다. 모자라면
//     'RH FAIL [setup]' 으로 멈춘다. 가짜 auth.users 행은 만들지 않는다.
//   지금(낮) 돌려도 되는 파일: a_light.sql — 기존 표를 잠그는 DDL 없음. M0 는 원본 그대로(새 표만), M1 은 support_tickets 칸 추가·
//     FK 2개(support_tickets·support_ticket_categories 에 SHARE ROW EXCLUSIVE)·slug 트리거와 그 VERIFY 블록을 뺀 사본이다. M2·M3·down 은 돌리지 않는다.
//     경우 A(지문)·E(열람 기록)·T(템플릿·문구 행)·C 일부(이력 가드·가림 함수·탈퇴 열람)만 본다. 시험 계정 행의 행 잠금은 거래가 끝날 때까지(몇 초).
//   새벽에만 돌릴 파일: b_full.sql — 실제 M0·M1·M2·M3(c_code_deployed 만 true 로 바꾼 사본)과 경우 A~G·F(되돌리기·다시 적용) 전부.
//     잠금: support_tickets·support_ticket_categories 는 M1 부터, profiles·support_ticket_revisions·refund_requests·market_refund_requests·
//     market_download_events 는 M3 부터 ROLLBACK 까지 ACCESS EXCLUSIVE(읽기도 막음). **M0·M1 적용 전에 반드시 돌린다.**
//   교훈(12번 b_full): anonymize_member self 경로는 p_ticket_retention_agreed 가 NULL 이면 입력 검사에서 거절된다 — false 를 고지·익명화에 같이 넘긴다.
//     시험 계정 B 에 멈춘 생성 작업(queued·running)이 있으면 익명화가 거절된다 — 그 거래 안에서만 '취소됨'으로 바꾼다.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

export const SOURCES = {
  m0: 'supabase/migrations/20261217100000_bundle13_member_access_log.sql',
  m1: 'supabase/migrations/20261217110000_bundle13_cs_tools.sql',
  m2: 'supabase/migrations/20261217120000_bundle13_support_answer_guard.sql',
  m3: 'supabase/migrations/20261217130000_bundle13_admin_select_narrow.sql',
  m1Down: 'supabase/rollback/20261217110000_bundle13_cs_tools_down.sql',
  m2Down: 'supabase/rollback/20261217120000_bundle13_support_answer_guard_down.sql',
  m3Down: 'supabase/rollback/20261217130000_bundle13_admin_select_narrow_down.sql',
}

// 새로 만드는 표(light 사본에서 ALTER TABLE·CREATE POLICY·CREATE TRIGGER 를 걸어도 되는 곳)
export const NEW_TABLES = ['public.admin_member_access_log', 'public.support_ticket_answer_revisions', 'public.support_reply_templates']

// ── M1 light 사본: 기존 표에 거는 DDL 과 그 VERIFY 블록만 뺀다 ───────────────────────────────────────────────
export const M1_LIGHT_REPLACEMENTS = [
  [' REFERENCES public.support_tickets(id) ON DELETE CASCADE,', ',', 1],
  [' REFERENCES public.support_ticket_categories(id),', ',', 1],
]
export const M1_LIGHT_REMOVALS = [
  /\nALTER TABLE public\.support_tickets ADD COLUMN response_edited_at timestamptz;\n/,
  /\nCREATE TRIGGER guard_support_category_slug\n[\s\S]*?;\n/,
  /\nDO \$verify_bundle13_cs_tools_existing_tables\$\n[\s\S]*?\n\$verify_bundle13_cs_tools_existing_tables\$;\n/,
]
// light 사본에 남으면 안 되는 글(기존 표를 잠그는 DDL)
export const LIGHT_FORBIDDEN = [
  'LOCK TABLE', 'ALTER POLICY', 'DROP POLICY', 'DROP TRIGGER', 'DROP TABLE', 'DROP COLUMN', 'ON public.support_tickets', 'ON public.support_ticket_categories',
  'ON public.profiles', 'ON public.system_settings', 'REFERENCES public.', 'ALTER TABLE public.support_tickets', 'COMMIT',
]

function assertLight(source, label) {
  // 주석(-- …)은 보지 않는다(설명 글에 'DROP POLICY' 같은 말이 있다)
  const sql = source.replace(/--[^\n]*/g, '')
  for (const word of LIGHT_FORBIDDEN) {
    if (sql.includes(word)) throw new Error(`${label} light copy still has ${word}`)
  }
  for (const match of sql.matchAll(/ALTER TABLE ([a-z_.]+)/g)) {
    if (!NEW_TABLES.includes(match[1])) throw new Error(`${label} light copy alters an existing table: ${match[1]}`)
  }
  for (const match of sql.matchAll(/CREATE TRIGGER [a-z_]+\s+[A-Z ]+? ON ([a-z_.]+)/g)) {
    if (!NEW_TABLES.includes(match[1])) throw new Error(`${label} light copy creates a trigger on an existing table: ${match[1]}`)
  }
  for (const match of sql.matchAll(/CREATE POLICY [a-z_]+ ON ([a-z_.]+)/g)) {
    if (!NEW_TABLES.includes(match[1])) throw new Error(`${label} light copy creates a policy on an existing table: ${match[1]}`)
  }
}

export function m0Copy() {
  const sql = read(SOURCES.m0)
  assertLight(sql, 'm0')
  return sql
}

export function m1Copy(kind) {
  let sql = read(SOURCES.m1)
  if (kind === 'full') return sql
  if (kind !== 'light') throw new Error(`unknown m1 copy ${kind}`)
  for (const [from, to, times] of M1_LIGHT_REPLACEMENTS) {
    if (sql.split(from).length !== times + 1) throw new Error(`m1 copy: "${from}" not found ${times} times`)
    sql = sql.split(from).join(to)
  }
  for (const re of M1_LIGHT_REMOVALS) {
    if (!re.test(sql)) throw new Error(`m1 copy: ${re} not found`)
    sql = sql.replace(re, '\n')
  }
  assertLight(sql, 'm1')
  return sql
}

// M3 사본: 적용하는 사람의 확인 상수만 바꾼다(리허설은 코드 배포 확인 대신 이 거래에서만 본다).
export const M3_DEPLOYED_LINE = ['  c_code_deployed constant boolean := false;', '  c_code_deployed constant boolean := true;']
export function m3Copy() {
  const sql = read(SOURCES.m3)
  // 2026-11-27 운영 적용 때 원본 상수를 true 로 바꿨다(적용 이력과 같은 글자). 이미 true 면 그대로 쓴다.
  if (sql.split(M3_DEPLOYED_LINE[1]).length === 2 && !sql.includes(M3_DEPLOYED_LINE[0])) return sql
  if (sql.split(M3_DEPLOYED_LINE[0]).length !== 2) throw new Error('m3 copy: c_code_deployed line not found once')
  return sql.replace(M3_DEPLOYED_LINE[0], M3_DEPLOYED_LINE[1])
}

// M1 down 사본의 내보내기 확인 상수(경우 F): 바꾸는 줄은 이 한 줄뿐
export const M1_DOWN_EXPORT_LINE = ['  c_export_confirmed constant boolean := false;', '  c_export_confirmed constant boolean := true;']

function dollar(tag, text) {
  if (text.includes(`$${tag}$`)) throw new Error(`source contains $${tag}$`)
  return `$${tag}$${text}$${tag}$`
}

function sqlString(text) {
  return `'${text.replaceAll("'", "''")}'`
}

// 작업 기록 details 의 키 목록(답변 글·사유 원문 없음 — 계약 시험과 같은 목록)
export const AUDIT_DETAIL_KEYS = {
  support_ticket_reply: ['length', 'request', 'status'],
  support_ticket_reply_edit: ['historyId', 'lengthAfter', 'lengthBefore', 'reasonLength', 'request'],
}

const REQUEST_META = '{"ip": "203.0.113.13", "user_agent": "rh13"}'

// ── 공통 머리 ─────────────────────────────────────────────────────────────────────────────────────
function prelude({ title, when, mode }) {
  const sources = mode === 'full'
    ? `SELECT pg_temp.ctx_set('src_m1', ${dollar('rh_src_m1', m1Copy('full'))});
SELECT pg_temp.ctx_set('src_m2', ${dollar('rh_src_m2', read(SOURCES.m2))});
SELECT pg_temp.ctx_set('src_m3', ${dollar('rh_src_m3', m3Copy())});
SELECT pg_temp.ctx_set('src_m1_down', ${dollar('rh_src_m1_down', read(SOURCES.m1Down))});
SELECT pg_temp.ctx_set('src_m2_down', ${dollar('rh_src_m2_down', read(SOURCES.m2Down))});
SELECT pg_temp.ctx_set('src_m3_down', ${dollar('rh_src_m3_down', read(SOURCES.m3Down))});`
    : `SELECT pg_temp.ctx_set('src_m1', ${dollar('rh_src_m1', m1Copy('light'))});`
  return `-- 13번 묶음 리허설: ${title}
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle13_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle13_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
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
CREATE FUNCTION pg_temp.md5_def(p_sig text) RETURNS text LANGUAGE sql AS $f$
  SELECT CASE WHEN to_regprocedure(p_sig) IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(to_regprocedure(p_sig))) END
$f$;
CREATE FUNCTION pg_temp.md5_src(p_sig text) RETURNS text LANGUAGE sql AS $f$
  SELECT CASE WHEN to_regprocedure(p_sig) IS NULL THEN 'missing' ELSE (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = to_regprocedure(p_sig)) END
$f$;
CREATE FUNCTION pg_temp.grants(p_owner uuid, p_staff uuid, p_keys text[]) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.replace_admin_permission_grants(%L, %L, %L::jsonb)', p_owner, p_staff,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('permission', k)), '[]'::jsonb) FROM unnest(p_keys) k)))
$f$;
-- 이 거래에서 남긴 작업 기록(created_at 기본값 now() = 거래 시작 시각, 앞 경우들은 되돌려져 없다)
CREATE FUNCTION pg_temp.audit_count(p_action text, p_target text DEFAULT NULL) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::integer FROM public.admin_audit_log
   WHERE action = p_action AND created_at >= now() AND (p_target IS NULL OR target_id = p_target)
$f$;
-- 그 종류의 기록이 모두: reason NULL, details 키가 정한 목록과 같음, request 가 객체, 넘긴 자유 글이 들어 있지 않음
CREATE FUNCTION pg_temp.audit_ok(p_action text, p_keys text[], p_forbidden text[]) RETURNS boolean LANGUAGE sql AS $f$
  SELECT count(*) > 0 AND bool_and(a.reason IS NULL
     AND ARRAY(SELECT k FROM jsonb_object_keys(a.details) k ORDER BY k COLLATE "C") = p_keys
     AND jsonb_typeof(a.details -> 'request') = 'object'
     AND NOT EXISTS (SELECT 1 FROM unnest(p_forbidden) f WHERE strpos(a.details::text, f) > 0))
    FROM public.admin_audit_log a WHERE a.action = p_action AND a.created_at >= now()
$f$;
CREATE FUNCTION pg_temp.sha(p_text text) RETURNS text LANGUAGE sql AS $f$
  SELECT encode(sha256(convert_to(COALESCE(p_text, ''), 'UTF8')), 'hex')
$f$;
-- 답변 저장(결과 'OK {json}' 또는 'ERR …'). p_seen = 화면이 본 지금 답변(없으면 NULL)
CREATE FUNCTION pg_temp.save(p_actor uuid, p_ticket uuid, p_response text, p_seen text, p_reason text DEFAULT NULL, p_key text DEFAULT NULL,
  p_status text DEFAULT NULL) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.save_support_ticket_answer(%L, %L, %L, %L, %L, %L, %L, %L::jsonb)', p_actor, p_ticket, p_response,
    p_status, pg_temp.sha(p_seen), p_reason, coalesce(p_key, 'rh13-' || gen_random_uuid()), ${sqlString(REQUEST_META)}))
$f$;
-- 시험 문의(postgres 로 바로 넣음 — 회원 RPC 는 auth.uid() 를 쓴다). 카테고리는 slug 로.
CREATE FUNCTION pg_temp.new_ticket(p_user uuid, p_slug text, p_subject text DEFAULT '시험 문의', p_message text DEFAULT '시험 내용')
  RETURNS uuid LANGUAGE sql AS $f$
  INSERT INTO public.support_tickets (user_id, subject, message, status, category_id)
  VALUES (p_user, p_subject, p_message, 'pending', (SELECT c.id FROM public.support_ticket_categories c WHERE c.slug = p_slug))
  RETURNING id
$f$;
CREATE FUNCTION pg_temp.access(p_actor uuid, p_screen text, p_ids uuid[], p_fields text[], p_reason text DEFAULT NULL) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_sql(format('SELECT public.record_admin_member_access(%L, %L, %L::uuid[], %L::text[], %L::jsonb, %L, %L::jsonb)',
    p_actor, p_screen, p_ids, p_fields, '{"ticketId": "rh13"}', p_reason, ${sqlString(REQUEST_META)}))
$f$;
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

-- 원본 사본(생성기가 원본 파일에서 꺼낸 글 그대로, 바꾼 곳은 생성기가 정함)
SELECT pg_temp.ctx_set('src_m0', ${dollar('rh_src_m0', m0Copy())});
${sources}
SELECT pg_temp.ctx_set('mode', ${sqlString(mode)});

-- ===== 계정: @test.com 시험 계정만(관리자·탈퇴 아님, 가입 완료). 결제·결제 시도·자료 구매·탈퇴 요청이 없는 계정 둘(A·B)은 익명화(경우 C)용,
--       나머지 셋은 대표(owner)·직원(staff, 경우마다 권한을 거래 안에서 바꿈)·대상 회원(E). 모자라면 멈춘다(실회원 id 로 대신하지 않음). =====
DO $rh_setup$
DECLARE
  v_clean uuid[];
  v_rest uuid[];
  v_pool uuid[];
BEGIN
  SELECT coalesce(array_agg(p.id ORDER BY u.created_at), '{}') INTO v_clean
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.email LIKE '%@test.com' AND p.withdrawn_at IS NULL AND p.is_admin IS NOT TRUE AND p.signup_completed IS TRUE
     AND NOT EXISTS (SELECT 1 FROM public.payment_orders o WHERE o.user_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM public.checkout_attempts a WHERE a.user_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM public.market_purchase_orders m WHERE m.user_id = p.id)
     AND NOT EXISTS (SELECT 1 FROM public.member_withdrawal_requests r WHERE r.user_id = p.id);
  SELECT coalesce(array_agg(p.id ORDER BY u.created_at), '{}') INTO v_rest
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE u.email LIKE '%@test.com' AND p.withdrawn_at IS NULL AND p.is_admin IS NOT TRUE AND p.signup_completed IS TRUE
     AND NOT (p.id = ANY (v_clean));
  IF cardinality(v_clean) < 2 OR cardinality(v_clean) + cardinality(v_rest) < 5 THEN
    RAISE EXCEPTION 'RH FAIL [setup] @test.com 시험 계정이 모자람(결제 없는 계정 %개·전체 %개, 필요 2·5) — 실회원 id 로 대신하지 않고 멈춘다',
      cardinality(v_clean), cardinality(v_clean) + cardinality(v_rest);
  END IF;
  v_pool := v_rest || v_clean[3:];
  PERFORM pg_temp.ctx_set('A', v_clean[1]::text);
  PERFORM pg_temp.ctx_set('B', v_clean[2]::text);
  PERFORM pg_temp.ctx_set('owner', v_pool[1]::text);
  PERFORM pg_temp.ctx_set('staff', v_pool[2]::text);
  PERFORM pg_temp.ctx_set('E', v_pool[3]::text);
  INSERT INTO _rh_log (test, msg, payload) VALUES ('setup', '시험 계정 배정(@test.com 만)',
    jsonb_build_object('clean', cardinality(v_clean), 'total', cardinality(v_clean) + cardinality(v_rest)));
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
  v_t uuid;
  v_n integer;
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_e uuid := pg_temp.uid('E');
  v_a uuid := pg_temp.uid('A');
  v_b uuid := pg_temp.uid('B');
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

// ── 적용 전(full): down 은 머리 확인에서 멈춘다 ───────────────────────────────────────────────────────────
const BEFORE_APPLY = isolatedCase('rh_before', 'F0', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m3_down')), 'ERR DOWN PRECHECK: M3 is not applied', 'F0', '적용 전 M3 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m2_down')), 'ERR DOWN PRECHECK: M2 is not applied', 'F0', '적용 전 M2 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m1_down')), 'ERR DOWN PRECHECK: bundle 13 M1 tables missing', 'F0', '적용 전 M1 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m1')), 'ERR PRECHECK: M0 (20261217100000) is not applied', 'F0', 'M0 없이 M1 멈춤');`)

// 경우 G 의 바탕 값(full): M0·M1 만 적용된 상태에서 세션 조회 건수를 적어 둔다(M2·M3 뒤 같은 조회와 비교).
const COUNT_QUERIES = [
  ['tickets', 'SELECT count(*)::text FROM public.support_tickets'],
  ['tickets_pending', "SELECT count(*)::text FROM public.support_tickets WHERE status IN ('pending', 'in_progress')"],
  ['payment_orders', 'SELECT count(*)::text FROM public.payment_orders'],
  ['market_orders', 'SELECT count(*)::text FROM public.market_purchase_orders'],
  ['market_refunds', 'SELECT count(*)::text FROM public.market_refund_requests'],
  ['market_refunds_pending', "SELECT count(*)::text FROM public.market_refund_requests WHERE status = 'pending'"],
  ['credit_transactions', 'SELECT count(*)::text FROM public.credit_transactions'],
]
function countBlock(tag, label) {
  return `
DO $${tag}$
DECLARE
  v_owner uuid := pg_temp.uid('owner');
  v_staff uuid := pg_temp.uid('staff');
  v_q text[][] := ARRAY[${COUNT_QUERIES.map(([k, q]) => `ARRAY[${sqlString(k)}, ${sqlString(q)}]`).join(', ')}];
  i integer;
  v_r text;
BEGIN
  PERFORM pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['support.manage', 'orders.view', 'members.view', 'credits.view', 'refunds.market']), 'OK', 'G', 'CS 기본 권한');
  FOR i IN 1 .. array_length(v_q, 1) LOOP
    PERFORM pg_temp.ctx_set('${label}_owner_' || v_q[i][1], pg_temp.as_session(v_owner, 'authenticated', v_q[i][2]));
    PERFORM pg_temp.ctx_set('${label}_staff_' || v_q[i][1], pg_temp.as_session(v_staff, 'authenticated', v_q[i][2]));
  END LOOP;
  INSERT INTO _rh_log (test, msg, payload)
  SELECT 'G', '${label} 세션 조회 건수(대표·CS 기본 직원)', jsonb_object_agg(k, v) FROM _rh_ctx WHERE k LIKE '${label}_%';
  PERFORM pg_temp.grants(v_owner, v_staff, ARRAY[]::text[]);
END
$${tag}$;
`
}

// 관리자 역할(거래 안에서만): 경우 G 바탕 건수를 재기 전에 필요하다(full). 적용 직후 블록도 같은 값을 다시 넣는다.
const ROLES = `
UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = pg_temp.uid('owner');
UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = pg_temp.uid('staff');
`

const AFTER_APPLY = (mode) => `
-- ===== 적용 직후: 관리자 역할(거래 안에서만), 다시 적용 거절, 함수 지문(구현 메모용) =====
DO $rh_after_apply$
DECLARE
  v_r text;
BEGIN
  UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = pg_temp.uid('owner');
  UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = pg_temp.uid('staff');
  PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m0')), 'ERR PRECHECK: admin_member_access_log already exists', 'A', 'M0 다시 적용 거절');
  PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m1')), 'ERR PRECHECK:', 'A', 'M1 다시 적용 거절');${mode === 'full' ? `
  PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m2')), 'ERR PRECHECK: guard_support_ticket_answer_write already exists', 'A', 'M2 다시 적용 거절(이미 적용)');
  PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m3')), 'ERR PRECHECK:', 'A', 'M3 다시 적용 거절');` : ''}
  INSERT INTO _rh_log (test, msg, payload)
  SELECT 'A', '적용 뒤 함수 지문(md5(pg_get_functiondef))', jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p
   WHERE (p.pronamespace = 'public'::regnamespace AND p.proname IN (
     'record_admin_member_access', 'guard_admin_member_access_log_mutation', 'save_support_ticket_answer',
     'guard_support_ticket_answer_revisions_mutation', 'guard_support_category_slug', 'guard_support_ticket_answer_write',
     'member_withdrawal_facts', 'redact_member_text', 'mark_member_text_reviewed', 'read_withdrawn_member_ticket', 'anonymize_member'))
      OR p.pronamespace = to_regnamespace('private');
  INSERT INTO _rh_log (test, msg, payload)
  SELECT 'A', '재정의 4개 본문 md5(prosrc)', jsonb_object_agg(s, pg_temp.md5_src(s))
    FROM unnest(ARRAY['public.member_withdrawal_facts(uuid,boolean)', 'public.redact_member_text(uuid,text,uuid,text,text,text)',
                      'public.mark_member_text_reviewed(uuid,text,uuid)', 'public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)']) s;
  PERFORM pg_temp.expect(pg_temp.md5_def('public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)'),
    '1346d870d3623abae580a011b0484339', 'A', 'anonymize_member 지문 그대로');
END
$rh_after_apply$;
`

// ── 경우 E: 열람 기록(모드 공통) ───────────────────────────────────────────────────────────────────────
function caseE() {
  return isolatedCase('rh_e', 'E', `
    v_log := v_log || pg_temp.expect(pg_temp.access(v_owner, 'users.detail', ARRAY[v_e], ARRAY['email', 'phone']), 'OK', 'E', '대표 기록');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_staff, 'support.list', ARRAY[v_e, v_a], ARRAY['email'], '확인 사유'), 'OK', 'E', '직원 기록(사유 있음)');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.admin_member_access_log WHERE created_at >= now()) = 2
      AND (SELECT actor_role FROM public.admin_member_access_log WHERE actor_id = v_owner AND created_at >= now()) = 'owner'
      AND (SELECT actor_role FROM public.admin_member_access_log WHERE actor_id = v_staff AND created_at >= now()) = 'staff'
      AND (SELECT ip = '203.0.113.13' AND user_agent = 'rh13' AND reason = '확인 사유' AND context = '{"ticketId": "rh13"}'::jsonb
             FROM public.admin_member_access_log WHERE actor_id = v_staff AND created_at >= now()),
      'E', '2행·actor_role·IP·기기·사유·context');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_e, 'users.detail', ARRAY[v_a], ARRAY['email']), 'ERR ADMIN_MEMBER_ACCESS_ACTOR_INVALID', 'E', '관리자가 아닌 행위자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_owner, 'users.detail', ARRAY[]::uuid[], ARRAY['email']), 'ERR ADMIN_MEMBER_ACCESS_INPUT_INVALID', 'E', '빈 배열 거절');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_owner, 'users.list', ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 201)), ARRAY['email']),
      'ERR ADMIN_MEMBER_ACCESS_INPUT_INVALID', 'E', '201개 거절');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_owner, 'users.list', ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 200)), ARRAY['email']),
      'OK', 'E', '200개 받음');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_owner, 'users.list', ARRAY[v_e, v_e], ARRAY['email']), 'ERR ADMIN_MEMBER_ACCESS_INPUT_INVALID', 'E', '중복 거절');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_owner, 'Users List', ARRAY[v_e], ARRAY['email']), 'ERR ADMIN_MEMBER_ACCESS_INPUT_INVALID', 'E', '화면 키 형식 거절');
    v_log := v_log || pg_temp.expect(pg_temp.access(v_owner, 'users.list', ARRAY[v_e], ARRAY['email'], repeat('가', 201)), 'ERR ADMIN_MEMBER_ACCESS_INPUT_INVALID', 'E', '사유 201자 거절');
    -- 추가 전용: postgres(소유자)도 트리거가 막고, service_role 은 권한부터 없다
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('UPDATE public.admin_member_access_log SET reason = NULL'), 'ERR ADMIN_MEMBER_ACCESS_LOG_APPEND_ONLY', 'E', 'UPDATE 거부(소유자)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('DELETE FROM public.admin_member_access_log'), 'ERR ADMIN_MEMBER_ACCESS_LOG_APPEND_ONLY', 'E', 'DELETE 거부(소유자)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('TRUNCATE public.admin_member_access_log'), 'ERR ADMIN_MEMBER_ACCESS_LOG_APPEND_ONLY', 'E', 'TRUNCATE 거부(소유자)');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', 'WITH d AS (DELETE FROM public.admin_member_access_log RETURNING 1) SELECT count(*)::text FROM d'),
      'ERR', 'E', 'service_role DELETE 거부');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', 'WITH d AS (UPDATE public.admin_member_access_log SET reason = NULL RETURNING 1) SELECT count(*)::text FROM d'),
      'ERR', 'E', 'service_role UPDATE 거부');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', 'SELECT count(*)::text FROM public.admin_member_access_log'), 'OK', 'E', 'service_role 조회는 됨');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', 'SELECT count(*)::text FROM public.admin_member_access_log'), 'ERR', 'E', '대표 세션도 조회 불가');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', 'SELECT count(*)::text FROM public.admin_member_access_log'), 'ERR', 'E', 'anon 조회 불가');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated',
      format('SELECT public.record_admin_member_access(%L, %L, ARRAY[%L]::uuid[], ARRAY[%L])::text', v_owner, 'users.detail', v_e, 'email')),
      'ERR', 'E', 'authenticated 는 기록 함수를 부를 수 없음');`)
}

// ── 경우 T: 템플릿·문구 행(모드 공통) ───────────────────────────────────────────────────────────────────
function caseT() {
  return isolatedCase('rh_t', 'T', `
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.support_reply_templates) = 14
      AND (SELECT count(*) FROM public.support_reply_templates WHERE category_id IS NOT NULL) = 9
      AND NOT EXISTS (SELECT 1 FROM public.support_reply_templates WHERE body LIKE '%써머썬%' OR body LIKE '%7일%'), 'T', '템플릿 14개·카테고리 9개 연결·사이트 이름·30일');
    v_log := v_log || pg_temp.ensure((SELECT value #>> '{admin,accessLogRetentionYears}' FROM public.system_settings WHERE key = 'support_page_content') = '2'
      AND (SELECT value #>> '{admin,templateBlankMarker}' FROM public.system_settings WHERE key = 'support_page_content') = '○○'
      AND (SELECT (value -> 'revision')::integer FROM public.system_settings WHERE key = 'support_page_content') = 1,
      'T', '문구 행: 보관 2년(10번 스크립트 대조 값)·빈칸 표시·revision 1');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['support.manage']), 'OK', 'T', '직원에게 support.manage');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated', 'SELECT count(*)::text FROM public.support_reply_templates'), 'OK 14', 'T', '문의 권한 직원 세션 14');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', 'SELECT count(*)::text FROM public.support_reply_templates'), 'OK 14', 'T', '대표 세션 14');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated',
      'WITH u AS (UPDATE public.support_reply_templates SET title = title RETURNING 1) SELECT count(*)::text FROM u'), 'ERR', 'T', '직원 세션 UPDATE 불가(권한 없음)');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.view']), 'OK', 'T', 'support.manage 회수');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated', 'SELECT count(*)::text FROM public.support_reply_templates'), 'OK 0', 'T', '문의 권한 없는 직원 0');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_e, 'authenticated', 'SELECT count(*)::text FROM public.support_reply_templates'), 'OK 0', 'T', '회원 0');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', 'SELECT count(*)::text FROM public.support_reply_templates'), 'ERR', 'T', 'anon 권한 없음');`)
}

// ── 경우 C(light): 이력 가드·가림 함수·탈퇴 열람(칸이 없어 저장 함수·facts 는 full 에서) ─────────────────────
function caseCLight() {
  return isolatedCase('rh_c_light', 'C', `
    v_t := pg_temp.new_ticket(v_e, 'account');
    INSERT INTO public.support_ticket_answer_revisions (ticket_id, previous_response, previous_shown_at, edited_by, reason)
    VALUES (v_t, '이전 답변 01012345678', now(), v_owner, '번호 고침 1234567890') RETURNING id INTO v_id;
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.support_ticket_answer_revisions SET reason = %L WHERE id = %L', 'x', v_id)),
      'ERR SUPPORT_ANSWER_REVISIONS_APPEND_ONLY', 'C', '이력 UPDATE 거부(가림 거래 아님)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('DELETE FROM public.support_ticket_answer_revisions WHERE id = %L', v_id)),
      'ERR SUPPORT_ANSWER_REVISIONS_APPEND_ONLY', 'C', '이력 DELETE 거부(부모 있음)');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_text(%L, %L, %L, %L, %L, %L)', v_owner, 'support_ticket_answer_revision', v_id,
      'previous_response', '01012345678', 'rh13-c-1')), 'OK', 'C', '이전 답변 가림');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_text(%L, %L, %L, %L, %L, %L)', v_owner, 'support_ticket_answer_revision', v_id,
      'reason', '1234567890', 'rh13-c-2')), 'OK', 'C', '수정 사유 가림');
    v_log := v_log || pg_temp.ensure((SELECT previous_response NOT LIKE '%01012345678%' AND reason NOT LIKE '%1234567890%' AND redaction_reviewed_at IS NOT NULL
      FROM public.support_ticket_answer_revisions WHERE id = v_id), 'C', '가린 글·확인 시각');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_text(%L, %L, %L, %L, %L, %L)', v_owner, 'support_ticket_answer_revision', v_id,
      'subject', '이전', 'rh13-c-3')), 'ERR MEMBER_WITHDRAW_INPUT_INVALID', 'C', '없는 칸 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.mark_member_text_reviewed(%L, %L, %L)', v_owner, 'support_ticket_answer_revision', v_id)),
      'OK', 'C', '확인 표시');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.mark_member_text_reviewed(%L, %L, %L)', v_staff, 'support_ticket_answer_revision', v_id)),
      'ERR', 'C', '직원 확인 표시 거절(대표만)');
    PERFORM set_config('app.member_withdrawal_bypass', v_e::text, true);
    UPDATE public.profiles SET withdrawn_at = now() WHERE id = v_e;
    PERFORM set_config('app.member_withdrawal_bypass', '', true);
    v_r := pg_temp.try_json(format('SELECT public.read_withdrawn_member_ticket(%L, %L, %L, %L::jsonb)', v_owner, v_t, '시험 열람', ${sqlString(REQUEST_META)}));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'C', '탈퇴 회원 문의 열람');
    v_log := v_log || pg_temp.ensure(jsonb_array_length(pg_temp.res(v_r) -> 'answerRevisions') = 1
      AND pg_temp.res(v_r) #>> '{answerRevisions,0,id}' = v_id::text, 'C', '열람 결과에 answerRevisions 1건');
    v_log := v_log || 'light: 저장 함수·facts·익명화는 칸(response_edited_at)이 있는 b_full 에서 본다'::text;`)
}

// ── 경우 B(full): 답변 저장·수정 ────────────────────────────────────────────────────────────────────────
function caseB() {
  const reply = `{${AUDIT_DETAIL_KEYS.support_ticket_reply.join(',')}}`
  const edit = `{${AUDIT_DETAIL_KEYS.support_ticket_reply_edit.join(',')}}`
  return isolatedCase('rh_b', 'B', `
    v_t := pg_temp.new_ticket(v_e, 'account', '시험 문의 B');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_e, v_t, '답변', NULL), 'ERR SUPPORT_ANSWER_ACTOR_NOT_ALLOWED', 'B', '관리자가 아닌 행위자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.view']), 'OK', 'B', '직원 문의 권한 없음');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_staff, v_t, '답변', NULL), 'ERR SUPPORT_ANSWER_ACTOR_NOT_ALLOWED', 'B', '문의 권한 없는 직원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['support.manage']), 'OK', 'B', '직원 support.manage');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_staff, v_t, '첫 답변입니다', 'x'), 'ERR SUPPORT_ANSWER_CONFLICT', 'B', '본 글이 다르면 충돌');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_staff, v_t, '첫 답변입니다', NULL, NULL, 'rh13-b-first'), 'OK', 'B', '직원 첫 답변');
    v_log := v_log || pg_temp.ensure((SELECT status = 'resolved' AND responded_at IS NOT NULL AND response_edited_at IS NULL FROM public.support_tickets WHERE id = v_t)
      AND pg_temp.audit_count('support_ticket_reply', v_t::text) = 1
      AND pg_temp.audit_ok('support_ticket_reply', ${sqlString(reply)}::text[], ARRAY['첫 답변입니다']), 'B', '상태 resolved·작업 기록 1건(글 없음, request 있음)');
    v_r := pg_temp.save(v_staff, v_t, '첫 답변입니다', NULL, NULL, 'rh13-b-first');
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (pg_temp.res(v_r) -> 'replayed') = 'true'::jsonb AND (pg_temp.res(v_r) -> 'isEdit') = 'false'::jsonb
      AND pg_temp.audit_count('support_ticket_reply', v_t::text) = 1, 'B', '첫 답변 재요청 → replayed, 기록 추가 없음 ' || left(v_r, 80));
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, v_t, '첫 답변입니다', NULL, NULL, 'rh13-b-first'), 'ERR SUPPORT_ANSWER_CONFLICT', 'B', '다른 처리자가 같은 키 → 재요청 아님(충돌)');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_staff, v_t, '고친 답변', '첫 답변입니다'), 'ERR SUPPORT_ANSWER_REASON_REQUIRED', 'B', '사유 없음 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_staff, v_t, '첫 답변입니다', '첫 답변입니다', '사유'), 'ERR SUPPORT_ANSWER_UNCHANGED', 'B', '같은 글 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_staff, v_t, '고친 답변', '옛 글', '사유'), 'ERR SUPPORT_ANSWER_CONFLICT', 'B', '수정 충돌');
    UPDATE public.support_tickets SET redaction_reviewed_at = clock_timestamp() WHERE id = v_t;
    v_r := pg_temp.save(v_staff, v_t, '고친 답변', '첫 답변입니다', '오타 고침 사유', 'rh13-b-edit', 'closed');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'B', '직원 수정');
    v_id := (pg_temp.res(v_r) ->> 'historyId')::uuid;
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.support_ticket_answer_revisions WHERE ticket_id = v_t) = 1
      AND (SELECT previous_response = '첫 답변입니다' AND reason = '오타 고침 사유' AND edited_by = v_staff
             AND previous_shown_at = (SELECT responded_at FROM public.support_tickets WHERE id = v_t)
             FROM public.support_ticket_answer_revisions WHERE id = v_id)
      AND (SELECT admin_response = '고친 답변' AND response_edited_at IS NOT NULL AND redaction_reviewed_at IS NULL AND status = 'resolved'
             FROM public.support_tickets WHERE id = v_t), 'B', '이력 1행(이전 글·보이기 시작한 시각)·수정 시각·가림 확인 비움·상태 그대로');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('support_ticket_reply_edit', v_t::text) = 1
      AND pg_temp.audit_ok('support_ticket_reply_edit', ${sqlString(edit)}::text[], ARRAY['오타 고침 사유', '고친 답변', '첫 답변입니다']),
      'B', '수정 작업 기록 1건(사유·글 원문 없음, request 있음)');
    v_r := pg_temp.save(v_staff, v_t, '고친 답변', '첫 답변입니다', '오타 고침 사유', 'rh13-b-edit');
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (pg_temp.res(v_r) -> 'replayed') = 'true'::jsonb AND (pg_temp.res(v_r) ->> 'historyId')::uuid = v_id
      AND (SELECT count(*) FROM public.support_ticket_answer_revisions WHERE ticket_id = v_t) = 1
      AND pg_temp.audit_count('support_ticket_reply_edit', v_t::text) = 1, 'B', '수정 재요청 → replayed, 이력·기록 추가 없음');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, v_t, '대표가 다시 고침', '고친 답변', '대표 사유'), 'OK', 'B', '대표 수정');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.support_ticket_answer_revisions WHERE ticket_id = v_t) = 2
      AND (SELECT previous_shown_at FROM public.support_ticket_answer_revisions WHERE ticket_id = v_t AND previous_response = '고친 답변')
          > (SELECT r.previous_shown_at FROM public.support_ticket_answer_revisions r WHERE r.id = v_id),
      'B', '두 번째 이력: 이전 글 = 첫 수정 글, 보이기 시작한 시각 = 첫 수정 시각(첫 답변 시각보다 뒤)');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, gen_random_uuid(), '답', NULL), 'ERR SUPPORT_TICKET_NOT_FOUND', 'B', '없는 문의');
    v_t := pg_temp.new_ticket(v_e, 'account', '삭제한 문의');
    UPDATE public.support_tickets SET is_deleted_by_user = true WHERE id = v_t;
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, v_t, '답', NULL), 'ERR SUPPORT_TICKET_DELETED_BY_MEMBER', 'B', '회원이 삭제한 문의 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, v_t, ' ', NULL), 'ERR SUPPORT_ANSWER_INPUT_INVALID', 'B', '빈 답변 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, v_t, '답', NULL, NULL, NULL, 'pending'), 'ERR SUPPORT_ANSWER_INPUT_INVALID', 'B', '상태 pending 거절');`)
}

// ── 경우 C(full): 탈퇴(가림·보존 기간 기준·익명화·연쇄 삭제) ───────────────────────────────────────────────
function caseCFull() {
  return isolatedCase('rh_c_full', 'C', `
    -- 시험 계정 사전 상태(12번 교훈): 멈춘 생성 작업은 이 거래 안에서만 취소됨으로
    UPDATE public.generate_listboard_generation_jobs SET status = 'cancelled' WHERE user_id IN (v_a, v_b) AND status IN ('queued', 'running');
    -- A: 답변에 긴 숫자, 고친 사유에도 긴 숫자 → facts 가 이력 항목을 내놓음 → 가림 → 확인 → 익명화(문의 보존)
    v_t := pg_temp.new_ticket(v_a, 'account', '탈퇴 시험 문의');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, v_t, '확인 번호 01099998888 로 연락드림', NULL, NULL, 'rh13-c-a-first'), 'OK', 'C', 'A 첫 답변(긴 숫자)');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, v_t, '번호를 지운 답변', '확인 번호 01099998888 로 연락드림', '주문번호 2026112612345 삭제'), 'OK', 'C', 'A 답변 수정');
    v_id := (SELECT id FROM public.support_ticket_answer_revisions WHERE ticket_id = v_t);
    v_j := public.member_withdrawal_facts(v_a, true);
    v_log := v_log || pg_temp.ensure(EXISTS (SELECT 1 FROM jsonb_array_elements(v_j -> 'redactionRequired') i
      WHERE i ->> 'kind' = 'support_ticket_answer_revision' AND i ->> 'id' = v_id::text AND i -> 'reasons' ? 'LONG_NUMBER'), 'C', 'facts 가 이력 항목(LONG_NUMBER)을 내놓음');
    v_log := v_log || pg_temp.ensure((v_j ->> 'lastTicketEventAt')::timestamptz = (SELECT response_edited_at FROM public.support_tickets WHERE id = v_t),
      'C', 'lastTicketEventAt = response_edited_at');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_text(%L, %L, %L, %L, %L, %L)', v_owner, 'support_ticket_answer_revision', v_id,
      'previous_response', '01099998888', 'rh13-cf-1')), 'OK', 'C', '이전 답변 가림');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_text(%L, %L, %L, %L, %L, %L)', v_owner, 'support_ticket_answer_revision', v_id,
      'reason', '2026112612345', 'rh13-cf-2')), 'OK', 'C', '수정 사유 가림');
    v_j := public.member_withdrawal_facts(v_a, true);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_j -> 'redactionRequired') i WHERE i ->> 'kind' = 'support_ticket') THEN
      v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.mark_member_text_reviewed(%L, %L, %L)', v_owner, 'support_ticket', v_t)), 'OK', 'C', '문의 확인 표시');
      v_j := public.member_withdrawal_facts(v_a, true);
    END IF;
    v_log := v_log || pg_temp.ensure(jsonb_array_length(v_j -> 'redactionRequired') = 0, 'C', '가림 확인 목록 비움 ' || left((v_j -> 'redactionRequired')::text, 200));
    DECLARE
      v_notice jsonb := public.get_member_withdrawal_notice(v_a, 'request', true);
      v_req jsonb;
    BEGIN
      v_req := public.create_member_withdrawal_request(v_a, 'email', v_notice ->> 'text', v_notice ->> 'sha256',
        (v_notice ->> 'expectedBalance')::integer, (v_notice ->> 'expectedForfeitPaid')::integer, (v_notice ->> 'expectedForfeitFree')::integer,
        '시험 요청', v_owner, true, 'self', NULL, NULL, NULL);
      v_r := pg_temp.try_json(format('SELECT public.anonymize_member(%L, %L, %L, %L, NULL, NULL, false, %L, %L, NULL, true)',
        v_owner, v_a, 'owner', (v_req ->> 'requestId')::uuid, '시험 처리', 'rh13-c-owner-' || v_a));
    END;
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'C', 'A 익명화(owner, 문의 보존)');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.support_ticket_answer_revisions WHERE ticket_id = v_t) = 1
      AND (SELECT last_ticket_event_at FROM public.withdrawn_member_records WHERE user_id = v_a)
          = (SELECT response_edited_at FROM public.support_tickets WHERE id = v_t), 'C', '보존: 이력 남음·last_ticket_event_at = response_edited_at');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, v_t, '탈퇴 뒤 수정', '번호를 지운 답변', '사유'), 'ERR MEMBER_WITHDRAWN', 'C', '탈퇴 뒤 저장 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, v_t, '확인 번호 01099998888 로 연락드림', NULL, NULL, 'rh13-c-a-first'), 'ERR MEMBER_WITHDRAWN', 'C', '탈퇴 뒤 같은 키 재요청도 거절(본문 안 돌려줌)');
    v_r := pg_temp.try_json(format('SELECT public.read_withdrawn_member_ticket(%L, %L, %L, %L::jsonb)', v_owner, v_t, '시험 열람', ${sqlString(REQUEST_META)}));
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND jsonb_array_length(pg_temp.res(v_r) -> 'answerRevisions') = 1, 'C', '열람 결과 answerRevisions 1건');
    -- B: self 경로(문의 보존 안 함) → 문의 삭제와 함께 이력 연쇄 삭제
    v_t := pg_temp.new_ticket(v_b, 'account', '지울 문의');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, v_t, '답변', NULL), 'OK', 'C', 'B 첫 답변');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, v_t, '고친 답변', '답변', '사유'), 'OK', 'C', 'B 수정');
    ALTER TABLE public.system_settings DISABLE TRIGGER lock_withdrawal_texts_during_notice;
    UPDATE public.system_settings SET value = jsonb_set(value, '{selfAnonymizeEnabled}', 'true') WHERE key = 'member_withdrawal_policy';
    ALTER TABLE public.system_settings ENABLE TRIGGER lock_withdrawal_texts_during_notice;
    DECLARE
      v_notice jsonb := public.get_member_withdrawal_notice(v_b, 'self', false);
    BEGIN
      v_r := pg_temp.try_json(format('SELECT public.anonymize_member(%L, %L, %L, NULL, %s, %L, false, NULL, %L, false, false)',
        v_b, v_b, 'self', (v_notice ->> 'expectedBalance')::integer, v_notice ->> 'text', 'rh13-c-self-' || v_b));
    END;
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'C', 'B 익명화(self, 문의 보존 false)');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM public.support_tickets WHERE id = v_t)
      AND NOT EXISTS (SELECT 1 FROM public.support_ticket_answer_revisions WHERE ticket_id = v_t), 'C', '문의 삭제·이력 연쇄 삭제');`)
}

// ── 경우 D(full): 잠금(M2)·slug 지키기 ────────────────────────────────────────────────────────────────
function caseD() {
  return isolatedCase('rh_d', 'D', `
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['support.manage']), 'OK', 'D', '직원 support.manage');
    v_t := pg_temp.new_ticket(v_e, 'account', '잠금 시험');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, v_t, '답변', NULL), 'OK', 'D', '첫 답변');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated',
      format('WITH u AS (UPDATE public.support_tickets SET admin_response = %L WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u', '덮어쓰기', v_t)),
      'ERR permission denied', 'D', '직원 세션 admin_response 직접 UPDATE 거부');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated',
      format('WITH u AS (UPDATE public.support_tickets SET status = %L WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u', 'closed', v_t)),
      'ERR permission denied', 'D', '직원 세션 status 직접 UPDATE 거부');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role',
      format('WITH u AS (UPDATE public.support_tickets SET admin_response = %L WHERE id = %L RETURNING 1) SELECT count(*)::text FROM u', '덮어쓰기', v_t)),
      'ERR SUPPORT_ANSWER_RPC_ONLY', 'D', 'service_role 직접 UPDATE → SUPPORT_ANSWER_RPC_ONLY');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.support_tickets SET status = %L, updated_at = now() WHERE id = %L', 'closed', v_t)),
      'OK', 'D', '상태 닫기(익명화와 같은 칸)는 통과');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_text(%L, %L, %L, %L, %L, %L)', v_owner, 'support_ticket', v_t,
      'admin_response', '답변', 'rh13-d-redact')), 'OK', 'D', '가림 경로(답변 칸)는 통과');
    -- slug: 문의 있는 카테고리·정책 slug·문의 없는 카테고리·이름만 고침·탈퇴 회원 문의만 있는 카테고리
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated',
      $q$WITH u AS (UPDATE public.support_ticket_categories SET slug = 'account_rh' WHERE slug = 'account' RETURNING 1) SELECT count(*)::text FROM u$q$),
      'ERR SUPPORT_CATEGORY_SLUG_LOCKED', 'D', '문의 있는 카테고리 slug 변경 거부');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated',
      $q$WITH u AS (UPDATE public.support_ticket_categories SET slug = 'credit_refund_rh' WHERE slug = 'credit_refund' RETURNING 1) SELECT count(*)::text FROM u$q$),
      'ERR SUPPORT_CATEGORY_SLUG_LOCKED', 'D', '정책 slug(credit_refund) 변경 거부');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated',
      $q$WITH u AS (UPDATE public.support_ticket_categories SET slug = 'suggestion_rh' WHERE slug = 'suggestion' AND NOT EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.category_id = support_ticket_categories.id) RETURNING 1) SELECT count(*)::text FROM u$q$),
      'OK 1', 'D', '문의 없는 카테고리 slug 변경 통과');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated',
      $q$WITH u AS (UPDATE public.support_ticket_categories SET name = name || ' ', slug = slug WHERE slug = 'account' RETURNING 1) SELECT count(*)::text FROM u$q$),
      'OK 1', 'D', '이름만 고침(slug 같은 값으로 보냄) 통과');
    v_t := pg_temp.new_ticket(v_b, 'etc', '탈퇴 회원 문의');
    PERFORM set_config('app.member_withdrawal_bypass', v_b::text, true);
    UPDATE public.profiles SET withdrawn_at = now() WHERE id = v_b;
    PERFORM set_config('app.member_withdrawal_bypass', '', true);
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated',
      $q$WITH u AS (UPDATE public.support_ticket_categories SET slug = 'etc_rh' WHERE slug = 'etc' RETURNING 1) SELECT count(*)::text FROM u$q$),
      'ERR SUPPORT_CATEGORY_SLUG_LOCKED', 'D', '탈퇴 회원 문의만 달린 카테고리 slug 변경 거부(RLS 와 상관없이 셈)');`)
}

// ── 경우 G(full): M3 뒤 조회 ─────────────────────────────────────────────────────────────────────────
function caseG() {
  const compare = COUNT_QUERIES.map(([k]) => `
    v_log := v_log || pg_temp.ensure(pg_temp.ctx('after_owner_${k}') = pg_temp.ctx('base_owner_${k}')
      AND pg_temp.ctx('after_staff_${k}') = pg_temp.ctx('base_staff_${k}'), 'G', '${k}: 대표·CS 기본 직원 세션 조회가 적용 전과 같음 ' || pg_temp.ctx('after_staff_${k}'));`).join('')
  return isolatedCase('rh_g', 'G', `${compare}
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated', 'SELECT count(*)::text FROM public.profiles'), 'OK 1', 'G', '직원 세션 profiles = 자기 행 1');
    v_log := v_log || pg_temp.ensure(pg_temp.as_session(v_owner, 'authenticated', 'SELECT count(*)::text FROM public.profiles')
      = 'OK ' || (SELECT count(*) FROM public.profiles)::text, 'G', '대표 세션 profiles = 전체');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated', 'SELECT count(*)::text FROM public.market_download_events WHERE user_id <> auth.uid()'),
      'OK 0', 'G', '직원 세션 다운로드 기록(남의 것) 0');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['orders.view', 'members.view']), 'OK', 'G', '문의 권한 없는 직원');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated', 'SELECT count(*)::text FROM public.support_tickets'), 'OK 0', 'G', '문의 권한 없는 직원 문의 0(가-2)');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['support.manage', 'refunds.market', 'members.view']), 'OK', 'G', '문의 권한 직원');
    -- 탈퇴 가림: E 에 문의·회원 수정 이력·자료 환불을 만들고 탈퇴 상태로
    v_t := pg_temp.new_ticket(v_e, 'account', '탈퇴 가림 시험');
    INSERT INTO public.support_ticket_revisions (ticket_id, written_at, subject, message) VALUES (v_t, now(), '옛 제목', '옛 내용');
    INSERT INTO public.market_purchase_orders (workspace_subject, user_id, item_id, purchase_type, idempotency_key, original_price_credits, charged_credits, status, created_at)
    SELECT i.workspace_subject, v_e, i.id, 'subproduct', gen_random_uuid(), 100, 100, 'completed', now() FROM public.market_items i ORDER BY i.created_at LIMIT 1
    RETURNING id INTO v_id;
    INSERT INTO public.market_refund_requests (workspace_subject, user_id, item_id, target_kind, order_id, requested_refund_credits, refund_kind, status)
    SELECT o.workspace_subject, v_e, o.item_id, 'v2_order', o.id, 10, 'full', 'pending' FROM public.market_purchase_orders o WHERE o.id = v_id;
    v_log := v_log || pg_temp.ensure(pg_temp.as_session(v_owner, 'authenticated', format('SELECT count(*)::text FROM public.support_tickets WHERE user_id = %L', v_e)) <> 'OK 0'
      AND pg_temp.as_session(v_owner, 'authenticated', format('SELECT count(*)::text FROM public.market_refund_requests WHERE user_id = %L', v_e)) <> 'OK 0',
      'G', '탈퇴 전: 대표 세션에 E 문의·자료 환불 보임');
    PERFORM set_config('app.member_withdrawal_bypass', v_e::text, true);
    UPDATE public.profiles SET withdrawn_at = now() WHERE id = v_e;
    PERFORM set_config('app.member_withdrawal_bypass', '', true);
    FOREACH v_id IN ARRAY ARRAY[v_owner, v_staff] LOOP
      v_log := v_log || pg_temp.expect(pg_temp.as_session(v_id, 'authenticated', format('SELECT count(*)::text FROM public.support_tickets WHERE user_id = %L', v_e)),
        'OK 0', 'G', '탈퇴 뒤 세션 문의 0(' || CASE WHEN v_id = v_owner THEN '대표' ELSE '직원' END || ')');
      v_log := v_log || pg_temp.expect(pg_temp.as_session(v_id, 'authenticated', format('SELECT count(*)::text FROM public.market_refund_requests WHERE user_id = %L', v_e)),
        'OK 0', 'G', '탈퇴 뒤 세션 자료 환불 0(' || CASE WHEN v_id = v_owner THEN '대표' ELSE '직원' END || ')');
    END LOOP;
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated', 'SELECT count(*)::text FROM public.support_ticket_revisions'), 'ERR permission denied', 'G', '수정 이력 세션 권한 없음(42501)');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_staff, 'authenticated', 'SELECT count(*)::text FROM public.refund_requests'), 'ERR permission denied', 'G', '충전 환불 세션 권한 없음(42501)');
    v_log := v_log || pg_temp.ensure(private.is_withdrawn_member(v_e) AND private.is_withdrawn_ticket_member(v_t) AND NOT private.is_withdrawn_member(v_owner),
      'G', '판정 함수 결과');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'anon', format('SELECT private.is_withdrawn_member(%L)::text', v_e)), 'ERR permission denied', 'G', 'anon 판정 함수 거부');
    v_log := v_log || pg_temp.ensure(NOT has_function_privilege('anon', 'private.is_withdrawn_member(uuid)', 'EXECUTE')
      AND NOT has_schema_privilege('anon', 'private', 'USAGE'), 'G', 'anon 스키마·함수 권한 없음(private 는 DB API 노출 스키마가 아님 — Supabase 설정)');`)
}

// ── 경우 F(full): 되돌리기·다시 적용 ──────────────────────────────────────────────────────────────────
function caseF() {
  return isolatedCase('rh_f', 'F', `
    v_t := pg_temp.new_ticket(v_e, 'account', '되돌리기 시험');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m2_down')), 'ERR DOWN PRECHECK: M3 is still applied', 'F', 'M3 전에 M2 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m1_down')), 'ERR DOWN PRECHECK: M2 is still applied', 'F', 'M2 전에 M1 down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m3_down')), 'OK', 'F', 'M3 down');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m2_down')), 'OK', 'F', 'M2 down');
    v_log := v_log || pg_temp.ensure(to_regnamespace('private') IS NULL, 'F', 'private 스키마 지워짐(비었음)');
    -- 이력 행이 있으면 M1 down 멈춤
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, v_t, '답변', NULL), 'OK', 'F', '첫 답변');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, v_t, '고친 답변', '답변', '번호 01012345678 지움'), 'OK', 'F', '수정(이력 1행, 사유에 긴 숫자)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m1_down')), 'ERR DOWN PRECHECK: answer revisions exist', 'F', '이력 있으면 M1 down 멈춤');
    v_log := v_log || pg_temp.ensure(EXISTS (SELECT 1 FROM jsonb_array_elements(public.member_withdrawal_facts(v_e, true) -> 'redactionRequired') i
      WHERE i ->> 'kind' = 'support_ticket_answer_revision'), 'F', 'M3·M2 down 뒤 M1 이 남으면 facts 가 새 가림 종류를 내놓음 → 5-1 코드는 되돌리지 않는다(4-7)');
    DELETE FROM public.support_tickets WHERE id = v_t;
    -- 템플릿을 고쳤으면 내보내기 확인 전 멈춤
    UPDATE public.support_reply_templates SET revision = 2, updated_by = v_owner WHERE sort_order = 10;
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m1_down')), 'ERR DOWN PRECHECK: templates / support_page_content changed', 'F', '템플릿 바뀌면 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.subst_once(pg_temp.ctx('src_m1_down'), ${sqlString(M1_DOWN_EXPORT_LINE[0])}, ${sqlString(M1_DOWN_EXPORT_LINE[1])})),
      'OK', 'F', 'M1 down(내보내기 확인 뒤)');
    v_log := v_log || pg_temp.ensure(pg_temp.md5_def('public.member_withdrawal_facts(uuid,boolean)') = 'a7674770964dac2fe5c9179b8403c3b4'
      AND pg_temp.md5_def('public.redact_member_text(uuid,text,uuid,text,text,text)') = '90778a74269a727608f028b21b43b8f6'
      AND pg_temp.md5_def('public.mark_member_text_reviewed(uuid,text,uuid)') = 'b626dc43a8bb8402575f99a58bb5969b'
      AND pg_temp.md5_def('public.read_withdrawn_member_ticket(uuid,uuid,text,jsonb)') = 'cce39fd0ab514d2c9cdd9e42d225688e',
      'F', '10번 원문 지문으로 돌아감');
    v_log := v_log || pg_temp.ensure(to_regclass('public.admin_member_access_log') IS NOT NULL, 'F', 'M0 표는 남음');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m1')), 'OK', 'F', 'M1 다시 적용');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m2')), 'OK', 'F', 'M2 다시 적용');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_m3')), 'OK', 'F', 'M3 다시 적용');
    v_t := pg_temp.new_ticket(v_e, 'account', '다시 적용 뒤');
    v_log := v_log || pg_temp.expect(pg_temp.save(v_owner, v_t, '답변', NULL), 'OK', 'F', '다시 적용 뒤 답변');`)
}

// 끝에 남은 것: 이 거래가 만든 행은 ROLLBACK 으로 사라진다. 경우는 모두 격리돼 있어 여기서는 새 표 행 수만 본다.
const LEFTOVER = isolatedCase('rh_leftover', 'Z', `
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.admin_member_access_log) = 0
      AND (SELECT count(*) FROM public.support_ticket_answer_revisions) = 0, 'Z', '경우 밖에 남은 열람 기록·답변 이력 0(ROLLBACK 전)');`)

export function buildRehearsalFiles() {
  const files = {}
  files['a_light.sql'] = prelude({
    title: 'A light — M0(원본)·M1 사본(칸 추가·FK·slug 트리거 뺌), 경우 A·E·T·C(이력 가드·가림 함수·탈퇴 열람)',
    when: '지금 돌려도 됨(새 표·함수 생성, 시험 계정 행의 행 잠금뿐 — 기존 표의 LOCK/ALTER TABLE·TRIGGER·POLICY·FK 없음). 저장 함수·잠금·M3·되돌리기는 새벽의 b_full 이 본다.',
    mode: 'light',
  })
    + `\n-- ===== 13번 M0(원본 그대로) =====\n${m0Copy()}\n`
    + `\n-- ===== 13번 M1 사본(light) =====\n${m1Copy('light')}\n`
    + AFTER_APPLY('light')
    + caseE() + caseT() + caseCLight() + LEFTOVER
    + FOOT

  files['b_full.sql'] = prelude({
    title: 'B full — 실제 M0·M1·M2·M3(c_code_deployed 만 true)과 경우 A~G·F(되돌리기·다시 적용)',
    when: '새벽 03~04시만, M0·M1 적용 전 필수. support_tickets·support_ticket_categories 는 M1 부터, profiles 등 6개 표는 M3 부터 ROLLBACK 까지 ACCESS EXCLUSIVE(읽기도 막음). system_settings 는 경우 C 에서 잠깐 트리거를 끄므로 ACCESS EXCLUSIVE. lock_timeout 3초.',
    mode: 'full',
  })
    + BEFORE_APPLY
    + `\n-- ===== 13번 M0(원본 그대로) =====\n${m0Copy()}\n`
    + `\n-- ===== 13번 M1(원본 그대로) =====\n${m1Copy('full')}\n`
    + ROLES
    + countBlock('rh_g_base', 'base')
    + `\n-- ===== 13번 M2(원본 그대로) =====\n${read(SOURCES.m2)}\n`
    + `\n-- ===== 13번 M3(c_code_deployed 만 true) =====\n${m3Copy()}\n`
    + AFTER_APPLY('full')
    + countBlock('rh_g_after', 'after')
    + caseE() + caseT() + caseB() + caseCFull() + caseD() + caseG() + caseF() + LEFTOVER
    + FOOT
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
