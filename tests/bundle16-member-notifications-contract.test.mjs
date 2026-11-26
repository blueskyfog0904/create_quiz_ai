import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse, adminGuardMocks, load } from './helpers/market-images-harness.mjs'
import { memberNotificationRules as rules, memberNotificationsServer, seedMemberNotificationTexts } from './helpers/member-notifications-harness.mjs'

// 16번 계획(docs/plan-bundle16-notification-copy.md) 10-1 의 계약 시험. DB 동작은 리허설(5-7, supabase/scripts/bundle16_rehearsal)이 본다.
const ROOT = new URL('../', import.meta.url).pathname
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const MIGRATION = read('supabase/migrations/20261218100000_bundle16_member_notifications.sql')
const DOWN = read('supabase/rollback/20261218100000_bundle16_member_notifications_down.sql')
const CLEANUP = read('supabase/scripts/20261218_bundle16_support_notification_keys_cleanup.sql')
const RESTORE = read('supabase/scripts/20261218_bundle16_support_notification_keys_restore.sql')
const generator = await import('../supabase/scripts/bundle16_rehearsal/generate.mjs')
const stripComments = (source) => source.replace(/--[^\n]*/g, '')

function fnBody(name) {
  const match = MIGRATION.match(new RegExp(`AS \\$fn_${name}\\$([\\s\\S]*?)\\$fn_${name}\\$`))
  assert.ok(match, name)
  return match[1]
}

