import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const routePath = new URL('../src/app/api/admin/question-bank/backfill/route.ts', import.meta.url)
const pagePath = new URL('../src/app/(admin)/admin/question-bank/backfill/page.tsx', import.meta.url)
const clientPath = new URL('../src/app/(admin)/admin/question-bank/backfill/question-bank-backfill-client.tsx', import.meta.url)
const sidebarPath = new URL('../src/lib/admin-sidebar.ts', import.meta.url)

function readSource(path) {
  assert.equal(existsSync(path), true, `${path.pathname} must exist`)
  return readFileSync(path, 'utf8')
}

function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function assertAdminGuard(source) {
  assert.match(source, /supabase\.auth\.getUser\s*\(\s*\)/)
  assert.match(source, /from\(\s*['"]profiles['"]\s*\)[\s\S]*select\(\s*['"]is_admin['"]\s*\)/)
  assert.match(source, /profile\?\.is_admin|requireAdmin(User)?/)
  assert.doesNotMatch(source, /service[_-]?role/i)
}

function assertRpcOnlyRoute(source) {
  const uncommented = withoutComments(source)

  assert.match(uncommented, /rpc\(\s*['"]admin_audit_question_bank_metadata['"]\s*,/)
  assert.match(uncommented, /rpc\(\s*['"]admin_list_question_bank_backfill_candidates['"]\s*,/)
  assert.match(uncommented, /rpc\(\s*['"]backfill_question_bank_metadata['"]\s*,/)

  assert.doesNotMatch(uncommented, /from\(\s*['"]questions['"]\s*\)/)
  assert.doesNotMatch(uncommented, /from\(\s*['"]question_bank_question_metadata['"]\s*\)/)
  assert.doesNotMatch(uncommented, /\.upsert\s*\(/)
  assert.doesNotMatch(uncommented, /\.insert\s*\(/)
}

test('question bank backfill API is admin-only and delegates audit/candidate/apply work to RPCs', () => {
  const routeSource = readSource(routePath)

  assertAdminGuard(routeSource)
  assert.match(routeSource, /export\s+async\s+function\s+GET\b/)
  assert.match(routeSource, /export\s+async\s+function\s+POST\b/)
  assertRpcOnlyRoute(routeSource)

  for (const field of ['search', 'yearId', 'bookId', 'problemTypeId']) {
    assert.match(routeSource, new RegExp(field))
  }
  assert.match(routeSource, /p_workspace_subject:\s*workspaceSubject/)
  assert.match(routeSource, /p_filter:\s*filterJson/)
  assert.match(routeSource, /p_limit:\s*limit/)
  assert.match(routeSource, /p_offset:\s*offset/)
  assert.match(routeSource, /audit/)
  assert.match(routeSource, /candidates/)
  assert.match(routeSource, /pagination/)
})

test('question bank backfill API validates batch payload and supports dry-run and apply modes', () => {
  const routeSource = readSource(routePath)

  for (const field of ['sourceQuestionIds', 'yearId', 'bookId', 'dryRun']) {
    assert.match(routeSource, new RegExp(field))
  }

  assert.match(routeSource, /BACKFILL_BATCH_SIZE\s*=\s*500/)
  assert.match(routeSource, /max\(BACKFILL_BATCH_SIZE|length\s*>\s*BACKFILL_BATCH_SIZE/)
  assert.match(routeSource, /dryRun/)
  assert.match(routeSource, /backfill_question_bank_metadata/)

  for (const code of ['ADMIN_REQUIRED', 'AUTH_REQUIRED', 'INVALID_SCOPE', 'INACTIVE_DIMENSION', 'INVALID_SOURCE', 'BACKFILL_BATCH_TOO_LARGE']) {
    assert.match(routeSource, new RegExp(code))
  }
  assert.match(routeSource, /status:\s*400/)
  assert.match(routeSource, /status:\s*401/)
  assert.match(routeSource, /status:\s*403/)
  assert.match(routeSource, /status:\s*500/)
})

test('question bank backfill UI exposes audit summary, selection, dry-run/apply, and validation guidance', () => {
  const pageSource = readSource(pagePath)
  const clientSource = readSource(clientPath)

  assert.match(pageSource, /resolveAdminWorkspaceSubject/)
  assert.match(pageSource, /QuestionBankBackfillClient/)
  assert.match(clientSource, /\/api\/admin\/question-bank\/backfill\?subject=/)

  for (const label of [
    '미분류 관리자 원본',
    '영향받는 저장본',
    'AI 생성 제외',
    '중복 저장본',
    '누락',
    '패리티',
    '후보',
    '선택',
    '현재 페이지 전체 선택',
    '최대 500',
    '드라이런',
    '적용',
    'admin_updated_count',
    'copied_updated_count',
    'left join',
    'saved copy parity',
  ]) {
    assert.match(clientSource, new RegExp(label))
  }

  assert.match(clientSource, /sourceQuestionIds/)
  assert.match(clientSource, /yearId/)
  assert.match(clientSource, /bookId/)
  assert.match(clientSource, /dryRun/)
  assert.match(clientSource, /checked=/)
  assert.match(clientSource, /method:\s*['"]POST['"]|method:\s*"POST"/)
})

test('admin sidebar includes question bank backfill menu item by default', () => {
  const source = readSource(sidebarPath)

  assert.match(source, /['"]\/admin\/question-bank\/backfill['"]/) 
  assert.match(source, /문제은행 백필/)
})
