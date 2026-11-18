import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { adminGuardMocks, load } from './helpers/market-images-harness.mjs'

// 잘못 지급한 크레딧 회수(계획 U3-7, 20261118150000). 관리자 지급분의 지급 건 하나에서, 남은 수량 안에서만.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const MIGRATION = read('supabase/migrations/20261118150000_admin_credit_revoke.sql')
const DOWN = read('supabase/rollback/20261118150000_admin_credit_revoke_down.sql')
const body = MIGRATION.match(/CREATE FUNCTION public\.revoke_admin_credits\([\s\S]*?\$fn_revoke_admin_credits\$;/)[0]

test('회수 함수: SECURITY DEFINER, search_path 고정, EXECUTE는 service_role만, 되돌리기는 함수만 지운다', () => {
  assert.match(body, /\n SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\n/)
  assert.ok(MIGRATION.includes('REVOKE ALL ON FUNCTION public.revoke_admin_credits(uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated, service_role;'))
  assert.ok(MIGRATION.includes('GRANT EXECUTE ON FUNCTION public.revoke_admin_credits(uuid, uuid, integer, text, text) TO service_role;'))
  assert.doesNotMatch(MIGRATION, /TO (anon|authenticated)\b|ALTER TABLE|DROP |CREATE POLICY/)
  assert.ok(DOWN.includes('DROP FUNCTION public.revoke_admin_credits(uuid, uuid, integer, text, text);'))
})

test('회수 함수: 본인·권한·한도 → 대상 잠금 → 재요청 → 원천 잠금·확인 → 회수 → 거래·작업 기록 순서', () => {
  const order = [
    "RAISE EXCEPTION 'ADMIN_REVOKE_SELF_TARGET'",
    "WHERE g.user_id = p_actor_id AND g.permission = 'credits.revoke'",
    "RAISE EXCEPTION 'ADMIN_REVOKE_LIMIT_PER_GRANT limit=%', v_per_grant;",
    'WHERE id = v_user_id\n   FOR UPDATE;',
    "'already_revoked', true",
    "RAISE EXCEPTION 'ADMIN_REVOKE_REPLAY_MISSING'",
    'WHERE s.id = p_source_id\n     AND s.user_id = v_user_id\n     FOR UPDATE;',
    "RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_ACTIVE'",
    "RAISE EXCEPTION 'ADMIN_REVOKE_EXCEEDS_REMAINING remaining=%', v_remaining;",
    'SET remaining_credits = remaining_credits - p_amount',
    'INSERT INTO public.credit_transactions',
    "'credit_revoke',",
  ].map((mark) => body.indexOf(mark))
  assert.ok(order.every((index) => index > 0), JSON.stringify(order))
  assert.deepEqual([...order].sort((a, b) => a - b), order)
  // 관리자 지급분만(결제 충전분 아님). 잠그기 전에 한 번(결제 환불 함수와 반대 순서로 같은 원천을 잡지 않게), 잠근 뒤 한 번 더.
  const categoryChecks = [...body.matchAll(/v_category NOT IN \('admin_grant', 'bonus', 'system_refund'\) THEN\n\s+RAISE EXCEPTION 'ADMIN_REVOKE_SOURCE_NOT_ADMIN_GRANT'/g)].map((match) => match.index)
  assert.equal(categoryChecks.length, 2)
  assert.ok(categoryChecks[0] < body.indexOf("WHERE g.user_id = p_actor_id AND g.permission = 'credits.revoke'"))
  assert.ok(categoryChecks[1] > body.indexOf('WHERE s.id = p_source_id\n     AND s.user_id = v_user_id\n     FOR UPDATE;'))
  // 거래는 결제 환불 회수와 같은 방식(type refund, 음수), 원장 문구
  assert.match(body, /'refund',\n\s+-p_amount,/)
  assert.match(body, /format\('크레딧 %s개 관리자 회수'/)
  // 직원은 의존 권한까지, 한도는 계정 값(필수)
  assert.match(body, /g\.permission IN \('members\.view', 'credits\.view'\)\) <> 2 THEN\n\s+RAISE EXCEPTION 'ADMIN_REVOKE_ACTOR_NOT_ALLOWED'/)
  assert.match(body, /RAISE EXCEPTION 'ADMIN_REVOKE_LIMIT_NOT_SET'/)
})

const json = { NextResponse: { json: (payload, init) => ({ body: payload, status: init?.status ?? 200 }) } }
const SOURCE_ID = '00000000-0000-4000-8000-0000000000a1'
const MEMBER_ID = '00000000-0000-4000-8000-000000000002'
const KEY = '0f8fad5b-d9cb-469f-a165-70867728950e'
const grant = (permission, limits = {}) => ({ permission, limits })

function loadRevokeRoute(session, revoke) {
  const calls = { revokes: [], notifications: [] }
  const route = load('src/app/api/admin/users/credits/revoke/route.ts', {
    'next/server': json,
    ...adminGuardMocks(session),
    '@/lib/supabase/bypass': { createAdminClient: () => ({ from: () => ({ insert: async (row) => { calls.notifications.push(row); return { error: null } } }) }) },
    '@/lib/credits': { CreditService: { revokeCreditsAsAdmin: async (args) => { calls.revokes.push(args); return revoke(args) } } },
  })
  const post = (payload) => route.POST({ json: async () => payload })
  return { post, calls }
}

const payload = (overrides = {}) => ({ sourceId: SOURCE_ID, amount: 300, reason: '잘못 지급', idempotencyKey: KEY, ...overrides })
const ok = async () => ({ userId: MEMBER_ID, newBalance: 700, sourceRemaining: 700, alreadyRevoked: false })

test('회수 route: credits.revoke 권한으로, 행위자·요청 키를 넘기고 새 회수에만 회원 알림', async () => {
  const owner = loadRevokeRoute({}, ok)
  const result = await owner.post(payload())
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { success: true, newBalance: 700, sourceRemaining: 700, alreadyRevoked: false, notified: true })
  assert.deepEqual(owner.calls.revokes, [{ actorId: '00000000-0000-4000-8000-000000000001', sourceId: SOURCE_ID, credits: 300, reason: '잘못 지급', operationKey: `admin_revoke:${KEY}` }])
  assert.equal(owner.calls.notifications.length, 1)
  assert.equal(result.body.notified, true)
  assert.equal(owner.calls.notifications[0].user_id, MEMBER_ID)
  assert.match(owner.calls.notifications[0].message, /300개가 회수되었습니다\. \(사유: 잘못 지급\)/)

  const replay = loadRevokeRoute({}, async () => ({ userId: MEMBER_ID, newBalance: 700, sourceRemaining: 700, alreadyRevoked: true }))
  assert.equal((await replay.post(payload())).status, 200)
  assert.equal(replay.calls.notifications.length, 0)

  // 권한(의존 포함)이 있는 직원은 통과, 없으면 함수를 부르지 않는다
  const staff = loadRevokeRoute({ role: 'staff', grants: [grant('members.view'), grant('credits.view'), grant('credits.revoke', { per_grant: 500 })] }, ok)
  assert.equal((await staff.post(payload())).status, 200)
  for (const grants of [[grant('members.view'), grant('credits.view'), grant('credits.grant')], [grant('credits.revoke', { per_grant: 500 })]]) {
    const denied = loadRevokeRoute({ role: 'staff', grants }, ok)
    assert.equal((await denied.post(payload())).status, 403)
    assert.equal(denied.calls.revokes.length, 0)
  }
})

