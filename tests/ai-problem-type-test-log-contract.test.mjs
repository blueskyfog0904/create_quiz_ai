import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const workflowSource = readSource('src/lib/ai/question-generation-workflow.ts')
const adminTestRouteSource = readSource('src/app/api/admin/problem-types/[id]/test/route.ts')
const testClientSource = readSource('src/app/(admin)/admin/problem-types/[id]/test/problem-type-test-client.tsx')
const migrationsDir = new URL('../supabase/migrations/', import.meta.url)

test('failed review sends full feedback and issues payload into regeneration prompt and trace log', () => {
  assert.match(workflowSource, /reviewFeedbackPayload/)
  assert.match(workflowSource, /JSON\.stringify\(input\.reviewFeedbackPayload, null, 2\)/)
  assert.match(workflowSource, /issues:\s*reviewResult\.review\.issues/)
  assert.match(workflowSource, /fullReview:\s*reviewResult\.review/)
  assert.match(workflowSource, /feedback\s*\+\s*issues/)
})

test('problem type test runs are persisted and exposed through log APIs', () => {
  assert.match(adminTestRouteSource, /\.from\('problem_type_test_runs'\)/)
  assert.match(adminTestRouteSource, /testRunId/)
  assert.match(adminTestRouteSource, /logLocation/)
  assert.match(adminTestRouteSource, /logDownloadUrl/)

  assert.equal(existsSync(new URL('../src/app/api/admin/problem-types/[id]/test-runs/route.ts', import.meta.url)), true)
  assert.equal(existsSync(new URL('../src/app/api/admin/problem-types/[id]/test-runs/[runId]/route.ts', import.meta.url)), true)
  assert.equal(existsSync(new URL('../src/app/api/admin/problem-types/[id]/test-runs/[runId]/download/route.ts', import.meta.url)), true)
})

test('admin test page shows saved log location, recent logs, and JSON download controls', () => {
  assert.match(testClientSource, /로그 저장 위치/)
  assert.match(testClientSource, /최근 테스트 로그/)
  assert.match(testClientSource, /JSON 다운로드/)
  assert.match(testClientSource, /testRunId/)
  assert.match(testClientSource, /logDownloadUrl/)
})

test('admin test page loads a recent test log into the progress detail view when clicked', () => {
  assert.match(testClientSource, /selectedTestRunId/)
  assert.match(testClientSource, /handleLoadTestRun/)
  assert.match(testClientSource, /fetch\(run\.logLocation\)/)
  assert.match(testClientSource, /setResult\(\{/)
  assert.match(testClientSource, /attempts:\s*Array\.isArray\(loadedRun\.attempts\)/)
  assert.match(testClientSource, /role="button"/)
  assert.match(testClientSource, /onClick=\{\(\) => handleLoadTestRun\(run\)\}/)
  assert.match(testClientSource, /진행 내역 불러오는 중/)
})

test('problem type test run migration stores full attempts JSON with admin-only RLS', () => {
  const migrationName = readdirSync(migrationsDir).find((name) => name.includes('create_problem_type_test_runs'))
  assert.ok(migrationName, 'create_problem_type_test_runs migration should exist')

  const migrationSource = readFileSync(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), 'utf8')
  assert.match(migrationSource, /create table(?: if not exists)? public\.problem_type_test_runs/)
  assert.match(migrationSource, /attempts jsonb not null default '\[\]'::jsonb/)
  assert.match(migrationSource, /alter table public\.problem_type_test_runs enable row level security/)
  assert.match(migrationSource, /public\.is_admin\(\)/)
})
