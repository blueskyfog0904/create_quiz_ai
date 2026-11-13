import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { load, createFakeAdmin, op } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const listPagination = load('src/lib/list-pagination.ts')

const profile = (index) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  email: `user${index}@example.com`, display_tag: `T${String(index).padStart(3, '0')}`, phone: null, organization: null,
  role: null, is_admin: false, provider: 'email', created_at: '2026-11-01T00:00:00Z',
})

// total: 조건에 맞는 전체 회원 수, sources: credit_sources 응답, sourcesError: 잔액 조회 오류
function loadUsers({ total = 0, sources = [], sourcesError = null } = {}) {
  const queries = []
  const { client } = createFakeAdmin(({ table, ops }) => {
    queries.push({ table, ops })
    if (table === 'profiles') {
      const select = op(ops, 'select')
      if (select[2]?.head) return { count: total, error: null }
      const [, from, to] = op(ops, 'range')
      if (from >= total && total > 0) return { data: null, count: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' } }
      const rows = Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, offset) => profile(from + offset))
      return { data: rows, count: total, error: null }
    }
    if (table === 'credit_sources') {
      return sourcesError ? { data: null, error: { message: sourcesError } } : { data: sources, error: null }
    }
    return { data: [], error: null }
  })
  const errors = []
  const users = load('src/lib/admin-users-server.ts', {
    '@/lib/supabase/bypass': { createAdminClient: () => client },
    '@/lib/list-pagination': listPagination,
  }, errors)
  return { users, queries, errors }
}

test('목록은 화면에 쓰는 컬럼만 읽고, 서버에서 페이지를 나눈다', async () => {
  const { users, queries } = loadUsers({ total: 45 })
  const result = await users.listAdminUsers({ page: '2', pageSize: '20' })
  assert.equal(result.totalCount, 45)
  assert.equal(result.page, 2)
  assert.equal(result.totalPages, 3)
  assert.equal(result.users.length, 20)
  assert.equal(result.users[0].email, 'user20@example.com')
  const select = op(queries.find((query) => query.table === 'profiles').ops, 'select')
  assert.equal(select[1], 'id, email, display_tag, phone, organization, role, is_admin, provider, created_at')
  assert.deepEqual(op(queries.find((query) => query.table === 'profiles').ops, 'range'), ['range', 20, 39])
})

test('마지막 페이지를 넘는 요청은 마지막 페이지로 맞춘다', async () => {
  const { users } = loadUsers({ total: 45 })
  const result = await users.listAdminUsers({ page: '99' })
  assert.equal(result.page, 3)
  assert.equal(result.users.length, 5)
  assert.equal(result.users[0].email, 'user40@example.com')
})

test('검색은 이메일·전화·소속에서 찾고, 와일드카드 문자는 글자 그대로 취급한다', async () => {
  const { users, queries } = loadUsers({ total: 1 })
  const result = await users.listAdminUsers({ q: '  50%_a\\b  ' })
  assert.equal(result.query, '50%_a\\b')
  // profiles에는 name 컬럼이 없다
  assert.doesNotMatch(users.buildAdminUserSearchFilter('x'), /name\.ilike/)
  const filter = op(queries.find((query) => query.table === 'profiles').ops, 'or')[1]
  assert.equal(filter, ['email', 'phone', 'organization'].map((column) => `${column}.ilike.${JSON.stringify('%50\\%\\_a\\\\b%')}`).join(','))
  assert.equal(users.buildAdminUserSearchFilter('a,b(c)'), ['email', 'phone', 'organization'].map((column) => `${column}.ilike."%a,b(c)%"`).join(','))
  // 검색어가 없으면 조건을 걸지 않는다
  const plain = loadUsers({ total: 1 })
  await plain.users.listAdminUsers({})
  assert.equal(op(plain.queries.find((query) => query.table === 'profiles').ops, 'or'), undefined)
})

test('잔액은 사용 중이고 만료되지 않은 원천의 남은 수량 합이다(원천이 없으면 0)', async () => {
  const first = profile(0).id
  const { users, queries } = loadUsers({
    total: 2,
    sources: [{ user_id: first, remaining_credits: 300 }, { user_id: first, remaining_credits: 50 }, { user_id: first, remaining_credits: null }],
  })
  const result = await users.listAdminUsers({})
  assert.deepEqual(result.users.map((user) => user.credit_balance), [350, 0])
  const ops = queries.find((query) => query.table === 'credit_sources').ops
  assert.deepEqual(op(ops, 'eq'), ['eq', 'status', 'active'])
  assert.deepEqual(op(ops, 'gt'), ['gt', 'remaining_credits', 0])
  assert.match(op(ops, 'or')[1], /^expires_at\.is\.null,expires_at\.gt\.\d{4}-/)
  assert.deepEqual(op(ops, 'in')[2], [first, profile(1).id])
})

test('잔액을 읽지 못하면 0이 아니라 null(확인 불가)로 돌려주고 목록은 그대로 보여 준다', async () => {
  const { users, errors } = loadUsers({ total: 2, sourcesError: 'boom' })
  const result = await users.listAdminUsers({})
  assert.equal(result.users.length, 2)
  assert.deepEqual(result.users.map((user) => user.credit_balance), [null, null])
  assert.equal(errors.length, 1)
})

test('회원이 없으면 잔액 조회를 하지 않는다', async () => {
  const { users, queries } = loadUsers({ total: 0 })
  const result = await users.listAdminUsers({ q: '없는사람' })
  assert.deepEqual(result.users, [])
  assert.equal(result.totalCount, 0)
  assert.equal(queries.some((query) => query.table === 'credit_sources'), false)
})

test('화면: 없는 표·전체 컬럼 조회·화면 안 검색·고정 페이지 버튼이 없고, 서버 결과를 그대로 그린다', () => {
  const page = read('src/app/(admin)/admin/users/page.tsx')
  assert.doesNotMatch(page, /user_credits|select\('\*'|\.limit\(20\)/)
  assert.match(page, /await requireAdmin\(\)/)
  assert.match(page, /listAdminUsers\(\{ q: params\?\.q, page: params\?\.page, pageSize: params\?\.pageSize \}\)/)

  const client = read('src/app/(admin)/admin/users/users-client.tsx')
  assert.doesNotMatch(client, /useState\(initialUsers\)|users\.filter\(|1 \/ 1/)
  assert.match(client, /<StudioListPagination/)
  assert.match(client, /router\.push\(buildHref\(\{ q: search\.trim\(\) \|\| null, page: 1 \}\)\)/)
  assert.match(client, /user\.credit_balance === null \? '잔액 확인 불가'/)
  assert.match(client, /onSuccess=\{\(\) => router\.refresh\(\)\}/)
  assert.match(client, /query \? '검색 결과가 없습니다\.' : '가입한 사용자가 없습니다\.'/)
})
