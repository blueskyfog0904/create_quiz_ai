import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const route = () => readFileSync(new URL('../src/app/api/admin/questions/filled-template/route.ts', import.meta.url), 'utf8')
const templateRoute = () => readFileSync(new URL('../src/app/api/admin/questions/template/route.ts', import.meta.url), 'utf8')

test('filled template route is admin-only parse-only and delegates workbook construction', () => {
  const source = route()

  assert.match(source, /auth\.getUser\(\)/)
  assert.match(source, /select\('is_admin'\)/)
  assert.match(source, /validateFilledTemplateQuestions/)
  assert.match(source, /buildFilledTemplateWorkbook/)
  assert.doesNotMatch(source, /\.rpc\(/)
  assert.doesNotMatch(source, /\.from\('[^']+'\)\s*\n\s*\.(insert|update|upsert)/)
})

test('base template route uses the same shared header constant as filled template', () => {
  const source = templateRoute()

  assert.match(source, /QUESTION_UPLOAD_TEMPLATE_HEADERS/)
})
