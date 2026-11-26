// 11번 묶음 리허설 생성기(계획 docs/plan-bundle11-checkout-simplify.md 11-2: 실제 파일을 실행하고, 사본은 생성기로 만들어 다른 줄을 계약 시험으로 고정).
// 원본(마이그레이션·down·스크립트 A·B·되돌림·10번 down_b·9번 충전 함수·예시 묶음)을 읽어 리허설 SQL 파일을 만든다.
//   node supabase/scripts/bundle11_rehearsal/generate.mjs          → 이 폴더의 *.sql 을 다시 쓴다
//   node supabase/scripts/bundle11_rehearsal/generate.mjs --check  → 다시 만든 값과 파일이 다르면 실패
// 실행(운영 DB, postgres): supabase db query --remote --yes -o json --file supabase/scripts/bundle11_rehearsal/<파일>
//   모든 파일은 BEGIN … 마지막 SELECT … ROLLBACK 이다(COMMIT 없음). 결과는 ON COMMIT DROP 임시 표 _rh_log 로 받는다.
//   지금(낮) 돌려도 되는 파일: a_light.sql — 표 잠금 DDL 없음(함수 생성·설정 행 잠금뿐). 기록 함수는 같은 본문의 pg_temp 사본이
//     임시 표(같은 칸)에 쓴다(원칙 2: 바꾼 곳은 표 이름·함수 이름뿐, 계약 시험이 고정). 실제 기록 표에는 쓰지 않는다(옛 함수 호출은
//     거절 경로만). 기록 함수에 넘기는 회원은 @test.com 시험 계정만(없으면 멈춤).
//   새벽에만 돌릴 파일: b_full.sql — 실제 마이그레이션(두 기록 표 ACCESS EXCLUSIVE — 읽기도 막음)과 실제 표에 기록하는 경우들.
//                      c_snapshot_closed.sql — 사본 없음 경우(policy_document_snapshots 의 가드 트리거를 그 거래 안에서만 끔).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

export const SOURCES = {
  migration: 'supabase/migrations/20261216100000_checkout_consent_v2.sql',
  down: 'supabase/rollback/20261216100000_checkout_consent_v2_down.sql',
  scriptKeys: 'supabase/scripts/20261216_bundle11_consent_keys.sql',
  scriptFormat2: 'supabase/scripts/20261216_bundle11_consent_format_2.sql',
  scriptFormat1: 'supabase/scripts/20261216_bundle11_consent_format_1.sql',
  bundle10DownB: 'supabase/rollback/20261126100000_member_withdrawal_down_b.sql',
  bundle9Migration: 'supabase/migrations/20261125100000_point_charge_policy.sql',
  examples: 'tests/fixtures/bundle11-consent-examples.json',
}

// ── 마이그레이션 light 사본: 표 잠금 DDL(LOCK TABLE·ALTER TABLE·CHECK 추가·COMMENT)과 칸 VERIFY 만 뺀다 ───────────────────────
export const MIGRATION_LIGHT_REMOVALS = [
  /\nLOCK TABLE public\.market_purchase_notice_acks IN ACCESS EXCLUSIVE MODE;\n/,
  /\nLOCK TABLE public\.point_charge_checkout_acks IN ACCESS EXCLUSIVE MODE;\n/,
  /\nALTER TABLE public\.market_purchase_notice_acks\n[\s\S]*?;\n/,
  /\nALTER TABLE public\.point_charge_checkout_acks\n[\s\S]*?;\n/,
  /\nDO \$add_consent_format_checks\$\n[\s\S]*?\n\$add_consent_format_checks\$;\n/,
  /\nCOMMENT ON COLUMN public\.market_purchase_notice_acks\.consent_format IS [^\n]*\n/,
  /\nCOMMENT ON COLUMN public\.market_purchase_notice_acks\.consent_details IS [^\n]*\n/,
  /\nCOMMENT ON COLUMN public\.point_charge_checkout_acks\.consent_details IS [^\n]*\n/,
]
export const MIGRATION_LIGHT_VERIFY = [
  "                                                              'point_charge_checkout_acks_consent_format_check')) <> 2 THEN",
  "                                                              'point_charge_checkout_acks_consent_format_check')) < 0 THEN",
]
// 칸 VERIFY 는 light 에서 칸이 없으므로 '0 이상' 으로 바꾼다(위 한 줄 + 아래 두 줄)
export const MIGRATION_LIGHT_VERIFY_COLUMNS = [
  ["AND column_name IN ('refund_policy_sha256', 'terms_policy_sha256', 'consent_format', 'consent_details')) <> 4",
    "AND column_name IN ('refund_policy_sha256', 'terms_policy_sha256', 'consent_format', 'consent_details')) < 0"],
  ["AND column_name IN ('terms_policy_sha256', 'consent_format', 'consent_details')) <> 3",
    "AND column_name IN ('terms_policy_sha256', 'consent_format', 'consent_details')) < 0"],
]

export function migrationCopy(kind) {
  let sql = read(SOURCES.migration)
  if (kind === 'full') return sql
  if (kind !== 'light') throw new Error(`unknown migration copy ${kind}`)
  for (const re of MIGRATION_LIGHT_REMOVALS) {
    if (!re.test(sql)) throw new Error(`migration copy: ${re} not found`)
    sql = sql.replace(re, '\n')
  }
  for (const [from, to] of [MIGRATION_LIGHT_VERIFY, ...MIGRATION_LIGHT_VERIFY_COLUMNS]) {
    if (sql.split(from).length !== 2) throw new Error(`migration copy: verify line not found once: ${from}`)
    sql = sql.replace(from, to)
  }
  for (const word of ['LOCK TABLE', 'ALTER TABLE', 'COMMENT ON', 'CREATE TRIGGER', 'DROP TRIGGER', 'CREATE POLICY', 'DROP POLICY', 'CREATE INDEX']) {
    if (sql.includes(word)) throw new Error(`migration light copy still has ${word}`)
  }
  return sql
}

// 기록 함수 pg_temp 사본(light: 임시 표에 쓴다 / step6: ② 재기록 조회를 건너뛰어 ⑥ ON CONFLICT 경로를 본다).
// 바꾸는 것: 함수 이름(pg_temp.*), 표 이름(light 만), step6 은 ② 의 WHERE 한 줄. 그 밖은 마이그레이션 본문 그대로.
export const RECORD_FUNCTION_HEADS = {
  market: 'CREATE OR REPLACE FUNCTION public.record_purchase_notice_ack(p_user_id uuid, p_idempotency_key uuid, p_notice_sha256 text, p_cart_texts_sha256 text DEFAULT NULL)',
  point: 'CREATE OR REPLACE FUNCTION public.record_point_charge_checkout_ack(p_user_id uuid, p_checkout_attempt_id uuid, p_plan_id uuid, p_expected_amount integer, p_expected_credits integer, p_notice_sha256 text)',
}
export const RECORD_TABLES = {
  market: ['public.market_purchase_notice_acks', 'pg_temp.rh_market_acks'],
  point: ['public.point_charge_checkout_acks', 'pg_temp.rh_charge_acks'],
}
export const STEP6_LINE = [
  "  IF FOUND AND v_existing_sha = p_notice_sha256 AND v_existing_cart IS NOT DISTINCT FROM p_cart_texts_sha256 THEN\n    RETURN jsonb_build_object('ok', true, 'replay', true, 'consentFormat', v_existing_format);\n  END IF;\n\n  -- ③",
  "  -- (rh step6 사본: ② replay 를 건너뛴다)\n  v_existing_sha := NULL;\n\n  -- ③",
]

