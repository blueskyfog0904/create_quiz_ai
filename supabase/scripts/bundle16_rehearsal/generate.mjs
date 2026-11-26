// 16번 묶음 리허설 생성기(계획 docs/plan-bundle16-notification-copy.md 5-7: 실제 파일을 실행하고, 사본은 생성기로 만들어 다른 줄을 계약 시험으로 고정).
// 원본(마이그레이션·down·정리·되살리기 스크립트)과 13·14번 원본을 읽어 리허설 SQL 파일을 만든다.
//   node supabase/scripts/bundle16_rehearsal/generate.mjs          → 이 폴더의 *.sql 을 다시 쓴다
//   node supabase/scripts/bundle16_rehearsal/generate.mjs --check  → 다시 만든 값과 파일이 다르면 실패
// 실행(운영 DB, postgres): supabase db query --remote --yes -o json --file supabase/scripts/bundle16_rehearsal/<파일>
//   모든 파일은 BEGIN … 마지막 SELECT … ROLLBACK 이다(COMMIT 없음). 결과는 ON COMMIT DROP 임시 표 _rh_log 로 받는다.
//   경우마다 표지 예외(RH_ISOLATE)로 격리한다 — 경우 안에서 만든 행·기록은 그 경우가 끝나면 되돌려진다.
//   계정: @test.com 시험 계정만 쓴다(실회원 id 를 쓰지 않음). 대표·직원 역할은 그 시험 계정을 거래 안에서만 관리자로 바꿔 쓴다. 모자라면
//     'RH FAIL [setup]' 으로 멈춘다. 가짜 auth.users 행은 만들지 않는다. 전체 대상(all_members) 보내기는 인원 대조 실패로만 본다
//     (실회원에게 알림 행을 넣지 않음 — ROLLBACK 되더라도). 성공 보내기는 '나에게만 시험'(시험 대표 계정)으로만 본다.
//   13·14번이 운영에 아직 없으면(2026-11-26 지금) 이 거래 안에서 원본 파일로 먼저 적용한다(선행 블록 — 이미 있으면 건너뜀).
//     light 는 13번 M1 의 light 사본(기존 표 DDL 을 뺀 사본, 13번 생성기 m1Copy('light'))을, full 은 M1 원본을 쓴다. 14번은 기존 표 DDL 이 없다.
//     13번 M1 light 사본은 support_tickets.response_edited_at 칸을 만들지 않으므로 light 에서 탈퇴 판정(member_withdrawal_facts)은 부르지 않는다.
//   지금(낮) 돌려도 되는 파일: a_light.sql — 16번 마이그레이션의 light 사본(기존 표 DDL 구역 '[16번 기존 표 DDL]'과 그 VERIFY 두 블록을 뺌):
//     새 표 1개·새 함수·system_settings 행 1개. refund_requests·payment_admin_actions·notifications 칸/CHECK/FK 와 system_settings 정책은 없다.
//     그래서 보내기 성공(알림 INSERT 의 broadcast_id)·회수·충전 환불 거절(member_reject_reason)·down 은 full 에서 본다.
//     light 경우: A(지문·다시 적용 거절)·R2(문구 저장, 세션 직접 UPDATE 제외)·R3(보내기 거절·링크 꼴·상한·재요청 — 알림 INSERT 전에 끝나는 길)·
//     R4(받는 사람)·R5(기록 표 가드)·R6(권한, broadcast_id 칸 제외)·R8(키 정리)·R7 일부(키 되살리기·옛 4인자 다시 만들기).
//     14번 표 site_board_posts 를 가리키는 FK 를 만든다(14번이 이 거래에서 만들어진 표면 새 표, 운영에 있으면 SHARE ROW EXCLUSIVE 몇 밀리초 — 읽기는 막지 않음).
//   새벽에만 돌릴 파일: b_full.sql — 16번 마이그레이션 원본 그대로 + 적용 절차(이력 schema_migrations INSERT) + light 경우 전부 +
//     R2 세션 직접 UPDATE·R3 보내기 성공·R5 회수·가림·R6 broadcast_id·R9 충전 환불 거절(새 서명·옛 서명 겹침 없음·처리 기록)·
//     R7 되돌리기(옛 4인자 없으면 down 멈춤 → 되살리기 → down → 남은 것 → 16 down → 14 down → 14 재적용 → 16 재적용).
//     잠금: refund_requests·payment_admin_actions·notifications 는 마이그레이션부터 ROLLBACK 까지 ACCESS EXCLUSIVE(알림 벨 읽기도 막음),
//     system_settings 도 정책 만들기로 잠긴다. **새벽 짧은 창, DB 적용 직전에만** 돌린다.
//   동시 두 보내기 요청은 BEGIN…ROLLBACK 한 거래로 재현할 수 없다 — 계약 시험이 '잠금 → 재요청 → 상한' 순서를 단언한다.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { m0Copy as bundle13M0Copy, m1Copy as bundle13M1Copy } from '../bundle13_rehearsal/generate.mjs'
import { migrationCopy as bundle14MigrationCopy, downCopy as bundle14DownCopy } from '../bundle14_rehearsal/generate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

export const SOURCES = {
  migration: 'supabase/migrations/20261218100000_bundle16_member_notifications.sql',
  down: 'supabase/rollback/20261218100000_bundle16_member_notifications_down.sql',
  cleanup: 'supabase/scripts/20261218_bundle16_support_notification_keys_cleanup.sql',
  restore: 'supabase/scripts/20261218_bundle16_support_notification_keys_restore.sql',
}
export const MIGRATION_VERSION = '20261218100000'
export const MIGRATION_NAME = 'bundle16_member_notifications'

// light 사본에서 뺄 것: 기존 표 DDL 구역과 그 VERIFY 두 블록(이름으로 찾는다)
export const LIGHT_REMOVALS = [
  /\n-- 6\. \[16번 기존 표 DDL\] 시작[\s\S]*?\n-- \[16번 기존 표 DDL\] 끝[^\n]*\n/,
  /\nDO \$verify_bundle16_existing_tables\$\n[\s\S]*?\n\$verify_bundle16_existing_tables\$;\n/,
  /\nDO \$verify_bundle16_settings_policy\$\n[\s\S]*?\n\$verify_bundle16_settings_policy\$;\n/,
]
// 새로 만드는 표(light 에서 ALTER TABLE·CREATE TRIGGER·REFERENCES 를 걸어도 되는 곳). site_board_posts 는 14번 표(선행 블록 참고).
export const NEW_TABLES = ['public.member_notification_broadcasts', 'public.site_board_posts']
// light 에 남으면 안 되는 글(기존 표를 잠그는 DDL·이력 표 쓰기·COMMIT)
export const LIGHT_FORBIDDEN = [
  'LOCK TABLE', 'CREATE POLICY', 'DROP POLICY', 'ALTER POLICY', 'ADD COLUMN', 'DROP COLUMN', 'ON public.system_settings',
  'ALTER TABLE public.notifications', 'ALTER TABLE public.refund_requests', 'ALTER TABLE public.payment_admin_actions',
  'supabase_migrations', 'COMMIT;',
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
  for (const match of sql.matchAll(/REFERENCES (public\.[a-z0-9_]+)/g)) {
    if (!NEW_TABLES.includes(match[1])) throw new Error(`${label} light copy references an existing table: ${match[1]}`)
  }
}

export function migrationCopy(kind) {
  let sql = read(SOURCES.migration)
  if (kind === 'full') return sql
  if (kind !== 'light') throw new Error(`unknown migration copy ${kind}`)
  for (const re of LIGHT_REMOVALS) {
    if (!re.test(sql)) throw new Error(`migration light copy: ${re} not found`)
    sql = sql.replace(re, '\n')
  }
  assertLight(sql, 'migration')
  return sql
}

// 운영 SQL 편집기용 스크립트(BEGIN…COMMIT)를 거래 안에서 EXECUTE 할 사본: BEGIN·COMMIT 줄을 빼고, 기록자(가장 최근 로그인 대표)를
// 시험 대표 계정으로 바꾼다(실제 대표 id 를 쓰지 않음). 바꾸는 줄은 이 셋뿐이다.
export const SCRIPT_ACTOR_BLOCK = `  SELECT p.id INTO v_actor FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND p.withdrawn_at IS NULL AND u.last_sign_in_at IS NOT NULL
   ORDER BY u.last_sign_in_at DESC LIMIT 1;`
export function scriptCopy(name) {
  let sql = read(SOURCES[name])
  for (const line of ['\nBEGIN;\n', '\nCOMMIT;\n']) {
    if (sql.split(line).length !== 2) throw new Error(`${name} copy: ${line.trim()} not found once`)
    sql = sql.replace(line, '\n')
  }
  if (sql.split(SCRIPT_ACTOR_BLOCK).length !== 2) throw new Error(`${name} copy: actor block not found once`)
  return sql.replace(SCRIPT_ACTOR_BLOCK, "  v_actor := (SELECT v::uuid FROM _rh_ctx WHERE k = 'owner');")
}

