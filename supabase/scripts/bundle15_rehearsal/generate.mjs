// 15번 묶음 리허설 생성기(계획 docs/plan-bundle15-notice-popup.md 11-2 원칙 5: 사본은 생성기로 만들고 원본과 다른 줄은 계약 시험으로 고정).
// 원본(마이그레이션·10번 약관 스크립트·4-6 작은 스크립트·되돌리기 파일·예시 묶음)을 읽어 리허설 SQL 파일을 만든다.
//   node supabase/scripts/bundle15_rehearsal/generate.mjs        → 이 폴더의 *.sql 을 다시 쓴다
//   node supabase/scripts/bundle15_rehearsal/generate.mjs --check → 다시 만든 값과 파일이 다르면 실패(원본을 고친 뒤 다시 만들었는지)
// 실행(운영 DB, postgres): supabase db query --remote --yes --file supabase/scripts/bundle15_rehearsal/<파일>
//   모든 파일은 BEGIN … 마지막 SELECT … ROLLBACK 이다(COMMIT 없음). 결과는 ON COMMIT DROP 임시 표 _rh_log 로 받는다.
//   지금(낮) 돌려도 되는 파일: e_withdraw_text, b_cases_light, c_preview_light (표 잠금 DDL 없음 — 행 잠금·함수 생성·advisory 잠금뿐)
//   새벽에만 돌릴 파일: a_ddl(CREATE/DROP POLICY·DROP TRIGGER — 읽기도 막음), b_cases·c_preview(CREATE TRIGGER — 쓰기를 막음)
//   15번 마이그레이션이 운영에 적용된 뒤(2026-11-26~)에는 a·b·c 는 사본 마이그레이션이 사전 점검에서 멈춘다. 그 뒤 지문·미리보기는
//   d_preview_after_apply(사본 없음, 실제 함수·트리거·정책으로 게시 → 지문·payload → ROLLBACK, 표 잠금 DDL 없음)로 뽑는다.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')

export const SOURCES = {
  migration: 'supabase/migrations/20261205100000_site_notice_popup.sql',
  down: 'supabase/rollback/20261205100000_site_notice_popup_down.sql',
  policyText: 'supabase/scripts/20261126_bundle10_policy_text.sql',
  withdrawText: 'supabase/scripts/20261205_bundle15_withdraw_disabled_text.sql',
  recordExamples: 'tests/fixtures/bundle15-notice-record-examples.json',
  inputExamples: 'tests/fixtures/bundle15-notice-input-examples.json',
}

// ── 사본이 원본과 다른 곳(이 목록 밖은 원본 그대로) ─────────────────────────────────────────────────────────────
// 마이그레이션 사본: 'nopolicy' 는 CREATE POLICY 2개(문장 1개 + 없을 때만 만드는 DO 블록 1개)와 정책 VERIFY 블록 1개를 뺀다(계획 4절 머리).
//                   'light' 는 거기에 CREATE TRIGGER 3개를 빼고, VERIFY 의 트리거 개수 기대값을 3 → 0 으로 바꾼다(지금 돌릴 수 있는 사본).
export const MIGRATION_POLICY_STATEMENTS = [
  /\nCREATE POLICY system_settings_site_notice_popup_no_client_write\n[\s\S]*?;\n/,
  /\nDO \$create_policy_upcoming_documents_policy\$\n[\s\S]*?\n\$create_policy_upcoming_documents_policy\$;\n/,
  /\nDO \$verify_site_notice_popup_policies\$\n[\s\S]*?\n\$verify_site_notice_popup_policies\$;\n/,
]
export const MIGRATION_TRIGGER_STATEMENTS = [
  /\nCREATE TRIGGER lock_policy_documents_during_notice\n[\s\S]*?;\n/,
  /\nCREATE TRIGGER lock_consent_items_during_notice\n[\s\S]*?;\n/,
  /\nCREATE TRIGGER lock_withdrawal_texts_during_notice\n[\s\S]*?;\n/,
]
export const MIGRATION_LIGHT_VERIFY = [
  ") <> 3 THEN\n    RAISE EXCEPTION 'VERIFY: notice lock triggers';",
  ") <> 0 THEN\n    RAISE EXCEPTION 'VERIFY: notice lock triggers';",
]

// 10번 약관 스크립트 사본: 이 줄들만 리허설 함수 pg_temp.pt_sql 이 실행 때 바꾼다(각 줄은 원본에 정확히 1번 있어야 함).
export const POLICY_TEXT_LINES = {
  mode: "  c_mode constant text := NULL;",
  effective: "  c_effective_date constant date := DATE '2027-01-11';",
  deadline: "  c_notice_deadline constant date := DATE '2026-12-10';",
  applyLast: "  c_apply_last_date constant date := DATE '2027-01-11';",
  republish: "  c_republish_reason constant text := NULL;",
  withdraw: "  c_withdraw_reason constant text := NULL;",
  confirmedCount: "  c_confirmed_count constant integer := NULL;",
  confirmedMd5: "  c_confirmed_members_md5 constant text := NULL;",
  // 상수 검사(리허설 날을 시행일로 두는 R4 (가)만 끈다)
  constCheck: "  IF NOT (c_notice_deadline <= c_effective_date - 32) OR NOT (c_apply_last_date >= c_effective_date) THEN",
  // 15번 마이그레이션 확인: 정책 사본(b·c)은 정책 검사 한 줄, light 사본은 트리거 개수 검사 한 줄도 건너뛴다
  policyCheck: "  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings' AND permissive = 'RESTRICTIVE' AND policyname IN ('system_settings_site_notice_popup_no_client_write', 'system_settings_policy_upcoming_documents_no_client_write')) <> 2 THEN",
  triggerCheck: "              OR (t.tgrelid = 'public.signup_consent_items'::regclass AND t.tgname = 'lock_consent_items_during_notice'))) <> 3 THEN",
}
export const WITHDRAW_TEXT_LINES = {
  mode: "  c_mode constant text := NULL;",
  effective: "  c_effective_date constant date := DATE '2027-01-11';",
}

function extractDoBlock(source, tag, label) {
  const re = new RegExp(`\\nDO \\$${tag}\\$\\n[\\s\\S]*?\\n\\$${tag}\\$;\\n`)
  const match = source.match(re)
  if (!match) throw new Error(`${label}: DO $${tag}$ block not found`)
  return match[0].slice(1, -1)
}

// 10번 스크립트 머리 주석의 되돌리기 블록(DO $revert$ … $revert$;)을 주석을 벗겨 꺼낸다.
export function extractRevertBlock(source) {
  const lines = source.split('\n')
  const start = lines.indexOf('--   DO $revert$')
  const end = lines.indexOf('--   $revert$;')
  if (start < 0 || end < start) throw new Error('policy text: revert block not found')
  return lines.slice(start, end + 1).map((line) => {
    if (!line.startsWith('--   ')) throw new Error(`policy text: revert line without prefix: ${line}`)
    return line.slice(5)
  }).join('\n')
}

export function migrationCopy(kind) {
  let sql = read(SOURCES.migration)
  if (kind === 'full') return sql
  for (const re of MIGRATION_POLICY_STATEMENTS) {
    if (!re.test(sql)) throw new Error(`migration copy: ${re} not found`)
    sql = sql.replace(re, '\n')
  }
  if (kind === 'nopolicy') return sql
  if (kind !== 'light') throw new Error(`unknown migration copy ${kind}`)
  for (const re of MIGRATION_TRIGGER_STATEMENTS) {
    if (!re.test(sql)) throw new Error(`migration copy: ${re} not found`)
    sql = sql.replace(re, '\n')
  }
  if (sql.split(MIGRATION_LIGHT_VERIFY[0]).length !== 2) throw new Error('migration copy: trigger verify line not found once')
  return sql.replace(MIGRATION_LIGHT_VERIFY[0], MIGRATION_LIGHT_VERIFY[1])
}

function dollar(tag, text) {
  if (text.includes(`$${tag}$`)) throw new Error(`source contains $${tag}$`)
  return `$${tag}$${text}$${tag}$`
}

function sqlString(text) {
  return `'${text.replaceAll("'", "''")}'`
}

