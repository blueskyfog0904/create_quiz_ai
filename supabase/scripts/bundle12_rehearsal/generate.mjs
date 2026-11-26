// 12번 묶음 리허설 생성기(계획 docs/plan-bundle12-member-suspension.md 11-2: 실제 파일을 실행하고, 사본은 생성기로 만들어 다른 줄을 계약 시험으로 고정).
// 원본(마이그레이션·down)을 읽어 리허설 SQL 파일을 만든다.
//   node supabase/scripts/bundle12_rehearsal/generate.mjs          → 이 폴더의 *.sql 을 다시 쓴다
//   node supabase/scripts/bundle12_rehearsal/generate.mjs --check  → 다시 만든 값과 파일이 다르면 실패
// 실행(운영 DB, postgres): supabase db query --remote --yes -o json --file supabase/scripts/bundle12_rehearsal/<파일>
//   모든 파일은 BEGIN … 마지막 SELECT … ROLLBACK 이다(COMMIT 없음). 결과는 ON COMMIT DROP 임시 표 _rh_log 로 받는다.
//   계정: @test.com 시험 계정만 쓴다(실회원 id 를 쓰지 않음). 대표·직원 역할은 그 시험 계정을 거래 안에서만 관리자로 바꿔 쓴다. 모자라면
//     'RH FAIL [setup]' 으로 멈춘다. 가짜 auth.users 행은 만들지 않는다.
//   지금(낮) 돌려도 되는 파일: a_light.sql — 기존 표를 잠그는 DDL 없음. 새 표 2개는 profiles FK 를 뺀 사본이고(FK 는 profiles 에
//     SHARE ROW EXCLUSIVE), profiles 탈퇴 트리거·system_settings RESTRICTIVE 정책·그 VERIFY 블록도 뺀다. S8(실제 익명화)·S12(CASCADE)·
//     S10 의 RESTRICTIVE 확인은 full 에서만 본다. 시험 계정 행·설정 행의 행 잠금은 거래가 끝날 때까지 걸린다(몇 초).
//   새벽에만 돌릴 파일: b_full.sql — 실제 마이그레이션(FK·profiles 트리거·system_settings 정책) + S1~S13 전부.
//     잠금: profiles 는 처음부터 SHARE ROW EXCLUSIVE(쓰기 막음), 마지막 경우 S13 의 되돌리기(DROP TRIGGER·FK 표 DROP)부터 ROLLBACK 까지
//     ACCESS EXCLUSIVE(읽기도 막음). system_settings 는 정책 생성부터 ACCESS EXCLUSIVE. **DB 적용 전에 반드시 돌린다(S8·S12·S10).**
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

export const SOURCES = {
  migration: 'supabase/migrations/20261214100000_member_suspension.sql',
  down: 'supabase/rollback/20261214100000_member_suspension_down.sql',
}

// ── 마이그레이션 light 사본: profiles FK·profiles 트리거·system_settings 정책과 그 VERIFY 블록만 뺀다 ───────────────────────
export const MIGRATION_LIGHT_REPLACEMENTS = [
  // FK 두 곳(같은 글자 — 정확히 2번)
  [' REFERENCES public.profiles(id) ON DELETE CASCADE,', ',', 2],
]
export const MIGRATION_LIGHT_REMOVALS = [
  /\nCREATE TRIGGER member_suspension_withdrawal_cleanup\n[\s\S]*?;\n/,
  /\nCREATE POLICY system_settings_member_suspension_policy_no_client_write\n[\s\S]*?;\n/,
  /\nDO \$verify_member_suspension_profiles_trigger\$\n[\s\S]*?\n\$verify_member_suspension_profiles_trigger\$;\n/,
  /\nDO \$verify_member_suspension_policy\$\n[\s\S]*?\n\$verify_member_suspension_policy\$;\n/,
]
// light 사본에 남으면 안 되는 글(기존 표를 잠그는 DDL)
export const LIGHT_FORBIDDEN = [
  'LOCK TABLE', 'CREATE POLICY', 'DROP POLICY', 'DROP TRIGGER', 'ON public.profiles', 'ON public.system_settings',
  'REFERENCES public.profiles', 'ALTER TABLE public.profiles', 'ALTER TABLE public.system_settings', 'COMMIT',
]

function assertLight(source, label) {
  // 주석(-- …)은 보지 않는다(설명 글에 'CREATE POLICY' 같은 말이 있다)
  const sql = source.replace(/--[^\n]*/g, '')
  for (const word of LIGHT_FORBIDDEN) {
    if (sql.includes(word)) throw new Error(`${label} light copy still has ${word}`)
  }
  // ALTER TABLE 은 새 표 두 개만
  for (const match of sql.matchAll(/ALTER TABLE ([a-z_.]+)/g)) {
    if (!['public.member_suspensions', 'public.member_admin_notes'].includes(match[1])) {
      throw new Error(`${label} light copy alters an existing table: ${match[1]}`)
    }
  }
  for (const match of sql.matchAll(/CREATE TRIGGER [a-z_]+\s+[A-Z ]+? ON ([a-z_.]+)/g)) {
    if (!['public.member_suspensions', 'public.member_admin_notes'].includes(match[1])) {
      throw new Error(`${label} light copy creates a trigger on an existing table: ${match[1]}`)
    }
  }
}

export function migrationCopy(kind) {
  let sql = read(SOURCES.migration)
  if (kind === 'full') return sql
  if (kind !== 'light') throw new Error(`unknown migration copy ${kind}`)
  for (const [from, to, times] of MIGRATION_LIGHT_REPLACEMENTS) {
    if (sql.split(from).length !== times + 1) throw new Error(`migration copy: "${from}" not found ${times} times`)
    sql = sql.split(from).join(to)
  }
  for (const re of MIGRATION_LIGHT_REMOVALS) {
    if (!re.test(sql)) throw new Error(`migration copy: ${re} not found`)
    sql = sql.replace(re, '\n')
  }
  assertLight(sql, 'migration')
  return sql
}

// down light 사본: profiles 트리거·system_settings 정책 DROP 두 줄만 뺀다(light 에는 없다).
export const DOWN_LIGHT_REMOVALS = [
  'DROP TRIGGER member_suspension_withdrawal_cleanup ON public.profiles;\n',
  'DROP POLICY system_settings_member_suspension_policy_no_client_write ON public.system_settings;\n',
]

export function downCopy(kind) {
  let sql = read(SOURCES.down)
  if (kind === 'full') return sql
  for (const line of DOWN_LIGHT_REMOVALS) {
    if (sql.split(line).length !== 2) throw new Error(`down copy: line not found once: ${line}`)
    sql = sql.replace(line, '')
  }
  assertLight(sql, 'down')
  return sql
}

// down 사본의 내보내기 확인 상수(S13): 바꾸는 줄은 이 두 줄뿐
export const DOWN_EXPORT_LINES = [
  ['  c_suspensions_export_confirmed constant boolean := false;', '  c_suspensions_export_confirmed constant boolean := true;'],
  ['  c_notes_export_confirmed constant boolean := false;', '  c_notes_export_confirmed constant boolean := true;'],
]