// 재정의한 두 함수의 16번 본문 지문(md5(prosrc)) — 마이그레이션 원본 본문에서 계산(사전 점검·VERIFY 상수와 같아야 함)
export function bodyMd5(name) {
  const sql = read(SOURCES.migration)
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  const a = sql.indexOf('$function$', start) + '$function$'.length
  const b = sql.indexOf('$function$', a)
  return createHash('md5').update(sql.slice(a, b)).digest('hex')
}

function dollar(tag, text) {
  if (text.includes(`$${tag}$`)) throw new Error(`source contains $${tag}$`)
  return `$${tag}$${text}$${tag}$`
}

function sqlString(text) {
  return `'${text.replaceAll("'", "''")}'`
}

const sqlArray = (items) => (items.length === 0 ? 'ARRAY[]::text[]' : `ARRAY[${items.map(sqlString).join(', ')}]::text[]`)

// 작업 기록 details 의 키 목록(보내기·회수는 제목·내용 원문과 회원 id 없음 — 계약 시험과 같은 목록, C 정렬)
export const AUDIT_DETAIL_KEYS = {
  member_notification_texts_update: ['changes', 'request', 'revision_after', 'revision_before', 'saved_at', 'statement_after',
    'statement_before', 'statement_version_after', 'statement_version_before'],
  member_broadcast_send: ['broadcast_id', 'content_sha256', 'link_url', 'message_length', 'not_advertising_statement_version', 'post_id',
    'recipient_count', 'request', 'saved_at', 'target', 'title_length'],
  member_broadcast_retract: ['broadcast_id', 'deleted_count', 'read_count', 'reason_code', 'redacted', 'request', 'retracted', 'retracted_at'],
}
const keysLiteral = (action) => sqlArray(AUDIT_DETAIL_KEYS[action])

// 링크 예시(R3): 허용 꼴 밖은 linkUrl 거절. 허용 꼴은 인원 대조(일부러 틀린 인원)에서 멈춰 INSERT 전에 끝난다.
export const LINK_EXAMPLES = {
  rejected: ['/faq#abc', '/faq#00000000-0000-4000-8000-00000000000g', '/notices?from=push', '/notices#top', '/terms/nothing-here',
    '/terms/refund?x=1', '/market', '/credits/charge', '/cart', '/checkout', '/', 'https://example.com', '//example.com', '/notices/'],
  accepted: [null, '/notices', '/faq', '/terms', '/terms/upcoming', '/faq#00000000-0000-4000-8000-000000000001'],
}

const REQUEST_META = '{"ip": "203.0.113.16", "user_agent": "rh16"}'