// ── 공통 머리: 임시 표·도우미(거래 안에서만 산다) ─────────────────────────────────────────────────────────────
function prelude({ title, when, policyText, withdrawText, revert }) {
  const lines = POLICY_TEXT_LINES
  return `-- 15번 묶음 리허설: ${title}
-- 생성 파일(손으로 고치지 않는다): node supabase/scripts/bundle15_rehearsal/generate.mjs 가 원본에서 만든다.
-- 실행: supabase db query --remote --yes --file supabase/scripts/bundle15_rehearsal/<이 파일> (COMMIT 없음, 마지막 SELECT 가 결과)
-- 언제: ${when}
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
CREATE TEMP TABLE _rh_log (n serial PRIMARY KEY, test text NOT NULL, msg text NOT NULL, payload jsonb) ON COMMIT DROP;
CREATE TEMP TABLE _rh_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;

CREATE FUNCTION pg_temp.ctx_set(p_k text, p_v text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _rh_ctx (k, v) VALUES (p_k, p_v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v
$f$;
CREATE FUNCTION pg_temp.ctx(p_k text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM _rh_ctx WHERE k = p_k $f$;

-- 실패는 RAISE EXCEPTION 'RH FAIL …'(900자 안 요약), 성공 기록은 _rh_log.
CREATE FUNCTION pg_temp.log(p_test text, p_msg text, p_payload jsonb DEFAULT NULL) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO _rh_log (test, msg, payload) VALUES (p_test, left(p_msg, 900), p_payload)
$f$;
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
-- 결과 문자열이 기대 접두어로 시작하는지 본다(case 안에서 쓰는 로그는 변수에 모았다가 표지 예외 뒤에 남긴다).
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
CREATE FUNCTION pg_temp.subst_once(p_src text, p_from text, p_to text) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_from = '' OR (length(p_src) - length(replace(p_src, p_from, ''))) / length(p_from) <> 1 THEN
    RAISE EXCEPTION 'RH FAIL copy line not found exactly once: %', left(p_from, 200);
  END IF;
  RETURN replace(p_src, p_from, p_to);
END $f$;
CREATE FUNCTION pg_temp.kst_label(p_date date) RETURNS text LANGUAGE sql AS $f$
  SELECT to_char(p_date, 'YYYY"년" FMMM"월" FMDD"일"')
$f$;
CREATE FUNCTION pg_temp.kst_today() RETURNS date LANGUAGE sql AS $f$ SELECT (now() AT TIME ZONE 'Asia/Seoul')::date $f$;
-- 기록자: 가장 최근에 로그인한 대표(스크립트와 같은 규칙)
CREATE FUNCTION pg_temp.owner_id() RETURNS uuid LANGUAGE sql AS $f$
  SELECT p.id FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.is_admin IS TRUE AND p.admin_role = 'owner' AND u.last_sign_in_at IS NOT NULL
   ORDER BY u.last_sign_in_at DESC LIMIT 1
$f$;

-- 원본 DO 블록(생성기가 원본 파일에서 꺼낸 글 그대로)
SELECT pg_temp.ctx_set('src_policy_text', ${dollar('rh_src_policy_text', policyText)});
SELECT pg_temp.ctx_set('src_withdraw_text', ${dollar('rh_src_withdraw_text', withdrawText)});
SELECT pg_temp.ctx_set('src_revert', ${dollar('rh_src_revert', revert)});

-- 10번 약관 스크립트 사본: 바꾸는 줄은 생성기 POLICY_TEXT_LINES 뿐이다.
--   p_flags: 'relax_const'(상수 검사 끔 — R4 (가) 리허설 날 시행), 'skip_policies'(정책 없는 사본), 'skip_triggers'(트리거 없는 light 사본)
--   p_extra: 멈춤 경우용 [from, to] 쌍 배열(각 from 은 정확히 1번)
CREATE FUNCTION pg_temp.pt_sql(p_mode text, p_eff date, p_deadline date, p_last date, p_flags text[] DEFAULT '{}',
  p_extra jsonb DEFAULT '[]'::jsonb, p_republish text DEFAULT NULL, p_withdraw text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v text := pg_temp.ctx('src_policy_text');
  e jsonb;
  c_eligible constant text := 'FROM public.profiles p JOIN auth.users u ON u.id = p.id WHERE NOT public.is_internal_admin_account(u.email) AND p.withdrawn_at IS NULL AND ((p.provider = ''kakao'' AND p.signup_completed IS TRUE) OR (p.provider IS DISTINCT FROM ''kakao'' AND u.email_confirmed_at IS NOT NULL))';
BEGIN
  v := pg_temp.subst_once(v, ${sqlString(lines.mode)}, '  c_mode constant text := ' || quote_nullable(p_mode) || ';');
  v := pg_temp.subst_once(v, ${sqlString(lines.effective)}, '  c_effective_date constant date := DATE ' || quote_literal(p_eff::text) || ';');
  v := pg_temp.subst_once(v, ${sqlString(lines.deadline)}, '  c_notice_deadline constant date := DATE ' || quote_literal(p_deadline::text) || ';');
  v := pg_temp.subst_once(v, ${sqlString(lines.applyLast)}, '  c_apply_last_date constant date := DATE ' || quote_literal(p_last::text) || ';');
  v := pg_temp.subst_once(v, ${sqlString(lines.republish)}, '  c_republish_reason constant text := ' || quote_nullable(p_republish) || ';');
  v := pg_temp.subst_once(v, ${sqlString(lines.withdraw)}, '  c_withdraw_reason constant text := ' || quote_nullable(p_withdraw) || ';');
  v := pg_temp.subst_once(v, ${sqlString(lines.confirmedCount)}, '  c_confirmed_count constant integer := (SELECT count(*)::integer ' || c_eligible || ');');
  v := pg_temp.subst_once(v, ${sqlString(lines.confirmedMd5)}, '  c_confirmed_members_md5 constant text := (SELECT md5(string_agg(p.id::text, '','' ORDER BY p.id)) ' || c_eligible || ');');
  IF 'relax_const' = ANY (p_flags) THEN
    v := pg_temp.subst_once(v, ${sqlString(lines.constCheck)}, '  IF false THEN');
  END IF;
  IF 'skip_policies' = ANY (p_flags) THEN
    v := pg_temp.subst_once(v, ${sqlString(lines.policyCheck)}, '  IF false THEN');
  END IF;
  IF 'skip_triggers' = ANY (p_flags) THEN
    v := pg_temp.subst_once(v, ${sqlString(lines.triggerCheck)}, replace(${sqlString(lines.triggerCheck)}, ') <> 3 THEN', ') < 0 THEN'));
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_extra) x LOOP
    v := pg_temp.subst_once(v, e ->> 0, e ->> 1);
  END LOOP;
  RETURN v;
END $f$;

-- 4-6 작은 스크립트 사본: 바꾸는 줄은 WITHDRAW_TEXT_LINES 뿐이다.
CREATE FUNCTION pg_temp.wd_sql(p_mode text, p_eff date DEFAULT DATE '2027-01-11') RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v text := pg_temp.ctx('src_withdraw_text');
BEGIN
  v := pg_temp.subst_once(v, ${sqlString(WITHDRAW_TEXT_LINES.mode)}, '  c_mode constant text := ' || quote_nullable(p_mode) || ';');
  v := pg_temp.subst_once(v, ${sqlString(WITHDRAW_TEXT_LINES.effective)}, '  c_effective_date constant date := DATE ' || quote_literal(p_eff::text) || ';');
  RETURN v;
END $f$;
CREATE FUNCTION pg_temp.disabled_text() RETURNS text LANGUAGE sql AS $f$
  SELECT value #>> '{texts,blockReasons,DISABLED}' FROM public.system_settings WHERE key = 'member_withdrawal_policy'
$f$;
`
}

// 공지 팝업 저장 도우미(마이그레이션 뒤에 만든다): 지금 판으로 저장하고 'OK {결과}' / 'ERR …'
const POPUP_HELPERS = `
CREATE FUNCTION pg_temp.popup() RETURNS jsonb LANGUAGE sql AS $f$
  SELECT value FROM public.system_settings WHERE key = 'site_notice_popup'
$f$;
CREATE FUNCTION pg_temp.try_save(p_actor uuid, p_enabled boolean, p_title text, p_body text, p_link text, p_label text,
  p_starts timestamptz, p_ends timestamptz, p_rev integer DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  RETURN 'OK ' || public.save_site_notice_popup(p_actor, coalesce(p_rev, (pg_temp.popup() ->> 'revision')::integer), p_enabled,
    p_title, p_body, p_link, p_label, p_starts, p_ends)::text;
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERR ' || left(SQLERRM, 300);
END $f$;
CREATE FUNCTION pg_temp.res(p_result text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT substr(p_result, 4)::jsonb $f$;
-- 고지 끊김 판정용 가짜 저장 기록(시각을 정해 남김 — 작업 기록 표는 추가 전용이라 이 거래가 되돌려질 때 함께 사라진다)
CREATE FUNCTION pg_temp.fake_save(p_after jsonb, p_saved_at timestamptz, p_rev_after integer) RETURNS uuid LANGUAGE sql AS $f$
  SELECT public.record_admin_audit(pg_temp.owner_id(), 'site_notice_popup_save', 'system_settings', 'site_notice_popup', NULL, NULL,
    'RH15 가짜 기록', jsonb_build_object('after', p_after, 'saved_at', to_jsonb(p_saved_at), 'revision_after', p_rev_after,
                                         'revision_before', p_rev_after - 1), NULL)
$f$;
-- 게시 행을 정한 값으로 둔다(고지 끊김 판정 경우용 가짜 게시 행)
CREATE FUNCTION pg_temp.fake_publication(p_published timestamptz, p_status text DEFAULT 'upcoming') RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.system_settings (key, value, description, updated_at)
  VALUES ('policy_upcoming_documents', jsonb_build_object('status', p_status, 'effectiveDate', '2027-01-11', 'effectiveDateLabel', '2027년 1월 11일',
            'noticeDeadline', '2026-12-10', 'publishedAt', to_jsonb(p_published), 'documents', '[]'::jsonb, 'consentItems', '[]'::jsonb), 'RH15', now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
$f$;
CREATE FUNCTION pg_temp.set_popup_revision(p_rev integer) RETURNS void LANGUAGE sql AS $f$
  UPDATE public.system_settings SET value = jsonb_set(value, '{revision}', to_jsonb(p_rev)) WHERE key = 'site_notice_popup'
$f$;
CREATE FUNCTION pg_temp.continuity_reason(p_eff date DEFAULT NULL, p_deadline date DEFAULT NULL) RETURNS text LANGUAGE sql AS $f$
  SELECT coalesce(r ->> 'reason', CASE WHEN (r -> 'ok') = 'true'::jsonb THEN 'OK' END)
    FROM (SELECT public.policy_upcoming_notice_continuity(p_eff, p_deadline) AS r) x
$f$;
`

