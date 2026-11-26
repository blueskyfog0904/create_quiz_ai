import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import '../src/components/features/passages/node-test-register.mjs'

// 13번 계획(docs/plan-bundle13-cs-tools.md) 12-1 의 DB 계약 시험. DB 동작은 리허설(12-2, supabase/scripts/bundle13_rehearsal)이 본다.
const { SUPPORT_PAGE_REQUIRED_KEYS, SUPPORT_PAGE_MEMBER_KEYS } = await import('../src/lib/support-page-content.ts')
const generator = await import('../supabase/scripts/bundle13_rehearsal/generate.mjs')

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const md5 = (text) => createHash('md5').update(text).digest('hex')
const M0 = read('supabase/migrations/20261217100000_bundle13_member_access_log.sql')
const M1 = read('supabase/migrations/20261217110000_bundle13_cs_tools.sql')
const M2 = read('supabase/migrations/20261217120000_bundle13_support_answer_guard.sql')
const M3 = read('supabase/migrations/20261217130000_bundle13_admin_select_narrow.sql')
const M1_DOWN = read('supabase/rollback/20261217110000_bundle13_cs_tools_down.sql')
const M2_DOWN = read('supabase/rollback/20261217120000_bundle13_support_answer_guard_down.sql')
const M3_DOWN = read('supabase/rollback/20261217130000_bundle13_admin_select_narrow_down.sql')
const POLICY_SCRIPT = read('supabase/scripts/20261126_bundle10_policy_text.sql')
const stripComments = (sql) => sql.replace(/--[^\n]*/g, '')

// 10번 원문 지문(계획 1-3, 운영 2026-11-26)
const ORIGINAL = {
  member_withdrawal_facts: 'a7674770964dac2fe5c9179b8403c3b4',
  redact_member_text: '90778a74269a727608f028b21b43b8f6',
  mark_member_text_reviewed: 'b626dc43a8bb8402575f99a58bb5969b',
  read_withdrawn_member_ticket: 'cce39fd0ab514d2c9cdd9e42d225688e',
}
const ANONYMIZE = ['public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)', '1346d870d3623abae580a011b0484339']

// pg_get_functiondef 모양 블록(CREATE OR REPLACE … $function$ … $function$)
function functiondefBlocks(source) {
  const blocks = {}
  for (const match of source.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\([\s\S]*?\n\$function\$\n/g)) {
    blocks[match[1]] = match[0]
  }
  return blocks
}
const prosrc = (def) => def.slice(def.indexOf('AS $function$') + 'AS $function$'.length, def.lastIndexOf('$function$'))