// ── 공통 머리 ─────────────────────────────────────────────────────────────────────────────────────
function prelude({ title, when, mode }) {
  return `-- 16번 묶음 리허설: ${title}
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle16_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle16_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
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
-- 이 거래에서 남긴 작업 기록(created_at 기본값 now() = 거래 시작 시각, 앞 경우들은 되돌려져 없다)
CREATE FUNCTION pg_temp.audit_count(p_action text) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::integer FROM public.admin_audit_log WHERE action = p_action AND created_at >= now()
$f$;
CREATE FUNCTION pg_temp.audit_last(p_action text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT a.details FROM public.admin_audit_log a WHERE a.action = p_action AND a.created_at >= now()
   ORDER BY (a.details ->> 'saved_at') DESC NULLS LAST, (a.details ->> 'retracted_at') DESC NULLS LAST LIMIT 1
$f$;
-- 그 종류의 기록이 모두: reason NULL, details 키가 정한 목록과 같음, request 가 객체, 넘긴 글이 들어 있지 않음
CREATE FUNCTION pg_temp.audit_ok(p_action text, p_keys text[], p_forbidden text[]) RETURNS boolean LANGUAGE sql AS $f$
  SELECT count(*) > 0 AND bool_and(a.reason IS NULL
     AND ARRAY(SELECT k FROM jsonb_object_keys(a.details) k ORDER BY k COLLATE "C") = p_keys
     AND jsonb_typeof(a.details -> 'request') = 'object'
     AND NOT EXISTS (SELECT 1 FROM unnest(p_forbidden) f WHERE strpos(a.details::text, f) > 0))
    FROM public.admin_audit_log a WHERE a.action = p_action AND a.created_at >= now()
$f$;
CREATE FUNCTION pg_temp.texts() RETURNS jsonb LANGUAGE sql AS $f$ SELECT value FROM public.system_settings WHERE key = 'member_notification_texts' $f$;
CREATE FUNCTION pg_temp.texts_rev() RETURNS integer LANGUAGE sql AS $f$ SELECT (value ->> 'revision')::integer FROM public.system_settings WHERE key = 'member_notification_texts' $f$;
CREATE FUNCTION pg_temp.support() RETURNS jsonb LANGUAGE sql AS $f$ SELECT value FROM public.system_settings WHERE key = 'support_page_content' $f$;
CREATE FUNCTION pg_temp.save_texts(p_actor uuid, p_rev integer, p_value jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.save_member_notification_texts(%L, %L, %L::jsonb, %L::jsonb)', p_actor, p_rev, p_value, ${sqlString(REQUEST_META)}))
$f$;
CREATE FUNCTION pg_temp.send(p_actor uuid, p_key uuid, p_target text, p_title text, p_message text, p_link text, p_post uuid, p_expected integer,
  p_version integer DEFAULT NULL) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.send_member_broadcast(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L::jsonb)', p_actor, p_key, p_target,
    p_title, p_message, p_link, p_post, p_expected,
    coalesce(p_version, (SELECT (value #>> '{broadcast,notAdvertisingStatementVersion}')::integer FROM public.system_settings WHERE key = 'member_notification_texts')),
    ${sqlString(REQUEST_META)}))
$f$;
CREATE FUNCTION pg_temp.preview(p_actor uuid, p_target text) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.member_broadcast_preview(%L, %L)', p_actor, p_target))
$f$;
CREATE FUNCTION pg_temp.retract(p_actor uuid, p_id uuid, p_code text, p_redact boolean) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.retract_member_broadcast(%L, %L, %L, %L, %L::jsonb)', p_actor, p_id, p_code, p_redact, ${sqlString(REQUEST_META)}))
$f$;
-- 보내기 함수와 같은 내용 지문(재요청 대조)
CREATE FUNCTION pg_temp.sha(p_target text, p_title text, p_message text, p_link text, p_post uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT encode(sha256(convert_to(jsonb_build_array(p_target, p_title, p_message, p_link, p_post)::text, 'UTF8')), 'hex')
$f$;
-- 기록 표에 바로 넣기(postgres, 가드는 UPDATE·DELETE 만 막음) — 상한·재요청 경우용
CREATE FUNCTION pg_temp.put_broadcast(p_actor uuid, p_target text, p_key uuid DEFAULT gen_random_uuid(), p_title text DEFAULT '시험',
  p_message text DEFAULT '시험 내용', p_retracted boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_id uuid;
BEGIN
  EXECUTE 'INSERT INTO public.member_notification_broadcasts (operation_key, actor_id, target, title, message, content_sha256, recipient_count,
      not_advertising_statement_version, not_advertising_statement_text, retracted_at, retracted_by, retract_reason_code, retracted_deleted_count,
      retracted_read_count)
    VALUES ($1, $2, $3, $4, $5, $6, 1, 1, $7, $8, $9, $10, $11, $11) RETURNING id'
    INTO v_id
    USING p_key, p_actor, p_target, p_title, p_message, pg_temp.sha(p_target, p_title, p_message, NULL, NULL), '리허설 경계 문장',
          CASE WHEN p_retracted THEN clock_timestamp() END, CASE WHEN p_retracted THEN p_actor END,
          CASE WHEN p_retracted THEN 'mistake' END, CASE WHEN p_retracted THEN 0 END;
  RETURN v_id;
END $f$;
CREATE FUNCTION pg_temp.recipients(p_target text, p_actor uuid) RETURNS uuid[] LANGUAGE plpgsql AS $f$
BEGIN
  RETURN ARRAY(SELECT r FROM public.member_broadcast_recipients(p_target, p_actor) r);
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
SELECT pg_temp.ctx_set('mode', ${sqlString(mode)});
SELECT pg_temp.ctx_set('src_migration', ${dollar('rh_src_migration', migrationCopy(mode))});
SELECT pg_temp.ctx_set('src_cleanup', ${dollar('rh_src_cleanup', scriptCopy('cleanup'))});
SELECT pg_temp.ctx_set('src_restore', ${dollar('rh_src_restore', scriptCopy('restore'))});
SELECT pg_temp.ctx_set('src_b13_m0', ${dollar('rh_src_b13_m0', bundle13M0Copy())});
SELECT pg_temp.ctx_set('src_b13_m1', ${dollar('rh_src_b13_m1', bundle13M1Copy(mode))});
SELECT pg_temp.ctx_set('src_b14', ${dollar('rh_src_b14', bundle14MigrationCopy())});
${mode === 'full' ? `SELECT pg_temp.ctx_set('src_down', ${dollar('rh_src_down', read(SOURCES.down))});
SELECT pg_temp.ctx_set('src_b14_down', ${dollar('rh_src_b14_down', bundle14DownCopy())});
` : ''}
-- ===== 계정: @test.com 시험 계정만(관리자·탈퇴 아님, 가입 완료) 4개 — 대표(owner)·직원(staff)·회원(E)·예비(X).
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

-- ===== 선행: 13번(M0·M1)·14번이 운영에 없으면 이 거래 안에서 원본으로 적용(있으면 건너뜀) =====
DO $rh_prereq$
DECLARE
  v_applied text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.admin_member_access_log') IS NULL THEN
    EXECUTE pg_temp.ctx('src_b13_m0');
    v_applied := v_applied || '13 M0'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'support_page_content') THEN
    EXECUTE pg_temp.ctx('src_b13_m1');
    v_applied := v_applied || ('13 M1 ' || pg_temp.ctx('mode'));
  END IF;
  IF to_regclass('public.site_board_posts') IS NULL THEN
    EXECUTE pg_temp.ctx('src_b14');
    v_applied := v_applied || '14'::text;
  END IF;
  INSERT INTO _rh_log (test, msg, payload) VALUES ('setup', '선행 묶음(이 거래 안에서만 적용한 것)', to_jsonb(v_applied));
  -- 13번 M1 뒤 판 지문(16번 사전 점검 값)
  INSERT INTO _rh_log (test, msg, payload)
  SELECT 'setup', '16번 적용 전 재정의 대상 지문(md5(pg_get_functiondef))', jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p WHERE p.oid IN ('public.member_withdrawal_facts(uuid,boolean)'::regprocedure, 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure,
      'public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure);
END
$rh_prereq$;
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
  v_key uuid;
  v_post uuid;
  v_ids uuid[];
  v_n integer;
  v_text text;
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

// 관리자 역할(거래 안에서만): 대표·직원(권한 없음 — 16번은 대표만)
const ROLES = `
DO $rh_roles$
BEGIN
  UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = pg_temp.uid('owner');
  UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = pg_temp.uid('staff');
END
$rh_roles$;
`

// ── 경우 A(R1): 적용 직후(다시 적용 거절·설정 행·복사·지문) ───────────────────────────────────────────────────────
function caseA() {
  return `
DO $rh_a$
BEGIN
  PERFORM pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: bundle 16 functions already exist', 'A', '다시 적용 거절');
  PERFORM pg_temp.ensure(pg_temp.texts_rev() = 1 AND public.member_notification_texts_problem(pg_temp.texts()) IS NULL, 'A', '설정 행 revision 1·구조 검사 통과');
  PERFORM pg_temp.ensure(pg_temp.texts() #> '{kinds,supportAnswerCreated,title}' = pg_temp.support() #> '{member,answerCreatedNotificationTitle}'
    AND pg_temp.texts() #> '{kinds,supportAnswerCreated,message}' = pg_temp.support() #> '{member,answerCreatedNotificationMessage}'
    AND pg_temp.texts() #> '{kinds,supportAnswerEdited,title}' = pg_temp.support() #> '{member,answerEditedNotificationTitle}'
    AND pg_temp.texts() #> '{kinds,supportAnswerEdited,message}' = pg_temp.support() #> '{member,answerEditedNotificationMessage}'
    AND pg_temp.texts() #> '{kinds,supportAnswerEdited,enabled}' = pg_temp.support() #> '{admin,notifyOnAnswerEdit}', 'A', '답변 두 종류 = support_page_content 복사(5-2 대응표)');
  PERFORM pg_temp.ensure((SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) = ${sqlString(bodyMd5('member_withdrawal_facts'))}
    AND (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) = ${sqlString(bodyMd5('redact_member_text'))}
    AND (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.member_withdrawal_facts(uuid,boolean)'::regprocedure) = '{postgres=X/postgres}'
    AND (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) = '{postgres=X/postgres,service_role=X/postgres}',
    'A', '재정의 두 함수: 16번 본문·권한 그대로');
  PERFORM pg_temp.ensure((SELECT p.pronargdefaults FROM pg_proc p WHERE p.oid = 'public.reject_point_charge_refund(uuid,uuid,text,boolean,text)'::regprocedure) = 0
    AND (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.reject_point_charge_refund(uuid,uuid,text,boolean,text)'::regprocedure) = '{postgres=X/postgres,service_role=X/postgres}'
    AND md5(pg_get_functiondef('public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure)) = '20384719deba112e977fbd3bf8e266e5',
    'A', '새 거절 서명 DEFAULT 없음·service_role 만, 옛 4인자 그대로');
  INSERT INTO _rh_log (test, msg, payload)
  SELECT 'A', '적용 뒤 함수 지문(md5(pg_get_functiondef))', jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('member_broadcast_recipients', 'member_broadcast_preview', 'save_member_notification_texts',
     'send_member_broadcast', 'retract_member_broadcast', 'member_notification_texts_problem', 'guard_member_notification_broadcasts_mutation',
     'reject_point_charge_refund', 'member_withdrawal_facts', 'redact_member_text');
  INSERT INTO _rh_log (test, msg) VALUES ('A', 'VERIFY 통과(마이그레이션 안 블록)·다시 적용 거절·설정 행·복사·재정의 함수');
END
$rh_a$;
`
}

// ── R2: 문구 저장 ─────────────────────────────────────────────────────────────────────────────────
function caseR2(mode) {
  const forbidden = sqlArray(['010-0000-1111'])
  return isolatedCase('rh_r2', 'R2', `
    v_j := pg_temp.texts();
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 1, jsonb_set(v_j, '{kinds,chargeCompleted,title}', '"크레딧 충전 완료(리허설)"')), 'OK {"changed": true', 'R2', '대표 저장');
    v_log := v_log || pg_temp.ensure(pg_temp.texts_rev() = 2 AND pg_temp.texts() #>> '{kinds,chargeCompleted,title}' = '크레딧 충전 완료(리허설)', 'R2', 'revision 2·값 바뀜');
    v_j := pg_temp.audit_last('member_notification_texts_update');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('member_notification_texts_update') = 1
      AND v_j -> 'changes' = '[{"path": "kinds.chargeCompleted.title", "after": "크레딧 충전 완료(리허설)", "before": "크레딧 충전 완료"}]'::jsonb
      AND v_j -> 'statement_before' = 'null'::jsonb, 'R2', '기록: 바뀐 경로 before·after 원문(4절 예외), 경계 문장 안 바뀜');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('member_notification_texts_update', ${keysLiteral('member_notification_texts_update')}, ARRAY[]::text[]), 'R2', '기록 키 목록');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_staff, 2, pg_temp.texts()), 'ERR MEMBER_NOTIFICATION_ACTOR_NOT_OWNER', 'R2', '직원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_e, 2, pg_temp.texts()), 'ERR MEMBER_NOTIFICATION_ACTOR_NOT_OWNER', 'R2', '회원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 1, pg_temp.texts()), 'ERR MEMBER_NOTIFICATION_REVISION_CONFLICT', 'R2', '판 충돌');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, pg_temp.texts()), 'OK {"changed": false', 'R2', '바뀐 것 없음');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('member_notification_texts_update') = 1, 'R2', '바뀐 것 없음 기록 0');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, pg_temp.texts() #- '{kinds,chargeCompleted}'), 'ERR MEMBER_NOTIFICATION_INPUT_INVALID:kinds', 'R2', '종류 삭제 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, jsonb_set(pg_temp.texts(), '{kinds,newKind}', '{"enabled": true, "title": "새", "message": "새"}')),
      'ERR MEMBER_NOTIFICATION_INPUT_INVALID:kinds', 'R2', '종류 추가 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, jsonb_set(pg_temp.texts(), '{kinds,creditRevoked,enabled}', 'false')),
      'ERR MEMBER_NOTIFICATION_INPUT_INVALID:kinds.creditRevoked.enabled', 'R2', '끌 수 없는 종류 끄기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, jsonb_set(pg_temp.texts(), '{kinds,chargeRefundRejected,message}', '"환불 요청이 승인되지 않았습니다."')),
      'ERR MEMBER_NOTIFICATION_INPUT_INVALID:kinds.chargeRefundRejected.message', 'R2', '{사유} 빼기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, jsonb_set(pg_temp.texts(), '{broadcast,allMembersDailyLimit}', '6')),
      'ERR MEMBER_NOTIFICATION_INPUT_INVALID:broadcast.allMembersDailyLimit', 'R2', '상한 범위 밖 거절');
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, jsonb_set(pg_temp.texts(), '{kinds,chargeCompleted,message}', '"문의는 010-0000-1111 로"')),
      'ERR MEMBER_NOTIFICATION_PII_SUSPECTED:mobile', 'R2', '개인정보 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_notification_texts(%L, 2, %L::jsonb, %L::jsonb)', v_owner, pg_temp.texts(), '[]')),
      'ERR MEMBER_NOTIFICATION_INPUT_INVALID:request', 'R2', '요청 정보 객체 아님 거절');
    -- 경계 문장: 바꾸면 함수가 판을 올린다(보낸 판 값은 무시)
    v_text := pg_temp.texts() #>> '{broadcast,notAdvertisingStatement}';
    v_log := v_log || pg_temp.expect(pg_temp.save_texts(v_owner, 2, jsonb_set(jsonb_set(pg_temp.texts(), '{broadcast,notAdvertisingStatement}', '"리허설 경계 문장 2판"'),
      '{broadcast,notAdvertisingStatementVersion}', '99')), 'OK {"changed": true', 'R2', '경계 문장 바꿈');
    v_j := pg_temp.audit_last('member_notification_texts_update');
    v_log := v_log || pg_temp.ensure((pg_temp.texts() #>> '{broadcast,notAdvertisingStatementVersion}')::integer = 2
      AND v_j ->> 'statement_before' = v_text
      AND v_j ->> 'statement_after' = '리허설 경계 문장 2판' AND (v_j ->> 'statement_version_before')::integer = 1 AND (v_j ->> 'statement_version_after')::integer = 2,
      'R2', '경계 판 2(함수가 정함)·기록에 이전·새 판과 문장 원문');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('member_notification_texts_update', ${keysLiteral('member_notification_texts_update')}, ${forbidden}), 'R2', '기록 키 목록(거절된 개인정보 글 없음)');${mode === 'full' ? `
    -- full: 대표 세션(authenticated)의 직접 UPDATE 는 RESTRICTIVE 정책이 막는다(행이 보이지 않아 0행)
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated',
      $q$UPDATE public.system_settings SET value = jsonb_set(value, '{kinds,creditRevoked,enabled}', 'false') WHERE key = 'member_notification_texts' RETURNING key$q$),
      'OK null', 'R2', '대표 세션 직접 UPDATE 0행(쓰기 막기 정책)');
    v_log := v_log || pg_temp.ensure(pg_temp.texts() #> '{kinds,creditRevoked,enabled}' = 'true'::jsonb, 'R2', '끌 수 없는 종류 그대로');` : ''}`)
}

// ── R3: 공지 알림 보내기(light: INSERT 전에 끝나는 길, full: 성공·재요청까지) ──────────────────────────────────
function caseR3(mode) {
  const rejected = LINK_EXAMPLES.rejected.map((link) => `
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', ${sqlString(link)}, NULL, 1), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', ${sqlString(`허용 밖 링크 ${link}`)});`).join('')
  const accepted = LINK_EXAMPLES.accepted.map((link) => `
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '링크 시험', '내용', ${link === null ? 'NULL' : sqlString(link)}, NULL, 99), 'ERR BROADCAST_COUNT_CHANGED:1', 'R3', ${sqlString(`허용 링크 ${link ?? '(없음)'} — 인원 대조까지 감`)});`).join('')
  const success = mode === 'full' ? `
    -- full: 나에게만 시험 성공 → 알림 1행(type announcement·broadcast_id), 기록 행 경계 문장 = 그 판의 문장, 작업 기록에 원문·회원 id 없음
    v_key := gen_random_uuid();
    v_r := pg_temp.send(v_owner, v_key, 'self', '리허설 공지 제목', '리허설 공지 내용', '/notices', NULL, 1);
    v_log := v_log || pg_temp.expect(v_r, 'OK {', 'R3', '나에게만 시험 성공');
    v_id := (pg_temp.res(v_r) ->> 'broadcast_id')::uuid;
    v_log := v_log || pg_temp.ensure((pg_temp.res(v_r) ->> 'replayed') = 'false' AND (pg_temp.res(v_r) ->> 'recipient_count')::integer = 1, 'R3', '인원 1·replayed false');
    EXECUTE 'SELECT count(*) FROM public.notifications WHERE broadcast_id = $1 AND user_id = $2 AND type = ''announcement'' AND title = ''리허설 공지 제목'' AND link = ''/notices''' INTO v_n USING v_id, v_owner;
    v_log := v_log || pg_temp.ensure(v_n = 1, 'R3', '알림 1행(type·broadcast_id·링크)');
    v_log := v_log || pg_temp.ensure((SELECT b.not_advertising_statement_text = pg_temp.texts() #>> '{broadcast,notAdvertisingStatement}'
      AND b.not_advertising_statement_version = (pg_temp.texts() #>> '{broadcast,notAdvertisingStatementVersion}')::integer FROM public.member_notification_broadcasts b WHERE b.id = v_id),
      'R3', '기록 행 경계 문장 = 그 판의 문장 원문');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('member_broadcast_send') = 1
      AND pg_temp.audit_ok('member_broadcast_send', ${keysLiteral('member_broadcast_send')}, ARRAY['리허설 공지 제목', '리허설 공지 내용', v_owner::text]), 'R3', '기록: 키 목록·원문·회원 id 없음');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, v_key, 'self', '리허설 공지 제목', '리허설 공지 내용', '/notices', NULL, 1), 'OK {', 'R3', '같은 거래 순차 재요청');
    EXECUTE 'SELECT count(*) FROM public.notifications WHERE broadcast_id = $1' INTO v_n USING v_id;
    v_log := v_log || pg_temp.ensure(v_n = 1 AND pg_temp.audit_count('member_broadcast_send') = 1, 'R3', '재요청: 알림 추가 0·기록 추가 0');` : ''
  return isolatedCase('rh_r3', 'R3', `
    v_log := v_log || pg_temp.expect(pg_temp.send(v_staff, gen_random_uuid(), 'self', '제목', '내용', NULL, NULL, 1), 'ERR BROADCAST_ACTOR_NOT_OWNER', 'R3', '직원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_e, gen_random_uuid(), 'self', '제목', '내용', NULL, NULL, 1), 'ERR BROADCAST_ACTOR_NOT_OWNER', 'R3', '회원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '제목', '내용', NULL, NULL, 1, 99), 'ERR BROADCAST_CONFIRM_REQUIRED', 'R3', '경계 판 다름 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', repeat('가', 61), '내용', NULL, NULL, 1), 'ERR BROADCAST_INPUT_INVALID:title', 'R3', '제목 61자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', E'제목\\n둘째 줄', '내용', NULL, NULL, 1), 'ERR BROADCAST_INPUT_INVALID:title', 'R3', '제목 줄바꿈 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '제목', repeat('가', 501), NULL, NULL, 1), 'ERR BROADCAST_INPUT_INVALID:message', 'R3', '내용 501자 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'other', '제목', '내용', NULL, NULL, 1), 'ERR BROADCAST_INPUT_INVALID:target', 'R3', '대상 밖 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '문의 rh16@example.com', '내용', NULL, NULL, 1), 'ERR BROADCAST_PII_SUSPECTED:email', 'R3', '개인정보 거절');${rejected}${accepted}
    -- 하단 정보에 켜진 약관 문서 slug 는 받는다
    SELECT d.value ->> 'slug' INTO v_text FROM public.system_settings s, jsonb_each(s.value -> 'policyDocuments') d
     WHERE s.key = 'site_footer_content' AND d.value -> 'enabled' = 'true'::jsonb AND btrim(COALESCE(d.value ->> 'content', '')) <> '' ORDER BY d.key LIMIT 1;
    IF v_text IS NOT NULL THEN
      v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '약관', '내용', '/terms/' || v_text, NULL, 99), 'ERR BROADCAST_COUNT_CHANGED:1', 'R3', '켜진 약관 문서 slug 링크');
    END IF;
    -- 공지 글: 게시 중인 공지면 링크 = /notices/{id}, 다르거나 숨긴 글이면 거절
    v_r := pg_temp.try_json(format('SELECT public.save_site_board_post(%L, NULL, NULL, %L, %L, %L, NULL, NULL, NULL, false, true, %L::jsonb)', v_owner, 'notice', '리허설 공지', '본문', ${sqlString(REQUEST_META)}));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R3', '시험 공지 1건(14번 함수)');
    v_post := (pg_temp.res(v_r) ->> 'id')::uuid;
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '공지', '내용', '/notices/' || v_post, v_post, 99), 'ERR BROADCAST_COUNT_CHANGED:1', 'R3', '게시 중 공지 링크·글 id 일치');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '공지', '내용', '/notices', v_post, 99), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '링크·글 id 불일치 거절');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '공지', '내용', '/notices/' || v_post, NULL, 99), 'ERR BROADCAST_INPUT_INVALID:linkUrl', 'R3', '공지 링크에 글 id 없음 거절');
    v_r := pg_temp.try_json(format('SELECT public.save_site_board_post(%L, %L, 1, %L, %L, %L, NULL, NULL, NULL, false, false, %L::jsonb)', v_owner, v_post, 'notice', '리허설 공지', '본문', ${sqlString(REQUEST_META)}));
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '공지', '내용', '/notices/' || v_post, v_post, 99), 'ERR BROADCAST_INPUT_INVALID:postId', 'R3', '숨긴 공지 거절');
    -- 인원: 전체 대상은 일부러 틀린 인원으로 대조 실패(실회원에게 넣지 않음)
    v_n := cardinality(pg_temp.recipients('all_members', v_owner));
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'all_members', '제목', '내용', NULL, NULL, v_n + 1), 'ERR BROADCAST_COUNT_CHANGED:' || v_n, 'R3', '인원 바뀜 거절(지금 인원 돌려줌)');
    -- 재요청: 같은 operation_key·같은 내용이면 그대로(replayed), 다른 내용이면 거절 — 잠금 뒤 상한보다 먼저
    v_key := gen_random_uuid();
    PERFORM pg_temp.put_broadcast(v_owner, 'self', v_key, '재요청 제목', '재요청 내용');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, v_key, 'self', '재요청 제목', '재요청 내용', NULL, NULL, 1), 'OK {', 'R3', '같은 키 같은 내용 replayed');
    v_log := v_log || pg_temp.ensure(pg_temp.res(pg_temp.send(v_owner, v_key, 'self', '재요청 제목', '재요청 내용', NULL, NULL, 1)) ->> 'replayed' = 'true', 'R3', 'replayed true');
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, v_key, 'self', '재요청 제목', '다른 내용', NULL, NULL, 1), 'ERR BROADCAST_IDEMPOTENCY_CONFLICT', 'R3', '같은 키 다른 내용 거절');
    -- 상한: 전체 24시간 1회(회수한 것도 셈), 시험 10회
    PERFORM pg_temp.put_broadcast(v_owner, 'all_members', gen_random_uuid(), '앞선 전체', '내용', true);
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'all_members', '제목', '내용', NULL, NULL, v_n), 'ERR BROADCAST_RATE_LIMITED:', 'R3', '전체 2번째 거절(회수한 것 포함)');
    v_r := pg_temp.preview(v_owner, 'all_members');
    v_log := v_log || pg_temp.ensure(pg_temp.res(v_r) ->> 'remaining' = '0' AND pg_temp.res(v_r) ->> 'nextAvailableAt' IS NOT NULL
      AND (pg_temp.res(v_r) ->> 'recipientCount')::integer = v_n, 'R3', '미리보기: 남은 0·다음 시각·인원');
    FOR v_n IN 1 .. 9 LOOP
      PERFORM pg_temp.put_broadcast(v_owner, 'self');
    END LOOP;
    v_log := v_log || pg_temp.expect(pg_temp.send(v_owner, gen_random_uuid(), 'self', '제목', '내용', NULL, NULL, 1), 'ERR BROADCAST_RATE_LIMITED:', 'R3', '시험 11번째 거절(재요청 행 포함 10)');
    v_log := v_log || pg_temp.expect(pg_temp.preview(v_staff, 'self'), 'ERR BROADCAST_ACTOR_NOT_OWNER', 'R3', '미리보기 직원 거절');`)
    + (success ? isolatedCase('rh_r3_full', 'R3', success) : '')
}

// ── R4: 받는 사람 ────────────────────────────────────────────────────────────────────────────────
function caseR4() {
  return isolatedCase('rh_r4', 'R4', `
    v_ids := pg_temp.recipients('all_members', v_owner);
    v_log := v_log || pg_temp.ensure(v_e = ANY (v_ids) AND v_x = ANY (v_ids) AND NOT v_owner = ANY (v_ids) AND NOT v_staff = ANY (v_ids), 'R4', '가입 회원 포함·관리자(대표·직원) 빠짐');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM unnest(v_ids) r JOIN public.profiles p ON p.id = r
      WHERE p.withdrawn_at IS NOT NULL OR p.signup_completed IS NOT TRUE OR p.is_admin IS TRUE), 'R4', '탈퇴·가입 미완료·관리자 0');
    UPDATE public.profiles SET signup_completed = false WHERE id = v_e;
    v_log := v_log || pg_temp.ensure(NOT v_e = ANY (pg_temp.recipients('all_members', v_owner)), 'R4', '가입 미완료 빠짐');
    UPDATE public.profiles SET signup_completed = true WHERE id = v_e;
    PERFORM set_config('app.member_withdrawal_bypass', v_x::text, true);
    UPDATE public.profiles SET withdrawn_at = now() WHERE id = v_x;
    PERFORM set_config('app.member_withdrawal_bypass', '', true);
    v_log := v_log || pg_temp.ensure(NOT v_x = ANY (pg_temp.recipients('all_members', v_owner)), 'R4', '탈퇴 빠짐');
    v_log := v_log || pg_temp.ensure(pg_temp.recipients('self', v_owner) = ARRAY[v_owner], 'R4', '나에게만 시험 = 행위자 1명');
    -- 이용 제한·로그인 차단(12번)은 받는 사람 식에 없다(profiles 의 가입·탈퇴·관리자만 본다) — 포함
    v_log := v_log || pg_temp.ensure(strpos(pg_get_functiondef('public.member_broadcast_recipients(text,uuid)'::regprocedure), 'suspension') = 0, 'R4', '정지 여부를 보지 않음(포함)');`)
}

// ── R5: 기록 표 가드(light), 회수·가림(full) ─────────────────────────────────────────────────────────
function caseR5(mode) {
  const full = mode === 'full' ? isolatedCase('rh_r5_full', 'R5', `
    v_key := gen_random_uuid();
    v_r := pg_temp.send(v_owner, v_key, 'self', '회수 시험', '회수 시험 내용', NULL, NULL, 1);
    v_id := (pg_temp.res(v_r) ->> 'broadcast_id')::uuid;
    EXECUTE 'UPDATE public.notifications SET is_read = true WHERE broadcast_id = $1' USING v_id;
    v_log := v_log || pg_temp.expect(pg_temp.retract(v_staff, v_id, 'mistake', false), 'ERR BROADCAST_ACTOR_NOT_OWNER', 'R5', '직원 회수 거절');
    v_log := v_log || pg_temp.expect(pg_temp.retract(v_owner, v_id, 'pii', false), 'ERR BROADCAST_INPUT_INVALID:redact', 'R5', '개인정보 사유는 가림 함께');
    v_r := pg_temp.retract(v_owner, v_id, 'mistake', false);
    v_log := v_log || pg_temp.expect(v_r, 'OK {', 'R5', '회수');
    v_log := v_log || pg_temp.ensure((pg_temp.res(v_r) ->> 'deleted_count')::integer = 1 AND (pg_temp.res(v_r) ->> 'read_count')::integer = 1, 'R5', '지운 수 1·읽은 수 1');
    EXECUTE 'SELECT count(*) FROM public.notifications WHERE broadcast_id = $1' INTO v_n USING v_id;
    v_log := v_log || pg_temp.ensure(v_n = 0, 'R5', '알림 목록에서 지워짐');
    v_log := v_log || pg_temp.ensure(pg_temp.res(pg_temp.retract(v_owner, v_id, 'mistake', false)) ->> 'changed' = 'false', 'R5', '두 번째 회수 그대로');
    v_r := pg_temp.retract(v_owner, v_id, 'pii', true);
    v_log := v_log || pg_temp.ensure(pg_temp.res(v_r) ->> 'redacted' = 'true' AND pg_temp.res(v_r) ->> 'retracted' = 'false', 'R5', '가림만 새로');
    v_log := v_log || pg_temp.ensure((SELECT b.title = pg_temp.texts() #>> '{broadcast,redactedText}' AND b.message = b.title AND b.redacted_by = v_owner
      FROM public.member_notification_broadcasts b WHERE b.id = v_id), 'R5', '가림 뒤 글 = 가림 문구');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('member_broadcast_retract') = 2
      AND pg_temp.audit_ok('member_broadcast_retract', ${keysLiteral('member_broadcast_retract')}, ARRAY['회수 시험', v_owner::text]), 'R5', '회수 기록 2건(원문·회원 id 없음)');`) : ''
  return isolatedCase('rh_r5', 'R5', `
    v_id := pg_temp.put_broadcast(v_owner, 'self');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_notification_broadcasts SET title = %L WHERE id = %L', '바꿈', v_id)), 'ERR MEMBER_BROADCASTS_APPEND_ONLY', 'R5', '제목 UPDATE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_notification_broadcasts SET recipient_count = 2 WHERE id = %L', v_id)), 'ERR MEMBER_BROADCASTS_APPEND_ONLY', 'R5', '인원 UPDATE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('DELETE FROM public.member_notification_broadcasts WHERE id = %L', v_id)), 'ERR MEMBER_BROADCASTS_APPEND_ONLY', 'R5', 'DELETE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql('TRUNCATE public.member_notification_broadcasts'), 'ERR MEMBER_BROADCASTS_APPEND_ONLY', 'R5', 'TRUNCATE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_notification_broadcasts SET title = %L, message = %L, redacted_at = now(), redacted_by = %L WHERE id = %L',
      pg_temp.texts() #>> '{broadcast,redactedText}', pg_temp.texts() #>> '{broadcast,redactedText}', v_owner, v_id)), 'ERR MEMBER_BROADCASTS_APPEND_ONLY', 'R5', '회수 전 가림 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_notification_broadcasts SET retracted_at = now(), retracted_by = %L, retract_reason_code = %L, retracted_deleted_count = 0, retracted_read_count = 0 WHERE id = %L',
      v_owner, 'mistake', v_id)), 'OK', 'R5', '회수 칸 NULL→값 허용');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_notification_broadcasts SET title = %L, message = %L, redacted_at = now(), redacted_by = %L WHERE id = %L',
      '다른 글', '다른 글', v_owner, v_id)), 'ERR MEMBER_BROADCASTS_APPEND_ONLY', 'R5', '가림 문구 아닌 글로 가림 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_notification_broadcasts SET title = %L, message = %L, redacted_at = now(), redacted_by = %L WHERE id = %L',
      pg_temp.texts() #>> '{broadcast,redactedText}', pg_temp.texts() #>> '{broadcast,redactedText}', v_owner, v_id)), 'OK', 'R5', '회수 뒤 가림 허용');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_notification_broadcasts SET retracted_read_count = 5 WHERE id = %L', v_id)), 'ERR MEMBER_BROADCASTS_APPEND_ONLY', 'R5', '회수 칸 값→값 거절');`) + full
}

