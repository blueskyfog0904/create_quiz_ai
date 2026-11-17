import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from './helpers/market-images-harness.mjs'

// 계획 U3-8(DB-P2, DB-P3): 관리자 RLS를 계정별 권한에 맞춘 마이그레이션의 계약.
// DB에 붙지 않고 파일만 읽는다. 실제 동작(가장한 세션의 통과·거부)은 BEGIN … ROLLBACK 리허설로 따로 확인한다.

const ROOT = new URL('../', import.meta.url).pathname
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const stripComments = (sql) => sql.replace(/--[^\n]*/g, '')

const UP = 'supabase/migrations/20261117140000_admin_rls_by_permission.sql'
const DOWN = 'supabase/rollback/20261117140000_admin_rls_by_permission_down.sql'
const ROLE_UP = 'supabase/migrations/20261117130000_admin_role_constraints.sql'
const ROLE_DOWN = 'supabase/rollback/20261117130000_admin_role_constraints_down.sql'

const up = stripComments(read(UP))
const down = stripComments(read(DOWN))
const roleUp = stripComments(read(ROLE_UP))
const roleDown = stripComments(read(ROLE_DOWN))
const guardContract = read('tests/admin-guard-coverage-contract.test.mjs')
const { ADMIN_PERMISSIONS, ADMIN_PERMISSION_KEYS } = load('src/lib/admin-permissions.ts')

const unquote = (name) => name.replace(/^"|"$/g, '')

function parseCreates(sql) {
  return [...sql.matchAll(/CREATE POLICY\s+("[^"]+"|\w+)\s+ON\s+public\.(\w+)\s+([\s\S]*?);/g)].map(([, name, table, body]) => ({
    name: unquote(name),
    table,
    body,
    command: (body.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/) || [])[1] ?? 'ALL',
    role: (body.match(/\bTO\s+(\w+)/) || [])[1] ?? 'public',
    restrictive: /\bAS\s+RESTRICTIVE\b/.test(body),
  }))
}

