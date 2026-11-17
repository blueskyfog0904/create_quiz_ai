import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { load } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const permissions = load('src/lib/admin-permissions.ts')
const {
  ADMIN_PERMISSIONS, ADMIN_PERMISSION_KEYS, buildAdminAccess, hasAdminPermission, checkAdminLimit, validateAdminPermissionGrants,
} = permissions

const USER_ID = '00000000-0000-4000-8000-000000000001'
const grant = (permission, limits = {}) => ({ permission, limits })
const staff = (...rows) => buildAdminAccess(USER_ID, { is_admin: true, admin_role: 'staff' }, rows)
const owner = buildAdminAccess(USER_ID, { is_admin: true, admin_role: 'owner' }, [])

test('권한 항목은 계획 표의 16개이고, 의존과 한도 키가 표와 같다', () => {
  assert.deepEqual(ADMIN_PERMISSION_KEYS, [
    'support.manage', 'content.manage', 'orders.view', 'members.view', 'credits.view', 'credits.grant', 'credits.revoke',
    'refunds.market', 'refunds.payment', 'products.edit', 'products.delete', 'storefront.edit', 'reviews.manage',
    'pricing.manage', 'site.manage', 'reports.view',
  ])
  const shape = (key) => [ADMIN_PERMISSIONS[key].requires, Object.keys(ADMIN_PERMISSIONS[key].limits)]
  assert.deepEqual(shape('credits.grant'), [['members.view', 'credits.view'], ['per_grant', 'per_day']])
  assert.deepEqual(shape('credits.revoke'), [['members.view', 'credits.view'], ['per_grant']])
  assert.deepEqual(shape('refunds.market'), [['orders.view'], ['per_request']])
  assert.deepEqual(shape('refunds.payment'), [['orders.view'], []])
  assert.deepEqual(shape('products.delete'), [['products.edit'], []])
  assert.deepEqual(shape('reports.view'), [['orders.view'], []])

  for (const key of ADMIN_PERMISSION_KEYS) {
    assert.ok(ADMIN_PERMISSIONS[key].label.length > 0, key)
    // 의존은 목록 안의 키여야 하고, 한 단계뿐이다(판정이 한 단계만 본다).
    for (const required of ADMIN_PERMISSIONS[key].requires) {
      assert.deepEqual(ADMIN_PERMISSIONS[required]?.requires, [], `${key} → ${required}`)
    }
  }
})

test('접근 정보: 관리자가 아니면 null, admin_role 없는 관리자는 권한 0개 staff', () => {
  assert.equal(buildAdminAccess(USER_ID, null, []), null)
  assert.equal(buildAdminAccess(USER_ID, { is_admin: false, admin_role: null }, []), null)
  assert.equal(buildAdminAccess(USER_ID, { is_admin: null, admin_role: 'owner' }, [grant('orders.view')]), null)

  assert.deepEqual(buildAdminAccess(USER_ID, { is_admin: true, admin_role: null }, []), { userId: USER_ID, role: 'staff', grants: {} })
  assert.equal(buildAdminAccess(USER_ID, { is_admin: true, admin_role: 'superuser' }, []).role, 'staff')
  assert.equal(owner.role, 'owner')

  const legacy = buildAdminAccess(USER_ID, { is_admin: true, admin_role: null }, [])
  for (const key of ADMIN_PERMISSION_KEYS) assert.equal(hasAdminPermission(legacy, key), false, key)
  assert.equal(hasAdminPermission(legacy, 'owner'), false)
})

test('접근 정보: 목록에 없는 권한 값은 무시하고, limits가 객체가 아니면 빈 객체로 본다', () => {
  const access = staff(
    grant('orders.view'),
    grant('members.manage'),
    grant('owner'),
    grant('constructor'),
    grant('refunds.market', { per_request: 5000 }),
    grant('support.manage', null),
    grant('reviews.manage', [1]),
    grant('site.manage', 'x')
  )
  assert.deepEqual(access.grants, {
    'orders.view': {},
    'refunds.market': { per_request: 5000 },
    'support.manage': {},
    'reviews.manage': {},
    'site.manage': {},
  })
})

