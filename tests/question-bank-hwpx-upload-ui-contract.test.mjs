import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const uploadClient = () => readFileSync(new URL('../src/app/(admin)/admin/questions/upload/admin-upload-client.tsx', import.meta.url), 'utf8')

test('admin upload UI exposes HWPX AI analysis without replacing xlsx upload', () => {
  const source = uploadClient()

  assert.match(source, /AI 템플릿 변환/)
  assert.match(source, /\.hwpx/)
  assert.match(source, /\/api\/admin\/questions\/hwpx-analyze/)
  assert.match(source, /setParsedQuestions/)
  assert.match(source, /AI provider로 전송/)
  assert.match(source, /accept="\.xlsx,\.csv"/)
})

test('admin upload UI requires year and book before HWPX analysis', () => {
  const source = uploadClient()

  assert.match(source, /hwpxYearId/)
  assert.match(source, /hwpxBookId/)
  assert.match(source, /연도와 교재를 선택해주세요/)
  assert.match(source, /formData\.append\('yearId'/)
  assert.match(source, /formData\.append\('bookId'/)
})

test('admin upload UI shows conversion review metadata and blocks needs_review until approved', () => {
  const source = uploadClient()

  assert.match(source, /conversionStatus/)
  assert.match(source, /needs_review/)
  assert.match(source, /sourceSnippet/)
  assert.match(source, /confidence/)
  assert.match(source, /warnings/)
  assert.match(source, /검수 완료/)
  assert.match(source, /handleMarkHwpxQuestionReviewed/)
  assert.match(source, /type ChangeEvent/)
})

test('admin upload UI can download filled xlsx from parsed AI rows', () => {
  const source = uploadClient()

  assert.match(source, /채워진 템플릿 다운로드/)
  assert.match(source, /\/api\/admin\/questions\/filled-template/)
  assert.match(source, /parsedQuestions/)
})