// ── R6: 권한 ─────────────────────────────────────────────────────────────────────────────────────
function caseR6(mode) {
  const calls = [
    "SELECT count(*)::text FROM public.member_broadcast_recipients('all_members', NULL)",
    "SELECT public.member_broadcast_preview(NULL, 'self')::text",
    "SELECT public.save_member_notification_texts(NULL, 1, '{}'::jsonb, '{}'::jsonb)::text",
    "SELECT public.send_member_broadcast(NULL, NULL, 'self', 't', 'm', NULL, NULL, 1, 1, '{}'::jsonb)::text",
    "SELECT public.retract_member_broadcast(NULL, NULL, 'mistake', false, '{}'::jsonb)::text",
    "SELECT public.reject_point_charge_refund(NULL::uuid, NULL::uuid, NULL::text, NULL::boolean, NULL::text)::text",
    "SELECT public.member_notification_texts_problem('{}'::jsonb)",
  ]
  const denied = calls.map((sql) => ['authenticated', 'anon'].map((role) => `
    v_log := v_log || pg_temp.expect(pg_temp.as_session(${role === 'anon' ? 'NULL' : 'v_owner'}, ${sqlString(role)}, ${sqlString(sql)}), 'ERR permission denied', 'R6', ${sqlString(`${role}: ${sql.slice(7, 60)}`)});`).join('')).join('')
  return isolatedCase('rh_r6', 'R6', `${denied}
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', 'SELECT count(*)::text FROM public.member_notification_broadcasts'), 'ERR permission denied', 'R6', '기록 표 SELECT 거절(대표 세션)');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role',
      format('INSERT INTO public.member_notification_broadcasts (operation_key, actor_id, target, title, message, content_sha256, recipient_count, not_advertising_statement_version, not_advertising_statement_text) VALUES (gen_random_uuid(), %L, %L, %L, %L, %L, 1, 1, %L) RETURNING id::text',
        v_owner, 'self', 't', 'm', repeat('a', 64), 's')), 'ERR permission denied', 'R6', 'service_role 기록 표 INSERT 거절');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(NULL, 'service_role', 'SELECT count(*)::text FROM public.member_notification_broadcasts'), 'OK', 'R6', 'service_role SELECT 됨');${mode === 'full' ? `
    -- full: 본인 알림의 broadcast_id UPDATE 거절, is_read 는 됨
    v_r := pg_temp.send(v_owner, gen_random_uuid(), 'self', '권한 시험', '내용', NULL, NULL, 1);
    v_id := (pg_temp.res(v_r) ->> 'broadcast_id')::uuid;
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', format('UPDATE public.notifications SET broadcast_id = NULL WHERE broadcast_id = %L RETURNING id::text', v_id)),
      'ERR permission denied', 'R6', '본인 알림 broadcast_id UPDATE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.as_session(v_owner, 'authenticated', format('UPDATE public.notifications SET is_read = true WHERE broadcast_id = %L RETURNING id::text', v_id)),
      'OK', 'R6', '본인 알림 is_read UPDATE 됨');` : ''}`)
}