// 경우 하나를 격리한다: 안에서 남긴 상태는 표지 예외 RH_ISOLATE 로 되돌리고, 로그(변수 v_log)만 남긴다(원칙 1).
function isolatedCase(tag, test, body, declare = '') {
  return `
DO $${tag}$
DECLARE
  v_log text[] := '{}';
  v_r text;
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

const fixturesSql = () => {
  const records = JSON.parse(read(SOURCES.recordExamples))
  const inputs = JSON.parse(read(SOURCES.inputExamples))
  return { records, inputs }
}

// ── 경우 묶음 ────────────────────────────────────────────────────────────────────────────────────────────────
function caseRecordGood() {
  const { records } = fixturesSql()
  return isolatedCase('rh_good_examples', 'GOOD', `
    -- 4-3 좋은 기록 판정 = 예시 묶음(tests/fixtures/bundle15-notice-record-examples.json, TS isNoticeRecordGood 과 같은 파일)
    DECLARE
      f jsonb := ${sqlString(JSON.stringify(records))}::jsonb;
      c jsonb;
      v_after jsonb;
      v_good boolean;
    BEGIN
      FOR c IN SELECT x FROM jsonb_array_elements(f -> 'cases') x LOOP
        v_after := (f -> 'base') || (c -> 'patch');
        v_good := public.policy_upcoming_notice_record_good(v_after, (f ->> 'savedAt')::timestamptz,
          (f #>> '{upcoming,effectiveDate}')::date, f #>> '{upcoming,effectiveDateLabel}');
        v_log := v_log || pg_temp.ensure(v_good = (c -> 'good')::boolean, 'GOOD', (c ->> 'name') || ' = ' || (c ->> 'good'));
      END LOOP;
    END;`)
}

function caseSaveFunction() {
  const { inputs } = fixturesSql()
  return isolatedCase('rh_r2_save', 'R2', `
    DECLARE
      v_owner uuid := pg_temp.owner_id();
      v_before integer;
      v_res jsonb;
      v_detail jsonb;
      v_staff uuid;
      f jsonb := ${sqlString(JSON.stringify(inputs))}::jsonb;
      c jsonb;
      b jsonb;
      v_shift interval;
      v_title text;
      v_body text;
      v_ok boolean;
    BEGIN
      v_log := v_log || pg_temp.ensure(v_owner IS NOT NULL, 'R2', '대표 계정 있음');
      -- 대표 성공: 지문·revision +1·기록 1건·details 키
      SELECT count(*) INTO v_before FROM public.admin_audit_log WHERE action = 'site_notice_popup_save';
      v_r := pg_temp.try_save(v_owner, true, 'RH 제목', 'RH 본문 ' || pg_temp.kst_label(pg_temp.kst_today() + 40), '/terms/upcoming', '바뀌는 부분 보기',
                              NULL, now() + interval '41 days');
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R2', '대표 켜기 저장');
      v_res := pg_temp.res(v_r);
      v_log := v_log || pg_temp.ensure((v_res -> 'changed') = 'true'::jsonb AND (v_res #>> '{value,revision}')::integer = 2
        AND (v_res #>> '{value,contentSha256}') = public.site_notice_popup_content_sha256('RH 제목', v_res #>> '{value,body}', '/terms/upcoming', '바뀌는 부분 보기')
        AND pg_temp.popup() = v_res -> 'value', 'R2', 'revision 2·지문·저장값');
      v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.admin_audit_log WHERE action = 'site_notice_popup_save') = v_before + 1, 'R2', '기록 1건');
      SELECT details INTO v_detail FROM public.admin_audit_log WHERE id = (v_res ->> 'auditId')::uuid;
      v_log := v_log || pg_temp.ensure((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_detail) k)
        = ARRAY['after', 'before', 'content_changed', 'content_sha256_after', 'content_sha256_before', 'exposure_starts_at', 'revision_after',
                'revision_before', 'saved_at', 'visible_after', 'visible_before'], 'R2', 'details 키 11개');
      v_log := v_log || pg_temp.ensure((v_detail -> 'visible_after') = 'true'::jsonb AND (v_detail -> 'visible_before') = 'false'::jsonb
        AND (v_detail ->> 'exposure_starts_at') IS NOT NULL AND (v_detail -> 'content_changed') = 'true'::jsonb, 'R2', '꺼짐→켜짐: visible·노출 시작');
      -- 바뀐 것 없음 → 기록 0건
      v_r := pg_temp.try_save(v_owner, true, 'RH 제목', v_res #>> '{value,body}', '/terms/upcoming', '바뀌는 부분 보기', NULL, (v_res #>> '{value,endsAt}')::timestamptz);
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R2', '같은 값 다시 저장');
      v_log := v_log || pg_temp.ensure((pg_temp.res(v_r) -> 'changed') = 'false'::jsonb
        AND (SELECT count(*) FROM public.admin_audit_log WHERE action = 'site_notice_popup_save') = v_before + 1, 'R2', '바뀐 것 없음 → 기록 0건');
      -- 시작 미래: visible_after false, exposure_starts_at = 시작
      v_r := pg_temp.try_save(v_owner, true, 'RH 제목', v_res #>> '{value,body}', '/terms/upcoming', '바뀌는 부분 보기',
                              now() + interval '2 days', (v_res #>> '{value,endsAt}')::timestamptz);
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R2', '시작 미래 저장');
      SELECT details INTO v_detail FROM public.admin_audit_log WHERE id = (pg_temp.res(v_r) ->> 'auditId')::uuid;
      v_log := v_log || pg_temp.ensure((v_detail -> 'visible_after') = 'false'::jsonb AND (v_detail -> 'visible_before') = 'true'::jsonb
        AND (v_detail ->> 'exposure_starts_at')::timestamptz = (v_detail #>> '{after,startsAt}')::timestamptz
        AND (v_detail -> 'content_changed') = 'false'::jsonb, 'R2', '시작 미래: visible_after false·노출 시작 = 시작');
      -- 시작 과거: visible_after true, exposure_starts_at = 저장 시각(now)
      v_r := pg_temp.try_save(v_owner, true, 'RH 제목', v_res #>> '{value,body}', '/terms/upcoming', '바뀌는 부분 보기',
                              now() - interval '2 days', (v_res #>> '{value,endsAt}')::timestamptz);
      SELECT details INTO v_detail FROM public.admin_audit_log WHERE id = (pg_temp.res(v_r) ->> 'auditId')::uuid;
      v_log := v_log || pg_temp.ensure((v_detail -> 'visible_after') = 'true'::jsonb
        AND (v_detail ->> 'exposure_starts_at')::timestamptz = now(), 'R2', '시작 과거: visible_after true·노출 시작 = now()');
      -- 꺼짐 저장: exposure_starts_at null
      v_r := pg_temp.try_save(v_owner, false, 'RH 제목', v_res #>> '{value,body}', '/terms/upcoming', '바뀌는 부분 보기', NULL, NULL);
      SELECT details INTO v_detail FROM public.admin_audit_log WHERE id = (pg_temp.res(v_r) ->> 'auditId')::uuid;
      v_log := v_log || pg_temp.ensure((v_detail -> 'exposure_starts_at') = 'null'::jsonb AND (v_detail -> 'visible_after') = 'false'::jsonb,
        'R2', '끄기: 노출 시작 null');
      -- 판 충돌
      v_r := pg_temp.try_save(v_owner, false, 'RH 제목2', 'b', NULL, NULL, NULL, NULL, 1);
      v_log := v_log || pg_temp.expect(v_r, 'ERR NOTICE_POPUP_REVISION_CONFLICT', 'R2', '판 충돌');
      -- 직원·없는 계정 거절
      v_r := pg_temp.try_save(gen_random_uuid(), false, 'RH', 'b', NULL, NULL, NULL, NULL);
      v_log := v_log || pg_temp.expect(v_r, 'ERR NOTICE_POPUP_ACTOR_NOT_OWNER', 'R2', '없는 계정');
      SELECT p.id INTO v_staff FROM public.profiles p WHERE p.is_admin IS TRUE AND p.admin_role IS DISTINCT FROM 'owner' LIMIT 1;
      IF v_staff IS NULL THEN
        SELECT p.id INTO v_staff FROM public.profiles p WHERE p.is_admin IS NOT TRUE LIMIT 1;
        v_log := v_log || '직원 계정이 없어 일반 회원 계정으로 대신 확인';
      END IF;
      v_r := pg_temp.try_save(v_staff, false, 'RH', 'b', NULL, NULL, NULL, NULL);
      v_log := v_log || pg_temp.expect(v_r, 'ERR NOTICE_POPUP_ACTOR_NOT_OWNER', 'R2', '직원(대표 아님)');
      -- 입력 검사 = 예시 묶음(tests/fixtures/bundle15-notice-input-examples.json). 시각은 예시의 now 와 지금의 차이만큼 옮긴다.
      v_shift := now() - (f ->> 'now')::timestamptz;
      FOR c IN SELECT x FROM jsonb_array_elements(f -> 'cases') x LOOP
        b := (f -> 'base') || (c -> 'patch');
        v_title := CASE WHEN c ? 'repeatTitle' THEN repeat('가', (c ->> 'repeatTitle')::integer) ELSE b ->> 'title' END;
        v_body := CASE WHEN c ? 'repeatBody' THEN repeat('가', (c ->> 'repeatBody')::integer) ELSE b ->> 'body' END;
        v_r := pg_temp.try_save(v_owner, (b -> 'enabled')::boolean, v_title, v_body, b ->> 'linkUrl', b ->> 'linkLabel',
          (b ->> 'startsAt')::timestamptz + v_shift, (b ->> 'endsAt')::timestamptz + v_shift);
        v_ok := v_r LIKE 'OK%';
        IF v_ok IS DISTINCT FROM (c -> 'ok')::boolean OR (NOT v_ok AND v_r NOT LIKE 'ERR NOTICE_POPUP_INPUT_INVALID%') THEN
          PERFORM pg_temp.fail('R2', '입력 예시 ' || (c ->> 'name') || ' 기대 ' || (c ->> 'ok') || ', 실제 ' || left(v_r, 200));
        END IF;
        v_log := v_log || ('입력 예시 ' || (c ->> 'name') || ' → ' || CASE WHEN v_ok THEN 'OK' ELSE left(v_r, 60) END);
      END LOOP;
    END;`)
}

// 고지 끊김 판정(4-3): 게시 행·저장 기록을 정한 시각으로 두고 판정 함수만 부른다(실제 저장은 R2·R4 (가)가 본다).
function caseContinuity() {
  const good = "jsonb_build_object('enabled', true, 'title', 't', 'body', '2027년 1월 11일(월)부터 바뀝니다', 'linkUrl', '/terms/upcoming', 'linkLabel', '보기', 'startsAt', NULL, 'endsAt', '2027-01-12T00:00:00+09:00')"
  const at = (s) => `timestamptz '${s}'`
  const scenarios = [
    ['기록 없음', [], 0, 'NO_RECORDS'],
    ['게시 전 기록만', [[good, '2026-12-06 10:00+09', 1]], 1, 'NO_RECORDS'],
    ['좋은 켬', [[good, '2026-12-08 10:00+09', 2]], 2, 'OK'],
    ['켬→끔→켬, 마지막 켬이 마감 안', [[good, '2026-12-08 10:00+09', 2], [`${good} || '{"enabled": false}'`, '2026-12-09 10:00+09', 3], [good, '2026-12-10 23:00+09', 4]], 4, 'OK'],
    ['켬→끔→켬, 마지막 켬이 마감 뒤', [[good, '2026-12-08 10:00+09', 2], [`${good} || '{"enabled": false}'`, '2026-12-09 10:00+09', 3], [good, '2026-12-11 00:00+09', 4]], 4, 'START_AFTER_DEADLINE'],
    ['시작이 미래(마감 뒤)인 저장만', [[`${good} || '{"startsAt": "2026-12-12T00:00:00+09:00"}'`, '2026-12-08 10:00+09', 2]], 2, 'START_AFTER_DEADLINE'],
    ['미래 시작(마감 뒤) 저장 → 바로 고친 좋은 저장(마감 안)', [[`${good} || '{"startsAt": "2026-12-15T00:00:00+09:00"}'`, '2026-12-08 10:00+09', 2], [good, '2026-12-09 10:00+09', 3], [good, '2026-12-12 10:00+09', 4]], 4, 'OK'],
    ['시작이 미래(마감 안)인 저장만', [[`${good} || '{"startsAt": "2026-12-10T12:00:00+09:00"}'`, '2026-12-08 10:00+09', 2]], 2, 'OK'],
    ['끝을 당겼다 늘림(마감 뒤)', [[good, '2026-12-08 10:00+09', 2], [`${good} || '{"endsAt": "2027-01-10T00:00:00+09:00"}'`, '2026-12-12 10:00+09', 3], [good, '2026-12-13 10:00+09', 4]], 4, 'START_AFTER_DEADLINE'],
    ['링크 바꿈(마감 뒤)', [[good, '2026-12-08 10:00+09', 2], [`${good} || '{"linkUrl": "/terms/service"}'`, '2026-12-12 10:00+09', 3], [good, '2026-12-13 10:00+09', 4]], 4, 'START_AFTER_DEADLINE'],
    ['본문에서 시행일 뺌(마지막)', [[good, '2026-12-08 10:00+09', 2], [`${good} || '{"body": "곧 바뀝니다"}'`, '2026-12-12 10:00+09', 3]], 3, 'LAST_NOT_GOOD'],
    ['끝 = 시행일 00:00 KST', [[`${good} || '{"endsAt": "2027-01-11T00:00:00+09:00"}'`, '2026-12-08 10:00+09', 2]], 2, 'OK'],
    ['끝 = 시행일 00:00 KST 1초 앞', [[`${good} || '{"endsAt": "2027-01-10T23:59:59+09:00"}'`, '2026-12-08 10:00+09', 2]], 2, 'LAST_NOT_GOOD'],
    ['기록 밖에서 판이 바뀜', [[good, '2026-12-08 10:00+09', 2]], 5, 'REVISION_MISMATCH'],
  ]
  const body = scenarios.map(([name, records, rev, expected], index) => `
    BEGIN
      PERFORM pg_temp.fake_publication(${at('2026-12-07 10:00+09')});
${records.map(([after, savedAt, revAfter]) => `      PERFORM pg_temp.fake_save(${after}, ${at(savedAt)}, ${revAfter});`).join('\n')}
      PERFORM pg_temp.set_popup_revision(${rev});
      v_r := pg_temp.continuity_reason();
      v_log := v_log || pg_temp.expect(v_r, ${sqlString(expected)}, 'CONT', ${sqlString(`${index + 1}. ${name}`)});
      RAISE EXCEPTION 'RH_ISOLATE_INNER';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'RH_ISOLATE_INNER' THEN RAISE; END IF;
    END;`).join('\n')
  return isolatedCase('rh_continuity', 'CONT', `${body}
    -- 게시 행 없음·게시가 마감 뒤·상태가 upcoming 아님·인자 불일치
    v_log := v_log || pg_temp.expect(pg_temp.continuity_reason(), 'NO_PUBLICATION', 'CONT', '게시 행 없음');
    PERFORM pg_temp.fake_publication(${at('2026-12-11 00:00+09')});
    v_log := v_log || pg_temp.expect(pg_temp.continuity_reason(), 'PUBLISHED_AFTER_DEADLINE', 'CONT', '게시가 마감 뒤(12-11 00:00 KST)');
    PERFORM pg_temp.fake_publication(${at('2026-12-10 23:59:59+09')});
    v_log := v_log || pg_temp.expect(pg_temp.continuity_reason(), 'NO_RECORDS', 'CONT', '게시가 마감일 23:59:59 KST → 마감 안');
    v_log := v_log || pg_temp.expect(pg_temp.continuity_reason(DATE '2027-01-12', NULL), 'ARG_MISMATCH', 'CONT', '시행일 인자 불일치');
    v_log := v_log || pg_temp.expect(pg_temp.continuity_reason(NULL, DATE '2026-12-11'), 'ARG_MISMATCH', 'CONT', '마감일 인자 불일치');
    v_log := v_log || pg_temp.expect(pg_temp.continuity_reason(DATE '2027-01-11', DATE '2026-12-10'), 'NO_RECORDS', 'CONT', '인자 일치 → 다음 판정');
    PERFORM pg_temp.fake_publication(${at('2026-12-07 10:00+09')}, 'applied');
    v_log := v_log || pg_temp.expect(pg_temp.continuity_reason(), 'NOT_UPCOMING', 'CONT', '상태 applied');`)
}

// R4: 고친 10번 스크립트(게시·시행·그만두기). flags 는 사본 종류(정책 없음·트리거 없음).
// 낡은 기대값(2026-11-26): 15번이 운영에 적용된 뒤에는 이 경우들(a·b·c 파일)을 돌릴 수 없다. 또 10번 스크립트 apply 가 12·13번 객체 점검에서
//   먼저 멈추므로 R4가 '시행 OK'·R4다 시행 멈춤 기대값(NO_RECORDS·fingerprints differ 등)은 지금 맞지 않는다. 시행 경로는 12·13번 적용 뒤
//   apply BEGIN … ROLLBACK 리허설(15번 계획 10절 8단계)로 본다.
function casesPolicyText(flags, withTriggers) {
  const f = `ARRAY[${flags.map(sqlString).join(', ')}]::text[]`
  const fr = `ARRAY[${[...flags, 'relax_const'].map(sqlString).join(', ')}]::text[]`
  // 시험용 날짜: 게시·판정 경우는 시행일 = 오늘+40, 마감 = 오늘+3(상수 검사 통과). R4 (가)는 오늘 = 시행일 = 마감(상수 검사 끔).
  const eff = 'pg_temp.kst_today() + 40'
  const dl = 'pg_temp.kst_today() + 3'
  const publish = (extra = "'[]'::jsonb", reason = 'NULL') => `pg_temp.try_sql(pg_temp.pt_sql('publish_upcoming', ${eff}, ${dl}, ${eff}, ${f}, ${extra}, ${reason}))`
  const pub = () => `(SELECT value FROM public.system_settings WHERE key = 'policy_upcoming_documents')`
  const out = []

  out.push(isolatedCase('rh_r4a_success', 'R4가', `
    -- 성공 경로: 게시 → 좋은 팝업 저장 → 시행(리허설 날 = 시행일 = 고지 마감) → 되돌리기 블록(R5-1)
    DECLARE
      v_owner uuid := pg_temp.owner_id();
      v_pub jsonb;
      v_after jsonb;
      v_disabled text := pg_temp.disabled_text();
      v_eligible integer := public.consent_eligible_member_count();
    BEGIN
      v_r := pg_temp.try_sql(pg_temp.pt_sql('publish_upcoming', pg_temp.kst_today(), pg_temp.kst_today(), pg_temp.kst_today(), ${fr}));
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4가', '게시(리허설 날 시행)');
      v_pub := ${pub()};
      v_log := v_log || pg_temp.ensure((v_pub ->> 'status') = 'upcoming' AND jsonb_array_length(v_pub -> 'documents') = 3
        AND jsonb_array_length(v_pub -> 'consentItems') = 2 AND (v_pub ->> 'effectiveDateLabel') = pg_temp.kst_label(pg_temp.kst_today()),
        'R4가', '게시 행 upcoming·문서 3·동의 항목 2');
      v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.admin_audit_log WHERE action = 'policy_upcoming_publish'
        AND details ->> 'bundle' = 'bundle15_policy_upcoming' AND (details -> 'row') = v_pub) = 1, 'R4가', '게시 기록에 행 전체');
      -- 약관 본문·동의 항목·탈퇴 정책은 게시 때 바뀌지 않음
      v_log := v_log || pg_temp.ensure(
        (SELECT md5(value #>> '{policyDocuments,serviceTerms,content}') FROM public.system_settings WHERE key = 'site_footer_content') = '75271f987f170878440049cc90c84284'
        AND (SELECT version FROM public.signup_consent_items WHERE key = 'terms') = 1, 'R4가', '게시는 본문·동의 항목을 바꾸지 않음');
      -- 좋은 팝업 저장(본문에 시행일 글자, 링크 /terms/upcoming, 끝 = 내일 00:00 KST)
      v_r := pg_temp.try_save(v_owner, true, 'RH 제목', pg_temp.kst_label(pg_temp.kst_today()) || '부터 약관이 바뀝니다', '/terms/upcoming', '바뀌는 부분 보기',
        NULL, ((pg_temp.kst_today() + 1)::timestamp AT TIME ZONE 'Asia/Seoul'));
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4가', '팝업 켜기 저장');
      v_log := v_log || pg_temp.expect(pg_temp.continuity_reason(), 'OK', 'R4가', '끊김 판정 OK');
      -- 시행
      v_r := pg_temp.try_sql(pg_temp.pt_sql('apply', pg_temp.kst_today(), pg_temp.kst_today(), pg_temp.kst_today(), ${fr}));
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4가', '시행');
      v_after := ${pub()};
      v_log := v_log || pg_temp.ensure((v_after ->> 'status') = 'applied' AND (v_after ->> 'appliedAt') IS NOT NULL
        AND (v_after - 'status' - 'appliedAt') = (v_pub - 'status' - 'appliedAt'), 'R4가', '게시 행 applied(다른 값 그대로)');
      v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_pub -> 'documents') d
          WHERE (SELECT s.content_sha256 FROM public.policy_document_snapshots s WHERE s.doc_key = d ->> 'key' ORDER BY s.seq DESC LIMIT 1) IS DISTINCT FROM d ->> 'sha256'),
        'R4가', '사본 표 최신 지문 = 게시 지문');
      v_log := v_log || pg_temp.ensure(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_pub -> 'consentItems') c JOIN public.signup_consent_items i ON i.key = c ->> 'key'
          WHERE i.version <> (c ->> 'version')::integer OR i.content <> c ->> 'content' OR i.label <> c ->> 'label'
             OR NOT EXISTS (SELECT 1 FROM public.signup_consent_item_versions v WHERE v.item_id = i.id AND v.version = i.version AND v.note = c ->> 'note')),
        'R4가', '동의 항목 2판 = 게시 행(본문·이름·판·변경 안내)');
      v_log := v_log || pg_temp.ensure((SELECT count(*) FROM public.admin_audit_log WHERE action = 'policy_upcoming_apply'
        AND details ->> 'bundle' = 'bundle15_policy_upcoming' AND (details ->> 'continuity_s_id') IS NOT NULL) = 1, 'R4가', '시행 기록(판정 S id)');
      v_log := v_log || pg_temp.ensure(pg_temp.disabled_text() IS NOT DISTINCT FROM v_disabled, 'R4가', 'DISABLED 문구 그대로(4-6 값 유지)');
      v_log := v_log || pg_temp.ensure(public.consent_eligible_member_count() = v_eligible, 'R4가', '재동의 대상 수 ' || v_eligible);
      -- R5-1: 10번 되돌리기 블록 → reverted
      v_r := pg_temp.try_sql(pg_temp.ctx('src_revert'));
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R5-1', '10번 되돌리기 블록');
      v_after := ${pub()};
      v_log := v_log || pg_temp.ensure((v_after ->> 'status') = 'reverted' AND (v_after ->> 'revertedAt') IS NOT NULL AND (v_after ->> 'appliedAt') IS NOT NULL
        AND (SELECT md5(value #>> '{policyDocuments,serviceTerms,content}') FROM public.system_settings WHERE key = 'site_footer_content') = '75271f987f170878440049cc90c84284',
        'R5-1', '게시 행 reverted(appliedAt 남음)·본문 되돌림');
    END;`))

  out.push(isolatedCase('rh_r4c_stop', 'R4다', `
    -- 멈춤 경우(각 경우는 하위 블록 안에서 돌고 되돌린다)
    DECLARE
      v_pub jsonb;
      v_pub2 jsonb;
      v_owner uuid := pg_temp.owner_id();
    BEGIN
      -- 상수 검사 위반(마감 > 시행일 − 32)
      v_r := pg_temp.try_sql(pg_temp.pt_sql('publish_upcoming', ${eff}, ${eff} - 31, ${eff}, ${f}));
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: constants', 'R4다', '상수 검사: 마감 = 시행일 − 31');
      v_r := pg_temp.try_sql(pg_temp.pt_sql('publish_upcoming', ${eff}, ${dl}, ${eff} - 1, ${f}));
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: constants', 'R4다', '상수 검사: 마지막 날 < 시행일');
      v_r := pg_temp.try_sql(pg_temp.pt_sql(NULL, ${eff}, ${dl}, ${eff}, ${f}));
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: set c_mode', 'R4다', 'c_mode NULL');
      -- 시행 날짜 밖
      v_r := pg_temp.try_sql(pg_temp.pt_sql('apply', ${eff}, ${dl}, ${eff}, ${f}));
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: apply runs only on', 'R4다', '시행일 전 시행 → 날짜 검사');
      -- 고지 그만두기: 게시 행 없음·사유 없음
      v_r := pg_temp.try_sql(pg_temp.pt_sql('withdraw_upcoming', ${eff}, ${dl}, ${eff}, ${f}, '[]'::jsonb, NULL, 'RH 사유'));
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: no upcoming publication', 'R4다', '그만두기: 게시 행 없음');

      -- 게시
      v_r := ${publish()};
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4다', '게시');
      v_pub := ${pub()};
      -- 같은 지문·같은 글 다시 게시 → 할 일 없음
      v_r := ${publish()};
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: already published with the same content', 'R4다', '같은 지문·같은 글 다시 게시');
      -- 같은 지문, 머리말만 다름 → 화면 글만 바뀜(publishedAt 그대로)
      v_r := ${publish(`jsonb_build_array(jsonb_build_array('''bannerLinkLabel'', ''바뀌는 부분 보기'',', '''bannerLinkLabel'', ''바뀌는 부분 자세히'','))`)};
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4다', '머리말만 바꿔 다시 게시');
      v_pub2 := ${pub()};
      v_log := v_log || pg_temp.ensure((v_pub2 ->> 'bannerLinkLabel') = '바뀌는 부분 자세히' AND (v_pub2 -> 'publishedAt') = (v_pub -> 'publishedAt')
        AND (v_pub2 -> 'documents') = (v_pub -> 'documents') AND jsonb_array_length(v_pub2 -> 'superseded') = 0, 'R4다', '화면 글만 바뀜·publishedAt 그대로');
      v_log := v_log || pg_temp.ensure((SELECT details ->> 'kind' FROM public.admin_audit_log WHERE action = 'policy_upcoming_publish'
        ORDER BY (details ->> 'saved_at')::timestamptz DESC LIMIT 1) = 'texts_only', 'R4다', '기록 kind texts_only');
      -- 표시 이름만 바뀐 다시 게시 → changesSha256 다름 → 사유 없으면 멈춤
      v_r := ${publish(`jsonb_build_array(jsonb_build_array('''부칙 시행일'', ''replace''', '''부칙 시행일자'', ''replace'''))`)};
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: published upcoming documents differ', 'R4다', '표시 이름만 바뀜·사유 없음 → 멈춤');
      -- 쌍 한 글자 바뀜·사유 없음 → 멈춤, 사유 있음 → superseded
      v_r := ${publish(`jsonb_build_array(jsonb_build_array('보안 업데이트 등의 조치를 합니다. 탈퇴 뒤', '보안 업데이트 등의 조치를 합니다.  탈퇴 뒤'))`)};
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: published upcoming documents differ', 'R4다', '쌍 한 글자 바뀜·사유 없음 → 멈춤');
      v_r := ${publish(`jsonb_build_array(jsonb_build_array('보안 업데이트 등의 조치를 합니다. 탈퇴 뒤', '보안 업데이트 등의 조치를 합니다.  탈퇴 뒤'))`, "'RH 다시 게시'")};
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4다', '쌍 한 글자 바뀜·사유 있음 → 다시 게시');
      v_pub2 := ${pub()};
      v_log := v_log || pg_temp.ensure(jsonb_array_length(v_pub2 -> 'superseded') = 1 AND (v_pub2 #>> '{superseded,0,reason}') = 'RH 다시 게시'
        AND (v_pub2 -> 'publishedAt') <> (v_pub -> 'publishedAt') AND (v_pub2 #> '{superseded,0,publishedAt}') = (v_pub -> 'publishedAt'),
        'R4다', 'superseded 1건·새 publishedAt');

      -- 고지 그만두기: 사유 없음 → 멈춤, 사유 있음 → reverted·기록, 그 뒤 게시는 사유가 있어야
      v_r := pg_temp.try_sql(pg_temp.pt_sql('withdraw_upcoming', ${eff}, ${dl}, ${eff}, ${f}));
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: c_withdraw_reason required', 'R4다', '그만두기 사유 없음');
      v_r := pg_temp.try_sql(pg_temp.pt_sql('withdraw_upcoming', ${eff}, ${dl}, ${eff}, ${f}, '[]'::jsonb, NULL, 'RH 그만두기'));
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4다', '그만두기');
      v_pub2 := ${pub()};
      v_log := v_log || pg_temp.ensure((v_pub2 ->> 'status') = 'reverted' AND (v_pub2 ->> 'revertedAt') IS NOT NULL AND (v_pub2 -> 'appliedAt') = 'null'::jsonb
        AND (SELECT count(*) FROM public.admin_audit_log WHERE action = 'policy_upcoming_withdraw' AND reason = 'RH 그만두기') = 1,
        'R4다', 'reverted·appliedAt 없음·기록');
      v_r := ${publish()};
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: published upcoming documents differ (status reverted)', 'R4다', 'reverted 뒤 게시·사유 없음 → 멈춤');
      v_r := ${publish("'[]'::jsonb", "'RH 다시 고지'")};
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4다', 'reverted 뒤 게시·사유 있음');
      v_log := v_log || pg_temp.ensure((${pub()} ->> 'status') = 'upcoming' AND jsonb_array_length(${pub()} -> 'superseded') = 2, 'R4다', '다시 upcoming·superseded 2건');
      -- applied 뒤 게시 → 멈춤(상태만 흉내)
      UPDATE public.system_settings SET value = jsonb_set(value, '{status}', '"applied"') WHERE key = 'policy_upcoming_documents';
      v_r := ${publish("'[]'::jsonb", "'RH'")};
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: upcoming documents already applied', 'R4다', 'applied 뒤 게시 → 멈춤');
    END;`))

  out.push(isolatedCase('rh_r4c_apply_stop', 'R4다', `
    -- 시행 멈춤: 지문 불일치(쌍·동의 항목 쌍·c_terms_note), 고지 끊김, 처리 대기 탈퇴 요청. 리허설 날을 시행일로 둔다(상수 검사 끔).
    DECLARE
      v_owner uuid := pg_temp.owner_id();
      v_today date := pg_temp.kst_today();
    BEGIN
      v_r := pg_temp.try_sql(pg_temp.pt_sql('publish_upcoming', v_today, v_today, v_today, ${fr}));
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4다', '게시(리허설 날 시행)');
      -- 고지 기록 없음 → 끊김
      v_r := pg_temp.try_sql(pg_temp.pt_sql('apply', v_today, v_today, v_today, ${fr}));
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: notice continuity failed (NO_RECORDS)', 'R4다', '팝업 기록 없음 → 시행 멈춤');
      -- 좋은 팝업 저장 뒤 지문 불일치 세 가지
      v_r := pg_temp.try_save(v_owner, true, 'RH 제목', pg_temp.kst_label(v_today) || '부터 약관이 바뀝니다', '/terms/upcoming', '바뀌는 부분 보기',
        NULL, ((v_today + 1)::timestamp AT TIME ZONE 'Asia/Seoul'));
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4다', '팝업 켜기 저장');
      v_r := pg_temp.try_sql(pg_temp.pt_sql('apply', v_today, v_today, v_today, ${fr},
        jsonb_build_array(jsonb_build_array('보안 업데이트 등의 조치를 합니다. 탈퇴 뒤', '보안 업데이트 등의 조치를 합니다.  탈퇴 뒤'))));
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: fingerprints differ', 'R4다', '문서 쌍 한 글자 → 지문 불일치');
      v_r := pg_temp.try_sql(pg_temp.pt_sql('apply', v_today, v_today, v_today, ${fr},
        jsonb_build_array(jsonb_build_array('목적: 회원 탈퇴 처리와 결과 안내', '목적: 회원 탈퇴 처리와  결과 안내'))));
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: fingerprints differ', 'R4다', '동의 항목 쌍 → 지문 불일치');
      v_r := pg_temp.try_sql(pg_temp.pt_sql('apply', v_today, v_today, v_today, ${fr},
        jsonb_build_array(jsonb_build_array('취소/환불정책에 ''8-2. 회원 탈퇴와 크레딧''을 더했습니다.$q$;', '취소/환불정책에 ''8-2. 회원 탈퇴와 크레딧''을 새로 더했습니다.$q$;'))));
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: fingerprints differ', 'R4다', 'c_terms_note → 지문 불일치');
      -- 판정 함수 인자 불일치(스크립트 상수 ≠ 게시 행)
      v_r := pg_temp.try_sql(pg_temp.pt_sql('apply', v_today, v_today, v_today + 1, ${fr},
        jsonb_build_array(jsonb_build_array('v_cont := public.policy_upcoming_notice_continuity(c_effective_date, c_notice_deadline);',
                                            'v_cont := public.policy_upcoming_notice_continuity(c_effective_date, c_notice_deadline - 1);'))));
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: notice continuity failed (ARG_MISMATCH)', 'R4다', '판정 인자 불일치 → 멈춤');
      -- 처리 대기 탈퇴 요청 → 멈춤(끊김 판정보다 앞)
      INSERT INTO public.member_withdrawal_requests (user_id, channel, notice_text, notice_sha256, expected_balance, expected_forfeit_paid,
                                                     expected_forfeit_free, recorded_by)
      VALUES (v_owner, 'email', 'RH15', repeat('0', 64), 0, 0, 0, v_owner);
      v_r := pg_temp.try_sql(pg_temp.pt_sql('apply', v_today, v_today, v_today, ${fr}));
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_TEXT: pending withdrawal request exists', 'R4다', '처리 대기 탈퇴 요청 → 멈춤');
    END;`))

  out.push(isolatedCase('rh_r4c_withdraw_restore', 'R4다', `
    -- 그만두기 순서(4-3): 4-6 notice(10번 배포 전) → 게시 → withdraw_upcoming → 4-6 restore
    DECLARE
      v_original text := pg_temp.disabled_text();
    BEGIN
      IF v_original LIKE '지금은 탈퇴 신청을 받을 수 없습니다%' THEN
        v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.wd_sql('notice')), 'OK', 'R4다', '4-6 notice');
      ELSE
        v_log := v_log || '4-6 notice 는 이미 돌았음(운영 값이 고지 문구)';
      END IF;
      v_log := v_log || pg_temp.expect(${publish()}, 'OK', 'R4다', '게시');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.pt_sql('withdraw_upcoming', ${eff}, ${dl}, ${eff}, ${f}, '[]'::jsonb, NULL, 'RH 그만두기')),
        'OK', 'R4다', 'withdraw_upcoming');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.wd_sql('restore')), 'OK', 'R4다', '4-6 restore');
      v_log := v_log || pg_temp.ensure(pg_temp.disabled_text() = '지금은 탈퇴 신청을 받을 수 없습니다. 잠시 후 다시 이용해 주세요.', 'R4다', '막힘 문구 원래대로');
    END;`))

  if (withTriggers) {
    out.push(isolatedCase('rh_r4c_order', 'R4다', `
    -- 실제 트리거: 게시 행 upcoming 동안 본문 저장은 막히고, applied 로 먼저 바꾸면 저장된다(시행 스크립트의 순서).
    BEGIN
      v_log := v_log || pg_temp.expect(${publish()}, 'OK', 'R4다', '게시');
      v_r := pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,serviceTerms,content}', to_jsonb((value #>> '{policyDocuments,serviceTerms,content}') || 'x')) WHERE key = 'site_footer_content'$s$);
      v_log := v_log || pg_temp.expect(v_r, 'ERR POLICY_UPCOMING_LOCKED', 'R4다', '순서를 바꾸면(upcoming 인 채 저장) 막힘');
      UPDATE public.system_settings SET value = jsonb_set(value, '{status}', '"applied"') WHERE key = 'policy_upcoming_documents';
      v_r := pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,serviceTerms,content}', to_jsonb((value #>> '{policyDocuments,serviceTerms,content}') || 'x')) WHERE key = 'site_footer_content'$s$);
      v_log := v_log || pg_temp.expect(v_r, 'OK', 'R4다', 'applied 먼저 → 저장됨');
    END;`))
  }
  return out.join('')
}

// R4 (나): 실제 시행일 상수로 게시 → 게시 행 JSON·지문 5개, 같은 값의 시행은 날짜 검사로 멈춤(별도 짧은 거래, 원칙 2).
function casePreview(flags) {
  const f = `ARRAY[${flags.map(sqlString).join(', ')}]::text[]`
  return `
