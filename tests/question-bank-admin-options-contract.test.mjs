import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const routePaths = {
  years: new URL('../src/app/api/admin/question-bank/years/route.ts', import.meta.url),
  year: new URL('../src/app/api/admin/question-bank/years/[id]/route.ts', import.meta.url),
  books: new URL('../src/app/api/admin/question-bank/books/route.ts', import.meta.url),
  book: new URL('../src/app/api/admin/question-bank/books/[id]/route.ts', import.meta.url),
}

const pagePath = new URL('../src/app/(admin)/admin/question-bank/options/page.tsx', import.meta.url)
const clientPath = new URL('../src/app/(admin)/admin/question-bank/options/question-bank-options-client.tsx', import.meta.url)
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
}

function assertExports(source, names) {
  for (const name of names) {
    assert.match(source, new RegExp(String.raw`export\s+async\s+function\s+${name}\b`))
  }
}

function assertDuplicateMapsToConflict(source) {
  assert.match(source, /23505/)
  assert.match(source, /status:\s*409/)
}

function assertSoftDeactivate(source) {
  const uncommented = withoutComments(source)
  assert.match(uncommented, /update\(\s*\{\s*is_active:\s*false\s*\}/)
  assert.doesNotMatch(uncommented, /\.delete\s*\(\s*\)/)
}

function assertRejectsEmptyUpdatePayload(source) {
  assert.match(source, /Object\.keys\(payload\)\.length\s*===\s*0/)
  assert.match(source, /No fields to update/)
  assert.match(source, /status:\s*400/)
}

test('admin question bank dimension routes export required handlers and require admins', () => {
  const yearsSource = readSource(routePaths.years)
  const yearSource = readSource(routePaths.year)
  const booksSource = readSource(routePaths.books)
  const bookSource = readSource(routePaths.book)

  for (const source of [yearsSource, yearSource, booksSource, bookSource]) {
    assertAdminGuard(source)
  }

  assertExports(yearsSource, ['GET', 'POST'])
  assertExports(booksSource, ['GET', 'POST'])
  assertExports(yearSource, ['PATCH', 'DELETE'])
  assertExports(bookSource, ['PATCH', 'DELETE'])
})

test('year admin routes validate payload, scope writes, and map duplicate conflicts', () => {
  const collectionSource = readSource(routePaths.years)
  const itemSource = readSource(routePaths.year)

  for (const field of ['workspace_subject', 'year', 'label', 'sort_order', 'is_active']) {
    assert.match(collectionSource, new RegExp(String.raw`${field}:`))
    assert.match(itemSource, new RegExp(String.raw`${field}:`))
  }

  assert.match(collectionSource, /year:[\s\S]*\.min\(2000\)[\s\S]*\.max\(2100\)/)
  assert.match(itemSource, /year:[\s\S]*\.min\(2000\)[\s\S]*\.max\(2100\)/)
  assert.match(collectionSource, /from\(\s*['"]question_bank_years['"]\s*\)/)
  assert.match(itemSource, /from\(\s*['"]question_bank_years['"]\s*\)/)
  assert.match(itemSource, /searchParams\.get\(\s*['"]subject['"]\s*\)|workspace_subject|\bsubject\b/)
  assert.match(itemSource, /eq\(\s*['"]id['"]\s*,\s*params\.id\s*\)/)
  assert.match(itemSource, /eq\(\s*['"]workspace_subject['"]\s*,\s*workspaceSubject\s*\)/)
  assertDuplicateMapsToConflict(collectionSource)
  assertDuplicateMapsToConflict(itemSource)
  assertRejectsEmptyUpdatePayload(itemSource)
  assertSoftDeactivate(itemSource)
})

test('book admin routes validate payload including slug, scope writes, and map duplicate conflicts', () => {
  const collectionSource = readSource(routePaths.books)
  const itemSource = readSource(routePaths.book)

  for (const field of ['workspace_subject', 'name', 'slug', 'description', 'sort_order', 'is_active']) {
    assert.match(collectionSource, new RegExp(String.raw`${field}:`))
    assert.match(itemSource, new RegExp(String.raw`${field}:`))
  }

  assert.match(collectionSource, /\^\[a-z0-9\]\[a-z0-9-\]\*\$/)
  assert.match(itemSource, /\^\[a-z0-9\]\[a-z0-9-\]\*\$/)
  assert.match(collectionSource, /from\(\s*['"]question_bank_books['"]\s*\)/)
  assert.match(itemSource, /from\(\s*['"]question_bank_books['"]\s*\)/)
  assert.match(itemSource, /searchParams\.get\(\s*['"]subject['"]\s*\)|workspace_subject|\bsubject\b/)
  assert.match(itemSource, /eq\(\s*['"]id['"]\s*,\s*params\.id\s*\)/)
  assert.match(itemSource, /eq\(\s*['"]workspace_subject['"]\s*,\s*workspaceSubject\s*\)/)
  assertDuplicateMapsToConflict(collectionSource)
  assertDuplicateMapsToConflict(itemSource)
  assertRejectsEmptyUpdatePayload(itemSource)
  assertSoftDeactivate(itemSource)
})

test('question bank options admin UI supports year and book create edit save cancel and deactivate flows', () => {
  const pageSource = readSource(pagePath)
  const clientSource = readSource(clientPath)

  assert.match(pageSource, /resolveAdminWorkspaceSubject/)
  assert.match(pageSource, /QuestionBankOptionsClient/)
  assert.match(clientSource, /\/api\/admin\/question-bank\/years\?subject=/)
  assert.match(clientSource, /\/api\/admin\/question-bank\/books\?subject=/)

  for (const label of ['연도', '교재', '추가', '수정', '저장', '취소', '비활성화']) {
    assert.match(clientSource, new RegExp(label))
  }

  assert.match(clientSource, /setEditingYearId|editingYearId/)
  assert.match(clientSource, /setEditingBookId|editingBookId/)
  assert.match(clientSource, /method:\s*['"]POST['"]|method:\s*"POST"/)
  assert.match(clientSource, /method:\s*['"]PATCH['"]|method:\s*"PATCH"/)
  assert.match(clientSource, /method:\s*['"]DELETE['"]|method:\s*"DELETE"/)
  assert.match(clientSource, /409|중복|이미 존재/)
})

test('admin sidebar includes default question bank options menu item', () => {
  const source = readSource(sidebarPath)

  assert.match(source, /['"]\/admin\/question-bank\/options['"]/)
  assert.match(source, /연도·교재 설정/)
  assert.match(source, /icon:\s*['"](?:settings|database|bookOpen)['"]/)
})
