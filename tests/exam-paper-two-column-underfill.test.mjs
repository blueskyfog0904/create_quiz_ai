import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

import { regressionExamPaper } from './fixtures/exam-paper-two-column-regression.fixture.mjs'

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

const FIRST_PAGE_CAPACITY_WITH_DESCRIPTION = 1120
const DOUBLE_GUARD_BAND_UNITS = 50
const MAX_EXPECTED_FIRST_PAGE_RIGHT_SLACK = 200

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

function createLongAnswerOnlyExamPaper() {
  return {
    ...regressionExamPaper,
    viewMode: 'answer-only',
    questions: [
      {
        number: 1,
        questionText: 'unused in answer-only',
        questionTextForward: null,
        questionTextBackward: null,
        passageText: null,
        choices: [],
        answer: '①',
        explanation: 'Short explanation to seed the page before the continued answer.',
      },
      {
        number: 2,
        questionText: 'unused in answer-only',
        questionTextForward: null,
        questionTextBackward: null,
        passageText: null,
        choices: [],
        answer: '②',
        explanation: Array.from({ length: 48 }, (_, index) => (
          `Explanation sentence ${index + 1} explains in detail why the selected option is correct and how the supporting evidence accumulates across the passage.`
        )).join(' '),
      },
    ],
  }
}

test('exam-with-answers two-column keeps a bottom guard band on the first page right column', async () => {
  const layoutContractModule = await loadRuntimeLayoutContractModule()
  const examPaper = {
    ...regressionExamPaper,
    viewMode: 'exam-with-answers',
  }
  const renderOptions = layoutContractModule.buildExamPaperRenderOptions(examPaper)
  const questionPlans = examPaper.questions.map((question) =>
    layoutContractModule.buildQuestionSectionPlan(question, renderOptions)
  )
  const layoutPlan = layoutContractModule.buildTwoColumnLayoutPlan({
    questionPlans,
    profile: 'shared-default',
    target: 'preview',
    hasDescription: true,
  })

  const page1Right = layoutPlan.pages[0].columns[1]
  const page1RightUsedUnits = sumColumnUnits(page1Right)
  const page1RightSlack = FIRST_PAGE_CAPACITY_WITH_DESCRIPTION - page1RightUsedUnits

  assert.ok(
    page1RightUsedUnits <= FIRST_PAGE_CAPACITY_WITH_DESCRIPTION - DOUBLE_GUARD_BAND_UNITS,
    `expected answered-mode right column to reserve at least ${DOUBLE_GUARD_BAND_UNITS} units, got ${FIRST_PAGE_CAPACITY_WITH_DESCRIPTION - page1RightUsedUnits}`
  )
  assert.ok(
    page1RightSlack < MAX_EXPECTED_FIRST_PAGE_RIGHT_SLACK,
    `expected answered-mode right column to stop over-reserving space, got ${page1RightSlack}`
  )
})

test('answer-only two-column keeps a bottom guard band on the first page right column', async () => {
  const layoutContractModule = await loadRuntimeLayoutContractModule()
  const examPaper = createLongAnswerOnlyExamPaper()
  const renderOptions = layoutContractModule.buildExamPaperRenderOptions(examPaper)
  const questionPlans = examPaper.questions.map((question) =>
    layoutContractModule.buildQuestionSectionPlan(question, renderOptions)
  )
  const layoutPlan = layoutContractModule.buildTwoColumnLayoutPlan({
    questionPlans,
    profile: 'shared-default',
    target: 'preview',
    hasDescription: true,
  })

  const page1Right = layoutPlan.pages[0].columns[1]
  const page1RightUsedUnits = sumColumnUnits(page1Right)
  const page1RightSlack = FIRST_PAGE_CAPACITY_WITH_DESCRIPTION - page1RightUsedUnits

  assert.ok(
    page1RightUsedUnits <= FIRST_PAGE_CAPACITY_WITH_DESCRIPTION - DOUBLE_GUARD_BAND_UNITS,
    `expected answer-only right column to reserve at least ${DOUBLE_GUARD_BAND_UNITS} units, got ${FIRST_PAGE_CAPACITY_WITH_DESCRIPTION - page1RightUsedUnits}`
  )
  assert.ok(
    page1RightSlack < MAX_EXPECTED_FIRST_PAGE_RIGHT_SLACK,
    `expected answer-only right column to stop over-reserving space, got ${page1RightSlack}`
  )
})

test('exam-only two-column keeps a bottom guard band on the first page right column', async () => {
  const layoutContractModule = await loadRuntimeLayoutContractModule()
  const examPaper = {
    ...regressionExamPaper,
    viewMode: 'exam-only',
  }
  const renderOptions = layoutContractModule.buildExamPaperRenderOptions(examPaper)
  const questionPlans = examPaper.questions.map((question) =>
    layoutContractModule.buildQuestionSectionPlan(question, renderOptions)
  )
  const layoutPlan = layoutContractModule.buildTwoColumnLayoutPlan({
    questionPlans,
    profile: 'shared-default',
    target: 'preview',
    hasDescription: true,
  })

  const page1Right = layoutPlan.pages[0].columns[1]
  const page1RightUsedUnits = sumColumnUnits(page1Right)
  const page1RightSlack = FIRST_PAGE_CAPACITY_WITH_DESCRIPTION - page1RightUsedUnits

  assert.ok(
    page1RightUsedUnits <= FIRST_PAGE_CAPACITY_WITH_DESCRIPTION - DOUBLE_GUARD_BAND_UNITS,
    `expected exam-only right column to reserve at least ${DOUBLE_GUARD_BAND_UNITS} units, got ${FIRST_PAGE_CAPACITY_WITH_DESCRIPTION - page1RightUsedUnits}`
  )
  assert.ok(
    page1RightSlack < MAX_EXPECTED_FIRST_PAGE_RIGHT_SLACK,
    `expected exam-only right column to stop over-reserving space, got ${page1RightSlack}`
  )
})