function dollar(tag, text) {
  if (text.includes(`$${tag}$`)) throw new Error(`source contains $${tag}$`)
  return `$${tag}$${text}$${tag}$`
}

function sqlString(text) {
  return `'${text.replaceAll("'", "''")}'`
}

// 작업 기록 details 의 키 목록(자유 글·지문 없음 — 계약 시험과 같은 목록)
export const AUDIT_DETAIL_KEYS = {
  member_suspend: ['blocks_download', 'ends_at', 'internal_note_length', 'member_reason_length', 'reason_code', 'scope', 'suspension_id'],
  member_suspension_lift: ['blocks_download', 'ends_at', 'lift_reason_length', 'reason_code', 'scope', 'suspension_id'],
  member_suspension_notice_record: ['notice_summary_length', 'notified_at', 'notified_via', 'scope', 'suspension_id'],
  member_note_add: ['body_length', 'note_id'],
  member_note_delete: ['body_length', 'note_id'],
  member_note_redact: ['body_length_before', 'note_id'],
}

// ── 공통 머리 ─────────────────────────────────────────────────────────────────────────────────────
function prelude({ title, when, mode }) {
  return `-- 12번 묶음 리허설: ${title}
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle12_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle12_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
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
-- 정지·메모 함수 호출 도우미(결과 'OK {json}' 또는 'ERR …')
CREATE FUNCTION pg_temp.suspend(p_actor uuid, p_user uuid, p_scope text, p_download boolean, p_code text, p_ends timestamptz,
  p_key text DEFAULT NULL, p_reason text DEFAULT '시험 사유(회원에게 보임)', p_note text DEFAULT '시험 내부 메모') RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.suspend_member(%L, %L, %L, %L, %L, %L, %L, %L, %L)', p_actor, p_user, p_scope, p_download, p_code,
    p_reason, p_note, p_ends, coalesce(p_key, 'rh12-' || gen_random_uuid())))
$f$;
CREATE FUNCTION pg_temp.lift(p_actor uuid, p_id uuid, p_reason text DEFAULT '시험 해제') RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.lift_member_suspension(%L, %L, %L)', p_actor, p_id, p_reason))
$f$;
CREATE FUNCTION pg_temp.notice(p_actor uuid, p_id uuid, p_via text) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.record_member_suspension_notice(%L, %L, %L, %L, %L)', p_actor, p_id, p_via, now(), '시험 알림 요약'))
$f$;
CREATE FUNCTION pg_temp.note_add(p_actor uuid, p_user uuid, p_body text DEFAULT '시험 메모: 확인한 사실') RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.add_member_admin_note(%L, %L, %L)', p_actor, p_user, p_body))
$f$;
CREATE FUNCTION pg_temp.grants(p_owner uuid, p_staff uuid, p_keys text[]) RETURNS text LANGUAGE sql AS $f$
  SELECT pg_temp.try_json(format('SELECT public.replace_admin_permission_grants(%L, %L, %L::jsonb)', p_owner, p_staff,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('permission', k)), '[]'::jsonb) FROM unnest(p_keys) k)))
$f$;
-- 이 거래에서 남긴 작업 기록(created_at 기본값 now() = 거래 시작 시각, 앞 경우들은 되돌려져 없다)
CREATE FUNCTION pg_temp.audit_count(p_action text, p_user uuid DEFAULT NULL) RETURNS integer LANGUAGE sql AS $f$
  SELECT count(*)::integer FROM public.admin_audit_log
   WHERE action = p_action AND created_at >= now() AND (p_user IS NULL OR target_user_id = p_user)
$f$;
-- 그 종류의 기록이 모두: reason NULL, details 키가 정한 목록과 같음(자유 글·지문 키 없음), 넘긴 자유 글이 들어 있지 않음
CREATE FUNCTION pg_temp.audit_ok(p_action text, p_keys text[], p_forbidden text[]) RETURNS boolean LANGUAGE sql AS $f$
  SELECT count(*) > 0 AND bool_and(a.reason IS NULL
     AND ARRAY(SELECT k FROM jsonb_object_keys(a.details) k ORDER BY k COLLATE "C") = p_keys
     AND NOT EXISTS (SELECT 1 FROM unnest(p_forbidden) f WHERE strpos(a.details::text, f) > 0))
    FROM public.admin_audit_log a WHERE a.action = p_action AND a.created_at >= now()
$f$;

-- 원본 사본(생성기가 원본 파일에서 꺼낸 글 그대로, 바꾼 곳은 생성기가 정함)
SELECT pg_temp.ctx_set('src_migration', ${dollar('rh_src_migration', migrationCopy(mode))});
SELECT pg_temp.ctx_set('src_down', ${dollar('rh_src_down', downCopy(mode))});
SELECT pg_temp.ctx_set('mode', ${sqlString(mode)});

-- ===== 계정: @test.com 시험 계정만(관리자·탈퇴 아님, 가입 완료). 결제·결제 시도·자료 구매·탈퇴 요청이 없는 계정 둘(A·B)은 익명화(S8)용,
--       나머지 셋은 대표(C)·직원(D)·대상 회원(E). 모자라면 멈춘다(실회원 id 로 대신하지 않음). =====
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

// ── 적용 전·적용·적용 직후 ──────────────────────────────────────────────────────────────────────────
const BEFORE_APPLY = isolatedCase('rh_s13_before', 'S13', `
    v_r := pg_temp.try_sql(pg_temp.ctx('src_down'));
    v_log := v_log || pg_temp.expect(v_r, 'ERR DOWN PRECHECK: bundle 12 tables missing', 'S13', '적용 전 down 은 머리 확인에서 멈춤');`)

const AFTER_APPLY = `
-- ===== 적용 직후: 관리자 역할(거래 안에서만), 다시 적용 거절, 새 함수 지문(구현 메모용) =====
DO $rh_after_apply$
DECLARE
  v_r text;
BEGIN
  UPDATE public.profiles SET is_admin = true, admin_role = 'owner' WHERE id = pg_temp.uid('owner');
  UPDATE public.profiles SET is_admin = true, admin_role = 'staff' WHERE id = pg_temp.uid('staff');
  v_r := pg_temp.try_sql(pg_temp.ctx('src_migration'));
  PERFORM pg_temp.expect(v_r, 'ERR PRECHECK:', 'S0', '같은 파일을 다시 적용하면 사전 점검에서 멈춤');
  INSERT INTO _rh_log (test, msg, payload)
  SELECT 'S0', '적용 뒤 함수 지문(md5(pg_get_functiondef))', jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)))
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (
     'member_suspension_actor_allowed', 'suspend_member', 'lift_member_suspension', 'record_member_suspension_notice',
     'mark_member_suspension_seen', 'add_member_admin_note', 'delete_member_admin_note', 'redact_member_admin_note',
     'member_active_suspension', 'member_refund_deadlines', 'get_my_member_gate', 'save_member_suspension_policy',
     'guard_member_suspensions_mutation', 'guard_member_admin_notes_mutation', 'member_suspension_withdrawal_cleanup',
     'replace_admin_permission_grants');
  INSERT INTO _rh_log (test, msg, payload) VALUES ('S0', 'replace_admin_permission_grants 본문 md5(prosrc)',
    to_jsonb(pg_temp.md5_src('public.replace_admin_permission_grants(uuid,uuid,jsonb)')));