test('회수 route: 입력 검증은 함수 전에, 함수의 거부는 상태·안내 문구로', async () => {
  for (const bad of [{ reason: '  ' }, { amount: 0 }, { amount: 1.5 }, { sourceId: 'x' }, { idempotencyKey: 'x' }, { reason: 'a'.repeat(501) }]) {
    const route = loadRevokeRoute({}, ok)
    assert.equal((await route.post(payload(bad))).status, 400, JSON.stringify(bad))
    assert.equal(route.calls.revokes.length, 0)
  }
  const cases = [
    ['ADMIN_REVOKE_EXCEEDS_REMAINING remaining=200', 409, /남은 크레딧\(200\)/],
    ['ADMIN_REVOKE_LIMIT_PER_GRANT limit=500', 403, /1회 회수 한도\(500 크레딧\)/],
    ['ADMIN_REVOKE_SOURCE_NOT_ADMIN_GRANT', 409, /결제로 충전한 크레딧은 회수 대상이 아닙니다/],
    ['ADMIN_REVOKE_SOURCE_NOT_ACTIVE', 409, /만료되었거나/],
    ['ADMIN_REVOKE_SELF_TARGET', 403, /본인 계정/],
    ['ADMIN_REVOKE_IDEMPOTENCY_CONFLICT', 409, /이전 회수가 이미 처리/],
    ['ADMIN_REVOKE_LIMIT_NOT_SET', 403, /회수 한도가 설정되어 있지 않습니다/],
  ]
  for (const [message, status, text] of cases) {
    const route = loadRevokeRoute({}, async () => { throw new Error(message) })
    const result = await route.post(payload())
    assert.equal(result.status, status, message)
    assert.match(result.body.error, text, message)
    assert.equal(route.calls.notifications.length, 0)
  }
  const failed = await loadRevokeRoute({}, async () => { throw new Error('DB down') }).post(payload())
  assert.equal(failed.status, 500)
  assert.doesNotMatch(failed.body.error, /DB down/)
})

