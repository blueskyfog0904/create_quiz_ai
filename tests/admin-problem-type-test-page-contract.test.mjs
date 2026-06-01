import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const problemTypesClientSource = readSource('src/app/(admin)/admin/problem-types/problem-types-client.tsx')
const newFormSource = readSource('src/app/(admin)/admin/problem-types/new/problem-type-form-client.tsx')
const editFormSource = readSource('src/app/(admin)/admin/problem-types/[id]/edit/problem-type-form-client.tsx')

const testPagePath = 'src/app/(admin)/admin/problem-types/[id]/test/page.tsx'
const testClientPath = 'src/app/(admin)/admin/problem-types/[id]/test/problem-type-test-client.tsx'

test('registered problem types include a test action that opens the admin test page', () => {
  assert.match(problemTypesClientSource, /handleTest/)
  assert.match(problemTypesClientSource, /\/admin\/problem-types\/\$\{id\}\/test/)
  assert.match(problemTypesClientSource, />테스트</)
})

test('problem type forms collect generation, response-structure, and review prompts', () => {
  for (const source of [newFormSource, editFormSource]) {
    assert.match(source, /문제 생성 프롬프트/)
    assert.match(source, /응답 구조 프롬프트/)
    assert.match(source, /문제 검토 프롬프트/)
    assert.match(source, /name="prompt_template"/)
    assert.match(source, /name="output_format"/)
    assert.match(source, /name="review_prompt_template"/)
  }
})

test('admin problem type test page supports passage input methods and full loop logs', () => {
  assert.equal(existsSync(new URL(`../${testPagePath}`, import.meta.url)), true)
  assert.equal(existsSync(new URL(`../${testClientPath}`, import.meta.url)), true)

  const pageSource = readSource(testPagePath)
  const clientSource = readSource(testClientPath)

  assert.match(pageSource, /ProblemTypeTestClient/)
  assert.match(clientSource, /직접 입력/)
  assert.match(clientSource, /기존 등록 지문 불러오기/)
  assert.match(clientSource, /PassageSelectorModal/)
  assert.match(clientSource, /generation_started/)
  assert.match(clientSource, /generation_request_prompt/)
  assert.match(clientSource, /generation_response/)
  assert.match(clientSource, /review_request_payload/)
  assert.match(clientSource, /review_response/)
  assert.match(clientSource, /review_failed_feedback_to_generation/)
  assert.match(clientSource, /regeneration_request_prompt/)
  assert.match(clientSource, /regeneration_response/)
})