END
$rh_after_apply$;
`

// ── 경우(모드 공통 / full 만) ─────────────────────────────────────────────────────────────────────
function caseS1() {
  return isolatedCase('rh_s1', 'S1', `
    v_r := pg_temp.suspend(v_owner, v_e, 'restricted', false, 'payment_abuse', now() + interval '7 days', 'rh12-s1-key-0001', '회원에게 알린 사유 S1', '내부 메모 S1');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S1', '대표 이용 제한(7일, 다운로드 열림)');
    v_j := public.member_active_suspension(v_e);
    v_log := v_log || pg_temp.ensure(v_j ->> 'scope' = 'restricted' AND (v_j -> 'blocksDownload') = 'false'::jsonb
      AND v_j ->> 'reasonCode' = 'payment_abuse' AND v_j ->> 'memberReason' = '회원에게 알린 사유 S1', 'S1', '활성 값(member_active_suspension)');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('member_suspend', v_e) = 1
      AND pg_temp.audit_ok('member_suspend', ${sqlString(`{${AUDIT_DETAIL_KEYS.member_suspend.join(',')}}`)}::text[], ARRAY['회원에게 알린 사유 S1', '내부 메모 S1']),
      'S1', '작업 기록 1건(reason NULL, details 키 고정, 자유 글 없음)');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', true, 'payment_abuse', NULL), 'ERR MEMBER_SUSPEND_PERIOD_INVALID', 'S1', '이용 제한 끝나는 날 없음 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', true, 'payment_abuse', now() + interval '31 days'), 'ERR MEMBER_SUSPEND_PERIOD_INVALID', 'S1', '최대 일수(30) 초과 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', true, 'payment_abuse', now() - interval '1 hour'), 'ERR MEMBER_SUSPEND_PERIOD_INVALID', 'S1', '지난 날 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', true, 'no_such_code', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_REASON_UNKNOWN', 'S1', '없는 분류 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', NULL, 'payment_abuse', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_INPUT_INVALID', 'S1', '이용 제한 다운로드 선택 없음 거절');
    v_r := pg_temp.suspend(v_owner, v_a, 'restricted', true, 'material_sharing', now() + interval '30 days');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S1', '최대 일수 그대로(30일)는 받음');
    v_log := v_log || pg_temp.ensure((public.member_active_suspension(v_a) -> 'blocksDownload') = 'true'::jsonb, 'S1', '다운로드 막기 켬 값');
    -- 환불·소멸 기한(기존 판정 함수 값, 읽기만): 결제 회원 E·결제 없는 A 모두 네 키
    FOREACH v_id IN ARRAY ARRAY[v_e, v_a] LOOP
      v_j := public.member_refund_deadlines(v_id);
      v_log := v_log || pg_temp.ensure(ARRAY(SELECT k FROM jsonb_object_keys(v_j) k ORDER BY k COLLATE "C")
        = '{chargeRefundUntil,earliestCreditExpiry,materialRefundUntil,paidBalance}'::text[], 'S1', 'member_refund_deadlines 네 키 ' || left(v_j::text, 160));
    END LOOP;
    v_log := v_log || pg_temp.ensure(public.member_refund_deadlines(gen_random_uuid()) IS NULL, 'S1', '없는 회원 → NULL');
    -- 묶음 주문은 일부 환불·다운로드가 있어도 같은 마감이 후보(부분 환불) — 단품은 같은 조건이면 빠진다
    v_r := pg_temp.try_sql(format($s$INSERT INTO public.market_purchase_orders (workspace_subject, user_id, item_id, purchase_type, idempotency_key,
        original_price_credits, charged_credits, status, refund_committed_credits, created_at)
      SELECT i.workspace_subject, %L, i.id, 'bundle', gen_random_uuid(), 100, 100, 'completed', 10, now() FROM public.market_items i ORDER BY i.created_at LIMIT 1$s$, v_a));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S1', '거래 안 묶음 주문(일부 환불 확정) 넣기');
    v_log := v_log || pg_temp.ensure((public.member_refund_deadlines(v_a) ->> 'materialRefundUntil')::timestamptz
      = public.market_refund_deadline(now(), public.market_purchase_refund_days()), 'S1', '묶음: 일부 환불돼도 자료 환불 기한 후보(보수적)');
    UPDATE public.market_purchase_orders SET purchase_type = 'subproduct' WHERE user_id = v_a AND created_at = now() AND purchase_type = 'bundle';
    v_log := v_log || pg_temp.ensure((public.member_refund_deadlines(v_a) ->> 'materialRefundUntil') IS NULL, 'S1', '단품: 일부 환불 확정이면 후보 아님');`)
}

function caseS2() {
  return isolatedCase('rh_s2', 'S2', `
    v_r := pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '3 days', 'rh12-s2-key-0001');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S2', '첫 정지');
    v_id := (pg_temp.res(v_r) ->> 'suspensionId')::uuid;
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '3 days'), 'ERR MEMBER_SUSPEND_ALREADY_ACTIVE', 'S2', '다른 키로 중복 정지 거절');
    v_r := pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '3 days', 'rh12-s2-key-0001');
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (pg_temp.res(v_r) ->> 'suspensionId')::uuid = v_id AND (pg_temp.res(v_r) -> 'replay') = 'true'::jsonb,
      'S2', '같은 operation_key → 첫 행 그대로(오류 아님) ' || left(v_r, 100));
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.member_suspensions WHERE user_id = v_e) = 1
      AND pg_temp.audit_count('member_suspend', v_e) = 1, 'S2', '행·작업 기록 1건 그대로');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', false, 'other', now() + interval '3 days', 'rh12-s2-key-0001'),
      'ERR MEMBER_SUSPEND_INPUT_INVALID', 'S2', '같은 키 다른 회원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_e, 'login_blocked', true, 'other', NULL, 'rh12-s2-key-0001'),
      'ERR MEMBER_SUSPEND_INPUT_INVALID', 'S2', '같은 키 다른 범위 거절');`)
}

function caseS3() {
  return isolatedCase('rh_s3', 'S3', `
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_staff, 'restricted', false, 'other', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_TARGET_INVALID', 'S3', '관리자 대상 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_owner, 'restricted', false, 'other', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_TARGET_INVALID', 'S3', '본인 거절');
    UPDATE public.profiles SET signup_completed = false WHERE id = v_e;
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_TARGET_INVALID', 'S3', '가입 미완료 거절');
    UPDATE public.profiles SET signup_completed = true WHERE id = v_e;
    -- 탈퇴 회원(정지·메모 행이 없어 탈퇴 트리거가 지울 것도 없다)
    UPDATE public.profiles SET withdrawn_at = now() WHERE id = v_b;
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_b, 'restricted', false, 'other', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_TARGET_INVALID', 'S3', '탈퇴 회원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.note_add(v_owner, v_b), 'ERR MEMBER_NOTE_TARGET_INVALID', 'S3', '탈퇴 회원 메모 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_e, v_a, 'restricted', false, 'other', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_ACTOR_NOT_ALLOWED', 'S3', '관리자가 아닌 행위자 거절');`)
}

function caseS4() {
  return isolatedCase('rh_s4', 'S4', `
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.view', 'members.suspend']), 'OK', 'S4', '대표가 직원에게 members.view+members.suspend 저장(권한 함수가 새 키 받음)');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.view', 'members.bogus']), 'ERR ADMIN_PERMISSION_UNKNOWN', 'S4', '모르는 키는 그대로 거절');
    v_r := pg_temp.suspend(v_staff, v_e, 'restricted', true, 'scraping', now() + interval '5 days');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S4', '직원 이용 제한 성공');
    v_id := (pg_temp.res(v_r) ->> 'suspensionId')::uuid;
    v_log := v_log || pg_temp.expect(pg_temp.notice(v_staff, v_id, 'screen'), 'OK', 'S4', '직원 알림 기록(이용 제한)');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('member_suspension_notice_record', ${sqlString(`{${AUDIT_DETAIL_KEYS.member_suspension_notice_record.join(',')}}`)}::text[], ARRAY['시험 알림 요약']),
      'S4', '알림 작업 기록(요약 글 없음, 글자 수만)');
    v_log := v_log || pg_temp.expect(pg_temp.lift(v_staff, v_id), 'OK', 'S4', '직원 이용 제한 해제');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('member_suspension_lift', ${sqlString(`{${AUDIT_DETAIL_KEYS.member_suspension_lift.join(',')}}`)}::text[], ARRAY['시험 해제']),
      'S4', '해제 작업 기록(해제 사유 글 없음)');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_staff, v_a, 'login_blocked', true, 'account_misuse', NULL), 'ERR MEMBER_SUSPEND_ACTOR_NOT_ALLOWED', 'S4', '직원 로그인 차단 거절');
    v_r := pg_temp.suspend(v_owner, v_a, 'login_blocked', true, 'account_misuse', NULL);
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S4', '대표 로그인 차단');
    v_id := (pg_temp.res(v_r) ->> 'suspensionId')::uuid;
    v_log := v_log || pg_temp.expect(pg_temp.notice(v_staff, v_id, 'email'), 'ERR MEMBER_SUSPEND_ACTOR_NOT_ALLOWED', 'S4', '직원 로그인 차단 알림 기록 거절');
    v_log := v_log || pg_temp.expect(pg_temp.lift(v_staff, v_id), 'ERR MEMBER_SUSPEND_ACTOR_NOT_ALLOWED', 'S4', '직원 로그인 차단 해제 거절');
    -- members.view 없는 직원(권한 함수는 의존을 검사하지 않음 — DB 판정이 막는다)
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.suspend']), 'OK', 'S4', 'members.suspend 만 저장');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_staff, v_b, 'restricted', false, 'other', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_ACTOR_NOT_ALLOWED', 'S4', 'members.view 없는 직원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.view']), 'OK', 'S4', 'members.view 만 저장');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_staff, v_b, 'restricted', false, 'other', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_ACTOR_NOT_ALLOWED', 'S4', 'members.suspend 없는 직원 거절');`)
}

