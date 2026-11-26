import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildRehearsalFiles,
  extractRevertBlock,
  migrationCopy,
  MIGRATION_LIGHT_VERIFY,
  POLICY_TEXT_LINES,
  WITHDRAW_TEXT_LINES,
} from '../supabase/scripts/bundle15_rehearsal/generate.mjs'

// 15번 계획(docs/plan-bundle15-notice-popup.md) 11-1 의 DB 쪽 계약: 마이그레이션·되돌리기·10번 약관 스크립트·4-6 작은 스크립트·리허설 파일.
// 화면 쪽 계약은 tests/bundle15-notice-popup-contract.test.mjs 가 본다.

const ROOT = new URL('../', import.meta.url).pathname
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const MIGRATION = read('supabase/migrations/20261205100000_site_notice_popup.sql')
const DOWN = read('supabase/rollback/20261205100000_site_notice_popup_down.sql')
const SCRIPT = read('supabase/scripts/20261126_bundle10_policy_text.sql')
const WITHDRAW = read('supabase/scripts/20261205_bundle15_withdraw_disabled_text.sql')
const EMAIL = read('docs/notice-2027-01-terms-change.md')
const REHEARSAL_DIR = 'supabase/scripts/bundle15_rehearsal'

const fn = (source, name) => {
  const match = source.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\$fn_${name.replace(/_fn$/, '')}\\$;`))
  assert.ok(match, `${name} not found`)
  return match[0]
}
const between = (source, start, end) => {
  const i = source.indexOf(start)
  const j = source.indexOf(end, i + start.length)
  assert.ok(i >= 0 && j > i, `${start} … ${end}`)
  return source.slice(i, j)
}
// 주석 줄을 뺀 SQL(주석 속 낱말이 검사에 걸리지 않게)
const code = (sql) => sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
const count = (text, needle) => text.split(needle).length - 1

// ---------------------------------------------------------------------------------------------------------------
// 마이그레이션(4-1·4-2·4-4)
// ---------------------------------------------------------------------------------------------------------------
test('마이그레이션: lock_timeout·statement_timeout, 초안 행은 꺼진 채 ON CONFLICT DO NOTHING, 끝 2027-01-12 00:00 KST', () => {
  assert.match(MIGRATION, /\nSET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';\n/)
  const insert = between(MIGRATION, "INSERT INTO public.system_settings (key, value, description, updated_at)\nSELECT 'site_notice_popup'", 'ON CONFLICT (key) DO NOTHING;')
  assert.match(insert, /'enabled', false,/)
  assert.match(insert, /'endsAt', to_jsonb\(timestamptz '2027-01-12 00:00:00\+09'\)/)
  assert.match(insert, /'contentSha256', public\.site_notice_popup_content_sha256\(d\.title, d\.body, d\.link_url, d\.link_label\)/)
  assert.match(insert, /'revision', 1\)/)
  assert.match(insert, /'\/terms\/upcoming'::text AS link_url/)
})

test('마이그레이션: 내용 지문은 STABLE, 규칙 site_notice_popup:v1 LF 제목 LF 링크 LF 링크 이름 LF 본문', () => {
  const sha = fn(MIGRATION, 'site_notice_popup_content_sha256')
  assert.match(sha, /\n STABLE\n/)
  assert.doesNotMatch(sha, /IMMUTABLE/)
  assert.ok(sha.includes(`'site_notice_popup:v1' || E'\\n' || p_title || E'\\n' || coalesce(p_link_url, '') || E'\\n' || coalesce(p_link_label, '') || E'\\n' || p_body`))
  assert.match(sha, /convert_to\([\s\S]*'UTF8'\)\), 'hex'\)/)
})

test('저장 함수: SECURITY DEFINER·search_path, service_role 만 EXECUTE, 대표 확인·판 비교·입력 검사·같은 함수 안 작업 기록', () => {
  const save = fn(MIGRATION, 'save_site_notice_popup')
  assert.match(save, /\n SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\n/)
  const signature = 'uuid, integer, boolean, text, text, text, text, timestamptz, timestamptz'
  assert.ok(MIGRATION.includes(`REVOKE ALL ON FUNCTION public.save_site_notice_popup(${signature})\n  FROM PUBLIC, anon, authenticated, service_role;`))
  assert.ok(MIGRATION.includes(`GRANT EXECUTE ON FUNCTION public.save_site_notice_popup(${signature})\n  TO service_role;`))
  assert.match(save, /p\.is_admin IS TRUE AND p\.admin_role = 'owner'/)
  assert.match(save, /RAISE EXCEPTION 'NOTICE_POPUP_ACTOR_NOT_OWNER'/)
  assert.match(save, /WHERE s\.key = 'site_notice_popup' FOR UPDATE;/)
  assert.match(save, /v_old_rev IS DISTINCT FROM p_expected_revision THEN\n {4}RAISE EXCEPTION 'NOTICE_POPUP_REVISION_CONFLICT';/)
  for (const field of ['title', 'body', 'linkUrl', 'linkLabel', 'endsAt']) {
    assert.ok(save.includes(`'NOTICE_POPUP_INPUT_INVALID: ${field}'`), field)
  }
  assert.match(save, /char_length\(v_title\) NOT BETWEEN 1 AND 60/)
  assert.match(save, /char_length\(v_body\) NOT BETWEEN 1 AND 1200/)
  assert.match(save, /left\(v_link, 1\) <> '\/' OR left\(v_link, 2\) IN \('\/\/', '\/\\'\)/)
  assert.match(save, /char_length\(v_link\) > 200/)
  assert.match(save, /char_length\(v_label\) > 20/)
  assert.match(save, /p_enabled AND \(p_ends_at IS NULL OR p_ends_at <= v_now\)/)
  // 바뀐 것이 없으면 저장·기록 없음
  assert.match(save, /RETURN jsonb_build_object\('changed', false, 'value', v_old, 'auditId', NULL\);/)
  assert.ok(save.indexOf("'changed', false") < save.indexOf('UPDATE public.system_settings'))
  // 같은 거래 안 작업 기록: details 키와 saved_at = clock_timestamp()
  assert.match(save, /v_saved_at := clock_timestamp\(\);/)
  assert.match(save, /public\.record_admin_audit\(p_actor_id, 'site_notice_popup_save', 'system_settings', 'site_notice_popup'/)
  const details = between(save, "'revision_before', v_old_rev,", "'saved_at', to_jsonb(v_saved_at))")
  for (const key of ['revision_after', 'before', 'after', 'content_sha256_before', 'content_sha256_after', 'content_changed', 'visible_before', 'visible_after', 'exposure_starts_at']) {
    assert.ok(details.includes(`'${key}',`), key)
  }
  assert.match(save, /'exposure_starts_at', CASE WHEN p_enabled THEN to_jsonb\(GREATEST\(v_now, p_starts_at\)\) ELSE 'null'::jsonb END/)
  assert.match(save, /'revision', v_old_rev \+ 1\)/)
  assert.match(save, /updated_at = v_now WHERE key = 'site_notice_popup'/)
})

test('고지 끊김 판정: 게시 행의 시행일·마감일을 읽고 인자는 대조만, 판정 순서 4-3, service_role 만', () => {
  const cont = fn(MIGRATION, 'policy_upcoming_notice_continuity')
  assert.match(cont, /\(p_effective_date date DEFAULT NULL, p_notice_deadline date DEFAULT NULL\)/)
  assert.match(cont, /\n STABLE\n SECURITY DEFINER\n/)
  assert.match(cont, /v_effective := \(v_row ->> 'effectiveDate'\)::date;\n {2}v_deadline := \(v_row ->> 'noticeDeadline'\)::date;/)
  const order = ["'NO_PUBLICATION'", "'ARG_MISMATCH'", "'NOT_UPCOMING'", "'PUBLISHED_AFTER_DEADLINE'", "'NO_RECORDS'", "'LAST_NOT_GOOD'", "'START_AFTER_DEADLINE'", "'REVISION_MISMATCH'"]
  const positions = order.map((reason) => cont.indexOf(reason))
  assert.ok(positions.every((p) => p > 0))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, '판정 순서')
  assert.match(cont, /a\.action = 'site_notice_popup_save'\n {7}AND \(a\.details ->> 'saved_at'\)::timestamptz > v_published\n {5}ORDER BY \(a\.details ->> 'saved_at'\)::timestamptz DESC, a\.id DESC/)
  // S 기록에서만 미래 시작을 받는다
  assert.match(cont, /\(v_rec\.details -> 'after'\) - 'startsAt'/)
  // 미래 시작 기록은 마지막 기록이거나 시작이 바로 뒤 좋은 기록의 저장 시각 이하일 때만 S(거짓 멈춤 방지)
  assert.match(cont, /AND \(v_s_id IS NULL OR \(v_rec\.details #>> '\{after,startsAt\}'\)::timestamptz <= v_s_saved\)/)
  assert.match(cont, /GREATEST\(v_s_saved, v_s_start\) AT TIME ZONE 'Asia\/Seoul'\)::date > v_deadline/)
  assert.ok(MIGRATION.includes('GRANT EXECUTE ON FUNCTION public.policy_upcoming_notice_continuity(date, date) TO service_role;'))
  const good = fn(MIGRATION, 'policy_upcoming_notice_record_good')
  assert.match(good, /\(p_after ->> 'linkUrl'\) = '\/terms\/upcoming'/)
  assert.match(good, /\(p_after ->> 'endsAt'\)::timestamptz >= \(p_effective_date::timestamp AT TIME ZONE 'Asia\/Seoul'\)/)
  assert.match(good, /position\(p_effective_date_label IN coalesce\(p_after ->> 'body', ''\)\) > 0/)
  assert.match(good, /\(p_after ->> 'startsAt'\)::timestamptz <= p_saved_at/)
  assert.ok(MIGRATION.includes('REVOKE ALL ON FUNCTION public.policy_upcoming_notice_record_good(jsonb, timestamptz, date, text) FROM PUBLIC, anon, authenticated, service_role;'))
})

test('잠금 트리거 3개: 키 조건, upcoming 일 때만, 막는 칸, 목록은 게시 행에서 읽음(상수 없음), DISABLED 는 막지 않음', () => {
  assert.match(MIGRATION, /CREATE TRIGGER lock_policy_documents_during_notice\n {2}BEFORE UPDATE ON public\.system_settings\n {2}FOR EACH ROW WHEN \(NEW\.key = 'site_footer_content'\)\n/)
  assert.match(MIGRATION, /CREATE TRIGGER lock_withdrawal_texts_during_notice\n {2}BEFORE UPDATE ON public\.system_settings\n {2}FOR EACH ROW WHEN \(NEW\.key = 'member_withdrawal_policy'\)\n/)
  assert.match(MIGRATION, /CREATE TRIGGER lock_consent_items_during_notice\n {2}BEFORE UPDATE ON public\.signup_consent_items\n {2}FOR EACH ROW\n/)
  const fns = ['lock_policy_documents_during_notice_fn', 'lock_consent_items_during_notice_fn', 'lock_withdrawal_texts_during_notice_fn']
    .map((name) => MIGRATION.match(new RegExp(`CREATE FUNCTION public\\.${name}\\(\\)[\\s\\S]*?\\n\\$fn_${name.replace(/_fn$/, '')}\\$;`))[0])
  for (const body of fns) {
    assert.match(body, /SELECT s\.value INTO v_pub FROM public\.system_settings s WHERE s\.key = 'policy_upcoming_documents';\n {2}IF v_pub IS NULL OR \(v_pub ->> 'status'\) IS DISTINCT FROM 'upcoming' THEN\n {4}RETURN NEW;/)
    assert.match(body, /RAISE EXCEPTION 'POLICY_UPCOMING_LOCKED: /)
    // 문서 key·동의 항목 key·탈퇴 정책 경로를 상수로 두지 않는다
    assert.doesNotMatch(body, /'(serviceTerms|refundPolicy|privacyPolicy|terms|privacy)'/)
    assert.doesNotMatch(body, /DISABLED|paymentRetentionYears|REFUND_PERIOD/)
  }
  assert.match(fns[0], /jsonb_array_elements\(coalesce\(v_pub -> 'documents', '\[\]'::jsonb\)\)/)
  assert.match(fns[0], /ARRAY\['content', 'slug', 'title', 'enabled'\]/)
  assert.match(fns[1], /jsonb_array_elements\(coalesce\(v_pub -> 'consentItems', '\[\]'::jsonb\)\)/)
  for (const column of ['content', 'label', 'version', 'required', 'is_active', 'policy_slug']) {
    assert.ok(fns[1].includes(`NEW.${column} IS DISTINCT FROM OLD.${column}`), column)
  }
  assert.match(fns[2], /jsonb_array_elements_text\(coalesce\(v_pub -> 'lockedWithdrawalPaths', '\[\]'::jsonb\)\)/)
  assert.match(fns[2], /\(NEW\.value -> 'selfAnonymizeEnabled'\) = 'true'::jsonb AND \(OLD\.value -> 'selfAnonymizeEnabled'\) IS DISTINCT FROM 'true'::jsonb/)
})

test('쓰기 막기 정책 2개(RESTRICTIVE FOR UPDATE), 게시 행 정책은 없을 때만 만듦, 정책 VERIFY 는 이름 붙인 별도 블록, DROP 없음', () => {
  assert.match(MIGRATION, /\nCREATE POLICY system_settings_site_notice_popup_no_client_write\n {2}ON public\.system_settings\n {2}AS RESTRICTIVE\n {2}FOR UPDATE\n {2}USING \(key <> 'site_notice_popup'\)\n {2}WITH CHECK \(key <> 'site_notice_popup'\);/)
  const guarded = between(MIGRATION, 'DO $create_policy_upcoming_documents_policy$', '$create_policy_upcoming_documents_policy$;\n')
  assert.match(guarded, /IF NOT EXISTS \(SELECT 1 FROM pg_policies[\s\S]*policyname = 'system_settings_policy_upcoming_documents_no_client_write'\) THEN\n {4}CREATE POLICY system_settings_policy_upcoming_documents_no_client_write/)
  assert.match(guarded, /AS RESTRICTIVE\n {6}FOR UPDATE\n {6}USING \(key <> 'policy_upcoming_documents'\)\n {6}WITH CHECK \(key <> 'policy_upcoming_documents'\);/)
  assert.equal(count(code(MIGRATION), 'CREATE POLICY'), 2)
  assert.match(MIGRATION, /\nDO \$verify_site_notice_popup_policies\$\n[\s\S]*?pg_policies[\s\S]*?\n\$verify_site_notice_popup_policies\$;\n/)
  assert.doesNotMatch(between(MIGRATION, 'DO $verify_site_notice_popup$', '$verify_site_notice_popup$;'), /pg_policies/)
  assert.doesNotMatch(code(MIGRATION), /DROP (TRIGGER|POLICY|FUNCTION)/)
})

test('되돌리기: 트리거 → 트리거 함수 → 팝업·판정 함수 → 팝업 정책 → 팝업 행, 게시 행 정책·행은 남김', () => {
  const body = code(DOWN)
  assert.match(body, /SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '30s';/)
  const order = [
    'DROP TRIGGER lock_policy_documents_during_notice', 'DROP TRIGGER lock_withdrawal_texts_during_notice', 'DROP TRIGGER lock_consent_items_during_notice',
    'DROP FUNCTION public.lock_policy_documents_during_notice_fn()', 'DROP FUNCTION public.lock_withdrawal_texts_during_notice_fn()', 'DROP FUNCTION public.lock_consent_items_during_notice_fn()',
    'DROP FUNCTION public.save_site_notice_popup(', 'DROP FUNCTION public.site_notice_popup_content_sha256(', 'DROP FUNCTION public.policy_upcoming_notice_continuity(',
    'DROP FUNCTION public.policy_upcoming_notice_record_good(',
    'DROP POLICY system_settings_site_notice_popup_no_client_write', "DELETE FROM public.system_settings WHERE key = 'site_notice_popup';",
  ]
  const positions = order.map((needle) => body.indexOf(needle))
  assert.ok(positions.every((p) => p >= 0), JSON.stringify(positions))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions)
  assert.doesNotMatch(body, /DROP POLICY system_settings_policy_upcoming_documents_no_client_write/)
  assert.doesNotMatch(body, /policy_upcoming_documents'/)
  assert.match(body, /RAISE EXCEPTION 'DOWN VERIFY: policy_upcoming_documents policy must stay'/)
  // 팝업이 켜져 있으면 지우기 전에 멈춘다(먼저 끄고 저장해 끈 기록을 남김)
  assert.ok(body.indexOf("RAISE EXCEPTION 'DOWN: site_notice_popup is enabled — turn popup off first") < body.indexOf('DROP TRIGGER'))
  assert.match(body, /IF \(SELECT value -> 'enabled' FROM public\.system_settings WHERE key = 'site_notice_popup'\) = 'true'::jsonb THEN/)
})

// ---------------------------------------------------------------------------------------------------------------
// 10번 약관 스크립트(4-3)
// ---------------------------------------------------------------------------------------------------------------
const DO_BLOCK = SCRIPT.match(/\nDO \$policy_text\$\n[\s\S]*?\n\$policy_text\$;\n/)[0]

test('10번 스크립트: c_mode NULL 이면 멈춤, 날짜 상수 셋·상수 검사(−32, >=), v_date 는 c_effective_date 로', () => {
  for (const line of Object.values(POLICY_TEXT_LINES)) {
    assert.equal(count(DO_BLOCK, line), 1, line)
  }
  assert.match(DO_BLOCK, /IF c_mode IS NULL OR c_mode NOT IN \('publish_upcoming', 'apply', 'withdraw_upcoming'\) THEN\n {4}RAISE EXCEPTION 'POLICY_TEXT: set c_mode/)
  assert.ok(DO_BLOCK.includes(POLICY_TEXT_LINES.constCheck + "\n    RAISE EXCEPTION 'POLICY_TEXT: constants"))
  assert.match(DO_BLOCK, /v_date text := to_char\(c_effective_date, 'YYYY"년" FMMM"월" FMDD"일"'\);/)
  assert.doesNotMatch(DO_BLOCK, /to_char\(timezone\('Asia\/Seoul', now\(\)\)/)
  assert.match(DO_BLOCK, /IF c_mode = 'apply' AND NOT \(v_today BETWEEN c_effective_date AND c_apply_last_date\) THEN/)
  // 머리 주석의 '바로 시행 전제' 설명은 30일 고지 경로로 바뀌었다
  assert.doesNotMatch(SCRIPT, /바로 시행 전제\(계획 7절/)
  assert.match(SCRIPT, /30일 전 고지 경로: 계획 docs\/plan-bundle15-notice-popup\.md 4-3/)
})

test('10번 스크립트: 쌍은 모두 4칸([옛, 새, 표시 이름, replace|insert]), insert 확인 문장, TRNX 최소 5', () => {
  for (const name of ['t_pairs', 'r_pairs', 'p_pairs', 'it_pairs', 'ip_pairs']) {
    const block = between(DO_BLOCK, `  ${name} := ARRAY[`, '\n  ];')
    const rows = block.match(/'(replace|insert)'\]/g) ?? []
    // 각 행 끝은 표시 방식이고, 행 수 = 표시 방식 수(빠진 4칸 행이 없음)
    const opened = (block.match(/\n {4}ARRAY\[/g) ?? []).length
    assert.equal(rows.length, opened, name)
  }
  assert.equal((between(DO_BLOCK, '  t_pairs := ARRAY[', '\n  ];').match(/'(replace|insert)'\]/g) ?? []).length, 2)
  assert.equal((between(DO_BLOCK, '  r_pairs := ARRAY[', '\n  ];').match(/'(replace|insert)'\]/g) ?? []).length, 1)
  assert.equal((between(DO_BLOCK, '  p_pairs := ARRAY[', '\n  ];').match(/'(replace|insert)'\]/g) ?? []).length, 7)
  assert.equal((between(DO_BLOCK, '  ip_pairs := ARRAY[', '\n  ];').match(/'(replace|insert)'\]/g) ?? []).length, 2)
  assert.match(DO_BLOCK, /IF v_pairs\[i\]\[4\] = 'insert' THEN\n {8}IF \(length\(v_pairs\[i\]\[2\]\) - length\(replace\(v_pairs\[i\]\[2\], v_pairs\[i\]\[1\], ''\)\)\) \/ length\(v_pairs\[i\]\[1\]\) IS DISTINCT FROM 1 THEN/)
  assert.match(DO_BLOCK, /'before', '\(없음 — 새로 생김\)'/)
  assert.match(DO_BLOCK, /ARRAY\['TRNX', \$r\$기간이 끝난 뒤 \(\[0-9\]\+\)일 동안\$r\$, '1', 'withdrawRefundDeadlineBufferDays', '5'\]/)
  // privacy 동의 항목에 수집 항목 줄(4판)
  assert.ok(DO_BLOCK.includes("$q$- 이용 중 생성: 접속 기록, 결제 기록$q$ || E'\\n' ||\n          $q$- 회원 탈퇴 때: 탈퇴 요청 기록"))
})

test('10번 스크립트: 지문 규칙(changes LF·동의 항목 label LF version LF note LF content), lockedWithdrawalPaths, publishedAt = clock_timestamp()', () => {
  assert.match(DO_BLOCK, /string_agg\(concat_ws\(E'\\n', c ->> 'label', c ->> 'mode', c ->> 'before', c ->> 'after'\), E'\\n\\n' ORDER BY ord\)/)
  assert.match(DO_BLOCK, /concat_ws\(E'\\n', v_item_terms\.label, \(v_item_terms\.version \+ 1\)::text, c_terms_note, v_item_terms_content\)/)
  assert.match(DO_BLOCK, /concat_ws\(E'\\n', v_item_privacy\.label, \(v_item_privacy\.version \+ 1\)::text, c_privacy_note, v_item_privacy_content\)/)
  assert.match(DO_BLOCK, /encode\(sha256\(convert_to\(v_doc_after, 'UTF8'\)\), 'hex'\)/)
  assert.match(DO_BLOCK, /'lockedWithdrawalPaths', v_locked_paths,/)
  assert.match(DO_BLOCK, /SELECT w_paths\[j\]\[1\] AS p, j AS ord FROM generate_subscripts\(w_paths, 1\) j/)
  assert.match(DO_BLOCK, /SELECT c_num_checks\[j\]\[4\] AS k, j FROM generate_subscripts\(c_num_checks, 1\) j/)
  assert.match(DO_BLOCK, /UNION ALL SELECT '\{termsConsentItemKey\}', 1000\n {4}UNION ALL SELECT '\{texts,notice,termsVersion\}', 1001/)
  assert.match(DO_BLOCK, /'publishedAt', to_jsonb\(clock_timestamp\(\)\),/)
  assert.match(DO_BLOCK, /'noticeDeadline', to_char\(c_notice_deadline, 'YYYY-MM-DD'\),/)
  // /terms/upcoming 칸 이름도 게시 행 labels(DB 값)
  for (const key of ['currentLinkUpcoming', 'currentLinkApplied', 'afterFull', 'beforeFull', 'consentSection', 'before', 'after', 'checking', 'effectiveDate', 'publishedAt', 'toc', 'backToList']) {
    assert.ok(between(DO_BLOCK, "'labels', jsonb_build_object(", "'));").includes(`'${key}', `), key)
  }
})

test('10번 스크립트: 게시는 15번 마이그레이션을 확인하고 약관·동의 항목·탈퇴 정책을 UPDATE 하지 않으며, 다시 게시 규칙·기록 bundle', () => {
  assert.match(DO_BLOCK, /to_regprocedure\('public\.save_site_notice_popup\(uuid,integer,boolean,text,text,text,text,timestamp with time zone,timestamp with time zone\)'\) IS NULL/)
  assert.match(DO_BLOCK, /to_regprocedure\('public\.policy_upcoming_notice_continuity\(date,date\)'\) IS NULL/)
  assert.ok(DO_BLOCK.includes(POLICY_TEXT_LINES.policyCheck))
  // 저장 UPDATE·동의 항목 저장은 모두 c_mode = 'apply' 구역 안(게시 경로는 그 앞에서 RETURN)
  const applyStart = DO_BLOCK.indexOf("  IF c_mode = 'apply' THEN\n  -- 3. 약관 본문 저장")
  assert.ok(applyStart > 0)
  for (const needle of ["WHERE key = 'site_footer_content';\n  GET DIAGNOSTICS", 'public.save_signup_consent_item(', "UPDATE public.system_settings SET value = v_wpolicy_new"]) {
    const first = DO_BLOCK.indexOf(needle)
    assert.ok(first > applyStart, needle)
  }
  const publish = between(DO_BLOCK, "  IF c_mode = 'publish_upcoming' THEN\n    -- 5-7-3(게시)", '    RETURN;\n  END IF;')
  assert.doesNotMatch(publish, /key = 'site_footer_content'|signup_consent_items|key = 'member_withdrawal_policy'/)
  assert.match(publish, /ELSIF \(v_pub_old ->> 'status'\) = 'applied' THEN\n {6}RAISE EXCEPTION 'POLICY_TEXT: upcoming documents already applied/)
  assert.match(publish, /v_publish_kind := 'texts_only';\n {6}v_pub_new := v_pub_old \|\| v_pub_texts;/)
  assert.match(publish, /IF c_republish_reason IS NULL OR btrim\(c_republish_reason\) = '' THEN/)
  assert.match(publish, /'superseded'/)
  assert.match(publish, /'policy_upcoming_publish', 'system_settings', 'policy_upcoming_documents'/)
  assert.match(publish, /jsonb_build_object\('bundle', 'bundle15_policy_upcoming', 'kind', v_publish_kind,\n {8}'row', v_pub_new,/)
  // 같은 지문 판정: 문서 sha256·changesSha256·동의 항목 sha256·잠금 경로
  assert.match(publish, /d ->> 'sha256', d ->> 'changesSha256'/)
  assert.match(publish, /\(v_pub_old -> 'lockedWithdrawalPaths'\) IS NOT DISTINCT FROM v_locked_paths/)
  // 게시 VERIFY 처리표: 5-7-3 은 자리표시 검사만
  assert.match(publish, /v_text ~ '\\\{\[\^\}\]\*\\\}'/)
  assert.doesNotMatch(publish, /member_withdrawal_notice_text/)
})

test('10번 스크립트: 시행 검사 순서(상수·날짜 → 15번 마이그레이션 → 10번 0번 → 끊김 판정 → 지문) 뒤에 applied 먼저, 그다음 저장', () => {
  const order = [
    "RAISE EXCEPTION 'POLICY_TEXT: constants",
    "RAISE EXCEPTION 'POLICY_TEXT: apply runs only on",
    "RAISE EXCEPTION 'POLICY_TEXT: bundle 15 migration (functions/triggers) not applied'",
    "RAISE EXCEPTION 'POLICY_TEXT: bundle 15 migration (policies) not applied'",
    "RAISE EXCEPTION 'POLICY_TEXT: bundle 10 migration not applied'",
    "RAISE EXCEPTION 'POLICY_TEXT: selfAnonymizeEnabled must be false",
    "RAISE EXCEPTION 'POLICY_TEXT: pending withdrawal request exists",
    "RAISE EXCEPTION 'POLICY_TEXT: owner confirmation not recorded",
    "PERFORM 1 FROM public.system_settings WHERE key = 'site_notice_popup' FOR UPDATE;",
    'v_cont := public.policy_upcoming_notice_continuity(c_effective_date, c_notice_deadline);',
    "RAISE EXCEPTION 'POLICY_TEXT: notice continuity failed (%)'",
    "RAISE EXCEPTION 'POLICY_TEXT: fingerprints differ",
    "SET value = v_pub_old || jsonb_build_object('status', 'applied', 'appliedAt', clock_timestamp())",
    "WHERE key = 'site_footer_content';\n  GET DIAGNOSTICS",
  ]
  const positions = order.map((needle) => DO_BLOCK.indexOf(needle))
  assert.ok(positions.every((p) => p > 0), JSON.stringify(positions))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions)
  // 시행 기록·사본 표 최신 지문 = 게시 행 지문
  assert.match(DO_BLOCK, /'policy_upcoming_apply', 'system_settings', 'policy_upcoming_documents'/)
  assert.match(DO_BLOCK, /'continuity_s_id', v_cont -> 's_id',/)
  assert.match(DO_BLOCK, /RAISE EXCEPTION 'VERIFY: latest snapshots differ from published upcoming documents'/)
})

test('10번 스크립트: 12·13번 객체 점검과 5-0 보관 기간 대조는 apply 분기 안에만 있다(게시 지문과 무관)', () => {
  const body = code(DO_BLOCK)
  const objects = between(body, "  IF c_mode = 'apply' THEN\n    IF EXISTS (SELECT 1 FROM public.member_withdrawal_requests", '\n  END IF;\n')
  const retention = between(body, "  IF c_mode = 'apply' THEN\n    v_num := (SELECT value #>> '{admin,accessLogRetentionYears}'", '\n  END IF;\n')
  assert.match(objects, /RAISE EXCEPTION 'POLICY_TEXT: bundle 12\/13 objects missing/)
  assert.match(retention, /regexp_matches\(v_privacy_new \|\| E'\\n' \|\| v_item_privacy_content \|\| E'\\n' \|\| c_privacy_note,\s+'기록한 날부터 \(\[0-9\]\+\)년', 'g'\)/)
  assert.match(retention, /IF v_count < 3 THEN/)
  for (const needle of ['bundle 12/13 objects missing', "'{admin,accessLogRetentionYears}'"]) {
    assert.equal(count(body, needle), 1, needle)
  }
})

test('10번 스크립트: 12·13번 객체 이름 다섯 개가 12번(4-2·4-4)·13번(4-1) 계획과 같다', () => {
  const plan12 = read('docs/plan-bundle12-member-suspension.md')
  const plan13 = read('docs/plan-bundle13-cs-tools.md')
  const body = code(DO_BLOCK)
  for (const name of ['member_suspensions', 'member_admin_notes']) {
    assert.ok(body.includes(`to_regclass('public.${name}')`), name)
    assert.ok(plan12.includes(`**\`${name}\`**`), `12번 계획 ${name}`)
  }
  assert.match(body, /f\.prosrc LIKE '%member_suspensions%' AND f\.prosrc LIKE '%member_admin_notes%'/)
  assert.ok(plan12.includes('AFTER UPDATE OF `withdrawn_at` 트리거'), '12번 계획 4-4 트리거')
  assert.ok(body.includes("to_regclass('public.admin_member_access_log')"))
  assert.ok(body.includes("f.proname = 'record_admin_member_access'"))
  assert.ok(plan13.includes('**표 `admin_member_access_log`**') && plan13.includes('`record_admin_member_access('), '13번 계획 4-1')
})

