import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import '../src/components/features/passages/node-test-register.mjs'

// 12번 계획(docs/plan-bundle12-member-suspension.md) 11-1 계약 시험. DB 동작은 리허설(11-2)이 본다.
const { ADMIN_AUDIT_ACTIONS } = await import('../src/lib/admin-audit-log.ts')
const permissions = await import('../src/lib/admin-permissions.ts')
const suspension = await import('../src/lib/member-suspension.ts')
const { AUDIT_DETAIL_KEYS, migrationCopy, downCopy } = await import('../supabase/scripts/bundle12_rehearsal/generate.mjs')

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const MIGRATION_PATH = 'supabase/migrations/20261214100000_member_suspension.sql'
const migration = read(MIGRATION_PATH)
const down = read('supabase/rollback/20261214100000_member_suspension_down.sql')
const section = migration.slice(migration.indexOf('-- [12번] 시작'), migration.indexOf('-- [12번] 끝'))
const md5 = (text) => createHash('md5').update(text).digest('hex')

function fnBlock(source, name) {
  const re = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`)
  const start = source.search(re)
  assert.ok(start >= 0, `${name} 없음`)
  const tag = source.slice(start).match(/AS (\$[a-z_]+\$)/)[1]
  const end = source.indexOf(`${tag};`, start + source.slice(start).indexOf(tag) + tag.length)
  return source.slice(start, end + tag.length + 1)
}
function prosrc(source, name) {
  const block = fnBlock(source, name)
  const tag = block.match(/AS (\$[a-z_]+\$)/)[1]
  const from = block.indexOf(`AS ${tag}`) + `AS ${tag}`.length
  return block.slice(from, block.lastIndexOf(tag))
}

const NEW_FUNCTIONS = [
  'member_suspension_actor_allowed', 'suspend_member', 'lift_member_suspension', 'record_member_suspension_notice',
  'mark_member_suspension_seen', 'add_member_admin_note', 'delete_member_admin_note', 'redact_member_admin_note',
  'member_active_suspension', 'member_refund_deadlines', 'get_my_member_gate', 'save_member_suspension_policy',
  'guard_member_suspensions_mutation', 'guard_member_admin_notes_mutation', 'member_suspension_withdrawal_cleanup',
]

test('파일: 버전은 13번(20261217…)보다 앞, 거래 문장 없음, 잠금 설정·[12번] 표시·NOTIFY', () => {
  const versions = readdirSync(new URL('../supabase/migrations/', import.meta.url)).map((name) => name.split('_')[0]).filter((v) => /^\d{14}$/.test(v))
  assert.ok(versions.includes('20261214100000'))
  // 13번 계획에 적힌 파일 시각이 모두 12번 뒤(12번 먼저 적용)
  const plan13 = read('docs/plan-bundle13-cs-tools.md')
  const bundle13Versions = [...plan13.matchAll(/`(\d{14})_bundle13_[a-z_]+\.sql`/g)].map((m) => m[1])
  assert.ok(bundle13Versions.length >= 4, String(bundle13Versions))
  for (const version of bundle13Versions) assert.ok(version > '20261214100000', version)
  assert.match(plan13, /12번\(`20261214100000_member_suspension\.sql`\) 뒤로 둔다/)
  for (const [name, sql] of [['migration', migration], ['down', down]]) {
    assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/m, name)
    assert.match(sql, /^SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '120s';$/m, name)
    assert.ok(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"), name)
    assert.match(sql, /-- \[12번\] 시작/)
    assert.match(sql, /-- \[12번\] 끝/)
  }
  assert.doesNotMatch(migration.replace(/--[^\n]*/g, ''), /DROP TRIGGER/)
})

test('사전 점검(4-1): 바꾸거나 기대는 함수 md5 — get_my_missing_required_consents·anonymize_member·replace_admin_permission_grants', () => {
  const pre = migration.slice(migration.indexOf('DO $precheck_member_suspension$'), migration.indexOf('$precheck_member_suspension$;'))
  for (const [sig, value] of [
    ['public.get_my_missing_required_consents()', 'a94b8de5fcfd4e5a81c4d988fabcb89f'],
    ['public.anonymize_member(uuid,uuid,text,uuid,integer,text,boolean,text,text,boolean,boolean)', '1346d870d3623abae580a011b0484339'],
    ['public.replace_admin_permission_grants(uuid,uuid,jsonb)', 'dcb2155fae26443c98231627d102a821'],
    ['public.record_admin_audit(uuid,text,text,text,uuid,integer,text,jsonb,text)', 'a42b474d9d95753ffba5041acb0c1c77'],
  ]) {
    assert.ok(pre.includes(`ARRAY['${sig}', '${value}']`), sig)
  }
  assert.match(pre, /ARRAY\['profiles_keep_admin_owner'\]/)
  assert.match(pre, /g\.permission IN \('members\.memo', 'members\.suspend'\)/)
  for (const name of NEW_FUNCTIONS) assert.ok(pre.includes(`'${name}'`), name)
})

test('표·권한(4-2): RLS 켬·정책 0, service_role 은 SELECT 만, 부분 UNIQUE, operation_key UNIQUE, CASCADE', () => {
  for (const table of ['member_suspensions', 'member_admin_notes']) {
    assert.match(section, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`))
    assert.match(section, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated, service_role;`))
    assert.match(section, new RegExp(`GRANT SELECT ON TABLE public\\.${table} TO service_role;`))
    assert.doesNotMatch(section, new RegExp(`CREATE POLICY [a-z_]+\\s+ON public\\.${table}`))
    assert.doesNotMatch(section, new RegExp(`GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*ON TABLE public\\.${table}`))
  }
  assert.equal(section.split('REFERENCES public.profiles(id) ON DELETE CASCADE').length - 1, 2)
  assert.match(section, /CREATE UNIQUE INDEX member_suspensions_one_open ON public\.member_suspensions \(user_id\) WHERE lifted_at IS NULL;/)
  assert.match(section, /CONSTRAINT member_suspensions_operation_key_key UNIQUE \(operation_key\)/)
  assert.match(section, /CHECK \(scope <> 'login_blocked' OR blocks_download\)/)
  assert.match(section, /CHECK \(scope <> 'restricted' OR ends_at IS NOT NULL\)/)
  // 메모 칸(가림 포함)
  for (const column of ['deleted_at', 'deleted_by', 'redacted_at', 'redacted_by']) assert.match(section, new RegExp(`\\n  ${column} `))
})

test('쓰기 막기 트리거: INSERT 는 함수 설정, DELETE 는 CASCADE(부모 없음)나 탈퇴 bypass, 가림은 그 메모 id 설정', () => {
  for (const name of ['guard_member_suspensions_mutation', 'guard_member_admin_notes_mutation']) {
    const body = fnBlock(migration, name)
    assert.match(body, /current_setting\('app\.member_suspension_write', true\), ''\) IS DISTINCT FROM NEW\.user_id::text/)
    assert.match(body, /NOT EXISTS \(SELECT 1 FROM public\.profiles p WHERE p\.id = OLD\.user_id\)/)
    assert.match(body, /current_setting\('app\.member_withdrawal_bypass', true\), ''\) = OLD\.user_id::text/)
  }
  assert.match(fnBlock(migration, 'guard_member_admin_notes_mutation'), /current_setting\('app\.member_note_redact', true\), ''\) IS DISTINCT FROM OLD\.id::text/)
  assert.match(section, /CREATE TRIGGER guard_member_suspensions_mutation\n  BEFORE INSERT OR UPDATE OR DELETE ON public\.member_suspensions/)
  assert.match(section, /CREATE TRIGGER guard_member_admin_notes_mutation\n  BEFORE INSERT OR UPDATE OR DELETE ON public\.member_admin_notes/)
})

test('함수(4-3): 모두 SECURITY DEFINER·search_path 고정, EXECUTE 는 get_my_member_gate 만 authenticated', () => {
  for (const name of NEW_FUNCTIONS) {
    const body = fnBlock(migration, name)
    assert.match(body, /\n SECURITY DEFINER\n|\n STABLE\n SECURITY DEFINER\n/, name)
    assert.match(body, /SET search_path TO 'public', 'pg_temp'/, name)
  }
  const grants = [...section.matchAll(/GRANT EXECUTE ON FUNCTION public\.([a-z_]+)\([^)]*\) TO ([a-z_]+);/g)].map((m) => [m[1], m[2]])
  assert.deepEqual(grants.filter(([, role]) => role !== 'service_role'), [['get_my_member_gate', 'authenticated']])
  assert.deepEqual(grants.filter(([name]) => name === 'get_my_member_gate'), [['get_my_member_gate', 'authenticated']])
  for (const internal of ['member_suspension_actor_allowed', 'guard_member_suspensions_mutation', 'guard_member_admin_notes_mutation', 'member_suspension_withdrawal_cleanup']) {
    assert.ok(!grants.some(([name]) => name === internal), internal)
    assert.match(section, new RegExp(`REVOKE ALL ON FUNCTION public\\.${internal}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`))
  }
  assert.match(fnBlock(migration, 'get_my_member_gate'), /FROM public\.get_my_missing_required_consents\(\)/)
  assert.match(fnBlock(migration, 'get_my_member_gate'), /auth\.uid\(\)/)
})

test('로그인 차단(4-3): 같은 거래에서 banned_until 과 auth 네 표 삭제, 해제는 잠근 뒤 withdrawn_at IS NULL 일 때만', () => {
  const suspend = fnBlock(migration, 'suspend_member')
  assert.match(suspend, /UPDATE auth\.users SET banned_until = COALESCE\(p_ends_at, v_now \+ interval '100 years'\) WHERE id = p_user_id;/)
  for (const table of ['auth.sessions', 'auth.refresh_tokens', 'auth.flow_state', 'auth.one_time_tokens']) {
    assert.ok(suspend.includes(`DELETE FROM ${table} WHERE user_id = p_user_id`), table)
  }
  const lift = fnBlock(migration, 'lift_member_suspension')
  assert.match(lift, /IF v_row\.scope = 'login_blocked' AND v_profile\.withdrawn_at IS NULL THEN\n    UPDATE auth\.users SET banned_until = NULL WHERE id = v_user;/)
  assert.match(lift, /IF NOT FOUND OR v_profile\.withdrawn_at IS NOT NULL THEN\n    RAISE EXCEPTION 'MEMBER_SUSPEND_TARGET_INVALID';/)
})

test('잠금 순서(3판): 해제·알림 기록은 프로필 FOR UPDATE 가 정지 행 잠금보다 앞, suspend_member 의 operation_key 확인은 프로필 잠금 뒤', () => {
  for (const name of ['lift_member_suspension', 'record_member_suspension_notice']) {
    const body = fnBlock(migration, name)
    const profileLock = body.indexOf('FROM public.profiles p WHERE p.id = v_user FOR UPDATE')
    const rowLock = body.indexOf('FROM public.member_suspensions s WHERE s.id = p_suspension_id FOR UPDATE')
    assert.ok(profileLock > 0 && rowLock > profileLock, name)
  }
  const suspend = fnBlock(migration, 'suspend_member')
  const profileLock = suspend.indexOf('FROM public.profiles p WHERE p.id = p_user_id FOR UPDATE')
  assert.ok(profileLock > 0)
  assert.ok(suspend.indexOf('WHERE s.operation_key = p_operation_key') > profileLock)
  assert.ok(suspend.indexOf("lift_reason = 'expired'") > suspend.indexOf('WHERE s.operation_key = p_operation_key'))
  assert.ok(suspend.indexOf('INSERT INTO public.member_suspensions') > suspend.indexOf("lift_reason = 'expired'"))
  // 메모 함수도 프로필 → 메모 순서(익명화와 교착 없음)
  for (const name of ['delete_member_admin_note', 'redact_member_admin_note']) {
    const body = fnBlock(migration, name)
    assert.ok(body.indexOf('FROM public.profiles p WHERE p.id = v_user FOR SHARE') < body.indexOf('WHERE n.id = p_note_id FOR UPDATE'), name)
  }
  assert.match(fnBlock(migration, 'add_member_admin_note'), /WHERE p\.id = p_user_id FOR SHARE;/)
})

test('작업 기록(4-3): p_reason NULL, details 키 목록 고정(자유 글·지문 없음), 종류는 admin-audit-log 에 있다', () => {
  const calls = [...section.matchAll(/PERFORM public\.record_admin_audit\(p_actor_id, '([a-z_]+)', ([^;]*?)\);/gs)]
  const actions = calls.map((m) => m[1])
  // (admin_permissions_replace 는 기존 종류 — 여러 줄 호출이라 이 정규식에 잡히지 않는다)
  assert.deepEqual([...new Set(actions)].sort(), [
    'member_note_add', 'member_note_delete', 'member_note_redact', 'member_suspend',
    'member_suspension_lift', 'member_suspension_notice_record', 'member_suspension_policy_update',
  ].sort())
  for (const action of actions) assert.ok(Object.prototype.hasOwnProperty.call(ADMIN_AUDIT_ACTIONS, action), action)
  for (const [action, keys] of Object.entries(AUDIT_DETAIL_KEYS)) {
    const call = calls.find((m) => m[1] === action)
    assert.ok(call, action)
    // (actor, action, target_type, target_id, target_user_id, amount, reason=NULL, details, request_id)
    assert.match(call[2], /, NULL, NULL,\s*jsonb_build_object\(/, `${action} amount·reason NULL`)
    const details = call[2].slice(call[2].indexOf('jsonb_build_object('))
    const used = [...details.matchAll(/'([a-z_]+)', /g)].map((m) => m[1]).sort()
    assert.deepEqual(used, [...keys].sort(), action)
    assert.doesNotMatch(details, /sha256|md5|member_reason'|internal_note'|lift_reason'|notice_summary'|'body'/, action)
  }
})

test('정책 행·문구 키: DB 저장 함수 목록 = 초안 키 = TS 키, 분류마다 blocksDownloadDefault, 코드에 분류별 기본값 없음', () => {
  const save = fnBlock(migration, 'save_member_suspension_policy')
  const dbKeys = [...save.slice(save.indexOf('c_text_keys'), save.indexOf('];', save.indexOf('c_text_keys'))).matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1])
  assert.deepEqual(dbKeys, [...suspension.MEMBER_SUSPENSION_TEXT_KEYS])
  const seed = JSON.parse(section.slice(section.indexOf('$policy${') + '$policy$'.length, section.indexOf('}$policy$') + 1))
  assert.deepEqual(Object.keys(seed.texts), [...suspension.MEMBER_SUSPENSION_TEXT_KEYS])
  assert.equal(seed.revision, 1)
  assert.equal(seed.maxRestrictedDays, 30)
  assert.ok(seed.reasonCategories.every((c) => typeof c.blocksDownloadDefault === 'boolean' && typeof c.hidden === 'boolean'))
  assert.ok(suspension.parseMemberSuspensionPolicy(seed))
  assert.match(save, /jsonb_typeof\(v_c -> 'blocksDownloadDefault'\) IS DISTINCT FROM 'boolean'/)
  assert.match(save, /MEMBER_SUSPENSION_POLICY_CODE_IN_USE/)
  assert.match(section, /ON CONFLICT \(key\) DO NOTHING;/)
  // 분류 코드는 데이터다 — src 에 초안 코드 글자가 없어야 한다(분류별 기본값·분기 금지)
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : []
  })
  const srcRoot = new URL('../src', import.meta.url).pathname
  for (const file of walk(srcRoot)) {
    const text = readFileSync(file, 'utf8')
    for (const code of seed.reasonCategories.map((c) => c.code).filter((code) => code !== 'other')) {
      assert.ok(!text.includes(`'${code}'`) && !text.includes(`"${code}"`), `${file} 에 분류 코드 ${code}`)
    }
  }
})

test('탈퇴 트리거(4-4): withdrawn_at NULL→값, DELETE 만, RAISE 없음 — 10번 시행 스크립트가 찾는 이름', () => {
  assert.match(section, /CREATE TRIGGER member_suspension_withdrawal_cleanup\n  AFTER UPDATE OF withdrawn_at ON public\.profiles\n  FOR EACH ROW\n  WHEN \(OLD\.withdrawn_at IS NULL AND NEW\.withdrawn_at IS NOT NULL\)/)
  const body = prosrc(migration, 'member_suspension_withdrawal_cleanup')
  assert.doesNotMatch(body, /RAISE|EXCEPTION|UPDATE|INSERT/)
  assert.match(body, /DELETE FROM public\.member_admin_notes WHERE user_id = NEW\.id;/)
  assert.match(body, /DELETE FROM public\.member_suspensions WHERE user_id = NEW\.id;/)
  // 01-11 시행 스크립트(10번)의 점검과 같은 이름
  const policyScript = read('supabase/scripts/20261126_bundle10_policy_text.sql')
  for (const name of ["to_regclass('public.member_suspensions')", "to_regclass('public.member_admin_notes')", "f.proname = 'redact_member_admin_note'",
    "f.prosrc LIKE '%member_suspensions%' AND f.prosrc LIKE '%member_admin_notes%'"]) {
    assert.ok(policyScript.includes(name), name)
  }
  assert.match(fnBlock(migration, 'redact_member_admin_note'), /COALESCE\(NULLIF\(btrim\(s\.value #>> '\{texts,redactionMask\}'\), ''\), '\[가림 처리됨\]'\)/)
})

test('권한 함수(4-5): 목록 = ADMIN_PERMISSION_KEYS, md5(prosrc) 상수가 본문과 같음, 되돌리기는 20261118120000 본문 그대로', () => {
  const body = prosrc(migration, 'replace_admin_permission_grants')
  const list = body.match(/= ANY \(ARRAY\[([\s\S]*?)\]::text\[\]\)/)[1]
  assert.deepEqual([...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort(), [...permissions.ADMIN_PERMISSION_KEYS].sort())
  assert.equal(md5(body), 'd6cd294fb5cb60c7e17356c895bf259b')
  assert.ok(migration.includes("IS DISTINCT FROM 'd6cd294fb5cb60c7e17356c895bf259b'"))
  assert.ok(down.includes("IS DISTINCT FROM 'd6cd294fb5cb60c7e17356c895bf259b'"))
  const original = prosrc(read('supabase/migrations/20261118120000_admin_credit_grant_limits.sql'), 'replace_admin_permission_grants')
  assert.equal(prosrc(down, 'replace_admin_permission_grants'), original)
  assert.equal(md5(original), '54540b6b0286f81f243575f1c03a568c')
  assert.equal(body.replace("'credits.limits.manage',\n       'members.memo', 'members.suspend'\n", "'credits.limits.manage'\n"), original)
  for (const key of ['members.memo', 'members.suspend']) {
    assert.deepEqual(permissions.ADMIN_PERMISSIONS[key].requires, ['members.view'])
  }
  assert.match(section, /CREATE POLICY system_settings_member_suspension_policy_no_client_write\n  ON public\.system_settings\n  AS RESTRICTIVE\n  FOR UPDATE/)
})

test('DB 판정 = TS 판정: 직원은 그 권한과 members.view 가 모두 있어야(대표·직원 조합 6가지)', () => {
  const access = (role, keys) => ({ userId: 'u', role, grants: Object.fromEntries(keys.map((k) => [k, {}])) })
  // DB member_suspension_actor_allowed 와 같은 규칙: 대표 통과, 직원은 (권한 + members.view)
  const db = (role, keys, permission) => role === 'owner' || (permission !== 'owner' && keys.includes(permission) && keys.includes('members.view'))
  const cases = [
    ['owner', [], 'members.suspend'],
    ['owner', [], 'owner'],
    ['staff', ['members.view', 'members.suspend'], 'members.suspend'],
    ['staff', ['members.suspend'], 'members.suspend'],
    ['staff', ['members.view', 'members.memo'], 'members.suspend'],
    ['staff', ['members.view', 'members.suspend'], 'owner'],
  ]
  for (const [role, keys, permission] of cases) {
    assert.equal(permissions.hasAdminPermission(access(role, keys), permission), db(role, keys, permission), `${role} ${keys} ${permission}`)
  }
  const body = fnBlock(migration, 'member_suspension_actor_allowed')
  assert.match(body, /p\.admin_role = 'owner'/)
  assert.match(body, /g\.permission = p_permission/)
  assert.match(body, /g\.permission = 'members\.view'/)
})

test('되돌리기(4-6): 머리 확인 5개, 내보내기 확인 상수 2개, 순서 트리거 → 함수 → 권한 함수 → 정책 → 설정 행 → 표', () => {
  const head = down.slice(down.indexOf('DO $precheck_member_suspension_down$'), down.indexOf('$precheck_member_suspension_down$;'))
  assert.match(head, /s\.lifted_at IS NULL AND \(s\.ends_at IS NULL OR s\.ends_at > now\(\)\)/)
  assert.match(head, /s\.scope = 'login_blocked' AND p\.withdrawn_at IS NULL\s+AND u\.banned_until IS NOT NULL/)
  assert.match(head, /g\.permission IN \('members\.memo', 'members\.suspend'\)/)
  assert.match(head, /md5\(p\.prosrc\)/)
  assert.match(head, /'20261217100000', '20261217110000', '20261217120000', '20261217130000'/)
  assert.match(head, /m\.version > '20261214100000' AND m\.name LIKE '%bundle13%'/)
  assert.match(head, /c_suspensions_export_confirmed constant boolean := false;/)
  assert.match(head, /c_notes_export_confirmed constant boolean := false;/)
  const order = ['DROP TRIGGER member_suspension_withdrawal_cleanup ON public.profiles;', 'DROP FUNCTION public.get_my_member_gate();',
    'CREATE OR REPLACE FUNCTION public.replace_admin_permission_grants(', 'DROP POLICY system_settings_member_suspension_policy_no_client_write',
    "DELETE FROM public.system_settings WHERE key = 'member_suspension_policy';", 'DROP TABLE public.member_admin_notes;']
  const positions = order.map((text) => down.indexOf(text))
  assert.ok(positions.every((p) => p > 0), JSON.stringify(positions))
  assert.deepEqual([...positions].sort((a, b) => a - b), positions)
})

test('리허설(11-2): 생성 파일이 최신, light 는 기존 표 잠금 DDL·COMMIT 없음, @test.com 만·없으면 RH FAIL [setup]', () => {
  execFileSync(process.execPath, ['supabase/scripts/bundle12_rehearsal/generate.mjs', '--check'], { cwd: new URL('..', import.meta.url) })
  const light = read('supabase/scripts/bundle12_rehearsal/a_light.sql')
  const full = read('supabase/scripts/bundle12_rehearsal/b_full.sql')
  for (const [name, sql] of [['light', light], ['full', full]]) {
    assert.ok(sql.startsWith('-- 12번 묶음 리허설'), name)
    assert.match(sql, /^BEGIN;$/m)
    assert.ok(sql.trimEnd().endsWith('ROLLBACK;'), name)
    assert.doesNotMatch(sql, /^\s*COMMIT\s*;/m, name)
    assert.match(sql, /u\.email LIKE '%@test\.com'/)
    assert.match(sql, /RH FAIL \[setup\]/)
    assert.doesNotMatch(sql, /INSERT INTO auth\.users/)
  }
  const code = light.replace(/--[^\n]*/g, '')
  for (const word of ['LOCK TABLE', 'CREATE POLICY', 'DROP POLICY', 'DROP TRIGGER', 'ON public.profiles', 'REFERENCES public.profiles', 'DISABLE TRIGGER']) {
    assert.ok(!code.includes(word), `light 에 ${word}`)
  }
  for (const match of code.matchAll(/ALTER TABLE ([a-z_.]+)/g)) {
    assert.ok(['public.member_suspensions', 'public.member_admin_notes'].includes(match[1]), match[1])
  }
  assert.ok(!migrationCopy('light').includes('CREATE TRIGGER member_suspension_withdrawal_cleanup'))
  assert.ok(!downCopy('light').includes('DROP TRIGGER member_suspension_withdrawal_cleanup'))
  for (const s of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12', 'S13']) {
    assert.ok(full.includes(`'${s}'`), `full ${s}`)
  }
  assert.match(full, /public\.anonymize_member\(%L, %L, %L, NULL/)
  assert.match(full, /'owner', \(v_req ->> 'requestId'\)::uuid/)
})

test('코드 대체 문구는 apiBlocked·loginBlocked·noticeCheckFailed 셋뿐', () => {
  assert.deepEqual(Object.keys(suspension.MEMBER_SUSPENSION_FALLBACK_TEXTS).sort(), ['apiBlocked', 'loginBlocked', 'noticeCheckFailed'])
  assert.equal(suspension.memberSuspensionText(null, 'bannerRestricted'), null)
  assert.equal(suspension.memberSuspensionText(null, 'apiBlocked'), suspension.MEMBER_SUSPENSION_FALLBACK_TEXTS.apiBlocked)
})

test('판정·기한 경고 규칙(3절)', () => {
  const now = Date.parse('2026-12-20T00:00:00Z')
  assert.equal(suspension.isMemberSuspensionActive({ lifted_at: null, ends_at: null }, now), true)
  assert.equal(suspension.isMemberSuspensionActive({ lifted_at: null, ends_at: '2026-12-19T00:00:00Z' }, now), false)
  assert.equal(suspension.isMemberSuspensionActive({ lifted_at: '2026-12-19T00:00:00Z', ends_at: null }, now), false)
  const deadlines = { paidBalance: 100, earliestCreditExpiry: '2027-06-01T00:00:00Z', chargeRefundUntil: '2026-12-25T15:00:00Z', materialRefundUntil: null }
  const earliest = suspension.earliestMemberDeadline(deadlines, now)
  assert.deepEqual(earliest, { kind: 'chargeRefund', at: '2026-12-25T15:00:00Z' })
  assert.equal(suspension.suspensionExceedsDeadline({ scope: 'login_blocked', endsAt: null }, null), true)
  assert.equal(suspension.suspensionExceedsDeadline({ scope: 'restricted', endsAt: '2026-12-30T00:00:00Z' }, earliest), true)
  assert.equal(suspension.suspensionExceedsDeadline({ scope: 'restricted', endsAt: '2026-12-22T00:00:00Z' }, earliest), false)
  // 같은 날(둘 다 다음 날 00:00 KST)도 경고 — 이용 제한·로그인 차단 모두
  assert.equal(suspension.suspensionExceedsDeadline({ scope: 'restricted', endsAt: '2026-12-25T15:00:00Z' }, earliest), true)
  assert.equal(suspension.suspensionExceedsDeadline({ scope: 'login_blocked', endsAt: '2026-12-25T15:00:00Z' }, earliest), true)
  assert.equal(suspension.parseMemberGate({ missingRequired: [], restriction: { scope: 'restricted', blocksDownload: false, endsAt: null } })?.restriction?.scope, 'restricted')
  assert.equal(suspension.parseMemberGate({ missingRequired: [], restriction: null })?.restriction, null)
  assert.equal(suspension.parseMemberGate({ restriction: null }), null)
  assert.equal(suspension.readSuspensionBlockCode(403, { code: 'MEMBER_SUSPENDED' }), 'MEMBER_SUSPENDED')
  assert.equal(suspension.readSuspensionBlockCode(503, { error: { code: 'SUSPENSION_CHECK_FAILED' } }), 'SUSPENSION_CHECK_FAILED')
  assert.equal(suspension.readSuspensionBlockCode(403, { code: 'CONSENT_REQUIRED' }), null)
  assert.equal(suspension.describeMemberSuspensionError('MEMBER_SUSPENSION_POLICY_INPUT_INVALID: texts.noticeTitle').code, 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID')
})

// ── 회원 쪽(1절 표·5절) ──────────────────────────────────────────────────────────────────────────────
// 1절 표(전수 시험의 기준). 키: 'src/app/ 아래 경로 METHOD' 또는 서버 액션 파일.
const ROUTE_TABLE = {
  // 막기: 동의 가드 안에서 함께(checkMemberConsentForApi → checkMemberSuspensionForApi 'write')
  blockWithConsent: [
    'api/payments/payapp/orders/route.ts POST',
    'api/market/cart/checkout/route.ts POST',
    // 꺼진 기능(미들웨어 404)이지만 동의 가드가 있다
    'api/questions/generate/route.ts POST',
    'api/generate/listboard-jobs/[jobId]/run/route.ts POST',
    'api/generate/listboard-jobs/[jobId]/retry/route.ts POST',
    'api/questions/save-from-community/route.ts POST',
    'api/questions/save-from-community/route.ts PUT',
  ],
  // 막기: 따로 부름
  blockDirect: [
    'api/market/cart/items/route.ts POST',
    'api/market/cart/items/route.ts PATCH',
    'api/market/items/[itemId]/reviews/route.ts POST',
    'api/market/reviews/[reviewId]/vote/route.ts POST',
    'api/market/items/[itemId]/download/route.ts GET',
  ],
  open: [
    'api/market/cart/route.ts GET', 'api/market/cart/items/route.ts DELETE', 'api/market/cart/checkouts/[key]/route.ts GET',
    'api/market/reviews/[reviewId]/route.ts DELETE', 'api/refunds/request/route.ts POST', 'api/market/refunds/route.ts POST',
    'api/support/route.ts POST', 'api/support/route.ts PUT', 'api/support/route.ts DELETE',
    'api/auth/withdraw/route.ts POST', 'api/auth/withdraw/route.ts DELETE', 'api/auth/logout/route.ts POST',
    'api/auth/consent-logout/route.ts POST', 'api/auth/cancel-signup/route.ts POST',
    'api/auth/sessions/route.ts POST', 'api/auth/sessions/route.ts PATCH', 'api/auth/sessions/route.ts DELETE',
    'api/profile/route.ts PATCH', 'api/notifications/route.ts GET', 'api/notifications/route.ts PATCH',
    'api/market/items/[itemId]/view/route.ts POST', 'api/credits/balance/route.ts GET', 'api/credits/sources/route.ts GET',
    'api/credits/transactions/route.ts GET', 'api/payments/payapp/return/route.ts GET', 'api/payments/payapp/return/route.ts POST',
    'api/payments/payapp/status/route.ts GET', 'api/payments/webhooks/payapp/route.ts POST',
    'api/payments/kakaopay/callback/approve/route.ts GET', 'api/payments/kakaopay/callback/cancel/route.ts GET',
    'api/payments/kakaopay/callback/fail/route.ts GET', 'api/payments/kakaopay/status/route.ts GET',
    '(auth)/consent/actions.ts', '(solvook)/mypage/consents/actions.ts',
  ],
  // 이미 닫힘(410·503). 상품 바로 구매 POST 는 11번에서 410 으로 닫혀 1절 표의 '동의 가드' 줄에서 옮겼다(구현 메모).
  closed: [
    'api/market/purchases/batch/route.ts POST', 'api/credits/purchase/route.ts POST', 'api/credits/deduct/route.ts POST',
    'api/payments/kakaopay/orders/route.ts POST', 'api/market/items/[itemId]/purchase/route.ts POST',
  ],
  // 꺼진 기능(미들웨어 404, 가드 없음)
  disabled: [
    'api/exam-papers/[id]/route.ts GET', 'api/exam-papers/[id]/route.ts DELETE', 'api/exam-papers/print-pdf/route.ts POST',
    'api/exam-papers/random-bank/route.ts POST', 'api/exam-papers/route.ts POST', 'api/exam-papers/route.ts GET',
    'api/generate/listboard-jobs/[jobId]/route.ts GET', 'api/generate/listboard-jobs/[jobId]/save/route.ts POST',
    'api/generate/listboard-jobs/route.ts POST', 'api/questions/route.ts POST', 'api/questions/[id]/route.ts PATCH',
    'api/questions/[id]/route.ts DELETE', 'api/questions/review/route.ts POST', 'api/question-bank/availability/route.ts GET',
    'api/question-bank/options/route.ts GET', 'api/ocr/actions.ts', 'api/passages/actions.ts', 'api/ai/generate-passages.ts',
  ],
  // 로그인 전·공개(가드 없음)
  public: [
    'auth/actions.ts', 'auth/password-reset-actions.ts', 'auth/confirm/route.ts GET', 'auth/confirm/route.ts POST',
    'auth/callback/route.ts GET', 'api/market/category-menu/route.ts GET', 'api/market/items/[itemId]/sample-pages/route.ts GET',
    'api/pricing-plans/route.ts GET', 'api/support/categories/route.ts GET',
  ],
  // 회원 경로가 아님(서버 작업)
  server: ['api/cron/market/cleanup-auto-upload-drafts/route.ts POST', 'api/internal/payments/reconcile/route.ts POST'],
}

const APP_ROOT = new URL('../src/app/', import.meta.url).pathname
const walkApp = (dir) => readdirSync(dir).flatMap((name) => {
  const path = `${dir}/${name}`
  return statSync(path).isDirectory() ? walkApp(path) : [path]
})
const appFiles = walkApp(APP_ROOT.replace(/\/$/, '')).map((path) => path.slice(APP_ROOT.length))
const isAdminPath = (path) => path.startsWith('api/admin/') || path.startsWith('(admin)/')
const METHOD_RE = /export (?:async function|const) (GET|POST|PUT|PATCH|DELETE|HEAD)\b/g

function handlerBodies(path) {
  const source = read(`src/app/${path}`)
  const exports = [...source.matchAll(METHOD_RE)].map((m) => ({ method: m[1], index: m.index }))
  return exports.map((entry, i) => ({ method: entry.method, body: source.slice(entry.index, exports[i + 1]?.index ?? source.length) }))
}

test('전수(11-1): src/app 의 모든 route 메서드와 \'use server\' 파일이 1절 표의 한 줄에 있다(관리자 경로 제외)', () => {
  const entries = []
  for (const path of appFiles.filter((p) => p.endsWith('route.ts') && !isAdminPath(p))) {
    for (const { method } of handlerBodies(path)) entries.push(`${path} ${method}`)
  }
  for (const path of appFiles.filter((p) => /\.tsx?$/.test(p) && !isAdminPath(p))) {
    if (/^['"]use server['"]/m.test(read(`src/app/${path}`))) entries.push(path)
  }
  const table = Object.values(ROUTE_TABLE).flat()
  assert.equal(new Set(table).size, table.length, '표에 같은 줄이 두 번')
  assert.deepEqual([...entries].sort(), [...table].sort())
})

test('막기는 인증 직후·첫 쓰기 전에 가드를 부르고, 열기·공개·꺼진 기능은 부르지 않는다', () => {
  const bodyOf = (entry) => {
    const [path, method] = entry.split(' ')
    return method ? handlerBodies(path).find((h) => h.method === method).body : read(`src/app/${path}`)
  }
  const firstWrite = (body) => {
    const hits = ['.insert(', '.upsert(', '.update(', '.delete(', '.rpc(', 'fetch('].map((word) => body.indexOf(word)).filter((i) => i >= 0)
    return hits.length ? Math.min(...hits) : Infinity
  }
  for (const entry of ROUTE_TABLE.blockDirect) {
    const body = bodyOf(entry)
    const guard = body.indexOf('checkMemberSuspensionForApi(')
    assert.ok(guard > 0, `${entry}: 가드 없음`)
    assert.ok(guard < firstWrite(body), `${entry}: 첫 쓰기보다 뒤`)
  }
  for (const entry of ROUTE_TABLE.blockWithConsent) {
    const [path] = entry.split(' ')
    assert.match(read(`src/app/${path}`), /checkMemberConsentForApi\(/, entry)
  }
  assert.match(bodyOf('api/market/items/[itemId]/download/route.ts GET'), /checkMemberSuspensionForApi\(user\.id, 'download'\)/)
  for (const entry of [...ROUTE_TABLE.open, ...ROUTE_TABLE.public, ...ROUTE_TABLE.disabled]) {
    const body = bodyOf(entry)
    assert.ok(!body.includes('checkMemberSuspensionForApi(') && !body.includes('checkMemberConsentForApi('), `${entry}: 열기인데 가드를 부름`)
  }
  // 동의 가드는 동의를 통과한 뒤 정지(쓰기)를 함께 본다
  const consentGuard = read('src/lib/consent-guard-server.ts')
  assert.ok(consentGuard.indexOf("return block(403, 'CONSENT_REQUIRED')") < consentGuard.indexOf("checkMemberSuspensionForApi(sessionUser.id, 'write')"))
})

test('가드(5-1): 실패하면 503 으로 막고, 다운로드는 303(/mypage/restriction, 확인 실패 ?check=failed), blocksDownload=false 면 통과', () => {
  const server = read('src/lib/member-suspension-server.ts')
  assert.match(server, /^import 'server-only'/m)
  assert.match(server, /rpc\('member_active_suspension'/)
  assert.match(server, /SUSPENSION_CHECK_FAILED/)
  assert.match(server, /MEMBER_RESTRICTION_CHECK_FAILED_PATH/)
  assert.match(server, /303/)
  assert.match(server, /blocksDownload/)
  assert.match(read('src/lib/market-download-diagnosis.ts'), /member_suspended/)
  assert.match(read('src/lib/admin-orders-server.ts'), /memberSuspension: suspensionByUser\.get\(row\.user_id\) \?\? null/)
  // 결제 통보·지급·환불·대조는 정지를 보지 않는다
  for (const path of ['src/app/api/payments/webhooks/payapp/route.ts', 'src/app/api/internal/payments/reconcile/route.ts',
    'src/app/api/refunds/request/route.ts', 'src/app/api/market/refunds/route.ts', 'src/app/api/payments/payapp/return/route.ts']) {
    const text = read(path.replace(/^src\/app\//, 'src/app/'))
    assert.ok(!/member_suspension|MemberSuspension|member-suspension/.test(text), path)
  }
  for (const name of ['payapp_fulfill_order_internal', 'apply_payapp_feedback', 'process_payapp_cancellation', 'approve_market_refund']) {
    assert.ok(!section.includes(`FUNCTION public.${name}(`), name)
  }
})

test('미들웨어(5-2): get_my_member_gate 한 번, 최소 제외, 헤더는 늘 지우고(정적 분기 포함) 모든 재생성이 넘김, 관리자 ID 는 판정 안 함', () => {
  const mw = read('src/lib/supabase/middleware.ts')
  assert.match(mw, /\.rpc\('get_my_member_gate'\)/)
  assert.doesNotMatch(mw, /\.rpc\('get_my_missing_required_consents'\)/)
  assert.match(mw, /isMemberGateExcludedPath\(request\.nextUrl\.pathname\)/)
  assert.match(mw, /isAdminAccountEmail\(user\.email \?\? ''\)\) return pass/)
  assert.match(mw, /redirectUrl\.searchParams\.set\('error', ACCOUNT_BLOCKED_LOGIN_ERROR\)/)
  assert.match(mw, /requestHeaders\.delete\(AUTH_USER_ID_HEADER\)\n    requestHeaders\.delete\(MEMBER_RESTRICTION_HEADER\)/)
  assert.match(mw, /requestHeaders\.delete\(MEMBER_RESTRICTION_HEADER\)\n  if \(memberRestriction\)/)
  // 모든 응답 재생성(buildNextResponse·buildRequestHeaders·buildRoutingResponse 호출)이 restriction 을 넘긴다
  for (const call of mw.matchAll(/(?<!function )buildNextResponse\(([^)]*)\)/g)) assert.match(call[1], /memberRestriction/, call[0])
  for (const call of mw.matchAll(/headers: buildRequestHeaders\(([^)]*)\)/g)) assert.match(call[1], /memberRestriction/, call[0])
  for (const call of mw.matchAll(/(?<!const )buildRoutingResponse\(([^)]*)\)/g)) assert.match(call[1], /memberRestriction/, call[0])
  // 최소 제외 예시: 동의 제외 경로에서도 정지 판정은 한다
  for (const path of ['/library', '/mypage/support', '/checkout/payapp/result', '/mypage/restriction', '/', '/korean/market']) {
    assert.equal(suspension.isMemberGateExcludedPath(path), false, path)
  }
  for (const path of ['/login', '/auth/callback', '/api/market/cart', '/admin/users', '/_next/static/x.js', '/logo.png']) {
    assert.equal(suspension.isMemberGateExcludedPath(path), true, path)
  }
  assert.match(read('src/lib/consent-gate.ts'), /'\/mypage\/restriction',/)
})

test('로그인 오류(5-3): 이메일 액션·카카오 콜백의 user_banned 코드 → account_blocked, 영어 원문 비교 없음', () => {
  const actions = read('src/app/auth/actions.ts')
  assert.match(actions, /error\.code === AUTH_USER_BANNED_CODE/)
  assert.match(actions, /code: ACCOUNT_BLOCKED_LOGIN_ERROR/)
  const callback = read('src/app/auth/callback/route.ts')
  assert.match(callback, /errorCode === AUTH_USER_BANNED_CODE/)
  assert.ok(callback.indexOf('errorCode === AUTH_USER_BANNED_CODE') < callback.indexOf('if (error || !code)'), '설명 글 분기보다 코드를 먼저 본다')
  for (const text of [actions, callback, read('src/app/(auth)/login/page.tsx')]) {
    assert.doesNotMatch(text, /User is banned/i)
  }
  assert.equal(suspension.AUTH_USER_BANNED_CODE, 'user_banned')
  assert.equal(suspension.ACCOUNT_BLOCKED_LOGIN_ERROR, 'account_blocked')
})

test('회원 화면 문구(5-3): 한 줄 안내는 (solvook) 레이아웃 한 곳, 안내 화면은 정책 키로 읽고 처음 연 시각을 남긴다', () => {
  const layout = read('src/app/(solvook)/layout.tsx')
  assert.match(layout, /MemberRestrictionBanner|member-restriction-banner/)
  assert.match(read('src/app/checkout/layout.tsx'), /export \{ default \} from '@\/app\/\(solvook\)\/layout'/)
  const page = read('src/app/(solvook)/mypage/restriction/page.tsx')
  for (const key of ['noticeTitle', 'noticeIntro', 'noticeBlockedList', 'noticeBlockedDownload', 'noticeAvailableList', 'noticeDeadlines',
    'noticeObjection', 'noticeUntilLifted', 'noticeNone', 'noticeCheckFailed', 'deadlineChargeRefund', 'deadlineMaterialRefund', 'deadlineCreditExpiry']) {
    assert.ok(page.includes(`texts.${key}`), key)
  }
  assert.match(page, /markMemberSuspensionSeen\(userId\)/)
  // 기한 이름은 코드 글자가 아니라 정책 문구다
  assert.doesNotMatch(page, /'충전 환불'|'자료 환불'|'유료 크레딧 소멸'/)
})

test('날짜 셈법(공용 하나): 끝 시각을 넣지 않는 마감·끝나는 날은 1ms 앞의 한국 날짜, 안내 화면·대표 이메일 초안이 같이 쓴다', () => {
  // 관리자가 12월 20일까지로 정지 → ends_at = 12월 21일 00:00 KST = 12월 20일 15:00Z → 회원 화면 '12월 20일'
  assert.equal(suspension.formatMemberLastDay('2026-12-20T15:00:00.000Z'), '2026년 12월 20일')
  // 환불 마감(마지막 날 다음 날 00:00 KST)도 같은 셈법
  assert.equal(suspension.formatMemberLastDay('2027-01-10T15:00:00Z'), '2027년 1월 10일')
  assert.equal(suspension.formatMemberDay('2026-12-20T15:00:00Z'), '2026년 12월 21일')
  const page = read('src/app/(solvook)/mypage/restriction/page.tsx')
  assert.match(page, /suspension\.endsAt \? formatMemberLastDay\(suspension\.endsAt\)/)
  assert.doesNotMatch(page, /Intl\.DateTimeFormat|formatDate\(|formatLastDay\(/)
  for (const key of ['chargeRefundUntil', 'materialRefundUntil', 'earliestCreditExpiry']) {
    assert.match(page, new RegExp(`formatMemberLastDay\\(deadlines\\.${key}\\)`), key)
  }
  const panel = read('src/app/(admin)/admin/users/[id]/member-suspension-panel.tsx')
  assert.match(panel, /dateLabel: formatMemberLastDay\(earliest\.at\)/)
  assert.match(panel, /scope === 'login_blocked' && earliest\n/)
  assert.match(panel, /data\.deadlines\?\.failed &&/)
  // 기한 조회 실패면 '기한 문장은 빼고 보내세요'가 아니라 직접 찾으라는 안내
  assert.match(panel, /scope === 'login_blocked' && !mailDraft && !data\.deadlines\?\.failed &&/)
  assert.match(panel, /scope === 'login_blocked' && data\.deadlines\?\.failed && \([\s\S]*?가장 빠른 기한을 직접 찾아 이메일에 넣으세요/)
})

test('자료 환불 기한(보수적): 묶음 주문은 다운로드·일부 환불·심사 여부와 상관없이 같은 마감을 후보에 넣는다', () => {
  const body = fnBlock(migration, 'member_refund_deadlines')
  assert.match(body, /AND \(o\.purchase_type = 'bundle'\n\s+OR \(COALESCE\(o\.refund_committed_credits, 0\) = 0/)
  assert.match(body, /public\.market_refund_deadline\(o\.created_at, v_days\) > now\(\)/)
  assert.match(body, /get_point_charge_refund_eligibility\(p_user_id, s\.id\)/)
  assert.match(read('src/app/(admin)/admin/users/suspension-policy-card.tsx'), /disabled=\{category\.persisted\}/)
})