function sqlArrayItems(text) {
  return [...text.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

function walk(dir, found = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const path = `${dir}/${entry}`
    if (statSync(join(ROOT, path)).isDirectory()) walk(path, found)
    else if (/\.(ts|tsx)$/.test(entry)) found.push(path)
  }
  return found
}

// ─── 공용 보내기 함수 한 곳 ─────────────────────────────────────────────────────────────────────────
test('src 에서 notifications INSERT 는 member-notifications-server.ts 한 곳뿐이다', () => {
  const found = []
  for (const path of walk('src')) {
    if (/\.from\(['"`]notifications['"`]\)\s*\.(insert|upsert)\(/.test(read(path))) found.push(path)
  }
  assert.deepEqual(found, ['src/lib/member-notifications-server.ts'])
})

// ─── 첫 값 = 옛 코드 글, 종류 표 = 마이그레이션 ───────────────────────────────────────────────────────────
test('첫 값은 옛 코드 글 그대로(빈 사유 대체 문구 없음), 마이그레이션 종류 키 = 코드 종류 표', () => {
  const texts = seedMemberNotificationTexts()
  assert.equal(rules.memberNotificationTextsProblem(texts), null)
  assert.equal(rules.validateMemberNotificationTextsInput(texts), null)
  const expected = {
    chargeCompleted: ['크레딧 충전 완료', '결제가 확인되어 크레딧이 충전되었습니다.'],
    chargeRefundCompleted: ['원 결제수단 환불이 완료되었습니다', '{금액}원 결제 취소가 완료되었습니다. 환불 반영 시점은 결제수단에 따라 다를 수 있습니다.'],
    chargeRefundBankTransfer: ['환불이 완료되었습니다', '{금액}원을 계좌로 환불했습니다.'],
    chargeRefundProviderFinalized: ['환불 완료', '결제 취소가 확인되어 환불이 완료되었습니다.'],
    creditGranted: ['크레딧이 지급되었습니다', '{분류} 사유로 {수량} 크레딧이 지급되었습니다. (내용: {내용})'],
    creditRevoked: ['크레딧이 회수되었습니다', '잘못 지급된 크레딧 {수량}개가 회수되었습니다. (사유: {사유})'],
    marketRefundRejected: ['문제마켓 환불 요청이 거절되었습니다', '환불 요청이 승인되지 않았습니다. 사유: {사유}'],
    chargeRefundRejected: ['충전 환불 요청이 거절되었습니다', '환불 요청이 승인되지 않았습니다. 사유: {사유}'],
  }
  for (const [kind, [title, message]] of Object.entries(expected)) {
    assert.equal(texts.kinds[kind].title, title, kind)
    assert.equal(texts.kinds[kind].message, message, kind)
  }
  assert.equal(texts.kinds.marketRefundApproved.title, '문제마켓 환불이 승인되었습니다')
  assert.equal(texts.kinds.marketRefundException.title, '문제마켓 환불이 처리되었습니다')
  assert.deepEqual(texts.kinds.creditGranted.categoryLabels, { compensation: '보상', event: '이벤트', refund: '환불', other: '기타' })
  assert.ok(!MIGRATION.includes('고객지원으로 문의해 주세요'), '마켓 거절 빈 사유 대체 문구 없음(Q2)')
  // 11절 초안
  assert.equal(texts.broadcast.memberLabel, '공지')
  assert.equal(texts.broadcast.redactedText, '개인정보가 포함되어 가린 알림입니다.')
  assert.equal(texts.broadcast.allMembersDailyLimit, 1)
  assert.equal(texts.broadcast.selfTestDailyLimit, 10)
  assert.match(texts.broadcast.notAdvertisingStatement, /새 자료 출시·이벤트·할인·쿠폰·가격 안내가 아니며, 그런 글이나 판매·충전 화면으로 연결하지 않습니다\.$/)
  // 마이그레이션 검사 함수의 목록 = 코드 규칙
  const problem = fnBody('member_notification_texts_problem')
  assert.deepEqual(sqlArrayItems(problem.match(/v_kinds text\[\] := ARRAY\[([\s\S]*?)\];/)[1]), [...rules.MEMBER_NOTIFICATION_KIND_KEYS])
  assert.deepEqual(sqlArrayItems(problem.match(/v_locked text\[\] := ARRAY\[([\s\S]*?)\];/)[1]),
    rules.MEMBER_NOTIFICATION_KIND_KEYS.filter((kind) => !rules.MEMBER_NOTIFICATION_KINDS[kind].canDisable))
  assert.deepEqual(sqlArrayItems(problem.match(/v_title_only text\[\] := ARRAY\[([\s\S]*?)\];/)[1]),
    rules.MEMBER_NOTIFICATION_KIND_KEYS.filter((kind) => rules.MEMBER_NOTIFICATION_KINDS[kind].titleOnly))
  assert.deepEqual(sqlArrayItems(problem.match(/v_categories text\[\] := ARRAY\[([\s\S]*?)\];/)[1]), [...rules.CREDIT_GRANT_CATEGORY_KEYS])
  assert.deepEqual(sqlArrayItems(problem.match(/v_market text\[\] := ARRAY\[([\s\S]*?)\];/)[1]), [...rules.MARKET_REFUND_MESSAGE_KEYS])
  assert.deepEqual(sqlArrayItems(problem.match(/v_broadcast text\[\] := ARRAY\[([\s\S]*?)\];/)[1]), [...rules.BROADCAST_SETTING_KEYS])
  // 길이(코드 = 함수)
  assert.match(problem, new RegExp(`char_length\\(v_text\\) > ${rules.MEMBER_NOTIFICATION_TITLE_MAX} OR v_text ~ '\\[\\\\r\\\\n\\]'`))
  assert.match(problem, new RegExp(`char_length\\(v_text\\) > ${rules.MEMBER_NOTIFICATION_MESSAGE_MAX} OR \\(v_kind = ANY \\(v_locked\\) AND strpos\\(v_text, '\\{사유\\}'\\) = 0\\)`))
  assert.match(problem, new RegExp(`char_length\\(v_text\\) > ${rules.BROADCAST_REDACTED_TEXT_MAX} OR v_text ~ '\\[\\\\r\\\\n\\]' THEN\\s+RETURN 'broadcast\\.redactedText'`))
  assert.match(problem, /'\^\[1-5\]\$'/)
  assert.deepEqual([...rules.BROADCAST_ALL_MEMBERS_LIMIT_RANGE], [1, 5])
  assert.deepEqual([...rules.BROADCAST_SELF_TEST_LIMIT_RANGE], [1, 50])
})

test('끌 수 없는 종류는 셋(Q2: 회수·마켓 거절·충전 환불 거절)이고 내용에 {사유}가 필수, 끌 수 있는지는 코드 규칙', () => {
  const locked = rules.MEMBER_NOTIFICATION_KIND_KEYS.filter((kind) => !rules.MEMBER_NOTIFICATION_KINDS[kind].canDisable)
  assert.deepEqual(locked, ['creditRevoked', 'marketRefundRejected', 'chargeRefundRejected'])
  for (const kind of locked) assert.deepEqual([...rules.MEMBER_NOTIFICATION_KINDS[kind].required], ['{사유}'], kind)
  const texts = seedMemberNotificationTexts()
  assert.equal(rules.memberNotificationTextsProblem({ ...texts, kinds: { ...texts.kinds, creditRevoked: { ...texts.kinds.creditRevoked, enabled: false } } }), 'kinds.creditRevoked.enabled')
  assert.equal(rules.memberNotificationTextsProblem({ ...texts, kinds: { ...texts.kinds, chargeRefundRejected: { ...texts.kinds.chargeRefundRejected, message: '거절했습니다.' } } }), 'kinds.chargeRefundRejected.message')
  const { chargeCompleted, ...withoutOne } = texts.kinds
  void chargeCompleted
  assert.equal(rules.memberNotificationTextsProblem({ ...texts, kinds: withoutOne }), 'kinds')
  assert.equal(rules.memberNotificationTextsProblem({ ...texts, kinds: { ...texts.kinds, extra: { enabled: true, title: 'x', message: 'y' } } }), 'kinds')
  // 허용 밖 자리표시는 저장 전 TS 검사가 막는다(DB 는 보지 않음)
  assert.equal(rules.validateMemberNotificationTextsInput({ ...texts, kinds: { ...texts.kinds, chargeCompleted: { ...texts.kinds.chargeCompleted, message: '{회원이메일}' } } }), 'kinds.chargeCompleted.message')
  assert.equal(rules.validateMemberNotificationTextsInput({ ...texts, marketRefundMessage: { ...texts.marketRefundMessage, unknown: '{수량}' } }), 'marketRefundMessage.unknown')
})

// ─── 그리기 ────────────────────────────────────────────────────────────────────────────────────
test('renderMemberNotification: 채우기·허용 밖·필수 빠짐·값 속 {…}·끌 수 없는 종류의 enabled:false 무시', () => {
  const texts = seedMemberNotificationTexts()
  assert.deepEqual(rules.renderMemberNotification('chargeRefundBankTransfer', texts, { values: { '{금액}': 12000 } }),
    { type: 'success', title: '환불이 완료되었습니다', message: '12,000원을 계좌로 환불했습니다.', link: '/mypage/payments' })
  assert.deepEqual(rules.renderMemberNotification('creditGranted', texts, { categoryKey: 'event', values: { '{수량}': 1500, '{내용}': '가입 이벤트' } }),
    { type: 'info', title: '크레딧이 지급되었습니다', message: '이벤트 사유로 1,500 크레딧이 지급되었습니다. (내용: 가입 이벤트)', link: '/mypage/credits' })
  // 모르는 분류는 other
  assert.match(rules.renderMemberNotification('creditGranted', texts, { categoryKey: 'x', values: { '{수량}': 1, '{내용}': 'a' } }).message, /^기타 사유로/)
  // 값 속 {…}는 다시 풀리지 않는다
  assert.equal(rules.renderMemberNotification('supportAnswerCreated', texts, { values: { '{문의제목}': '{사유} 문의' } }).message.split('\n')[0], '제목: {사유} 문의')
  // 값 없음·빈 사유 → null(보내지 않음)
  assert.equal(rules.renderMemberNotification('chargeRefundRejected', texts, { values: {} }), null)
  assert.equal(rules.renderMemberNotification('chargeRefundRejected', texts, { values: { '{사유}': '  ' } }), null)
  // 허용 밖 자리표시가 DB 에 들어가 있으면 null
  const odd = { ...texts, kinds: { ...texts.kinds, chargeCompleted: { ...texts.kinds.chargeCompleted, message: '{회원이메일}님' } } }
  assert.equal(rules.renderMemberNotification('chargeCompleted', odd, {}), null)
  // 제목 줄바꿈 → null
  const multi = { ...texts, kinds: { ...texts.kinds, chargeCompleted: { ...texts.kinds.chargeCompleted, title: '{없음}' } } }
  assert.equal(rules.renderMemberNotification('chargeCompleted', multi, {}), null)
  // 끌 수 없는 종류: enabled false 를 무시, 끌 수 있는 종류는 꺼짐
  const off = { ...texts, kinds: { ...texts.kinds, creditRevoked: { ...texts.kinds.creditRevoked, enabled: false }, chargeCompleted: { ...texts.kinds.chargeCompleted, enabled: false } } }
  assert.equal(rules.isMemberNotificationEnabled('creditRevoked', off), true)
  assert.equal(rules.isMemberNotificationEnabled('chargeCompleted', off), false)
  // 필수 {사유}가 DB 글에서 빠졌으면(읽을 때 검사) 보내지 않는다
  const noReason = { ...texts, kinds: { ...texts.kinds, creditRevoked: { ...texts.kinds.creditRevoked, message: '회수했습니다.' } } }
  assert.equal(rules.renderMemberNotification('creditRevoked', noReason, { values: { '{수량}': 1, '{사유}': '오지급' } }), null)
  assert.equal(rules.parseMemberNotificationTexts(noReason), null)
})

test('buildMarketRefundMessage = 옛 buildMarketRefundApprovedMessage(8번 시험 묶음의 출력 그대로)', () => {
  const texts = seedMemberNotificationTexts().marketRefundMessage
  const build = (request) => rules.buildMarketRefundMessage(request, texts)
  assert.equal(build({ requested_refund_credits: 300, approved_refund_credits: 300, allocated_items: [] }), '300 크레딧이 돌아왔습니다.')
  assert.equal(build({ requested_refund_credits: 4500, approved_refund_credits: 4000, allocated_items: [{ reissued: 1500 }, { reissued: 0 }] }),
    '4,000 크레딧이 돌아왔습니다. 그중 1,500 크레딧은 새 유효기간으로 다시 지급되었습니다(만료일은 크레딧 관리에서 확인해 주세요). '
    + '나머지 500 크레딧은 결제에 쓴 크레딧의 사정(충전 환불 이력 등)으로 돌려드리지 못했습니다. 자세한 내용은 고객센터로 문의해 주세요.')
  assert.equal(build({ approved_refund_credits: null }), '크레딧 복구 내역은 크레딧 관리에서 확인해 주세요.')
})

test('공용 보내기 함수: 문구를 못 읽으면 texts_unavailable(캐시 안 함), 꺼짐은 disabled, 넣기 실패는 insert_failed — 예외를 던지지 않는다', async () => {
  const inserted = []
  let settings = { data: { value: seedMemberNotificationTexts() }, error: null }
  let insertResult = { error: null }
  const client = {
    from: (table) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => settings }) }),
      insert: async (row) => {
        assert.equal(table, 'notifications')
        inserted.push(row)
        if (insertResult instanceof Error) throw insertResult
        return insertResult
      },
    }),
  }
  const errors = []
  const server = load('src/lib/member-notifications-server.ts', {
    'next/cache': { unstable_cache: (fn) => fn },
    '@/lib/supabase/bypass': { createAdminClient: () => client },
    '@/lib/member-notifications': rules,
  }, errors)
  assert.deepEqual(await server.sendMemberNotification({ kind: 'chargeCompleted', userId: 'member-1' }), { sent: true })
  assert.deepEqual(inserted[0], { user_id: 'member-1', type: 'success', title: '크레딧 충전 완료', message: '결제가 확인되어 크레딧이 충전되었습니다.', link: '/mypage/credits', is_read: false })
  settings = { data: null, error: { code: 'XX' } }
  assert.deepEqual(await server.sendMemberNotification({ kind: 'chargeCompleted', userId: 'member-1' }), { sent: false, reason: 'texts_unavailable' })
  settings = { data: { value: { revision: 1 } }, error: null }
  assert.deepEqual(await server.sendMemberNotification({ kind: 'chargeCompleted', userId: 'member-1' }), { sent: false, reason: 'texts_unavailable' })
  const off = seedMemberNotificationTexts()
  off.kinds.chargeCompleted.enabled = false
  settings = { data: { value: off }, error: null }
  assert.deepEqual(await server.sendMemberNotification({ kind: 'chargeCompleted', userId: 'member-1' }), { sent: false, reason: 'disabled' })
  assert.deepEqual(await server.sendMemberNotification({ kind: 'chargeRefundRejected', userId: 'member-1', values: {} }), { sent: false, reason: 'render_failed' })
  insertResult = { error: { code: '42501' } }
  assert.deepEqual(await server.sendMemberNotification({ kind: 'creditRevoked', userId: 'member-1', values: { '{수량}': 1, '{사유}': 'x' } }), { sent: false, reason: 'insert_failed' })
  insertResult = new Error('network member-1')
  assert.deepEqual(await server.sendMemberNotification({ kind: 'creditRevoked', userId: 'member-1', values: { '{수량}': 1, '{사유}': 'x' } }), { sent: false, reason: 'insert_failed' })
  assert.equal(server.notificationFailed({ sent: false, reason: 'disabled' }), false)
  assert.equal(server.notificationFailed({ sent: false, reason: 'insert_failed' }), true)
  assert.doesNotMatch(JSON.stringify(errors), /member-1/)
  const source = read('src/lib/member-notifications-server.ts')
  assert.match(source, /unstable_cache\(readTextsRow, \[MEMBER_NOTIFICATION_TEXTS_SETTING_KEY\], \{\s*revalidate: MEMBER_NOTIFICATION_TEXTS_CACHE_SECONDS,\s*tags: \[MEMBER_NOTIFICATION_TEXTS_CACHE_TAG\],/)
  assert.equal(rules.MEMBER_NOTIFICATION_TEXTS_CACHE_SECONDS, 60)
})

