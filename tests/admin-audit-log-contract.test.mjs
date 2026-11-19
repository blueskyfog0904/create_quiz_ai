import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse, adminGuardMocks, createFakeAdmin, load } from './helpers/market-images-harness.mjs'

// 계획 U3-5(작업 기록)와 마이그레이션 20261117110000의 계약.

const ROOT = new URL('../', import.meta.url).pathname
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const MIGRATION = read('supabase/migrations/20261117110000_admin_audit_log.sql')
const ROLLBACK = read('supabase/rollback/20261117110000_admin_audit_log_down.sql')
const PERMISSION_MIGRATION = read('supabase/migrations/20261117120000_admin_permission_grants_replace.sql')
const LIMITS_MIGRATION = read('supabase/migrations/20261118120000_admin_credit_grant_limits.sql')
const REVOKE_MIGRATION = read('supabase/migrations/20261118150000_admin_credit_revoke.sql')
// DB 함수가 같은 트랜잭션으로 적는 종류
const DB_FUNCTION_ACTIONS = [
  [PERMISSION_MIGRATION, 'admin_permissions_replace'],
  [PERMISSION_MIGRATION, 'admin_account_revoke'],
  [LIMITS_MIGRATION, 'credit_grant'],
  [LIMITS_MIGRATION, 'credit_grant_limits_update'],
  [REVOKE_MIGRATION, 'credit_revoke'],
]
const { ADMIN_AUDIT_ACTIONS } = load('src/lib/admin-audit-log.ts')

const ADMIN_ID = '00000000-0000-4000-8000-000000000001'
const MEMBER_ID = '00000000-0000-4000-8000-000000000002'
const REQUEST_ID = '00000000-0000-4000-8000-000000000003'

function walk(dir, found = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const path = `${dir}/${entry}`
    if (statSync(join(ROOT, path)).isDirectory()) walk(path, found)
    else if (/\.(ts|tsx)$/.test(entry)) found.push(path)
  }
  return found.sort()
}