function caseS5() {
  return isolatedCase('rh_s5', 'S5', `
    -- 지울 행을 거래 안에서 먼저 만든다(시험 계정에는 원래 없을 수 있어 '0행'이 늘 참이 되지 않게). flow_state 는 만들기 어려워 0행만 본다.
    v_id := gen_random_uuid();
    INSERT INTO auth.sessions (id, user_id, created_at, updated_at) VALUES (v_id, v_e, now(), now());
    INSERT INTO auth.refresh_tokens (token, user_id, revoked, created_at, updated_at, session_id) VALUES ('rh12-' || v_id, v_e::text, false, now(), now(), v_id);
    DELETE FROM auth.one_time_tokens WHERE user_id = v_e AND token_type = 'recovery_token';
    INSERT INTO auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to, created_at, updated_at)
    VALUES (gen_random_uuid(), v_e, 'recovery_token', 'rh12-' || v_id, 'rh12@test.com', now(), now());
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM auth.sessions WHERE user_id = v_e) > 0
      AND (SELECT count(*) FROM auth.refresh_tokens WHERE user_id = v_e::text) > 0
      AND (SELECT count(*) FROM auth.one_time_tokens WHERE user_id = v_e) > 0, 'S5', '정지 전 세션·토큰·일회용 토큰 행 있음');
    v_r := pg_temp.suspend(v_owner, v_e, 'login_blocked', true, 'account_misuse', NULL);
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S5', '대표 로그인 차단(끝나는 날 없음)');
    v_id := (pg_temp.res(v_r) ->> 'suspensionId')::uuid;
    v_log := v_log || pg_temp.ensure((SELECT banned_until FROM auth.users WHERE id = v_e) >= now() + interval '99 years', 'S5', 'banned_until 100년');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM auth.sessions WHERE user_id = v_e) = 0
      AND (SELECT count(*) FROM auth.refresh_tokens WHERE user_id = v_e::text) = 0
      AND (SELECT count(*) FROM auth.flow_state WHERE user_id = v_e) = 0
      AND (SELECT count(*) FROM auth.one_time_tokens WHERE user_id = v_e) = 0, 'S5', 'sessions·refresh_tokens·flow_state·one_time_tokens 0행');
    v_log := v_log || pg_temp.ensure((SELECT blocks_download FROM public.member_suspensions WHERE id = v_id), 'S5', '로그인 차단은 다운로드도 막음(true)');
    v_log := v_log || pg_temp.expect(pg_temp.notice(v_owner, v_id, 'email'), 'OK', 'S5', '대표 알림 기록(이메일)');
    v_log := v_log || pg_temp.expect(pg_temp.notice(v_owner, v_id, 'phone'), 'ERR MEMBER_SUSPENSION_NOTICE_ALREADY_RECORDED', 'S5', '두 번째 알림 기록 거절');
    v_log := v_log || pg_temp.expect(pg_temp.lift(v_owner, v_id), 'OK', 'S5', '대표 해제');
    v_log := v_log || pg_temp.ensure((SELECT banned_until FROM auth.users WHERE id = v_e) IS NULL, 'S5', '해제 → banned_until NULL');
    v_log := v_log || pg_temp.expect(pg_temp.lift(v_owner, v_id), 'ERR MEMBER_SUSPENSION_NOT_ACTIVE', 'S5', '다시 해제 거절');
    -- 끝나는 날 있는 로그인 차단: banned_until = 그 날
    v_r := pg_temp.suspend(v_owner, v_e, 'login_blocked', false, 'scraping', now() + interval '10 days');
    v_log := v_log || pg_temp.ensure(v_r LIKE 'OK%' AND (SELECT banned_until FROM auth.users WHERE id = v_e) = now() + interval '10 days'
      AND (SELECT blocks_download FROM public.member_suspensions WHERE id = (pg_temp.res(v_r) ->> 'suspensionId')::uuid),
      'S5', '끝나는 날 있는 로그인 차단 → banned_until = 그 날, 다운로드 막음 강제');`)
}