function parseDrops(sql) {
  return [...sql.matchAll(/DROP POLICY\s+("[^"]+"|\w+)\s+ON\s+public\.(\w+)\s*;/g)].map(([, name, table]) => ({ name: unquote(name), table }))
}

// REVOKE·GRANT를 (표, 역할, 권한) 단위로 편다.
function parsePrivileges(sql, verb) {
  const pattern = new RegExp(`${verb}\\s+([A-Z, ]+?)\\s+ON TABLE public\\.(\\w+)\\s+${verb === 'REVOKE' ? 'FROM' : 'TO'}\\s+([\\w, ]+);`, 'g')
  const rows = []
  for (const [, privs, table, roles] of sql.matchAll(pattern)) {
    for (const priv of privs.split(',').map((item) => item.trim())) {
      for (const role of roles.split(',').map((item) => item.trim())) rows.push(`${table}:${role}:${priv}`)
    }
  }
  return rows.sort()
}

const key = (policy) => `${policy.table}:${policy.name}`
const upCreates = parseCreates(up)
const upDrops = parseDrops(up)
const downCreates = parseCreates(down)
const downDrops = parseDrops(down)

const permissionsIn = (body) => [...body.matchAll(/has_admin_permission\('([^']+)'\)/g)].map((match) => match[1])
const usesIsAdmin = (body) => /\bis_admin\(\)|profiles\.is_admin\s*=\s*true/.test(body)
const WRITE_COMMANDS = new Set(['ALL', 'INSERT', 'UPDATE', 'DELETE'])

// 돈·권한 표: 관리자 세션 쓰기를 남기지 않는다(앱은 service role로만 쓴다).
const MONEY_TABLES = [
  'credit_sources', 'credit_transactions', 'credit_consumption', 'payment_history', 'payment_orders', 'payment_provider_transactions',
  'refund_requests', 'market_entitlements', 'market_purchase_orders', 'market_purchase_lines', 'market_purchases',
  'market_refund_requests', 'admin_permission_grants', 'profiles',
]

test('(a) 돈·권한 표에는 적용 뒤 is_admin() 쓰기 정책이 남지 않고, 새 쓰기 정책도 만들지 않는다', () => {
  const dropped = new Set(upDrops.map(key))
  for (const before of downCreates.filter((policy) => MONEY_TABLES.includes(policy.table))) {
    if (WRITE_COMMANDS.has(before.command) && usesIsAdmin(before.body)) {
      assert.ok(dropped.has(key(before)), `${key(before)}: 관리자 쓰기 정책을 지우지 않았다`)
    }
  }
  for (const created of upCreates.filter((policy) => MONEY_TABLES.includes(policy.table))) {
    assert.equal(created.command, 'SELECT', `${key(created)}: 돈 표에 쓰기 정책을 새로 만들었다`)
  }
})

test('(b) 새 정책은 모두 TO authenticated이고 함수는 (SELECT …)로 감싼다(행 값을 받는 admin_events 제외)', () => {
  assert.ok(upCreates.length > 0)
  for (const policy of upCreates) {
    assert.equal(policy.role, 'authenticated', `${key(policy)}: TO authenticated가 아니다`)
    assert.equal(policy.restrictive, false, `${key(policy)}: 제한 정책은 이 파일에서 만들지 않는다`)
    assert.doesNotMatch(policy.body, /profiles\.is_admin/, `${key(policy)}: 인라인 EXISTS 대신 함수를 쓴다`)
    const bare = policy.body.replace(/\(SELECT public\.(is_admin|is_owner|has_admin_permission)\([^()]*\)\)/g, '')
    if (policy.name === 'admin_events_select_by_permission') {
      assert.match(bare, /required_permission <> 'owner' AND public\.has_admin_permission\(required_permission\)/)
      continue
    }
    assert.doesNotMatch(bare, /\b(is_admin|is_owner|has_admin_permission)\(/, `${key(policy)}: (SELECT …)로 감싸지 않은 호출`)
  }
})

test('(c) 정책의 권한 이름은 코드 목록에 있고, 의존 권한도 함께 요구한다', () => {
  for (const policy of upCreates) {
    const used = permissionsIn(policy.body)
    for (const permission of used) {
      assert.ok(ADMIN_PERMISSION_KEYS.includes(permission), `${key(policy)}: 모르는 권한 ${permission}`)
    }
    // OR로 묶인 갈래마다 의존을 확인한다(notifications: support.manage 또는 credits.grant+의존).
    const branches = policy.body.split(/\)\s*OR\s*\(/)
    for (const branch of branches) {
      const inBranch = permissionsIn(branch)
      for (const permission of inBranch) {
        for (const required of ADMIN_PERMISSIONS[permission].requires) {
          assert.ok(inBranch.includes(required), `${key(policy)}: ${permission}에는 ${required}가 함께 필요하다`)
        }
      }
    }
  }
})

// 표 → 정책이 요구하는 조건, 그리고 같은 일을 하는 앱 가드(admin-guard-coverage-contract의 표 한 줄).
const OWNER = 'owner'
const EXPECTED = {
  credit_sources: { condition: 'is_admin', select: true },
  payment_history: { condition: 'is_admin', select: true },
  refund_requests: { condition: 'is_admin', select: true },
  market_purchases: { condition: 'is_admin', select: true },
  market_items: { condition: 'products.edit', selectIsAdmin: true, guard: [["'market/items/route.ts'", "'products.edit'"]] },
  market_item_subproducts: { condition: 'products.edit', selectIsAdmin: true, guard: [["'market/items/[id]/subproducts/route.ts'", "'products.edit'"]] },
  market_item_files: { condition: 'products.edit', selectIsAdmin: true, guard: [["'market/items/[id]/files/route.ts'", "'products.edit'"]] },
  market_item_sample_pages: { condition: 'products.edit', selectIsAdmin: true, guard: [["'market/items/[id]/sample-pages/route.ts'", "'products.edit'"]] },
  market_item_bundle_options: { condition: 'products.edit', selectIsAdmin: true, guard: [["'market/items/[id]/bundle-option/route.ts'", "'products.edit'"]] },
  market_subproduct_files: { condition: 'products.edit', selectIsAdmin: true, guard: [["'market/items/[id]/subproducts/[subproductId]/files/route.ts'", "'products.edit'"]] },
  market_subproduct_categories: { condition: 'products.edit', selectIsAdmin: true, guard: [["'market/subproduct-categories/route.ts'", "'products.edit'"]] },
  market_file_types: { condition: 'products.edit', selectIsAdmin: true, guard: [["'market/file-types/route.ts'", "'products.edit'"]] },
  market_menu_entries: { condition: 'products.edit', selectIsAdmin: true, guard: [["'market-categories/route.ts'", "'products.edit'"]] },
  support_tickets: { condition: 'support.manage', guard: [["'support/tickets/[id]/route.ts'", "'support.manage'"]] },
  support_ticket_categories: { condition: 'support.manage', guard: [["'support/categories/route.ts'", "'support.manage'"]] },
  notifications: {
    condition: ['support.manage', 'credits.grant'],
    guard: [["'support/tickets/[id]/route.ts'", "'support.manage'"], ["'users/credits/route.ts'", "'credits.grant'"]],
  },
  pricing_plans: { condition: 'pricing.manage', guard: [["'pricing/page.tsx'", "'pricing.manage'"], ['upsertPricingPlan', "'pricing.manage'"]] },
  system_settings: { condition: OWNER, guard: [['updateSystemSettings', 'LEGACY(']] },
  workspace_settings: { condition: OWNER },
  user_roles: { condition: OWNER, guard: [["'roles/page.tsx'", 'OWNER']] },
  ai_models: { condition: OWNER, guard: [["'passages/models/page.tsx'", 'OWNER']] },
  ai_provider_connections: { condition: OWNER, guard: [["'ai-connections/page.tsx'", 'OWNER']] },
  ai_question_generation_runs: { condition: OWNER, guard: [["'ai-question-generation-runs/page.tsx'", 'OWNER']] },
  display_labels: { condition: OWNER, guard: [["'labels/page.tsx'", 'OWNER']] },
  generate_listboard_generation_job_events: { condition: OWNER },
  generate_listboard_generation_job_items: { condition: OWNER },
  generate_listboard_generation_jobs: { condition: OWNER },
  generate_listboard_post_items: { condition: OWNER, guard: [['createGenerateListboardPostItemAction', 'LEGACY(']] },
  generate_listboard_posts: { condition: OWNER, guard: [["'generate/products/page.tsx'", 'OWNER']] },
  generate_menu_entries: { condition: OWNER, guard: [['createGenerateMenuEntryAction', 'LEGACY(']] },
  problem_type_default_prompts: { condition: OWNER, guard: [['updateProblemTypeDefaultPrompts', 'LEGACY(']] },
  problem_type_test_runs: { condition: OWNER, guard: [["'problem-types/[id]/test/page.tsx'", 'OWNER']] },
  problem_types: { condition: OWNER, guard: [["'problem-types/page.tsx'", 'OWNER']] },
  providers: { condition: OWNER },
  question_bank_books: { condition: OWNER, guard: [["'question-bank/options/page.tsx'", 'OWNER']] },
  question_bank_problem_types: { condition: OWNER, guard: [["'question-bank/problem-types/page.tsx'", 'OWNER']] },
  question_bank_question_metadata: { condition: OWNER, guard: [["'questions/[id]/page.tsx'", 'OWNER']] },
  question_bank_years: { condition: OWNER, guard: [["'question-bank/options/page.tsx'", 'OWNER']] },
  source_configs: { condition: OWNER, guard: [["'source-configs/page.tsx'", 'OWNER']] },
  system_prompts: { condition: OWNER, guard: [["'passages/prompts/page.tsx'", 'OWNER'], ['updateSystemPrompt', 'LEGACY(']] },
}

test('(d) 표 → 권한 대응이 앱 가드의 대응과 같다', () => {
  const tables = [...new Set(upCreates.map((policy) => policy.table))].filter((table) => table !== 'admin_events').sort()
  assert.deepEqual(tables, Object.keys(EXPECTED).sort(), '정책을 만드는 표와 기대 표가 다르다')

  for (const [table, expected] of Object.entries(EXPECTED)) {
    const policies = upCreates.filter((policy) => policy.table === table)
    if (expected.selectIsAdmin) {
      // 상품 계열: 조회는 관리자면 누구나(환불 화면이 관리자 세션으로 market_items(title)을 조인한다 — 계획 4-1절),
      // 쓰기(INSERT·UPDATE·DELETE·ALL)만 권한별이다.
      const selects = policies.filter((policy) => policy.command === 'SELECT')
      assert.equal(selects.length, 1, `${table}: 관리자 조회 정책이 하나여야 한다`)
      assert.match(selects[0].body, /USING \(\(SELECT public\.is_admin\(\)\)\)/, `${key(selects[0])}: 조회가 is_admin이 아니다`)
      assert.deepEqual(permissionsIn(selects[0].body), [], `${key(selects[0])}: 조회에 권한 조건이 섞였다`)
      assert.ok(policies.some((policy) => policy.command !== 'SELECT'), `${table}: 쓰기 정책이 없다`)
    }
    for (const policy of policies) {
      const used = [...new Set(permissionsIn(policy.body))]
      if (expected.selectIsAdmin && policy.command === 'SELECT') continue
      if (expected.condition === OWNER) {
        assert.match(policy.body, /^[\s\S]*\(SELECT public\.is_owner\(\)\)[\s\S]*$/, `${key(policy)}: 대표 전용이 아니다`)
        assert.deepEqual(used, [], `${key(policy)}: 대표 전용 표에 권한 조건이 섞였다`)
      } else if (expected.condition === 'is_admin') {
        assert.equal(policy.command, 'SELECT', `${key(policy)}: 조회만 남긴다`)
        assert.match(policy.body, /\(SELECT public\.is_admin\(\)\)/)
      } else {
        const heads = Array.isArray(expected.condition) ? expected.condition : [expected.condition]
        for (const head of heads) assert.ok(used.includes(head), `${key(policy)}: ${head} 조건이 없다`)
        assert.doesNotMatch(policy.body, /is_admin\(\)|is_owner\(\)/, `${key(policy)}: 권한 표에 관리자 전체·대표 조건이 섞였다`)
      }
    }
    for (const [entry, requirement] of expected.guard ?? []) {
      const line = guardContract.split('\n').find((text) => text.includes(entry))
      assert.ok(line, `${table}: 앱 가드 표에서 ${entry}를 찾지 못했다`)
      assert.ok(line.includes(requirement), `${table}: 앱 가드(${line.trim()})가 ${requirement}가 아니다`)
    }
  }

  // 상품 완전 삭제만 products.delete(+edit). 앱도 market/items/[id] DELETE만 products.delete다.
  const itemDelete = upCreates.find((policy) => policy.table === 'market_items' && policy.command === 'DELETE')
  assert.deepEqual(permissionsIn(itemDelete.body).sort(), ['products.delete', 'products.edit'])
  assert.match(guardContract, /'market\/items\/\[id\]\/route\.ts': \{[^}]*DELETE: 'products\.delete'/)
  for (const policy of upCreates.filter((item) => item.table !== 'market_items' || item.command !== 'DELETE')) {
    assert.ok(!permissionsIn(policy.body).includes('products.delete'), `${key(policy)}: products.delete는 상품 완전 삭제에만 쓴다`)
  }
  // 하위 표의 ALL 정책은 DELETE도 포함하므로 products.edit 하나로 충분해야 한다(앱의 하위 행 삭제 route가 products.edit).
  assert.match(guardContract, /'market\/items\/\[id\]\/sample-pages\/\[pageId\]\/route\.ts': all\('products\.edit', 'DELETE'\)/)
})

test('(d) admin_events 조회는 대표 또는 이벤트의 required_permission 권한자만', () => {
  const policies = upCreates.filter((policy) => policy.table === 'admin_events')
  assert.equal(policies.length, 1)
  assert.equal(policies[0].command, 'SELECT')
  assert.match(policies[0].body, /\(SELECT public\.is_owner\(\)\)\s*OR\s*\(required_permission <> 'owner' AND public\.has_admin_permission\(required_permission\)\)/)
})

test('(e) down은 up이 만든 정책을 모두 지우고 up이 지운 정책을 모두 되살린다', () => {
  const sortKeys = (list) => list.map(key).sort()
  assert.deepEqual(sortKeys(downDrops), sortKeys(upCreates), 'down의 DROP과 up의 CREATE가 짝이 맞지 않는다')
  assert.deepEqual(sortKeys(downCreates), sortKeys(upDrops), 'down의 CREATE와 up의 DROP이 짝이 맞지 않는다')
  // 같은 이름을 두 번 만들거나 지우지 않는다.
  assert.equal(new Set(sortKeys(upCreates)).size, upCreates.length)
  assert.equal(new Set(sortKeys(upDrops)).size, upDrops.length)
  // 되살리는 정책은 관리자 전체(is_admin) 조건이다(원래 정의).
  for (const policy of downCreates) assert.ok(usesIsAdmin(policy.body), `${key(policy)}: 원래 정의가 is_admin 조건이 아니다`)
})

test('(e) 표 권한: up이 걷은 것을 down이 그대로 다시 준다', () => {
  const revoked = parsePrivileges(up, 'REVOKE')
  assert.ok(revoked.length > 0)
  assert.deepEqual(parsePrivileges(down, 'GRANT'), revoked)
  // 관리자 세션이 쓰는 권한은 걷지 않는다: 요금제(pricing.manage)의 authenticated INSERT·UPDATE·DELETE, 시스템 설정의 authenticated UPDATE.
  for (const kept of ['pricing_plans:authenticated:INSERT', 'pricing_plans:authenticated:UPDATE', 'pricing_plans:authenticated:DELETE', 'system_settings:authenticated:UPDATE']) {
    assert.ok(!revoked.includes(kept), `${kept}는 관리자 세션 저장에 필요하다`)
  }
})

test('두 파일 모두 잠금 대기 한도와 스키마 캐시 갱신 관례를 따른다', () => {
  for (const sql of [up, down, roleUp, roleDown]) {
    assert.match(sql, /^\s*SET LOCAL lock_timeout = '3s';/)
    assert.match(sql, /SET LOCAL statement_timeout = '60s';/)
    assert.match(sql, /NOTIFY pgrst, 'reload schema';\s*$/)
  }
})

test('DB-P2: 정합 제약·마지막 대표 보호·profiles 표 권한 정리와 그 되돌리기', () => {
  assert.match(roleUp, /ADD CONSTRAINT profiles_admin_role_matches_is_admin CHECK \(\(is_admin IS TRUE\) = \(admin_role IS NOT NULL\)\)/)
  assert.match(roleUp, /BEFORE UPDATE OF is_admin, admin_role OR DELETE ON public\.profiles\s+FOR EACH ROW EXECUTE FUNCTION public\.keep_admin_owner\(\)/)
  // 동시에 서로를 지우는 두 트랜잭션을 한 줄로 세운 뒤, 다른 대표가 남는지 본다.
  assert.match(roleUp, /pg_advisory_xact_lock\(/)
  assert.match(roleUp, /p\.id <> OLD\.id\s+AND p\.is_admin IS TRUE\s+AND p\.admin_role = 'owner'/)
  assert.match(roleUp, /SECURITY DEFINER\s+SET search_path TO 'public', 'pg_temp'/)
  assert.deepEqual(parsePrivileges(roleUp, 'REVOKE'), parsePrivileges(roleDown, 'GRANT'))
  assert.deepEqual(parsePrivileges(roleUp, 'REVOKE'), [
    'profiles:anon:DELETE', 'profiles:anon:INSERT', 'profiles:anon:TRUNCATE',
    'profiles:authenticated:DELETE', 'profiles:authenticated:INSERT', 'profiles:authenticated:TRUNCATE',
  ])
  assert.match(roleDown, /DROP TRIGGER profiles_keep_admin_owner ON public\.profiles;/)
  assert.match(roleDown, /DROP FUNCTION public\.keep_admin_owner\(\);/)
  assert.match(roleDown, /DROP CONSTRAINT profiles_admin_role_matches_is_admin;/)
})
