import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

import { underfillExamPaper } from './fixtures/exam-paper-two-column-underfill.fixture.mjs'

const sharedContractPath = new URL('../src/lib/exam-paper-layout-contract.ts', import.meta.url)
const sharedContractSource = readFileSync(sharedContractPath, 'utf8')
const paginationModuleUrl = new URL(
  '../src/lib/exam-paper-pdf-pagination.js',
  import.meta.url
).href
const normalizeQuestionFieldModuleUrl = new URL(
  '../src/lib/questions/normalize-question-field.ts',
  import.meta.url
).href

const FIRST_PAGE_CAPACITY_WITH_DESCRIPTION = 700

async function loadRuntimeLayoutContractModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-underfill-layout-contract-'))
  const tempModulePath = join(tempDir, 'exam-paper-layout-contract.runtime.ts')
  const runtimeSource = sharedContractSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)

  writeFileSync(tempModulePath, runtimeSource)

  return import(`${pathToFileURL(tempModulePath).href}?t=${Date.now()}`)
}

function sumColumnUnits(column) {
  return column.sections.reduce((sum, section) => sum + section.estimatedHeight, 0)
}

test('underfill fixture keeps passage fragments in reading order while reducing first-left slack', async () => {
  const layoutContractModule = await loadRuntimeLayoutContractModule()
  const renderOptions = layoutContractModule.buildExamPaperRenderOptions(underfillExamPaper)
  const questionPlans = underfillExamPaper.questions.map((question) =>
    layoutContractModule.buildQuestionSectionPlan(question, renderOptions)
  )
  const layoutPlan = layoutContractModule.buildTwoColumnLayoutPlan({
    questionPlans,
    profile: 'shared-default',
    target: 'preview',
    hasDescription: true,
  })

  const page1Left = layoutPlan.pages[0].columns[0]
  const page1Right = layoutPlan.pages[0].columns[1]
  const page1LeftUsedUnits = sumColumnUnits(page1Left)
  const page1LeftSlack = FIRST_PAGE_CAPACITY_WITH_DESCRIPTION - page1LeftUsedUnits

  assert.ok(page1Left.sectionIds.includes('question-1-header'))
  assert.ok(
    page1Left.sectionIds.includes('question-1-passage-part-1'),
    'expected the first passage fragment to stay in the first left column'
  )
  assert.ok(
    page1Right.sectionIds.some((sectionId) => sectionId.startsWith('question-1-passage-part-')),
    'expected later passage fragments to continue in the first right column'
  )
  assert.equal(
    page1Left.sectionIds.indexOf('question-1-header') <
      page1Left.sectionIds.indexOf('question-1-passage-part-1'),
    true,
    'expected the passage fragment to keep reading order after the header'
  )
  assert.equal(
    page1Left.sectionIds.filter((sectionId) => sectionId.startsWith('question-1-passage-part-')).length >= 2,
    true,
    'expected multiple passage fragments to stay in the first left column before spillover'
  )
  assert.ok(
    page1LeftSlack < 100,
    `expected first-left slack to drop below 100 units after fragmentation, got ${page1LeftSlack}`
  )
  assert.ok(
    page1LeftUsedUnits >= 600,
    `expected the first-left column to use at least 600 units after fragmentation, got ${page1LeftUsedUnits}`
  )
})