// ── R8: 13번 키 정리(같음 → 지움·기록, 다름 → 멈춤, 이미 없음 → 넘어감) + 옛 4인자 삭제 ─────────────────────────────
// ── R7 일부: 키 되살리기(없음 → 넣음, 있음·같음 → 그대로, 있음·다름 → 알리고 기록) + 옛 4인자 다시 만들기(권한 = service_role 만) ──
const MOVED_KEYS = "ARRAY['answerCreatedNotificationTitle', 'answerCreatedNotificationMessage', 'answerEditedNotificationTitle', 'answerEditedNotificationMessage']"
function caseR8() {
  return isolatedCase('rh_r8', 'R8', `
    v_n := (pg_temp.support() ->> 'revision')::integer;
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_cleanup')), 'OK', 'R8', '정리(같음 → 지움)');
    v_log := v_log || pg_temp.ensure(NOT (pg_temp.support() -> 'member') ?| ${MOVED_KEYS} AND NOT (pg_temp.support() -> 'admin') ? 'notifyOnAnswerEdit'
      AND (pg_temp.support() ->> 'revision')::integer = v_n + 1, 'R8', '5개 키 없음·revision + 1');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('support_page_content_update') = 1
      AND pg_temp.audit_last('support_page_content_update') ->> 'bundle' = 'bundle16_support_keys_cleanup', 'R8', '기록 1건(bundle16_support_keys_cleanup)');
    v_log := v_log || pg_temp.ensure(to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean)') IS NULL
      AND to_regprocedure('public.reject_point_charge_refund(uuid,uuid,text,boolean,text)') IS NOT NULL, 'R8', '옛 4인자 삭제·5인자 남음');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_cleanup')), 'OK', 'R8', '다시 돌림(이미 없음 → 넘어감)');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('support_page_content_update') = 1 AND (pg_temp.support() ->> 'revision')::integer = v_n + 1, 'R8', '두 번째는 기록·판 그대로');
    -- 되살리기(R7 1단계)
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_restore')), 'OK', 'R7', '되살리기(없음 → 넣음, 옛 4인자 다시 만듦)');
    v_log := v_log || pg_temp.ensure(pg_temp.support() #> '{member,answerCreatedNotificationTitle}' = pg_temp.texts() #> '{kinds,supportAnswerCreated,title}'
      AND pg_temp.support() #> '{member,answerEditedNotificationMessage}' = pg_temp.texts() #> '{kinds,supportAnswerEdited,message}'
      AND pg_temp.support() #> '{admin,notifyOnAnswerEdit}' = pg_temp.texts() #> '{kinds,supportAnswerEdited,enabled}'
      AND (pg_temp.support() ->> 'revision')::integer = v_n + 2, 'R7', '5개 키 = member_notification_texts 값·revision + 1');
    v_log := v_log || pg_temp.ensure(md5(pg_get_functiondef('public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure)) = '20384719deba112e977fbd3bf8e266e5'
      AND (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.reject_point_charge_refund(uuid,uuid,text,boolean)'::regprocedure) = '{postgres=X/postgres,service_role=X/postgres}',
      'R7', '다시 만든 옛 4인자: 적용 전 지문·권한 service_role 만');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_restore')), 'OK', 'R7', '되살리기 다시(있음·같음 → 그대로)');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('support_page_content_update') = 2 AND (pg_temp.support() ->> 'revision')::integer = v_n + 2, 'R7', '같으면 기록·판 그대로');`)
    + isolatedCase('rh_r8_differs', 'R8', `
    UPDATE public.system_settings SET value = jsonb_set(value, '{member,answerCreatedNotificationTitle}', '"13번 화면에서 고친 글"') WHERE key = 'support_page_content';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_cleanup')), 'ERR KEYS_CLEANUP: support_page_content {member,answerCreatedNotificationTitle} differs', 'R8', '다름 → 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_restore')), 'OK', 'R7', '되살리기: 있음·다름 → 그대로 두고 기록');
    v_log := v_log || pg_temp.ensure(pg_temp.support() #>> '{member,answerCreatedNotificationTitle}' = '13번 화면에서 고친 글'
      AND pg_temp.audit_last('support_page_content_update') -> 'differs' = '["{member,answerCreatedNotificationTitle}"]'::jsonb, 'R7', '다른 값 그대로·기록에 differs');`)
}