test('권한 판정: owner는 전부, staff는 받은 권한만', () => {
  for (const key of [...ADMIN_PERMISSION_KEYS, 'owner']) assert.equal(hasAdminPermission(owner, key), true, key)

  const access = staff(grant('support.manage'), grant('orders.view'))
  assert.equal(hasAdminPermission(access, 'support.manage'), true)
  assert.equal(hasAdminPermission(access, 'orders.view'), true)
  assert.equal(hasAdminPermission(access, 'members.view'), false)
  // 대표 전용은 어떤 권한을 받아도 staff에게 열리지 않는다.
  assert.equal(hasAdminPermission(staff(...ADMIN_PERMISSION_KEYS.map((key) => grant(key))), 'owner'), false)
  assert.equal(hasAdminPermission(null, 'support.manage'), false)
})

test('권한 판정: 함께 필요한 권한이 하나라도 빠지면 없는 것으로 본다', () => {
  assert.equal(hasAdminPermission(staff(grant('refunds.payment')), 'refunds.payment'), false)
  assert.equal(hasAdminPermission(staff(grant('refunds.payment'), grant('orders.view')), 'refunds.payment'), true)
  assert.equal(hasAdminPermission(staff(grant('products.delete')), 'products.delete'), false)

  const limits = { per_grant: 1000, per_day: 5000 }
  assert.equal(hasAdminPermission(staff(grant('credits.grant', limits), grant('members.view')), 'credits.grant'), false)
  assert.equal(
    hasAdminPermission(staff(grant('credits.grant', limits), grant('members.view'), grant('credits.view')), 'credits.grant'),
    true
  )
})

test('한도 판정: owner는 한도 없음, staff는 한도 이하일 때만, 한도 값이 없거나 숫자가 아니면 불가', () => {
  assert.equal(checkAdminLimit(owner, 'refunds.market', 'per_request', 10_000_000), true)

  const access = staff(grant('orders.view'), grant('refunds.market', { per_request: 5000 }))
  assert.equal(checkAdminLimit(access, 'refunds.market', 'per_request', 4999), true)
  assert.equal(checkAdminLimit(access, 'refunds.market', 'per_request', 5000), true)
  assert.equal(checkAdminLimit(access, 'refunds.market', 'per_request', 5001), false)
  assert.equal(checkAdminLimit(access, 'refunds.market', 'per_request', Number.NaN), false)
  // 한도 키가 없다
  assert.equal(checkAdminLimit(access, 'refunds.market', 'per_day', 1), false)
  assert.equal(checkAdminLimit(staff(grant('orders.view'), grant('refunds.market')), 'refunds.market', 'per_request', 1), false)
  // 숫자가 아닌 한도
  for (const bad of ['5000', null, true, Number.POSITIVE_INFINITY, Number.NaN]) {
    const broken = staff(grant('orders.view'), grant('refunds.market', { per_request: bad }))
    assert.equal(checkAdminLimit(broken, 'refunds.market', 'per_request', 1), false, String(bad))
  }
  // 권한이 없거나 의존이 빠지면 한도가 있어도 불가
  assert.equal(checkAdminLimit(staff(grant('refunds.market', { per_request: 5000 })), 'refunds.market', 'per_request', 1), false)
  assert.equal(checkAdminLimit(staff(grant('orders.view')), 'refunds.market', 'per_request', 1), false)
  assert.equal(checkAdminLimit(null, 'refunds.market', 'per_request', 1), false)
  // 음수·0은 양도 한도도 통과시키지 않는다(부호 검증이 빠진 호출이 한도를 무력하게 만들지 않게).
  for (const amount of [0, -1, -1e9, Number.NEGATIVE_INFINITY]) {
    assert.equal(checkAdminLimit(access, 'refunds.market', 'per_request', amount), false, String(amount))
    assert.equal(checkAdminLimit(owner, 'refunds.market', 'per_request', amount), false, `owner ${amount}`)
  }
  for (const limit of [0, -5]) {
    const nonPositive = staff(grant('orders.view'), grant('refunds.market', { per_request: limit }))
    assert.equal(checkAdminLimit(nonPositive, 'refunds.market', 'per_request', limit), false, String(limit))
    assert.equal(checkAdminLimit(nonPositive, 'refunds.market', 'per_request', -10), false, String(limit))
  }
})

test('권한 판정: 목록에 없는 요구 조건은 owner에게도 통과시키지 않는다', () => {
  const owner = buildAdminAccess('u', { is_admin: true, admin_role: 'owner' }, [])
  const member = buildAdminAccess('u', { is_admin: true, admin_role: 'staff' }, [{ permission: 'support.manage', limits: {} }])
  for (const bogus of ['bogus', '__proto__', 'constructor', 'toString', 'owner ', '', undefined]) {
    assert.equal(hasAdminPermission(owner, bogus), false, `owner ${String(bogus)}`)
    assert.equal(hasAdminPermission(member, bogus), false, `staff ${String(bogus)}`)
  }
})