function caseS6() {
  return isolatedCase('rh_s6', 'S6', `
    -- 지난 정지 행(거래 안의 now() 는 고정이라 지난 행은 쓰기 설정으로 직접 넣는다)
    PERFORM set_config('app.member_suspension_write', v_e::text, true);
    INSERT INTO public.member_suspensions (user_id, scope, blocks_download, reason_code, reason_label, member_reason, starts_at, ends_at, created_by, operation_key)
    VALUES (v_e, 'restricted', true, 'other', '그 밖의 약관·법령 위반', '지난 정지', now() - interval '10 days', now() - interval '1 day', v_owner, 'rh12-s6-old-0001')
    RETURNING id INTO v_id;
    PERFORM set_config('app.member_suspension_write', '', true);
    v_log := v_log || pg_temp.ensure(public.member_active_suspension(v_e) IS NULL, 'S6', '기간이 지나면 비활성');
    v_log := v_log || pg_temp.expect(pg_temp.lift(v_owner, v_id), 'ERR MEMBER_SUSPENSION_NOT_ACTIVE', 'S6', '지난 행 해제 거절');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '2 days'), 'OK', 'S6', '새 정지 받음');
    v_log := v_log || pg_temp.ensure((SELECT lifted_at = ends_at AND lift_reason = 'expired' AND lifted_by IS NULL FROM public.member_suspensions WHERE id = v_id),
      'S6', '지난 행을 expired 로 닫음(lifted_at = ends_at)');`)
}

function caseS7() {
  return isolatedCase('rh_s7', 'S7', `
    v_log := v_log || pg_temp.expect(pg_temp.note_add(v_staff, v_e), 'ERR MEMBER_NOTE_ACTOR_NOT_ALLOWED', 'S7', 'members.memo 없는 직원 거절');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.view', 'members.memo']), 'OK', 'S7', '직원에게 members.view+members.memo');
    v_r := pg_temp.note_add(v_staff, v_e, '직원 메모 본문 S7');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S7', '직원 메모 추가');
    v_id := (pg_temp.res(v_r) ->> 'noteId')::uuid;
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('member_note_add', ${sqlString(`{${AUDIT_DETAIL_KEYS.member_note_add.join(',')}}`)}::text[], ARRAY['직원 메모 본문 S7']), 'S7', '메모 작업 기록(본문 없음)');
    v_r := pg_temp.note_add(v_owner, v_e, '대표 메모 본문 S7');
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S7', '대표 메모 추가');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.delete_member_admin_note(%L, %L)', v_staff, (pg_temp.res(v_r) ->> 'noteId')::uuid)),
      'ERR MEMBER_NOTE_ACTOR_NOT_ALLOWED', 'S7', '직원이 대표 메모 지우기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.delete_member_admin_note(%L, %L)', v_staff, v_id)), 'OK', 'S7', '작성자 지우기');
    v_log := v_log || pg_temp.ensure((SELECT deleted_at IS NOT NULL AND body = '직원 메모 본문 S7' FROM public.member_admin_notes WHERE id = v_id), 'S7', '지운 메모가 남음(deleted_at 만)');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.delete_member_admin_note(%L, %L)', v_staff, v_id)), 'ERR MEMBER_NOTE_ALREADY_DELETED', 'S7', '다시 지우기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.note_add(v_owner, v_staff), 'ERR MEMBER_NOTE_TARGET_INVALID', 'S7', '관리자 대상 거절');
    -- 가림(대표만, 지운 메모도)
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_admin_note(%L, %L)', v_staff, v_id)), 'ERR MEMBER_NOTE_ACTOR_NOT_ALLOWED', 'S7', '직원 가림 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_admin_note(%L, %L)', v_owner, v_id)), 'OK', 'S7', '대표 가림(지운 메모)');
    v_log := v_log || pg_temp.ensure((SELECT n.body = COALESCE(NULLIF(btrim(s.value #>> '{texts,redactionMask}'), ''), '[가림 처리됨]') AND n.redacted_at IS NOT NULL AND n.redacted_by = v_owner
                                        FROM public.member_admin_notes n, public.system_settings s WHERE n.id = v_id AND s.key = 'member_withdrawal_policy'),
      'S7', '본문 → 가림 문구, redacted_at·redacted_by');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_ok('member_note_redact', ${sqlString(`{${AUDIT_DETAIL_KEYS.member_note_redact.join(',')}}`)}::text[], ARRAY['직원 메모 본문 S7']), 'S7', '가림 작업 기록(글자 수만)');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.redact_member_admin_note(%L, %L)', v_owner, v_id)), 'ERR MEMBER_NOTE_ALREADY_REDACTED', 'S7', '다시 가림 거절');
    -- 쓰기 막기(postgres 직접 쓰기도)
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_admin_notes SET body = %L WHERE id = %L', 'x', v_id)), 'ERR MEMBER_NOTE_DIRECT_WRITE', 'S7', '본문 직접 UPDATE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_admin_notes SET deleted_at = NULL, deleted_by = NULL WHERE id = %L', v_id)), 'ERR MEMBER_NOTE_DIRECT_WRITE', 'S7', '지우기 되돌림 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('INSERT INTO public.member_admin_notes (user_id, body, created_by) VALUES (%L, %L, %L)', v_e, 'x', v_owner)), 'ERR MEMBER_NOTE_DIRECT_WRITE', 'S7', '직접 INSERT 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('DELETE FROM public.member_admin_notes WHERE id = %L', v_id)), 'ERR MEMBER_NOTE_DIRECT_WRITE', 'S7', '직접 DELETE 거절');
    v_r := pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '2 days');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('UPDATE public.member_suspensions SET ends_at = ends_at + interval ''1 day'' WHERE id = %L', (pg_temp.res(v_r) ->> 'suspensionId')::uuid)),
      'ERR MEMBER_SUSPENSION_DIRECT_WRITE', 'S7', '정지 기간 직접 UPDATE 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('DELETE FROM public.member_suspensions WHERE id = %L', (pg_temp.res(v_r) ->> 'suspensionId')::uuid)),
      'ERR MEMBER_SUSPENSION_DIRECT_WRITE', 'S7', '정지 행 직접 DELETE 거절');`)
}

