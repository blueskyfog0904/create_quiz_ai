import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { NextResponse, load } from './helpers/market-images-harness.mjs'

// 10번 묶음(docs/plan-bundle10-member-withdrawal.md): 결제 회원 탈퇴 = 익명화 — 코드 부분의 계약.
// 판정·처리는 DB 함수(20261126100000_member_withdrawal.sql)가 하고, 코드는 부르고·다시 시도하고·문구를 DB 값으로 채운다.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261126100000_member_withdrawal.sql')
const seedPolicy = JSON.parse(migration.split('$json$')[1])

const kst = load('src/lib/kst-date-format.ts')
const lib = load('src/lib/member-withdrawal.ts', { '@/lib/kst-date-format': kst })
const policy = lib.parseMemberWithdrawalPolicy(seedPolicy)

const USER_ID = '00000000-0000-4000-8000-0000000000aa'
const SHA = 'a'.repeat(64)

const sources = {
  lib: read('src/lib/member-withdrawal.ts'),
  server: read('src/lib/member-withdrawal-server.ts'),
  route: read('src/app/api/auth/withdraw/route.ts'),
  page: read('src/app/(solvook)/mypage/withdraw/page.tsx'),
  view: read('src/app/(solvook)/mypage/withdraw/_components/withdraw-view.tsx'),
  adminRoute: read('src/app/api/admin/users/[id]/withdrawal/route.ts'),
  adminPanel: read('src/app/(admin)/admin/users/[id]/member-withdrawal-panel.tsx'),
  adminDetail: read('src/lib/admin-member-detail-server.ts'),
  adminPage: read('src/app/(admin)/admin/users/[id]/page.tsx'),
  types: read('src/types/supabase.ts'),
}

// ---------------------------------------------------------------------------------------------------------------
// 1. 정책·문구는 DB 값(하드코딩 금지)
// ---------------------------------------------------------------------------------------------------------------
test('정책 읽기: 처음 값은 스위치 꺼짐·결제 대기 7일·비결제 문의 3년, 키가 없거나 true 가 아니면 꺼짐', () => {
  assert.equal(policy.selfAnonymizeEnabled, false)
  assert.equal(policy.selfWithdrawOrderQuietDays, 7)
  assert.equal(policy.nonPayerTicketRetentionYears, 3)
  assert.equal(policy.marketingConsentItemKey, 'marketing')
  assert.equal(lib.parseMemberWithdrawalPolicy({ ...seedPolicy, selfAnonymizeEnabled: 'true' }).selfAnonymizeEnabled, false)
  const { selfAnonymizeEnabled: _ignored, ...withoutSwitch } = seedPolicy
  assert.equal(lib.parseMemberWithdrawalPolicy(withoutSwitch).selfAnonymizeEnabled, false)
  assert.equal(lib.parseMemberWithdrawalPolicy({ ...seedPolicy, texts: null }), null)
  assert.equal(lib.parseMemberWithdrawalPolicy(null), null)
})

test('화면이 쓰는 문구 경로는 모두 DB 정책 texts 에 있다', () => {
  const paths = new Set()
  for (const source of [sources.page, sources.route, sources.adminDetail, sources.lib]) {
    for (const match of source.matchAll(/withdrawalText\([^,]+, '([A-Za-z.]+)'\)/g)) paths.add(match[1])
    for (const match of source.matchAll(/\btext\('([A-Za-z.]+)'\)/g)) paths.add(match[1])
  }
  assert.ok(paths.size >= 20, `경로 ${paths.size}개`)
  for (const path of paths) {
    assert.ok(lib.withdrawalText(policy, path), `texts.${path} 가 없다`)
  }
  // 막힘 사유 문구도 DB 값을 쓴다(동적 경로)
  assert.match(sources.lib, /withdrawalText\(policy, `blockReasons\.\$\{reason\}`\)/)
  for (const reason of ['ADMIN', 'DISABLED', 'IN_PROGRESS', 'REFUND_PERIOD_OPEN', 'REFUND_PERIOD_BUFFER', 'PROVIDER_UNVERIFIED', 'REDACTION_REQUIRED', 'RECENT_PAYMENT_ACTIVITY', 'REQUEST_PENDING']) {
    assert.ok(lib.withdrawalText(policy, `blockReasons.${reason}`), reason)
  }
})