export function recordFunctionCopy(which, { tempTables, name, step6 = false }) {
  const migration = read(SOURCES.migration)
  const head = RECORD_FUNCTION_HEADS[which]
  const start = migration.indexOf(head)
  if (start < 0 || migration.indexOf(head, start + 1) >= 0) throw new Error(`record function head not found once: ${which}`)
  const end = migration.indexOf('\n$function$;\n', start)
  let sql = migration.slice(start, end + '\n$function$;'.length)
  sql = sql.replace(head, head.replace(/^CREATE OR REPLACE FUNCTION public\.[a-z_]+\(/, `CREATE FUNCTION ${name}(`))
  if (tempTables) {
    const [from, to] = RECORD_TABLES[which]
    if (!sql.includes(from)) throw new Error(`table ${from} not in ${which}`)
    sql = sql.split(from).join(to)
  }
  if (step6) {
    if (which !== 'market' || sql.split(STEP6_LINE[0]).length !== 2) throw new Error('step6 line not found once')
    sql = sql.replace(STEP6_LINE[0], STEP6_LINE[1])
  }
  return sql
}

// down 사본: light 는 칸이 없으므로 '칸은 남는다' VERIFY 한 줄만 '0 이상'으로 바꾼다.
export const DOWN_LIGHT_VERIFY = [
  "OR (table_name = 'point_charge_checkout_acks' AND column_name IN ('terms_policy_sha256', 'consent_format', 'consent_details')))) <> 7 THEN",
  "OR (table_name = 'point_charge_checkout_acks' AND column_name IN ('terms_policy_sha256', 'consent_format', 'consent_details')))) < 0 THEN",
]

export function downCopy(kind) {
  const sql = read(SOURCES.down)
  if (kind === 'full') return sql
  if (sql.split(DOWN_LIGHT_VERIFY[0]).length !== 2) throw new Error('down copy: verify line not found once')
  return sql.replace(DOWN_LIGHT_VERIFY[0], DOWN_LIGHT_VERIFY[1])
}

// R7 '그대로' 목록 = 마이그레이션 사전 검사의 v_same(5-5 목록 14개) + 스크립트 사전 검사의 record_admin_audit. 원본에서 읽어 두 곳이 같게 한다.
export function unchangedFunctions() {
  const migration = read(SOURCES.migration)
  const block = migration.slice(migration.indexOf('  v_same text[][] := ARRAY['), migration.indexOf('  ];', migration.indexOf('  v_same text[][] := ARRAY[')))
  const pairs = [...block.matchAll(/ARRAY\['([^']+)', '([0-9a-f]{32})'\]/g)].map((match) => [match[1], match[2]])
  if (pairs.length !== 14) throw new Error(`v_same must list 14 functions, got ${pairs.length}`)
  const audit = read(SOURCES.scriptKeys).match(/ARRAY\['(public\.record_admin_audit\([^']+\))', '([0-9a-f]{32})'\]/)
  if (!audit) throw new Error('record_admin_audit md5 not found in script A')
  return [...pairs, [audit[1], audit[2]]]
}

function extractDoBlock(source, tag, label) {
  const re = new RegExp(`\\nDO \\$${tag}\\$\\n[\\s\\S]*?\\n\\$${tag}\\$;\\n`)
  const match = source.match(re)
  if (!match) throw new Error(`${label}: DO $${tag}$ block not found`)
  return match[0].slice(1, -1)
}

// 9번 충전 함수(10번 전 정의, md5 0047854a…) — R8 에서 10번 전 상태를 만든다.
export function bundle9PointChargeFunction() {
  const source = read(SOURCES.bundle9Migration)
  const start = source.indexOf('CREATE OR REPLACE FUNCTION public.record_point_charge_checkout_ack(')
  const end = source.indexOf('\n$fn_rpcca$;\n', start)
  if (start < 0 || end < 0) throw new Error('bundle 9 point charge function not found')
  return source.slice(start, end + '\n$fn_rpcca$;'.length)
}

// 스크립트 사본: 바꾸는 줄은 이 세 줄뿐(각 줄은 원본에 정확히 1번).
export const SCRIPT_LINES = {
  mode: '  c_mode constant text := NULL;',
  market: '  c_market_policy_md5 constant text := NULL;',
  point: '  c_point_policy_md5 constant text := NULL;',
}
export const SCRIPT_TAGS = { keys: 'bundle11_consent_keys', format2: 'bundle11_consent_format_2', format1: 'bundle11_consent_format_1' }

function dollar(tag, text) {
  if (text.includes(`$${tag}$`)) throw new Error(`source contains $${tag}$`)
  return `$${tag}$${text}$${tag}$`
}

function sqlString(text) {
  return `'${text.replaceAll("'", "''")}'`
}

// ── 공통 머리: 임시 표·도우미(거래 안에서만 산다) ─────────────────────────────────────────────────────────────
function prelude({ title, when, mode }) {
  const keys = extractDoBlock(read(SOURCES.scriptKeys), SCRIPT_TAGS.keys, 'script A')
  const format2 = extractDoBlock(read(SOURCES.scriptFormat2), SCRIPT_TAGS.format2, 'script B')
  const format1 = extractDoBlock(read(SOURCES.scriptFormat1), SCRIPT_TAGS.format1, 'revert script')
  const downB = extractDoBlock(read(SOURCES.bundle10DownB), 'down_b_precheck', 'bundle 10 down_b')
  return `-- 11번 묶음 리허설: ${title}
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle11_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes -o json --file supabase/scripts/bundle11_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: ${when}
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '180s';
CREATE TEMP TABLE _rh_log (n serial PRIMARY KEY, test text NOT NULL, msg text NOT NULL, payload jsonb) ON COMMIT DROP;
CREATE TEMP TABLE _rh_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.ctx_set(p_k text, p_v text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _rh_ctx (k, v) VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v
$f$;
CREATE FUNCTION pg_temp.ctx(p_k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM _rh_ctx WHERE k = p_k $f$;
CREATE FUNCTION pg_temp.fail(p_test text, p_msg text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  RAISE EXCEPTION 'RH FAIL [%] %', p_test, left(p_msg, 850);
END $f$;
-- 동적 SQL 을 실행하고 'OK' 또는 'ERR 메시지'(앞 300자)를 돌려준다. 실패하면 그 문장의 변경은 되돌려진다.
CREATE FUNCTION pg_temp.try_sql(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300);
END $f$;
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
CREATE FUNCTION pg_temp.md5_of(p_sig text) RETURNS text LANGUAGE sql AS $f$
  SELECT CASE WHEN to_regprocedure(p_sig) IS NULL THEN 'missing' ELSE md5(pg_get_functiondef(to_regprocedure(p_sig))) END
$f$;
CREATE FUNCTION pg_temp.policy(p_key text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT value FROM public.system_settings WHERE key = p_key $f$;
CREATE FUNCTION pg_temp.set_policy(p_key text, p_value jsonb) RETURNS void LANGUAGE sql AS $f$
  UPDATE public.system_settings SET value = p_value WHERE key = p_key
$f$;
-- 2판 묶음에서 원문을 다시 만든다(5-1 과 같은 줄 규칙) — 기록의 consent_details.consent 로 notice_sha256 을 다시 계산할 때 쓴다.
CREATE FUNCTION pg_temp.consent_text(p_consent jsonb) RETURNS text LANGUAGE sql AS $f$
  SELECT array_to_string(ARRAY[p_consent ->> 'consentTitle']
    || ARRAY(SELECT e.value #>> '{}' FROM jsonb_array_elements(p_consent -> 'consentSummary') WITH ORDINALITY e(value, n) ORDER BY e.n)
    || ARRAY(SELECT l FROM jsonb_array_elements(p_consent -> 'consentItems') WITH ORDINALITY i(value, n),
               LATERAL (SELECT i.value ->> 'label' AS l, 0 AS o
                        UNION ALL SELECT t.value #>> '{}', t.n FROM jsonb_array_elements(CASE WHEN i.value ->> 'view' = 'text' THEN i.value -> 'texts' ELSE '[]'::jsonb END) WITH ORDINALITY t(value, n)
                        UNION ALL SELECT '링크:' || (i.value ->> 'link'), 1 WHERE i.value ->> 'view' = 'link') x
              ORDER BY i.n, x.o), chr(10))
$f$;
CREATE FUNCTION pg_temp.sha(p_text text) RETURNS text LANGUAGE sql AS $f$ SELECT encode(sha256(convert_to(p_text, 'UTF8')), 'hex') $f$;
-- 기록 함수에 넘길 회원: @test.com 시험 계정만 쓴다(실회원 id 는 쓰지 않음). 없으면 멈춘다. 판매 중 충전 상품 하나, 탈퇴 회원 하나(없으면 NULL — 맨 앞 거절만 봄)
CREATE FUNCTION pg_temp.rh_user() RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_id uuid;
BEGIN
  SELECT p.id INTO v_id FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.withdrawn_at IS NULL AND u.email LIKE '%@test.com' ORDER BY u.created_at LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'RH FAIL [setup] @test.com 시험 계정이 없음 — 실회원 id 로 대신하지 않고 멈춘다';
  END IF;
  RETURN v_id;
END $f$;
CREATE FUNCTION pg_temp.rh_plan() RETURNS public.pricing_plans LANGUAGE sql AS $f$
  SELECT * FROM public.pricing_plans WHERE is_active ORDER BY price LIMIT 1
$f$;
CREATE FUNCTION pg_temp.rh_withdrawn_user() RETURNS uuid LANGUAGE sql AS $f$
  SELECT p.id FROM public.profiles p WHERE p.withdrawn_at IS NOT NULL LIMIT 1
$f$;

-- 스크립트 원본 DO 블록(생성기가 원본 파일에서 꺼낸 글 그대로)과 10번 down_b 사전 검사 블록
SELECT pg_temp.ctx_set('src_keys', ${dollar('rh_src_keys', keys)});
SELECT pg_temp.ctx_set('src_format2', ${dollar('rh_src_format2', format2)});
SELECT pg_temp.ctx_set('src_format1', ${dollar('rh_src_format1', format1)});
SELECT pg_temp.ctx_set('src_down_b_precheck', ${dollar('rh_src_down_b', downB)});
SELECT pg_temp.ctx_set('src_down', ${dollar('rh_src_down', downCopy(mode))});
SELECT pg_temp.ctx_set('src_bundle9_point', ${dollar('rh_src_b9', bundle9PointChargeFunction())});

-- 스크립트 사본: 바꾸는 줄은 SCRIPT_LINES 세 줄뿐. p_md5: NULL 이면 지금 정책 값 md5(실행 직전에 읽은 값), 아니면 그 글자(틀린 md5 경우).
CREATE FUNCTION pg_temp.script_sql(p_which text, p_mode text DEFAULT 'apply', p_md5 text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v text := pg_temp.ctx('src_' || p_which);
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION 'RH FAIL unknown script %', p_which;
  END IF;
  v := pg_temp.subst_once(v, ${sqlString(SCRIPT_LINES.mode)}, '  c_mode constant text := ' || quote_nullable(p_mode) || ';');
  v := pg_temp.subst_once(v, ${sqlString(SCRIPT_LINES.market)}, '  c_market_policy_md5 constant text := '
    || coalesce(quote_literal(p_md5), quote_literal(md5(pg_temp.policy('market_purchase_policy')::text))) || ';');
  v := pg_temp.subst_once(v, ${sqlString(SCRIPT_LINES.point)}, '  c_point_policy_md5 constant text := '
    || coalesce(quote_literal(p_md5), quote_literal(md5(pg_temp.policy('point_charge_policy')::text))) || ';');
  RETURN v;
END $f$;
`
}

// 경우 하나를 격리한다: 안에서 남긴 상태는 표지 예외 RH_ISOLATE 로 되돌리고, 로그(변수 v_log)만 남긴다(원칙 1).
function isolatedCase(tag, test, body, declare = '') {
  return `
DO $${tag}$
DECLARE
  v_log text[] := '{}';
  v_r text;
  v_j jsonb;
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

// 모드별 이름: light 는 pg_temp 사본 + 임시 표, full 은 실제 함수·표
function names(mode) {
  return mode === 'light'
    ? { recM: 'pg_temp.rh_rec_m', recP: 'pg_temp.rh_rec_p', tM: 'pg_temp.rh_market_acks', tP: 'pg_temp.rh_charge_acks' }
    : { recM: 'public.record_purchase_notice_ack', recP: 'public.record_point_charge_checkout_ack',
        tM: 'public.market_purchase_notice_acks', tP: 'public.point_charge_checkout_acks' }
}

// light 의 임시 표(실제 표와 같은 칸 + 11번 칸)와 기록 함수 사본
function lightTables() {
  return `
-- ===== light: 실제 기록 표와 같은 칸(11번 칸 포함)의 임시 표, 그 표에 쓰는 기록 함수 사본(본문은 마이그레이션 그대로) =====
CREATE TEMP TABLE rh_market_acks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, idempotency_key uuid NOT NULL,
  notice_sha256 text NOT NULL, notice_text text NOT NULL, refund_days integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  refund_policy_sha256 text, terms_policy_sha256 text, consent_format smallint NOT NULL DEFAULT 1 CHECK (consent_format IN (1, 2)), consent_details jsonb,
  UNIQUE (user_id, idempotency_key)) ON COMMIT DROP;
CREATE TEMP TABLE rh_charge_acks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL, checkout_attempt_id uuid NOT NULL, plan_id uuid NOT NULL,
  plan_name text NOT NULL, amount integer NOT NULL, credits integer NOT NULL, refund_days integer NOT NULL,
  notice_text text NOT NULL, notice_sha256 text NOT NULL, refund_policy_sha256 text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  terms_policy_sha256 text, consent_format smallint NOT NULL DEFAULT 1 CHECK (consent_format IN (1, 2)), consent_details jsonb,
  UNIQUE (user_id, checkout_attempt_id)) ON COMMIT DROP;