// light 만: 탈퇴 트리거가 없어 행이 남는 상태에서 '해제는 탈퇴 회원이면 거절 · banned_until 그대로'를 본다(full 은 S8 실제 익명화).
function caseS8Light() {
  return isolatedCase('rh_s8_light', 'S8', `
    v_r := pg_temp.suspend(v_owner, v_e, 'login_blocked', true, 'account_misuse', NULL);
    v_id := (pg_temp.res(v_r) ->> 'suspensionId')::uuid;
    UPDATE public.profiles SET withdrawn_at = now() WHERE id = v_e;
    UPDATE auth.users SET banned_until = now() + interval '100 years' WHERE id = v_e;
    v_log := v_log || pg_temp.expect(pg_temp.lift(v_owner, v_id), 'ERR MEMBER_SUSPEND_TARGET_INVALID', 'S8', 'light: 탈퇴 회원 해제 거절');
    v_log := v_log || pg_temp.ensure((SELECT banned_until FROM auth.users WHERE id = v_e) >= now() + interval '99 years', 'S8', 'light: 탈퇴 100년 차단 그대로');
    v_log := v_log || pg_temp.expect(pg_temp.notice(v_owner, v_id, 'email'), 'ERR MEMBER_SUSPEND_TARGET_INVALID', 'S8', 'light: 탈퇴 회원 알림 기록 거절');
    v_log := v_log || 'light: 실제 익명화(self·owner)와 탈퇴 트리거 삭제는 b_full 에서 본다'::text;`)
}

// full 만: 실제 anonymize_member 를 self·owner 각 1회(정지·메모가 있는 결제 없는 시험 계정 A·B)
function caseS8Full() {
  return isolatedCase('rh_s8_full', 'S8', `
    -- self 경로: 스위치를 켠다(고지 기간 잠금이면 이 거래에서만 잠금 트리거를 끄고 켠다)
    v_r := pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{selfAnonymizeEnabled}', 'true') WHERE key = 'member_withdrawal_policy'$s$);
    IF v_r LIKE 'ERR POLICY_UPCOMING_LOCKED%' THEN
      ALTER TABLE public.system_settings DISABLE TRIGGER lock_withdrawal_texts_during_notice;
      UPDATE public.system_settings SET value = jsonb_set(value, '{selfAnonymizeEnabled}', 'true') WHERE key = 'member_withdrawal_policy';
      ALTER TABLE public.system_settings ENABLE TRIGGER lock_withdrawal_texts_during_notice;
      v_log := v_log || '고지 기간 잠금 — 이 거래에서만 잠금 트리거를 끄고 스위치를 켬'::text;
    ELSE
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'S8', 'selfAnonymizeEnabled 켬(거래 안)');
    END IF;
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_b, 'restricted', true, 'other', now() + interval '5 days'), 'OK', 'S8', 'B 이용 제한');
    v_log := v_log || pg_temp.expect(pg_temp.note_add(v_owner, v_b, 'B 메모'), 'OK', 'S8', 'B 메모');
    DECLARE
      v_notice jsonb := public.get_member_withdrawal_notice(v_b, 'self', NULL);
    BEGIN
      v_r := pg_temp.try_json(format('SELECT public.anonymize_member(%L, %L, %L, NULL, %s, %L, false, NULL, %L, NULL, false)',
        v_b, v_b, 'self', (v_notice ->> 'expectedBalance')::integer, v_notice ->> 'text', 'rh12-s8-self-' || v_b));
    END;
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S8', '실제 anonymize_member(self) 성공');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.member_suspensions WHERE user_id = v_b) = 0
      AND (SELECT count(*) FROM public.member_admin_notes WHERE user_id = v_b) = 0, 'S8', 'self: 정지·메모 0행');
    v_log := v_log || pg_temp.ensure((SELECT banned_until FROM auth.users WHERE id = v_b) >= now() + interval '99 years', 'S8', 'self: banned_until 100년');
    -- owner 경로: 로그인 차단 + 메모가 있는 A, 대표가 이메일 요청을 기록한 뒤 익명화
    v_r := pg_temp.suspend(v_owner, v_a, 'login_blocked', true, 'account_misuse', NULL);
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S8', 'A 로그인 차단');
    v_id := (pg_temp.res(v_r) ->> 'suspensionId')::uuid;
    v_log := v_log || pg_temp.expect(pg_temp.note_add(v_owner, v_a, 'A 메모'), 'OK', 'S8', 'A 메모');
    DECLARE
      v_notice jsonb := public.get_member_withdrawal_notice(v_a, 'request', NULL);
      v_req jsonb;
    BEGIN
      v_req := public.create_member_withdrawal_request(v_a, 'email', v_notice ->> 'text', v_notice ->> 'sha256',
        (v_notice ->> 'expectedBalance')::integer, (v_notice ->> 'expectedForfeitPaid')::integer, (v_notice ->> 'expectedForfeitFree')::integer,
        '시험 요청', v_owner, NULL, 'self', NULL, NULL, NULL);
      v_r := pg_temp.try_json(format('SELECT public.anonymize_member(%L, %L, %L, %L, NULL, NULL, false, %L, %L, NULL, true)',
        v_owner, v_a, 'owner', (v_req ->> 'requestId')::uuid, '시험 처리', 'rh12-s8-owner-' || v_a));
    END;
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S8', '실제 anonymize_member(owner) 성공');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.member_suspensions WHERE user_id = v_a) = 0
      AND (SELECT count(*) FROM public.member_admin_notes WHERE user_id = v_a) = 0, 'S8', 'owner: 정지·메모 0행');
    v_log := v_log || pg_temp.ensure((SELECT banned_until FROM auth.users WHERE id = v_a) >= now() + interval '99 years', 'S8', 'owner: banned_until 100년(로그인 차단 해제 값이 아님)');
    v_log := v_log || pg_temp.expect(pg_temp.note_add(v_owner, v_a), 'ERR MEMBER_NOTE_TARGET_INVALID', 'S8', '익명화 뒤 메모 추가 거절');
    v_log := v_log || pg_temp.expect(pg_temp.lift(v_owner, v_id), 'ERR MEMBER_SUSPENSION_NOT_FOUND', 'S8', '익명화 뒤 로그인 차단 해제 불가(행 없음 — 탈퇴 차단을 풀지 않음)');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'login_blocked', true, 'account_misuse', NULL), 'ERR MEMBER_SUSPEND_TARGET_INVALID', 'S8', '익명화 뒤 정지 거절');
    v_log := v_log || pg_temp.ensure(pg_temp.audit_count('member_suspend', v_a) = 1,
      'S8', '작업 기록 뼈대는 남음');`)
}

function caseS9() {
  return isolatedCase('rh_s9', 'S9', `
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_e, 'restricted', true, 'scraping', now() + interval '4 days'), 'OK', 'S9', 'E 이용 제한');
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_e, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.get_my_member_gate();
    RESET ROLE;
    v_log := v_log || pg_temp.ensure(jsonb_typeof(v_j -> 'missingRequired') = 'array' AND v_j #>> '{restriction,scope}' = 'restricted'
      AND (v_j #> '{restriction,blocksDownload}') = 'true'::jsonb AND (v_j #>> '{restriction,endsAt}') IS NOT NULL,
      'S9', 'E 세션: 동의 부족 목록과 정지가 함께 나옴 ' || left(v_j::text, 120));
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    v_j := public.get_my_member_gate();
    RESET ROLE;
    v_log := v_log || pg_temp.ensure((v_j -> 'restriction') = 'null'::jsonb, 'S9', '다른 회원(A) 세션: E 의 정지는 안 보임');
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.member_active_suspension(v_e);
      v_r := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM;
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'ERR permission denied', 'S9', 'authenticated 는 member_active_suspension 실행 불가');
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.suspend_member(v_e, v_a, 'restricted', true, 'other', 'x', '', now() + interval '1 day', 'rh12-s9-key-0001');
      v_r := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM;
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'ERR permission denied', 'S9', 'authenticated 는 suspend_member 실행 불가');
    SET LOCAL ROLE anon;
    BEGIN
      PERFORM public.get_my_member_gate();
      v_r := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM;
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'ERR permission denied', 'S9', 'anon 은 get_my_member_gate 실행 불가');
    PERFORM set_config('request.jwt.claims', '', true);`)
}