test("10번 스크립트: 처리방침·동의 privacy·변경 안내의 '기록한 날부터 N년'은 정확히 5건이고 모두 2년(13번 Q5)", () => {
  const texts = [
    between(DO_BLOCK, '  p_pairs := ARRAY[', '\n  ];'),
    between(DO_BLOCK, '  ip_pairs := ARRAY[', '\n  ];'),
    between(DO_BLOCK, 'c_privacy_note constant text := $q$', '$q$;'),
  ].map(code).join('\n')
  const years = [...texts.matchAll(/기록한 날부터 ([0-9]+)년/g)].map((m) => m[1])
  assert.deepEqual(years, ['2', '2', '2', '2', '2'])
})

test('10번 스크립트: 고지 그만두기(withdraw_upcoming)·되돌리기 블록은 reverted, 확인 조회는 방식별', () => {
  const withdraw = between(DO_BLOCK, "  IF c_mode = 'withdraw_upcoming' THEN", '    RETURN;\n  END IF;')
  assert.match(withdraw, /IF c_withdraw_reason IS NULL OR btrim\(c_withdraw_reason\) = '' THEN/)
  assert.match(withdraw, /\(v_pub_old ->> 'status'\) IS DISTINCT FROM 'upcoming'/)
  assert.match(withdraw, /jsonb_build_object\('status', 'reverted', 'revertedAt', clock_timestamp\(\)\)/)
  assert.match(withdraw, /'policy_upcoming_withdraw'/)
  assert.match(withdraw, /'bundle', 'bundle15_policy_upcoming'/)
  const revert = extractRevertBlock(SCRIPT)
  assert.match(revert, /jsonb_build_object\('status', 'reverted', 'revertedAt', clock_timestamp\(\)\)[\s\S]*value ->> 'status' = 'applied'/)
  assert.doesNotMatch(revert, /'status', 'upcoming'/)
  assert.match(SCRIPT, /PERFORM set_config\('bundle15\.policy_text_mode', c_mode, false\);/)
  assert.match(SCRIPT, /SELECT current_setting\('bundle15\.policy_text_mode', true\) AS mode,/)
})