// ---------------------------------------------------------------------------------------------------------------
// 마이그레이션
// ---------------------------------------------------------------------------------------------------------------
test('작업 기록 표: 행위자 FK 없음(계정이 지워져도 남음)·이메일 스냅샷·action CHECK 없음·amount integer', () => {
  const table = MIGRATION.match(/CREATE TABLE public\.admin_audit_log \(([\s\S]*?)\n\);/)[1]
  assert.match(table, /\n {2}actor_id uuid NOT NULL,/)
  assert.match(table, /\n {2}actor_email text,/)
  assert.match(table, /\n {2}action text NOT NULL,/)
  assert.match(table, /\n {2}target_type text,\n {2}target_id text,\n {2}target_user_id uuid,\n {2}amount integer,\n {2}reason text,\n {2}details jsonb NOT NULL DEFAULT '\{\}'::jsonb,/)
  assert.doesNotMatch(table, /REFERENCES/)
  assert.doesNotMatch(table, /CHECK \(action/)
  assert.doesNotMatch(MIGRATION, /admin_audit_log_action_check/)
})

test('작업 기록 표: UPDATE·DELETE(행)·TRUNCATE(문장)를 트리거로 막고, service_role도 예외가 아니다', () => {
  assert.match(MIGRATION, /CREATE TRIGGER prevent_admin_audit_log_mutation\n {2}BEFORE UPDATE OR DELETE ON public\.admin_audit_log\n {2}FOR EACH ROW EXECUTE FUNCTION public\.prevent_admin_audit_log_mutation\(\);/)
  assert.match(MIGRATION, /CREATE TRIGGER prevent_admin_audit_log_truncate\n {2}BEFORE TRUNCATE ON public\.admin_audit_log\n {2}FOR EACH STATEMENT EXECUTE FUNCTION public\.prevent_admin_audit_log_mutation\(\);/)
  const fn = MIGRATION.match(/CREATE FUNCTION public\.prevent_admin_audit_log_mutation\(\)[\s\S]*?\$fn_prevent_admin_audit_log_mutation\$;/)[0]
  // 역할을 보고 통과시키는 분기가 없다.
  assert.match(fn, /BEGIN\n {2}RAISE EXCEPTION 'ADMIN_AUDIT_LOG_APPEND_ONLY';\nEND;/)
  assert.match(fn, /SET search_path TO 'public', 'pg_temp'/)
})

test('작업 기록 표: RLS on·정책 없음, anon·authenticated 권한 없음, service_role은 SELECT만(쓰기는 기록 함수로만)', () => {
  assert.match(MIGRATION, /ALTER TABLE public\.admin_audit_log ENABLE ROW LEVEL SECURITY;/)
  assert.doesNotMatch(MIGRATION, /CREATE POLICY/)
  assert.match(MIGRATION, /REVOKE ALL ON TABLE public\.admin_audit_log FROM PUBLIC, anon, authenticated, service_role;/)
  const tableGrants = [...MIGRATION.matchAll(/GRANT ([A-Z, ]+) ON TABLE public\.admin_audit_log TO ([^;]+);/g)].map((match) => [match[1], match[2]])
  // INSERT를 주면 시각·수량을 꾸며 넣어 하루 한도 합산을 속일 수 있다 → 표 쓰기 권한은 아무에게도 없다.
  assert.deepEqual(tableGrants, [['SELECT', 'service_role']])
  assert.doesNotMatch(MIGRATION, /GRANT [A-Z, ]*(INSERT|UPDATE|DELETE)[A-Z, ]* ON TABLE public\.admin_audit_log/)
  assert.doesNotMatch(MIGRATION, /TO (anon|authenticated)\b/)
  // 보기도 service_role만 읽는다(부른 역할의 권한으로 읽는다).
  assert.match(MIGRATION, /CREATE VIEW public\.admin_audit_timeline\n WITH \(security_invoker = true\)/)
  assert.match(MIGRATION, /REVOKE ALL ON TABLE public\.admin_audit_timeline FROM PUBLIC, anon, authenticated, service_role;\nGRANT SELECT ON TABLE public\.admin_audit_timeline TO service_role;/)
  // 결제 쪽 대상 종류: 주문·환불이 모두 없는 행(경보 해소 등)은 NULL
  assert.match(MIGRATION, /CASE\n\s+WHEN a\.refund_request_id IS NOT NULL THEN 'refund_request'\n\s+WHEN a\.payment_order_id IS NOT NULL THEN 'payment_order'\n\s+END AS target_type,/)
  assert.doesNotMatch(MIGRATION, /ELSE 'payment_order'/)
})

test('작업 기록 표: 시각 / 행위자+시각 / 종류+시각 / 대상 회원 인덱스, 하루 한도 합산(행위자·종류·시각 범위) 인덱스', () => {
  assert.match(MIGRATION, /ON public\.admin_audit_log \(created_at DESC\);/)
  assert.match(MIGRATION, /ON public\.admin_audit_log \(actor_id, created_at DESC\);/)
  assert.match(MIGRATION, /ON public\.admin_audit_log \(action, created_at DESC\);/)
  assert.match(MIGRATION, /ON public\.admin_audit_log \(target_user_id, created_at DESC\)\n {2}WHERE target_user_id IS NOT NULL;/)
  assert.match(MIGRATION, /ON public\.admin_audit_log \(actor_id, action, created_at\);/)
  // 한국 시간 당일 경계로 합산하는 예시가 같은 열 순서로 적혀 있다.
  assert.match(MIGRATION, /WHERE actor_id = \$1 AND action = \$2\n--\s+AND created_at >= \(date_trunc\('day', now\(\) AT TIME ZONE 'Asia\/Seoul'\) AT TIME ZONE 'Asia\/Seoul'\);/)
})

test('기록 함수: SECURITY DEFINER·search_path 고정·EXECUTE는 service_role만, 이메일 스냅샷은 함수가 채운다', () => {
  const fn = MIGRATION.match(/CREATE FUNCTION public\.record_admin_audit\([\s\S]*?\$fn_record_admin_audit\$;/)[0]
  assert.match(fn, /\n SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\n/)
  assert.match(fn, /\(SELECT p\.email FROM public\.profiles p WHERE p\.id = p_actor_id\)/)
  const signature = 'uuid, text, text, text, uuid, integer, text, jsonb, text'
  assert.ok(MIGRATION.includes(`REVOKE ALL ON FUNCTION public.record_admin_audit(${signature})\n  FROM PUBLIC, anon, authenticated, service_role;`))
  assert.ok(MIGRATION.includes(`GRANT EXECUTE ON FUNCTION public.record_admin_audit(${signature})\n  TO service_role;`))
  // 되돌리기: 보기 → 함수 → 표 → 트리거 함수
  const order = ['DROP VIEW public.admin_audit_timeline;', `DROP FUNCTION public.record_admin_audit(${signature});`, 'DROP TABLE public.admin_audit_log;', 'DROP FUNCTION public.prevent_admin_audit_log_mutation();']
  const positions = order.map((statement) => ROLLBACK.indexOf(statement))
  assert.ok(positions.every((position) => position >= 0), '되돌리기 문장이 모두 있다')
  assert.deepEqual([...positions].sort((a, b) => a - b), positions)
})

// ---------------------------------------------------------------------------------------------------------------
// 종류 목록 — 코드 한 곳
// ---------------------------------------------------------------------------------------------------------------
const FORBIDDEN = (path) => /^src\/lib\/(payment-|payapp-|kakaopay-)/.test(path)
  || ['src/lib/credits.ts', 'src/lib/market-items-server.ts', 'src/lib/market-purchase.ts'].includes(path)

test('기록하는 종류는 모두 ADMIN_AUDIT_ACTIONS(한 곳)에 있고, DB 함수가 적는 종류도 같다', () => {
  const keys = Object.keys(ADMIN_AUDIT_ACTIONS)
  for (const [migration, action] of DB_FUNCTION_ACTIONS) {
    assert.ok(migration.includes(`'${action}',`), action)
    assert.ok(keys.includes(action), action)
  }
  const used = new Set()
  for (const path of walk('src')) {
    const source = read(path)
    if (!source.includes('recordAdminAudit(')) continue
    assert.ok(!FORBIDDEN(path), `${path}: 고치지 않기로 한 파일`)
    if (path === 'src/lib/admin-audit-log-server.ts') continue
    for (const call of source.matchAll(/recordAdminAudit\(\{[\s\S]*?\n\s*\}\)/g)) {
      const line = call[0].match(/\n\s*action(?:: ([^\n]+))?,?\n/)
      assert.ok(line, `${path}: action이 없다`)
      const expression = (line[1] ?? 'action').replace(/,$/, '')
      const literals = [...expression.matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
      // 변수로 넘기면 그 변수의 정의(조건 ? 'a' : 'b')에서 고른 값들을 읽는다.
      const names = literals.length > 0 ? literals : [...source.match(new RegExp(`const ${expression.trim()} = ([^\\n]+)`))[1].matchAll(/[?:] '([a-z_]+)'/g)].map((match) => match[1])
      assert.ok(names.length > 0, `${path}: ${expression}`)
      for (const name of names) {
        assert.ok(keys.includes(name), `${path}: 목록에 없는 종류 ${name}`)
        used.add(name)
      }
    }
  }
  // 코드에서 남기는 종류 + DB 함수가 남기는 종류 = 목록 전체(쓰지 않는 항목이 없다).
  assert.deepEqual([...new Set([...used, ...DB_FUNCTION_ACTIONS.map(([, action]) => action)])].sort(), [...keys].sort())
})

test('결제 쪽 조치(충전 환불 실행·수동 확인·경보 해소)는 payment_admin_actions에 이미 남으므로 다시 적지 않는다', () => {
  for (const path of ['src/app/api/admin/refunds/route.ts', 'src/app/api/admin/payments/review/route.ts', 'src/app/api/admin/payments/alerts/route.ts']) {
    assert.doesNotMatch(read(path), /admin-audit-log/, path)
  }
  for (const path of walk('src/lib').filter(FORBIDDEN)) assert.doesNotMatch(read(path), /admin-audit-log|admin_audit/, path)
})

// ---------------------------------------------------------------------------------------------------------------
// 기록 도우미
// ---------------------------------------------------------------------------------------------------------------
function loadAuditServer(admin, errors = []) {
  return load('src/lib/admin-audit-log-server.ts', {
    'server-only': {},
    '@/lib/admin-accounts-shared': load('src/lib/admin-accounts-shared.ts'),
    '@/lib/admin-audit-log': load('src/lib/admin-audit-log.ts'),
    '@/lib/admin-orders': load('src/lib/admin-orders.ts'),
    '@/lib/kst-period': load('src/lib/kst-period.ts'),
    '@/lib/list-pagination': load('src/lib/list-pagination.ts'),
    '@/lib/supabase/bypass': { createAdminClient: () => admin },
  }, errors)
}

test('recordAdminAudit: service role로 기록 함수를 부르고, 빈 칸은 null로 보낸다', async () => {
  const fake = createFakeAdmin(() => ({ data: null, error: null }), { rpc: () => ({ data: 'id-1', error: null }) })
  const server = loadAuditServer(fake.client)
  assert.equal(await server.recordAdminAudit({ actorId: ADMIN_ID, action: 'support_ticket_reply', targetId: 't-1' }), true)
  assert.deepEqual(fake.calls, [{
    type: 'rpc',
    name: 'record_admin_audit',
    args: {
      p_actor_id: ADMIN_ID,
      p_action: 'support_ticket_reply',
      p_target_type: null,
      p_target_id: 't-1',
      p_target_user_id: null,
      p_amount: null,
      p_reason: null,
      p_details: {},
      p_request_id: null,
    },
  }])
})

test('recordAdminAudit: 실패(표 없음 포함)해도 던지지 않고 false + 로그만 남긴다', async () => {
  const errors = []
  const failing = createFakeAdmin(() => ({}), { rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.record_admin_audit' } }) })
  assert.equal(await loadAuditServer(failing.client, errors).recordAdminAudit({ actorId: ADMIN_ID, action: 'credit_grant' }), false)
  const throwing = { rpc: async () => { throw new Error('network') } }
  assert.equal(await loadAuditServer(throwing, errors).recordAdminAudit({ actorId: ADMIN_ID, action: 'credit_grant' }), false)
  assert.equal(errors.length, 2)
})

test('alertAdminAuditFailure: 대표 알림(admin_events)을 남기고, 같은 건 중복(23505)은 조용히 넘긴다', async () => {
  const inserts = []
  const errors = []
  const admin = { from: (table) => ({ insert: async (row) => { inserts.push({ table, row }); return { error: inserts.length > 1 ? { code: '23505' } : null } } }) }
  const server = loadAuditServer(admin, errors)
  await server.alertAdminAuditFailure({ action: 'market_refund_approve', refTable: 'market_refund_requests', refId: REQUEST_ID, link: '/admin/refunds' })
  await server.alertAdminAuditFailure({ action: 'market_refund_approve', refTable: 'market_refund_requests', refId: REQUEST_ID, link: '/admin/refunds' })
  assert.equal(inserts[0].table, 'admin_events')
  assert.equal(inserts[0].row.kind, 'admin_audit_failed')
  assert.equal(inserts[0].row.required_permission, 'owner')
  assert.equal(inserts[0].row.ref_id, REQUEST_ID)
  assert.equal(inserts[0].row.dedupe_key, `audit_failed:market_refund_approve:${REQUEST_ID}`)
  assert.equal(errors.length, 0)
})

// ---------------------------------------------------------------------------------------------------------------
// 기록 호출 — 성공한 뒤에만
// ---------------------------------------------------------------------------------------------------------------
function auditMock(result = true) {
  const audits = []
  const alerts = []
  return {
    audits,
    alerts,
    module: {
      recordAdminAudit: async (entry) => { audits.push(entry); return result },
      alertAdminAuditFailure: async (entry) => { alerts.push(entry) },
    },
  }
}

const json = { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } }

function loadMarketRefundRoute({ audit = auditMock(), approve, requester = MEMBER_ID, session = { userId: ADMIN_ID }, processed = [] } = {}) {
  const route = load('src/app/api/admin/market/refunds/[id]/route.ts', {
    'next/server': json,
    ...adminGuardMocks(session),
    '@/lib/admin-audit-log-server': audit.module,
    '@/lib/supabase/bypass': {
      createAdminClient: () => ({
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: requester, requested_refund_credits: 300 }, error: null }) }) }),
          insert: async () => ({ error: null }),
        }),
      }),
    },
    '@/lib/market-refunds': {
      MarketRefundConflictError: class extends Error {},
      MarketRefundShortfallError: class extends Error { constructor() { super('부족'); this.requested = 10; this.restorable = 5 } },
      approveMarketRefund: approve ?? (async () => { processed.push('approve'); return { user_id: MEMBER_ID, status: 'approved', requested_refund_credits: 300, approved_refund_credits: 300 } }),
      rejectMarketRefund: async () => { processed.push('reject'); return { user_id: MEMBER_ID, status: 'rejected', requested_refund_credits: 300, approved_refund_credits: null } },
    },
  })
  return (body) => route.PATCH({ json: async () => body }, { params: Promise.resolve({ id: REQUEST_ID }) })
}