DO $rh_r4b_preview$
DECLARE
  v_r text;
  v_pub jsonb;
BEGIN
  v_r := pg_temp.try_sql(pg_temp.pt_sql('publish_upcoming', DATE '2027-01-11', DATE '2026-12-10', DATE '2027-01-11', ${f}));
  IF v_r <> 'OK' THEN
    PERFORM pg_temp.fail('R4나', '실제 값 게시: ' || v_r);
  END IF;
  SELECT value INTO v_pub FROM public.system_settings WHERE key = 'policy_upcoming_documents';
  PERFORM pg_temp.log('R4나', '지문(앞 12자리) 이용약관 ' || left(v_pub #>> '{documents,0,sha256}', 12) || ' / 환불 ' || left(v_pub #>> '{documents,1,sha256}', 12)
    || ' / 처리방침 ' || left(v_pub #>> '{documents,2,sha256}', 12) || ' / 동의 terms ' || left(v_pub #>> '{consentItems,0,sha256}', 12)
    || ' / 동의 privacy ' || left(v_pub #>> '{consentItems,1,sha256}', 12));
  PERFORM pg_temp.log('R4나', 'changes 지문(앞 12자리) ' || left(v_pub #>> '{documents,0,changesSha256}', 12) || ' / ' || left(v_pub #>> '{documents,1,changesSha256}', 12)
    || ' / ' || left(v_pub #>> '{documents,2,changesSha256}', 12) || ', 변경 건수 ' || jsonb_array_length(v_pub #> '{documents,0,changes}') || '/'
    || jsonb_array_length(v_pub #> '{documents,1,changes}') || '/' || jsonb_array_length(v_pub #> '{documents,2,changes}'));
  PERFORM pg_temp.log('R4나', '미리보기 파일 payload(output/b15-upcoming-preview.json)', v_pub);
  v_r := pg_temp.try_sql(pg_temp.pt_sql('apply', DATE '2027-01-11', DATE '2026-12-10', DATE '2027-01-11', ${f}));
  IF v_r NOT LIKE 'ERR POLICY_TEXT: apply runs only on%' THEN
    PERFORM pg_temp.fail('R4나', '같은 값의 시행은 날짜 검사로 멈춰야 함: ' || left(v_r, 200));
  END IF;
  PERFORM pg_temp.log('R4나', '같은 값의 시행 → ' || left(v_r, 120));
END
$rh_r4b_preview$;
`
}

// E: 4-6 작은 스크립트(행 잠금뿐 — 지금 돌려도 됨)
function caseWithdrawText() {
  return isolatedCase('rh_e_withdraw_text', 'E', `
    DECLARE
      c_original constant text := '지금은 탈퇴 신청을 받을 수 없습니다. 잠시 후 다시 이용해 주세요.';
      v_first text;
      v_policy_before jsonb := (SELECT value FROM public.system_settings WHERE key = 'member_withdrawal_policy');
      v_last jsonb;
      v_count integer := (SELECT count(*) FROM public.admin_audit_log WHERE details ->> 'bundle' = 'bundle15_withdraw_disabled_text');
    BEGIN
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.wd_sql(NULL)), 'ERR WITHDRAW_TEXT: set c_mode', 'E', 'c_mode NULL → 멈춤');
      IF pg_temp.disabled_text() IS DISTINCT FROM c_original THEN
        v_log := v_log || ('운영 값이 원래 문구가 아님(이미 notice 됨): ' || left(pg_temp.disabled_text(), 40));
      END IF;
      -- restore 는 고지 문구일 때만
      IF pg_temp.disabled_text() = c_original THEN
        v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.wd_sql('restore')), 'ERR WITHDRAW_TEXT: DISABLED is not the last notice text', 'E', '원래 문구에서 restore → 멈춤');
      END IF;
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.wd_sql('notice')), 'OK', 'E', 'notice');
      v_first := pg_temp.disabled_text();
      v_log := v_log || pg_temp.ensure(v_first = '지금은 이 화면에서 탈퇴를 받을 수 없습니다. 고객센터(이메일·전화)로 탈퇴를 요청해 주세요. 요청일부터 10일 안에 처리해 이메일로 알려 드립니다. 2027년 1월 11일 전에 요청하시면 바뀌기 전 약관(2026년 11월 23일 시행)이 적용됩니다.',
        'E', 'notice 문구 = 계획 4-6');
      v_log := v_log || pg_temp.ensure(jsonb_set((SELECT value FROM public.system_settings WHERE key = 'member_withdrawal_policy'), '{texts,blockReasons,DISABLED}', v_policy_before #> '{texts,blockReasons,DISABLED}') = v_policy_before,
        'E', 'DISABLED 한 경로만 바뀜');
      SELECT details INTO v_last FROM public.admin_audit_log WHERE details ->> 'bundle' = 'bundle15_withdraw_disabled_text' ORDER BY (details ->> 'saved_at')::timestamptz DESC LIMIT 1;
      v_log := v_log || pg_temp.ensure((v_last ->> 'after') = v_first AND (v_last ->> 'mode') = 'notice' AND jsonb_typeof(v_last -> 'before') = 'string'
        AND (v_last ->> 'saved_at') IS NOT NULL AND (SELECT count(*) FROM public.admin_audit_log WHERE details ->> 'bundle' = 'bundle15_withdraw_disabled_text') = v_count + 1,
        'E', '기록: action member_withdrawal_policy_update·after 문자열·saved_at');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.wd_sql('notice')), 'ERR WITHDRAW_TEXT: DISABLED is already this notice text', 'E', '같은 notice 다시 → 멈춤');
      -- 시행일 상수를 바꾼 두 번째 notice → restore
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.wd_sql('notice', DATE '2027-02-15')), 'OK', 'E', '시행일 2027-02-15 로 두 번째 notice');
      v_log := v_log || pg_temp.ensure(pg_temp.disabled_text() LIKE '%2027년 2월 15일 전에 요청하시면%', 'E', '두 번째 문구 날짜');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.wd_sql('restore')), 'OK', 'E', 'restore');
      v_log := v_log || pg_temp.ensure(pg_temp.disabled_text() = c_original, 'E', '원래 문구로 돌아옴');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.wd_sql('restore')), 'ERR WITHDRAW_TEXT: DISABLED is not the last notice text', 'E', '다시 restore → 멈춤');
      -- 손으로 바꾼 값이면 멈춤
      UPDATE public.system_settings SET value = jsonb_set(value, '{texts,blockReasons,DISABLED}', '"손으로 바꾼 문구"') WHERE key = 'member_withdrawal_policy';
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.wd_sql('notice')), 'ERR WITHDRAW_TEXT: DISABLED is neither', 'E', '손으로 바꾼 값 → notice 멈춤');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.wd_sql('restore')), 'ERR WITHDRAW_TEXT: DISABLED is not the last notice text', 'E', '손으로 바꾼 값 → restore 멈춤');
    END;`)
}

// A(새벽): R1 적용, R3 쓰기 막기·잠금, R5-2 되돌리기 → 다시 적용. 표 잠금 DDL(POLICY·DROP)이 있다.
function casesDdl() {
  return `