test('부여 조합 검증: 맞는 조합은 오류 없음', () => {
  assert.deepEqual(validateAdminPermissionGrants([]), [])
  assert.deepEqual(validateAdminPermissionGrants([
    grant('support.manage'),
    { permission: 'orders.view' },
    grant('members.view'),
    grant('credits.view'),
    grant('credits.grant', { per_grant: 1000, per_day: 5000 }),
    grant('credits.revoke', { per_grant: 500 }),
    grant('refunds.market', { per_request: 5000 }),
  ]), [])
})

test('부여 조합 검증: 의존 빠짐, 한도 비었거나 양의 정수가 아님, 목록에 없는 키, 중복을 오류로 돌려준다', () => {
  assert.deepEqual(validateAdminPermissionGrants([grant('products.delete')]), [
    'products.delete 권한에는 products.edit 권한이 함께 필요합니다.',
  ])
  assert.deepEqual(validateAdminPermissionGrants([grant('credits.grant', { per_grant: 1000, per_day: 5000 }), grant('members.view')]), [
    'credits.grant 권한에는 credits.view 권한이 함께 필요합니다.',
  ])

  const withLimits = (limits) => validateAdminPermissionGrants([grant('orders.view'), { permission: 'refunds.market', limits }])
  for (const bad of [undefined, null, {}, [5000], { per_request: 0 }, { per_request: -1 }, { per_request: 1.5 }, { per_request: '5000' }, { per_request: null }]) {
    assert.deepEqual(withLimits(bad), ['refunds.market 권한의 1건 승인 한도는 1 이상의 정수로 입력해야 합니다.'], JSON.stringify(bad))
  }
  // 한도 키가 둘이면 빠진 것마다 알린다.
  assert.equal(
    validateAdminPermissionGrants([grant('members.view'), grant('credits.view'), grant('credits.grant', { per_grant: 1000 })]).length,
    1
  )
  assert.equal(validateAdminPermissionGrants([grant('members.view'), grant('credits.view'), grant('credits.grant')]).length, 2)

  assert.deepEqual(validateAdminPermissionGrants([grant('members.manage')]), ['알 수 없는 권한입니다: members.manage'])
  assert.deepEqual(validateAdminPermissionGrants([grant('owner')]), ['알 수 없는 권한입니다: owner'])
  assert.deepEqual(validateAdminPermissionGrants([grant('orders.view'), grant('orders.view')]), ['같은 권한이 두 번 들어 있습니다.'])
})

// --- 서버 모듈: 가짜 세션으로 가드를 실제로 돌린다 -------------------------------------------------------------
class RedirectSignal extends Error {}

function loadServer({ user = { id: USER_ID }, profile = { is_admin: true, admin_role: 'staff' }, grants = [], profileError = null, grantsError = null } = {}) {
  const queries = []
  const errors = []
  const client = {
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table) => {
      const filters = []
      const result = table === 'profiles' ? { data: profileError ? null : profile, error: profileError } : { data: grantsError ? null : grants, error: grantsError }
      const query = {
        select: () => query,
        eq: (column, value) => { filters.push([column, value]); return query },
        maybeSingle: async () => result,
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      }
      queries.push({ table, filters })
      return query
    },
  }
  const server = load('src/lib/admin-permissions-server.ts', {
    react: { cache: (fn) => fn },
    'next/navigation': { redirect: (path) => { throw new RedirectSignal(path) } },
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/admin-permissions': permissions,
  }, errors)
  return { server, queries, errors }
}

test('getAdminAccess: 본인 프로필과 본인 권한 행만 읽어 접근 정보를 만든다', async () => {
  const { server, queries } = loadServer({ grants: [grant('orders.view'), grant('refunds.market', { per_request: 5000 })] })
  assert.deepEqual(await server.getAdminAccess(), {
    userId: USER_ID, role: 'staff', grants: { 'orders.view': {}, 'refunds.market': { per_request: 5000 } },
  })
  assert.deepEqual(queries, [
    { table: 'profiles', filters: [['id', USER_ID]] },
    { table: 'admin_permission_grants', filters: [['user_id', USER_ID]] },
  ])

  assert.equal(await loadServer({ user: null }).server.getAdminAccess(), null)
  assert.equal(await loadServer({ profile: { is_admin: false, admin_role: null } }).server.getAdminAccess(), null)
  assert.equal(await loadServer({ profile: null }).server.getAdminAccess(), null)
})