function caseS10(mode) {
  const restrictive = mode === 'full' ? `
    -- RESTRICTIVE: 대표 세션(authenticated) 직접 UPDATE 는 0행, postgres 는 1행
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.system_settings SET updated_at = updated_at WHERE key = 'member_suspension_policy';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RESET ROLE;
    v_log := v_log || pg_temp.ensure(v_n = 0, 'S10', '대표 세션 직접 UPDATE → 0행(RESTRICTIVE)');
    SET LOCAL ROLE authenticated;
    UPDATE public.system_settings SET updated_at = updated_at WHERE key = 'site_brand';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RESET ROLE;
    v_log := v_log || pg_temp.ensure(v_n = 1, 'S10', '대조: 대표 세션 site_brand UPDATE 1행');
    PERFORM set_config('request.jwt.claims', '', true);` : `
    v_log := v_log || 'light: RESTRICTIVE 정책은 b_full 에서 본다'::text;`
  return isolatedCase('rh_s10', 'S10', `
    v_j := (SELECT value FROM public.system_settings WHERE key = 'member_suspension_policy');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer,
      jsonb_set(v_j, '{texts,noticeTitle}', '"계정 이용 제한 안내(시험)"'))), 'OK {"value"', 'S10', '대표 저장(revision +1)');
    v_log := v_log || pg_temp.ensure((SELECT (value ->> 'revision')::integer FROM public.system_settings WHERE key = 'member_suspension_policy') = (v_j ->> 'revision')::integer + 1
      AND pg_temp.audit_count('member_suspension_policy_update') = 1, 'S10', 'revision 올라감·작업 기록');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer, v_j)),
      'ERR MEMBER_SUSPENSION_POLICY_REVISION_CONFLICT', 'S10', '옛 revision 거절');
    v_j := (SELECT value FROM public.system_settings WHERE key = 'member_suspension_policy');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_staff, (v_j ->> 'revision')::integer, v_j)),
      'ERR MEMBER_SUSPENSION_POLICY_ACTOR_NOT_OWNER', 'S10', '직원 저장 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer,
      jsonb_set(v_j, '{reasonCategories,0}', (v_j #> '{reasonCategories,0}') - 'blocksDownloadDefault'))), 'ERR MEMBER_SUSPENSION_POLICY_INPUT_INVALID', 'S10', 'blocksDownloadDefault 빠짐 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer,
      jsonb_set(v_j, '{reasonCategories,0,blocksDownloadDefault}', '"yes"'))), 'ERR MEMBER_SUSPENSION_POLICY_INPUT_INVALID', 'S10', 'blocksDownloadDefault 가 boolean 아님 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer,
      jsonb_set(v_j, '{maxRestrictedDays}', '366'))), 'ERR MEMBER_SUSPENSION_POLICY_INPUT_INVALID', 'S10', '최대 일수 366 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer,
      v_j #- '{texts,apiBlocked}')), 'ERR MEMBER_SUSPENSION_POLICY_INPUT_INVALID', 'S10', '문구 키 빠짐 거절');
    -- 쓰는 중인 코드(payment_abuse)를 지우기 → 거절, 숨김은 받음
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_e, 'restricted', false, 'payment_abuse', now() + interval '1 day'), 'OK', 'S10', '분류 payment_abuse 로 정지');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer,
      jsonb_set(v_j, '{reasonCategories}', (SELECT jsonb_agg(c) FROM jsonb_array_elements(v_j -> 'reasonCategories') c WHERE c ->> 'code' <> 'payment_abuse')))),
      'ERR MEMBER_SUSPENSION_POLICY_CODE_IN_USE', 'S10', '쓰는 중인 코드 지우기 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_json(format('SELECT public.save_member_suspension_policy(%L, %s, %L::jsonb)', v_owner, (v_j ->> 'revision')::integer,
      jsonb_set(v_j, '{reasonCategories}', (SELECT jsonb_agg(CASE WHEN c ->> 'code' = 'payment_abuse' THEN jsonb_set(c, '{hidden}', 'true') ELSE c END)
                                             FROM jsonb_array_elements(v_j -> 'reasonCategories') c)))),
      'OK', 'S10', '쓰는 중인 코드 숨김은 받음');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', false, 'payment_abuse', now() + interval '1 day'), 'ERR MEMBER_SUSPEND_REASON_UNKNOWN', 'S10', '숨긴 분류로 새 정지 거절');
${restrictive}`)
}

function caseS11() {
  return isolatedCase('rh_s11', 'S11', `
    v_r := pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '1 day');
    v_id := (pg_temp.res(v_r) ->> 'suspensionId')::uuid;
    SET LOCAL ROLE service_role;
    BEGIN
      INSERT INTO public.member_admin_notes (user_id, body, created_by) VALUES (v_e, 'x', v_owner);
      v_r := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM || ' [' || SQLSTATE || ']';
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'ERR permission denied', 'S11', 'service_role 메모 INSERT 권한 오류');
    SET LOCAL ROLE service_role;
    BEGIN
      UPDATE public.member_suspensions SET first_seen_at = now() WHERE id = v_id;
      v_r := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM || ' [' || SQLSTATE || ']';
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'ERR permission denied', 'S11', 'service_role 정지 UPDATE 권한 오류');
    SET LOCAL ROLE service_role;
    BEGIN
      DELETE FROM public.member_suspensions WHERE id = v_id;
      v_r := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM || ' [' || SQLSTATE || ']';
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'ERR permission denied', 'S11', 'service_role 정지 DELETE 권한 오류');
    SET LOCAL ROLE service_role;
    BEGIN
      SELECT count(*) INTO v_n FROM public.member_suspensions WHERE id = v_id;
      v_r := 'OK ' || v_n;
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM;
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'OK 1', 'S11', 'service_role SELECT 는 됨(RLS 정책 0이어도 BYPASSRLS)');
    -- 서비스 키 경로: 함수로는 됨(mark_member_suspension_seen)
    SET LOCAL ROLE service_role;
    BEGIN
      v_r := 'OK ' || public.mark_member_suspension_seen(v_e)::text;
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM;
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'OK true', 'S11', 'service_role mark_member_suspension_seen(처음 연 시각) 채움');
    v_log := v_log || pg_temp.ensure(public.mark_member_suspension_seen(v_e) IS FALSE
      AND (SELECT first_seen_at IS NOT NULL FROM public.member_suspensions WHERE id = v_id), 'S11', '두 번째는 그대로(false)');`)
}