-- R1 결과 확인(마이그레이션 VERIFY 두 블록이 이미 통과함)
DO $rh_r1$
BEGIN
  PERFORM pg_temp.log('R1', pg_temp.ensure((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
    AND policyname IN ('system_settings_site_notice_popup_no_client_write', 'system_settings_policy_upcoming_documents_no_client_write')) = 2, 'R1', '정책 2개'));
  PERFORM pg_temp.log('R1', pg_temp.ensure((SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
    AND tgname IN ('lock_policy_documents_during_notice', 'lock_withdrawal_texts_during_notice', 'lock_consent_items_during_notice')) = 3, 'R1', '트리거 3개'));
  PERFORM pg_temp.log('R1', pg_temp.ensure((SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
    AND p.proname IN ('save_site_notice_popup', 'site_notice_popup_content_sha256', 'policy_upcoming_notice_continuity', 'policy_upcoming_notice_record_good',
                      'lock_policy_documents_during_notice_fn', 'lock_withdrawal_texts_during_notice_fn', 'lock_consent_items_during_notice_fn')) = 7,
    'R1', '함수 7개(팝업 2·판정 2·트리거 3)'));
  PERFORM pg_temp.log('R1', pg_temp.ensure((SELECT value -> 'enabled' FROM public.system_settings WHERE key = 'site_notice_popup') = 'false'::jsonb, 'R1', '팝업 행 꺼짐'));
