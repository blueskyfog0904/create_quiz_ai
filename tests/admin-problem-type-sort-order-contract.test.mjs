import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const migrationSource = readSource('supabase/migrations/20260603100000_add_problem_type_sort_order.sql')
const typesSource = readSource('src/types/supabase.ts')
const pageSource = readSource('src/app/(admin)/admin/problem-types/page.tsx')
const listClientSource = readSource('src/app/(admin)/admin/problem-types/problem-types-client.tsx')
const actionsSource = readSource('src/app/(admin)/admin/problem-types/actions.ts')
const newFormSource = readSource('src/app/(admin)/admin/problem-types/new/problem-type-form-client.tsx')
const editFormSource = readSource('src/app/(admin)/admin/problem-types/[id]/edit/problem-type-form-client.tsx')
const createRouteSource = readSource('src/app/api/admin/problem-types/route.ts')
const updateRouteSource = readSource('src/app/api/admin/problem-types/[id]/route.ts')

const extractProblemTypesTypeSource = () => {
  const start = typesSource.indexOf('      problem_types: {')
  const end = typesSource.indexOf('      problem_type_test_runs: {', start)
  assert.notEqual(start, -1, 'problem_types type block start should exist')
  assert.notEqual(end, -1, 'problem_types type block end should exist')
  return typesSource.slice(start, end)
}

const problemTypesTypeSource = extractProblemTypesTypeSource()

test('problem_types has an admin sort order column and index', () => {
  assert.match(migrationSource, /add\s+column\s+if\s+not\s+exists\s+sort_order\s+integer/i)
  assert.match(migrationSource, /default\s+0/i)
  assert.match(migrationSource, /check\s*\(sort_order\s*>=\s*0\)/i)
  assert.match(migrationSource, /create\s+index\s+if\s+not\s+exists\s+idx_problem_types_workspace_sort_order[\s\S]*on\s+public\.problem_types\s*\([\s\S]*workspace_subject[\s\S]*sort_order[\s\S]*created_at\s+desc[\s\S]*id/i)
})

test('supabase problem_types types include sort_order', () => {
  assert.match(problemTypesTypeSource, /Row:\s*{[\s\S]*sort_order:\s*number/)
  assert.match(problemTypesTypeSource, /Insert:\s*{[\s\S]*sort_order\?:\s*number/)
  assert.match(problemTypesTypeSource, /Update:\s*{[\s\S]*sort_order\?:\s*number/)
})

test('admin problem type list is sorted by sort_order before created_at', () => {
  assert.match(pageSource, /\.order\('sort_order',\s*{\s*ascending:\s*true\s*}\)/)
  assert.match(pageSource, /\.order\('created_at',\s*{\s*ascending:\s*false\s*}\)/)
  assert.match(pageSource, /\.order\('id',\s*{\s*ascending:\s*true\s*}\)/)
  assert.match(createRouteSource, /\.order\('sort_order',\s*{\s*ascending:\s*true\s*}\)/)
  assert.match(createRouteSource, /\.order\('created_at',\s*{\s*ascending:\s*false\s*}\)/)
  assert.match(createRouteSource, /\.order\('id',\s*{\s*ascending:\s*true\s*}\)/)
})

test('admin list exposes inline sort order input and save action', () => {
  assert.match(listClientSource, /updateProblemTypeSortOrder/)
  assert.match(listClientSource, /type="number"/)
  assert.match(listClientSource, /번호/)
  assert.match(listClientSource, /번호가 저장되었습니다/)
})

test('forms and admin APIs persist sort_order', () => {
  for (const source of [newFormSource, editFormSource]) {
    assert.match(source, /name="sort_order"/)
    assert.match(source, /번호/)
  }
  assert.match(actionsSource, /ProblemTypeSchema[\s\S]*sort_order:\s*z\.coerce\.number\(\)\.int\(\)\.min\(0\)\.default\(0\)/)
  assert.match(actionsSource, /readProblemTypeFormData[\s\S]*sort_order:\s*formData\.get\('sort_order'\)/)
  assert.match(actionsSource, /buildProblemTypePayload[\s\S]*sort_order:\s*data\.sort_order/)
  assert.match(actionsSource, /export\s+async\s+function\s+updateProblemTypeSortOrder/)
  assert.match(actionsSource, /\.from\('problem_types'\)[\s\S]*\.update\(\{[\s\S]*sort_order/)
  assert.match(createRouteSource, /problemTypeSchema[\s\S]*sort_order:\s*z\.coerce\.number\(\)\.int\(\)\.min\(0\)\.optional\(\)/)
  assert.match(createRouteSource, /sort_order:\s*validatedData\.sort_order \?\? 0/)
  assert.match(updateRouteSource, /updateProblemTypeSchema[\s\S]*sort_order:\s*z\.coerce\.number\(\)\.int\(\)\.min\(0\)\.optional\(\)/)
  assert.match(updateRouteSource, /validatedData\.sort_order !== undefined[\s\S]*updateData\.sort_order = validatedData\.sort_order/)
})