// ─── 충전 환불 거절(Q7, 5-8) ────────────────────────────────────────────────────────────────────
class RefundRpcError extends Error {
  constructor({ message }) {
    super(message)
    this.code = message
  }
}

function loadRefundRoute({ reject = async () => ({ userId: 'member-1', memberReason: '요건 아님' }), insert = async () => ({ error: null }), complete } = {}) {
  const calls = { reject: [], notifications: [], sent: [] }
  const server = memberNotificationsServer({ insert: async (row) => (calls.notifications.push(row), insert(row)), sent: calls.sent })
  const route = load('src/app/api/admin/refunds/route.ts', {
    'next/server': { NextResponse },
    ...adminGuardMocks({ userId: 'admin-1' }),
    '@/lib/payment-orders-server': { createPaymentAdminClient: () => ({}) },
    '@/lib/point-charge-refund-processor': { PointChargeRefundProcessingError: class extends Error {}, processPointChargeRefund: async () => ({}) },
    '@/lib/point-charge-refunds-server': {
      RefundRpcError,
      completeManualPointChargeRefund: complete ?? (async () => ({ user_id: 'member-1' })),
      rejectPointChargeRefund: async (input) => {
        calls.reject.push(input)
        return reject(input)
      },
    },
    '@/lib/withdrawn-member-redaction-server': { markWithdrawnRows: async (rows) => rows },
    '@/lib/admin-member-access-log-server': { recordMemberAccess: async () => true },
    '@/lib/admin-request-meta': load('src/lib/admin-request-meta.ts'),
    '@/lib/member-notifications-server': server,
    '@/lib/member-notifications': rules,
    '@/lib/member-facing-text-pii': load('src/lib/member-facing-text-pii.ts'),
    '@/lib/site-board-server': { readPiiAllowedContacts: async () => ({ customerCenter: '1588-0000', orderEmail: 'help@company.example' }) },
  })
  const patch = async (body) => {
    const response = await route.PATCH({ json: async () => ({ requestId: '00000000-0000-4000-8000-000000000001', ...body }) })
    return { status: response.status, body: await response.json() }
  }
  return { patch, calls }
}

test('충전 환불 거절: 사유 없음·개인정보·긴 숫자 → 400·함수 0번, 성공 → 사유로 알림 1번(처리 메모는 알림에 없음)', async () => {
  for (const [memberReason, code] of [[undefined, 'REFUND_REJECT_MEMBER_REASON_REQUIRED'], ['   ', 'REFUND_REJECT_MEMBER_REASON_REQUIRED'],
    ['문의는 010-0000-1111 로', 'REFUND_REJECT_MEMBER_REASON_PII'], ['계좌 123-456-789012 로 보냈습니다', 'REFUND_REJECT_MEMBER_REASON_LONG_NUMBER']]) {
    const world = loadRefundRoute()
    const result = await world.patch({ action: 'reject', adminNote: '내부 메모', memberReason })
    assert.equal(result.status, 400, String(memberReason))
    assert.equal(result.body.code, code)
    assert.equal(world.calls.reject.length, 0)
    assert.equal(world.calls.notifications.length, 0)
  }
  const ok = loadRefundRoute({ reject: async (input) => ({ userId: 'member-1', memberReason: input.memberReason }) })
  const result = await ok.patch({ action: 'reject', adminNote: '결제사 미취소 확인 메모', memberReason: ' 이미 사용한 크레딧이 있습니다. ' })
  assert.equal(result.status, 200)
  assert.equal(result.body.notificationFailed, false)
  assert.equal('memberReason' in result.body, false)
  assert.deepEqual(ok.calls.reject[0], { requestId: '00000000-0000-4000-8000-000000000001', adminId: 'admin-1', adminNote: '결제사 미취소 확인 메모',
    providerNotCancelledConfirmed: false, memberReason: '이미 사용한 크레딧이 있습니다.' })
  assert.deepEqual(ok.calls.sent, [{ kind: 'chargeRefundRejected', userId: 'member-1', values: { '{사유}': '이미 사용한 크레딧이 있습니다.' } }])
  assert.equal(ok.calls.notifications[0].message, '환불 요청이 승인되지 않았습니다. 사유: 이미 사용한 크레딧이 있습니다.')
  assert.equal(ok.calls.notifications[0].link, '/mypage/payments')
  assert.doesNotMatch(JSON.stringify(ok.calls.notifications), /결제사 미취소 확인 메모/)
})

