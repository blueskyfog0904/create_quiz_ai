import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { load, createFakeAdmin, op } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const listPagination = load('src/lib/list-pagination.ts')
const kstPeriod = load('src/lib/kst-period.ts')
const kind = load('src/lib/admin-credit-transaction-kind.ts')

test('한국 시간 기준 오늘·이번 달 시작 시각', () => {
  // UTC 14:59 = 한국 23:59(같은 날), UTC 15:00 = 한국 다음 날 00:00
  assert.deepEqual(kstPeriod.getKstPeriodStarts(new Date('2026-11-12T14:59:59Z')), { todayStart: '2026-11-11T15:00:00.000Z', monthStart: '2026-10-31T15:00:00.000Z', year: 2026, month: 11 })
  assert.deepEqual(kstPeriod.getKstPeriodStarts(new Date('2026-11-12T15:00:00Z')), { todayStart: '2026-11-12T15:00:00.000Z', monthStart: '2026-10-31T15:00:00.000Z', year: 2026, month: 11 })
  // 월말 UTC 15:00 = 한국 다음 달 1일
  assert.equal(kstPeriod.getKstPeriodStarts(new Date('2026-11-30T15:00:00Z')).monthStart, '2026-11-30T15:00:00.000Z')
  assert.equal(kstPeriod.getKstPeriodStarts(new Date('2026-11-30T15:00:00Z')).month, 12)
  // 연말 UTC 15:00 = 한국 새해 1월 1일
  assert.deepEqual(kstPeriod.getKstPeriodStarts(new Date('2026-12-31T15:00:00Z')), { todayStart: '2026-12-31T15:00:00.000Z', monthStart: '2026-12-31T15:00:00.000Z', year: 2027, month: 1 })
})

test('거래 유형 이름: 충전과 관리자 지급은 원천 분류로, 환불은 부호로 구분한다', () => {
  const label = (type, amount, source_category = null) => kind.getAdminCreditTransactionKind({ type, amount, source_category }).label
  assert.equal(label('purchase', 100, 'plan_purchase'), '충전')
  assert.equal(label('purchase', 100, 'admin_grant'), '관리자 지급')
  assert.equal(label('purchase', 100, 'bonus'), '관리자 지급')
  assert.equal(label('purchase', 100, 'system_refund'), '환불 지급')
  assert.equal(label('purchase', 100, null), '충전·지급')
  assert.equal(label('consume', -100), '사용')
  assert.equal(label('refund', 100), '사용 취소')
  assert.equal(label('refund', -100), '환불 회수')
  assert.equal(label('other', 1), 'other')
})

const tx = (index, extra = {}) => ({
  id: `tx-${index}`, user_id: 'u1', type: 'consume', amount: -100, description: `거래 ${index}`, created_at: '2026-11-10T00:00:00Z',
  resource_type: null, resource_id: null, source_id: null, ...extra,
})

// rows: 조건에 맞는 거래(최신순), monthRows: 이번 달 집계용 행, matchedUsers: 이메일 검색에 걸린 회원
function loadCredits({ rows = [], monthRows = [], monthError = null, matchedUsers = [], profiles = [], sources = [] } = {}) {
  const queries = []
  const { client } = createFakeAdmin(({ table, ops }) => {
    queries.push({ table, ops })
    if (table === 'credit_transactions') {
      const select = op(ops, 'select')
      if (select[1] === 'type, amount') {
        if (monthError) return { data: null, error: { message: monthError } }
        const [, from, to] = op(ops, 'range')
        return { data: monthRows.slice(from, to + 1), error: null }
      }
      if (select[2]?.head) return { count: rows.length, error: null }
      const [, from, to] = op(ops, 'range')
      if (from >= rows.length && rows.length > 0) return { data: null, count: null, error: { code: 'PGRST103', message: 'range' } }
      return { data: rows.slice(from, to + 1), count: rows.length, error: null }
    }
    if (table === 'profiles') {
      return op(ops, 'ilike') ? { data: matchedUsers, error: null } : { data: profiles, error: null }
    }
    if (table === 'credit_sources') return { data: sources, error: null }
    return { data: [], error: null }
  })
  const errors = []
  const credits = load('src/lib/admin-credit-transactions-server.ts', {
    '@/lib/supabase/bypass': { createAdminClient: () => client },
    '@/lib/kst-period': kstPeriod,
    '@/lib/list-pagination': listPagination,
  }, errors)
  const listQuery = () => queries.find((query) => query.table === 'credit_transactions' && op(query.ops, 'select')[1] !== 'type, amount')
  return { credits, queries, errors, listQuery }
}

test('없는 컬럼(transaction_type) 대신 type으로 걸러 서버에서 페이지를 나눈다', async () => {
  const rows = Array.from({ length: 45 }, (_, index) => tx(index))
  const { credits, listQuery } = loadCredits({ rows })
  const result = await credits.listAdminCreditTransactions({ type: 'consume', page: '3' })
  assert.equal(result.type, 'consume')
  assert.equal(result.totalCount, 45)
  assert.equal(result.page, 3)
  assert.equal(result.transactions.length, 5)
  assert.deepEqual(op(listQuery().ops, 'eq'), ['eq', 'type', 'consume'])
  assert.deepEqual(op(listQuery().ops, 'range'), ['range', 40, 59])

  // 모르는 유형 값은 전체로 취급한다
  const all = loadCredits({ rows })
  assert.equal((await all.credits.listAdminCreditTransactions({ type: 'system_refund' })).type, 'all')
  assert.equal(op(all.listQuery().ops, 'eq'), undefined)
})

