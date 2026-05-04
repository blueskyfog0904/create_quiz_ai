import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const optionsRoutePath = new URL('../src/app/api/question-bank/options/route.ts', import.meta.url)
const availabilityRoutePath = new URL('../src/app/api/question-bank/availability/route.ts', import.meta.url)

function readRouteSource(routePath) {
  assert.equal(existsSync(routePath), true, `${routePath.pathname} must exist`)
  return readFileSync(routePath, 'utf8')
}

function assertAuthenticatedRoute(source) {
  assert.match(source, /supabase\.auth\.getUser\s*\(\s*\)/)
  assert.match(source, /if\s*\(\s*!user\s*\)/)
  assert.match(source, /status:\s*401/)
}

test('options route queries active workspace-scoped years and books ordered by sort_order', () => {
  const source = readRouteSource(optionsRoutePath)

  assertAuthenticatedRoute(source)
  assert.match(source, /from\(\s*['"]question_bank_years['"]\s*\)/)
  assert.match(source, /from\(\s*['"]question_bank_books['"]\s*\)/)
  assert.match(source, /eq\(\s*['"]workspace_subject['"]\s*,\s*workspaceSubject\s*\)/)
  assert.match(source, /eq\(\s*['"]is_active['"]\s*,\s*true\s*\)/)
  assert.match(source, /order\(\s*['"]sort_order['"]\s*,\s*\{\s*ascending:\s*true\s*\}\s*\)/)
  assert.match(source, /resolveRequestedWorkspaceSubject/)
  assert.match(source, /DEFAULT_WORKSPACE_SUBJECT/)
})

test('options route returns Task 2 camelCase years and books fields without an extra wrapper', () => {
  const source = readRouteSource(optionsRoutePath)

  for (const field of ['id', 'year', 'label', 'sort', 'isActive']) {
    assert.match(source, new RegExp(String.raw`\b${field}:`))
  }

  for (const field of ['id', 'name', 'slug', 'description', 'sort', 'isActive']) {
    assert.match(source, new RegExp(String.raw`\b${field}:`))
  }

  assert.match(source, /sort:\s*[^\n]+\.sort_order/)
  assert.match(source, /isActive:\s*[^\n]+\.is_active/)
  assert.match(source, /NextResponse\.json\(\s*\{\s*years\s*,\s*books\s*\}/)
})

test('availability route delegates counting only to get_question_bank_availability RPC', () => {
  const source = readRouteSource(availabilityRoutePath)

  assertAuthenticatedRoute(source)
  assert.match(source, /rpc\(\s*['"]get_question_bank_availability['"]\s*,\s*\{/)
  assert.match(source, /p_workspace_subject:\s*workspaceSubject/)
  assert.match(source, /p_year_id:\s*yearId/)
  assert.match(source, /p_book_id:\s*bookId/)
  assert.doesNotMatch(source, /from\(\s*['"]questions['"]\s*\)/)
  assert.doesNotMatch(source, /from\(\s*['"]question_bank_question_metadata['"]\s*\)/)
  assert.doesNotMatch(source, /select\(\s*['"][^'"]*count/i)
})

test('availability route validates scope and params and maps RPC errors', () => {
  const source = readRouteSource(availabilityRoutePath)

  assert.match(source, /searchParams\.get\(\s*['"]yearId['"]\s*\)/)
  assert.match(source, /searchParams\.get\(\s*['"]bookId['"]\s*\)/)
  assert.match(source, /isUuidishString\(yearId\)/)
  assert.match(source, /isUuidishString\(bookId\)/)
  assert.match(source, /status:\s*400/)
  assert.match(source, /INACTIVE_DIMENSION/)
  assert.match(source, /INVALID_SCOPE/)
  assert.match(source, /AUTH_REQUIRED/)
  assert.match(source, /status:\s*500/)
})

test('availability route returns camelCase availability and documents Phase 1 source policy', () => {
  const source = readRouteSource(availabilityRoutePath)

  assert.match(source, /Phase 1 source policy:[^\n]*from_community/i)
  assert.match(source, /problemTypeId:\s*[^\n]+\.problem_type_id/)
  assert.match(source, /availableCount:\s*[^\n]+\.available_count/)
  assert.match(source, /NextResponse\.json\(\s*\{\s*availability\s*\}/)
})