test('충전 환불 거절: 재요청(NOT_REJECTABLE)·사유 검사 → 알림 0번, 검사 함수 오류 → 503·알림 0번, 알림 실패 → 저장된 사유를 응답에', async () => {
  for (const [message, status] of [['REFUND_REQUEST_NOT_REJECTABLE', 409], ['REFUND_REJECT_MEMBER_REASON_PII', 400], ['REFUND_REJECT_MEMBER_REASON_LONG_NUMBER', 400],
    ['boom: function member_facing_text_pii_hits failed', 503]]) {
    const world = loadRefundRoute({ reject: async () => { throw new RefundRpcError({ message }) } })
    const result = await world.patch({ action: 'reject', memberReason: '요건 아님' })
    assert.equal(result.status, status, message)
    assert.equal(world.calls.notifications.length, 0)
    assert.equal(world.calls.sent.length, 0)
  }
  const failing = loadRefundRoute({ insert: async () => ({ error: { code: '42501' } }) })
  const result = await failing.patch({ action: 'reject', memberReason: '요건 아님' })
  assert.equal(result.status, 200)
  assert.equal(result.body.notificationFailed, true)
  assert.equal(result.body.memberReason, '요건 아님')
  // 알림·실패 안내에는 DB 가 저장한(다듬은) 사유를 쓴다
  const normalized = loadRefundRoute({ reject: async () => ({ userId: 'member-1', memberReason: '줄\n바꿈' }), insert: async () => ({ error: { code: '42501' } }) })
  const normalizedResult = await normalized.patch({ action: 'reject', memberReason: '줄\r\n바꿈' })
  assert.deepEqual(normalized.calls.sent[0].values, { '{사유}': '줄\n바꿈' })
  assert.equal(normalizedResult.body.memberReason, '줄\n바꿈')
  // 거절은 커밋됐는데 회원 id 를 돌려받지 못하면 실패로 안내하지 않는다(거절됨·알림 못 보냄)
  const noUser = loadRefundRoute({ reject: async () => ({ userId: null, memberReason: '요건 아님' }) })
  const noUserResult = await noUser.patch({ action: 'reject', memberReason: '요건 아님' })
  assert.equal(noUserResult.status, 200)
  assert.equal(noUserResult.body.success, true)
  assert.equal(noUserResult.body.notificationFailed, true)
  assert.equal(noUser.calls.sent.length, 0)
  const wrapper = read('src/lib/point-charge-refunds-server.ts')
  assert.doesNotMatch(wrapper, /REFUND_REJECT_RESULT_INVALID/)
  assert.match(wrapper, /memberReason: typeof result\?\.member_reject_reason === 'string' \? result\.member_reject_reason : input\.memberReason,/)
})

test('마켓 환불: 정산 뒤 행을 못 읽으면 notificationFailed true, 자동 거절(TARGET_CHANGED) 409 에도 notificationFailed, 화면이 읽는다', () => {
  const route = read('src/app/api/admin/market/refunds/[id]/route.ts')
  assert.match(route, /const settledNotificationFailed = settled \? await notifyMarketRefundProcessed\('approve', settled\) : true/)
  assert.match(route, /const rejectedNotificationFailed = !rejected \? true : rejected\.status === 'rejected' \? await notifyMarketRefundProcessed\('reject', rejected\) : false\n\s+return NextResponse\.json\(\{ success: false, error: error\.message, code: error\.code, details: error\.details, notificationFailed: rejectedNotificationFailed \}, \{ status: 409 \}\)/)
  const client = read('src/app/(admin)/admin/refunds/market-refunds-client.tsx')
  assert.equal([...client.matchAll(/if \(result\?\.notificationFailed\) toast\.warning\(MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE\)/g)].length, 2)
  // 보낸 기록 읽은 수는 한 번에(기록마다 따로 세지 않음)
  const history = read('src/lib/member-broadcast-server.ts')
  assert.match(history, /\.in\('broadcast_id', openIds\)/)
  assert.doesNotMatch(history, /\.eq\('broadcast_id', row\.id\)/)
})

test('충전 환불 완료 알림이 실패해도 결과는 그대로(notificationFailed), 이미 완료된 요청은 알림 0번', async () => {
  const world = loadRefundRoute({ insert: async () => ({ error: { code: '42501' } }) })
  const body = { action: 'complete_manual', adminNote: '메모', externalMethod: 'bank_transfer', refundAmount: 9900, recoveredCredits: 0 }
  const result = await world.patch(body)
  assert.equal(result.status, 200)
  assert.equal(result.body.notificationFailed, true)
  assert.deepEqual(world.calls.sent, [{ kind: 'chargeRefundBankTransfer', userId: 'member-1', values: { '{금액}': 9900 } }])
  const done = loadRefundRoute({ complete: async () => ({ user_id: 'member-1', already_completed: true }) })
  assert.equal((await done.patch(body)).body.notificationFailed, false)
  assert.equal(done.calls.sent.length, 0)
})

test('새 코드는 5인자 거절만 부르고(4인자 호출 없음), 새 서명은 DEFAULT 없이 service_role 만', () => {
  const server = read('src/lib/point-charge-refunds-server.ts')
  const call = server.slice(server.indexOf("callRefundRpc<{ user_id?: string; member_reject_reason?: string } | null>('reject_point_charge_refund'"))
  assert.match(call.slice(0, 400), /p_member_reason: input\.memberReason,/)
  assert.equal([...server.matchAll(/'reject_point_charge_refund'/g)].length, 2) // 이름 목록 1 + 호출 1
  const types = read('src/types/supabase.ts')
  assert.match(types, /reject_point_charge_refund: \{\s+Args: \{\s+p_admin_id: string\s+p_admin_note: string\s+p_member_reason: string\s+p_provider_not_cancelled_confirmed: boolean\s+p_request_id: string\s+\}\s+Returns: Json/)
  const signature = MIGRATION.match(/CREATE FUNCTION public\.reject_point_charge_refund\(([\s\S]*?)\)\n RETURNS jsonb/)[1]
  assert.doesNotMatch(signature, /DEFAULT/i)
  assert.match(signature, /p_member_reason text$/)
  assert.match(MIGRATION, /REVOKE ALL ON FUNCTION public\.reject_point_charge_refund\(uuid, uuid, text, boolean, text\) FROM PUBLIC, anon, authenticated, service_role;/)
  assert.match(MIGRATION, /GRANT EXECUTE ON FUNCTION public\.reject_point_charge_refund\(uuid, uuid, text, boolean, text\) TO service_role;/)
  assert.match(MIGRATION, /pronargdefaults FROM pg_proc p WHERE p\.oid = 'public\.reject_point_charge_refund\(uuid,uuid,text,boolean,text\)'::regprocedure\) <> 0/)
})

test('새 거절 함수: 빈 사유·개인정보·긴 숫자 거절, 보통 거절 처리 기록 note 는 상수 표지(회원 사유·메모 변수 없음), action CHECK 에 refund_rejected', () => {
  const body = fnBody('reject_point_charge_refund_v16')
  assert.match(body, /c_rejected_note constant text := 'refund_rejected';/)
  assert.match(body, /IF p_admin_id IS NULL THEN\s+RAISE EXCEPTION 'REFUND_REJECT_ACTOR_REQUIRED';/)
  assert.match(body, /IF v_reason = '' OR char_length\(v_reason\) > 300 THEN\s+RAISE EXCEPTION 'REFUND_REJECT_MEMBER_REASON_REQUIRED';/)
  assert.match(body, /cardinality\(public\.member_facing_text_pii_hits\(v_reason\)\) > 0 THEN\s+RAISE EXCEPTION 'REFUND_REJECT_MEMBER_REASON_PII';/)
  assert.match(body, /public\.member_text_has_long_number\(v_reason\) THEN\s+RAISE EXCEPTION 'REFUND_REJECT_MEMBER_REASON_LONG_NUMBER';/)
  assert.match(body, /member_reject_reason = v_reason,/)
  const normal = body.slice(body.indexOf("'refund_rejected',"), body.indexOf('END IF;', body.indexOf("'refund_rejected',")))
  assert.match(normal, /c_rejected_note,\s+jsonb_build_object\('member_reason_length', char_length\(v_reason\), 'admin_note_present', NULLIF\(BTRIM\(p_admin_note\), ''\) IS NOT NULL\)/)
  assert.doesNotMatch(normal.replace(/char_length\(v_reason\)|NULLIF\(BTRIM\(p_admin_note\), ''\)/g, ''), /v_reason|p_admin_note|p_member_reason/)
  assert.match(body, /'manual_review_refund_rejected',[\s\S]*?p_admin_note,\s+jsonb_build_object\('provider_not_cancelled_confirmed', true, 'last_error_code', v_request\.last_error_code,\s+'member_reason_length', char_length\(v_reason\)\)/)
  assert.match(body, /RETURN jsonb_build_object\('user_id', v_request\.user_id, 'member_reject_reason', v_reason\);/)
  // 돈 흐름은 옛 함수 그대로(결제사 취소 흔적이면 거절 불가, 크레딧 동결 해제)
  const old = RESTORE.match(/\$old_reject\$([\s\S]*?)\$old_reject\$/)[1]
  for (const line of ["OR v_order.canceled_at IS NOT NULL", "OR v_ppt.cancel_feedback_recorded_at IS NOT NULL", "SET status = 'active'", "AND status = 'pending_refund';"]) {
    assert.ok(old.includes(line) && body.includes(line), line)
  }
  const check = MIGRATION.match(/ADD CONSTRAINT payment_admin_actions_action_check\s+CHECK \(action = ANY \(ARRAY\[([^\]]+)\]\)\)/)[1]
  assert.deepEqual([...check.matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]).sort(),
    ['alert_resolved', 'cancel_handled', 'manual_refund_completed', 'manual_review_refund_rejected', 'paid_confirmed', 'refund_rejected', 'unpaid_confirmed', 'withdrawn_held_order_closed'])
  const { PAYMENT_ADMIN_ACTION_LABELS } = load('src/lib/admin-orders.ts')
  assert.equal(PAYMENT_ADMIN_ACTION_LABELS.refund_rejected, '충전 환불 거절')
})