// ── full 전용: R9 충전 환불 거절(새 서명·처리 기록·옛 서명 겹침 없음·가림·익명화 뒤 보존) ──────────────────────────────
// 시험 회원 E 에게 결제 충전 원천(plan_purchase — 탈퇴 판정의 결제 회원 근거)과 환불 요청을 거래 안에서만 만든다(결제 주문 없음 —
// 거절 함수는 주문이 없어도 된다). 결제사 취소 흔적은 origin 'external_cancel'(격리 건)로 만든다(주문을 만들지 않고 같은 거절 불가 분기).
function caseR9() {
  const reject = (id, admin, note, confirmed, reason) => `pg_temp.try_json(format('SELECT public.reject_point_charge_refund(%L, ${admin}, %L, ${confirmed}, %L)', ${id}, ${note}, ${reason}))`
  return `
CREATE FUNCTION pg_temp.r9_request(p_user uuid, p_status text, p_origin text DEFAULT 'user') RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_source uuid;
  v_id uuid;
BEGIN
  INSERT INTO public.credit_sources (user_id, initial_credits, remaining_credits, status, source_category)
  VALUES (p_user, 100, 100, 'pending_refund', 'plan_purchase') RETURNING id INTO v_source;
  EXECUTE 'INSERT INTO public.refund_requests (user_id, source_id, reason, status, provider, origin) VALUES ($1, $2, $3, $4, ''payapp'', $5) RETURNING id'
    INTO v_id USING p_user, v_source, '리허설 환불 사유', p_status, p_origin;
  RETURN v_id;
END $f$;
` + isolatedCase('rh_r9', 'R9', `
    -- 보통 거절(처리 메모 있음)
    v_id := pg_temp.r9_request(v_e, 'pending_review');
    v_post := (SELECT source_id FROM public.refund_requests WHERE id = v_id);
    v_log := v_log || pg_temp.expect(${reject('v_id', 'NULL::uuid', "''", 'false', "'사유'")}, 'ERR REFUND_REJECT_ACTOR_REQUIRED', 'R9', 'p_admin_id NULL 거절');
    v_log := v_log || pg_temp.expect(${reject('v_id', `'||quote_literal(v_owner)||'`, "''", 'false', "'   '")}, 'ERR REFUND_REJECT_MEMBER_REASON_REQUIRED', 'R9', '빈 사유 거절');
    v_log := v_log || pg_temp.expect(${reject('v_id', `'||quote_literal(v_owner)||'`, "''", 'false', "'연락은 rh16@example.com'")}, 'ERR REFUND_REJECT_MEMBER_REASON_PII', 'R9', '개인정보 사유 거절');
    v_log := v_log || pg_temp.expect(${reject('v_id', `'||quote_literal(v_owner)||'`, "''", 'false', "'계좌 123-456-789012 로'")}, 'ERR REFUND_REJECT_MEMBER_REASON_LONG_NUMBER', 'R9', '긴 숫자 사유 거절');
    v_log := v_log || pg_temp.ensure((SELECT status = 'pending_review' AND member_reject_reason IS NULL FROM public.refund_requests WHERE id = v_id)
      AND (SELECT status = 'pending_refund' FROM public.credit_sources WHERE id = v_post), 'R9', '거절 실패 → 전체 취소(크레딧 동결 그대로)');
    v_r := ${reject('v_id', `'||quote_literal(v_owner)||'`, "'내부 처리 메모'", 'false', `E' 이미 사용한 크레딧이 있어\\r\\n환불 요건에 맞지 않습니다. '`)};
    v_log := v_log || pg_temp.expect(v_r, 'OK {', 'R9', '보통 거절 성공');
    v_log := v_log || pg_temp.ensure(pg_temp.res(v_r) ->> 'user_id' = v_e::text
      AND pg_temp.res(v_r) ->> 'member_reject_reason' = E'이미 사용한 크레딧이 있어\\n환불 요건에 맞지 않습니다.', 'R9', 'user_id·저장한(다듬은) 사유 반환');
    v_log := v_log || pg_temp.ensure((SELECT status = 'rejected' AND member_reject_reason = pg_temp.res(v_r) ->> 'member_reject_reason' AND admin_note = '내부 처리 메모'
      FROM public.refund_requests WHERE id = v_id) AND (SELECT status = 'active' FROM public.credit_sources WHERE id = v_post), 'R9', '사유 저장·내부 메모 그대로·동결 해제');
    v_log := v_log || pg_temp.ensure((SELECT count(*) = 1 AND bool_and(action = 'refund_rejected' AND note = 'refund_rejected' AND actor_id = v_owner
      AND details = jsonb_build_object('member_reason_length', char_length(pg_temp.res(v_r) ->> 'member_reject_reason'), 'admin_note_present', true))
      FROM public.payment_admin_actions WHERE refund_request_id = v_id), 'R9', '처리 기록 1행(고정 표지·글자 수만, 회원 사유·메모 글자 없음)');
    v_log := v_log || pg_temp.expect(${reject('v_id', `'||quote_literal(v_owner)||'`, "''", 'false', "'다시'")}, 'ERR REFUND_REQUEST_NOT_REJECTABLE', 'R9', '재요청 거절');
    -- 메모 없는 보통 거절
    v_key := pg_temp.r9_request(v_e, 'pending_review');
    v_log := v_log || pg_temp.expect(${reject('v_key', `'||quote_literal(v_owner)||'`, "''", 'false', "'요건에 맞지 않습니다.'")}, 'OK {', 'R9', '메모 없는 보통 거절 성공');
    v_log := v_log || pg_temp.ensure((SELECT count(*) = 1 AND bool_and(action = 'refund_rejected' AND note = 'refund_rejected'
      AND details = jsonb_build_object('member_reason_length', char_length('요건에 맞지 않습니다.'), 'admin_note_present', false))
      FROM public.payment_admin_actions WHERE refund_request_id = v_key), 'R9', '처리 기록 admin_note_present false');
    -- 수동 확인 건: 확인 false·빈 메모 → 확인 필요, 확인 true + 메모 → 성공(옛 동작 + member_reason_length)
    v_key := pg_temp.r9_request(v_e, 'manual_review');
    v_log := v_log || pg_temp.expect(${reject('v_key', `'||quote_literal(v_owner)||'`, "'결제사 미취소 확인'", 'false', "'사유'")}, 'ERR REFUND_REJECT_CONFIRMATION_REQUIRED', 'R9', '수동 확인: 확인 false 거절');
    v_log := v_log || pg_temp.expect(${reject('v_key', `'||quote_literal(v_owner)||'`, "'  '", 'true', "'사유'")}, 'ERR REFUND_REJECT_CONFIRMATION_REQUIRED', 'R9', '수동 확인: 빈 메모 거절');
    v_log := v_log || pg_temp.ensure((SELECT status = 'manual_review' FROM public.refund_requests WHERE id = v_key)
      AND NOT EXISTS (SELECT 1 FROM public.payment_admin_actions WHERE refund_request_id = v_key), 'R9', '수동 확인 거절 실패 → 그대로');
    v_log := v_log || pg_temp.expect(${reject('v_key', `'||quote_literal(v_owner)||'`, "'결제사 미취소 확인'", 'true', "'결제가 취소되지 않아 환불할 수 없습니다.'")}, 'OK {', 'R9', '수동 확인 거절 성공');
    v_log := v_log || pg_temp.ensure((SELECT count(*) = 1 AND bool_and(action = 'manual_review_refund_rejected' AND note = '결제사 미취소 확인' AND actor_id = v_owner
      AND details = jsonb_build_object('provider_not_cancelled_confirmed', true, 'last_error_code', NULL, 'member_reason_length', char_length('결제가 취소되지 않아 환불할 수 없습니다.')))
      FROM public.payment_admin_actions WHERE refund_request_id = v_key), 'R9', '수동 확인 처리 기록(action·note = 메모·details 기존 키 + 글자 수·actor)');
    -- 결제사 취소 흔적(격리 건)은 거절할 수 없다(돈 흐름 그대로)
    v_key := pg_temp.r9_request(v_e, 'pending_review', 'external_cancel');
    v_log := v_log || pg_temp.expect(${reject('v_key', `'||quote_literal(v_owner)||'`, "''", 'false', "'사유'")}, 'ERR REFUND_REQUEST_NOT_REJECTABLE', 'R9', '결제사 취소 흔적 거절 불가');
    -- 옛 4인자(옛 코드 모양의 이름 붙은 호출)는 겹치지 않고 옛 동작 그대로
    v_key := pg_temp.r9_request(v_e, 'pending_review');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('SELECT public.reject_point_charge_refund(p_request_id => %L, p_admin_id => %L, p_admin_note => %L, p_provider_not_cancelled_confirmed => false)', v_key, v_owner, '')),
      'OK', 'R9', '옛 4인자 이름 호출 성공');
    v_log := v_log || pg_temp.ensure((SELECT status = 'rejected' AND member_reject_reason IS NULL FROM public.refund_requests WHERE id = v_key)
      AND NOT EXISTS (SELECT 1 FROM public.payment_admin_actions WHERE refund_request_id = v_key), 'R9', '옛 동작 그대로(처리 기록 없음)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('SELECT public.reject_point_charge_refund(p_request_id => %L, p_admin_id => %L, p_admin_note => %L, p_provider_not_cancelled_confirmed => false, p_member_reason => %L)', v_key, v_owner, '', '사유')),
      'ERR REFUND_REQUEST_NOT_REJECTABLE', 'R9', '5인자 이름 호출은 새 함수 하나에만 맞음');
    -- 탈퇴 가림: 회원용 사유에만 긴 숫자가 있으면 가림 필요로 나오고, 가리면 빠진다
    UPDATE public.refund_requests SET member_reject_reason = '계좌 1234567890 확인' WHERE id = v_id;
    v_j := public.member_withdrawal_facts(v_e, false);
    v_log := v_log || pg_temp.ensure(EXISTS (SELECT 1 FROM jsonb_array_elements(v_j -> 'redactionRequired') x WHERE x ->> 'kind' = 'refund_request' AND (x ->> 'id')::uuid = v_id),
      'R9', '회원용 사유 긴 숫자 → 가림 필요');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_text(%L, %L, %L, %L, %L, %L)', v_owner, 'refund_request', v_id, 'member_reject_reason', '1234567890', 'rh16-redact-' || v_id)),
      'OK', 'R9', '새 칸 가림');
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.member_withdrawal_facts(v_e, false) -> 'redactionRequired') x
      WHERE x ->> 'kind' = 'refund_request' AND (x ->> 'id')::uuid = v_id), 'R9', '가린 뒤 가림 필요에서 빠짐');
    -- 탈퇴 익명화 뒤에도 칸이 남는다(익명화는 refund_requests 를 지우거나 고치지 않는다)
    v_log := v_log || pg_temp.ensure(strpos(pg_get_functiondef('public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)'::regprocedure), 'member_reject_reason') = 0
      AND pg_get_functiondef('public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)'::regprocedure) !~ '(DELETE FROM|UPDATE) public\\.refund_requests',
      'R9', '익명화 함수는 refund_requests 를 지우거나 고치지 않음');
    -- 실제 익명화(대표 처리 — 결제 회원 탈퇴 요청 → 익명화). 시험 계정의 결제 상태에 따라 판정이 거절할 수 있다: 통과하면 칸 보존을 단언하고,
    -- 거절되면 이유를 기록으로 남긴다(위 구조 단언이 보존을 증빙).
    DECLARE
      v_notice jsonb;
      v_req jsonb;
    BEGIN
      UPDATE public.credit_sources SET status = 'refunded', remaining_credits = 0 WHERE user_id = v_e AND id IN (SELECT source_id FROM public.refund_requests WHERE user_id = v_e AND reason = '리허설 환불 사유');
      UPDATE public.refund_requests SET status = 'rejected' WHERE user_id = v_e AND reason = '리허설 환불 사유' AND status NOT IN ('rejected', 'completed');
      v_notice := public.get_member_withdrawal_notice(v_e, 'request', true);
      v_req := public.create_member_withdrawal_request(v_e, 'email', v_notice ->> 'text', v_notice ->> 'sha256',
        (v_notice ->> 'expectedBalance')::integer, (v_notice ->> 'expectedForfeitPaid')::integer, (v_notice ->> 'expectedForfeitFree')::integer,
        '리허설 요청', v_owner, true, 'self', NULL, NULL, NULL);
      v_r := pg_temp.try_json(format('SELECT public.anonymize_member(%L, %L, %L, %L, NULL, NULL, false, %L, %L, NULL, true)',
        v_owner, v_e, 'owner', (v_req ->> 'requestId')::uuid, '리허설 처리', 'rh16-anon-' || v_e));
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM;
    END;
    IF v_r LIKE 'OK%' THEN
      v_log := v_log || pg_temp.ensure((SELECT member_reject_reason IS NOT NULL AND strpos(member_reject_reason, '1234567890') = 0 FROM public.refund_requests WHERE id = v_id),
        'R9', '익명화 통과·회원에게 보낸 거절 사유 칸 보존(가린 글)');
    ELSE
      v_log := v_log || ('NOTE R9 익명화 미실행: 익명화 판정이 거절함(구조 단언으로 보존 증빙) — ' || left(v_r, 200));
    END IF;`)
}