test('표시: 관리자 지급분의 음수 기록은 관리자 회수(회원 화면은 회수), 결제분은 환불 회수 그대로', () => {
  const kind = load('src/lib/admin-credit-transaction-kind.ts')
  assert.equal(kind.getAdminCreditTransactionKind({ type: 'refund', amount: -300, source_category: 'admin_grant' }).label, '관리자 회수')
  assert.equal(kind.getAdminCreditTransactionKind({ type: 'refund', amount: -300, source_category: 'plan_purchase' }).label, '환불 회수')
  assert.equal(kind.getAdminCreditTransactionKind({ type: 'refund', amount: 300, source_category: 'admin_grant' }).label, '사용 취소')
  const display = load('src/lib/credit-transaction-display.ts')
  assert.equal(display.getCreditTransactionTypeLabel({ type: 'refund', amount: -300, description: '', source: { source_category: 'bonus' } }), '회수')
  assert.equal(display.getCreditTransactionTypeLabel({ type: 'refund', amount: -300, description: '', source: { source_category: 'plan_purchase' } }), '환불')
  // 회수 대상 분류는 DB 함수와 같다.
  assert.deepEqual([...kind.ADMIN_GRANT_SOURCE_CATEGORIES], ['admin_grant', 'bonus', 'system_refund'])
})

test('회원 상세: 회수 권한이 있고 본인이 아닐 때, 관리자 지급분 중 쓸 수 있는 건에만 회수 버튼', () => {
  const page = read('src/app/(admin)/admin/users/[id]/page.tsx')
  assert.match(page, /const canRevoke = hasAdminPermission\(access, 'credits\.revoke'\) && profile\.id !== access\.userId/)
  assert.match(page, /ADMIN_GRANT_SOURCE_CATEGORIES\.includes\(source\.source_category\)\s*&& source\.status === 'active'\s*&& !\(source\.expires_at && source\.expires_at <= credits\.databaseNow\)\s*&& source\.remaining_credits > 0/)
  const button = read('src/app/(admin)/admin/users/[id]/revoke-credit-button.tsx')
  assert.match(button, /fetch\('\/api\/admin\/users\/credits\/revoke'/)
  assert.match(button, /setIdempotencyKey\(crypto\.randomUUID\(\)\)/)
  assert.match(button, /parsedAmount > remaining/)
  // 실패 뒤·창을 닫을 때 다시 읽어 옛 수량으로 두 번 회수하지 않게, 버튼은 지급 건 이름으로 구분
  assert.equal(button.match(/router\.refresh\(\)/g).length, 3)
  assert.match(button, /aria-label=\{`\$\{sourceLabel\} 회수`\}/)
  assert.match(button, /result\.notified/)
})