test('검색은 내역과, 이메일이 맞는 회원의 거래를 함께 찾는다', async () => {
  const { credits, listQuery, queries } = loadCredits({ rows: [tx(1)], matchedUsers: [{ id: 'u1' }, { id: 'u2' }] })
  await credits.listAdminCreditTransactions({ q: ' 50%_ ' })
  assert.deepEqual(op(queries.find((query) => query.table === 'profiles').ops, 'ilike'), ['ilike', 'email', '%50\\%\\_%'])
  assert.equal(op(listQuery().ops, 'or')[1], `description.ilike.${JSON.stringify('%50\\%\\_%')},user_id.in.(u1,u2)`)

  const noUser = loadCredits({ rows: [tx(1)] })
  await noUser.credits.listAdminCreditTransactions({ q: '환불' })
  assert.equal(op(noUser.listQuery().ops, 'or')[1], 'description.ilike."%환불%"')
})

test('회원 이름과 원천 분류를 붙여 돌려준다', async () => {
  const { credits } = loadCredits({
    rows: [tx(1, { type: 'purchase', amount: 100, source_id: 's1' }), tx(2, { user_id: 'gone' })],
    profiles: [{ id: 'u1', email: 'kim@example.com', display_tag: 'AB12' }],
    sources: [{ id: 's1', source_category: 'admin_grant' }],
  })
  const result = await credits.listAdminCreditTransactions({})
  assert.deepEqual(result.transactions[0].user, { email: 'kim@example.com', display_tag: 'AB12' })
  assert.equal(result.transactions[0].source_category, 'admin_grant')
  assert.equal(result.transactions[1].user, null)
  assert.equal(result.transactions[1].source_category, null)
})

test('이번 달 집계는 1000행씩 끝까지 읽어 유형별로 더한다', async () => {
  const monthRows = [
    ...Array.from({ length: 1200 }, () => ({ type: 'consume', amount: -10 })),
    { type: 'purchase', amount: 5000 }, { type: 'purchase', amount: 100 },
    { type: 'refund', amount: 300 }, { type: 'refund', amount: -1000 },
  ]
  const { credits, queries } = loadCredits({ rows: [tx(1)], monthRows })
  const result = await credits.listAdminCreditTransactions({})
  assert.deepEqual(
    { added: result.monthlyStats.added, consumed: result.monthlyStats.consumed, restored: result.monthlyStats.restored, recovered: result.monthlyStats.recovered },
    { added: 5100, consumed: -12000, restored: 300, recovered: -1000 },
  )
  const statQueries = queries.filter((query) => query.table === 'credit_transactions' && op(query.ops, 'select')[1] === 'type, amount')
  assert.deepEqual(statQueries.map((query) => op(query.ops, 'range').slice(1)), [[0, 999], [1000, 1999]])
  assert.match(op(statQueries[0].ops, 'gte')[2], /T15:00:00\.000Z$/, '한국 시간 기준 달의 시작')
})

test('집계를 읽지 못하면 0이 아니라 null(확인 불가)로 돌려주고 목록은 그대로 보여 준다', async () => {
  const { credits, errors } = loadCredits({ rows: [tx(1)], monthError: 'boom' })
  const result = await credits.listAdminCreditTransactions({})
  assert.equal(result.monthlyStats, null)
  assert.equal(result.transactions.length, 1)
  assert.equal(errors.length, 1)
})

test('화면: 없는 컬럼·최근 100건 고정·동작 없는 엑셀 버튼·전체 새로고침이 없다', () => {
  const page = read('src/app/(admin)/admin/credits/page.tsx')
  assert.doesNotMatch(page, /transaction_type|system_refund|\.limit\(100\)|select\('\*'\)/)
  assert.match(page, /await requireAdmin\(\)/)
  assert.match(page, /listAdminCreditTransactions\(\{/)

  const client = read('src/app/(admin)/admin/credits/credits-client.tsx')
  assert.doesNotMatch(client, /transaction_type|엑셀 다운로드|window\.location\.reload|최근 100건|\(Grant\)|\(Consume\)|\(System\)/)
  assert.match(client, /<StudioListPagination/)
  assert.match(client, /onSuccess=\{\(\) => router\.refresh\(\)\}/)
  assert.match(client, /value === undefined \? '확인 불가'/)
  // 클라이언트는 서버 전용 lib에서 타입만 가져온다(service role 코드가 브라우저 묶음에 들어가지 않게)
  assert.match(client, /import type \{[^}]+\} from '@\/lib\/admin-credit-transactions-server'/)
  assert.doesNotMatch(client, /import \{[^}]+\} from '@\/lib\/admin-credit-transactions-server'/)
  assert.doesNotMatch(read('src/lib/admin-credit-transaction-kind.ts'), /import /)
})