// ── full 전용: R7 되돌리기·다시 적용(16 down → 14 down → 14 재적용 → 16 재적용) ──────────────────────────────────
function caseR7Full() {
  return isolatedCase('rh_r7', 'R7', `
    -- 옛 4인자가 없으면(정리 스크립트 뒤) down 은 멈춘다
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_cleanup')), 'OK', 'R7', '정리 스크립트(옛 4인자 삭제)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: old 4-arg reject_point_charge_refund missing', 'R7', '옛 4인자 없음 → down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_restore')), 'OK', 'R7', '되살리기');
    -- 기록 표에 공지 글을 가리키는 행 하나(14번 되돌리기 뒤 NOT VALID 경로를 보려고)
    v_r := pg_temp.try_json(format('SELECT public.save_site_board_post(%L, NULL, NULL, %L, %L, %L, NULL, NULL, NULL, false, true, %L::jsonb)', v_owner, 'notice', '되돌리기 공지', '본문', ${sqlString(REQUEST_META)}));
    v_post := (pg_temp.res(v_r) ->> 'id')::uuid;
    v_r := pg_temp.send(v_owner, gen_random_uuid(), 'self', '되돌리기 공지 알림', '내용', '/notices/' || v_post, v_post, 1);
    v_log := v_log || pg_temp.expect(v_r, 'OK {', 'R7', '공지 글 연결 알림 1건');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: unretracted broadcast notifications remain', 'R7', '회수 안 한 공지 알림 → down 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.retract(v_owner, (pg_temp.res(v_r) ->> 'broadcast_id')::uuid, 'mistake', false), 'OK {', 'R7', '회수');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'R7', '16 down');
    v_log := v_log || pg_temp.ensure(to_regclass('public.member_notification_broadcasts') IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_notification_texts')
      AND EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'system_settings_member_notification_texts_no_client_write')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'refund_requests' AND column_name = 'member_reject_reason')
      AND (SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c WHERE c.conname = 'payment_admin_actions_action_check') LIKE '%refund_rejected%'
      AND (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'public.redact_member_text(uuid,text,uuid,text,text,text)'::regprocedure) = ${sqlString(bodyMd5('redact_member_text'))},
      'R7', '남은 것: 기록 표·설정 행·정책·칸·넓힌 CHECK·가림 확장');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.subst_once(pg_temp.ctx('src_b14_down'), '  c_allow_drop_posts constant boolean := false;', '  c_allow_drop_posts constant boolean := true;')),
      'OK', 'R7', '14 down(16 down 뒤 통과)');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_b14')), 'OK', 'R7', '14 재적용');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'R7', '16 재적용(post_id FK NOT VALID·정책 하나·설정 행 대조)');
    v_log := v_log || pg_temp.ensure((SELECT NOT c.convalidated FROM pg_constraint c WHERE c.conname = 'member_notification_broadcasts_post_id_fkey')
      AND (SELECT count(*) FROM pg_policies WHERE policyname = 'system_settings_member_notification_texts_no_client_write') = 1, 'R7', 'FK NOT VALID·정책 하나');
    -- 다시 적용 때 답변 키가 다르면 멈춤
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'R7', '16 down 다시');
    UPDATE public.system_settings SET value = jsonb_set(value, '{member,answerEditedNotificationTitle}', '"다른 글"') WHERE key = 'support_page_content';
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'ERR PRECHECK: support_page_content {member,answerEditedNotificationTitle} differs', 'R7', '답변 키 다르면 재적용 멈춤');`)
}