test('탈퇴 가림: facts·redact·패널·가림 route enum 에 member_reject_reason, 재정의 본문 지문 = 사전 점검·VERIFY 상수, down 은 되돌리지 않음', () => {
  const facts = MIGRATION.slice(MIGRATION.indexOf('CREATE OR REPLACE FUNCTION public.member_withdrawal_facts('))
  assert.match(facts, /OR public\.member_text_has_long_number\(rr\.member_reject_reason\)\) -- \[16번\]/)
  assert.match(MIGRATION, /OR \(p_target_kind = 'refund_request' AND p_field IN \('reason', 'admin_note', 'member_reject_reason'\)\) -- \[16번\]/)
  assert.match(read('src/app/(admin)/admin/users/[id]/member-withdrawal-panel.tsx'), /refund_request: \[\['reason', '사유'\], \['admin_note', '메모'\], \['member_reject_reason', '회원에게 보낸 거절 사유'\]\]/)
  assert.match(read('src/app/api/admin/users/[id]/withdrawal/route.ts'), /field: z\.enum\(\[[^\]]*'member_reject_reason'\]\)/)
  for (const name of ['member_withdrawal_facts', 'redact_member_text']) {
    const md5 = generator.bodyMd5(name)
    assert.equal(MIGRATION.split(md5).length - 1, 2, `${name}: 사전 점검·VERIFY 에 같은 본문 지문`)
  }
  // 13번 뒤 판 지문(13번 계획 18-4)도 받는다(다시 적용 때는 16번 판)
  assert.match(MIGRATION, /= '05923c4df814d40b6ec81d1d53d410aa'/)
  assert.match(MIGRATION, /= '47173300ae0fa1a96cb1d45faa6da353'/)
  // 13번 판과 바뀐 곳은 [16번] 줄뿐
  const m1 = read('supabase/migrations/20261217110000_bundle13_cs_tools.sql')
  const body13 = (name, sql) => { const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`); const a = sql.indexOf('$function$', i) + 10; return sql.slice(a, sql.indexOf('$function$', a)) }
  for (const name of ['member_withdrawal_facts', 'redact_member_text']) {
    const before = body13(name, m1).split('\n')
    const after = body13(name, MIGRATION).split('\n')
    const added = after.filter((line) => !before.includes(line))
    assert.ok(added.length >= 1 && added.length <= 2 && added.some((line) => line.includes('-- [16번]')), name)
  }
  assert.doesNotMatch(stripComments(DOWN), /FUNCTION public\.member_withdrawal_facts|FUNCTION public\.redact_member_text|DROP CONSTRAINT payment_admin_actions_action_check|DROP COLUMN member_reject_reason/)
  // 탈퇴 회원 목록은 새 칸도 가린다
  assert.match(read('src/app/api/admin/refunds/route.ts'), /\(\{ \.\.\.row, reason: null, admin_note: null, member_reject_reason: null \}\)/)
  assert.match(read('src/app/(admin)/admin/refunds/page.tsx'), /\(\{ \.\.\.row, reason: null, admin_note: null, member_reject_reason: null \}\)/)
})

// ─── 실패 알림 칸(6절 표) ──────────────────────────────────────────────────────────────────────────
test('관리자 화면 경로는 모두 notificationFailed 한 칸으로 실패를 알리고, 화면이 그 칸을 읽는다', () => {
  const routes = [
    'src/app/api/admin/support/tickets/[id]/route.ts', 'src/app/api/admin/users/credits/route.ts', 'src/app/api/admin/users/credits/revoke/route.ts',
    'src/app/api/admin/market/refunds/[id]/route.ts', 'src/app/api/admin/market/orders/[id]/exception-refund/route.ts',
    'src/app/api/admin/payments/review/route.ts', 'src/app/api/admin/refunds/route.ts',
  ]
  for (const path of routes) {
    const source = read(path)
    assert.match(source, /notificationFailed/, path)
    assert.match(source, /sendMemberNotification\(/, path)
    assert.doesNotMatch(source, /\bnotified\b/, path)
  }
  const screens = {
    'src/app/(admin)/admin/support/support-client.tsx': /result\.notificationFailed/,
    'src/app/(admin)/admin/credits/grant-credit-dialog.tsx': /data\.notificationFailed\) toast\.warning\(MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE\)/,
    'src/app/(admin)/admin/users/[id]/revoke-credit-button.tsx': /result\.notificationFailed/,
    'src/app/(admin)/admin/refunds/market-refunds-client.tsx': /result\.notificationFailed\) toast\.warning\(MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE\)/,
    'src/app/(admin)/admin/orders/market-exception-refund-dialog.tsx': /result\.notificationFailed\) toast\.warning\(MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE\)/,
    'src/app/(admin)/admin/refunds/refunds-client.tsx': /data\.notificationFailed/,
    'src/app/(admin)/admin/refunds/payment-review-client.tsx': /data\.notificationFailed\) toast\.warning\(MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE\)/,
  }
  for (const [path, pattern] of Object.entries(screens)) assert.match(read(path), pattern, path)
  assert.equal(rules.MEMBER_NOTIFICATION_FAILED_ADMIN_MESSAGE, '회원 알림을 보내지 못했습니다. 고객지원으로 직접 알려 주세요.')
  // 충전 환불 거절 창: 회원용 사유 칸(처리 메모와 따로)·긴 숫자 안내·실패 때 저장된 사유를 보여 줌
  const refunds = read('src/app/(admin)/admin/refunds/refunds-client.tsx')
  assert.match(refunds, /회원에게 보낼 거절 사유 \(필수 — 회원에게 그대로 안내됩니다\)/)
  assert.match(refunds, /계좌번호·카드번호 같은 숫자는 적지 마세요/)
  assert.match(refunds, /setUnsentReason\(data\.memberReason\)/)
  assert.match(refunds, /\.\.\.\(processAction === 'reject' \? \{ memberReason: memberReasonText \} : \{\}\)/)
})

// ─── 공지 알림 링크·보내기 함수 ──────────────────────────────────────────────────────────────────────
test('링크 허용 꼴: 코드 목록 = 함수 목록(쿼리·그 밖의 # 없음, 판매·충전 화면 없음)', () => {
  const send = fnBody('send_member_broadcast')
  const fixed = sqlArrayItems(send.match(/v_link IN \(([^)]*)\)/)[1])
  assert.deepEqual(fixed, [...rules.BROADCAST_FIXED_LINKS])
  assert.match(send, /v_link ~ \('\^\/notices\/' \|\| c_uuid \|\| '\$'\) AND p_post_id IS NOT NULL/)
  assert.match(send, /v_link ~ \('\^\/faq#' \|\| c_uuid \|\| '\$'\)/)
  assert.match(send, /v_link ~ '\^\/terms\/\[a-z0-9\]\[a-z0-9-\]\{0,49\}\$'/)
  assert.match(send, /d\.value -> 'enabled' = 'true'::jsonb AND btrim\(COALESCE\(d\.value ->> 'content', ''\)\) <> ''/)
  const slugs = ['refund', 'service', 'privacy']
  for (const link of generator.LINK_EXAMPLES.rejected) assert.equal(rules.isAllowedBroadcastLink(link, null, slugs), false, link)
  for (const link of generator.LINK_EXAMPLES.accepted) assert.equal(rules.isAllowedBroadcastLink(link, null, slugs), true, String(link))
  assert.equal(rules.isAllowedBroadcastLink('/terms/refund', null, slugs), true)
  const id = '00000000-0000-4000-8000-000000000009'
  assert.equal(rules.isAllowedBroadcastLink(`/notices/${id}`, id, slugs), true)
  assert.equal(rules.isAllowedBroadcastLink(`/notices/${id}`, null, slugs), false)
  assert.equal(rules.isAllowedBroadcastLink('/notices', id, slugs), false)
})

test('보내기 함수: 대표·경계 판 → 입력 → 잠금 → 재요청 → 상한 → 받는 사람 한 번 뽑기 → 기록 행 → 알림 → 작업 기록(원문·회원 id 없음)', () => {
  const send = fnBody('send_member_broadcast')
  const order = ["RAISE EXCEPTION 'BROADCAST_ACTOR_NOT_OWNER'", "RAISE EXCEPTION 'BROADCAST_CONFIRM_REQUIRED'", "RAISE EXCEPTION 'BROADCAST_INPUT_INVALID:title'",
    "RAISE EXCEPTION 'BROADCAST_PII_SUSPECTED:%'", "PERFORM pg_advisory_xact_lock(hashtext('member_broadcast'));", "WHERE b.operation_key = p_operation_key",
    "RAISE EXCEPTION 'BROADCAST_RATE_LIMITED:%'", 'v_recipients := ARRAY(SELECT r FROM public.member_broadcast_recipients(p_target, p_actor_id) r);',
    "RAISE EXCEPTION 'BROADCAST_COUNT_CHANGED:%', v_count;", 'INSERT INTO public.member_notification_broadcasts', 'INSERT INTO public.notifications',
    "PERFORM public.record_admin_audit(p_actor_id, 'member_broadcast_send'"]
  let at = -1
  for (const marker of order) {
    const next = send.indexOf(marker)
    assert.ok(next > at, `순서: ${marker}`)
    at = next
  }
  assert.equal([...send.matchAll(/member_broadcast_recipients\(/g)].length, 1, '받는 사람은 한 번만 뽑는다')
  assert.match(send, /SELECT r, 'announcement', v_title, v_message, v_link, false, v_id FROM unnest\(v_recipients\) r;/)
  assert.match(send, /IF v_inserted <> v_count THEN\s+RAISE EXCEPTION 'BROADCAST_COUNT_CHANGED:%', v_inserted;/)
  const audit = send.slice(send.indexOf("'member_broadcast_send'"))
  const details = audit.slice(audit.indexOf('jsonb_build_object('), audit.indexOf('p_operation_key::text'))
  const keys = [...details.matchAll(/'([a-z_0-9]+)', /g)].map((match) => match[1]).sort()
  assert.deepEqual(keys, generator.AUDIT_DETAIL_KEYS.member_broadcast_send)
  assert.doesNotMatch(details, /'title', |'message', |user_id|v_recipients/)
  assert.match(send, /not_advertising_statement_text, created_at\)\s+VALUES \(p_operation_key, p_actor_id, p_target, v_title, v_message, v_link, p_post_id, v_sha, v_count, v_version, v_statement, v_now\)/)
  const retract = fnBody('retract_member_broadcast')
  assert.ok(retract.indexOf('count(*) FILTER (WHERE n.is_read IS TRUE)') < retract.indexOf('DELETE FROM public.notifications n WHERE n.broadcast_id = v_old.id;'), '읽은 수를 센 뒤 지운다')
  assert.match(retract, /IF p_redact IS NULL OR \(p_reason_code = 'pii' AND NOT p_redact\) THEN/)
  assert.deepEqual([...rules.BROADCAST_RETRACT_REASON_CODES], sqlArrayItems(retract.match(/p_reason_code NOT IN \(([^)]*)\)/)[1]))
  const retractAudit = retract.slice(retract.indexOf("'member_broadcast_retract'"))
  const retractDetails = retractAudit.slice(retractAudit.indexOf('jsonb_build_object('), retractAudit.indexOf('NULL);'))
  assert.deepEqual([...retractDetails.matchAll(/'([a-z_0-9]+)', /g)].map((match) => match[1]).sort(), generator.AUDIT_DETAIL_KEYS.member_broadcast_retract)
})

// ─── 마이그레이션 구조 ──────────────────────────────────────────────────────────────────────────────
test('마이그레이션: 사전 점검(이미 있음 경로)·복사 대조·RESTRICTIVE 정책(별도 VERIFY)·lock_timeout·가드·권한 회수·기존 표 DDL 한 구역', () => {
  assert.match(MIGRATION, /^SET LOCAL lock_timeout = '3s';\nSET LOCAL statement_timeout = '60s';/m)
  assert.match(MIGRATION, /md5\(pg_get_functiondef\(to_regprocedure\('public\.record_admin_audit\(uuid,text,text,text,uuid,integer,text,jsonb,text\)'\)\)\)\s+<> 'a42b474d9d95753ffba5041acb0c1c77'/)
  assert.match(MIGRATION, /md5\(pg_get_functiondef\('public\.reject_point_charge_refund\(uuid,uuid,text,boolean\)'::regprocedure\)\) <> '20384719deba112e977fbd3bf8e266e5'/)
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS public\.member_notification_broadcasts/)
  assert.match(MIGRATION, /ADD CONSTRAINT member_notification_broadcasts_post_id_fkey\s+FOREIGN KEY \(post_id\) REFERENCES public\.site_board_posts\(id\) NOT VALID;/)
  assert.match(MIGRATION, /AND NOT EXISTS \(SELECT 1 FROM public\.system_settings x WHERE x\.key = 'member_notification_texts'\);/)
  assert.match(MIGRATION, /DO \$copy_check_bundle16_member_notifications\$[\s\S]*?differs from member_notification_texts/)
  assert.match(MIGRATION, /CREATE POLICY system_settings_member_notification_texts_no_client_write ON public\.system_settings\s+AS RESTRICTIVE FOR UPDATE\s+USING \(key <> 'member_notification_texts'\)\s+WITH CHECK \(key <> 'member_notification_texts'\);/)
  assert.match(MIGRATION, /DO \$verify_bundle16_settings_policy\$/)
  assert.match(MIGRATION, /REVOKE ALL ON TABLE public\.member_notification_broadcasts FROM PUBLIC, anon, authenticated, service_role;\nGRANT SELECT ON TABLE public\.member_notification_broadcasts TO service_role;/)
  for (const signature of ['member_broadcast_recipients(text, uuid)', 'member_broadcast_preview(uuid, text)', 'save_member_notification_texts(uuid, integer, jsonb, jsonb)',
    'send_member_broadcast(uuid, uuid, text, text, text, text, uuid, integer, integer, jsonb)', 'retract_member_broadcast(uuid, uuid, text, boolean, jsonb)']) {
    assert.ok(MIGRATION.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated, service_role;`), signature)
    assert.ok(MIGRATION.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`), signature)
  }
  // 미리보기는 clock_timestamp() 를 쓰므로 VOLATILE(STABLE 아님)
  assert.doesNotMatch(MIGRATION.match(/CREATE FUNCTION public\.member_broadcast_preview\([\s\S]*?AS \$fn_member_broadcast_preview\$/)[0], /STABLE/)
  // 잠금 순서: 기존 표 DDL 구역 첫 문장에서 system_settings 부터 한 번에
  assert.match(MIGRATION, /-- 6\. \[16번 기존 표 DDL\] 시작[^\n]*\n(?:--[^\n]*\n)*LOCK TABLE public\.system_settings, public\.refund_requests, public\.payment_admin_actions, public\.notifications IN ACCESS EXCLUSIVE MODE;\n/)
  // 다시 적용 VERIFY: 기록 표 칸 형식·제약 정의 지문(리허설 측정값)
  assert.match(MIGRATION, /IS DISTINCT FROM '985ff2dca6ab17691f3f8e89053a1606'/)
  assert.match(MIGRATION, /IS DISTINCT FROM 'c5cb1756014c1e41811acb07642ffc7d'/)
  // 받는 사람 함수만 INVOKER
  const recipients = MIGRATION.match(/CREATE FUNCTION public\.member_broadcast_recipients\([\s\S]*?AS \$fn_member_broadcast_recipients\$/)[0]
  assert.doesNotMatch(recipients, /SECURITY DEFINER/)
  // 기존 표에 거는 DDL 은 '[16번 기존 표 DDL]' 한 구역에만
  const section = MIGRATION.slice(MIGRATION.indexOf('-- 6. [16번 기존 표 DDL] 시작'), MIGRATION.indexOf('-- [16번 기존 표 DDL] 끝'))
  const outside = stripComments(MIGRATION.replace(section, ''))
  for (const table of ['refund_requests', 'payment_admin_actions', 'notifications', 'system_settings']) {
    assert.doesNotMatch(outside, new RegExp(`ALTER TABLE public\\.${table}\\b`), table)
  }
  assert.doesNotMatch(outside, /CREATE POLICY/)
  assert.match(section, /ALTER TABLE public\.notifications ADD COLUMN broadcast_id uuid NULL REFERENCES public\.member_notification_broadcasts\(id\);/)
  assert.match(section, /CREATE INDEX notifications_broadcast_id ON public\.notifications \(broadcast_id\) WHERE broadcast_id IS NOT NULL;/)
  assert.match(section, /ADD CONSTRAINT refund_requests_member_reject_reason_check\s+CHECK \(member_reject_reason IS NULL OR btrim\(member_reject_reason\) <> ''\);/)
  // 가드: 회수 칸 NULL→값, 가림 문구로만, DELETE·TRUNCATE 거부
  const guard = fnBody('guard_member_notification_broadcasts_mutation')
  assert.match(guard, /OLD\.retracted_at IS NULL AND NEW\.retracted_at IS NOT NULL/)
  assert.match(guard, /NEW\.title = v_redacted_text AND NEW\.message = v_redacted_text/)
  assert.match(MIGRATION, /BEFORE UPDATE OR DELETE ON public\.member_notification_broadcasts/)
  assert.match(MIGRATION, /BEFORE TRUNCATE ON public\.member_notification_broadcasts/)
  // 기록 표에는 회원을 가리키는 칸이 없다
  const table = MIGRATION.match(/CREATE TABLE IF NOT EXISTS public\.member_notification_broadcasts \(([\s\S]*?)\n\);/)[1]
  assert.doesNotMatch(table, /user_id|member_id|recipient_ids/)
  assert.match(table, /not_advertising_statement_text text NOT NULL/)
  // 문구 저장 기록: 바뀐 경로 before·after, 경계 문장 판·원문
  const save = fnBody('save_member_notification_texts')
  assert.match(save, /'statement_before', CASE WHEN v_statement_changed THEN v_old #>> '\{broadcast,notAdvertisingStatement\}' END,/)
  assert.match(save, /v_new_version := v_old_version \+ CASE WHEN v_statement_changed THEN 1 ELSE 0 END;/)
  assert.match(save, /unnest\(public\.member_facing_text_pii_hits\(s #>> '\{\}'\)\) h;/)
})

test('되돌리기: down 첫머리에 옛 4인자 확인, 함수 5개·broadcast_id·post_id FK·새 서명만 지우고 기록 표·정책·칸·CHECK·확장은 남김', () => {
  const code = stripComments(DOWN)
  const precheck = code.slice(0, code.indexOf('$precheck_bundle16_member_notifications_down$;'))
  assert.match(precheck, /to_regprocedure\('public\.reject_point_charge_refund\(uuid,uuid,text,boolean\)'\) IS NULL/)
  assert.match(precheck, /IS DISTINCT FROM '\{postgres=X\/postgres,service_role=X\/postgres\}'/)
  assert.ok(code.indexOf('$precheck_bundle16_member_notifications_down$') < code.indexOf('DROP FUNCTION'))
  // 회수하지 않은 공지 알림이 남아 있으면 멈춘다(칸을 지우면 다시 적용해도 회수할 수 없다)
  assert.match(precheck, /WHERE b\.retracted_at IS NULL\s+AND EXISTS \(SELECT 1 FROM public\.notifications n WHERE n\.broadcast_id = b\.id\)\) THEN\s+RAISE EXCEPTION 'DOWN PRECHECK: unretracted broadcast notifications remain/)
  assert.match(code, /ALTER TABLE public\.notifications DROP COLUMN broadcast_id;/)
  assert.match(code, /ALTER TABLE public\.member_notification_broadcasts DROP CONSTRAINT member_notification_broadcasts_post_id_fkey;/)
  assert.match(code, /DROP FUNCTION public\.reject_point_charge_refund\(uuid, uuid, text, boolean, text\);/)
  assert.doesNotMatch(code, /DROP TABLE|DROP POLICY|DELETE FROM public\.system_settings|DROP TRIGGER/)
  // 14번 down 이 찾는 16번 함수 이름이 이 down 에서 모두 지워진다
  const b14Down = read('supabase/rollback/20261217140000_bundle14_site_board_down.sql')
  for (const name of sqlArrayItems(b14Down.match(/v_bundle16_functions text\[\] := ARRAY\[([^\]]+)\]/)[1])) {
    assert.match(code, new RegExp(`DROP FUNCTION public\\.${name}\\(`), name)
  }
})

test('정리·되살리기 스크립트: 대응표 같음, 같음 → 지움·다름 → 멈춤·없음 → 넘어감, 옛 4인자 삭제 전 5인자 권한 확인, 되살리기는 권한 회수·지문 확인', () => {
  const pairs = (sql) => [...sql.matchAll(/ARRAY\['(\{[a-zA-Z,]+\})', '(\{[a-zA-Z,]+\})'\]/g)].map((match) => [match[1], match[2]])
  const copy = pairs(MIGRATION)
  assert.equal(copy.length, 5)
  assert.deepEqual(pairs(CLEANUP), copy)
  assert.deepEqual(pairs(RESTORE), copy)
  assert.match(CLEANUP, /IF v_support #> v_pair\[1\]::text\[\] IS NULL THEN\s+CONTINUE;/)
  assert.match(CLEANUP, /RAISE EXCEPTION 'KEYS_CLEANUP: support_page_content % differs/)
  assert.match(CLEANUP, /'bundle', 'bundle16_support_keys_cleanup'/)
  assert.ok(CLEANUP.indexOf("IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'") < CLEANUP.indexOf('DROP FUNCTION public.reject_point_charge_refund(uuid, uuid, text, boolean);'))
  assert.match(RESTORE, /REVOKE EXECUTE ON FUNCTION public\.reject_point_charge_refund\(uuid, uuid, text, boolean\) FROM PUBLIC, anon, authenticated;\s+GRANT EXECUTE ON FUNCTION public\.reject_point_charge_refund\(uuid, uuid, text, boolean\) TO service_role;/)
  assert.match(RESTORE, /<> '20384719deba112e977fbd3bf8e266e5'/)
  for (const sql of [CLEANUP, RESTORE]) {
    assert.equal(sql.split('\nBEGIN;\n').length - 1, 1)
    assert.match(sql, /\nCOMMIT;\n$/)
    assert.match(sql, /SET LOCAL lock_timeout = '3s';/)
    assert.match(sql, /record_admin_audit\(v_actor, 'support_page_content_update'/)
  }
})

// ─── 관리자 화면·권한·작업 기록 ───────────────────────────────────────────────────────────────────────
test('관리자: /admin/notifications 는 대표만(페이지·액션), 사이드바 회원·고객 묶음, 작업 기록 종류 3개(결제 연결 아님)', () => {
  const page = read('src/app/(admin)/admin/notifications/page.tsx')
  assert.match(page, /await requireAdminPagePermission\('owner'\)/)
  const actions = read('src/app/(admin)/admin/notifications/actions.ts')
  const exported = [...actions.matchAll(/^export async function (\w+)/gm)].map((match) => match[1])
  assert.deepEqual(exported, ['saveMemberNotificationTextsAction', 'previewMemberBroadcastAction', 'sendMemberBroadcastAction', 'retractMemberBroadcastAction'])
  assert.equal([...actions.matchAll(/await requireAdmin\(\)\n  const access = await assertAdminActionPermission\('owner'\)/g)].length, 4)
  const sidebar = read('src/lib/admin-sidebar.ts')
  assert.match(sidebar, /'\/admin\/notifications': 'owner',/)
  assert.match(sidebar, /\{ name: '알림', href: '\/admin\/notifications', icon: 'messageSquare' \}/)
  const { ADMIN_AUDIT_ACTIONS } = load('src/lib/admin-audit-log.ts')
  assert.equal(ADMIN_AUDIT_ACTIONS.member_notification_texts_update, '회원 알림 문구 수정')
  assert.equal(ADMIN_AUDIT_ACTIONS.member_broadcast_send, '공지 알림 보내기')
  assert.equal(ADMIN_AUDIT_ACTIONS.member_broadcast_retract, '공지 알림 회수')
  // 보관 분류: 2년 쪽(결제 연결 아님 — 13번 계획 14절의 paymentLinkedActions 정책 값에 넣지 않는다고 주석에 남김)
  assert.match(read('src/lib/admin-audit-log.ts'), /paymentLinkedActions 에 넣지 않는다/)
  // 13번 안내 문구 탭: 답변 알림 키 없이 저장하고 '알림' 화면 링크 한 줄
  const panel = read('src/app/(admin)/admin/support/support-page-content-panel.tsx')
  assert.match(panel, /답변 알림 문구는 <Link href="\/admin\/notifications"/)
  assert.doesNotMatch(panel, /notifyOnAnswerEdit|answerCreatedNotification/)
  // 14번 공지 편집 창 [이 공지로 알림 보내기]
  assert.match(read('src/app/(admin)/admin/notices/board-admin.tsx'), /\/admin\/notifications\?tab=broadcast&postId=/)
})

test('웹훅·대사는 글 대신 종류만 넘기고, 화면 없는 경로의 알림 실패는 하루 한 건 경보(회원 id·글자 없음)', () => {
  const webhook = read('src/lib/payapp-webhook-server.ts')
  const reconciliation = read('src/lib/payment-reconciliation-server.ts')
  assert.doesNotMatch(webhook + reconciliation, /title: '|message: '결제가 확인되어|'환불 완료'/)
  assert.match(reconciliation, /userNotification: \{ kind: 'chargeRefundProviderFinalized', userId: refundRequest\.user_id, paymentOrderId: input\.order\.id \}/)
  assert.match(reconciliation, /userNotification: \{ kind: 'chargeCompleted', userId: order\.user_id, paymentOrderId: order\.id \}/)
  assert.match(webhook, /p_code: 'MEMBER_NOTIFICATION_FAILED',\s+p_severity: 'warning',/)
  assert.match(webhook, /dedupe_key: `member_notification_failed:\$\{request\.kind\}:\$\{kstDate\(\)\}`,/)
  assert.match(webhook, /if \(!result\.sent && result\.reason !== 'disabled'\)/)
  // 상태를 바꾼 경로만 알린다(이 묶음은 판단을 바꾸지 않음)
  assert.match(reconciliation, /if \(!finalized\.already_completed\) \{/)
  assert.match(webhook, /result\.result === 'fulfilled' && result\.user_id/)
  assert.match(webhook, /result\.result === 'refund_finalized' && result\.user_id/)
})

test('벨·알림 목록: announcement 는 DB 머리표(공지)를 붙이고, GET /api/notifications 가 memberLabel 을 함께 싣는다', () => {
  assert.match(read('src/app/api/notifications/route.ts'), /memberLabel/)
  const item = read('src/components/notifications/notification-item.tsx')
  assert.match(item, /announcement/)
  assert.match(read('src/components/ui/notification-bell.tsx'), /memberLabel/)
  assert.match(read('src/app/(solvook)/mypage/notifications/page.tsx'), /getMemberNotificationTexts\(\)/)
  assert.equal(rules.BROADCAST_NOTIFICATION_TYPE, 'announcement')
})

test('긴 숫자 판정(TS) = DB member_text_has_long_number 규칙(숫자·공백·하이픈 덩어리에서 숫자 10개 이상)', () => {
  for (const [text, expected] of [['계좌 123-456-789012', true], ['1234567890', true], ['123 456 7890', true], ['123456789', false], ['2026-11-26 처리', false], ['', false], [null, false]]) {
    assert.equal(rules.memberTextHasLongNumber(text), expected, String(text))
  }
})

// ─── 리허설 생성기 ──────────────────────────────────────────────────────────────────────────────────
test('리허설 파일은 생성기 출력과 같고, light 는 기존 표 DDL 없이 BEGIN…ROLLBACK', () => {
  const files = generator.buildRehearsalFiles()
  for (const [name, content] of Object.entries(files)) {
    assert.equal(read(`supabase/scripts/bundle16_rehearsal/${name}`), content, `${name} 다시 만들기(node supabase/scripts/bundle16_rehearsal/generate.mjs)`)
    assert.match(content, /\nBEGIN;\n/)
    assert.match(content, /\nROLLBACK;\n$/)
  }
  const light = generator.migrationCopy('light')
  assert.doesNotMatch(stripComments(light), /ALTER TABLE public\.(notifications|refund_requests|payment_admin_actions)|CREATE POLICY|ADD COLUMN/)
  assert.doesNotMatch(files['a_light.sql'], /supabase_migrations\.schema_migrations/)
  assert.match(files['b_full.sql'], /INSERT INTO supabase_migrations\.schema_migrations \(version, name\) VALUES \('20261218100000', 'bundle16_member_notifications'\);/)
  // full R9: 보통 거절(메모 있음·없음)·수동 확인(확인 false·빈 메모 거절, 성공 details·note·actor)·결제사 취소 흔적·옛 4인자·가림·익명화 보존, R7 회수 전 down 멈춤
  const full = files['b_full.sql']
  for (const label of ['메모 없는 보통 거절 성공', '처리 기록 admin_note_present false', '수동 확인: 확인 false 거절', '수동 확인: 빈 메모 거절',
    '수동 확인 처리 기록(action·note = 메모·details 기존 키 + 글자 수·actor)', '결제사 취소 흔적 거절 불가', '익명화 함수는 refund_requests 를 지우거나 고치지 않음',
    'user_id·저장한(다듬은) 사유 반환', '회수 안 한 공지 알림 → down 멈춤']) {
    assert.ok(full.includes(label), label)
  }
  assert.ok(!files['a_light.sql'].includes('수동 확인 거절 성공'), 'R9 는 full 만')
  // 스크립트 사본은 BEGIN·COMMIT·기록자 줄만 바꾼다(실제 대표 id 를 쓰지 않음)
  for (const name of ['cleanup', 'restore']) {
    const copy = generator.scriptCopy(name)
    assert.doesNotMatch(copy, /\nBEGIN;\n|\nCOMMIT;\n|last_sign_in_at/)
    assert.match(copy, /v_actor := \(SELECT v::uuid FROM _rh_ctx WHERE k = 'owner'\);/)
  }
})