test('조회 오류는 권한 0개로 떨어뜨리지 않는다: 페이지는 예외, route는 500, 액션은 전용 예외', async () => {
  for (const failure of [{ profileError: { code: 'XX000' } }, { grantsError: { code: '42501' } }]) {
    const { server, errors } = loadServer({ profile: { is_admin: true, admin_role: 'owner' }, ...failure })
    await assert.rejects(server.getAdminAccess(), /ADMIN_ACCESS_LOOKUP_FAILED/)
    await assert.rejects(server.requireAdminPagePermission('orders.view'), /ADMIN_ACCESS_LOOKUP_FAILED/)
    assert.equal((await server.requireAdminApiPermission('orders.view')).status, 500)
    await assert.rejects(
      server.assertAdminActionPermission('orders.view'),
      (error) => error instanceof server.AdminPermissionError && error.reason === 'unavailable'
    )
    assert.ok(errors.length > 0)
  }
})

test('페이지 가드: 미로그인 → 관리자 로그인, 관리자 아님 → forbidden 로그인, 권한 없음 → 권한 없음 안내', async () => {
  const redirected = (options, requirement) => loadServer(options).server.requireAdminPagePermission(requirement).then(
    () => 'no redirect',
    (error) => (error instanceof RedirectSignal ? error.message : `unexpected: ${error}`)
  )

  assert.equal(await redirected({ user: null }, 'orders.view'), '/admin/login')
  assert.equal(await redirected({ profile: { is_admin: false, admin_role: null } }, 'orders.view'), '/admin/login?error=forbidden')
  assert.equal(await redirected({}, 'orders.view'), '/admin/forbidden')
  assert.equal(await redirected({ grants: [grant('refunds.payment')] }, 'refunds.payment'), '/admin/forbidden')
  assert.equal(await redirected({ grants: ADMIN_PERMISSION_KEYS.map((key) => grant(key)) }, 'owner'), '/admin/forbidden')

  const access = await loadServer({ grants: [grant('orders.view')] }).server.requireAdminPagePermission('orders.view')
  assert.equal(access.userId, USER_ID)
  const ownerAccess = await loadServer({ profile: { is_admin: true, admin_role: 'owner' } }).server.requireAdminPagePermission('owner')
  assert.equal(ownerAccess.role, 'owner')
  // 안내 화면은 가드를 부르지 않는다(부르면 권한 없는 계정이 끝없이 되돌아온다).
  assert.doesNotMatch(read('src/app/(admin)/admin/forbidden/page.tsx'), /admin-permissions-server/)
})

test('route 가드: 401 / 403 / 통과', async () => {
  const check = (options, requirement) => loadServer(options).server.requireAdminApiPermission(requirement)
  assert.deepEqual(await check({ user: null }, 'orders.view'), { error: 'Unauthorized', status: 401 })
  assert.deepEqual(await check({ profile: { is_admin: false, admin_role: null } }, 'orders.view'), { error: 'Forbidden: Admin only', status: 403 })
  assert.equal((await check({}, 'orders.view')).status, 403)
  assert.equal((await check({ grants: [grant('orders.view')] }, 'owner')).status, 403)

  const passed = await check({ grants: [grant('orders.view')] }, 'orders.view')
  assert.equal('error' in passed, false)
  assert.equal(passed.access.userId, USER_ID)
  assert.equal((await check({ profile: { is_admin: true, admin_role: 'owner' } }, 'owner')).access.role, 'owner')
})

test('액션 가드: redirect 없이 전용 예외를 던진다', async () => {
  const check = (options, requirement) => loadServer(options).server.assertAdminActionPermission(requirement)
  const rejectsWith = (reason) => (error) => error instanceof Error && error.name === 'AdminPermissionError' && error.reason === reason && error.message.length > 0

  await assert.rejects(check({ user: null }, 'pricing.manage'), rejectsWith('unauthenticated'))
  await assert.rejects(check({ profile: { is_admin: false, admin_role: null } }, 'pricing.manage'), rejectsWith('forbidden'))
  await assert.rejects(check({}, 'pricing.manage'), rejectsWith('forbidden'))
  await assert.rejects(check({ grants: [grant('pricing.manage')] }, 'owner'), rejectsWith('forbidden'))
  assert.equal((await check({ grants: [grant('pricing.manage')] }, 'pricing.manage')).role, 'staff')
})