END
$rh_r1$;
${isolatedCase('rh_r3_locks', 'R3', `
    DECLARE
      v_owner uuid := pg_temp.owner_id();
      v_n integer;
      v_item public.signup_consent_items%ROWTYPE;
    BEGIN
      -- 게시 행(사본으로 게시) → 두 키가 모두 있는 상태
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(pg_temp.pt_sql('publish_upcoming', pg_temp.kst_today() + 40, pg_temp.kst_today() + 3, pg_temp.kst_today() + 40)),
        'OK', 'R3', '게시');
      -- authenticated(대표 세션)로 두 키 UPDATE → 0행, postgres 로는 1행
      PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      UPDATE public.system_settings SET updated_at = updated_at WHERE key = 'site_notice_popup';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      RESET ROLE;
      v_log := v_log || pg_temp.ensure(v_n = 0, 'R3', 'authenticated → site_notice_popup UPDATE 0행');
      SET LOCAL ROLE authenticated;
      UPDATE public.system_settings SET updated_at = updated_at WHERE key = 'policy_upcoming_documents';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      RESET ROLE;
      v_log := v_log || pg_temp.ensure(v_n = 0, 'R3', 'authenticated → policy_upcoming_documents UPDATE 0행');
      SET LOCAL ROLE authenticated;
      UPDATE public.system_settings SET updated_at = updated_at WHERE key = 'site_brand';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      RESET ROLE;
      v_log := v_log || pg_temp.ensure(v_n = 1, 'R3', '대조: authenticated(대표) → site_brand UPDATE 1행');
      UPDATE public.system_settings SET updated_at = updated_at WHERE key IN ('site_notice_popup', 'policy_upcoming_documents');
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_log := v_log || pg_temp.ensure(v_n = 2, 'R3', 'postgres → 두 키 UPDATE 2행');
      -- 약관 문서: 게시 행의 문서 content·slug·title·enabled → 막힘, 다른 칸 → 통과
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,refundPolicy,content}', to_jsonb((value #>> '{policyDocuments,refundPolicy,content}') || ' ')) WHERE key = 'site_footer_content'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', '환불정책 본문 → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,privacyPolicy,slug}', '"privacy2"') WHERE key = 'site_footer_content'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', '처리방침 slug → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,serviceTerms,title}', '"이용약관2"') WHERE key = 'site_footer_content'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', '이용약관 title → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,serviceTerms,enabled}', 'false') WHERE key = 'site_footer_content'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', '이용약관 enabled → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{extraNotices}', '["RH"]') WHERE key = 'site_footer_content'$s$),
        'OK', 'R3', '추가 안내 문구 → 통과');
      -- 가입 동의 항목: terms 본문(저장 함수) → 막힘, age14 정렬 → 통과
      SELECT * INTO v_item FROM public.signup_consent_items WHERE key = 'terms';
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('SELECT public.save_signup_consent_item(%L, %L, %s, %L, %L, %L, %L, %s, %L, %L, %L, false)',
          v_owner, v_item.id, v_item.version, v_item.label, v_item.content || ' RH', v_item.required, v_item.policy_slug, v_item.sort_order, v_item.is_active, 'RH', v_item.updated_at)),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', '동의 항목 terms 본문 저장 → 막힘');
      SELECT * INTO v_item FROM public.signup_consent_items WHERE key = 'age14';
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(format('SELECT public.save_signup_consent_item(%L, %L, %s, %L, %L, %L, %L, %s, %L, %L, %L, false)',
          v_owner, v_item.id, v_item.version, v_item.label, v_item.content, v_item.required, v_item.policy_slug, v_item.sort_order + 1, v_item.is_active, NULL, v_item.updated_at)),
        'OK', 'R3', '동의 항목 age14 정렬 → 통과');
      -- 탈퇴 정책: 잠금 경로(숫자 키·문구·termsVersion)·스위치 켜기 → 막힘, DISABLED·목록 밖 → 통과
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{paymentRetentionYears}', '6') WHERE key = 'member_withdrawal_policy'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', '숫자 키 paymentRetentionYears → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{texts,blockReasons,REFUND_PERIOD_OPEN}', '"x"') WHERE key = 'member_withdrawal_policy'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', 'w_paths 문구 → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{texts,notice,termsVersion}', '"x"') WHERE key = 'member_withdrawal_policy'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', 'texts.notice.termsVersion → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{selfAnonymizeEnabled}', 'true') WHERE key = 'member_withdrawal_policy'$s$),
        'ERR POLICY_UPCOMING_LOCKED', 'R3', '스위치 켜기 → 막힘');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{texts,blockReasons,DISABLED}', '"RH"') WHERE key = 'member_withdrawal_policy'$s$),
        'OK', 'R3', 'DISABLED → 통과');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{redactionAccountRequestKeywords}', value -> 'redactionAccountRequestKeywords') WHERE key = 'member_withdrawal_policy'$s$),
        'OK', 'R3', '목록 밖 키 → 통과');
      -- 시행 순서: applied 먼저 → 저장 성공
      UPDATE public.system_settings SET value = jsonb_set(value, '{status}', '"applied"') WHERE key = 'policy_upcoming_documents';
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{policyDocuments,refundPolicy,content}', to_jsonb((value #>> '{policyDocuments,refundPolicy,content}') || ' ')) WHERE key = 'site_footer_content'$s$),
        'OK', 'R3', 'applied 먼저 → 본문 저장 성공');
      v_log := v_log || pg_temp.expect(pg_temp.try_sql($s$UPDATE public.system_settings SET value = jsonb_set(value, '{selfAnonymizeEnabled}', 'true') WHERE key = 'member_withdrawal_policy'$s$),
        'OK', 'R3', 'applied 뒤 스위치 켜기 → 통과');
    END;`)}
