import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const route = () => readFileSync(new URL('../src/app/api/admin/questions/hwpx-analyze/route.ts', import.meta.url), 'utf8')

test('hwpx analyze route is admin-only parse-only and uses safe helpers', () => {
  const source = route()

  assert.match(source, /auth\.getUser\(\)/)
  assert.match(source, /select\('is_admin'\)/)
  assert.match(source, /validateHwpxUploadFile/)
  assert.match(source, /extractHwpxTextFromBuffer/)
  assert.match(source, /analyzeHwpxTextWithOpenAI/)
  assert.match(source, /buildHwpxPreviewQuestion/)
  assert.doesNotMatch(source, /\.rpc\('create_admin_bank_question/)
  assert.doesNotMatch(source, /\.from\('questions'\)\s*\n\s*\.(insert|upsert|update)/)
})

test('hwpx analyze route validates active dimensions and problem bank types', () => {
  const source = route()

  assert.match(source, /question_bank_years/)
  assert.match(source, /question_bank_books/)
  assert.match(source, /question_bank_problem_types/)
  assert.match(source, /yearId/)
  assert.match(source, /bookId/)
  assert.match(source, /is_active/)
  assert.match(source, /workspaceSubject/)
})

test('hwpx analyze route returns needsReview summary and usage without raw prompt logging', () => {
  const source = route()

  assert.match(source, /needsReview/)
  assert.match(source, /usage/)
  assert.match(source, /conversionStatus/)
  assert.match(source, /confidence/)
  assert.match(source, /sourceSnippet/)
  assert.doesNotMatch(source, /console\.log\([^\n]*(text|prompt|response)/i)
})
