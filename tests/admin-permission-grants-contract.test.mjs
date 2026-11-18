import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextResponse, adminGuardMocks, createFakeAdmin, load } from './helpers/market-images-harness.mjs'

// 계획 U3-4(권한 부여 화면·내 비밀번호 변경·권한 해제)와 마이그레이션 20261117120000의 계약.

const ROOT = new URL('../', import.meta.url).pathname
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const MIGRATION = read('supabase/migrations/20261117120000_admin_permission_grants_replace.sql')
const ROLLBACK = read('supabase/rollback/20261117120000_admin_permission_grants_replace_down.sql')
const permissions = load('src/lib/admin-permissions.ts')

const OWNER_ID = '00000000-0000-4000-8000-000000000001'
const STAFF_ID = '00000000-0000-4000-8000-0000000000aa'
const OTHER_OWNER_ID = '00000000-0000-4000-8000-0000000000bb'
const MEMBER_ID = '00000000-0000-4000-8000-0000000000cc'

function functionBody(name) {
  const match = MIGRATION.match(new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\$fn_${name}\\$;`))
  assert.ok(match, name)
  return match[0]
}

// ---------------------------------------------------------------------------------------------------------------
// 마이그레이션
// ---------------------------------------------------------------------------------------------------------------
test('권한 교체·해제 함수: SECURITY DEFINER, search_path 고정, EXECUTE는 service_role만', () => {
  for (const [name, signature] of [['replace_admin_permission_grants', 'uuid, uuid, jsonb'], ['revoke_admin_account', 'uuid, uuid']]) {
    const body = functionBody(name)
    assert.match(body, /\n SECURITY DEFINER\n SET search_path TO 'public', 'pg_temp'\n/, name)
    assert.ok(MIGRATION.includes(`REVOKE ALL ON FUNCTION public.${name}(${signature}) FROM PUBLIC, anon, authenticated, service_role;`), name)
    assert.ok(MIGRATION.includes(`GRANT EXECUTE ON FUNCTION public.${name}(${signature}) TO service_role;`), name)
    const grants = [...MIGRATION.matchAll(new RegExp(`GRANT [A-Z ,]+ ON FUNCTION public\\.${name}\\([^)]*\\) TO ([^;]+);`, 'g'))].map((match) => match[1])
    assert.deepEqual(grants, ['service_role'], `${name}: service_role 말고는 EXECUTE가 없다`)
  }
  assert.doesNotMatch(MIGRATION, /TO (anon|authenticated)\b/)
})

test('권한 교체·해제 함수는 함수 안에서 행위자=대표·대상=일반 관리자·본인 아님을 다시 확인하고 대상 행을 잠근다', () => {
  for (const name of ['replace_admin_permission_grants', 'revoke_admin_account']) {
    const body = functionBody(name)
    assert.match(body, /IF p_actor_id = p_user_id THEN\s+RAISE EXCEPTION 'ADMIN_PERMISSION_SELF_NOT_ALLOWED'/, name)
    // 행위자 확인은 그 행을 FOR SHARE로 잠그며 한다(확인 직후 대표가 삭제·강등되는 틈 방지).
    const actorCheck = body.search(/PERFORM 1 FROM public\.profiles p\n\s+WHERE p\.id = p_actor_id AND p\.is_admin IS TRUE AND p\.admin_role = 'owner'\n\s+FOR SHARE;\n\s+IF NOT FOUND THEN\n\s+RAISE EXCEPTION 'ADMIN_PERMISSION_ACTOR_NOT_OWNER';/)
    assert.ok(actorCheck > 0, `${name}: 잠금과 함께 하는 행위자 확인`)
    assert.doesNotMatch(body, /IF NOT EXISTS \(\s*SELECT 1 FROM public\.profiles p\s+WHERE p\.id = p_actor_id/, `${name}: 잠그지 않는 확인이 남아 있다`)
    // 잠금 순서: 행위자 프로필 → 대상 권한 행 → 대상 프로필 행
    const lockGrants = body.indexOf('FROM public.admin_permission_grants g WHERE g.user_id = p_user_id FOR UPDATE')
    assert.ok(actorCheck < lockGrants, `${name}: 행위자 확인이 대상 잠금보다 먼저`)
    const lockProfile = body.search(/FROM public\.profiles p\s+WHERE p\.id = p_user_id\s+FOR UPDATE/)
    assert.ok(lockGrants > 0 && lockProfile > lockGrants, `${name}: 권한 행 → 프로필 행 순서로 잠근다`)
    assert.match(body, /IF NOT FOUND OR v_is_admin IS NOT TRUE OR v_role IS DISTINCT FROM 'staff' THEN\s+RAISE EXCEPTION 'ADMIN_PERMISSION_TARGET_NOT_STAFF'/, name)
    // 작업 기록은 같은 함수(같은 트랜잭션) 안에서 남긴다.
    assert.ok(body.indexOf('PERFORM public.record_admin_audit(') > lockProfile, name)
  }
  const replace = functionBody('replace_admin_permission_grants')
  assert.match(replace, /'admin_permissions_replace'/)
  assert.match(replace, /jsonb_build_object\('target_email', v_email, 'before', v_before, 'after', v_after\)/)
  // before는 지우기 전에, after는 넣은 뒤에 읽는다.
  assert.ok(replace.indexOf('INTO v_before') < replace.indexOf('DELETE FROM public.admin_permission_grants'))
  assert.ok(replace.indexOf('INSERT INTO public.admin_permission_grants') < replace.indexOf('INTO v_after'))
  const revoke = functionBody('revoke_admin_account')
  assert.match(revoke, /'admin_account_revoke'/)
  assert.match(revoke, /SET is_admin = false,\s+admin_role = NULL/)
  assert.match(revoke, /DELETE FROM public\.admin_permission_grants g WHERE g\.user_id = p_user_id/)
})

// 권한 교체 함수를 가장 마지막에 정의한 마이그레이션의 정의(권한 항목을 더할 때마다 새 마이그레이션이 이 함수를 다시 만든다).
function latestReplaceDefinition() {
  const files = readdirSync(join(ROOT, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).sort()
  for (const name of files.reverse()) {
    const source = read(`supabase/migrations/${name}`)
    const match = source.match(/CREATE (?:OR REPLACE )?FUNCTION public\.replace_admin_permission_grants\([\s\S]*?\$fn_replace_admin_permission_grants\$;/)
    if (match) return { name, body: match[0] }
  }
  assert.fail('권한 교체 함수 정의를 찾지 못했다')
}

const permissionList = (body) => {
  const list = body.match(/= ANY \(ARRAY\[([\s\S]*?)\]::text\[\]\)/)
  assert.ok(list)
  return [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
}

test('권한 교체 함수는 모르는 권한 이름을 거부하고, 그 목록(가장 최근 정의)은 코드의 권한 목록과 같다', () => {
  const body = functionBody('replace_admin_permission_grants')
  const latest = latestReplaceDefinition()
  assert.equal(latest.name, '20261118120000_admin_credit_grant_limits.sql')
  const sqlKeys = permissionList(latest.body)
  assert.deepEqual([...sqlKeys].sort(), [...permissions.ADMIN_PERMISSION_KEYS].sort())
  // 최근 정의는 처음 정의에서 credits.limits.manage 한 이름만 더했다(나머지 본문은 같다).
  assert.deepEqual([...permissionList(body), 'credits.limits.manage'].sort(), [...sqlKeys].sort())
  assert.equal(
    latest.body.replace("'reports.view', 'credits.limits.manage'", "'reports.view'"),
    body.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
  )
  assert.match(body, /RAISE EXCEPTION 'ADMIN_PERMISSION_UNKNOWN'/)
  // 'owner'는 부여할 수 있는 권한이 아니다.
  assert.ok(!sqlKeys.includes('owner'))
  // 모양 검사: 배열·객체·문자열·빈 값·한도 객체·중복
  assert.match(body, /jsonb_typeof\(p_grants\) <> 'array'/)
  assert.match(body, /count\(DISTINCT btrim\(g ->> 'permission'\)\) <> count\(\*\)/)
})

test('권한 교체 함수는 한도 값이 1 이상 상한 이하의 정수가 아니면 거부하고, 상한은 앱과 같은 값이다', () => {
  const body = functionBody('replace_admin_permission_grants')
  const check = body.match(/jsonb_each\(COALESCE\(g -> 'limits', '\{\}'::jsonb\)\) AS l\(limit_key, limit_value\)[\s\S]*?RAISE EXCEPTION '([A-Z_]+)'/)
  assert.ok(check)
  assert.equal(check[1], 'ADMIN_PERMISSION_INVALID_ARGUMENT')
  assert.match(check[0], /jsonb_typeof\(l\.limit_value\) <> 'number'/)
  assert.match(check[0], /<> trunc\(\(l\.limit_value #>> '\{\}'\)::numeric\)/)
  assert.match(check[0], /::numeric < 1\n/)
  assert.equal(Number(check[0].match(/::numeric > (\d+)/)[1]), permissions.ADMIN_PERMISSION_LIMIT_MAX)
  // 한도 객체 모양 검사가 값 검사보다 먼저다(객체가 아니면 jsonb_each가 실패한다).
  assert.ok(body.indexOf("jsonb_typeof(g -> 'limits') <> 'object'") < body.indexOf('jsonb_each('))
})

test('앱 검증: 한도는 1 이상 ADMIN_PERMISSION_LIMIT_MAX(2147483647, DB integer 최대) 이하의 정수', () => {
  assert.equal(permissions.ADMIN_PERMISSION_LIMIT_MAX, 2147483647)
  const refund = (value) => permissions.validateAdminPermissionGrants([grant('orders.view'), grant('refunds.market', { per_request: value })])
  assert.deepEqual(refund(1), [])
  assert.deepEqual(refund(2147483647), [])
  assert.deepEqual(refund(2147483648), ['refunds.market 권한의 1건 승인 한도는 2,147,483,647 이하로 입력해야 합니다.'])
  assert.deepEqual(refund(Number.MAX_SAFE_INTEGER).length, 1)
  for (const bad of [0, -1, 1.5, '10', null, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(refund(bad), ['refunds.market 권한의 1건 승인 한도는 1 이상의 정수로 입력해야 합니다.'], String(bad))
  }
})

test('묶음 설정 행: 이름과 권한 목록만 있고, 권한은 모두 코드 목록에 있다. 되돌리기는 행과 함수를 지운다', () => {
  const value = JSON.parse(MIGRATION.match(/'admin_permission_presets',\s+'(\{[\s\S]*?\})'::jsonb/)[1])
  assert.ok(Array.isArray(value.presets) && value.presets.length > 0)
  for (const preset of value.presets) {
    assert.equal(typeof preset.name, 'string')
    for (const key of preset.permissions) assert.ok(permissions.ADMIN_PERMISSION_KEYS.includes(key), key)
    // 묶음에 든 권한이 필요로 하는 권한도 묶음에 있다(체크했는데 저장이 거부되지 않게).
    for (const key of preset.permissions) {
      for (const required of permissions.ADMIN_PERMISSIONS[key].requires) assert.ok(preset.permissions.includes(required), `${preset.name}: ${key} → ${required}`)
    }
  }
  assert.match(ROLLBACK, /DELETE FROM public\.system_settings WHERE key = 'admin_permission_presets';/)
  assert.match(ROLLBACK, /DROP FUNCTION public\.revoke_admin_account\(uuid, uuid\);/)
  assert.match(ROLLBACK, /DROP FUNCTION public\.replace_admin_permission_grants\(uuid, uuid, jsonb\);/)
})

test('묶음 구성은 코드에 박혀 있지 않다(설정 행에서만 읽는다)', () => {
  const value = JSON.parse(MIGRATION.match(/'admin_permission_presets',\s+'(\{[\s\S]*?\})'::jsonb/)[1])
  const files = []
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const path = `${dir}/${entry}`
      if (statSync(join(ROOT, path)).isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(entry)) files.push(path)
    }
  }
  walk('src')
  const readers = files.filter((path) => read(path).includes('admin_permission_presets'))
  assert.deepEqual(readers, ['src/lib/admin-accounts-server.ts'])
  for (const path of files) {
    const source = read(path)
    for (const preset of value.presets) assert.ok(!source.includes(preset.name), `${path}: 묶음 이름 '${preset.name}'`)
  }
})

// ---------------------------------------------------------------------------------------------------------------
// 서버 함수·route를 가짜 DB로 실제로 돌린다
// ---------------------------------------------------------------------------------------------------------------
const PROFILES = {
  [OWNER_ID]: { id: OWNER_ID, is_admin: true, admin_role: 'owner', email: 'boss@admin.summersun.local' },
  [OTHER_OWNER_ID]: { id: OTHER_OWNER_ID, is_admin: true, admin_role: 'owner', email: 'boss2@admin.summersun.local' },
  [STAFF_ID]: { id: STAFF_ID, is_admin: true, admin_role: 'staff', email: 'cs01@admin.summersun.local' },
  [MEMBER_ID]: { id: MEMBER_ID, is_admin: false, admin_role: null, email: 'member@example.com' },
}

function createWorld({ rpcError = null, presetsValue, presetsError = null, signInError = null } = {}) {
  const updates = []
  const signIns = []
  const admin = createFakeAdmin(({ table, ops }) => {
    if (table === 'profiles') {
      const id = ops.find(([name, column]) => name === 'eq' && column === 'id')?.[2]
      return { data: PROFILES[id] ?? null, error: null }
    }
    if (table === 'system_settings') {
      return presetsError ? { data: null, error: presetsError } : { data: presetsValue === undefined ? null : { value: presetsValue }, error: null }
    }
    throw new Error(`unexpected table ${table}`)
  }, { rpc: () => ({ data: rpcError ? null : { before: [], after: [] }, error: rpcError }) })
  admin.client.auth = {
    admin: {
      getUserById: async (id) => ({ data: { user: PROFILES[id] ? { id, email: PROFILES[id].email } : null }, error: null }),
      updateUserById: async (id, attributes) => { updates.push({ id, attributes }); return { error: null } },
    },
  }
  const server = load('src/lib/admin-accounts-server.ts', {
    'server-only': {},
    '@/lib/admin-accounts-shared': load('src/lib/admin-accounts-shared.ts'),
    '@/lib/admin-permissions': permissions,
    '@/lib/supabase/bypass': { createAdminClient: () => admin.client },
    '@supabase/supabase-js': {
      createClient: () => ({
        auth: {
          signInWithPassword: async (credentials) => { signIns.push(credentials); return { error: signInError } },
          signOut: async () => ({ error: null }),
        },
      }),
    },
  })
  return { admin, server, updates, signIns, rpcs: () => admin.calls.filter((call) => call.type === 'rpc') }
}

function loadPermissionsRoute(world, session = { userId: OWNER_ID }) {
  return load('src/app/api/admin/admin-accounts/[userId]/permissions/route.ts', {
    'next/server': { NextResponse },
    ...adminGuardMocks(session),
    '@/lib/admin-accounts-server': world.server,
  })
}

const grant = (permission, limits) => (limits ? { permission, limits } : { permission })

async function put(world, userId, body, session) {
  const route = loadPermissionsRoute(world, session)
  const response = await route.PUT({ json: async () => body }, { params: Promise.resolve({ userId }) })
  return { status: response.status, body: await response.json() }
}

test('권한 저장 route: 대표가 일반 관리자의 권한을 통째로 바꾸고, 함수에 한도는 정의된 키만 넘긴다', async () => {
  const world = createWorld()
  const result = await put(world, STAFF_ID, {
    grants: [grant('orders.view'), grant('refunds.market', { per_request: 5000, unknown_key: 9 })],
  })
  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.deepEqual(world.rpcs().map((call) => [call.name, call.args]), [[
    'replace_admin_permission_grants',
    {
      p_actor_id: OWNER_ID,
      p_user_id: STAFF_ID,
      p_grants: [{ permission: 'orders.view', limits: {} }, { permission: 'refunds.market', limits: { per_request: 5000 } }],
    },
  ]])

  // 크레딧 지급 한도는 비워 둘 수 있고, 비운 칸(null)은 저장하지 않는다(DB 기본 한도를 쓴다). 새 권한 credits.limits.manage도 저장된다.
  const optional = createWorld()
  assert.equal((await put(optional, STAFF_ID, {
    grants: [grant('members.view'), grant('credits.view'), grant('credits.grant', { per_grant: null, per_day: 3000 }), grant('credits.limits.manage')],
  })).status, 200)
  assert.deepEqual(optional.rpcs()[0].args.p_grants, [
    { permission: 'members.view', limits: {} },
    { permission: 'credits.view', limits: {} },
    { permission: 'credits.grant', limits: { per_day: 3000 } },
    { permission: 'credits.limits.manage', limits: {} },
  ])

  // 빈 목록 = 권한 모두 회수(관리자 자격은 유지)
  const empty = createWorld()
  assert.equal((await put(empty, STAFF_ID, { grants: [] })).status, 200)
  assert.deepEqual(empty.rpcs()[0].args.p_grants, [])
})

test('권한 저장 route: 앱 검증(모르는 권한·의존 빠짐·한도 누락·중복)에 걸리면 함수를 부르지 않는다', async () => {
  const cases = [
    [[grant('owner')], /알 수 없는 권한/],
    [[grant('nope.view')], /알 수 없는 권한/],
    [[grant('refunds.market', { per_request: 5000 })], /orders\.view 권한이 함께 필요/],
    [[grant('orders.view'), grant('refunds.market')], /1건 승인 한도/],
    [[grant('orders.view'), grant('refunds.market', { per_request: 0 })], /1건 승인 한도/],
    // 크레딧 지급 한도는 비워 둘 수 있지만(기본 한도), 적었다면 1 이상의 정수여야 한다.
    [[grant('members.view'), grant('credits.view'), grant('credits.grant', { per_grant: 100, per_day: 0 })], /하루 지급 한도/],
    [[grant('orders.view'), grant('orders.view')], /두 번/],
  ]
  for (const [grants, message] of cases) {
    const world = createWorld()
    const result = await put(world, STAFF_ID, { grants })
    assert.equal(result.status, 400, JSON.stringify(grants))
    assert.match(result.body.error, message)
    assert.equal(world.rpcs().length, 0)
  }
  // 형식이 틀린 본문
  const world = createWorld()
  assert.equal((await put(world, STAFF_ID, { grants: 'orders.view' })).status, 400)
  assert.equal(world.rpcs().length, 0)
})

test('권한 저장 route: 대표 계정·비관리자·본인은 대상이 아니고, 대표가 아니면 본문을 읽기 전에 막힌다', async () => {
  const valid = { grants: [grant('orders.view')] }
  for (const [target, status] of [[OTHER_OWNER_ID, 409], [MEMBER_ID, 404], [OWNER_ID, 400], ['00000000-0000-4000-8000-00000000ffff', 404], ['not-a-uuid', 400]]) {
    const world = createWorld()
    const result = await put(world, target, valid)
    if (target === 'not-a-uuid') {
      assert.match(result.body.error, /id가 올바르지 않습니다/)
      assert.equal(world.admin.calls.length, 0, 'uuid 모양이 아니면 DB에 묻지 않는다')
    }
    assert.equal(result.status, status, target)
    assert.equal(world.rpcs().length, 0, target)
  }

  let bodyRead = false
  const world = createWorld()
  const route = loadPermissionsRoute(world, { userId: STAFF_ID, role: 'staff', grants: permissions.ADMIN_PERMISSION_KEYS.map((key) => ({ permission: key, limits: { per_grant: 1, per_day: 1, per_request: 1 } })) })
  const denied = await route.PUT({ json: async () => { bodyRead = true; return valid } }, { params: Promise.resolve({ userId: STAFF_ID }) })
  assert.equal(denied.status, 403, '모든 권한을 받은 일반 관리자도 권한 부여는 못 한다')
  assert.equal(bodyRead, false)
  assert.equal(world.rpcs().length, 0)
})

test('권한 저장 route: DB 함수의 거부는 상태·문구로 바꾸고, 함수가 없으면(적용 전) 500으로 아무것도 바꾸지 않았다고 답한다', async () => {
  const mapped = createWorld({ rpcError: { message: 'ADMIN_PERMISSION_TARGET_NOT_STAFF' } })
  const notStaff = await put(mapped, STAFF_ID, { grants: [grant('orders.view')] })
  assert.equal(notStaff.status, 409)
  assert.match(notStaff.body.error, /일반 관리자 계정만/)

  const unknown = await put(createWorld({ rpcError: { message: 'ADMIN_PERMISSION_UNKNOWN' } }), STAFF_ID, { grants: [grant('orders.view')] })
  assert.equal(unknown.status, 400)

  const missing = await put(createWorld({ rpcError: { code: 'PGRST202', message: 'Could not find the function public.replace_admin_permission_grants' } }), STAFF_ID, { grants: [grant('orders.view')] })
  assert.equal(missing.status, 500)
  assert.match(missing.body.error, /권한을 저장하지 못했습니다/)
})

test('권한 해제 route: 일반 관리자만 해제하고(대표·본인·비관리자 거부), 작업 기록은 DB 함수가 남긴다', async () => {
  const run = async (target, session = { userId: OWNER_ID }, world = createWorld()) => {
    const route = load('src/app/api/admin/admin-accounts/[userId]/revoke/route.ts', {
      'next/server': { NextResponse },
      ...adminGuardMocks(session),
      '@/lib/admin-accounts-server': world.server,
    })
    const response = await route.POST({}, { params: Promise.resolve({ userId: target }) })
    return { status: response.status, body: await response.json(), world }
  }
  const ok = await run(STAFF_ID)
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.world.rpcs().map((call) => [call.name, call.args]), [['revoke_admin_account', { p_actor_id: OWNER_ID, p_user_id: STAFF_ID }]])

  for (const [target, status] of [[OTHER_OWNER_ID, 409], [OWNER_ID, 400], [MEMBER_ID, 404], ['x/../y', 400]]) {
    const result = await run(target)
    assert.equal(result.status, status, target)
    assert.equal(result.world.rpcs().length, 0)
  }
  const staffActor = await run(STAFF_ID, { userId: STAFF_ID, role: 'staff' })
  assert.equal(staffActor.status, 403)
  assert.equal(staffActor.world.rpcs().length, 0)

  // 권한 해제 route는 기록을 따로 남기지 않는다(함수 안에서 같은 트랜잭션으로 남긴다).
  assert.doesNotMatch(read('src/app/api/admin/admin-accounts/[userId]/revoke/route.ts'), /recordAdminAudit/)
  assert.doesNotMatch(read('src/app/api/admin/admin-accounts/[userId]/permissions/route.ts'), /recordAdminAudit/)
})

test('묶음 읽기: 설정이 없거나 읽지 못하면 빈 목록, 코드 목록에 없는 권한 이름은 뺀다', async () => {
  assert.deepEqual(await createWorld().server.readAdminPermissionPresets(), [])
  assert.deepEqual(await createWorld({ presetsError: { message: 'down' } }).server.readAdminPermissionPresets(), [])
  assert.deepEqual(await createWorld({ presetsValue: { presets: 'x' } }).server.readAdminPermissionPresets(), [])
  const presets = await createWorld({
    presetsValue: { presets: [{ name: ' 묶음A ', permissions: ['orders.view', 'owner', 'nope'] }, { name: '', permissions: [] }, { permissions: [] }] },
  }).server.readAdminPermissionPresets()
  assert.deepEqual(presets, [{ name: '묶음A', permissions: ['orders.view'] }])
})

test('목록 route는 묶음을 함께 내려 주고, 화면은 묶음이 없으면 버튼을 그리지 않는다', () => {
  const route = read('src/app/api/admin/admin-accounts/route.ts')
  assert.match(route, /const \[accounts, presets\] = await Promise\.all\(\[listAdminAccounts\(\), readAdminPermissionPresets\(\)\]\)/)
  const dialog = read('src/app/(admin)/admin/admin-accounts/admin-permissions-dialog.tsx')
  assert.match(dialog, /\{presets\.length > 0 && \(/)
  // 묶음은 체크만 채운다(저장 요청을 보내지 않는다).
  const applyPreset = dialog.match(/const applyPreset = [\s\S]*?\n {2}\}\n/)[0]
  assert.doesNotMatch(applyPreset, /fetch\(/)
  // 화면도 서버와 같은 검증 함수를 쓰고, 다음 요청부터 반영된다고 안내한다.
  assert.match(dialog, /validateAdminPermissionGrants\(grants\)/)
  assert.match(dialog, /다음 요청부터 반영/)
  // 대표 계정에는 권한 편집·해제 버튼이 없다.
  const client = read('src/app/(admin)/admin/admin-accounts/admin-accounts-client.tsx')
  assert.match(client, /\{account\.role === 'staff' && !isSelf \? \(/)
})

// ---------------------------------------------------------------------------------------------------------------
// 내 비밀번호 변경
// ---------------------------------------------------------------------------------------------------------------
function loadMyPasswordRoute(world, session, audits = [], signOuts = [], signOutError = null) {
  return load('src/app/api/admin/my-password/route.ts', {
    'next/server': { NextResponse },
    ...adminGuardMocks(session),
    '@/lib/admin-accounts-server': world.server,
    '@/lib/admin-audit-log-server': { recordAdminAudit: async (entry) => { audits.push(entry); return true } },
    // 지금 쿠키 세션 클라이언트: 다른 기기 로그아웃만 본다.
    '@/lib/supabase/server': { createClient: async () => ({ auth: { signOut: async (options) => { signOuts.push(options); return { error: signOutError } } } }) },
  }, [])
}

test('내 비밀번호 변경: 관리자 본인만, 현재 비밀번호 확인 뒤 바꾸고 작업 기록을 남긴다', async () => {
  const world = createWorld()
  const audits = []
  const signOuts = []
  const route = loadMyPasswordRoute(world, { userId: STAFF_ID, role: 'staff' }, audits, signOuts)
  const ok = await route.POST({ json: async () => ({ currentPassword: 'old-pass-1', newPassword: 'new-pass-12' }) })
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).otherSessionsSignedOut, true)
  // 바꾼 뒤 지금 세션만 남기고 다른 기기·브라우저의 로그인을 끊는다.
  assert.deepEqual(signOuts, [{ scope: 'others' }])
  assert.deepEqual(world.signIns, [{ email: 'cs01@admin.summersun.local', password: 'old-pass-1' }])
  assert.deepEqual(world.updates, [{ id: STAFF_ID, attributes: { password: 'new-pass-12' } }])
  assert.deepEqual(audits.map((entry) => [entry.action, entry.actorId, entry.targetId]), [['admin_own_password_change', STAFF_ID, STAFF_ID]])
  assert.doesNotMatch(JSON.stringify(audits), /pass-1/, '비밀번호는 기록에 남지 않는다')

  // 다른 세션 로그아웃이 실패해도 변경은 성공이고, 화면이 사실대로 안내하도록 알려 준다.
  const partial = createWorld()
  const partialResponse = await loadMyPasswordRoute(partial, { userId: STAFF_ID, role: 'staff' }, [], [], { code: 'unexpected_failure', message: 'x' })
    .POST({ json: async () => ({ currentPassword: 'old-pass-1', newPassword: 'new-pass-12' }) })
  assert.equal(partialResponse.status, 200)
  assert.equal((await partialResponse.json()).otherSessionsSignedOut, false)
  assert.equal(partial.updates.length, 1)
  const client = read('src/app/(admin)/admin/my-password/my-password-client.tsx')
  assert.match(client, /result\.otherSessionsSignedOut\s+\?/)

  // 72바이트를 넘는 새 비밀번호(한글 25자 = 75바이트)는 받지 않는다.
  const long = createWorld()
  const tooLong = await loadMyPasswordRoute(long, { userId: STAFF_ID, role: 'staff' }).POST({ json: async () => ({ currentPassword: 'old-pass-1', newPassword: '가'.repeat(25) }) })
  assert.equal(tooLong.status, 400)
  assert.match((await tooLong.json()).error, /72바이트/)
  assert.equal(long.updates.length + long.signIns.length, 0)

  // 현재 비밀번호가 틀리면 바꾸지 않는다.
  const wrong = createWorld({ signInError: { message: 'Invalid login credentials' } })
  const wrongAudits = []
  const wrongSignOuts = []
  const denied = await loadMyPasswordRoute(wrong, { userId: STAFF_ID, role: 'staff' }, wrongAudits, wrongSignOuts)
    .POST({ json: async () => ({ currentPassword: 'bad', newPassword: 'new-pass-12' }) })
  assert.equal(denied.status, 400)
  assert.match((await denied.json()).error, /현재 비밀번호가 맞지 않습니다/)
  assert.equal(wrong.updates.length, 0)
  assert.equal(wrongAudits.length, 0)
  assert.equal(wrongSignOuts.length, 0, '바꾸지 않았으면 다른 세션도 끊지 않는다')

  // 짧은 비밀번호, 같은 비밀번호, 비로그인·비관리자
  const short = createWorld()
  assert.equal((await loadMyPasswordRoute(short, { userId: STAFF_ID, role: 'staff' }).POST({ json: async () => ({ currentPassword: 'x', newPassword: 'short' }) })).status, 400)
  const same = createWorld()
  assert.equal((await loadMyPasswordRoute(same, { userId: STAFF_ID, role: 'staff' }).POST({ json: async () => ({ currentPassword: 'same-pass-1', newPassword: 'same-pass-1' }) })).status, 400)
  assert.equal((await loadMyPasswordRoute(createWorld(), { loggedIn: false }).POST({ json: async () => ({}) })).status, 401)
  assert.equal((await loadMyPasswordRoute(createWorld(), { isAdmin: false }).POST({ json: async () => ({}) })).status, 403)
  for (const blocked of [short, same]) assert.equal(blocked.updates.length + blocked.signIns.length, 0)

  // 대상은 항상 로그인한 본인이다(요청 본문으로 대상을 받지 않는다).
  assert.doesNotMatch(read('src/app/api/admin/my-password/route.ts'), /userId: parsed|params/)
  // 확인용 세션만 닫는다(지금 세션·다른 기기는 그대로).
  assert.match(read('src/lib/admin-accounts-server.ts'), /verifier\.auth\.signOut\(\{ scope: 'local' \}\)/)
})