-- R5-2 (앞): 팝업이 켜진 채 down → 사전 점검에서 멈춤(바뀌는 것 없음)
${isolatedCase('rh_r52_enabled_stop', 'R5-2', `
    BEGIN
      UPDATE public.system_settings SET value = jsonb_set(value, '{enabled}', 'true') WHERE key = 'site_notice_popup';
      v_r := pg_temp.try_sql(${dollar('rh_down_precheck', extractDoBlock(read(SOURCES.down), 'down_site_notice_popup_precheck', 'down'))});
      v_log := v_log || pg_temp.expect(v_r, 'ERR DOWN: site_notice_popup is enabled — turn popup off first', 'R5-2', '켜진 채 down → 멈춤');
      UPDATE public.system_settings SET value = jsonb_set(value, '{enabled}', 'false') WHERE key = 'site_notice_popup';
      v_log := v_log || pg_temp.expect(pg_temp.try_sql(${dollar('rh_down_precheck2', extractDoBlock(read(SOURCES.down), 'down_site_notice_popup_precheck', 'down'))}), 'OK', 'R5-2', '꺼진 상태 → 사전 점검 통과');
    END;`)}
-- R5-2: 4-5 되돌리기(down) → 지울 것 0건, policy_upcoming_documents 정책은 남음 → 다시 적용(그 정책은 1개)
${read(SOURCES.down)}
DO $rh_r52_after_down$
BEGIN
  PERFORM pg_temp.log('R5-2', 'down 통과(down VERIFY: 트리거·함수·정책·행 0건, policy_upcoming_documents 정책 남음)');