test('마켓 환불: 처리자 본인이 낸 환불 요청은 대표도 승인·거부하지 못한다(처리 함수 호출 전 403)', async () => {
  for (const session of [{ userId: ADMIN_ID }, { userId: ADMIN_ID, role: 'staff', grants: [{ permission: 'orders.view', limits: {} }, { permission: 'refunds.market', limits: { per_request: 100000 } }] }]) {
    for (const action of ['approve', 'reject']) {
      const processed = []
      const audit = auditMock()
      const result = await loadMarketRefundRoute({ requester: ADMIN_ID, session, processed, audit })({ action })
      assert.equal(result.status, 403, `${session.role ?? 'owner'} ${action}`)
      assert.equal(result.body.code, 'ADMIN_SELF_TARGET')
      assert.match(result.body.error, /본인 계정의 환불 요청은 처리할 수 없습니다/)
      assert.deepEqual(processed, [])
      assert.equal(audit.audits.length, 0)
    }
  }
})

test('마켓 환불: 처리 뒤 기록(승인은 복구 크레딧을 amount에), 기록 실패면 경고 필드 + 대표 알림, 처리 실패면 기록 없음', async () => {
  const audit = auditMock()
  const approved = await loadMarketRefundRoute({ audit })({ action: 'approve', adminNote: '확인함' })
  assert.equal(approved.status, 200)
  assert.equal(approved.body.auditWarning, undefined)
  assert.deepEqual(audit.audits.map(({ actorId, action, targetType, targetId, targetUserId, amount, reason }) => ({ actorId, action, targetType, targetId, targetUserId, amount, reason })), [{
    actorId: ADMIN_ID, action: 'market_refund_approve', targetType: 'market_refund_request', targetId: REQUEST_ID, targetUserId: MEMBER_ID, amount: 300, reason: '확인함',
  }])
  assert.equal(audit.alerts.length, 0)

  const rejectAudit = auditMock()
  await loadMarketRefundRoute({ audit: rejectAudit })({ action: 'reject' })
  assert.equal(rejectAudit.audits[0].action, 'market_refund_reject')
  assert.equal(rejectAudit.audits[0].amount, null)

  const failing = auditMock(false)
  const warned = await loadMarketRefundRoute({ audit: failing })({ action: 'approve' })
  assert.equal(warned.status, 200, '기록이 실패해도 처리 결과는 그대로다')
  assert.equal(warned.body.success, true)
  assert.match(warned.body.auditWarning, /작업 기록을 남기지 못했습니다/)
  assert.deepEqual(failing.alerts, [{ action: 'market_refund_approve', refTable: 'market_refund_requests', refId: REQUEST_ID, link: '/admin/refunds' }])

  const notProcessed = auditMock()
  const shortfall = await loadMarketRefundRoute({ audit: notProcessed, approve: async () => { throw new (class MarketRefundShortfallError extends Error {})('x') } })({ action: 'approve' })
  assert.notEqual(shortfall.status, 200)
  assert.equal(notProcessed.audits.length + notProcessed.alerts.length, 0)

  // 화면은 경고를 띄운다.
  assert.match(read('src/app/(admin)/admin/refunds/market-refunds-client.tsx'), /if \(result\.auditWarning\) toast\.warning\(result\.auditWarning\)/)
})