// ---------------------------------------------------------------------------------------------------------------
// 4-6 작은 스크립트
// ---------------------------------------------------------------------------------------------------------------
test('4-6 스크립트: c_mode NULL 이면 멈춤, notice 는 원래 문구·마지막 기록 after 와 같을 때만, 날짜 상수로 문구, DISABLED 한 경로, saved_at 으로 마지막 기록', () => {
  for (const line of Object.values(WITHDRAW_TEXT_LINES)) assert.equal(count(WITHDRAW, line), 1, line)
  assert.match(WITHDRAW, /IF c_mode IS NULL OR c_mode NOT IN \('notice', 'restore'\) THEN/)
  assert.match(WITHDRAW, /c_current_terms_date constant date := DATE '2026-11-23';/)
  assert.match(WITHDRAW, /c_original constant text := \$q\$지금은 탈퇴 신청을 받을 수 없습니다\. 잠시 후 다시 이용해 주세요\.\$q\$;/)
  assert.match(WITHDRAW, /c_path constant text\[\] := ARRAY\['texts', 'blockReasons', 'DISABLED'\];/)
  assert.match(WITHDRAW, /to_char\(c_effective_date, 'YYYY"년" FMMM"월" FMDD"일"'\) \|\| ' 전에 요청하시면 바뀌기 전 약관\('\n {4}\|\| to_char\(c_current_terms_date/)
  assert.match(WITHDRAW, /IF v_current IS DISTINCT FROM c_original AND v_current IS DISTINCT FROM v_last_after THEN/)
  assert.match(WITHDRAW, /IF v_last_after IS NULL OR v_current IS DISTINCT FROM v_last_after OR v_current = c_original THEN/)
  assert.match(WITHDRAW, /ORDER BY \(a\.details ->> 'saved_at'\)::timestamptz DESC LIMIT 1;/)
  assert.match(WITHDRAW, /IF jsonb_set\(v_new, c_path, to_jsonb\(v_current\)\) IS DISTINCT FROM v_policy THEN/)
  assert.match(WITHDRAW, /record_admin_audit\(v_actor, 'member_withdrawal_policy_update'/)
  assert.match(WITHDRAW, /jsonb_build_object\('bundle', 'bundle15_withdraw_disabled_text',[\s\S]*'before', v_current,\n {6}'after', v_target,\n {6}'saved_at', to_jsonb\(clock_timestamp\(\)\)\)/)
  assert.match(WITHDRAW, /\nBEGIN;\nSET LOCAL lock_timeout = '3s';/)
  assert.match(WITHDRAW, /\nCOMMIT;\n/)
})

// ---------------------------------------------------------------------------------------------------------------
// 문구 대조(11-1 표)
// ---------------------------------------------------------------------------------------------------------------
const POPUP_BODY = between(MIGRATION, '$b$', '$b$ AS body')
const IT_NEW = between(DO_BLOCK, '$q$- **탈퇴하면 남은 크레딧', "'탈퇴와 크레딧(추가)'")
const TERMS_NOTE = between(DO_BLOCK, 'c_terms_note constant text := $q$', '$q$;')
const PRIVACY_NOTE = between(DO_BLOCK, 'c_privacy_note constant text := $q$', '$q$;')
const INTRO = between(DO_BLOCK, "'intro', $q$", '$q$,')
const IP_NEW = between(DO_BLOCK, '$q$- 회원 탈퇴 때:', "'수집 항목(회원 탈퇴 추가)'")
const hasAny = (text, alternatives) => alternatives.split('|').some((phrase) => text.includes(phrase))

test('문구 대조: 글마다 요구 표현', () => {
  const table = [
    ['팝업 초안 본문', POPUP_BODY, ['법령에 따른 환불', '일부를 썼으면|일부를 쓴', '끝난 뒤 3일', '불리하거나 중요한', '후기·추천', '이어지지 않습니다', '고객센터']],
    ['이메일 초안', EMAIL, ['법령에 따른 환불', '일부를 썼으면|일부를 쓴', '끝난 뒤 3일', '불리하거나 중요한', '후기·추천', '이어지지 않습니다', '고객센터']],
    ['it_pairs 새 조각', IT_NEW, ['법령에 따른 환불', '일부를 썼으면|일부를 쓴', '끝난 뒤 3일']],
    ['c_terms_note', TERMS_NOTE, ['법령에 따른 환불', '일부를 썼으면|일부를 쓴', '끝난 뒤 3일']],
    ['게시 행 intro', INTRO, ['시행일 전까지', '탈퇴를 요청', '고객센터', '동의 전에는 충전과 자료 구매']],
    ['c_privacy_note', PRIVACY_NOTE, ['결제 시도 기록', '탈퇴 요청 기록']],
    ['privacy 동의 항목 새 본문', IP_NEW, ['탈퇴 요청 기록', '회원 탈퇴 처리']],
    ['4-6 막힘 문구', WITHDRAW, ['고객센터', '10일 안에', '바뀌기 전 약관(']],
  ]
  for (const [name, text, phrases] of table) {
    for (const phrase of phrases) assert.ok(hasAny(text, phrase), `${name}: ${phrase}`)
  }
  // 숫자: '7일'은 '결제 이력이 없는 계정'과 같은 문장, 회사 이름, 시행일 글자, 동의 전 이용 범위 표현
  for (const [name, text] of [['팝업', POPUP_BODY], ['이메일', EMAIL]]) {
    // 7일 제한은 '결제 이력이 없는 계정' 줄(목록 한 줄)에 함께 있다
    const lines = text.split('\n').filter((line) => line.includes('최근 7일'))
    assert.ok(lines.length > 0 && lines.every((line) => line.includes('결제 이력이 없는 계정')), `${name}: 7일 문장`)
    assert.ok(text.includes('써머썬연구소'), `${name}: 상호`)
    assert.ok(text.includes('2027년 1월 11일'), `${name}: 시행일`)
    assert.ok(!text.includes('크레딧은 이용할 수 있습니다'), `${name}: 크레딧 표현`)
  }
  assert.ok(INTRO.includes('크레딧 내역'))
  assert.ok(EMAIL.includes('크레딧 내역'))
  // 10번 새 조각의 숫자(10일·7일·3일)와 같은 숫자
  for (const n of ['10일', '7일', '3일']) assert.ok(POPUP_BODY.includes(n) && DO_BLOCK.includes(n), n)
})

// ---------------------------------------------------------------------------------------------------------------
// 리허설 파일(11-2 원칙)
// ---------------------------------------------------------------------------------------------------------------
const files = buildRehearsalFiles()

test('리허설: 생성 파일이 원본과 맞다(원본을 고친 뒤 다시 만들었는지), 파일 목록', () => {
  const onDisk = readdirSync(join(ROOT, REHEARSAL_DIR)).filter((name) => name.endsWith('.sql')).sort()
  assert.deepEqual(onDisk, Object.keys(files).sort())
  for (const [name, content] of Object.entries(files)) {
    assert.equal(read(`${REHEARSAL_DIR}/${name}`), content, `${name} 이 오래됨 — node ${REHEARSAL_DIR}/generate.mjs`)
  }
})

test('리허설: 모두 BEGIN … 마지막 SELECT … ROLLBACK, COMMIT 없음, 결과는 ON COMMIT DROP 임시 표, 예외 메시지는 요약', () => {
  for (const [name, sql] of Object.entries(files)) {
    assert.match(sql, /\nBEGIN;\nSET LOCAL lock_timeout = '3s';\n/, name)
    assert.match(sql, /\nSELECT n, test, msg, payload FROM _rh_log ORDER BY n;\nROLLBACK;\n$/, name)
    assert.doesNotMatch(code(sql), /^\s*COMMIT;/m, name)
    assert.match(sql, /CREATE TEMP TABLE _rh_log \(n serial PRIMARY KEY, test text NOT NULL, msg text NOT NULL, payload jsonb\) ON COMMIT DROP;/, name)
    assert.match(sql, /RAISE EXCEPTION 'RH FAIL \[%\] %', p_test, left\(p_msg, 850\);/, name)
    assert.match(sql, /RETURN 'ERR ' \|\| left\(SQLERRM, 300\);/, name)
  }
})

test('리허설: 표 잠금 문장은 새벽 파일에만 — light·E 에는 CREATE/DROP POLICY·DROP TRIGGER·CREATE TRIGGER 가 없다', () => {
  const ddl = /^\s*(CREATE POLICY|DROP POLICY|DROP TRIGGER|CREATE TRIGGER|ALTER TABLE|LOCK TABLE)\b/m
  for (const name of ['e_withdraw_text.sql', 'b_cases_light.sql', 'c_preview_light.sql', 'd_preview_after_apply.sql']) {
    assert.doesNotMatch(code(files[name]), ddl, name)
    assert.match(files[name], /-- 언제: 지금 돌려도 됨/, name)
  }
  for (const name of ['b_cases.sql', 'c_preview.sql']) {
    assert.doesNotMatch(code(files[name]), /^\s*(CREATE POLICY|DROP POLICY|DROP TRIGGER|ALTER TABLE|LOCK TABLE)\b/m, name)
    assert.equal((code(files[name]).match(/^CREATE TRIGGER /gm) ?? []).length, 3, name)
    assert.match(files[name], /-- 언제: 새벽 03~04시/, name)
  }
  assert.match(code(files['a_ddl.sql']), /^CREATE POLICY /m)
  assert.match(code(files['a_ddl.sql']), /^DROP TRIGGER /m)
  assert.match(files['a_ddl.sql'], /-- 언제: 새벽 03~04시만/)
})

test('리허설: 사본이 원본과 다른 곳은 정해진 목록뿐', () => {
  // 마이그레이션 사본: nopolicy = 정책 문장 2개 + 정책 VERIFY 블록, light = 거기에 트리거 3개 + VERIFY 기대값 한 곳
  const full = migrationCopy('full')
  const nopolicy = migrationCopy('nopolicy')
  const light = migrationCopy('light')
  assert.equal(full, MIGRATION)
  assert.equal(count(code(nopolicy), 'CREATE POLICY'), 0)
  assert.doesNotMatch(nopolicy, /\$verify_site_notice_popup_policies\$|\$create_policy_upcoming_documents_policy\$/)
  assert.equal(count(code(nopolicy), 'CREATE TRIGGER'), 3)
  assert.equal(count(code(light), 'CREATE TRIGGER'), 0)
  assert.ok(light.includes(MIGRATION_LIGHT_VERIFY[1]) && !light.includes(MIGRATION_LIGHT_VERIFY[0]))
  // 원본 줄을 지우기만 했는지: 사본의 줄은 모두 원본에 있다(light 의 VERIFY 기대값 한 줄 빼고)
  const original = new Set(MIGRATION.split('\n'))
  assert.deepEqual(nopolicy.split('\n').filter((line) => !original.has(line)), [])
  assert.deepEqual(light.split('\n').filter((line) => !original.has(line)), ["           OR (t.tgrelid = 'public.signup_consent_items'::regclass AND t.tgname = 'lock_consent_items_during_notice'))) <> 0 THEN"])
  // 스크립트 사본: 원본 DO 블록을 그대로 싣고, 실행 때 바꾸는 줄은 POLICY_TEXT_LINES·WITHDRAW_TEXT_LINES 뿐
  const withdrawBlock = WITHDRAW.match(/\nDO \$withdraw_disabled_text\$\n[\s\S]*?\n\$withdraw_disabled_text\$;\n/)[0]
  for (const sql of Object.values(files)) {
    assert.ok(sql.includes(`$rh_src_policy_text$${DO_BLOCK.slice(1, -1)}$rh_src_policy_text$`))
    assert.ok(sql.includes(`$rh_src_withdraw_text$${withdrawBlock.slice(1, -1)}$rh_src_withdraw_text$`))
    assert.ok(sql.includes(`$rh_src_revert$${extractRevertBlock(SCRIPT)}$rh_src_revert$`))
    const replaced = [...sql.matchAll(/pg_temp\.subst_once\(v, '((?:[^']|'')*)'/g)].map((match) => match[1].replaceAll("''", "'"))
    assert.deepEqual(replaced.sort(), [...Object.values(POLICY_TEXT_LINES), ...Object.values(WITHDRAW_TEXT_LINES)].sort())
  }
})

test('리허설: 저장 함수로 바꾸는 값은 다듬기(앞뒤 공백 제거)로 사라지지 않는다', () => {
  // save_signup_consent_item 은 본문을 다듬은 뒤 비교하므로 공백만 붙이면 UPDATE 가 없어 트리거가 불리지 않는다.
  for (const [name, sql] of Object.entries(files)) {
    for (const call of sql.matchAll(/public\.save_signup_consent_item\(%L[^\n]*\n[^\n]*/g)) {
      assert.doesNotMatch(call[0], /\|\| ' '/, name)
    }
  }
  assert.match(files['a_ddl.sql'], /v_item\.content \|\| ' RH'/)
})

test('리허설: 미리보기 추출(R4 나)은 별도 짧은 거래 파일에만, 경우 목록이 다 있음', () => {
  for (const [name, sql] of Object.entries(files)) {
    const hasPreview = sql.includes('$rh_r4b_preview$')
    assert.equal(hasPreview, name.startsWith('c_preview') || name === 'd_preview_after_apply.sql', name)
  }
  assert.match(files['c_preview.sql'], /pg_temp\.log\('R4나', '미리보기 파일 payload\(output\/b15-upcoming-preview\.json\)', v_pub\);/)
  for (const name of ['b_cases.sql', 'b_cases_light.sql']) {
    for (const tag of ['rh_good_examples', 'rh_r2_save', 'rh_continuity', 'rh_r4a_success', 'rh_r4c_stop', 'rh_r4c_apply_stop', 'rh_r4c_withdraw_restore']) {
      assert.ok(files[name].includes(`DO $${tag}$`), `${name}: ${tag}`)
    }
    // 경우마다 격리(표지 예외)
    assert.ok(count(files[name], "RAISE EXCEPTION 'RH_ISOLATE';") >= 7, name)
  }
  assert.ok(files['b_cases.sql'].includes('DO $rh_r4c_order$'))
  assert.ok(!files['b_cases_light.sql'].includes('DO $rh_r4c_order$'))
  for (const tag of ['rh_r1', 'rh_r3_locks', 'rh_r52_enabled_stop', 'rh_r52_reapply']) assert.ok(files['a_ddl.sql'].includes(`DO $${tag}$`), tag)
  assert.ok(files['a_ddl.sql'].includes(DOWN))
  assert.ok(files['e_withdraw_text.sql'].includes('DO $rh_e_withdraw_text$'))
  // 예시 묶음 파일을 그대로 싣는다(TS 판정과 같은 묶음)
  const examples = JSON.stringify(JSON.parse(read('tests/fixtures/bundle15-notice-record-examples.json'))).replaceAll("'", "''")
  assert.ok(files['b_cases.sql'].includes(examples))
})

// ---------------------------------------------------------------------------------------------------------------
// 문서(계획 8-4): 런북·10번 계획이 30일 고지 경로를 따른다
// ---------------------------------------------------------------------------------------------------------------
test('런북 RB-11: 바로 시행 전제 문장이 없고, 30일 고지 절차·끊김 판정 조회·요청일부터 10일·되돌리기 전 팝업 끄기가 있다', () => {
  const runbook = read('docs/admin-operations-runbook.md')
  assert.doesNotMatch(runbook, /바로 시행 전제 확인/)
  assert.doesNotMatch(runbook, /시행일\(약관 부칙·처리방침 머리\)에는 실행한 날/)
  assert.doesNotMatch(runbook, /켠 뒤 10일 안에 처리합니다/)
  const section = between(runbook, '### 10-13. 약관 변경 30일 전 고지와 공지 팝업', '## 11. 그 밖의 절차')
  for (const needle of ["c_mode = 'publish_upcoming'", "c_mode = 'withdraw_upcoming'", 'SELECT public.policy_upcoming_notice_continuity() AS 판정;',
    "c_mode = 'notice'", "c_mode = 'restore'", '시행 전 확인(2027-01-10 밤)', '**되돌리기 전에** 관리자 카드에서 팝업을 끄고 저장', 'POLICY_UPCOMING_LOCKED']) {
    assert.ok(section.includes(needle), needle)
  }
  assert.match(runbook, /c_mode = 'apply'/)
  assert.match(runbook, /스위치가 꺼진 동안 받은 탈퇴 요청도 요청일부터 10일 안에 처리/)
  assert.match(runbook, /시행일 전에 받은 요청이 시행 뒤까지 남으면[\s\S]{0,120}접수일 기준 바뀌기 전 약관\(2026년 11월 23일 시행\)[\s\S]{0,80}`anonymize_member` 화면 경로는 쓰지 않는다/)
})

test('10번 계획 7절: 30일 전 고지 기록 칸(이메일 발송·인원·md5, 노출 시작·기록 id, 게시 지문)', () => {
  const plan10 = read('docs/plan-bundle10-member-withdrawal.md')
  const section7 = between(plan10, '## 7. 약관·처리방침·가입 동의 문구(DB 스크립트)', '## 8. ')
  assert.match(section7, /30일 전 고지\(15번 계획 8절, 시행일 2027-01-11, 고지 마감 2026-12-10 KST\)/)
  for (const needle of ['이메일 발송 ____(일시) · ____명 · 목록 md5 ____', '시행 직전 추가 발송', '팝업 노출 시작 ____ (site_notice_popup_save 의 exposure_starts_at, 기록 id ____)', '변경 예정 글 게시 ____ (policy_upcoming_publish']) {
    assert.ok(section7.includes(needle), needle)
  }
})