END
$rh_r52_after_down$;
${read(SOURCES.migration)}
DO $rh_r52_reapply$
BEGIN
  PERFORM pg_temp.log('R5-2', pg_temp.ensure((SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'system_settings'
    AND policyname = 'system_settings_policy_upcoming_documents_no_client_write') = 1, 'R5-2', '다시 적용 성공·게시 행 정책 1개'));
  PERFORM pg_temp.log('R5-2', pg_temp.ensure((SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
    AND tgname IN ('lock_policy_documents_during_notice', 'lock_withdrawal_texts_during_notice', 'lock_consent_items_during_notice')) = 3
    AND (SELECT value -> 'enabled' FROM public.system_settings WHERE key = 'site_notice_popup') = 'false'::jsonb, 'R5-2', 'R1 과 같은 값(트리거 3·팝업 행 꺼짐)'));
END
$rh_r52_reapply$;
`
}

const FOOT = `
SELECT n, test, msg, payload FROM _rh_log ORDER BY n;
ROLLBACK;
`

export function buildRehearsalFiles() {
  const policySource = read(SOURCES.policyText)
  const policyText = extractDoBlock(policySource, 'policy_text', 'policy text')
  const revert = extractRevertBlock(policySource)
  const withdrawText = extractDoBlock(read(SOURCES.withdrawText), 'withdraw_disabled_text', 'withdraw text')
  const head = (title, when) => prelude({ title, when, policyText, withdrawText, revert })
  const files = {}

  files['e_withdraw_text.sql'] = head('E — 4-6 작은 스크립트(notice → restore, 멈춤 경우)',
    '지금 돌려도 됨(member_withdrawal_policy 행 잠금뿐, DDL 없음). 10번 push 전 notice 실행 전에 한 번 더 돌린다.')
    + caseWithdrawText() + FOOT

  files['b_cases_light.sql'] = head('B light — 좋은 기록 예시·R2 저장 함수·고지 끊김 판정·R4 (가)(다)(트리거·정책 없는 사본)',
    '지금 돌려도 됨(CREATE FUNCTION·행 삽입·행 잠금·동의 항목 advisory 잠금뿐 — CREATE TRIGGER/POLICY·DROP 없음). 트리거 순서는 b_cases(새벽)가 본다.')
    + `-- ===== 15번 마이그레이션 사본(light: 정책 2개·정책 VERIFY·트리거 3개 뺌) =====\n${migrationCopy('light')}\n${POPUP_HELPERS}`
    + caseRecordGood() + caseSaveFunction() + caseContinuity() + casesPolicyText(['skip_policies', 'skip_triggers'], false) + FOOT

  files['b_cases.sql'] = head('B — 좋은 기록 예시·R2·고지 끊김 판정·R4 (가)(다)(실제 트리거, 정책 없는 사본)',
    '새벽 03~04시(CREATE TRIGGER 가 system_settings·signup_consent_items 쓰기를 거래 동안 막음). 읽기는 막지 않음.')
    + `-- ===== 15번 마이그레이션 사본(nopolicy: 정책 2개·정책 VERIFY 뺌) =====\n${migrationCopy('nopolicy')}\n${POPUP_HELPERS}`
    + caseRecordGood() + caseSaveFunction() + caseContinuity() + casesPolicyText(['skip_policies'], true) + FOOT

  files['c_preview_light.sql'] = head('C light — R4 (나) 실제 시행일 값으로 게시 → 미리보기 파일·지문 5개(트리거·정책 없는 사본)',
    '지금 돌려도 됨(DDL 잠금 없음). 결과 payload 를 output/b15-upcoming-preview.json 으로 꺼낸다. 새벽의 c_preview 로 같은 지문인지 다시 본다.')
    + `-- ===== 15번 마이그레이션 사본(light) =====\n${migrationCopy('light')}\n${POPUP_HELPERS}`
    + casePreview(['skip_policies', 'skip_triggers']) + FOOT

  files['c_preview.sql'] = head('C — R4 (나) 실제 시행일 값으로 게시 → 미리보기 파일·지문 5개(실제 트리거, 정책 없는 사본)',
    '새벽 03~04시(CREATE TRIGGER). 별도 짧은 거래(원칙 2).')
    + `-- ===== 15번 마이그레이션 사본(nopolicy) =====\n${migrationCopy('nopolicy')}\n${POPUP_HELPERS}`
    + casePreview(['skip_policies']) + FOOT

  files['d_preview_after_apply.sql'] = head('D — 15번 마이그레이션 적용 뒤: 실제 객체로 R4 (나) 게시 → 미리보기 파일·지문 5개(사본 없음)',
    '지금 돌려도 됨(15번 마이그레이션이 운영에 적용된 뒤에만. DDL 없음 — 게시 행 삽입·작업 기록·행 잠금뿐, 끝에 ROLLBACK). 결과 payload 를 output/b15-upcoming-preview.json 으로 꺼낸다.')
    + casePreview([]) + FOOT

  files['a_ddl.sql'] = head('A — R1 적용·R3 쓰기 막기와 잠금·R5-2 되돌리기 → 다시 적용(실제 마이그레이션)',
    '새벽 03~04시만. CREATE/DROP POLICY·DROP TRIGGER 가 system_settings·signup_consent_items 읽기까지 막는다. lock_timeout 3초.')
    + `-- ===== R1: 15번 마이그레이션(원본 그대로) =====\n${migrationCopy('full')}\n${POPUP_HELPERS}`
    + casesDdl() + FOOT

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