function loadCreditRoute({ audit = auditMock(), grant, session = { userId: ADMIN_ID }, target = MEMBER_ID } = {}) {
  const route = load('src/app/api/admin/users/credits/route.ts', {
    'next/server': json,
    ...adminGuardMocks(session),
    '@/lib/admin-audit-log-server': audit.module,
    '@/lib/supabase/bypass': { createAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) },
    '@/lib/credits': { CreditService: { grantCreditsAsAdmin: grant ?? (async () => ({ newBalance: 700, alreadyGranted: false })) } },
    '@/lib/credit-source-display': { resolveAdminGrantSourceCategory: () => 'admin_other' },
    '@/lib/credit-balance': { getCreditBalanceSnapshot: async () => ({}), buildCreditBalanceResponseFields: () => ({}) },
  })
  return (amount) => route.POST({ json: async () => ({ userId: target, amount, description: '보상 지급', category: 'compensation', idempotencyKey: '0f8fad5b-d9cb-469f-a165-70867728950e' }) })
}

test('크레딧 수동 지급: 기록은 지급 함수가 같은 트랜잭션으로 남기고(20261118120000), route는 행위자·사유·분류를 넘긴다', async () => {
  const calls = []
  const audit = auditMock()
  const ok = await loadCreditRoute({ audit, grant: async (args) => { calls.push(args); return { newBalance: 700, alreadyGranted: false } } })(500)
  assert.equal(ok.status, 200)
  assert.equal(ok.body.auditWarning, undefined)
  assert.deepEqual(calls, [{
    actorId: ADMIN_ID,
    userId: MEMBER_ID,
    credits: 500,
    sourceCategory: 'admin_other',
    reason: '보상 지급',
    details: { category: 'compensation' },
    operationKey: 'admin_grant:0f8fad5b-d9cb-469f-a165-70867728950e',
  }])
  // route는 따로 기록하지 않는다(지급과 기록이 갈라지지 않게).
  assert.equal(audit.audits.length + audit.alerts.length, 0)
  const source = read('src/app/api/admin/users/credits/route.ts')
  assert.doesNotMatch(source, /recordAdminAudit|alertAdminAuditFailure|admin-audit-log/)
  assert.doesNotMatch(read('src/app/(admin)/admin/credits/grant-credit-dialog.tsx'), /auditWarning/)

  // 지급 함수: 새 지급 뒤에만 'credit_grant'를 amount·사유와 함께 적는다(재요청은 그 전에 돌아간다).
  const body = LIMITS_MIGRATION.match(/CREATE FUNCTION public\.grant_admin_credits\([\s\S]*?\$fn_grant_admin_credits\$;/)[0]
  const replayReturn = body.indexOf("'already_granted', true")
  const insertTx = body.indexOf('INSERT INTO public.credit_transactions')
  const record = body.indexOf('PERFORM public.record_admin_audit(')
  assert.ok(replayReturn > 0 && replayReturn < insertTx && insertTx < record)
  assert.match(body.slice(record), /p_actor_id,\n\s+'credit_grant',\n\s+'member',\n\s+p_user_id::text,\n\s+p_user_id,\n\s+p_amount,\n\s+btrim\(p_reason\),/)

  // 지급 실패는 500, 한도 거부는 403(지급 함수의 문구를 안내로 바꾼다).
  assert.equal((await loadCreditRoute({ grant: async () => { throw new Error('DB down') } })(500)).status, 500)
  const perGrant = await loadCreditRoute({ grant: async () => { throw new Error('ADMIN_GRANT_LIMIT_PER_GRANT limit=10000') } })(10001)
  assert.equal(perGrant.status, 403)
  assert.equal(perGrant.body.code, 'ADMIN_LIMIT_EXCEEDED')
  assert.match(perGrant.body.error, /1회 지급 한도\(10,000 크레딧\)/)
  const perDay = await loadCreditRoute({ grant: async () => { throw new Error('ADMIN_GRANT_LIMIT_PER_DAY limit=50000 used=49990') } })(100)
  assert.equal(perDay.status, 403)
  assert.equal(perDay.body.code, 'ADMIN_DAILY_LIMIT_EXCEEDED')
  assert.match(perDay.body.error, /오늘 지급 한도\(50,000 크레딧\)[\s\S]*오늘 지급한 크레딧 49,990, 남은 한도 10/)
  const conflict = await loadCreditRoute({ grant: async () => { throw new Error('ADMIN_GRANT_IDEMPOTENCY_CONFLICT') } })(500)
  assert.equal(conflict.status, 409)
  const notSet = await loadCreditRoute({ grant: async () => { throw new Error('ADMIN_GRANT_LIMIT_NOT_SET') } })(1)
  assert.equal(notSet.status, 403)
})

test('크레딧 수동 지급: 본인 계정에는 대표도 지급하지 못한다(지급 함수 호출 전 403)', async () => {
  for (const session of [{ userId: ADMIN_ID }, { userId: ADMIN_ID, role: 'staff', grants: [{ permission: 'members.view', limits: {} }, { permission: 'credits.view', limits: {} }, { permission: 'credits.grant', limits: { per_grant: 1000, per_day: 1000 } }] }]) {
    const grants = []
    const audit = auditMock()
    const result = await loadCreditRoute({ audit, session, target: ADMIN_ID, grant: async (...args) => { grants.push(args); return { newBalance: 1, alreadyGranted: false } } })(10)
    assert.equal(result.status, 403)
    assert.equal(result.body.code, 'ADMIN_SELF_TARGET')
    assert.match(result.body.error, /본인 계정에는 크레딧을 지급할 수 없습니다/)
    assert.deepEqual(grants, [])
    assert.equal(audit.audits.length, 0)
  }
})

function loadTicketRoute(ticketRow, audit = auditMock()) {
  const { client: session } = createFakeAdmin(({ table }) => (table === 'notifications' ? { error: null } : { data: ticketRow, error: null }))
  const route = load('src/app/api/admin/support/tickets/[id]/route.ts', {
    'next/server': { NextResponse },
    '@/lib/supabase/server': { createClient: async () => session },
    '@/lib/supabase/bypass': { createAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) },
    ...adminGuardMocks({ userId: ADMIN_ID }),
    '@/lib/admin-audit-log-server': audit.module,
  })
  return { patch: () => route.PATCH({ json: async () => ({ adminResponse: '답변' }) }, { params: Promise.resolve({ id: REQUEST_ID }) }), audit }
}