test('코드가 채우는 자리표시는 {비결제문의보존기간} {결제대기일} {가능예정일} 세 개뿐이고, 화면 문구에 다른 자리표시가 남지 않는다', () => {
  assert.deepEqual(Object.values(lib.WITHDRAWAL_SCREEN_PLACEHOLDERS), ['{비결제문의보존기간}', '{결제대기일}', '{가능예정일}'])
  const at = '2026-12-01T03:00:00.000Z'
  const values = { nonPayerTicketYears: 3, quietDays: 7, availableFrom: at }
  // 고지 원문(texts.notice·noticeTitle — DB 가 채움)을 뺀 화면 문구
  const screenStrings = []
  const walk = (node, path) => {
    if (typeof node === 'string') screenStrings.push([path, node])
    else if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`)
  }
  const { notice: _notice, noticeTitle: _title, ...screenTexts } = seedPolicy.texts
  walk(screenTexts, 'texts')
  for (const [path, text] of screenStrings) {
    assert.ok(lib.fillWithdrawalScreenText(text, values), `${path}: 채운 뒤 자리표시가 남는다`)
  }
  assert.equal(
    lib.fillWithdrawalScreenText(seedPolicy.texts.blockReasons.RECENT_PAYMENT_ACTIVITY, values),
    '최근 결제 시도가 있어 7일이 지난 뒤(2026.12.01 12:00부터) 탈퇴할 수 있습니다.'
  )
  assert.equal(
    lib.fillWithdrawalScreenText(seedPolicy.texts.ticketRetentionChoice.agree, values),
    '문의 3년 보존에 동의합니다'
  )
  // 값이 없으면 null(문구를 빼거나 막는다)
  assert.equal(lib.fillWithdrawalScreenText(seedPolicy.texts.blockReasons.RECENT_PAYMENT_ACTIVITY, {}), null)
  assert.equal(lib.fillWithdrawalScreenText('{모르는값}', values), null)
  // 코드에 일수·연수 숫자를 두지 않는다
  assert.doesNotMatch(sources.lib + sources.page + sources.route, /\b(3|7|10)\s*(년|일)\b/)
})

test('최종 확인 문구는 "회원 탈퇴를 최종 확인합니다"(DB)이고 "모든 약관에 동의합니다"는 새 화면에 없다(14절 12번)', () => {
  assert.equal(seedPolicy.texts.confirmLabel, '회원 탈퇴를 최종 확인합니다')
  assert.doesNotMatch(sources.view, /모든 약관에 동의/)
  assert.match(sources.view, /\{ key: 'final', label: texts\.confirmLabel \}/)
  // 고지 원문 마지막 줄(최종 확인 문구)은 목록이 아니라 마지막 체크 항목이다.
  const split = lib.splitWithdrawalNotice('제목\n가\n나\n회원 탈퇴를 최종 확인합니다', '회원 탈퇴를 최종 확인합니다')
  assert.deepEqual(split, { title: '제목', lines: ['가', '나'] })
})

// ---------------------------------------------------------------------------------------------------------------
// 2. 막힘 사유·오류 코드 → 한국어 안내
// ---------------------------------------------------------------------------------------------------------------
test('막힘 문구: 꺼짐이면 그 한 줄만, 환불 기간은 가능 예정일·휴일 여유 안내·크레딧 화면 링크, 대표 확인 사유는 review', () => {
  const preview = {
    quietUntil: '2026-12-01T03:00:00.000Z',
    refundPeriodOpen: [
      { blockedUntil: '2026-12-02T15:00:00.000Z', inBuffer: false },
      { blockedUntil: '2026-12-05T15:00:00.000Z', inBuffer: true },
    ],
  }
  const disabled = lib.withdrawalBlockMessages(['DISABLED', 'IN_PROGRESS', 'PAYER'], preview, policy)
  assert.deepEqual(disabled, { lines: [seedPolicy.texts.blockReasons.DISABLED], review: false, refundLink: false })

  const refund = lib.withdrawalBlockMessages(['NOT_PAYER', 'REFUND_PERIOD_OPEN'], preview, policy)
  assert.equal(refund.lines.length, 2)
  assert.match(refund.lines[0], /2026\.12\.06 00:00부터/)
  assert.equal(refund.lines[1], seedPolicy.texts.blockReasons.REFUND_PERIOD_BUFFER)
  assert.equal(refund.refundLink, true)

  for (const reason of lib.WITHDRAWAL_REVIEW_REASONS) {
    assert.equal(lib.withdrawalBlockMessages([reason], preview, policy).review, true, reason)
  }
  assert.deepEqual([...lib.WITHDRAWAL_REVIEW_REASONS], ['IN_PROGRESS', 'PROVIDER_UNVERIFIED', 'REDACTION_REQUIRED', 'CASH_VALUE_UNKNOWN'])
  assert.equal(lib.withdrawalBlockMessages(['RECENT_PAYMENT_ACTIVITY'], preview, policy).review, false)
})

test('원 환산을 모르는 유료 크레딧(CASH_VALUE_UNKNOWN): 다른 막힘처럼 DB 문구를 쓰고 [담당자 확인 요청하기] 대상이다', () => {
  const preview = { quietUntil: null, refundPeriodOpen: [] }
  const withText = { ...policy, texts: { ...policy.texts, blockReasons: { ...policy.texts.blockReasons, CASH_VALUE_UNKNOWN: 'DB 막힘 문구' } } }
  assert.deepEqual(lib.withdrawalBlockMessages(['PAYER', 'CASH_VALUE_UNKNOWN'], preview, withText), { lines: ['DB 막힘 문구'], review: true, refundLink: false })
  // DB 문구가 없으면 코드의 대신 문구
  const { CASH_VALUE_UNKNOWN: _drop, ...withoutReason } = policy.texts.blockReasons
  const withoutText = { ...policy, texts: { ...policy.texts, blockReasons: withoutReason } }
  assert.deepEqual(lib.withdrawalBlockMessages(['CASH_VALUE_UNKNOWN'], preview, withoutText).lines,
    [lib.MEMBER_WITHDRAWAL_ERRORS.MEMBER_WITHDRAW_CASH_VALUE_UNKNOWN.message])
  // 대표 화면 사유 이름표
  assert.match(sources.adminPanel, /CASH_VALUE_UNKNOWN: '/)
})

test('요청 뒤 새로 생긴 크레딧(MEMBER_WITHDRAW_NEW_CHARGE — 무상 지급 포함)은 409 와 요청 취소·재요청 안내', () => {
  const view = lib.describeMemberWithdrawalError({ code: 'P0001', message: 'MEMBER_WITHDRAW_NEW_CHARGE', details: '{"sourceIds":[]}' }, policy)
  assert.equal(view.status, 409)
  assert.equal(view.code, 'MEMBER_WITHDRAW_NEW_CHARGE')
  assert.equal(view.message, '요청한 뒤 새로 생긴 크레딧이 있습니다. 요청을 취소하고 회원에게 다시 요청받아야 합니다.')
})

test('완료 문구: 결제 회원은 completionKept, 비결제는 completionKeptNonPayer + 결제 시도 기록·보존 문의가 있을 때만 덧붙인다', () => {
  const t = seedPolicy.texts
  assert.deepEqual(lib.withdrawalCompletionKept(policy, { hadPayment: true, ticketsRetained: true, counts: { ticketsKept: 2, attemptFingerprints: 1 } }), [t.completionKept])
  assert.deepEqual(lib.withdrawalCompletionKept(policy, { hadPayment: false, ticketsRetained: false, counts: {} }), [t.completionKeptNonPayer])
  assert.deepEqual(lib.withdrawalCompletionKept(policy, { hadPayment: false, ticketsRetained: false, counts: { orderFingerprints: 1 } }),
    [t.completionKeptNonPayer, t.completionKeptAttemptOnly])
  // 보존 문의: 연수 자리표시는 코드가 채운다. 보존했어도 남은 문의가 0이면 줄을 넣지 않는다.
  const tickets = lib.withdrawalCompletionKept(policy, { hadPayment: false, ticketsRetained: true, counts: { attemptFingerprints: 2, ticketsKept: 1, reviewAlertsResolved: 1 } })
  assert.deepEqual(tickets, [t.completionKeptNonPayer, t.completionKeptAttemptOnly, t.completionKeptTickets.replace('{비결제문의보존기간}', '3')])
  assert.equal(lib.withdrawalCompletionKept(policy, { hadPayment: false, ticketsRetained: true, counts: { ticketsKept: 0 } }).length, 1)
  // 보존 연수를 읽지 못하면 자리표시가 남는 줄은 뺀다
  assert.deepEqual(lib.withdrawalCompletionKept({ ...policy, nonPayerTicketRetentionYears: null }, { hadPayment: false, ticketsRetained: true, counts: { ticketsKept: 1 } }),
    [t.completionKeptNonPayer])
  // route 가 결과로 골라 보내고, 화면은 그 줄을 그린다(화면 문구 목록의 completionKept 는 없앴다)
  assert.match(sources.route, /kept: withdrawalCompletionKept\(policy, result\.data\),/)
  assert.match(sources.view, /done\.kind === 'anonymized' && done\.kept\.map\(\(line\) => <li key=\{line\}>\{line\}<\/li>\)/)
  assert.doesNotMatch(sources.page + sources.view, /completionKept\b/)
})

test('route: 스스로 익명화 응답에 완료 문구 줄(kept)이 있다', async () => {
  const preview = previewOf({ hasOrdersOrAttempts: true, selfAllowed: true })
  const { route } = loadWithdrawRoute({ preview })
  const body = await (await route.DELETE(del({ confirmEmail: 'm@example.com', noticeSha256: SHA, expectedBalance: 0 }))).json()
  // 가짜 익명화 결과: 비결제·문의 보존·counts 없음
  assert.deepEqual(body.kept, [seedPolicy.texts.completionKeptNonPayer])
})

test('화면 요청 거절 MEMBER_WITHDRAW_REQUEST_INVALID 의 DETAIL reason(CASH_VALUE_UNKNOWN)은 그 막힘 문구로', () => {
  const view = lib.describeMemberWithdrawalError({ code: 'P0001', message: 'MEMBER_WITHDRAW_REQUEST_INVALID', details: '{"reason":"CASH_VALUE_UNKNOWN"}' }, policy)
  assert.equal(view.status, 409)
  assert.equal(view.message, seedPolicy.texts.blockReasons.CASH_VALUE_UNKNOWN)
  // DETAIL 이 없거나 모르는 사유면 원래 안내
  assert.equal(lib.describeMemberWithdrawalError({ message: 'MEMBER_WITHDRAW_REQUEST_INVALID' }, policy).message,
    lib.MEMBER_WITHDRAWAL_ERRORS.MEMBER_WITHDRAW_REQUEST_INVALID.message)
  assert.equal(lib.describeMemberWithdrawalError({ message: 'MEMBER_WITHDRAW_REQUEST_INVALID', details: '{"reason":"UNKNOWN_X"}' }, policy).message,
    lib.MEMBER_WITHDRAWAL_ERRORS.MEMBER_WITHDRAW_REQUEST_INVALID.message)
})

test('대표 이메일·전화 요청: CASH_VALUE_UNKNOWN·DISABLED 는 막힘으로 보지 않는다(화면 요청만 막음)', () => {
  assert.deepEqual(lib.ownerChannelRequestReasons(['PAYER', 'DISABLED', 'CASH_VALUE_UNKNOWN']), ['PAYER'])
  assert.deepEqual(lib.ownerChannelRequestReasons(['CASH_VALUE_UNKNOWN', 'IN_PROGRESS', 'REQUEST_PENDING']), ['IN_PROGRESS', 'REQUEST_PENDING'])
  assert.match(sources.adminPanel, /const ownerReasons = ownerChannelRequestReasons\(preview\.requestReasons\)/)
  assert.match(sources.adminPanel, /\['이메일·전화 요청\(결제 회원\)', ownerReasons\.length === 0 \? '가능' : reasonList\(ownerReasons\)\]/)
})

test('탈퇴 요청 알림: 관리자 알림(admin_events)에 대표 전용·회원 상세 링크만, 개인정보 없음, 요청당 한 건', async () => {
  const admin = fakeAdmin()
  const { server, restore } = loadServer(admin)
  await server.notifyOwnerWithdrawalRequest(USER_ID, 'req-1')
  restore()
  assert.equal(admin.calls.inserts.length, 1)
  const [table, row] = admin.calls.inserts[0]
  assert.equal(table, 'admin_events')
  assert.equal(row.required_permission, 'owner')
  assert.equal(row.link, `/admin/users/${USER_ID}`)
  assert.equal(row.ref_table, 'member_withdrawal_requests')
  assert.equal(row.ref_id, 'req-1')
  assert.equal(row.dedupe_key, 'member_withdrawal_request:req-1')
  assert.doesNotMatch(`${row.title} ${row.body}`, /@|m@example\.com|010|00000000-/)
  // 'owner' 이벤트는 대표만 본다(조회 정책)
  assert.match(read('supabase/migrations/20261117140000_admin_rls_by_permission.sql'), /OR \(required_permission <> 'owner' AND public\.has_admin_permission\(required_permission\)\)/)

  // 같은 요청으로 이미 알렸거나(23505) 기록이 실패해도 던지지 않는다
  const failing = fakeAdmin({ tables: { 'admin_events:insert': { error: { code: '23505' } } } })
  const loaded = loadServer(failing)
  await loaded.server.notifyOwnerWithdrawalRequest(USER_ID, 'req-1')
  loaded.restore()
})

test('DB 맞물림(1회차 수정): 막힘 문구 CASH_VALUE_UNKNOWN·상태 함수 withdrawn_member_account_status·오류 MEMBER_WITHDRAW_NEW_CHARGE 가 마이그레이션에 있다', () => {
  assert.ok(lib.withdrawalText(policy, 'blockReasons.CASH_VALUE_UNKNOWN'), 'texts.blockReasons.CASH_VALUE_UNKNOWN')
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.withdrawn_member_account_status\(p_user_id uuid\)/)
  assert.match(migration, /'MEMBER_WITHDRAW_NEW_CHARGE'/)
  assert.match(sources.types, /\n      withdrawn_member_account_status: \{\n        Args: \{\n          p_user_id: string\n        \}\n        Returns: Json/)
})

test('마이그레이션이 RAISE 하는 새 오류 코드는 모두 한국어 안내가 있다', () => {
  const codes = new Set()
  for (const match of migration.matchAll(/(?:RAISE EXCEPTION '|MESSAGE = ')([A-Z][A-Z0-9_]+)'/g)) codes.add(match[1])
  const bundle10 = [...codes].filter((code) => /^(MEMBER_|WITHDRAWN_MEMBER_|PAYMENT_REVIEW_MEMBER_WITHDRAWN$|PAYMENT_ORDER_NOT_FOUND$)/.test(code))
  assert.ok(bundle10.length >= 25, `코드 ${bundle10.length}개`)
  for (const code of bundle10) {
    assert.ok(lib.MEMBER_WITHDRAWAL_ERRORS[code], `${code} 안내가 없다`)
    assert.match(lib.MEMBER_WITHDRAWAL_ERRORS[code].message, /[가-힣]/, code)
  }
})

test('오류 코드 찾기: MEMBER_WITHDRAW_* 와 MEMBER_WITHDRAWN·MEMBER_ALREADY_WITHDRAWN 이 섞이지 않는다', () => {
  assert.equal(lib.memberWithdrawalErrorCode('MEMBER_WITHDRAWN'), 'MEMBER_WITHDRAWN')
  assert.equal(lib.memberWithdrawalErrorCode('MEMBER_ALREADY_WITHDRAWN'), 'MEMBER_ALREADY_WITHDRAWN')
  assert.equal(lib.memberWithdrawalErrorCode('MEMBER_WITHDRAW_ADMIN'), 'MEMBER_WITHDRAW_ADMIN')
  assert.equal(lib.memberWithdrawalErrorCode('ERROR: MEMBER_NOT_WITHDRAWN (P0001)'), 'MEMBER_NOT_WITHDRAWN')
  assert.equal(lib.memberWithdrawalErrorCode('something else'), null)
})

test('오류 안내: 스스로 탈퇴 거절의 DETAIL 사유는 DB 막힘 문구로, 환불 기간은 가능 예정일을 채운다, 재시도 오류는 503', () => {
  const recent = lib.describeMemberWithdrawalError({
    message: 'MEMBER_WITHDRAW_SELF_NOT_ALLOWED',
    details: JSON.stringify({ reason: 'RECENT_PAYMENT_ACTIVITY', quietUntil: '2026-12-01T03:00:00.000Z' }),
  }, policy)
  assert.equal(recent.status, 409)
  assert.equal(recent.message, '최근 결제 시도가 있어 7일이 지난 뒤(2026.12.01 12:00부터) 탈퇴할 수 있습니다.')
  const disabled = lib.describeMemberWithdrawalError({ message: 'MEMBER_WITHDRAW_SELF_NOT_ALLOWED', details: '{"reason":"DISABLED"}' }, policy)
  assert.equal(disabled.message, seedPolicy.texts.blockReasons.DISABLED)
  const refund = lib.describeMemberWithdrawalError({
    message: 'MEMBER_WITHDRAW_REFUND_PERIOD_OPEN',
    details: JSON.stringify([{ blockedUntil: '2026-12-05T15:00:00.000Z', inBuffer: true }]),
  }, policy)
  assert.match(refund.message, /2026\.12\.06 00:00부터/)
  // 정책을 읽지 못해도 코드 안내로 대신한다
  assert.equal(lib.describeMemberWithdrawalError({ message: 'MEMBER_WITHDRAW_BALANCE_CHANGED' }, null).message,
    lib.MEMBER_WITHDRAWAL_ERRORS.MEMBER_WITHDRAW_BALANCE_CHANGED.message)
  assert.equal(lib.describeMemberWithdrawalError({ code: '40P01', message: 'deadlock detected' }, policy).status, 503)
  assert.equal(lib.describeMemberWithdrawalError({ code: 'XX000', message: 'boom' }, policy).status, 500)
})

test('재시도 대상은 40001(MEMBER_WITHDRAW_STATE_CHANGED)·40P01 이고 최대 2회', () => {
  assert.deepEqual([...lib.WITHDRAWAL_RETRY_SQLSTATES], ['40001', '40P01'])
  assert.equal(lib.WITHDRAWAL_MAX_RETRIES, 2)
  assert.equal(lib.isWithdrawalRetryable({ code: '40001' }), true)
  assert.equal(lib.isWithdrawalRetryable({ code: '40P01' }), true)
  assert.equal(lib.isWithdrawalRetryable({ code: 'P0001' }), false)
  assert.match(migration, /ERRCODE = '40001', MESSAGE = 'MEMBER_WITHDRAW_STATE_CHANGED'/)
})

test('대표 확인 경보 MEMBER_WITHDRAW_REVIEW_NEEDED 의 details 에 user_id 키가 없다(진행 중 경보로 잡혀 탈퇴가 막히지 않게)', () => {
  const details = lib.withdrawalReviewAlertDetails(USER_ID)
  assert.deepEqual(details, { dedupe_key: `member_withdraw_review:${USER_ID}` })
  assert.ok(!('user_id' in details))
  // 판정 함수는 details->>'user_id' 로 회원 경보를 진행 중으로 센다.
  assert.match(migration, /OR \(a\.details ->> 'user_id'\) = p_user_id::text\);/)
  assert.match(sources.server, /'MEMBER_WITHDRAW_REVIEW_NEEDED',[\s\S]{0,200}withdrawalReviewAlertDetails\(userId\)/)
})

// ---------------------------------------------------------------------------------------------------------------
// 3. 서버 모듈: 다시 시도·로그인 계정 정리·완전 삭제
// ---------------------------------------------------------------------------------------------------------------
function fakeAdmin({ rpc = {}, deleteUser = async () => ({ error: null }), tables = {} } = {}) {
  // seq: rpc·삭제·deleteUser 를 부른 순서
  const calls = { rpc: [], deleteUser: [], deletes: [], from: [], seq: [], inserts: [] }
  const client = {
    rpc: async (name, args) => {
      calls.rpc.push([name, args])
      calls.seq.push(`rpc:${name}`)
      const handler = rpc[name]
      return handler ? handler(args, calls) : { data: {}, error: null }
    },
    auth: { admin: { deleteUser: async (...args) => { calls.deleteUser.push(args); calls.seq.push('deleteUser'); return deleteUser(...args, calls) } } },
    from: (table) => {
      calls.from.push(table)
      const query = {
        delete: () => ({ eq: async (column, value) => { calls.deletes.push([table, column, value]); calls.seq.push(`delete:${table}`); return { error: null } } }),
        insert: async (row) => { calls.inserts.push([table, row]); return tables[`${table}:insert`] ?? { error: null } },
        select: () => query,
        eq: () => query,
        is: () => query,
        in: () => query,
        not: () => query,
        limit: async () => tables[table] ?? { data: [], error: null },
        maybeSingle: async () => (typeof tables[table] === 'function' ? tables[table](calls) : tables[table]) ?? { data: null, error: null },
      }
      return query
    },
  }
  return { client, calls }
}

function loadServer(admin, env = {}) {
  const saved = { ...process.env }
  Object.assign(process.env, env)
  if (!('KAKAO_ADMIN_KEY' in env)) delete process.env.KAKAO_ADMIN_KEY
  const server = load('src/lib/member-withdrawal-server.ts', {
    'server-only': {},
    '@/lib/supabase/bypass': { createAdminClient: () => admin.client },
    '@/lib/member-withdrawal': lib,
  })
  return { server, restore: () => { process.env = saved } }
}

test('익명화는 40P01·40001 이면 같은 키로 2회까지 다시 시도하고, 다른 오류는 바로 돌려준다', async () => {
  let failures = 2
  const retrying = fakeAdmin({ rpc: { anonymize_member: () => (failures-- > 0 ? { data: null, error: { code: failures ? '40P01' : '40001', message: 'x' } } : { data: { withdrawn: true }, error: null }) } })
  const { server } = loadServer(retrying)
  const ok = await server.anonymizeMember({ actorId: USER_ID, userId: USER_ID, method: 'self', expectedBalance: 0, noticeText: 't', operationKey: 'k1', ticketRetentionAgreed: true })
  assert.equal(ok.ok, true)
  const keys = retrying.calls.rpc.map(([, args]) => args.p_operation_key)
  assert.deepEqual(keys, ['k1', 'k1', 'k1'])
  assert.equal(retrying.calls.rpc[0][1].p_request_id, null)
  assert.equal(retrying.calls.rpc[0][1].p_ticket_retention_agreed, true)
  assert.equal(retrying.calls.rpc[0][1].p_pending_tickets_confirmed, false)

  const exhausted = fakeAdmin({ rpc: { anonymize_member: () => ({ data: null, error: { code: '40P01', message: 'deadlock' } }) } })
  const result = await loadServer(exhausted).server.anonymizeMember({ actorId: USER_ID, userId: USER_ID, method: 'self', operationKey: 'k2' })
  assert.equal(result.ok, false)
  assert.equal(exhausted.calls.rpc.length, 3)

  const rejected = fakeAdmin({ rpc: { anonymize_member: () => ({ data: null, error: { code: 'P0001', message: 'MEMBER_WITHDRAW_IN_PROGRESS', details: '{}' } }) } })
  const refused = await loadServer(rejected).server.anonymizeMember({ actorId: USER_ID, userId: USER_ID, method: 'self', operationKey: 'k3' })
  assert.deepEqual(refused, { ok: false, error: { code: 'P0001', message: 'MEMBER_WITHDRAW_IN_PROGRESS', details: '{}' } })
  assert.equal(rejected.calls.rpc.length, 1)
})

const WITHDRAWN_AT = '2026-11-26T01:00:00.000Z'
const accountStatus = (overrides = {}) => () => ({
  data: { withdrawnAt: WITHDRAWN_AT, authScrubbedAt: null, kakaoUnlinkPending: false, ...overrides },
  error: null,
})

test('로그인 계정 정리: 탈퇴 확인 → deleteUser(id, true) → 정리 기록, 카카오는 남았을 때만(키 없으면 대기 경보, 새 연결이 있으면 칸만 비움)', async () => {
  const noKakao = fakeAdmin({ rpc: { withdrawn_member_account_status: accountStatus() } })
  let loaded = loadServer(noKakao)
  assert.deepEqual(await loaded.server.cleanupWithdrawnMemberAccount(USER_ID), { ok: true, data: { authScrubbed: true, kakao: 'none' } })
  loaded.restore()
  assert.deepEqual(noKakao.calls.deleteUser, [[USER_ID, true]])
  // 탈퇴 확인이 소프트 삭제보다 먼저다
  assert.deepEqual(noKakao.calls.seq, ['rpc:withdrawn_member_account_status', 'deleteUser', 'rpc:mark_withdrawn_member_auth_scrubbed'])

  // 키가 없으면 카카오 API 를 부르지 않고 대기(경보만 — 회원번호는 경보에 넣지 않음)
  const pending = fakeAdmin({ rpc: {
    withdrawn_member_account_status: accountStatus({ kakaoUnlinkPending: true }),
    withdrawn_member_kakao_unlink_target: () => ({ data: { kakaoId: '12345', newIdentityExists: false }, error: null }),
  } })
  loaded = loadServer(pending)
  assert.deepEqual(await loaded.server.cleanupWithdrawnMemberAccount(USER_ID), { ok: true, data: { authScrubbed: true, kakao: 'pending' } })
  loaded.restore()
  const alert = pending.calls.rpc.find(([name, args]) => name === 'record_payment_alert' && args.p_code === 'MEMBER_KAKAO_UNLINK_PENDING')
  assert.ok(alert)
  assert.equal(alert[1].p_details.dedupe_key, `member_kakao_unlink:${USER_ID}`)
  assert.doesNotMatch(JSON.stringify(alert[1].p_details), /12345/)
  assert.ok(!pending.calls.rpc.some(([name]) => name === 'clear_withdrawn_member_kakao_unlink'))

  // 그 회원번호로 새 계정이 연결됐으면 끊지 않고 칸만 비운다
  const relinked = fakeAdmin({ rpc: {
    withdrawn_member_account_status: accountStatus({ kakaoUnlinkPending: true }),
    withdrawn_member_kakao_unlink_target: () => ({ data: { kakaoId: '12345', newIdentityExists: true }, error: null }),
    // 새 반환 키 alertsResolved 는 있어도 된다
    clear_withdrawn_member_kakao_unlink: () => ({ data: { cleared: true, outcome: 'new_identity_exists', alertsResolved: 1 }, error: null }),
  } })
  loaded = loadServer(relinked)
  assert.deepEqual(await loaded.server.cleanupWithdrawnMemberAccount(USER_ID), { ok: true, data: { authScrubbed: true, kakao: 'unlinked' } })
  loaded.restore()
  assert.deepEqual(relinked.calls.rpc.find(([name]) => name === 'clear_withdrawn_member_kakao_unlink')[1], { p_user_id: USER_ID, p_outcome: 'new_identity_exists' })

  // 소프트 삭제 실패: 정리 기록 없이 경보(user_id·dedupe_key)
  const failing = fakeAdmin({ deleteUser: async () => ({ error: { status: 500 } }), rpc: { withdrawn_member_account_status: accountStatus() } })
  loaded = loadServer(failing)
  assert.deepEqual(await loaded.server.cleanupWithdrawnMemberAccount(USER_ID), { ok: true, data: { authScrubbed: false, kakao: 'none' } })
  loaded.restore()
  assert.ok(!failing.calls.rpc.some(([name]) => name === 'mark_withdrawn_member_auth_scrubbed'))
  const scrubAlert = failing.calls.rpc.find(([name, args]) => name === 'record_payment_alert' && args.p_code === 'MEMBER_AUTH_SCRUB_PENDING')
  assert.equal(scrubAlert[1].p_details.dedupe_key, `member_auth_scrub:${USER_ID}`)
  // DB 가 이 dedupe_key 로 경보를 해소한다
  assert.match(migration, /AND code = 'MEMBER_AUTH_SCRUB_PENDING'\n\s*AND \(details ->> 'dedupe_key'\) = 'member_auth_scrub:' \|\| p_user_id;/)
  assert.match(sources.server, /process\.env\.KAKAO_ADMIN_KEY/)
  assert.match(sources.server, /Authorization: `KakaoAK \$\{adminKey\}`/)
})

test('로그인 계정 정리: 탈퇴하지 않은 회원(또는 확인 실패)이면 deleteUser 를 0번 부르고 MEMBER_NOT_WITHDRAWN', async () => {
  const active = fakeAdmin({ rpc: { withdrawn_member_account_status: () => ({ data: { withdrawnAt: null, authScrubbedAt: null, kakaoUnlinkPending: false }, error: null }) } })
  let loaded = loadServer(active)
  const refused = await loaded.server.cleanupWithdrawnMemberAccount(USER_ID)
  loaded.restore()
  assert.equal(refused.ok, false)
  assert.equal(refused.error.message, 'MEMBER_NOT_WITHDRAWN')
  assert.equal(active.calls.deleteUser.length, 0)
  assert.deepEqual(active.calls.seq, ['rpc:withdrawn_member_account_status'])
  assert.equal(lib.describeMemberWithdrawalError(refused.error, policy).status, 409)

  const unreadable = fakeAdmin({ rpc: { withdrawn_member_account_status: () => ({ data: null, error: { code: 'PGRST202', message: 'not found' } }) } })
  loaded = loadServer(unreadable)
  assert.equal((await loaded.server.cleanupWithdrawnMemberAccount(USER_ID)).ok, false)
  loaded.restore()
  assert.equal(unreadable.calls.deleteUser.length, 0)

  // 이미 정리된 계정은 소프트 삭제를 다시 부르지 않고 남은 카카오만 한다
  const scrubbed = fakeAdmin({ rpc: {
    withdrawn_member_account_status: accountStatus({ authScrubbedAt: WITHDRAWN_AT, kakaoUnlinkPending: true }),
    withdrawn_member_kakao_unlink_target: () => ({ data: { kakaoId: '12345', newIdentityExists: true }, error: null }),
  } })
  loaded = loadServer(scrubbed)
  assert.deepEqual(await loaded.server.cleanupWithdrawnMemberAccount(USER_ID), { ok: true, data: { authScrubbed: true, kakao: 'unlinked' } })
  loaded.restore()
  assert.equal(scrubbed.calls.deleteUser.length, 0)
})

test('회원 상세 [다시 시도] 표시: 경보가 아니라 보관함 정리 시각으로 본다(익명화 뒤 정리 전에 멈춰도 authPending)', async () => {
  // 익명화 성공 + cleanup 미실행(경보 없음): 정리 시각이 없으므로 다시 시도 대상
  const notRun = fakeAdmin({ rpc: { withdrawn_member_account_status: accountStatus() } })
  let loaded = loadServer(notRun)
  assert.deepEqual(await loaded.server.readWithdrawnMemberAccountStatus(USER_ID), { authPending: true, kakaoPending: false })
  loaded.restore()
  assert.ok(!notRun.calls.from.includes('payment_reconciliation_alerts'), '경보 표를 보지 않는다')

  const done = fakeAdmin({ rpc: { withdrawn_member_account_status: accountStatus({ authScrubbedAt: WITHDRAWN_AT, kakaoUnlinkPending: true }) } })
  loaded = loadServer(done)
  assert.deepEqual(await loaded.server.readWithdrawnMemberAccountStatus(USER_ID), { authPending: false, kakaoPending: true })
  loaded.restore()

  const broken = fakeAdmin({ rpc: { withdrawn_member_account_status: () => ({ data: null, error: { code: 'XX000' } }) } })
  loaded = loadServer(broken)
  assert.equal(await loaded.server.readWithdrawnMemberAccountStatus(USER_ID), null)
  loaded.restore()
})

test('완전 삭제: 관리자 이벤트 문의 사본을 먼저 정리하고, 생성 기록을 지운 뒤 프로필·auth 계정을 지운다', async () => {
  const admin = fakeAdmin()
  const { server, restore } = loadServer(admin)
  await server.fullDeleteMember(USER_ID, { provider: 'email', kakaoId: null })
  restore()
  // 로그인 계정을 지운 뒤 남았을 수 있는 완전 삭제 경보를 푼다(DB 가 프로필·로그인 계정이 모두 없을 때만 푼다)
  assert.deepEqual(admin.calls.rpc.map(([name]) => name), ['scrub_member_admin_events', 'resolve_member_full_delete_auth_alert'])
  assert.deepEqual(admin.calls.rpc[1][1], { p_user_id: USER_ID })
  assert.deepEqual(admin.calls.deletes.map(([table]) => table), [
    'exam_papers', 'questions', 'support_tickets', 'credit_transactions', 'ai_question_generation_runs', 'profiles',
  ])
  // 완전 삭제는 소프트 삭제가 아니다
  assert.deepEqual(admin.calls.deleteUser, [[USER_ID]])
})

test('완전 삭제의 카카오 연결 끊기는 프로필 삭제 뒤·로그인 계정 삭제 전이고, 실패해도 탈퇴를 막지 않고 회원번호 없는 경보만 남긴다', async () => {
  const admin = fakeAdmin()
  const { server, restore } = loadServer(admin)
  await server.fullDeleteMember(USER_ID, { provider: 'kakao', kakaoId: '98765' })
  restore()
  const alert = admin.calls.rpc.find(([name]) => name === 'record_payment_alert')
  assert.equal(alert[1].p_code, 'MEMBER_KAKAO_UNLINK_FAILED')
  assert.doesNotMatch(JSON.stringify(alert[1].p_details), /98765/)
  const at = (step) => admin.calls.seq.indexOf(step)
  assert.ok(at('delete:profiles') >= 0 && at('delete:profiles') < at('rpc:record_payment_alert'), '카카오는 프로필 삭제 뒤')
  assert.ok(at('rpc:record_payment_alert') < at('deleteUser'), '카카오는 로그인 계정 삭제 전')
})

test('완전 삭제: 프로필 삭제 뒤 로그인 계정 삭제가 실패하면 경보(dedupe_key 만)를 남기고 실패로 끝난다', async () => {
  const admin = fakeAdmin({ deleteUser: async () => ({ error: { status: 503 } }) })
  const { server, restore } = loadServer(admin)
  await assert.rejects(() => server.fullDeleteMember(USER_ID, { provider: 'email', kakaoId: null }))
  restore()
  const alert = admin.calls.rpc.find(([name, args]) => name === 'record_payment_alert' && args.p_code === 'MEMBER_FULL_DELETE_AUTH_PENDING')
  assert.ok(alert)
  const { attempted_at: _at, ...details } = alert[1].p_details
  assert.deepEqual(details, { dedupe_key: `member_full_delete_auth:${USER_ID}` })
})

// ---------------------------------------------------------------------------------------------------------------
// 4. 회원 탈퇴 route(/api/auth/withdraw)
// ---------------------------------------------------------------------------------------------------------------
function previewOf(overrides = {}) {
  return {
    userId: USER_ID, isAdmin: false, withdrawnAt: null, hadPayment: false, hasOrdersOrAttempts: false,
    openRequest: null, ticketCount: 0, pendingTicketCount: 0, refundPeriodOpen: [], quietUntil: null,
    fullDeleteAllowed: false, fullDeleteIfTicketsDeleted: false,
    selfAllowed: false, selfReasons: [], selfAllowedIfTicketsDeleted: false, selfReasonsIfTicketsDeleted: [],
    requestAllowed: false, requestReasons: [],
    ...overrides,
  }
}

function loadWithdrawRoute({
  isAdmin = false,
  preview = previewOf(),
  previewResult = null,
  profile = undefined,
  notice = { text: '고지', sha256: SHA, expectedBalance: 0, expectedForfeitPaid: 0, expectedForfeitFree: 0 },
  server: serverOverride = null,
} = {}) {
  const calls = []
  const record = (name, value) => (...args) => { calls.push([name, ...args]); return typeof value === 'function' ? value(...args) : value }
  const server = serverOverride ?? {
    readMemberWithdrawalPolicy: record('policy', policy),
    readMemberWithdrawalPreview: record('preview', previewResult ?? { ok: true, data: preview }),
    readMemberWithdrawalNotice: record('notice', { ok: true, data: notice }),
    createMemberWithdrawalRequest: record('createRequest', { ok: true, data: { requestId: 'r1', marketing: null } }),
    cancelMemberWithdrawalRequest: record('cancelRequest', { ok: true, data: { marketingWithdrawnAt: null } }),
    anonymizeMember: record('anonymize', { ok: true, data: { ticketsRetained: true, marketing: null } }),
    cleanupWithdrawnMemberAccount: record('cleanup', { authScrubbed: true, kakao: 'none' }),
    fullDeleteMember: record('fullDelete', undefined),
    deleteFullDeletedAuthUser: record('finishAuthDelete', undefined),
    notifyOwnerWithdrawalRequest: record('notifyOwner', undefined),
    recordWithdrawalReviewNeeded: record('review', undefined),
  }
  // profile: 값(프로필 하나) 또는 함수(부를 때마다 다른 값)
  const profileValue = () => {
    const value = typeof profile === 'function' ? profile() : profile
    return value === undefined ? { is_admin: isAdmin, provider: 'email', kakao_id: null } : value
  }
  const profileQuery = { select: () => profileQuery, eq: () => profileQuery, maybeSingle: async () => ({ data: profileValue(), error: null }) }
  const route = load('src/app/api/auth/withdraw/route.ts', {
    'next/server': { NextResponse },
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: USER_ID, email: 'm@example.com' } } }) },
        from: () => profileQuery,
      }),
    },
    '@/lib/member-withdrawal-server': server,
    '@/lib/member-withdrawal': lib,
    '@/lib/signup-consent-server': { getConsentSenderName: async () => '문제마켓 운영자' },
  })
  return { route, calls }
}

const del = (body) => new Request('http://localhost/api/auth/withdraw', { method: 'DELETE', body: JSON.stringify(body) })
const post = (body) => new Request('http://localhost/api/auth/withdraw', { method: 'POST', body: JSON.stringify(body) })
const names = (calls) => calls.map(([name]) => name)

test('route: 이메일이 다르면 400, 관리자는 미리보기 전에 403', async () => {
  let { route, calls } = loadWithdrawRoute()
  assert.equal((await route.DELETE(del({ confirmEmail: 'x@example.com' }))).status, 400)
  ;({ route, calls } = loadWithdrawRoute({ isAdmin: true }))
  const response = await route.DELETE(del({ confirmEmail: 'm@example.com' }))
  assert.equal(response.status, 403)
  assert.equal((await response.json()).error, seedPolicy.texts.blockReasons.ADMIN)
  assert.ok(!names(calls).includes('preview'))
})

test('route: 결제·결제 시도·요청·문의가 없으면 완전 삭제(지문 없이도 — 옛 화면 호환), 익명화는 부르지 않는다', async () => {
  const { route, calls } = loadWithdrawRoute({ preview: previewOf({ fullDeleteAllowed: true, selfReasons: ['DISABLED'] }) })
  const response = await route.DELETE(del({ confirmEmail: 'm@example.com' }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).kind, 'deleted')
  assert.deepEqual(names(calls), ['policy', 'preview', 'fullDelete'])
  assert.equal((await loadWithdrawRoute({ preview: previewOf({ fullDeleteAllowed: true }) }).route.DELETE(del({ confirmEmail: 'm@example.com' })).then((r) => r.json())).marketing, null)
})

test('route: 완전 삭제 + 마케팅 동의 회원이면 응답에 철회 결과(보낸 곳·처리 일시·DB 문구)가 있다', async () => {
  const { route } = loadWithdrawRoute({ preview: previewOf({ fullDeleteAllowed: true, marketingAgreed: true }) })
  const before = Date.now()
  const body = await (await route.DELETE(del({ confirmEmail: 'm@example.com' }))).json()
  assert.equal(body.kind, 'deleted')
  assert.equal(body.marketing.sender, '문제마켓 운영자')
  assert.equal(body.marketing.result, seedPolicy.texts.marketingResult)
  assert.ok(new Date(body.marketing.withdrawnAt).getTime() >= before)
})

test('route: 프로필 삭제 뒤 로그인 계정 삭제가 실패했으면, 다시 불렀을 때 로그인 계정 삭제(deleteUser)를 다시 부른다', async () => {
  // 실제 서버 모듈 + 가짜 DB: 처음에는 완전 삭제 대상, 프로필을 지운 뒤에는 미리보기가 '회원 없음'
  const fullPreview = {
    exists: true, userId: USER_ID, isAdmin: false, withdrawnAt: null, hadPayment: false, hasOrdersOrAttempts: false,
    openRequest: null, ticketCount: 0, pendingTicketCount: 0, refundPeriodOpen: [], redactionRequired: [], quietUntil: null,
    fullDeleteAllowed: true, fullDeleteIfTicketsDeleted: true, selfAllowed: false, selfReasons: [], selfAllowedIfTicketsDeleted: false,
    selfReasonsIfTicketsDeleted: [], requestAllowed: false, requestReasons: [], marketingAgreed: false,
    balance: { forfeitTotal: 0, breakdown: [] },
  }
  let profileDeleted = false
  let failAuthDelete = true
  const admin = fakeAdmin({
    tables: { system_settings: { data: { value: seedPolicy }, error: null } },
    rpc: {
      get_member_withdrawal_preview: () => (profileDeleted
        ? { data: null, error: { code: 'P0001', message: 'MEMBER_WITHDRAW_USER_NOT_FOUND' } }
        : { data: fullPreview, error: null }),
    },
    deleteUser: async () => (failAuthDelete ? { error: { status: 500 } } : { error: null }),
  })
  const originalDelete = admin.client.from
  admin.client.from = (table) => {
    const query = originalDelete(table)
    if (table !== 'profiles') return query
    return { ...query, delete: () => ({ eq: async () => { profileDeleted = true; admin.calls.seq.push('delete:profiles'); return { error: null } } }) }
  }
  const { server, restore } = loadServer(admin)
  const { route } = loadWithdrawRoute({ server, profile: () => (profileDeleted ? null : { is_admin: false, provider: 'email', kakao_id: null }) })
  const first = await route.DELETE(del({ confirmEmail: 'm@example.com' }))
  assert.equal(first.status, 500)
  assert.equal(admin.calls.deleteUser.length, 1)
  assert.ok(admin.calls.rpc.some(([name, args]) => name === 'record_payment_alert' && args.p_code === 'MEMBER_FULL_DELETE_AUTH_PENDING'))

  failAuthDelete = false
  const second = await route.DELETE(del({ confirmEmail: 'm@example.com' }))
  restore()
  assert.equal(second.status, 200)
  assert.equal((await second.json()).kind, 'deleted')
  assert.deepEqual(admin.calls.deleteUser, [[USER_ID], [USER_ID]])

  // 프로필이 남아 있는데 미리보기가 '회원 없음'이면(이상 상태) 지우지 않는다
  const { route: guarded, calls } = loadWithdrawRoute({ previewResult: { ok: false, error: { message: 'MEMBER_WITHDRAW_USER_NOT_FOUND' } } })
  assert.equal((await guarded.DELETE(del({ confirmEmail: 'm@example.com' }))).status, 404)
  assert.ok(!names(calls).includes('finishAuthDelete'))
})

test('route: 문의가 있는 비결제 회원은 보존 선택이 필요하고, 동의하지 않으면 남는 기록이 없을 때 완전 삭제', async () => {
  let { route } = loadWithdrawRoute({ preview: previewOf({ ticketCount: 2 }) })
  assert.equal((await route.DELETE(del({ confirmEmail: 'm@example.com' }))).status, 400)
  let calls
  ;({ route, calls } = loadWithdrawRoute({ preview: previewOf({ ticketCount: 2, fullDeleteIfTicketsDeleted: true }) }))
  const response = await route.DELETE(del({ confirmEmail: 'm@example.com', ticketRetentionAgreed: false }))
  assert.equal((await response.json()).kind, 'deleted')
  assert.deepEqual(calls.find(([name]) => name === 'preview').slice(1), [USER_ID, false])
})

test('route: 스스로 익명화는 서버가 다시 만든 고지 원문의 지문이 같을 때만, 회원당 한 키로 부르고 로그인 계정을 정리한다', async () => {
  const preview = previewOf({ hasOrdersOrAttempts: true, selfAllowed: true })
  let { route, calls } = loadWithdrawRoute({ preview })
  const changed = await route.DELETE(del({ confirmEmail: 'm@example.com', noticeSha256: 'b'.repeat(64), expectedBalance: 0 }))
  assert.equal(changed.status, 409)
  assert.equal((await changed.json()).code, 'MEMBER_WITHDRAW_NOTICE_INVALID')
  assert.ok(!names(calls).includes('anonymize'))

  const notice = { text: '고지', sha256: SHA, expectedBalance: 500, expectedForfeitPaid: 0, expectedForfeitFree: 500 }
  // 화면이 보낸 소멸량이 서버 고지와 다르면 고지가 바뀐 것으로 본다(동의량을 화면 값으로 기록하지 않는다)
  ;({ route, calls } = loadWithdrawRoute({ preview, notice }))
  const tampered = await route.DELETE(del({ confirmEmail: 'm@example.com', noticeSha256: SHA, expectedBalance: 999999 }))
  assert.equal(tampered.status, 409)
  assert.equal((await tampered.json()).code, 'MEMBER_WITHDRAW_NOTICE_INVALID')
  assert.ok(!names(calls).includes('anonymize'))

  ;({ route, calls } = loadWithdrawRoute({ preview, notice }))
  const response = await route.DELETE(del({ confirmEmail: 'm@example.com', noticeSha256: SHA, expectedBalance: 500 }))
  assert.equal((await response.json()).kind, 'anonymized')
  const anonymize = calls.find(([name]) => name === 'anonymize')[1]
  assert.deepEqual(anonymize, {
    actorId: USER_ID, userId: USER_ID, method: 'self', expectedBalance: 500, noticeText: '고지',
    operationKey: `member_withdraw_self:${USER_ID}`, ticketRetentionAgreed: true,
  })
  assert.deepEqual(calls.find(([name]) => name === 'notice').slice(1), [USER_ID, 'self', true])
  assert.equal(names(calls).at(-1), 'cleanup')
  assert.ok(!names(calls).includes('notifyOwner'))
})

test('route: 막히면 409 와 DB 문구, 대표 확인 사유는 POST request_review 로만 경보(user_id 키 없는 함수)', async () => {
  const preview = previewOf({ hasOrdersOrAttempts: true, selfReasons: ['REDACTION_REQUIRED'] })
  let { route, calls } = loadWithdrawRoute({ preview })
  const blocked = await route.DELETE(del({ confirmEmail: 'm@example.com', noticeSha256: SHA, expectedBalance: 0 }))
  assert.equal(blocked.status, 409)
  const body = await blocked.json()
  assert.equal(body.error, seedPolicy.texts.blockReasons.REDACTION_REQUIRED)
  assert.equal(body.review, true)
  assert.ok(!names(calls).includes('review'))

  const reviewed = await route.POST(post({ action: 'request_review' }))
  assert.equal((await reviewed.json()).message, seedPolicy.texts.reviewPendingNotice)
  assert.ok(names(calls).includes('review'))

  ;({ route, calls } = loadWithdrawRoute({ preview: previewOf({ selfReasons: ['RECENT_PAYMENT_ACTIVITY'], quietUntil: '2026-12-01T03:00:00.000Z' }) }))
  assert.equal((await route.POST(post({ action: 'request_review' }))).status, 409)
  assert.ok(!names(calls).includes('review'))
})

test('route: 결제 회원은 탈퇴 요청(channel screen)을 만들고, 열린 요청이 있으면 409, 요청 취소는 POST', async () => {
  const payer = previewOf({ hadPayment: true, requestAllowed: true })
  let { route, calls } = loadWithdrawRoute({ preview: payer })
  const response = await route.DELETE(del({ confirmEmail: 'm@example.com', noticeSha256: SHA }))
  const body = await response.json()
  assert.equal(body.kind, 'request_created')
  assert.equal(body.message, seedPolicy.texts.requestCreated)
  const created = calls.find(([name]) => name === 'createRequest')[1]
  assert.equal(created.channel, 'screen')
  assert.equal(created.recordedBy, USER_ID)
  // 요청을 남기면 대표에게 알린다(요청 id 로)
  assert.deepEqual(calls.find(([name]) => name === 'notifyOwner').slice(1), [USER_ID, 'r1'])
  assert.deepEqual(calls.find(([name]) => name === 'notice').slice(1), [USER_ID, 'request', null])
  assert.ok(!names(calls).includes('anonymize') && !names(calls).includes('fullDelete'))

  ;({ route } = loadWithdrawRoute({ preview: { ...payer, openRequest: { id: 'r1' } } }))
  const open = await route.DELETE(del({ confirmEmail: 'm@example.com', noticeSha256: SHA }))
  assert.equal(open.status, 409)
  assert.equal((await open.json()).error, seedPolicy.texts.blockReasons.REQUEST_PENDING)

  ;({ route } = loadWithdrawRoute({ preview: { ...payer, requestAllowed: false, requestReasons: ['DISABLED'] } }))
  const disabled = await route.DELETE(del({ confirmEmail: 'm@example.com', noticeSha256: SHA }))
  assert.equal((await disabled.json()).error, seedPolicy.texts.blockReasons.DISABLED)

  ;({ route, calls } = loadWithdrawRoute({ preview: payer }))
  const canceled = await route.POST(post({ action: 'cancel_request', requestId: '00000000-0000-4000-8000-000000000001' }))
  assert.equal((await canceled.json()).message, seedPolicy.texts.requestCanceled)
})

test('탈퇴 화면: "10일 안에 안내"는 [담당자 확인 요청하기]를 누른 뒤에만, 고지·금액이 바뀌면 체크를 비우고 새 고지를 불러온다', () => {
  // 누르기 전에는 안내 문구를 그리지 않는다(누른 뒤 응답 문구만)
  assert.doesNotMatch(sources.view, /reviewDone === null && texts\?\.reviewPendingNotice/)
  assert.match(sources.view, /setReviewDone\(data\.message \|\| texts\?\.reviewPendingNotice \|\| ''\)/)
  assert.match(sources.view, /data\.code === 'MEMBER_WITHDRAW_NOTICE_INVALID' \|\| data\.code === 'MEMBER_WITHDRAW_BALANCE_CHANGED'\) \{\n\s*setChecked\(\{\}\)\n\s*router\.refresh\(\)/)
})

test('회원 화면에는 가림 대상 문의 제목(redactionRequired.preview)을 보내지 않는다', () => {
  for (const [name, source] of [['page', sources.page], ['view', sources.view], ['route', sources.route]]) {
    assert.doesNotMatch(source, /redactionRequired/, name)
  }
  // 화면에는 서버가 골라 만든 값만 넘긴다(미리보기 통째로 넘기지 않음)
  assert.doesNotMatch(sources.page, /preview=\{preview\}|screen=\{preview/)
  assert.match(sources.page, /<WithdrawView email=\{authData\.user\?\.email \|\| ''\} screen=\{state\.screen\} texts=\{state\.texts\} \/>/)
})

test('탈퇴 화면: 막힘 화면에 광고 수신 동의만 철회(source mypage)·이의제기 안내·환불 링크, 완료 화면에 마케팅 철회 결과', () => {
  assert.match(sources.view, /setOptionalConsentAction\(marketing\.item\.id, marketing\.item\.version, false\)/)
  assert.match(read('src/app/(solvook)/mypage/consents/actions.ts'), /recordUserConsents\(userId, \[\{ item_id: itemId, version, agreed \}\], 'mypage'\)/)
  assert.match(sources.view, /texts\?\.objectionGuide/)
  assert.match(sources.view, /block\.refundLink && texts\?\.refundLinkLabel && \(\s*<Link href="\/mypage\/credits"/)
  assert.match(sources.view, /<MarketingResultLine marketing=\{done\.marketing\}/)
  assert.match(sources.page, /export const metadata: Metadata = \{\s*title: '회원 탈퇴',/)
})

// ---------------------------------------------------------------------------------------------------------------
// 5. 대표 화면·API
// ---------------------------------------------------------------------------------------------------------------
test('대표 API 는 owner 가드 하나로 모든 동작을 받고, 각 동작은 DB 함수로 간다', () => {
  assert.match(sources.adminRoute, /export async function POST\(request: NextRequest, \{ params \}: RouteContext\) \{\n\s*const guard = await requireAdminApiPermission\('owner'\)/)
  const actions = [...sources.adminRoute.matchAll(/action: z\.literal\('([a-z_]+)'\)/g)].map((match) => match[1])
  assert.deepEqual(actions, ['notice', 'record_request', 'record_reply', 'cancel_request', 'anonymize', 'redact', 'mark_reviewed', 'close_held_order', 'add_event', 'read_record', 'read_ticket', 'retry_account'])
  for (const rpc of ['record_member_withdrawal_request_reply', 'redact_member_text', 'mark_member_text_reviewed', 'close_withdrawn_member_held_order', 'add_withdrawn_member_event', 'read_withdrawn_member_record', 'read_withdrawn_member_ticket']) {
    assert.match(sources.adminRoute, new RegExp(`callOwnerWithdrawalRpc\\('${rpc}'`), rpc)
  }
  // 열람은 사유와 요청 IP·기기를 함께 넘긴다(14절 13번)
  assert.equal(sources.adminRoute.match(/p_request_meta: withdrawalRequestMeta\(request\)/g).length, 2)
  // 익명화: 확인 창의 회원 이메일 대조, 페이앱 미확인·답변 대기 체크, 끝나면 로그인 계정 정리
  assert.match(sources.adminRoute, /if \(body\.confirmEmail !== \(profile\.email \?\? id\)\)/)
  assert.match(sources.adminRoute, /providerUnverifiedConfirmed: body\.providerUnverifiedConfirmed,\n\s*pendingTicketsConfirmed: body\.pendingTicketsConfirmed,/)
  assert.match(sources.adminRoute, /if \(!result\.ok\) return fail\(result\.error, policy\)\n\s*const cleanup = await cleanupWithdrawnMemberAccount\(id\)/)
  // 이메일·전화 요청은 서버가 다시 만든 원문 지문과 대조한다
  assert.match(sources.adminRoute, /if \(notice\.data\.sha256 !== body\.noticeSha256\) return fail\(\{ message: 'MEMBER_WITHDRAW_NOTICE_INVALID' \}, policy\)/)
})

const OWNER_ID = '00000000-0000-4000-8000-0000000000ff'
const OTHER_ID = '00000000-0000-4000-8000-0000000000bb'
const TARGET_ID = '00000000-0000-4000-8000-000000000010'

function loadAdminRoute(admin) {
  const audits = []
  const { server, restore } = loadServer(admin)
  const route = load('src/app/api/admin/users/[id]/withdrawal/route.ts', {
    'next/server': { NextResponse },
    '@/lib/admin-permissions-server': { requireAdminApiPermission: async () => ({ access: { userId: OWNER_ID } }) },
    '@/lib/admin-audit-log-server': { recordAdminAudit: async (entry) => { audits.push(entry); return true } },
    '@/lib/supabase/bypass': { createAdminClient: () => admin.client },
    '@/lib/member-withdrawal-server': server,
    '@/lib/member-withdrawal': lib,
  })
  const call = (body) => route.POST(
    new Request(`http://localhost/api/admin/users/${USER_ID}/withdrawal`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: USER_ID }) }
  )
  return { call, audits, restore }
}

const settings = { system_settings: { data: { value: seedPolicy }, error: null } }

test('대표 API retry_account: 탈퇴 안 한 회원이면 deleteUser 를 0번 부르고 409(MEMBER_NOT_WITHDRAWN)', async () => {
  const active = fakeAdmin({ tables: settings, rpc: { withdrawn_member_account_status: () => ({ data: { withdrawnAt: null, authScrubbedAt: null, kakaoUnlinkPending: false }, error: null }) } })
  let api = loadAdminRoute(active)
  const refused = await api.call({ action: 'retry_account' })
  api.restore()
  assert.equal(refused.status, 409)
  assert.equal((await refused.json()).code, 'MEMBER_NOT_WITHDRAWN')
  assert.equal(active.calls.deleteUser.length, 0)

  const withdrawn = fakeAdmin({ tables: settings, rpc: { withdrawn_member_account_status: accountStatus() } })
  api = loadAdminRoute(withdrawn)
  const retried = await api.call({ action: 'retry_account' })
  api.restore()
  assert.equal(retried.status, 200)
  assert.deepEqual((await retried.json()).cleanup, { authScrubbed: true, kakao: 'none' })
  assert.deepEqual(withdrawn.calls.deleteUser, [[USER_ID, true]])
})

test('대표 API: 가림·확인함·보류 주문 닫기·문의 열람·회신 기록은 대상이 주소의 회원 것인지 DB 함수 전에 본다(열람 기록 전에)', async () => {
  const other = { data: { user_id: OTHER_ID }, error: null }
  const own = { data: { user_id: USER_ID }, error: null }
  const cases = [
    [{ action: 'read_ticket', ticketId: TARGET_ID, reason: '이의 제기 확인' }, 'read_withdrawn_member_ticket', { support_tickets: other }, { support_tickets: own }],
    [{ action: 'redact', targetKind: 'support_ticket_revision', targetId: TARGET_ID, field: 'message', targetText: '123-456', operationKey: 'redact-key-1' }, 'redact_member_text',
      { support_ticket_revisions: { data: { ticket_id: TARGET_ID }, error: null }, support_tickets: other },
      { support_ticket_revisions: { data: { ticket_id: TARGET_ID }, error: null }, support_tickets: own }],
    [{ action: 'mark_reviewed', targetKind: 'refund_request', targetId: TARGET_ID }, 'mark_member_text_reviewed', { refund_requests: other }, { refund_requests: own }],
    [{ action: 'close_held_order', orderId: TARGET_ID, method: 'bank_transfer', note: '계좌 송금', operationKey: 'close-key-1' }, 'close_withdrawn_member_held_order', { payment_orders: other }, { payment_orders: own }],
    [{ action: 'record_reply', requestId: TARGET_ID, noticeSentAt: '2026-11-20T10:00:00+09:00', consentReplyReceivedAt: '2026-11-21T10:00:00+09:00', ticketRetentionAgreed: null },
      'record_member_withdrawal_request_reply', { member_withdrawal_requests: other }, { member_withdrawal_requests: own }],
  ]
  for (const [body, rpcName, otherTables, ownTables] of cases) {
    const foreign = fakeAdmin({ tables: { ...settings, ...otherTables } })
    let api = loadAdminRoute(foreign)
    const response = await api.call(body)
    api.restore()
    assert.equal(response.status, 404, body.action)
    assert.ok(!foreign.calls.rpc.some(([name]) => name === rpcName), `${body.action}: DB 함수를 부르지 않는다`)

    const mine = fakeAdmin({ tables: { ...settings, ...ownTables } })
    api = loadAdminRoute(mine)
    assert.equal((await api.call(body)).status, 200, body.action)
    api.restore()
    assert.ok(mine.calls.rpc.some(([name]) => name === rpcName), body.action)
  }
})

test('대표 API cancel_request 는 작업 기록(member_withdraw_request_cancel)을 남긴다', async () => {
  const admin = fakeAdmin({ tables: settings })
  const api = loadAdminRoute(admin)
  assert.equal((await api.call({ action: 'cancel_request', requestId: TARGET_ID })).status, 200)
  api.restore()
  assert.deepEqual(api.audits, [{
    actorId: OWNER_ID,
    action: 'member_withdraw_request_cancel',
    targetType: 'member_withdrawal_request',
    targetId: TARGET_ID,
    targetUserId: USER_ID,
    details: { marketing_withdrawn_at: null },
  }])
  assert.ok(admin.calls.rpc.some(([name]) => name === 'cancel_member_withdrawal_request'))
})

test('대표 API add_event market_cash_refund 는 정산 식별값(settlementKey)이 있어야 하고, 그대로 details 로 넘긴다', async () => {
  const missing = fakeAdmin({ tables: settings })
  let api = loadAdminRoute(missing)
  const refused = await api.call({ action: 'add_event', kind: 'market_cash_refund', refId: TARGET_ID, details: { amount_won: 3000 } })
  api.restore()
  assert.equal(refused.status, 400)
  assert.ok(!missing.calls.rpc.some(([name]) => name === 'add_withdrawn_member_event'))

  const recorded = fakeAdmin({ tables: settings, rpc: { add_withdrawn_member_event: () => ({ data: { recorded: true }, error: null }) } })
  api = loadAdminRoute(recorded)
  const ok = await api.call({ action: 'add_event', kind: 'market_cash_refund', refId: TARGET_ID, details: { settlementKey: 's-1', amount_won: 3000 } })
  api.restore()
  assert.equal((await ok.json()).recorded, true)
  const args = recorded.calls.rpc.find(([name]) => name === 'add_withdrawn_member_event')[1]
  assert.equal(args.p_ref_id, TARGET_ID)
  assert.equal(args.p_details.settlementKey, 's-1')
  // 화면은 정산 창마다 새 식별값을 만들어 보낸다
  const dialog = read('src/app/(admin)/admin/orders/market-exception-refund-dialog.tsx')
  assert.match(dialog, /const \[settlementKey\] = useState\(\(\) => crypto\.randomUUID\(\)\)/)
  assert.match(dialog, /details: \{ settlementKey, amount_won: amountValue,/)
})

test('작은 지적: 결제 조치 이름표·보류 주문 후보·충전 환불 목록 탈퇴 표시·고아 파일·레거시 문구', () => {
  // 결제 조치 이름표가 DB CHECK 값과 같다
  const check = migration.match(/CHECK \(\(action = ANY \(ARRAY\[([^\]]+)\]\)\)\)/)[1]
  const dbActions = [...check.matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]).sort()
  const { PAYMENT_ADMIN_ACTION_LABELS } = load('src/lib/admin-orders.ts')
  assert.deepEqual(Object.keys(PAYMENT_ADMIN_ACTION_LABELS).sort(), dbActions)
  // 보류 주문 후보: 경보가 풀려도 보류 표시·탈퇴 뒤 취소로 남고, 닫은 주문(조치 기록)은 뺀다
  assert.match(sources.adminDetail, /order\.failure_code === WITHDRAWN_HELD_FAILURE_CODE/)
  assert.match(sources.adminDetail, /new Date\(order\.canceled_at\)\.getTime\(\) >= withdrawnTime/)
  assert.match(sources.adminDetail, /\.eq\('action', 'withdrawn_held_order_closed'\)/)
  assert.match(sources.adminDetail, /!closed\.has\(order\.id\)/)
  // 충전 환불 목록: 탈퇴 회원 표시·사유 가림
  const refunds = read('src/app/(admin)/admin/refunds/refunds-client.tsx')
  assert.match(refunds, /request\.memberWithdrawn \? '탈퇴 회원' :/)
  assert.match(refunds, /request\.memberWithdrawn \? '가림' : request\.reason \|\| '-'/)
  // 고아가 된 옛 판정 파일은 지웠다
  assert.throws(() => read('src/lib/withdraw-eligibility.ts'))
  // 레거시 화면: 약관 동의 문구·부정확한 '결제 내역 삭제' 안내가 없다
  const legacy = read('src/app/legacy/mypage/withdraw/withdraw-client.tsx')
  assert.doesNotMatch(legacy, /모든 약관에 동의/)
  assert.doesNotMatch(legacy, /결제 및 크레딧 내역/)
})

test('열람 기록 요청 정보는 IP·기기만 담는다', () => {
  const { server } = loadServer(fakeAdmin())
  const meta = server.withdrawalRequestMeta(new Request('http://localhost', { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'UA' } }))
  assert.deepEqual(meta, { ip: '203.0.113.7', user_agent: 'UA' })
})