${recordFunctionCopy('market', { tempTables: true, name: 'pg_temp.rh_rec_m' })}
${recordFunctionCopy('point', { tempTables: true, name: 'pg_temp.rh_rec_p' })}
${recordFunctionCopy('market', { tempTables: true, name: 'pg_temp.rh_rec_m_step6', step6: true })}
`
}

function fullStep6() {
  return `
-- ===== ⑥ 경로 사본(② replay 를 건너뜀, 실제 표) =====
${recordFunctionCopy('market', { tempTables: false, name: 'pg_temp.rh_rec_m_step6', step6: true })}
`
}

// 마이그레이션 전 옛 함수 결과(R0 '10번 함수 결과와 글자 그대로')를 담아 둔다. 옛 함수는 거절 경로에서 돌아오므로 기록하지 않는다.
const CAPTURE_BASE = `
-- ===== 마이그레이션 전: 옛 함수(10번) 거절 응답 담기 + down 사전 검사는 11번 전 상태에서 멈춰야 함(R6) =====
DO $rh_capture$
DECLARE
  v_user uuid := pg_temp.rh_user();
  v_plan public.pricing_plans := pg_temp.rh_plan();
  v_r jsonb;
BEGIN
  IF v_user IS NULL OR v_plan.id IS NULL THEN
    PERFORM pg_temp.fail('R0', '회원 또는 판매 중 충전 상품이 없음');
  END IF;
  IF pg_temp.md5_of('public.record_purchase_notice_ack(uuid,uuid,text)') <> 'fa6a7edd836f21422d52dd184afb079b'
     OR pg_temp.md5_of('public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)') <> 'be4403fd993c45d618950a5908a91591' THEN
    PERFORM pg_temp.fail('R0', '마이그레이션 전 함수가 10번 값이 아님');
  END IF;
  v_r := public.record_purchase_notice_ack(v_user, gen_random_uuid(), repeat('0', 64));
  PERFORM pg_temp.ensure(v_r ->> 'code' = 'NOTICE_CHANGED', 'R0', '옛 자료 함수 거절');
  PERFORM pg_temp.ctx_set('old_market_changed', v_r::text);
  v_r := public.record_point_charge_checkout_ack(v_user, gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, repeat('0', 64));
  PERFORM pg_temp.ensure(v_r ->> 'code' = 'NOTICE_CHANGED', 'R0', '옛 충전 함수 NOTICE_CHANGED');
  PERFORM pg_temp.ctx_set('old_point_changed', v_r::text);
  v_r := public.record_point_charge_checkout_ack(v_user, gen_random_uuid(), v_plan.id, v_plan.price + 1, v_plan.credits, repeat('0', 64));
  PERFORM pg_temp.ensure(v_r ->> 'code' = 'PLAN_CHANGED', 'R0', '옛 충전 함수 PLAN_CHANGED');
  PERFORM pg_temp.ctx_set('old_point_plan_changed', v_r::text);
  PERFORM pg_temp.ctx_set('market_v1_sha', (pg_temp.ctx('old_market_changed')::jsonb) #>> '{details,noticeSha256}');
  PERFORM pg_temp.ctx_set('point_v1_sha', (pg_temp.ctx('old_point_changed')::jsonb) #>> '{details,noticeSha256}');
  INSERT INTO _rh_log (test, msg) VALUES ('R0', '옛 함수 거절 응답 담음(기록 없음)');
END
$rh_capture$;
`

const DOWN_BEFORE = isolatedCase('rh_r6_down_before', 'R6', `
    v_r := pg_temp.try_sql(pg_temp.ctx('src_down'));
    v_log := v_log || pg_temp.expect(v_r, 'ERR DOWN PRECHECK', 'R6', '11번 전 상태에서 down 사전 검사 멈춤');`)

const R8_BEFORE = (copy) => isolatedCase('rh_r8_bundle9', 'R8', `
    EXECUTE pg_temp.ctx('src_bundle9_point');
    v_log := v_log || pg_temp.ensure(pg_temp.md5_of('public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)') = '0047854ac79ddae6fba6dde114fb575d',
      'R8', '충전 함수를 10번 전 정의(0047854a…)로 바꿈');
    v_r := pg_temp.try_sql(${dollar('rh_r8_copy', copy)});
    v_log := v_log || pg_temp.expect(v_r, 'ERR PRECHECK: public.record_point_charge_checkout_ack', 'R8', '10번 전 충전 함수면 11번 사전 검사 멈춤');`)

// ── 경우 묶음(모드 공통) ──────────────────────────────────────────────────────────────────────────────────
function caseUnchanged() {
  return isolatedCase('rh_r7_same', 'R7', `
    v_log := v_log || pg_temp.ensure(to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)') IS NULL
      AND to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text,text)') IS NOT NULL, 'R7', '3인자 없음·4인자만');
    FOR v_j IN SELECT to_jsonb(x) FROM (VALUES
      ('public.record_purchase_notice_ack(uuid,uuid,text,text)', '{postgres=X/postgres,service_role=X/postgres}'),
      ('public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)', '{postgres=X/postgres,service_role=X/postgres}'),
      ('public.build_checkout_consent_v2(text,jsonb,integer)', '{postgres=X/postgres}'),
      ('public.build_market_cart_texts(jsonb)', '{postgres=X/postgres}')) x(sig, acl) LOOP
      v_log := v_log || pg_temp.ensure((SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v_j ->> 'sig')) = v_j ->> 'acl'
        AND NOT has_function_privilege('anon', v_j ->> 'sig', 'EXECUTE') AND NOT has_function_privilege('authenticated', v_j ->> 'sig', 'EXECUTE'),
        'R7', 'ACL ' || (v_j ->> 'sig'));
    END LOOP;
    -- 그대로여야 할 함수(생성기가 마이그레이션 사전 검사 v_same 14개 + record_admin_audit 를 그대로 옮김)
    FOR v_j IN SELECT to_jsonb(x) FROM (VALUES
      ${unchangedFunctions().map(([sig, md5]) => `(${sqlString(sig)}, ${sqlString(md5)})`).join(',\n      ')}) x(sig, md5) LOOP
      v_log := v_log || pg_temp.ensure(pg_temp.md5_of(v_j ->> 'sig') = v_j ->> 'md5', 'R7', '그대로 ' || (v_j ->> 'sig'));
    END LOOP;`)
}

function caseExamples() {
  const examples = JSON.parse(read(SOURCES.examples))
  return isolatedCase('rh_fx_examples', 'FX', `
    -- 예시 묶음(tests/fixtures/bundle11-consent-examples.json, TS 단위 시험과 같은 파일): 받음·거절·지문이 TS 와 같다.
    DECLARE
      f jsonb := ${sqlString(JSON.stringify(examples))}::jsonb;
      c jsonb;
      v jsonb;
      k text;
      r jsonb;
      v_ok integer := 0;
    BEGIN
      v_log := v_log || pg_temp.ensure(public.build_checkout_consent_v2('point_charge', f -> 'bases' -> 'point_charge', 7) IS NOT NULL,
        'FX', '약관 문서 두 개가 보이고 사본이 있음(아니면 예시 대조 불가)');
      FOR c IN SELECT x FROM jsonb_array_elements(f -> 'cases') x LOOP
        v := (f -> 'bases' -> (c ->> 'kind')) || (c -> 'patch');
        FOR k IN SELECT jsonb_array_elements_text(c -> 'remove') LOOP
          v := v - k;
        END LOOP;
        r := public.build_checkout_consent_v2(c ->> 'kind', v, (f -> 'refundDays' ->> (c ->> 'kind'))::integer);
        IF (r IS NOT NULL) IS DISTINCT FROM (c -> 'ok')::boolean
           OR (r IS NOT NULL AND (r #>> '{details,noticeSha256}' IS DISTINCT FROM c ->> 'noticeSha256' OR pg_temp.sha(r ->> 'text') <> c ->> 'noticeSha256')) THEN
          PERFORM pg_temp.fail('FX', (c ->> 'name') || ' 기대 ' || (c ->> 'ok') || ', 실제 ' || left(coalesce(r #>> '{details,noticeSha256}', 'NULL'), 70));
        END IF;
        v_ok := v_ok + 1;
      END LOOP;
      FOR c IN SELECT x FROM jsonb_array_elements(f -> 'cartCases') x LOOP
        r := public.build_market_cart_texts(c -> 'value');
        IF (r IS NOT NULL) IS DISTINCT FROM (c -> 'ok')::boolean OR (r IS NOT NULL AND r ->> 'cartTextsSha256' IS DISTINCT FROM c ->> 'cartTextsSha256') THEN
          PERFORM pg_temp.fail('FX', '장바구니 문구 ' || (c ->> 'name'));
        END IF;
        v_ok := v_ok + 1;
      END LOOP;
      v_log := v_log || ('예시 ' || v_ok || '건 TS 와 같음');
    END;`)
}

function casesRecords(mode) {
  const n = names(mode)
  const examples = JSON.parse(read(SOURCES.examples))
  const keysA = `
    v_r := pg_temp.try_sql(pg_temp.script_sql('keys'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', TEST, '스크립트 A');`
  const formatB = `
    v_r := pg_temp.try_sql(pg_temp.script_sql('format2'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', TEST, '스크립트 B');`
  const declare = `  v_user uuid := pg_temp.rh_user();
  v_plan public.pricing_plans := pg_temp.rh_plan();
  v_key uuid;
  v_key2 uuid;
  v_m jsonb;
  v_p jsonb;
  v_cart jsonb;
  v_row record;
  v_sha text;
  v_footer jsonb := pg_temp.policy('site_footer_content');
`
  const t = (tag, test, body) => isolatedCase(tag, test, body.replaceAll('TEST', sqlString(test)), declare)
  return [
    // R0: 마이그레이션만(정책에 consentFormat 없음)
    t('rh_r0', 'R0', `
    v_key := gen_random_uuid();
    v_j := ${n.recM}(p_user_id => v_user, p_idempotency_key => v_key, p_notice_sha256 => pg_temp.ctx('market_v1_sha'));
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND (v_j -> 'replay') = 'false'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb, TEST, '옛 호출(이름 인자 3개) 1판 기록 성공 → ' || v_j::text);
    SELECT * INTO v_row FROM ${n.tM} a WHERE a.user_id = v_user AND a.idempotency_key = v_key;
    v_log := v_log || pg_temp.ensure(v_row.consent_format = 1 AND v_row.refund_policy_sha256 IS NULL AND v_row.terms_policy_sha256 IS NULL
      AND v_row.consent_details = '{"cartTexts": null}'::jsonb AND v_row.notice_sha256 = pg_temp.ctx('market_v1_sha'), TEST, '자료 새 칸 기본값·cartTexts null');
    v_j := ${n.recM}(p_user_id => v_user, p_idempotency_key => v_key, p_notice_sha256 => pg_temp.ctx('market_v1_sha'));
    v_log := v_log || pg_temp.ensure((v_j -> 'replay') = 'true'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb, TEST, '옛 호출 같은 키 다시 → replay');
    v_j := ${n.recM}(v_user, gen_random_uuid(), repeat('0', 64));
    v_log := v_log || pg_temp.ensure((v_j -> 'details') - 'consentFormat' = (pg_temp.ctx('old_market_changed')::jsonb) -> 'details'
      AND (v_j #> '{details,consentFormat}') = '1'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb AND v_j ? 'cartTexts', TEST, '자료 NOTICE_CHANGED 1판 details = 10번 + consentFormat 1');
    v_key := gen_random_uuid();
    v_j := ${n.recP}(v_user, v_key, v_plan.id, v_plan.price, v_plan.credits, pg_temp.ctx('point_v1_sha'));
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb, TEST, '충전 6인자 1판 기록 성공');
    SELECT * INTO v_row FROM ${n.tP} a WHERE a.user_id = v_user AND a.checkout_attempt_id = v_key;
    v_log := v_log || pg_temp.ensure(v_row.consent_format = 1 AND v_row.terms_policy_sha256 IS NULL AND v_row.consent_details IS NULL
      AND v_row.refund_policy_sha256 = (SELECT s.content_sha256 FROM public.policy_document_snapshots s WHERE s.doc_key = 'refundPolicy' ORDER BY s.seq DESC LIMIT 1),
      TEST, '충전 새 칸 기본값·환불정책 지문 = 최신 사본');
    v_j := ${n.recP}(v_user, gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, repeat('0', 64));
    v_log := v_log || pg_temp.ensure((v_j -> 'details') - 'consentFormat' = (pg_temp.ctx('old_point_changed')::jsonb) -> 'details', TEST, '충전 NOTICE_CHANGED 1판 details = 10번 + consentFormat 1');
    v_j := ${n.recP}(v_user, gen_random_uuid(), v_plan.id, v_plan.price + 1, v_plan.credits, repeat('0', 64));
    v_log := v_log || pg_temp.ensure((v_j -> 'details') - 'consentFormat' = (pg_temp.ctx('old_point_plan_changed')::jsonb) -> 'details'
      AND v_j ->> 'code' = 'PLAN_CHANGED', TEST, '충전 PLAN_CHANGED 1판 details = 10번 + consentFormat 1');`),
    // R1: 스크립트 A 뒤(판 1)
    t('rh_r1', 'R1', keysA + `
    v_m := pg_temp.policy('market_purchase_policy');
    v_cart := public.build_market_cart_texts(v_m);
    v_log := v_log || pg_temp.ensure(public.build_checkout_consent_v2('market', v_m, (v_m ->> 'refundDays')::integer) IS NOT NULL
      AND public.build_checkout_consent_v2('point_charge', pg_temp.policy('point_charge_policy'), public.point_charge_refund_days()) IS NOT NULL
      AND v_cart IS NOT NULL, TEST, '판 1 인 채 2판 묶음 두 정책·장바구니 문구 NULL 아님');
    v_key := gen_random_uuid();
    v_j := ${n.recM}(v_user, v_key, pg_temp.ctx('market_v1_sha'));
    SELECT * INTO v_row FROM ${n.tM} a WHERE a.user_id = v_user AND a.idempotency_key = v_key;
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND v_row.consent_details = '{"cartTexts": null}'::jsonb, TEST, '옛 호출 → cartTexts null');
    v_key := gen_random_uuid();
    v_j := ${n.recM}(v_user, v_key, pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256');
    SELECT * INTO v_row FROM ${n.tM} a WHERE a.user_id = v_user AND a.idempotency_key = v_key;
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND v_row.consent_details -> 'cartTexts' = v_cart
      AND v_cart ->> 'cartTextsSha256' = ${sqlString(examples.cartCases.find((c) => c.name === '초안').cartTextsSha256)}, TEST, '맞는 장바구니 지문 → 전문 기록(지문 = TS 값)');
    v_key := gen_random_uuid();
    v_j := ${n.recM}(v_user, v_key, pg_temp.ctx('market_v1_sha'), repeat('a', 64));
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_CHANGED' AND v_j -> 'cartTexts' = v_cart
      AND NOT EXISTS (SELECT 1 FROM ${n.tM} a WHERE a.user_id = v_user AND a.idempotency_key = v_key), TEST, '틀린 장바구니 지문 → 기록 없음 + NOTICE_CHANGED + cartTexts');
    -- 관리자 저장 흉내(문구 수정·version +1): 판 1 그대로
    PERFORM pg_temp.set_policy('market_purchase_policy', v_m || jsonb_build_object('consentTitle', '주문 내용 확인 및 동의', 'version', (v_m ->> 'version')::integer + 1));
    v_j := ${n.recM}(v_user, gen_random_uuid(), pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb, TEST, '관리자 저장 흉내 뒤에도 1판');`),
    // R2: 스크립트 B 뒤(판 2)
    t('rh_r2', 'R2', keysA + formatB + `
    v_m := public.build_checkout_consent_v2('market', pg_temp.policy('market_purchase_policy'), (pg_temp.policy('market_purchase_policy') ->> 'refundDays')::integer);
    v_cart := public.build_market_cart_texts(pg_temp.policy('market_purchase_policy'));
    v_j := ${n.recM}(v_user, gen_random_uuid(), pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_CHANGED' AND (v_j -> 'consentFormat') = '2'::jsonb AND v_j -> 'details' = v_m -> 'details'
      AND NOT (v_j -> 'details' ? 'checkboxLabel') AND NOT (v_j -> 'details' ? 'confirmNotice'), TEST, '1판 지문 → NOTICE_CHANGED(2판 묶음, 1판 키 없음)');
    v_key := gen_random_uuid();
    v_j := ${n.recM}(v_user, v_key, v_m #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256');
    SELECT * INTO v_row FROM ${n.tM} a WHERE a.user_id = v_user AND a.idempotency_key = v_key;
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND v_row.consent_format = 2
      AND v_row.refund_policy_sha256 = (SELECT s.content_sha256 FROM public.policy_document_snapshots s WHERE s.doc_key = 'refundPolicy' ORDER BY s.seq DESC LIMIT 1)
      AND v_row.terms_policy_sha256 = (SELECT s.content_sha256 FROM public.policy_document_snapshots s WHERE s.doc_key = 'serviceTerms' ORDER BY s.seq DESC LIMIT 1)
      AND pg_temp.sha(pg_temp.consent_text(v_row.consent_details -> 'consent')) = v_row.notice_sha256
      AND pg_temp.consent_text(v_row.consent_details -> 'consent') = v_row.notice_text
      AND NOT (v_row.consent_details -> 'consent' ? 'noticeSha256') AND v_row.consent_details -> 'cartTexts' = v_cart, TEST, '자료 2판 기록: 판 2·문서 지문 둘·consent 로 다시 만든 원문 sha = notice_sha256');
    v_p := public.build_checkout_consent_v2('point_charge', pg_temp.policy('point_charge_policy'), public.point_charge_refund_days());
    v_key := gen_random_uuid();
    v_j := ${n.recP}(v_user, v_key, v_plan.id, v_plan.price, v_plan.credits, v_p #>> '{details,noticeSha256}');
    SELECT * INTO v_row FROM ${n.tP} a WHERE a.user_id = v_user AND a.checkout_attempt_id = v_key;
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND v_row.consent_format = 2 AND v_row.refund_days = public.point_charge_refund_days()
      AND v_row.terms_policy_sha256 IS NOT NULL AND v_row.refund_policy_sha256 IS NOT NULL
      AND pg_temp.sha(pg_temp.consent_text(v_row.consent_details -> 'consent')) = v_row.notice_sha256
      AND NOT (v_row.consent_details -> 'consent' ? 'plan'), TEST, '충전 2판 기록: refund_days·문서 지문·consent 원문 sha');
    v_j := ${n.recP}(v_user, gen_random_uuid(), v_plan.id, v_plan.price + 1, v_plan.credits, v_p #>> '{details,noticeSha256}');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'PLAN_CHANGED' AND (v_j #> '{details,consentFormat}') = '2'::jsonb
      AND (v_j #>> '{details,plan,price}')::integer = v_plan.price AND (v_j -> 'details') - 'plan' = v_p -> 'details', TEST, 'PLAN_CHANGED 는 2판 + plan');
    v_j := ${n.recP}(v_user, NULL, v_plan.id, v_plan.price, v_plan.credits, 'x');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_INPUT_INVALID' AND (v_j -> 'consentFormat') = 'null'::jsonb, TEST, '충전 NOTICE_INPUT_INVALID consentFormat null');
    v_j := ${n.recM}(v_user, gen_random_uuid(), 'x');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_INPUT_INVALID' AND (v_j -> 'consentFormat') = 'null'::jsonb, TEST, '자료 NOTICE_INPUT_INVALID consentFormat null');
    IF pg_temp.rh_withdrawn_user() IS NOT NULL THEN
      v_j := ${n.recP}(pg_temp.rh_withdrawn_user(), gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, v_p #>> '{details,noticeSha256}');
      v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'MEMBER_WITHDRAWN' AND (v_j -> 'consentFormat') = 'null'::jsonb, TEST, 'MEMBER_WITHDRAWN consentFormat null');
    ELSE
      v_log := v_log || '탈퇴 회원이 없어 MEMBER_WITHDRAWN 은 계약 시험(맨 앞 거절)으로 갈음'::text;
    END IF;
    -- 관리자 저장 흉내(판 2, 문구 수정·version +1): 판 2 그대로, 새 문구로 지문
    PERFORM pg_temp.set_policy('market_purchase_policy', pg_temp.policy('market_purchase_policy')
      || jsonb_build_object('consentTitle', '주문 내용 확인 및 구매 동의', 'version', (pg_temp.policy('market_purchase_policy') ->> 'version')::integer + 1));
    v_j := public.build_checkout_consent_v2('market', pg_temp.policy('market_purchase_policy'), (pg_temp.policy('market_purchase_policy') ->> 'refundDays')::integer);
    v_log := v_log || pg_temp.ensure(v_j #>> '{details,noticeSha256}' <> v_m #>> '{details,noticeSha256}'
      AND (${n.recM}(v_user, gen_random_uuid(), v_j #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256') -> 'consentFormat') = '2'::jsonb, TEST, '관리자 저장 흉내 뒤 판 2·새 지문으로 기록');`),
    // R3: replay·충돌
    t('rh_r3', 'R3', keysA + `
    v_cart := public.build_market_cart_texts(pg_temp.policy('market_purchase_policy'));
    v_key := gen_random_uuid();
    v_j := ${n.recM}(v_user, v_key, pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb, TEST, '1판 기록(키 K)');` + formatB + `
    v_j := ${n.recM}(v_user, v_key, pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure((v_j -> 'replay') = 'true'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb, TEST, '판 2 뒤 같은 키·같은 지문 → replay(consentFormat 1)');
    v_j := ${n.recM}(v_user, v_key, repeat('b', 64), v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_KEY_CONFLICT', TEST, '같은 키·다른 고지 지문 → NOTICE_KEY_CONFLICT');
    v_j := ${n.recM}(v_user, v_key, pg_temp.ctx('market_v1_sha'), repeat('c', 64));
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_KEY_CONFLICT', TEST, '같은 키·다른 장바구니 지문 → NOTICE_KEY_CONFLICT');
    v_j := ${n.recM}(v_user, v_key, pg_temp.ctx('market_v1_sha'));
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_KEY_CONFLICT', TEST, '같은 키·장바구니 지문 NULL(기록은 값 있음) → NOTICE_KEY_CONFLICT');
    -- ⑥ 경로: ② 를 건너뛰는 사본으로 겹친 같은 키를 흉내 낸다
    v_m := public.build_checkout_consent_v2('market', pg_temp.policy('market_purchase_policy'), (pg_temp.policy('market_purchase_policy') ->> 'refundDays')::integer);
    v_key2 := gen_random_uuid();
    v_j := ${n.recM}(v_user, v_key2, v_m #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND (v_j -> 'replay') = 'false'::jsonb, TEST, '2판 기록(키 K2)');
    v_j := pg_temp.rh_rec_m_step6(v_user, v_key2, v_m #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure((v_j -> 'replay') = 'true'::jsonb AND (v_j -> 'consentFormat') = '2'::jsonb, TEST, '⑥ 경로 같은 값 → replay');
    PERFORM pg_temp.set_policy('market_purchase_policy', pg_temp.policy('market_purchase_policy') || jsonb_build_object('cartCheckoutNotice', '바뀐 안내입니다.'));
    v_cart := public.build_market_cart_texts(pg_temp.policy('market_purchase_policy'));
    v_j := pg_temp.rh_rec_m_step6(v_user, v_key2, v_m #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_KEY_CONFLICT', TEST, '⑥ 경로 다른 장바구니 지문 → NOTICE_KEY_CONFLICT');`),
    // R4: 닫힘(사본 없음은 c_snapshot_closed.sql)
    t('rh_r4', 'R4', `
    IF EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'policy_upcoming_documents' AND value ->> 'status' = 'upcoming') THEN
      PERFORM pg_temp.fail(TEST, '게시 행이 upcoming 이라 링크 문서 경우는 이 파일로 못 돈다 — 새벽에 lock_policy_documents_during_notice 를 그 거래에서만 끄는 사본으로(3절)');
    END IF;` + keysA + formatB + `
    v_cart := public.build_market_cart_texts(pg_temp.policy('market_purchase_policy'));
    v_m := pg_temp.policy('market_purchase_policy');
    -- 2판 키 깨짐 → 결제만 닫힘, 환불 판정 함수는 새 키를 읽지 않음
    PERFORM pg_temp.set_policy('market_purchase_policy', v_m || jsonb_build_object('consentTitle', repeat('가', 27)));
    v_j := ${n.recM}(v_user, gen_random_uuid(), repeat('0', 64), v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_POLICY_UNAVAILABLE' AND (v_j -> 'consentFormat') = '2'::jsonb
      AND public.market_purchase_refund_days() = (v_m ->> 'refundDays')::integer, TEST, '2판 키 깨짐 → NOTICE_POLICY_UNAVAILABLE, 환불 기간 판정 그대로');
    PERFORM pg_temp.set_policy('market_purchase_policy', v_m);
    v_p := pg_temp.policy('point_charge_policy');
    PERFORM pg_temp.set_policy('point_charge_policy', v_p - 'consentItems');
    v_j := ${n.recP}(v_user, gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, repeat('0', 64));
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_POLICY_UNAVAILABLE' AND public.point_charge_refund_days() = (v_p ->> 'refundDays')::integer,
      TEST, '충전 2판 키 깨짐 → 닫힘, 충전 환불 일수 그대로');
    PERFORM pg_temp.set_policy('point_charge_policy', v_p);
    -- 링크 문서 닫힘 세 가지(바닥글 원본을 거래 안에서만 바꿈)
    FOR v_j IN SELECT x FROM jsonb_array_elements('[{"path": "{policyDocuments,serviceTerms,enabled}", "value": false},
                                                    {"path": "{policyDocuments,refundPolicy,label}", "value": ""},
                                                    {"path": "{policyDocuments,serviceTerms,content}", "value": " "}]'::jsonb) x LOOP
      v_r := pg_temp.try_sql(format('UPDATE public.system_settings SET value = jsonb_set(value, %L::text[], %L::jsonb) WHERE key = %L',
        v_j ->> 'path', v_j -> 'value', 'site_footer_content'));
      v_log := v_log || pg_temp.expect(v_r, 'OK', TEST, '바닥글 ' || (v_j ->> 'path') || ' 바꿈');
      v_log := v_log || pg_temp.ensure(public.build_checkout_consent_v2('market', v_m, (v_m ->> 'refundDays')::integer) IS NULL
        AND (${n.recM}(v_user, gen_random_uuid(), repeat('0', 64), v_cart ->> 'cartTextsSha256') ->> 'code') = 'NOTICE_POLICY_UNAVAILABLE'
        AND (${n.recP}(v_user, gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, repeat('0', 64)) ->> 'code') = 'NOTICE_POLICY_UNAVAILABLE',
        TEST, '링크 문서 ' || (v_j ->> 'path') || ' → 2판 닫힘');
      -- 1판은 영향 없음(판을 1 로 바꾸면 기록됨)
      PERFORM pg_temp.set_policy('market_purchase_policy', v_m || '{"consentFormat": 1}'::jsonb);
      v_log := v_log || pg_temp.ensure((${n.recM}(v_user, gen_random_uuid(), pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256') -> 'ok') = 'true'::jsonb,
        TEST, '같은 상태에서 1판 기록은 됨');
      PERFORM pg_temp.set_policy('market_purchase_policy', v_m);
      PERFORM pg_temp.set_policy('site_footer_content', v_footer);
      v_log := v_log || pg_temp.ensure(pg_temp.policy('site_footer_content') = v_footer, TEST, '바닥글 원래 값으로');
    END LOOP;
    -- 링크 꺼진 채 스크립트 B 는 사전 검사로 멈춘다(판 1 로 돌린 뒤)
    PERFORM pg_temp.set_policy('market_purchase_policy', v_m || '{"consentFormat": 1}'::jsonb);
    PERFORM pg_temp.set_policy('point_charge_policy', v_p || '{"consentFormat": 1}'::jsonb);
    PERFORM pg_temp.try_sql($u$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,serviceTerms,enabled}', 'false') WHERE key = 'site_footer_content'$u$);
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format2')), 'ERR B11_FORMAT_2: consent v2 builder returned NULL', TEST, '링크 꺼짐 → 스크립트 B 멈춤');`),
    // R5: 되돌림
    t('rh_r5', 'R5', keysA + formatB + `
    v_cart := public.build_market_cart_texts(pg_temp.policy('market_purchase_policy'));
    PERFORM pg_temp.set_policy('market_purchase_policy', pg_temp.policy('market_purchase_policy') || jsonb_build_object('consentTitle', repeat('가', 27)));
    PERFORM pg_temp.try_sql($u$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,refundPolicy,enabled}', 'false') WHERE key = 'site_footer_content'$u$);
    v_log := v_log || pg_temp.ensure((${n.recM}(v_user, gen_random_uuid(), pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256') ->> 'code') = 'NOTICE_POLICY_UNAVAILABLE',
      TEST, '2판 키 깨짐 + 링크 꺼짐 → 닫힘');
    v_r := pg_temp.try_sql(pg_temp.script_sql('format1'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', TEST, '되돌림 스크립트(2판이 닫힌 상태에서도 돎)');
    v_j := ${n.recM}(v_user, gen_random_uuid(), pg_temp.ctx('market_v1_sha'), v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb, TEST, '되돌린 뒤 자료 1판 기록 성공');
    v_j := ${n.recP}(v_user, gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, pg_temp.ctx('point_v1_sha'));
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND (v_j -> 'consentFormat') = '1'::jsonb, TEST, '되돌린 뒤 충전 1판 기록 성공');`),
    // R9: 스크립트 거절
    t('rh_r9', 'R9', `
    v_m := pg_temp.policy('market_purchase_policy');
    v_p := pg_temp.policy('point_charge_policy');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('keys', NULL)), 'ERR B11_KEYS: set c_mode', TEST, 'A c_mode 없음 → 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('keys', 'apply', 'x')), 'ERR B11_KEYS: policy md5 differs', TEST, 'A 정책 md5 불일치 → 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format1')), 'ERR B11_FORMAT_1: consentFormat must be 2', TEST, '판 키 없음(판 1)에서 되돌림 → 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format2')), 'ERR B11_FORMAT_2: consentFormat must be 1', TEST, 'A 전 B → 멈춤');
    v_log := v_log || pg_temp.ensure(pg_temp.policy('market_purchase_policy') = v_m AND pg_temp.policy('point_charge_policy') = v_p, TEST, '멈춘 뒤 값 그대로');` + keysA + `
    v_m := pg_temp.policy('market_purchase_policy');
    v_p := pg_temp.policy('point_charge_policy');
    v_log := v_log || pg_temp.ensure((v_m -> 'consentFormat') = '1'::jsonb AND (v_m ->> 'version')::integer = 2 AND (v_p ->> 'version')::integer = 2
      AND (SELECT count(*) FROM public.admin_audit_log WHERE action = 'checkout_consent_keys_seed' AND details ->> 'bundle' = 'bundle11_consent_keys'
           AND details -> 'before' IS NOT NULL AND details -> 'after' = (CASE WHEN target_id = 'market_purchase_policy' THEN v_m ELSE v_p END)) >= 2, TEST, 'A: 판 1·version +1·작업 기록 before/after 전체');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('keys')), 'ERR B11_KEYS: consentFormat already present', TEST, 'A 재실행 → 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format1')), 'ERR B11_FORMAT_1: consentFormat must be 2', TEST, '판 1 에서 되돌림 → 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format2', 'apply', 'x')), 'ERR B11_FORMAT_2: policy md5 differs', TEST, 'B 정책 md5 불일치 → 멈춤');` + formatB + `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format2')), 'ERR B11_FORMAT_2: consentFormat must be 1', TEST, 'B 재실행 → 멈춤');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format1', 'apply', 'x')), 'ERR B11_FORMAT_1: policy md5 differs', TEST, '되돌림 정책 md5 불일치 → 멈춤');
    v_log := v_log || pg_temp.ensure((pg_temp.policy('market_purchase_policy') -> 'consentFormat') = '2'::jsonb
      AND (pg_temp.policy('market_purchase_policy') ->> 'version')::integer = 3, TEST, '멈춘 뒤 값 그대로(판 2·version 3)');`),
    // R10: 판 1 에서 2판 지문(개발 스위치 화면이 보낼 값)
    t('rh_r10', 'R10', keysA + `
    v_m := public.build_checkout_consent_v2('market', pg_temp.policy('market_purchase_policy'), (pg_temp.policy('market_purchase_policy') ->> 'refundDays')::integer);
    v_cart := public.build_market_cart_texts(pg_temp.policy('market_purchase_policy'));
    v_key := gen_random_uuid();
    v_j := ${n.recM}(v_user, v_key, v_m #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_CHANGED' AND (v_j #> '{details,consentFormat}') = '1'::jsonb
      AND NOT EXISTS (SELECT 1 FROM ${n.tM} a WHERE a.user_id = v_user AND a.idempotency_key = v_key), TEST, '판 1 + 2판 지문(자료) → NOTICE_CHANGED·기록 없음');
    v_p := public.build_checkout_consent_v2('point_charge', pg_temp.policy('point_charge_policy'), public.point_charge_refund_days());
    v_key2 := gen_random_uuid();
    v_j := ${n.recP}(v_user, v_key2, v_plan.id, v_plan.price, v_plan.credits, v_p #>> '{details,noticeSha256}');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_CHANGED'
      AND NOT EXISTS (SELECT 1 FROM ${n.tP} a WHERE a.user_id = v_user AND a.checkout_attempt_id = v_key2), TEST, '판 1 + 2판 지문(충전) → NOTICE_CHANGED·기록 없음');
    -- 두 번째 클릭(409 의 1판 details 로 만든 1판 지문): DB 만으로는 기록된다 → 막는 것은 스위치가 켜진 감싸개(11-1 단위 시험)
    v_j := ${n.recM}(v_user, gen_random_uuid(), (${n.recM}(v_user, gen_random_uuid(), v_m #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256')) #>> '{details,noticeSha256}', v_cart ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb, TEST, '두 번째 클릭(1판 지문)은 DB 만으로 기록됨 — 감싸개가 RPC 전에 막아야 함');`),
    // 판 값 읽기(4-1): TS 와 같은 판정(예시 묶음 formatCases)
    t('rh_fx_format', 'FX', keysA + `
    DECLARE
      f jsonb := ${sqlString(JSON.stringify(examples.formatCases))}::jsonb;
      c jsonb;
    BEGIN
      v_m := pg_temp.policy('market_purchase_policy') - 'consentFormat';
      FOR c IN SELECT x FROM jsonb_array_elements(f) x LOOP
        PERFORM pg_temp.set_policy('market_purchase_policy', v_m || (c ->> 'raw')::jsonb);
        v_j := ${n.recM}(v_user, gen_random_uuid(), repeat('0', 64));
        IF (v_j -> 'consentFormat') IS DISTINCT FROM coalesce(c -> 'format', 'null'::jsonb)
           OR (c -> 'format' = 'null'::jsonb AND v_j ->> 'code' <> 'NOTICE_POLICY_UNAVAILABLE') THEN
          PERFORM pg_temp.fail(TEST, '판 값 ' || (c ->> 'name') || ' → ' || v_j::text);
        END IF;
        v_log := v_log || ('판 값 ' || (c ->> 'name') || ' → ' || coalesce(v_j ->> 'consentFormat', 'null') || ' ' || (v_j ->> 'code'));
      END LOOP;
    END;`),
  ].join('')
}

// R6: down·다시 적용(모드 공통 — down 은 함수만 바꾼다). copy = 그 모드의 마이그레이션 사본
function caseDownReapply(copy) {
  return isolatedCase('rh_r6', 'R6', `
    v_r := pg_temp.try_sql(pg_temp.ctx('src_down'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R6', 'down 실행');
    v_log := v_log || pg_temp.ensure(to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)') IS NOT NULL
      AND to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text,text)') IS NULL
      AND to_regprocedure('public.build_checkout_consent_v2(text,jsonb,integer)') IS NULL
      AND pg_temp.md5_of('public.record_purchase_notice_ack(uuid,uuid,text)') = 'fa6a7edd836f21422d52dd184afb079b'
      AND pg_temp.md5_of('public.record_point_charge_checkout_ack(uuid,uuid,uuid,integer,integer,text)') = 'be4403fd993c45d618950a5908a91591',
      'R6', 'down 뒤 3인자만·md5 바탕 값·내부 함수 없음');
    v_j := public.record_point_charge_checkout_ack(NULL, NULL, NULL, NULL, NULL, 'x');
    v_log := v_log || pg_temp.ensure(NOT (v_j ? 'consentFormat'), 'R6', 'down 뒤 충전 응답에 consentFormat 없음');
    v_j := public.record_purchase_notice_ack(pg_temp.rh_user(), gen_random_uuid(), repeat('e', 64));
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_CHANGED' AND (v_j -> 'details') = (pg_temp.ctx('old_market_changed')::jsonb) -> 'details',
      'R6', '옛 함수는 2판(다른) 지문을 1판 details 로 거절');
    v_r := pg_temp.try_sql(pg_temp.ctx('src_down'));
    v_log := v_log || pg_temp.expect(v_r, 'ERR DOWN PRECHECK', 'R6', 'down 두 번 → 사전 검사 멈춤');
    v_r := pg_temp.try_sql(pg_temp.ctx('src_down_b_precheck'));
    v_log := v_log || pg_temp.ensure(v_r NOT LIKE '%record_point_charge_checkout_ack%', 'R8', '11번 down 뒤 10번 down_b 사전 검사는 충전 함수 검사를 지남 → ' || left(v_r, 120));
    v_r := pg_temp.try_sql(${dollar('rh_r6_copy', copy)});
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R6', 'down 뒤 다시 적용');
    v_r := pg_temp.try_sql(${dollar('rh_r6_copy2', copy)});
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R6', 'down 없이 같은 파일 다시 실행');
    v_log := v_log || pg_temp.ensure(pg_temp.md5_of('public.record_purchase_notice_ack(uuid,uuid,text,text)') = '9d2cb23a7aa16e45970525248bcc4435'
      AND to_regprocedure('public.record_purchase_notice_ack(uuid,uuid,text)') IS NULL, 'R6', '다시 적용 뒤 4인자만·11번 md5');`)
}

// R6 (판 2 + down): 10절 되돌리기의 위험한 순서 — 2판인 채 down 하면 옛 함수는 2판 지문을 1판 details 로 거절하고(모드 공통),
// 판을 보지 않아 1판 지문으로는 기록한다(결제가 됨). 기록되는 두 줄은 실제 기록 표에 INSERT 하므로 full(새벽)에서만 본다 —
// light 는 실제 표에 쓰지 않는다(옛 함수는 pg_temp 사본이 없고 실제 표에 쓴다).
function caseFormat2Down(mode) {
  const recordLines = mode === 'full' ? `
    v_j := public.record_purchase_notice_ack(v_user, gen_random_uuid(), pg_temp.ctx('market_v1_sha'));
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb AND NOT (v_j ? 'consentFormat'), 'R6', 'down·판 2: 옛 자료 함수는 판을 보지 않고 1판 지문으로 기록');
    v_j := public.record_point_charge_checkout_ack(v_user, gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, pg_temp.ctx('point_v1_sha'));
    v_log := v_log || pg_temp.ensure((v_j -> 'ok') = 'true'::jsonb, 'R6', 'down·판 2: 옛 충전 함수는 1판 지문으로 기록');` : `
    v_log := v_log || 'down·판 2 의 옛 함수 1판 기록(실제 표 INSERT)은 b_full 에서 본다'::text;`
  return isolatedCase('rh_r6_format2_down', 'R6', `
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('keys')), 'OK', 'R6', '스크립트 A');
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.script_sql('format2')), 'OK', 'R6', '스크립트 B(판 2)');
    v_p := public.build_checkout_consent_v2('point_charge', pg_temp.policy('point_charge_policy'), public.point_charge_refund_days());
    v_m := public.build_checkout_consent_v2('market', pg_temp.policy('market_purchase_policy'), (pg_temp.policy('market_purchase_policy') ->> 'refundDays')::integer);
    v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.ctx('src_down')), 'OK', 'R6', '판 2 인 채 down');
    v_j := public.record_purchase_notice_ack(v_user, gen_random_uuid(), v_m #>> '{details,noticeSha256}');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_CHANGED' AND v_j -> 'details' = (pg_temp.ctx('old_market_changed')::jsonb) -> 'details',
      'R6', 'down·판 2: 옛 자료 함수는 2판 지문을 1판 details 로 거절');
    v_j := public.record_point_charge_checkout_ack(v_user, gen_random_uuid(), v_plan.id, v_plan.price, v_plan.credits, v_p #>> '{details,noticeSha256}');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_CHANGED' AND NOT (v_j -> 'details' ? 'consentFormat')
      AND v_j #>> '{details,noticeSha256}' = pg_temp.ctx('point_v1_sha'), 'R6', 'down·판 2: 옛 충전 함수는 2판 지문을 1판 details 로 거절');${recordLines}`,
  `  v_user uuid := pg_temp.rh_user();
  v_plan public.pricing_plans := pg_temp.rh_plan();
  v_m jsonb;
  v_p jsonb;
`)
}

const CASE_R8_AFTER = isolatedCase('rh_r8_down_b', 'R8', `
    v_r := pg_temp.try_sql(pg_temp.ctx('src_down_b_precheck'));
    v_log := v_log || pg_temp.expect(v_r, 'ERR DOWN_B_BLOCKED: public.record_point_charge_checkout_ack', 'R8', '11번 적용 상태에서 10번 down_b 사전 검사 멈춤');`)

export function buildRehearsalFiles() {
  const files = {}
  const light = migrationCopy('light')
  const full = migrationCopy('full')

  files['a_light.sql'] = prelude({
    title: 'A light — 마이그레이션 사본(표 잠금 DDL 뺌)·스크립트 A·B·되돌림·down·다시 적용, 기록 함수는 같은 본문의 pg_temp 사본 + 임시 표(R0~R10)',
    when: '지금 돌려도 됨(CREATE/DROP FUNCTION·설정 행 잠금·임시 표뿐 — LOCK/ALTER TABLE·TRIGGER·POLICY 없음). 실제 표 칸·잠금은 새벽의 b_full 이 본다.',
    mode: 'light',
  })
    + CAPTURE_BASE + DOWN_BEFORE + R8_BEFORE(light)
    + `\n-- ===== 11번 마이그레이션 사본(light: LOCK TABLE·ALTER TABLE·CHECK·COMMENT·칸 VERIFY 뺌) =====\n${light}\n`
    + lightTables()
    + caseUnchanged() + caseExamples() + casesRecords('light') + caseDownReapply(light) + caseFormat2Down('light') + CASE_R8_AFTER + FOOT

  files['b_full.sql'] = prelude({
    title: 'B full — 실제 마이그레이션(칸 추가·CHECK)과 실제 기록 표에 쓰는 R0~R10',
    when: '새벽 03~04시만. 두 기록 표 ACCESS EXCLUSIVE(거래 끝까지 읽기도 막음, lock_timeout 3초). 게시·시행·다른 묶음 DB 단계와 다른 날.',
    mode: 'full',
  })
    + CAPTURE_BASE + DOWN_BEFORE + R8_BEFORE(full)
    + `\n-- ===== 11번 마이그레이션(원본 그대로) =====\n${full}\n`
    + fullStep6()
    + caseUnchanged() + caseExamples() + casesRecords('full') + caseDownReapply(full) + caseFormat2Down('full') + CASE_R8_AFTER + FOOT

  files['c_snapshot_closed.sql'] = prelude({
    title: 'C — R4 사본 없음: 정책 문서 사본이 없으면 2판은 NULL 로 두지 않고 닫힌다(실제 마이그레이션)',
    when: '새벽 03~04시만. policy_document_snapshots 의 가드 트리거를 이 거래 안에서만 끈다(ALTER TABLE — 표 잠금). 롤백 뒤 트리거가 켜져 있는지 읽기 조회로 본다.',
    mode: 'full',
  })
    + CAPTURE_BASE
    + `\n-- ===== 11번 마이그레이션(원본 그대로) =====\n${full}\n`
    + isolatedCase('rh_r4_snapshot', 'R4', `
    v_r := pg_temp.try_sql(pg_temp.script_sql('keys'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4', '스크립트 A');
    v_r := pg_temp.try_sql(pg_temp.script_sql('format2'));
    v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4', '스크립트 B');
    ALTER TABLE public.policy_document_snapshots DISABLE TRIGGER prevent_policy_document_snapshot_mutation;
    DELETE FROM public.policy_document_snapshots WHERE doc_key = 'serviceTerms';
    ALTER TABLE public.policy_document_snapshots ENABLE TRIGGER prevent_policy_document_snapshot_mutation;
    v_log := v_log || pg_temp.ensure(public.build_checkout_consent_v2('market', pg_temp.policy('market_purchase_policy'),
      (pg_temp.policy('market_purchase_policy') ->> 'refundDays')::integer) IS NULL, 'R4', '이용약관 사본 없음 → 2판 묶음 NULL');
    v_j := public.record_purchase_notice_ack(pg_temp.rh_user(), gen_random_uuid(), repeat('0', 64),
      public.build_market_cart_texts(pg_temp.policy('market_purchase_policy')) ->> 'cartTextsSha256');
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_POLICY_UNAVAILABLE' AND (v_j -> 'consentFormat') = '2'::jsonb, 'R4', '사본 없음 → 자료 기록 닫힘');
    v_j := public.record_point_charge_checkout_ack(pg_temp.rh_user(), gen_random_uuid(), (pg_temp.rh_plan()).id, (pg_temp.rh_plan()).price,
      (pg_temp.rh_plan()).credits, repeat('0', 64));
    v_log := v_log || pg_temp.ensure(v_j ->> 'code' = 'NOTICE_POLICY_UNAVAILABLE', 'R4', '사본 없음 → 충전 기록 닫힘');`)
    + FOOT

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