test('문의 답변: 저장된 답변만 기록하고, 없는·삭제된 문의(404)는 기록하지 않는다', async () => {
  const ok = loadTicketRoute({ id: REQUEST_ID, user_id: MEMBER_ID, subject: '문의', status: 'resolved' })
  assert.equal((await ok.patch()).status, 200)
  assert.deepEqual(ok.audit.audits.map(({ action, targetId, targetUserId }) => ({ action, targetId, targetUserId })), [{ action: 'support_ticket_reply', targetId: REQUEST_ID, targetUserId: MEMBER_ID }])
  const missing = loadTicketRoute(null)
  assert.equal((await missing.patch()).status, 404)
  assert.equal(missing.audit.audits.length, 0)
})

function loadSalesStopRoute(rpcResult, audit = auditMock()) {
  const route = load('src/app/api/admin/payments/sales-stop/route.ts', {
    'next/server': json,
    ...adminGuardMocks({ userId: ADMIN_ID }),
    '@/lib/admin-audit-log-server': audit.module,
    '@/lib/admin-accounts-shared': load('src/lib/admin-accounts-shared.ts'),
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ADMIN_ID, email: 'boss@admin.summersun.local' } } }) } }) },
    '@/lib/payment-orders-server': { createPaymentAdminClient: () => ({ rpc: async () => rpcResult }) },
  })
  return { post: () => route.POST({ json: async () => ({ reason: '점검' }) }), audit }
}