// full 만: 완전 삭제처럼 프로필을 지우면 CASCADE 로 정지·메모가 지워진다(service_role, 쓰기 막기 통과).
function caseS12() {
  return isolatedCase('rh_s12', 'S12', `
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_a, 'restricted', true, 'other', now() + interval '3 days'), 'OK', 'S12', 'A 이용 제한');
    v_log := v_log || pg_temp.expect(pg_temp.note_add(v_owner, v_a), 'OK', 'S12', 'A 메모');
    DELETE FROM public.exam_papers WHERE user_id = v_a;
    DELETE FROM public.questions WHERE user_id = v_a;
    DELETE FROM public.support_tickets WHERE user_id = v_a;
    DELETE FROM public.credit_transactions WHERE user_id = v_a;
    DELETE FROM public.ai_question_generation_runs WHERE user_id = v_a;
    SET LOCAL ROLE service_role;
    BEGIN
      DELETE FROM public.profiles WHERE id = v_a;
      v_r := 'OK';
    EXCEPTION WHEN OTHERS THEN
      v_r := 'ERR ' || SQLERRM || ' [' || SQLSTATE || ']';
    END;
    RESET ROLE;
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S12', 'service_role 프로필 삭제(fullDeleteMember 와 같은 길)');
    v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.member_suspensions WHERE user_id = v_a) = 0
      AND (SELECT count(*) FROM public.member_admin_notes WHERE user_id = v_a) = 0, 'S12', 'CASCADE 로 정지·메모 0행');`)
}

function caseS13() {
  return isolatedCase('rh_s13', 'S13', `
    v_r := pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '1 day');
    v_id := (pg_temp.res(v_r) ->> 'suspensionId')::uuid;
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: active suspensions', 'S13', '활성 정지 있으면 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.lift(v_owner, v_id), 'OK', 'S13', '해제');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.view', 'members.memo']), 'OK', 'S13', '권한 행 만들기');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: members.memo', 'S13', '새 권한 행 있으면 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.view']), 'OK', 'S13', '권한 회수');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: suspension history exists', 'S13', '이력 있으면 내보내기 확인 전 멈춤');
    INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ('20261215100000', 'rh12_bundle13_marker', ARRAY[]::text[]);
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: bundle 13 is applied', 'S13', '13번 version 있으면 멈춤');
    DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261215100000' AND name = 'rh12_bundle13_marker';
    -- 내보내기 확인 상수만 바꾼 사본으로 되돌리기 → 남은 것 0 → 다시 적용
    v_r := pg_temp.try_sql(pg_temp.subst_once(pg_temp.subst_once(pg_temp.ctx('src_down'),
      ${sqlString(DOWN_EXPORT_LINES[0][0])}, ${sqlString(DOWN_EXPORT_LINES[0][1])}),
      ${sqlString(DOWN_EXPORT_LINES[1][0])}, ${sqlString(DOWN_EXPORT_LINES[1][1])}));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'S13', '되돌리기(내보내기 확인 뒤)');
    v_log := v_log || pg_temp.ensure(to_regclass('public.member_suspensions') IS NULL AND to_regclass('public.member_admin_notes') IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('suspend_member', 'get_my_member_gate', 'redact_member_admin_note'))
      AND NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'member_suspension_policy')
      AND pg_temp.md5_src('public.replace_admin_permission_grants(uuid,uuid,jsonb)') = '54540b6b0286f81f243575f1c03a568c'
      AND pg_temp.md5_def('public.replace_admin_permission_grants(uuid,uuid,jsonb)') = 'dcb2155fae26443c98231627d102a821',
      'S13', '남은 객체 0, 권한 함수는 20261118120000 정의');
    v_log := v_log || pg_temp.expect(pg_temp.grants(v_owner, v_staff, ARRAY['members.memo']), 'ERR ADMIN_PERMISSION_UNKNOWN', 'S13', '되돌린 뒤 새 키는 다시 거절');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_migration')), 'OK', 'S13', '다시 적용');
    v_log := v_log || pg_temp.expect(pg_temp.suspend(v_owner, v_e, 'restricted', false, 'other', now() + interval '1 day'), 'OK', 'S13', '다시 적용 뒤 정지');
    -- 권한 함수가 뒤 묶음에서 다시 정의됐으면 down 은 멈춘다(덮어쓰지 않음)
    EXECUTE replace(pg_get_functiondef('public.replace_admin_permission_grants(uuid,uuid,jsonb)'::regprocedure), '-- 코드 목록', '-- rh12 바뀐 정의: 코드 목록');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'ERR DOWN PRECHECK: replace_admin_permission_grants is not the bundle 12 definition', 'S13', '권한 함수 md5 다르면 멈춤');`)
}

export function buildRehearsalFiles() {
  const files = {}
  files['a_light.sql'] = prelude({
    title: 'A light — 마이그레이션 사본(profiles FK·profiles 트리거·system_settings 정책 뺌)·down·다시 적용, S1~S7·S8(해제 거절만)·S9~S11·S13',
    when: '지금 돌려도 됨(새 표·함수 생성, 시험 계정·설정 행의 행 잠금뿐 — 기존 표의 LOCK/ALTER TABLE·TRIGGER·POLICY·FK 없음). 실제 FK·트리거·정책은 새벽의 b_full 이 본다.',
    mode: 'light',
  })
    + BEFORE_APPLY
    + `\n-- ===== 12번 마이그레이션 사본(light) =====\n${migrationCopy('light')}\n`
    + AFTER_APPLY
    + caseS1() + caseS2() + caseS3() + caseS4() + caseS5() + caseS6() + caseS7() + caseS8Light() + caseS9() + caseS10('light') + caseS11() + caseS13()
    + FOOT

  files['b_full.sql'] = prelude({
    title: 'B full — 실제 마이그레이션(FK·profiles 트리거·RESTRICTIVE 정책)과 S1~S13(실제 익명화 self·owner, CASCADE 포함)',
    when: '새벽 03~04시만, DB 적용 전 필수(S8·S12·S10). profiles 는 처음부터 SHARE ROW EXCLUSIVE(쓰기 막음), 마지막 경우 S13 되돌리기부터 끝까지 ACCESS EXCLUSIVE(읽기도 막음). system_settings 는 ACCESS EXCLUSIVE. 거래 끝까지 잡는다(lock_timeout 3초).',
    mode: 'full',
  })
    + BEFORE_APPLY
    + `\n-- ===== 12번 마이그레이션(원본 그대로) =====\n${migrationCopy('full')}\n`
    + AFTER_APPLY
    + caseS1() + caseS2() + caseS3() + caseS4() + caseS5() + caseS6() + caseS7() + caseS8Full() + caseS9() + caseS10('full') + caseS11() + caseS12() + caseS13()
    + FOOT
  for (const [name, content] of Object.entries(files)) {
    if (/^\s*COMMIT\s*;/m.test(content) || /\bCOMMIT\s*;/.test(content)) throw new Error(`${name} contains a COMMIT statement`)
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