test('M0: 추가 전용 열람 기록 표·기록 함수(service_role 만)·되돌리기 파일 없음', () => {
  assert.match(M0, /CREATE TABLE public\.admin_member_access_log \(/)
  assert.match(M0, /member_ids uuid\[\] NOT NULL CHECK \(cardinality\(member_ids\) BETWEEN 1 AND 200/)
  assert.doesNotMatch(M0, /member_ids uuid\[\][^\n]*REFERENCES/)
  assert.match(M0, /BEFORE UPDATE OR DELETE ON public\.admin_member_access_log/)
  assert.match(M0, /BEFORE TRUNCATE ON public\.admin_member_access_log/)
  assert.match(M0, /REVOKE ALL ON TABLE public\.admin_member_access_log FROM PUBLIC, anon, authenticated, service_role;\nGRANT SELECT ON TABLE public\.admin_member_access_log TO service_role;/)
  assert.match(M0, /ALTER TABLE public\.admin_member_access_log ENABLE ROW LEVEL SECURITY;/)
  assert.doesNotMatch(stripComments(M0), /CREATE POLICY/)
  assert.match(M0, /GRANT EXECUTE ON FUNCTION public\.record_admin_member_access\(uuid, text, uuid\[\], text\[\], jsonb, text, jsonb\) TO service_role;/)
  assert.match(M0, /p\.is_admin IS TRUE AND p\.admin_role IN \('owner', 'staff'\)/)
  assert.match(M0, /되돌리기 파일이 없다/)
  assert.ok(!existsSync(new URL('../supabase/rollback/20261217100000_bundle13_member_access_log_down.sql', import.meta.url)))
  // 10번 처리방침 스크립트(01-11 시행)가 보는 이름과 같다
  assert.match(POLICY_SCRIPT, /to_regclass\('public\.admin_member_access_log'\)/)
  assert.match(POLICY_SCRIPT, /f\.proname = 'record_admin_member_access'/)
  assert.match(POLICY_SCRIPT, /value #>> '\{admin,accessLogRetentionYears\}' FROM public\.system_settings WHERE key = 'support_page_content'/)
})

test('M1: 지문 사전 점검(재정의 4개 + anonymize_member)과 원문·새 본문 대조', () => {
  for (const [name, fingerprint] of Object.entries(ORIGINAL)) {
    assert.ok(M1.includes(`'${fingerprint}'`), `${name} 사전 점검 지문`)
  }
  assert.ok(M1.includes(`ARRAY['${ANONYMIZE[0]}', '${ANONYMIZE[1]}']`))
  // M1 down 이 품은 10번 원문은 1-3 지문과 같다(로컬 md5(pg_get_functiondef) = 운영 값)
  const originals = functiondefBlocks(M1_DOWN)
  const redefined = functiondefBlocks(M1)
  for (const [name, fingerprint] of Object.entries(ORIGINAL)) {
    assert.equal(md5(originals[name]), fingerprint, `${name} 원문 지문`)
    // M1 VERIFY·down 사전 점검의 md5(prosrc) 는 M1 재정의 본문에서 계산한 값
    const newSrc = md5(prosrc(redefined[name]))
    assert.ok(M1.includes(`'${newSrc}'`), `${name} VERIFY 본문 md5`)
    assert.ok(M1_DOWN.includes(`'${newSrc}'`), `${name} down 사전 점검 본문 md5`)
    // 바뀐 줄에는 모두 [13번] 표시가 있다: 원문에 없는 줄은 [13번] 표시 줄이거나 표시 블록 안이다
    const before = new Set(originals[name].split('\n'))
    const added = redefined[name].split('\n').filter((line) => !before.has(line))
    assert.ok(added.length > 0)
    assert.ok(added.some((line) => line.includes('[13번]')), `${name} 에 [13번] 표시`)
    // 원문에서 사라진 줄은 바꾼 곳뿐(4-4 에 적은 것): facts 3곳·redact 2곳·mark 2곳·read 1곳
    const after = new Set(redefined[name].split('\n'))
    const removed = originals[name].split('\n').filter((line) => !after.has(line))
    assert.ok(removed.length <= { member_withdrawal_facts: 7, redact_member_text: 2, mark_member_text_reviewed: 2, read_withdrawn_member_ticket: 1 }[name],
      `${name} 원문에서 바뀐 줄 ${removed.length}`)
  }
  // 4-4 (가)(나)(다)
  const facts = redefined.member_withdrawal_facts
  assert.match(facts, /\[13번\] \(가\)[\s\S]*FROM public\.support_ticket_answer_revisions ar[\s\S]*strpos\(ar\.previous_response, k\)/)
  assert.match(facts, /SELECT 'support_ticket_answer_revision', ar\.id[\s\S]*member_text_has_long_number\(ar\.previous_response\) OR public\.member_text_has_long_number\(ar\.reason\)[\s\S]*WHERE ar\.redaction_reviewed_at IS NULL/)
  assert.match(facts, /max\(GREATEST\(t\.responded_at, t\.response_edited_at, t\.member_updated_at, t\.created_at\)\) -- \[13번\] \(다\)/)
  assert.match(facts, /GREATEST\(t\.member_updated_at, t\.responded_at, t\.response_edited_at\)/)
  assert.match(redefined.redact_member_text, /p_target_kind = 'support_ticket_answer_revision' AND p_field IN \('previous_response', 'reason'\)/)
  assert.match(redefined.mark_member_text_reviewed, /'support_ticket_answer_revision'/)
  assert.match(redefined.read_withdrawn_member_ticket, /'answerRevisions'/)
  assert.doesNotMatch(M1, /FUNCTION public\.anonymize_member/)
})

test('M1: 새 표 2개의 REVOKE·RLS·가드, 템플릿 SELECT 정책, 첫 값', () => {
  assert.match(M1, /REVOKE ALL ON TABLE public\.support_ticket_answer_revisions FROM PUBLIC, anon, authenticated, service_role;\nGRANT SELECT ON TABLE public\.support_ticket_answer_revisions TO service_role;/)
  assert.match(M1, /ALTER TABLE public\.support_ticket_answer_revisions ENABLE ROW LEVEL SECURITY;/)
  assert.match(M1, /ticket_id uuid NOT NULL REFERENCES public\.support_tickets\(id\) ON DELETE CASCADE/)
  assert.match(M1, /BEFORE UPDATE OR DELETE ON public\.support_ticket_answer_revisions/)
  assert.match(M1, /BEFORE TRUNCATE ON public\.support_ticket_answer_revisions/)
  // 가드 예외: 연쇄 삭제·가림 거래(bypass = 그 회원)에서 previous_response·reason·redaction_reviewed_at 만
  assert.match(M1, /IF EXISTS \(SELECT 1 FROM public\.support_tickets t WHERE t\.id = OLD\.ticket_id\) THEN\n\s+RAISE EXCEPTION 'SUPPORT_ANSWER_REVISIONS_APPEND_ONLY'/)
  assert.match(M1, /\(NEW\.id, NEW\.ticket_id, NEW\.previous_shown_at, NEW\.edited_by, NEW\.created_at\)\n\s+IS NOT DISTINCT FROM \(OLD\.id, OLD\.ticket_id, OLD\.previous_shown_at, OLD\.edited_by, OLD\.created_at\)/)
  assert.match(M1, /ALTER TABLE public\.support_reply_templates ENABLE ROW LEVEL SECURITY;/)
  assert.match(M1, /GRANT SELECT ON TABLE public\.support_reply_templates TO authenticated;\nGRANT SELECT, INSERT, UPDATE ON TABLE public\.support_reply_templates TO service_role;/)
  assert.match(M1, /CREATE POLICY support_reply_templates_admin_select ON public\.support_reply_templates\n\s+FOR SELECT TO authenticated\n\s+USING \(\(SELECT public\.has_admin_permission\('support\.manage'\)\)\);/)
  assert.equal((M1.match(/CREATE POLICY/g) ?? []).length, 1)
  assert.match(M1, /WHERE NOT EXISTS \(SELECT 1 FROM public\.support_reply_templates\);/)
  const seed = M1.slice(M1.indexOf('INSERT INTO public.support_reply_templates'), M1.indexOf('WHERE NOT EXISTS (SELECT 1 FROM public.support_reply_templates);'))
  assert.equal((seed.match(/^\s+\('/gm) ?? []).length, 14)
  assert.doesNotMatch(seed, /써머썬|7일/)
  assert.doesNotMatch(seed.replaceAll('○○', ''), /○/, '한 글자 빈칸 없음(빈칸 검사는 ○○)')
})

test('M1: 설정 행 필수 키가 코드 SUPPORT_PAGE_REQUIRED_KEYS 와 같고 보관 기간은 2', () => {
  const json = JSON.parse(M1.split('$json_support_page_content$')[1])
  assert.equal(json.revision, 1)
  // 16번이 답변 알림 키 4개를 '알림' 화면으로 옮겼다(M1 첫 값·VERIFY 에는 남아 있고, 코드는 읽지 않는다 — 정리 스크립트가 지운다).
  const moved = ['answerCreatedNotificationTitle', 'answerCreatedNotificationMessage', 'answerEditedNotificationTitle', 'answerEditedNotificationMessage']
  assert.deepEqual(Object.keys(json.member).filter((key) => !moved.includes(key)), [...SUPPORT_PAGE_MEMBER_KEYS])
  const verifyRequired = [...M1.match(/v_required text\[\] := ARRAY\[([\s\S]*?)\];/)[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1])
  assert.deepEqual(verifyRequired.filter((key) => !moved.includes(key)), [...SUPPORT_PAGE_REQUIRED_KEYS])
  for (const key of moved) assert.ok(verifyRequired.includes(key), key)
  for (const key of SUPPORT_PAGE_REQUIRED_KEYS) assert.ok(json.member[key].trim(), `${key} 첫 값`)
  assert.deepEqual(json.admin, {
    templateBlankMarker: '○○',
    answerEditReasonGuide: json.admin.answerEditReasonGuide,
    notifyOnAnswerEdit: true,
    accessLogRetentionYears: 2,
  })
  assert.match(json.admin.answerEditReasonGuide, /개인정보는 적지 마세요/)
  assert.match(M1, /\(v_value -> 'admin' -> 'accessLogRetentionYears'\) IS DISTINCT FROM '2'::jsonb/)
  assert.match(M1, /ON CONFLICT \(key\) DO NOTHING;/)
  // 처리방침(01-11 시행)의 '기록한 날부터 2년'과 같다
  assert.match(POLICY_SCRIPT, /기록한 날부터 2년/)
})

test('M1: slug 지키기 트리거는 slug 가 바뀔 때만, 정책 값에서 목록을 읽고, DEFINER·search_path 고정', () => {
  const fn = M1.slice(M1.indexOf('CREATE FUNCTION public.guard_support_category_slug()'), M1.indexOf('$fn_guard_support_category_slug$;'))
  assert.match(fn, /SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'/)
  assert.match(fn, /IF NEW\.slug IS DISTINCT FROM OLD\.slug THEN/)
  assert.match(fn, /SELECT 1 FROM public\.support_tickets t WHERE t\.category_id = OLD\.id/)
  assert.match(fn, /s\.value -> 'redactionRefundCategorySlugs' FROM public\.system_settings s WHERE s\.key = 'member_withdrawal_policy'/)
  assert.doesNotMatch(fn, /'market_refund'|'credit_refund'/, '정책 slug 를 상수로 두지 않음')
  assert.match(M1, /CREATE TRIGGER guard_support_category_slug\n\s+BEFORE UPDATE OF slug ON public\.support_ticket_categories/)
})

test('M1: 답변 저장 함수 — service_role 만, 재요청·충돌·사유·작업 기록에 원문 없음', () => {
  const fn = M1.slice(M1.indexOf('CREATE FUNCTION public.save_support_ticket_answer('), M1.indexOf('$fn_save_support_ticket_answer$;'))
  assert.match(M1, /GRANT EXECUTE ON FUNCTION public\.save_support_ticket_answer\(uuid, uuid, text, text, text, text, text, jsonb\) TO service_role;/)
  assert.match(fn, /SELECT \* INTO v_ticket FROM public\.support_tickets WHERE id = p_ticket_id FOR UPDATE;/)
  assert.match(fn, /a\.action IN \('support_ticket_reply', 'support_ticket_reply_edit'\)\n\s+AND a\.target_id = p_ticket_id::text\n\s+AND a\.request_id = v_key\n\s+AND a\.actor_id = p_actor_id/)
  // 재요청은 회원 삭제·탈퇴 검사 뒤(탈퇴 회원 문의 본문을 돌려주지 않음)
  assert.ok(fn.indexOf("RAISE EXCEPTION 'MEMBER_WITHDRAWN'") < fn.indexOf('SELECT a.* INTO v_audit'))
  assert.ok(fn.indexOf("RAISE EXCEPTION 'SUPPORT_TICKET_DELETED_BY_MEMBER'") < fn.indexOf('SELECT a.* INTO v_audit'))
  assert.match(fn, /'replayed', true/)
  assert.match(fn, /encode\(sha256\(convert_to\(COALESCE\(v_ticket\.admin_response, ''\), 'UTF8'\)\), 'hex'\) <> p_expected_sha256/)
  assert.match(fn, /set_config\('app\.support_answer_write', p_ticket_id::text, true\)/)
  assert.match(fn, /redaction_reviewed_at = NULL/)
  assert.match(fn, /'historyId', v_history, 'lengthBefore', char_length\(v_previous\), 'lengthAfter', char_length\(p_response\),\n\s+'reasonLength', char_length\(v_reason\), 'request', p_request_meta/)
  assert.match(fn, /'status', v_ticket\.status, 'length', char_length\(p_response\), 'request', p_request_meta/)
  // 작업 기록 details 키 목록은 리허설과 같다
  assert.deepEqual(generator.AUDIT_DETAIL_KEYS.support_ticket_reply_edit, ['historyId', 'lengthAfter', 'lengthBefore', 'reasonLength', 'request'])
  // 작업 기록 reason(p_reason 자리)은 NULL — 사유 원문은 이력 표에만
  assert.equal((fn.match(/record_admin_audit\(p_actor_id, 'support_ticket_reply(?:_edit)?', 'support_ticket', p_ticket_id::text, v_ticket\.user_id, NULL, NULL,/g) ?? []).length, 2)
})

test('M2·M3 에 DROP TRIGGER 가 없고, M2 는 4칸 회수·정책 DROP·잠금 트리거', () => {
  for (const sql of [M0, M1, M2, M3]) assert.doesNotMatch(stripComments(sql), /DROP TRIGGER/)
  assert.match(M2, /REVOKE UPDATE \(status, admin_response, responded_at, updated_at\) ON public\.support_tickets FROM authenticated;/)
  assert.match(M2, /DROP POLICY support_tickets_admin_update ON public\.support_tickets;/)
  assert.match(M2, /BEFORE UPDATE OF admin_response, responded_at, response_edited_at ON public\.support_tickets/)
  assert.match(M2, /current_setting\('app\.support_answer_write', true\), ''\) = NEW\.id::text\n\s+OR COALESCE\(current_setting\('app\.member_withdrawal_bypass', true\), ''\) = NEW\.user_id::text/)
  assert.match(M2, /RAISE EXCEPTION 'SUPPORT_ANSWER_RPC_ONLY'/)
})

test('M3: 사전 점검이 지금 식을 대조하고, 판정 함수를 private 에 두며, 정책 식을 바꾼 뒤에 profiles 를 좁힌다', () => {
  assert.match(M3, /c_code_deployed constant boolean := false;/)
  for (const name of ['support_tickets_withdrawn_hidden', 'market_refund_requests_withdrawn_hidden', 'refund_requests_withdrawn_hidden', 'support_ticket_revisions_withdrawn_hidden']) {
    assert.match(M3, new RegExp(`ARRAY\\['[a-z_]+', '${name}', '(ALL|SELECT)',\\n\\s+'\\(NOT \\(EXISTS \\( SELECT 1 FROM`))
  }
  for (const fn of ['is_withdrawn_member', 'is_withdrawn_ticket_member']) {
    const block = M3.slice(M3.indexOf(`CREATE FUNCTION private.${fn}(`), M3.indexOf(`$fn_${fn}$;`))
    assert.match(block, /STABLE SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'/)
    assert.match(M3, new RegExp(`ALTER FUNCTION private\\.${fn}\\(uuid\\) OWNER TO postgres;`))
    assert.match(M3, new RegExp(`REVOKE ALL ON FUNCTION private\\.${fn}\\(uuid\\) FROM PUBLIC, anon;`))
  }
  assert.match(M3, /GRANT USAGE ON SCHEMA private TO authenticated, service_role;/)
  const body = stripComments(M3.slice(M3.indexOf('-- [13번 M3] 시작'), M3.indexOf('-- [13번 M3] 끝')))
  assert.doesNotMatch(body, /CREATE POLICY|DROP POLICY/)
  const hidden = body.indexOf('ALTER POLICY support_ticket_revisions_withdrawn_hidden')
  const narrow = body.indexOf('ALTER POLICY "Admins can view all profiles"')
  assert.ok(hidden > 0 && narrow > hidden, '탈퇴 가림 식을 바꾼 뒤에 profiles 를 좁힌다')
  assert.match(body, /ALTER POLICY support_tickets_withdrawn_hidden ON public\.support_tickets\n\s+USING \(NOT private\.is_withdrawn_member\(user_id\)\)\n\s+WITH CHECK \(NOT private\.is_withdrawn_member\(user_id\)\);/)
  assert.match(body, /USING \(NOT private\.is_withdrawn_ticket_member\(ticket_id\)\)/)
  assert.match(body, /ALTER POLICY "Admins can view all profiles" ON public\.profiles\n\s+USING \(public\.is_owner\(\)\);/)
  assert.match(body, /ALTER POLICY "Admins can view all tickets" ON public\.support_tickets\n\s+USING \(public\.has_admin_permission\('support\.manage'\)\);/)
  assert.match(body, /ALTER POLICY "Admins can view all market download events" ON public\.market_download_events\n\s+USING \(public\.is_owner\(\)\);/)
  // 적용 뒤 상태: 정책 식 안 profiles·support_tickets 하위 조회는 auth.uid() 조건뿐(리허설 확인 조회와 같은 식)
  assert.match(M3, /\(FROM\|JOIN\)\\s\+\\\(\?\\s\*\(public\\\.\)\?\(profiles\|support_tickets\)\\y'\n\s+AND .* !~ 'auth\\\.uid\\\(\\\)'/)
})

test('되돌리기: 순서·멈춤 조건·원래 식', () => {
  // M3 down: 좁힌 정책 → 탈퇴 가림 원래 식 → 함수 DROP(→ 빈 스키마만 DROP)
  const narrowBack = M3_DOWN.indexOf('ALTER POLICY "Admins can view all profiles"')
  const hiddenBack = M3_DOWN.indexOf('ALTER POLICY support_tickets_withdrawn_hidden')
  const dropFn = M3_DOWN.indexOf('DROP FUNCTION private.is_withdrawn_member(uuid);')
  assert.ok(narrowBack > 0 && hiddenBack > narrowBack && dropFn > hiddenBack)
  assert.match(M3_DOWN, /USING \(NOT EXISTS \(SELECT 1 FROM public\.profiles p WHERE p\.id = support_tickets\.user_id AND p\.withdrawn_at IS NOT NULL\)\)/)
  assert.match(M3_DOWN, /EXECUTE 'DROP SCHEMA private'/)
  assert.match(M3_DOWN, /USING \(public\.is_admin\(\)\);/)
  // M2 down: M3 가 남아 있으면 멈춤, 4칸 권한·정책 다시 줌(20261117140000 정의)
  assert.match(M2_DOWN, /M3 is still applied/)
  assert.match(M2_DOWN, /GRANT UPDATE \(status, admin_response, responded_at, updated_at\) ON public\.support_tickets TO authenticated;/)
  assert.ok(read('supabase/migrations/20261117140000_admin_rls_by_permission.sql').includes(
    "CREATE POLICY support_tickets_admin_update ON public.support_tickets\n  FOR UPDATE TO authenticated\n  USING ((SELECT public.has_admin_permission('support.manage')))\n  WITH CHECK ((SELECT public.has_admin_permission('support.manage')));"))
  assert.ok(M2_DOWN.includes(
    "CREATE POLICY support_tickets_admin_update ON public.support_tickets\n  FOR UPDATE TO authenticated\n  USING ((SELECT public.has_admin_permission('support.manage')))\n  WITH CHECK ((SELECT public.has_admin_permission('support.manage')));"))
  // M1 down: M2 확인 → 13번 정의 확인 → 이력 있으면 멈춤 → 내보내기 확인 → 10번 원문 → 지우기
  assert.match(M1_DOWN, /M2 is still applied/)
  assert.match(M1_DOWN, /bundle 10 functions are not the bundle 13 definition/)
  assert.match(M1_DOWN, /IF EXISTS \(SELECT 1 FROM public\.support_ticket_answer_revisions\) THEN\n\s+RAISE EXCEPTION 'DOWN PRECHECK: answer revisions exist/)
  assert.match(M1_DOWN, /c_export_confirmed constant boolean := false;/)
  assert.match(M1_DOWN, /ALTER TABLE public\.support_tickets DROP COLUMN response_edited_at;/)
  assert.doesNotMatch(M1_DOWN, /admin_member_access_log/, 'M0 표는 건드리지 않음')
  // 12번 down 은 13번이 적용돼 있으면 멈춘다(13번 먼저 되돌림)
  assert.match(read('supabase/rollback/20261214100000_member_suspension_down.sql'), /20261217100000/)
})

test('리허설: 생성 파일이 최신이고, light 는 기존 표를 잠그는 DDL 이 없고, COMMIT 이 없다', () => {
  const files = generator.buildRehearsalFiles()
  for (const [name, content] of Object.entries(files)) {
    assert.equal(read(`supabase/scripts/bundle13_rehearsal/${name}`), content, `${name} 다시 만들기(node supabase/scripts/bundle13_rehearsal/generate.mjs)`)
    assert.doesNotMatch(content, /\bCOMMIT\s*;/)
    assert.ok(content.trimEnd().endsWith('ROLLBACK;'))
    assert.match(content, /u\.email LIKE '%@test\.com'/)
    assert.match(content, /RAISE EXCEPTION 'RH FAIL \[setup\]/)
  }
  // light: M1 사본이 뺀 것은 칸 추가·FK 2개·slug 트리거·그 VERIFY 블록뿐(assertLight 가 기존 표 DDL 을 막는다)
  const light = generator.m1Copy('light')
  assert.doesNotMatch(stripComments(light), /ALTER TABLE public\.support_tickets|REFERENCES public\.|CREATE TRIGGER guard_support_category_slug/)
  assert.ok(stripComments(files['a_light.sql']).split('ON public.profiles').length === 1)
  assert.doesNotMatch(files['a_light.sql'], /src_m2|src_m3|_down'/)
  // full: M3 사본은 확인 상수만 바꿨다
  assert.equal(generator.m3Copy(), M3.replace('  c_code_deployed constant boolean := false;', '  c_code_deployed constant boolean := true;'))
  assert.match(files['b_full.sql'], /generate_listboard_generation_jobs SET status = 'cancelled'/)
  assert.match(files['b_full.sql'], /anonymize_member\(%L, %L, %L, NULL, %s, %L, false, NULL, %L, false, false\)/)
})