test('충전 판매 중지: 실제로 멈춘 경우만 사유와 함께 기록하고, 이미 멈춤·실패는 기록하지 않는다', async () => {
  const changed = loadSalesStopRoute({ data: { changed: true, master_accepts_new_orders: false }, error: null })
  assert.equal((await changed.post()).status, 200)
  assert.deepEqual(changed.audit.audits.map(({ action, reason }) => ({ action, reason })), [{ action: 'payment_sales_stop', reason: '점검' }])
  const already = loadSalesStopRoute({ data: { changed: false, master_accepts_new_orders: false }, error: null })
  assert.equal((await already.post()).status, 200)
  assert.equal(already.audit.audits.length, 0)
  const failed = loadSalesStopRoute({ data: null, error: { message: 'x' } })
  assert.equal((await failed.post()).status, 500)
  assert.equal(failed.audit.audits.length, 0)
})

test('나머지 기록 호출도 본 동작이 성공한 분기 뒤에 있다', () => {
  const after = (path, marker, count = 1) => {
    const source = read(path)
    const markerAt = source.indexOf(marker)
    assert.ok(markerAt >= 0, `${path}: ${marker}`)
    const calls = [...source.matchAll(/await recordAdminAudit\(/g)].map((match) => match.index)
    assert.equal(calls.length, count, `${path}: 기록 호출 수`)
    return { source, markerAt, calls }
  }
  // 요금제: 오류면 던진 뒤에만
  const pricing = read('src/app/(admin)/admin/pricing/actions.ts')
  for (const name of ['upsertPricingPlan', 'deletePricingPlan', 'togglePlanStatus']) {
    const body = pricing.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n\\}\\n`))[0]
    const thrown = body.lastIndexOf('throw new Error(')
    const recorded = body.indexOf('await recordAdminAudit(')
    assert.ok(recorded > thrown && thrown > 0, name)
  }
  assert.match(pricing, /if \(deleted && deleted\.length > 0\) \{\n\s+await recordAdminAudit\(/)
  // 약관·바닥글: 저장 뒤
  const footer = after('src/app/(admin)/admin/footer/actions.ts', 'const saved = await saveSiteFooterContent(input)', 2)
  // 파일 순서: 사이트 이름 저장(saveSiteBrandAction) → 약관·바닥글 저장. 각 기록은 자기 저장 뒤에 있다.
  const brandSavedAt = footer.source.indexOf('const saved = await saveSiteBrand(candidate)')
  assert.ok(brandSavedAt > 0 && footer.calls[0] > brandSavedAt && footer.calls[0] < footer.markerAt)
  assert.ok(footer.calls[1] > footer.markerAt)
  // 사이트 로고: 저장·되돌리기가 끝난 뒤
  const logo = after('src/app/api/admin/site-logo/route.ts', 'if (saveError) throw saveError', 2)
  assert.ok(logo.calls[0] > logo.markerAt)
  assert.ok(logo.calls[1] > logo.source.indexOf("return NextResponse.json({ error: '기본 로고로 되돌리지 못했습니다."))
  // 후기 삭제: 실패 분기 뒤
  const review = after('src/app/api/admin/reviews/[reviewId]/route.ts', "return NextResponse.json({ error: result.message }, { status: 400 })")
  assert.ok(review.calls[0] > review.markerAt)
  // 상품: 수정·삭제가 끝난 뒤(상태·가격이 바뀐 수정만)
  const item = after('src/app/api/admin/market/items/[id]/route.ts', 'const item = await updateMarketItem(id, {', 3)
  assert.ok(item.calls.every((index) => index > item.markerAt))
  assert.match(item.source, /if \(publicStateChanged\) \{\n\s+await recordAdminAudit\(\{[\s\S]*?action: 'market_item_status_change'/)
  assert.match(item.source, /if \(item && priceKeys\.some\(\(key\) => currentItem\[key\] !== item\[key\]\)\) \{\n\s+await recordAdminAudit\(\{[\s\S]*?action: 'market_item_price_change'/)
  assert.ok(item.calls[2] > item.source.indexOf('const { result } = await deleteOrHideMarketItem('))
  // 관리자 계정: 생성·비밀번호 재설정·삭제가 끝난 뒤
  const create = after('src/app/api/admin/admin-accounts/route.ts', 'const account = await createAdminAccount({')
  assert.ok(create.calls[0] > create.markerAt)
  const account = after('src/app/api/admin/admin-accounts/[userId]/route.ts', 'const target = await updateAdminAccount({', 2)
  assert.ok(account.calls[0] > account.markerAt)
  assert.ok(account.calls[1] > account.source.indexOf('const target = await deleteAdminAccount('))
})

// ---------------------------------------------------------------------------------------------------------------
// 조회 화면
// ---------------------------------------------------------------------------------------------------------------
test('조회: 합쳐 보기 보기(admin_audit_timeline)를 필터·서버 페이지 나눔으로 읽고, 처리자·대상 회원 이메일을 붙인다', async () => {
  const rows = [
    { source: 'admin', id: 'a1', created_at: '2026-11-17T01:00:00Z', actor_id: ADMIN_ID, actor_email: 'boss@admin.summersun.local', action: 'credit_grant', target_type: 'member', target_id: MEMBER_ID, target_user_id: MEMBER_ID, amount: 10, reason: '보상', details: {} },
    { source: 'payment', id: 'p1', created_at: '2026-11-17T00:00:00Z', actor_id: ADMIN_ID, actor_email: null, action: 'alert_resolved', target_type: 'payment_order', target_id: 'o1', target_user_id: null, amount: null, reason: '해소', details: {} },
  ]
  const queries = []
  const fake = createFakeAdmin(({ table, ops }) => {
    queries.push({ table, ops })
    if (table === 'admin_audit_timeline') {
      return ops.some(([name, , options]) => name === 'select' && options?.head) ? { count: 2, error: null } : { data: rows, error: null }
    }
    if (table === 'profiles' && ops.some(([name]) => name === 'in')) {
      return { data: [{ id: ADMIN_ID, email: 'boss@admin.summersun.local' }, { id: MEMBER_ID, email: 'member@example.com' }], error: null }
    }
    return { data: [{ id: ADMIN_ID, email: 'boss@admin.summersun.local' }], error: null }
  })
  const server = loadAuditServer(fake.client)
  const result = await server.listAdminAuditTimeline({ actor: ADMIN_ID, action: 'credit_grant', source: 'admin', from: '2026-11-17', to: '2026-11-17', page: '1', pageSize: '20' })
  const timelineOps = queries.filter((query) => query.table === 'admin_audit_timeline').map((query) => query.ops)
  assert.equal(timelineOps.length, 2)
  for (const ops of timelineOps) {
    assert.deepEqual(ops.filter(([name]) => name === 'eq'), [['eq', 'actor_id', ADMIN_ID], ['eq', 'action', 'credit_grant'], ['eq', 'source', 'admin']])
    assert.deepEqual(ops.filter(([name]) => name === 'gte' || name === 'lt'), [['gte', 'created_at', '2026-11-16T15:00:00.000Z'], ['lt', 'created_at', '2026-11-17T15:00:00.000Z']])
  }
  assert.deepEqual(timelineOps[1].filter(([name]) => name === 'range'), [['range', 0, 19]])
  assert.deepEqual(result.rows.map((row) => [row.source, row.actor, row.targetUserEmail]), [['admin', 'boss', 'member@example.com'], ['payment', 'boss', null]])
  assert.deepEqual(result.actors, [{ id: ADMIN_ID, loginId: 'boss' }])

  // 모르는 값의 필터는 무시한다(오류를 내지 않는다).
  queries.length = 0
  await server.listAdminAuditTimeline({ actor: 'not-a-uuid', action: 'drop_table', source: 'x' })
  for (const query of queries.filter((item) => item.table === 'admin_audit_timeline')) {
    assert.equal(query.ops.filter(([name]) => name === 'eq').length, 0)
  }
})

test('조회 route: 대표만, 읽지 못하면(표가 아직 없을 때 포함) "불러오지 못했습니다" 500', async () => {
  const loadRoute = (list, session = { userId: ADMIN_ID }) => load('src/app/api/admin/audit-log/route.ts', {
    'next/server': json,
    ...adminGuardMocks(session),
    '@/lib/admin-audit-log-server': { listAdminAuditTimeline: list },
  }, [])
  const request = { url: 'http://localhost/api/admin/audit-log?page=2' }
  const route = loadRoute(async (input) => ({ rows: [], page: input.page }))
  const result = await route.GET(request)
  assert.equal(result.status, 200)
  assert.equal(result.body.data.page, '2')

  const broken = await loadRoute(async () => { throw new Error('relation "public.admin_audit_timeline" does not exist') }).GET(request)
  assert.equal(broken.status, 500)
  assert.match(broken.body.error, /작업 기록을 불러오지 못했습니다/)

  const staff = await loadRoute(async () => ({}), { userId: ADMIN_ID, role: 'staff', grants: [{ permission: 'orders.view', limits: {} }] }).GET(request)
  assert.equal(staff.status, 403)

  const client = read('src/app/(admin)/admin/audit-log/audit-log-client.tsx')
  assert.match(client, /작업 기록을 불러오지 못했습니다/)
  // 대상 회원은 회원 상세로 잇는다.
  assert.match(client, /href=\{`\/admin\/users\/\$\{row\.targetUserId\}`\}/)
})

test('사이드바: 작업 기록 메뉴를 코드 기본 메뉴에 더한다(저장된 설정에 없으면 자동으로 붙는다)', () => {
  const sidebar = read('src/lib/admin-sidebar.ts')
  assert.match(sidebar, /'\/admin\/admin-accounts',\n {4}'\/admin\/audit-log',\n {2}\],/)
  assert.match(sidebar, /\{ name: '작업 기록', href: '\/admin\/audit-log', icon: 'fileText' \}/)
  assert.match(read('src/components/layout/admin-sidebar-client.tsx'), /href="\/admin\/my-password"/)
})