const BEFORE_APPLY = isolatedCase('rh_before', 'F0', `
    v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = ${sqlString(MIGRATION_VERSION)}), 'F0', '이력 행 없음');`)

const HISTORY_INSERT = `
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (${sqlString(MIGRATION_VERSION)}, ${sqlString(MIGRATION_NAME)});
`

// 끝에 남은 것: 경우는 모두 격리돼 있어 기록 표 행·이 거래의 16번 기록이 0 이어야 한다.
const LEFTOVER = isolatedCase('rh_leftover', 'Z', `
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.member_notification_broadcasts) = 0
      AND (SELECT count(*) FROM public.admin_audit_log WHERE action IN ('member_notification_texts_update', 'member_broadcast_send', 'member_broadcast_retract') AND created_at >= now()) = 0
      AND pg_temp.texts_rev() = 1, 'Z', '경우 밖에 남은 기록 행·16번 기록 0, 설정 행 revision 1(ROLLBACK 전)');`)

export function buildRehearsalFiles() {
  const light = prelude({
    title: 'A light — 16번 마이그레이션 light 사본(기존 표 DDL 구역 뺌), 경우 A·R2~R6·R8·R7 일부',
    when: '지금 돌려도 됨(새 표 1개·새 함수·system_settings 행 1개, 선행 13·14번은 기존 표 DDL 없는 사본 — 기존 표의 칸/CHECK/FK/정책/잠금 없음). 이력 표는 쓰지 않는다.',
    mode: 'light',
  })
    + `\n-- ===== 16번 마이그레이션(light 사본) =====\n${migrationCopy('light')}\n`
    + ROLES + caseA() + caseR2('light') + caseR3('light') + caseR4() + caseR5('light') + caseR6('light') + caseR8() + LEFTOVER + FOOT
  assertLight(light.slice(light.indexOf('-- ===== 16번 마이그레이션(light 사본) =====')), 'a_light.sql')

  const full = prelude({
    title: 'B full — 16번 마이그레이션 원본 + 적용 절차(이력 INSERT) + light 경우 전부 + R2 세션·R3 성공·R5 회수·R6 칸 권한·R9 거절·R7 되돌리기',
    when: '새벽 짧은 창, 적용 승인 뒤 적용 직전(refund_requests·payment_admin_actions·notifications·system_settings 를 ROLLBACK 까지 잠근다, 이력 표에 쓴다 — ROLLBACK 됨)',
    mode: 'full',
  })
    + BEFORE_APPLY
    + `\n-- ===== 16번 마이그레이션(원본 그대로) =====\n${migrationCopy('full')}\n`
    + HISTORY_INSERT
    + ROLES + caseA() + caseR2('full') + caseR3('full') + caseR4() + caseR5('full') + caseR6('full') + caseR8() + caseR9() + caseR7Full() + LEFTOVER + FOOT

  const files = { 'a_light.sql': light, 'b_full.sql': full }
  for (const [name, content] of Object.entries(files)) {
    if (/\bCOMMIT\s*;/.test(content.replace(/--[^\n]*/g, ''))) throw new Error(`${name} contains a COMMIT statement`)
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