test('서버 모듈 계약: 요청당 한 번 읽기, 세션 클라이언트만, 아직 어디에도 적용하지 않음', () => {
  const source = read('src/lib/admin-permissions-server.ts')
  assert.match(source, /import \{ cache \} from 'react'/)
  assert.match(source, /const readAdminSession = cache\(async/)
  // 가드와 getAdminAccess는 모두 같은 캐시된 읽기를 쓴다.
  assert.equal(source.match(/await readAdminSession\(\)/g).length, 4)
  for (const name of ['getAdminAccess', 'requireAdminPagePermission', 'requireAdminApiPermission', 'assertAdminActionPermission']) {
    assert.match(source, new RegExp(`export async function ${name}\\(`), name)
  }
  assert.match(source, /export class AdminPermissionError extends Error/)
  // 본인 행은 세션 클라이언트로 읽는다(service role 불필요). 기능 묶음 차단은 미들웨어 몫이라 여기 없다.
  assert.doesNotMatch(source, /createAdminClient|supabase\/bypass|admin-features/)
  // 순수 모듈은 DB·next에 기대지 않는다.
  assert.doesNotMatch(read('src/lib/admin-permissions.ts'), /^import /m)

  // 전면 적용은 U3-3. 그 전에는 관리자 계정 관리(대표 전용)와 처음부터 가드로 만든 화면(주문 조회·회원 상세·문의 상세의 회원 요약·대시보드 지표)에만 쓴다.
  const users = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry) && /admin-permissions(-server)?['"]/.test(readFileSync(full, 'utf8'))) users.push(full)
    }
  }
  const src = new URL('../src/', import.meta.url).pathname
  walk(src)
  assert.deepEqual(users.map((file) => file.slice(src.length)).sort(), [
    'app/(admin)/admin/admin-accounts/page.tsx',
    'app/(admin)/admin/orders/page.tsx',
    'app/(admin)/admin/users/[id]/page.tsx',
    'app/api/admin/admin-accounts/[userId]/route.ts',
    'app/api/admin/admin-accounts/route.ts',
    'app/api/admin/orders/market/route.ts',
    'app/api/admin/orders/payments/route.ts',
    'app/api/admin/stats/route.ts',
    'app/api/admin/support/tickets/[id]/member-summary/route.ts',
    'lib/admin-dashboard-server.ts',
    'lib/admin-member-detail-server.ts',
    'lib/admin-permissions-server.ts',
  ])
})

test('관리자 계정 관리는 대표만: 페이지·route 가드, 새 계정은 staff, 관리자는 탈퇴 불가', () => {
  const page = read('src/app/(admin)/admin/admin-accounts/page.tsx')
  assert.match(page, /export default async function AdminAccountsPage\(\) \{\s*await requireAdminPagePermission\('owner'\)/)

  for (const path of ['src/app/api/admin/admin-accounts/route.ts', 'src/app/api/admin/admin-accounts/[userId]/route.ts']) {
    const route = read(path)
    assert.match(route, /const guard = await requireAdminApiPermission\('owner'\)/, path)
    // 모든 핸들러가 대표 확인을 거치고, is_admin만 보는 옛 확인은 남아 있지 않다.
    const handlers = route.match(/export async function (GET|POST|PATCH|DELETE)\(/g).length
    assert.equal(route.match(/const guard = await requireOwner\(\)\s*if \('error' in guard\) return guard\.error/g).length, handlers, path)
    assert.doesNotMatch(route, /requireAdminUser|\.select\('is_admin'\)/, path)
  }

  // 대표만 계정을 지울 수 있고 본인은 지울 수 없으므로, 삭제로 대표가 0명이 되지 않는다.
  const lib = read('src/lib/admin-accounts-server.ts')
  assert.match(lib, /if \(userId === actorId\) \{\s*throw new AdminAccountError\(400, '본인 계정은 삭제할 수 없습니다\.'\)/)
  assert.match(lib, /\.update\(\{ is_admin: true, admin_role: 'staff' \}\)/)
  assert.doesNotMatch(lib, /admin_role: 'owner'/)

  const withdraw = read('src/app/api/auth/withdraw/route.ts')
  const adminCheck = withdraw.indexOf("if (profile?.is_admin) {")
  assert.ok(adminCheck > 0 && adminCheck < withdraw.indexOf('createAdminClient()'), '관리자 확인이 삭제보다 앞이다')
  assert.match(withdraw, /if \(profileLookupError\) \{\s*throw new Error/)
})
