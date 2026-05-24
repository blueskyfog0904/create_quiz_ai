import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname)
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
const readIfExists = (relativePath) => {
  const filePath = path.join(repoRoot, relativePath)
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
}

test('admin bank problem type APIs use question_bank_problem_types', () => {
  const listRoute = readIfExists('src/app/api/admin/question-bank/problem-types/route.ts')
  const idRoute = readIfExists('src/app/api/admin/question-bank/problem-types/[id]/route.ts')

  assert.match(listRoute, /from\('question_bank_problem_types'\)/)
  assert.match(listRoute, /resolveAdminWorkspaceSubject/)
  assert.match(listRoute, /export\s+async\s+function\s+GET/)
  assert.match(listRoute, /export\s+async\s+function\s+POST/)
  assert.match(idRoute, /from\('question_bank_problem_types'\)/)
  assert.match(idRoute, /export\s+async\s+function\s+PATCH/)
  assert.match(idRoute, /export\s+async\s+function\s+DELETE/)
  assert.match(idRoute, /is_active:\s*false|\.update\(\{[\s\S]*is_active\s*:/)
})

test('admin upload route sends bankProblemTypeId to question-bank RPCs', () => {
  const route = read('src/app/api/admin/questions/upload/route.ts')

  assert.match(route, /bankProblemTypeId/)
  assert.match(route, /create_admin_bank_question/)
  assert.match(route, /create_admin_bank_questions_bulk/)
  assert.doesNotMatch(route, /problem_type_id:\s*sanitized\.problem_type_id/)
})

test('bulk upload parser treats bankProblemTypeId as primary and problem type name as fallback', () => {
  const route = read('src/app/api/admin/questions/bulk-upload/route.ts')

  assert.match(route, /bankProblemTypeId/)
  assert.match(route, /from\('question_bank_problem_types'\)/)
  assert.match(route, /문제유형/)
  assert.match(route, /type_name/)
})

test('template route exposes bankProblemTypeId and question bank type list', () => {
  const route = read('src/app/api/admin/questions/template/route.ts')

  assert.match(route, /bankProblemTypeId/)
  assert.match(route, /question_bank_problem_types/)
  assert.match(route, /문제은행유형목록|은행문제유형목록/)
})

test('random exam and availability APIs keep request field name but use bank type semantics', () => {
  const randomRoute = read('src/app/api/exam-papers/random-bank/route.ts')
  const availabilityRoute = read('src/app/api/question-bank/availability/route.ts')

  assert.match(randomRoute, /typeCounts/)
  assert.match(randomRoute, /problemTypeId/)
  assert.match(randomRoute, /create_random_bank_exam_paper/)
  assert.match(availabilityRoute, /get_question_bank_availability/)
  assert.match(availabilityRoute, /problemTypeId/)
})

test('admin bank problem type management UI is discoverable and uses bank type APIs', () => {
  const page = readIfExists('src/app/(admin)/admin/question-bank/problem-types/page.tsx')
  const client = readIfExists('src/app/(admin)/admin/question-bank/problem-types/question-bank-problem-types-client.tsx')
  const sidebar = read('src/lib/admin-sidebar.ts')

  assert.match(page, /문제은행 문제유형 설정/)
  assert.match(page, /QuestionBankProblemTypesClient/)
  assert.match(client, /\/api\/admin\/question-bank\/problem-types/)
  assert.match(client, /method:\s*'POST'/)
  assert.match(client, /method:\s*'PATCH'/)
  assert.match(client, /method:\s*'DELETE'/)
  assert.match(client, /문제유형 추가/)
  assert.match(client, /수정/)
  assert.match(client, /비활성화/)
  assert.match(sidebar, /\/admin\/question-bank\/problem-types/)
  assert.match(sidebar, /문제유형 설정/)
})