test('회원 상세: 대표에게만 탈퇴 구역을 읽고, 탈퇴 회원 문의 제목·환불 사유는 가린다', () => {
  assert.match(sources.adminDetail, /readSection\(access, 'owner', '회원 탈퇴', \(\) => readWithdrawal\(userId\)\)/)
  assert.match(sources.adminDetail, /tickets: mask\.withdrawn \? data\.map\(\(ticket\) => \(\{ \.\.\.ticket, subject: mask\.ticketTitle \}\)\) : data/)
  assert.match(sources.adminDetail, /reason: mask\.withdrawn \? null : request\.reason,/)
  assert.match(sources.adminDetail, /requests: mask\.withdrawn \? data\.map\(\(request\) => \(\{ \.\.\.request, reason: null \}\)\) : data/)
  assert.match(sources.adminDetail, /const withdrawn = \(await readWithdrawnUserIdsForRedaction\(\[userId\]\)\)\.has\(userId\)/)
  assert.match(sources.adminDetail, /return \{ withdrawn: true, ticketTitle: await readWithdrawnTicketTitle\(\) \}/)
  assert.match(sources.adminPage, /<Section title="회원 탈퇴 \(대표 전용\)" section=\{detail\.withdrawal\}>/)
  // 탈퇴 회원 문의는 상세 링크를 두지 않는다
  assert.match(sources.adminPage, /\{withdrawn\n\s*\? <span/)
  assert.match(sources.adminPage, /withdrawal: '탈퇴\(광고 수신 철회\)'/)
  // 대표 화면: 가림·확인함, 페이앱 미확인·답변 대기 확인 체크, 보류 주문 닫기, 다시 시도, 보관 연락처 보기
  for (const label of ['가림', '확인함', '고지 원문 만들기', '요청 기록', '회신 기록', '익명화', '보류 주문 닫기', '로그인 계정 정리 다시 시도', '보관 연락처 보기']) {
    assert.ok(sources.adminPanel.includes(`>${label}<`) || sources.adminPanel.includes(`>\n          ${label}\n`) || sources.adminPanel.includes(`${label}\n`), label)
  }
  assert.match(sources.adminPanel, /texts\.identityNoteGuide/)
  assert.match(sources.adminPanel, /texts\.reasonGuide/)
})

// ---------------------------------------------------------------------------------------------------------------
// 6. 타입(손으로 추가 — 운영 DB 에 아직 없음)
// ---------------------------------------------------------------------------------------------------------------
test('src/types/supabase.ts 에 새 표·칸·함수가 있다', () => {
  for (const table of ['member_withdrawal_requests', 'withdrawn_member_records', 'withdrawn_member_record_events']) {
    assert.match(sources.types, new RegExp(`\\n      ${table}: \\{\\n        Row: \\{`), table)
  }
  assert.equal(sources.types.match(/\n          withdrawn_at\??: string \| null/g).length, 3, 'profiles.withdrawn_at Row·Insert·Update')
  assert.equal(sources.types.match(/\n          redaction_reviewed_at\??: string \| null/g).length, 12, '4개 표 × 3')
  const functions = [...migration.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)].map((match) => match[1])
  const triggerFunctions = new Set([...migration.matchAll(/EXECUTE FUNCTION public\.([a-z_]+)\(\)/g)].map((match) => match[1]))
  for (const name of new Set(functions)) {
    if (triggerFunctions.has(name) || /^guard_|^prevent_|^record_withdrawn_member_manual_refund$/.test(name)) continue
    assert.match(sources.types, new RegExp(`\\n      ${name}: \\{`), name)
  }
  // 기본값이 있는 인자는 선택 인자다
  assert.match(sources.types, /anonymize_member: \{\n\s*Args: \{[\s\S]*?p_pending_tickets_confirmed\?: boolean[\s\S]*?p_ticket_retention_agreed\?: boolean/)
})

// ---------------------------------------------------------------------------------------------------------------
// 7. 결제 경로(5-5 코드 쪽): 늦은 결제 보류 결과·탈퇴 회원 거절
// ---------------------------------------------------------------------------------------------------------------
test('웹훅은 withdrawn_member_hold 를 완료로 닫고(알림 없음), 대사는 수동 확인으로 둔다', () => {
  const webhook = read('src/lib/payapp-webhook-server.ts')
  assert.match(webhook, /const COMPLETED_FEEDBACK_RESULTS = new Set\(\[[\s\S]*?'withdrawn_member_hold',[\s\S]*?\]\)/)
  // 회원 알림은 지급(fulfilled)일 때만 — 보류 결과로는 알림이 나가지 않는다
  assert.match(webhook, /const userNotification = result\.result === 'fulfilled' && result\.user_id/)
  assert.match(read('src/lib/payment-reconciliation-server.ts'), /case 'withdrawn_member_hold':[\s\S]{0,200}?return 'manual_review' as const/)
  // DB 가 돌려주는 결과 이름과 같다
  assert.match(migration, /'result', 'withdrawn_member_hold',/)
})

test('결제 route: 휴대폰 저장은 탈퇴하지 않은 프로필만, 탈퇴 회원 거절은 403 안내', () => {
  const route = read('src/app/api/payments/payapp/orders/route.ts')
  assert.match(route, /\.is\('phone', null\)[\s\S]{0,200}?\.is\('withdrawn_at', null\)/)
  assert.match(route, /case 'member_withdrawn':\n\s*return memberWithdrawnResponse\(\)/)
  assert.match(read('src/lib/point-charge-policy-server.ts'), /case 'MEMBER_WITHDRAWN':\n\s*return \{ status: 'member_withdrawn' \}/)
  assert.match(migration, /'code', 'MEMBER_WITHDRAWN'/)
  assert.match(read('src/app/api/admin/payments/review/route.ts'), /PAYMENT_REVIEW_MEMBER_WITHDRAWN: MEMBER_WITHDRAWAL_ERRORS\.PAYMENT_REVIEW_MEMBER_WITHDRAWN\.message/)
})

// ---------------------------------------------------------------------------------------------------------------
// 8. 크레딧 유형 withdrawal_forfeit(6-8)·수동 환불 화면(6-7)·회원 목록(6-9)·관리자 비밀번호(6-10)
// ---------------------------------------------------------------------------------------------------------------
test('크레딧 유형 나열에 withdrawal_forfeit 가 DB CHECK 와 같이 있다', () => {
  assert.match(migration, /CHECK \(\(type = ANY \(ARRAY\['purchase'::text, 'consume'::text, 'refund'::text, 'admin_grant'::text, 'bonus'::text, 'withdrawal_forfeit'::text\]\)\)\)/)
  assert.match(read('src/lib/credits.ts'), /type: 'purchase' \| 'consume' \| 'refund' \| 'admin_grant' \| 'bonus' \| 'withdrawal_forfeit'/)
  assert.match(read('src/lib/admin-credit-transactions-server.ts'), /ADMIN_CREDIT_TRANSACTION_TYPES = \['purchase', 'consume', 'refund', 'withdrawal_forfeit'\] as const/)
  for (const path of ['src/app/(solvook)/mypage/credits/_components/credits-view.tsx', 'src/app/legacy/mypage/credits/credits-client.tsx']) {
    assert.match(read(path), /value: 'withdrawal_forfeit'/, path)
  }
  assert.match(read('src/app/(admin)/admin/credits/credits-client.tsx'), /<SelectItem value="withdrawal_forfeit">/)
  assert.match(read('src/lib/credit-transaction-display.ts'), /withdrawal_forfeit/)
  assert.match(read('src/lib/admin-credit-transaction-kind.ts'), /withdrawal_forfeit/)
})

test('수동 환불 화면은 원천별 탈퇴 소멸을 원장에서 따로 읽어 "탈퇴로 소멸(사용 아님)"으로 보여 준다', () => {
  assert.match(read('src/app/api/admin/refunds/recovery-preview/route.ts'), /\.eq\('type', 'withdrawal_forfeit'\)\.in\('source_id', sourceIds\)/)
  assert.match(read('src/app/(admin)/admin/refunds/refunds-client.tsx'), /탈퇴로 소멸\(사용 아님\)/)
  assert.match(read('src/lib/manual-refund-recovery-preview.ts'), /export function attachWithdrawalForfeits/)
})

test('회원 목록 탈퇴 표시, 관리자 계정의 /mypage/profile 비밀번호는 관리자 비밀번호 화면으로', () => {
  assert.match(read('src/lib/admin-users-server.ts'), /withdrawn_at/)
  assert.match(read('src/app/(admin)/admin/users/users-client.tsx'), /\{user\.withdrawn_at && \(/)
  assert.match(read('src/app/(solvook)/mypage/profile/page.tsx'), /adminPasswordHref=\{profile\?\.is_admin \? '\/admin\/my-password' : null\}/)
})

// ---------------------------------------------------------------------------------------------------------------
// 9. service_role 경로의 탈퇴 회원 가림(6-6)·자료 예외 환불 → 현금 정산 기록(6-4)
// ---------------------------------------------------------------------------------------------------------------
test('가림 모듈: DB 적용 전(42703)만 탈퇴 회원 없음으로 보고, 문의 목록 줄에는 제목·본문을 읽지 않는다', async () => {
  const redaction = read('src/lib/withdrawn-member-redaction-server.ts')
  assert.match(redaction, /error\.message\.includes\('42703'\)/)
  assert.match(redaction, /\.select\('id, user_id, status, created_at', \{ count: 'exact' \}\)/)
  assert.doesNotMatch(redaction, /\.select\([^)]*(subject|message|admin_response)/)

  const loadRedaction = (readWithdrawnUserIds) => load('src/lib/withdrawn-member-redaction-server.ts', {
    'server-only': {},
    '@/lib/supabase/bypass': { createAdminClient: () => { throw new Error('not used') } },
    '@/lib/member-withdrawal': lib,
    '@/lib/member-withdrawal-server': { readWithdrawnUserIds, readMemberWithdrawalPolicy: async () => policy },
  })
  const marked = await loadRedaction(async () => new Set(['u2'])).markWithdrawnRows(
    [{ user_id: 'u1', subject: '원래 제목' }, { user_id: 'u2', subject: '계좌 123-456-7890' }],
    (row) => row.user_id,
    (row, title) => ({ ...row, subject: title })
  )
  assert.deepEqual(marked, [
    { user_id: 'u1', subject: '원래 제목', memberWithdrawn: false },
    { user_id: 'u2', subject: seedPolicy.texts.adminEventTitle, memberWithdrawn: true },
  ])
  const beforeDb = loadRedaction(async () => { throw new Error('탈퇴 회원 조회 실패: 42703') })
  assert.deepEqual([...await beforeDb.readWithdrawnUserIdsForRedaction(['u1'])], [])
  const broken = loadRedaction(async () => { throw new Error('탈퇴 회원 조회 실패: 57014') })
  await assert.rejects(() => broken.readWithdrawnUserIdsForRedaction(['u1']))
})

test('대시보드·문의·환불·주문 화면의 service_role 읽기는 탈퇴 회원 문의 제목·환불 사유·메모를 가린다', () => {
  assert.match(read('src/lib/admin-dashboard-server.ts'), /markWithdrawnRows\(/)
  const supportPage = read('src/app/(admin)/admin/support/page.tsx')
  assert.match(supportPage, /const isOwner = access\.role === 'owner'/)
  assert.match(supportPage, /readWithdrawnSupportTickets\(\{ withRows: isOwner \}\)/)
  assert.match(supportPage, /<WithdrawnTicketsPanel/)
  assert.match(read('src/app/(admin)/admin/support/withdrawn-tickets-panel.tsx'), /action: 'read_ticket', ticketId: target\.id, reason: reason\.trim\(\)/)
  const refundsPage = read('src/app/(admin)/admin/refunds/page.tsx')
  assert.match(refundsPage, /markWithdrawnRows\(requests \?\? \[\], \(row\) => row\.user_id, \(row\) => \(\{ \.\.\.row, reason: null, admin_note: null \}\)\)/)
  assert.match(refundsPage, /readWithdrawnMarketRefundRequests\(\)/)
  for (const path of ['src/app/api/admin/refunds/route.ts', 'src/app/api/admin/market/refunds/route.ts']) {
    assert.match(read(path), /reason: null, admin_note: null/, path)
  }
  const orders = read('src/lib/admin-orders-server.ts')
  assert.match(orders, /reason: withdrawnMembers\?\.has\(row\.user_id\) === false \? refund\.reason : null/)
  assert.equal(orders.match(/memberWithdrawn: withdrawnMembers\?\.has\(row\.user_id\) \?\? false/g).length, 2)
  // 예외 환불 문맥: 탈퇴 회원이면 문의를 읽지 않는다
  assert.match(read('src/lib/market-refunds.ts'), /memberWithdrawn\s*\? Promise\.resolve\(\{ data: \[\]/)
})

test('자료 예외 환불·승인: 탈퇴 회원 주문은 대표의 현금 정산 기록(add_event market_cash_refund), route 는 MEMBER_WITHDRAWN 을 안내로', () => {
  const dialog = read('src/app/(admin)/admin/orders/market-exception-refund-dialog.tsx')
  assert.match(dialog, /context\?\.memberWithdrawn/)
  assert.match(dialog, /탈퇴 회원 — 현금 정산 기록/)
  assert.match(dialog, /kind: 'market_cash_refund',\s*refId: orderId/)
  assert.match(read('src/lib/market-refund-rules.ts'), /error\.message\.trim\(\) === 'MEMBER_WITHDRAWN'/)
  for (const path of ['src/app/api/admin/market/orders/[id]/exception-refund/route.ts', 'src/app/api/admin/market/refunds/[id]/route.ts']) {
    const source = read(path)
    assert.match(source, /isMarketRefundMemberWithdrawnError\(error\)/, path)
    assert.match(source, /code: 'MEMBER_WITHDRAWN' \}, \{ status: 409 \}/, path)
  }
  // 대표 API 의 add_event 는 금액·방법·메모 같은 값만 받는다(객체 하나, 값은 글자·숫자·참거짓)
  assert.match(sources.adminRoute, /kind: z\.enum\(\['market_cash_refund', 'note'\]\),\n\s*refId: uuid\.nullable\(\),\n\s*details: z\.record\(/)
})

// ---------------------------------------------------------------------------------------------------------------
// 구현 검증 2회차 작은 지적
// ---------------------------------------------------------------------------------------------------------------
const fnBody = (name) => {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  assert.ok(start >= 0, name)
  return migration.slice(start, migration.indexOf('\n$', migration.indexOf('\nAS $', start) + 5))
}

test('2회차: 탈퇴 화면 — 프로필 없음 + 회원 없음(USER_NOT_FOUND)이면 unavailable 대신 탈퇴 마무리 폼(이메일 확인 → DELETE)', () => {
  assert.match(sources.page, /memberWithdrawalErrorCode\(previewResult\.error\.message\) === 'MEMBER_WITHDRAW_USER_NOT_FOUND'/)
  assert.match(sources.page, /if \(!profileError && !profile\) \{\n\s*return \{ screen: \{ kind: 'finish_delete' \}, texts: screenTexts\(policy\) \}/)
  // 미리보기 실패 일반(unavailable) 판정보다 먼저 본다
  assert.ok(sources.page.indexOf("kind: 'finish_delete'") < sources.page.indexOf('if (!policy || !previewResult.ok)'))
  assert.match(sources.view, /screen\.kind === 'finish_delete'\) \{\n\s*body = <FinishDeleteForm email=\{email\} texts=\{texts\} onDone=\{setDone\} \/>/)
  assert.match(sources.view, /body: JSON\.stringify\(\{ confirmEmail \}\)/)
  assert.match(sources.view, /texts\.finishDeleteButton/)
  for (const path of ['finishDeleteNotice', 'finishDeleteButton']) assert.ok(lib.withdrawalText(policy, path), path)
})

test('2회차·3회차: 결제 검토 목록 — 탈퇴 회원 보류 주문(늦은 결제 기록, 실패 코드 무관)은 동작 없이 DB 문구 안내, 정책을 못 읽으면 고정 오류 안내', () => {
  const refundsPage = read('src/app/(admin)/admin/refunds/page.tsx')
  const reviewClient = read('src/app/(admin)/admin/refunds/payment-review-client.tsx')
  assert.match(refundsPage, /heldOrderIds = await readWithdrawnHeldOrderIds\(\(reviewOrderRows \?\? \[\]\)\.map\(\(order\) => order\.id\)\)/)
  assert.match(refundsPage, /withdrawalText\(await readMemberWithdrawalPolicy\(\), 'paymentReviewHeldOrder'\) \?\? MEMBER_WITHDRAWAL_ERRORS\.MEMBER_WITHDRAW_POLICY_UNAVAILABLE\.message/)
  assert.match(refundsPage, /: heldOrderIds\.has\(order\.id\) \? heldOrderNotice : null/)
  // 판정을 읽지 못하면 모든 수동 확인 주문의 버튼을 비우고 고정 안내를 보인다(처리하지 않는 쪽으로 닫음).
  assert.match(refundsPage, /heldOrderCheckFailed = true/)
  assert.match(refundsPage, /heldOrderNotice: heldOrderCheckFailed\s*\?\s*HELD_ORDER_CHECK_FAILED_NOTICE/)
  assert.match(refundsPage, /allowedActions: heldOrderCheckFailed \? \[\] : allowedReviewActions\(/)
  assert.match(refundsPage, /withdrawnHeldOrder: heldOrderIds\.has\(order\.id\),/)
  assert.doesNotMatch(refundsPage, /failure_code\)\s*\?\s*heldOrderNotice|isWithdrawnMemberHeldOrder/)
  assert.match(reviewClient, /order\.heldOrderNotice \? \(\n\s*<span className="text-xs text-gray-500 break-keep">\{order\.heldOrderNotice\}<\/span>/)
  assert.ok(lib.withdrawalText(policy, 'paymentReviewHeldOrder'))
})

test('2회차: 고지 원문 — 대기 문의 줄은 보존 경로만 닫힘, 미동의는 삭제, 회신 선택은 둘 다 안내 / 보관 연락처 쓰임에 처리 결과 안내', () => {
  const notice = seedPolicy.texts.notice
  for (const key of ['pendingTickets', 'pendingTicketsDelete', 'pendingTicketsChoice']) assert.match(notice[key], /\{답변대기문의\}/, key)
  assert.doesNotMatch(notice.pendingTicketsDelete, /닫힙니다/)
  assert.match(notice.retainedPayer, /분쟁 처리, 법에 따른 환불 연락, 탈퇴·광고성 정보 수신 동의 철회 처리 결과 안내에만/)
  const body = fnBody('member_withdrawal_notice_text')
  assert.match(body, /WHEN \(p_facts ->> 'hadPayment'\)::boolean OR p_ticket_retention_agreed IS TRUE THEN v_n ->> 'pendingTickets'\n\s*WHEN p_ticket_retention_agreed IS FALSE THEN v_n ->> 'pendingTicketsDelete'\n\s*ELSE v_n ->> 'pendingTicketsChoice' END/)
})

test('2회차: 로그인 계정 정리 경보는 익명화 거래에서 넣지 않고(정상 경로 알림 없음), 정기 작업이 10분 지난 미정리만 한 번 남긴다', () => {
  assert.doesNotMatch(fnBody('anonymize_member'), /record_payment_alert\('MEMBER_AUTH_SCRUB_PENDING'/)
  const remind = fnBody('remind_unanswered_admin_work')
  assert.match(remind, /'MEMBER_AUTH_SCRUB_PENDING',/)
  assert.match(remind, /WHERE r\.auth_scrubbed_at IS NULL\n\s*AND r\.withdrawn_at <= now\(\) - interval '10 minutes'/)
  // 보내는 시간대 검사보다 먼저 본다
  assert.ok(remind.indexOf('MEMBER_AUTH_SCRUB_PENDING') < remind.indexOf('send_from_hour'))
})

test('2회차: 보류 주문 — 검증 실패 통보는 late_payment 기록이 있으면 상태를 바꾸지 않고, 취소 처리 실패 대체 경로도 닫을 수 있다', () => {
  assert.match(fnBody('apply_payapp_feedback'), /e\.kind = 'late_payment' AND e\.ref_id = v_order\.id\) THEN\n\s*PERFORM public\.record_payment_alert\(\n\s*'WITHDRAWN_HELD_ORDER_FEEDBACK_MISMATCH'/)
  const close = fnBody('close_withdrawn_member_held_order')
  assert.match(close, /OR \(v_order\.status = 'manual_review' AND v_order\.failure_code = 'PAYAPP_CANCEL_HANDLING_FAILED'\)\) THEN/)
  // 3회차: 닫은 주문은 늘 replay(다시 닫는 예외 없음)
  assert.match(close, /e\.kind = 'held_order_closed' AND e\.ref_id = v_order\.id\) THEN\n\s*RETURN jsonb_build_object\('closed', true, 'replay', true/)
  assert.doesNotMatch(close, /AND NOT \(v_order\.status = 'manual_review'/)
  // 요청 뒤 새 원천 검사는 무상도 본다(paid 조건 없음)
  assert.doesNotMatch(fnBody('anonymize_member'), /WHERE \(b\.e ->> 'paid'\)::boolean\n\s*AND \(b\.e ->> 'forfeited'\)::integer > 0\n\s*AND c\.created_at > v_request\.created_at/)
})

// ---------------------------------------------------------------------------------------------------------------
// 구현 검증 3회차 지적
// ---------------------------------------------------------------------------------------------------------------
test('3회차: 닫은 보류 주문에 온 취소의 대체 경로는 주문을 다시 열지 않고(failed 유지) 처리 시각·경보만 남긴다(송금으로 닫았으면 이중 환불 의심)', () => {
  const body = fnBody('process_payapp_cancellation')
  const fallback = body.slice(body.indexOf('-- 실패 대체 처리'))
  const closed = fallback.slice(fallback.indexOf('-- 닫은 탈퇴 회원 보류 주문(지급 전, 닫기 조치 기록 있음)'), fallback.indexOf("IF v_source.id IS NOT NULL AND v_source.status <> 'refunded' THEN"))
  assert.ok(closed.length > 0, '닫은 주문 분기는 크레딧 묶기·manual_review 전에 있다')
  assert.match(closed, /IF v_order\.source_id IS NULL THEN\n\s*SELECT paa\.external_method INTO v_closed_method\n\s*FROM public\.payment_admin_actions paa\n\s*WHERE paa\.payment_order_id = v_order\.id\n\s*AND paa\.action = 'withdrawn_held_order_closed'/)
  assert.match(closed, /IF v_closed_method = 'bank_transfer' THEN\n\s*PERFORM public\.record_payment_alert\(\n\s*'PAYAPP_DOUBLE_REFUND_SUSPECTED',\n\s*'critical',/)
  assert.match(closed, /'source', 'withdrawn_held_order_bank_transfer'/)
  assert.match(closed, /'result', 'double_refund_suspected'/)
  assert.match(closed, /'PAYAPP_CANCEL_HANDLING_FAILED',\n\s*'critical',\n\s*COALESCE\(NULLIF\(btrim\(public\.member_withdrawal_policy\(\) -> 'texts' ->> 'alertClosedHeldOrderCancelFailed'\), ''\),/)
  assert.doesNotMatch(closed, /status = 'manual_review'|UPDATE public\.payment_orders/)
  assert.ok(seedPolicy.texts.alertClosedHeldOrderCancelFailed)
  // 닫기 함수는 이 주문의 취소 처리 실패 경보도 함께 푼다
  assert.match(fnBody('close_withdrawn_member_held_order'), /OR \(code = 'PAYAPP_CANCEL_HANDLING_FAILED' AND \(details ->> 'payment_order_id'\) = v_order\.id::text\)\);/)
})

test('3회차: VERIFY 문구 목록에 탈퇴 마무리·결제 검토 안내·닫은 주문 경보 문구가 있다', () => {
  const verify = migration.slice(migration.indexOf('DO $verify_member_withdrawal$'))
  const list = verify.slice(verify.indexOf("FOREACH v_key IN ARRAY ARRAY['noticeTitle'"), verify.indexOf('] LOOP', verify.indexOf("FOREACH v_key IN ARRAY ARRAY['noticeTitle'")))
  for (const key of ['finishDeleteNotice', 'finishDeleteButton', 'paymentReviewHeldOrder', 'alertClosedHeldOrderCancelFailed', 'alertAuthScrubPending']) {
    assert.match(list, new RegExp(`'${key}'`), key)
    assert.ok(seedPolicy.texts[key], key)
  }
})

test('3회차: 서버의 로그인 계정 정리 실패 경보 문구는 DB 정책 texts.alertAuthScrubPending, 읽지 못하면 코드 값', async () => {
  const withPolicy = fakeAdmin({
    deleteUser: async () => ({ error: { status: 500 } }),
    rpc: { withdrawn_member_account_status: accountStatus() },
    tables: { system_settings: { data: { value: seedPolicy }, error: null } },
  })
  let loaded = loadServer(withPolicy)
  await loaded.server.cleanupWithdrawnMemberAccount(USER_ID)
  loaded.restore()
  const alertOf = (admin) => admin.calls.rpc.find(([name, args]) => name === 'record_payment_alert' && args.p_code === 'MEMBER_AUTH_SCRUB_PENDING')[1]
  assert.equal(alertOf(withPolicy).p_message, seedPolicy.texts.alertAuthScrubPending)

  const noPolicy = fakeAdmin({ deleteUser: async () => ({ error: { status: 500 } }), rpc: { withdrawn_member_account_status: accountStatus() } })
  loaded = loadServer(noPolicy)
  await loaded.server.cleanupWithdrawnMemberAccount(USER_ID)
  loaded.restore()
  assert.equal(alertOf(noPolicy).p_message, 'MEMBER_AUTH_SCRUB_PENDING')
  assert.doesNotMatch(sources.server, /'탈퇴 회원의 로그인 계정 정리\(소프트 삭제\)가 끝나지 않았습니다/)
})

test('3회차: 완전 삭제 로그인 계정 삭제가 성공하거나 이미 없으면(404) 경보 해소 함수를 부르고, 실패하면 부르지 않고 경보·예외', async () => {
  for (const deleteResult of [{ error: null }, { error: { status: 404 } }]) {
    const admin = fakeAdmin({ deleteUser: async () => deleteResult })
    const { server, restore } = loadServer(admin)
    await server.deleteFullDeletedAuthUser(USER_ID)
    restore()
    assert.deepEqual(admin.calls.rpc, [['resolve_member_full_delete_auth_alert', { p_user_id: USER_ID }]])
  }
  // 해소 함수가 실패해도 탈퇴는 끝난 것으로 본다(던지지 않음)
  const resolveFails = fakeAdmin({ rpc: { resolve_member_full_delete_auth_alert: () => ({ data: null, error: { code: 'XX000' } }) } })
  let loaded = loadServer(resolveFails)
  await loaded.server.deleteFullDeletedAuthUser(USER_ID)
  loaded.restore()

  const failing = fakeAdmin({ deleteUser: async () => ({ error: { status: 503 } }) })
  loaded = loadServer(failing)
  await assert.rejects(() => loaded.server.deleteFullDeletedAuthUser(USER_ID))
  loaded.restore()
  assert.deepEqual(failing.calls.rpc.map(([name, args]) => [name, args.p_code]), [['record_payment_alert', 'MEMBER_FULL_DELETE_AUTH_PENDING']])
  // DB 는 프로필·로그인 계정이 모두 없을 때만 그 회원의 경보를 푼다
  const resolve = fnBody('resolve_member_full_delete_auth_alert')
  assert.match(resolve, /IF EXISTS \(SELECT 1 FROM public\.profiles p WHERE p\.id = p_user_id\)\n\s*OR EXISTS \(SELECT 1 FROM auth\.users u WHERE u\.id = p_user_id\) THEN\n\s*RETURN jsonb_build_object\('alertsResolved', 0/)
  assert.match(resolve, /AND code = 'MEMBER_FULL_DELETE_AUTH_PENDING'\n\s*AND \(details ->> 'dedupe_key'\) = 'member_full_delete_auth:' \|\| p_user_id;/)
  assert.match(sources.types, /\n      resolve_member_full_delete_auth_alert: \{\n        Args: \{\n          p_user_id: string\n        \}\n        Returns: Json/)
})

test('3회차: 결제 검토 화면의 보류 주문 판정은 DB(늦은 결제 기록)로 하고, 읽지 못하면 예외', async () => {
  const admin = fakeAdmin({ rpc: { withdrawn_member_held_order_ids: () => ({ data: ['o1'], error: null }) } })
  let loaded = loadServer(admin)
  assert.deepEqual([...await loaded.server.readWithdrawnHeldOrderIds(['o1', 'o2', 'o1'])], ['o1'])
  assert.deepEqual([...await loaded.server.readWithdrawnHeldOrderIds([])], [])
  loaded.restore()
  assert.deepEqual(admin.calls.rpc, [['withdrawn_member_held_order_ids', { p_order_ids: ['o1', 'o2'] }]])
  const broken = fakeAdmin({ rpc: { withdrawn_member_held_order_ids: () => ({ data: null, error: { code: 'XX000' } }) } })
  loaded = loadServer(broken)
  await assert.rejects(() => loaded.server.readWithdrawnHeldOrderIds(['o1']))
  loaded.restore()
  assert.match(fnBody('withdrawn_member_held_order_ids'), /WHERE e\.kind = 'late_payment' AND e\.ref_id = ANY \(p_order_ids\)/)
  assert.match(sources.types, /\n      withdrawn_member_held_order_ids: \{\n        Args: \{\n          p_order_ids: string\[\]\n        \}\n        Returns: string\[\]/)
})

// 탈퇴 화면(page.tsx)을 가짜 의존성으로 불러 화면 종류를 본다(JSX 는 { type, props } 로).
async function renderWithdrawPage({ pagePolicy = policy, previewResult, profileResult = { data: null, error: null } }) {
  const source = read('src/app/(solvook)/mypage/withdraw/page.tsx')
  const { outputText } = ts.transpileModule(source, {
    fileName: 'page.tsx',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  })
  const profileLookups = []
  const profileQuery = { select: () => profileQuery, eq: (column, value) => { profileLookups.push([column, value]); return profileQuery }, maybeSingle: async () => profileResult }
  const mocks = {
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    react: { Suspense: 'Suspense' },
    'next/navigation': { redirect: (to) => { throw new Error(`redirect ${to}`) } },
    'next/server': { connection: async () => {} },
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { email: 'm@example.com' } } }) } }) },
    '@/lib/supabase/bypass': { createAdminClient: () => ({ from: (table) => { assert.equal(table, 'profiles'); return profileQuery } }) },
    '@/lib/request-auth': { getRequestAuthUserId: async () => USER_ID },
    '@/lib/member-withdrawal-server': {
      readMemberWithdrawalPolicy: async () => pagePolicy,
      readMemberWithdrawalPreview: async () => previewResult,
      readMemberWithdrawalNotice: async () => ({ ok: false, error: { message: 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE' } }),
    },
    '@/lib/member-withdrawal': lib,
    '@/lib/signup-consent-server': { getConsentSenderName: async () => '문제마켓 운영자', readSignupConsentTexts: async () => null },
    './_components/withdraw-view': { WithdrawView: 'WithdrawView' },
  }
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', 'console', outputText)((name) => {
    if (!(name in mocks)) throw new Error(`mock 없음: ${name}`)
    return mocks[name]
  }, loaded, loaded.exports, { error: () => {} })
  const element = await loaded.exports.default()
  const view = element.props.children
  assert.equal(view.type, 'WithdrawView')
  return { screen: view.props.screen, texts: view.props.texts, profileLookups }
}

const userNotFound = { ok: false, error: { message: 'MEMBER_WITHDRAW_USER_NOT_FOUND' } }

test('3회차: 탈퇴 화면 동작 (a) 미리보기 회원 없음 + 프로필 없음 → 탈퇴 마무리(finish_delete, DB 문구)', async () => {
  const { screen, texts, profileLookups } = await renderWithdrawPage({ previewResult: userNotFound })
  assert.deepEqual(screen, { kind: 'finish_delete' })
  assert.equal(texts.finishDeleteButton, seedPolicy.texts.finishDeleteButton)
  assert.equal(texts.finishDeleteNotice, seedPolicy.texts.finishDeleteNotice)
  assert.deepEqual(profileLookups, [['id', USER_ID]])
})

test('3회차: 탈퇴 화면 동작 (b) 미리보기 회원 없음 + 프로필 있음 → unavailable(탈퇴 마무리 아님), 관리자(미리보기 정상) → admin', async () => {
  let rendered = await renderWithdrawPage({ previewResult: userNotFound, profileResult: { data: { id: USER_ID }, error: null } })
  assert.equal(rendered.screen.kind, 'unavailable')
  assert.equal(rendered.texts, null)
  rendered = await renderWithdrawPage({ previewResult: { ok: true, data: { ...previewOf({ isAdmin: true }), balance: { forfeitTotal: 0, breakdown: [] } } } })
  assert.equal(rendered.screen.kind, 'admin')
  assert.deepEqual(rendered.profileLookups, [], '미리보기가 정상이면 프로필을 다시 보지 않는다')
  // 정책을 읽지 못하면 프로필을 보지 않고 unavailable
  rendered = await renderWithdrawPage({ pagePolicy: null, previewResult: userNotFound })
  assert.equal(rendered.screen.kind, 'unavailable')
  assert.deepEqual(rendered.profileLookups, [])
})

test('3회차: 탈퇴 화면 동작 (c) 미리보기 회원 없음 + 프로필 조회 오류 → unavailable', async () => {
  const { screen, texts } = await renderWithdrawPage({ previewResult: userNotFound, profileResult: { data: null, error: { code: '57014', message: 'timeout' } } })
  assert.equal(screen.kind, 'unavailable')
  assert.equal(texts, null)
})

test('3회차: route 탈퇴 마무리 — 프로필 없음 + 회원 없음(USER_NOT_FOUND)일 때만 로그인 계정 삭제를 마저 하고, 프로필이 있으면 부르지 않는다', async () => {
  let { route, calls } = loadWithdrawRoute({ previewResult: userNotFound, profile: null })
  let response = await route.DELETE(del({ confirmEmail: 'm@example.com' }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).kind, 'deleted')
  assert.deepEqual(calls.filter(([name]) => name === 'finishAuthDelete'), [['finishAuthDelete', USER_ID]])

  // 프로필 있음(일반 회원): 이상 상태라 지우지 않는다
  ;({ route, calls } = loadWithdrawRoute({ previewResult: userNotFound, profile: { is_admin: false, provider: 'email', kakao_id: null } }))
  response = await route.DELETE(del({ confirmEmail: 'm@example.com' }))
  assert.equal(response.status, 404)
  assert.ok(!names(calls).includes('finishAuthDelete'))

  // 프로필 있음(관리자): 미리보기 전에 403
  ;({ route, calls } = loadWithdrawRoute({ previewResult: userNotFound, isAdmin: true }))
  assert.equal((await route.DELETE(del({ confirmEmail: 'm@example.com' }))).status, 403)
  assert.ok(!names(calls).includes('finishAuthDelete') && !names(calls).includes('preview'))

  // 프로필 없음 + 다른 미리보기 오류: 지우지 않는다
  ;({ route, calls } = loadWithdrawRoute({ previewResult: { ok: false, error: { message: 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE' } }, profile: null }))
  response = await route.DELETE(del({ confirmEmail: 'm@example.com' }))
  assert.notEqual(response.status, 200)
  assert.ok(!names(calls).includes('finishAuthDelete'))
})

test('3회차: 런북 — 닫은 주문은 다시 닫지 않고 추가 송금 금지(송금이었으면 이중 환불 절차), 완전 삭제 로그인 계정 수동 처리', () => {
  const runbook = read('docs/admin-operations-runbook.md')
  assert.doesNotMatch(runbook, /같은 방법으로 다시 닫습니다/)
  assert.match(runbook, /\*\*추가로 송금하지 않습니다\.\*\*/)
  assert.match(runbook, /처음 방법이 \*\*계좌 송금\*\*이면 이중 환불입니다\. `PAYAPP_DOUBLE_REFUND_SUSPECTED`\(출처 `withdrawn_held_order_bank_transfer`\)/)
  assert.match(runbook, /`MEMBER_FULL_DELETE_AUTH_PENDING`/)
  assert.match(runbook, /\*\*탈퇴 마무리\*\* 화면/)
  assert.doesNotMatch(runbook, /"확인 처리"로는 처리할 수 없습니다/)
})
