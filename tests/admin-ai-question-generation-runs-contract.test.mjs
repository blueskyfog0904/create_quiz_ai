import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const adminSidebarSource = readSource('src/lib/admin-sidebar.ts')
const listApiPath = 'src/app/api/admin/ai-question-generation-runs/route.ts'
const detailApiPath = 'src/app/api/admin/ai-question-generation-runs/[runId]/route.ts'
const downloadApiPath = 'src/app/api/admin/ai-question-generation-runs/[runId]/download/route.ts'
const pagePath = 'src/app/(admin)/admin/ai-question-generation-runs/page.tsx'
const clientPath = 'src/app/(admin)/admin/ai-question-generation-runs/ai-question-generation-runs-client.tsx'
const detailPagePath = 'src/app/(admin)/admin/ai-question-generation-runs/[runId]/page.tsx'

test('admin sidebar exposes AI generation logs menu near AI settings', () => {
  assert.match(adminSidebarSource, /\/admin\/ai-question-generation-runs/)
  assert.match(adminSidebarSource, /AI 생성 로그/)
})

test('admin AI generation run APIs exist and enforce admin access', () => {
  for (const path of [listApiPath, detailApiPath, downloadApiPath]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, `${path} should exist`)
    const source = readSource(path)
    assert.match(source, /select\('is_admin'\)/)
    assert.match(source, /!profile\?\.is_admin/)
    assert.match(source, /ai_question_generation_runs/)
    assert.match(source, /pruneExpiredAiQuestionGenerationRuns/)
  }

  const listApiSource = readSource(listApiPath)
  assert.doesNotMatch(listApiSource, /attempts/)
  assert.match(listApiSource, /limit\(limit\)/)
})

test('admin AI generation run pages show list, detail, filters, and JSON download controls', () => {
  for (const path of [pagePath, clientPath, detailPagePath]) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, `${path} should exist`)
  }

  const pageSource = readSource(pagePath)
  const clientSource = readSource(clientPath)
  const detailPageSource = readSource(detailPagePath)

  assert.match(pageSource, /AI 생성 로그/)
  assert.match(pageSource, /ai_question_generation_runs/)
  assert.match(clientSource, /상태/)
  assert.match(clientSource, /생성 흐름/)
  assert.match(clientSource, /교재형 생성/)
  assert.match(clientSource, /JSON 다운로드/)
  assert.match(clientSource, /redaction_flags|redactionFlags/)
  assert.match(detailPageSource, /attempts/)
  assert.match(detailPageSource, /회차별 진행 로그/)
  assert.match(detailPageSource, /30일/)
})
