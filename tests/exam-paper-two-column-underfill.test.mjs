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
const OTHER_PAGE_CAPACITY_WITH_GUARD_BAND = 1230
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

async function buildPreviewLayoutPlan(examPaper) {
  const layoutContractModule = await loadRuntimeLayoutContractModule()
  const renderOptions = layoutContractModule.buildExamPaperRenderOptions(examPaper)
  const questionPlans = examPaper.questions.map((question) =>
    layoutContractModule.buildQuestionSectionPlan(question, renderOptions)
  )

  return layoutContractModule.buildTwoColumnLayoutPlan({
    questionPlans,
    profile: 'shared-default',
    target: 'preview',
    hasDescription: true,
  })
}

function createRegressionExamPaper(viewMode) {
  return {
    ...regressionExamPaper,
    viewMode,
  }
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

function createLongExamWithAnswersExamPaper() {
  return {
    ...regressionExamPaper,
    viewMode: 'exam-with-answers',
    questions: [
      regressionExamPaper.questions[0],
      {
        ...regressionExamPaper.questions[1],
        explanation: Array.from({ length: 20 }, (_, index) => (
          `Explanation sentence ${index + 1} explains in detail why the selected option is correct and how the supporting evidence accumulates across the passage.`
        )).join(' '),
      },
      ...regressionExamPaper.questions.slice(2, 5),
    ],
  }
}

function createRealisticExamWithAnswersUnderfillExamPaper() {
  return {
    title: regressionExamPaper.title,
    description: regressionExamPaper.description,
    viewMode: 'exam-with-answers',
    columnLayout: 'double',
    questions: [
      {
        ...regressionExamPaper.questions[0],
        questionTextBackward: null,
      },
      regressionExamPaper.questions[1],
    ],
  }
}

test('exam-with-answers two-column keeps a bottom guard band on the first page right column', async () => {
  const layoutPlan = await buildPreviewLayoutPlan(createRegressionExamPaper('exam-with-answers'))

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
  const layoutPlan = await buildPreviewLayoutPlan(createLongAnswerOnlyExamPaper())

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

test('exam-with-answers two-column continues a long answer before leaving a large non-terminal gap', async () => {
  const layoutPlan = await buildPreviewLayoutPlan(createLongExamWithAnswersExamPaper())

  const page2Left = layoutPlan.pages[1].columns[0]
  const page2Right = layoutPlan.pages[1].columns[1]
  const page2LeftUsedUnits = sumColumnUnits(page2Left)
  const page2RightUsedUnits = sumColumnUnits(page2Right)
  const page2LeftSlack = OTHER_PAGE_CAPACITY_WITH_GUARD_BAND - page2LeftUsedUnits

  assert.ok(
    page2LeftSlack < 220,
    `expected exam-with-answers page 2 left column to use most of the available space, got slack ${page2LeftSlack}`
  )
  assert.ok(
    page2RightUsedUnits <= OTHER_PAGE_CAPACITY_WITH_GUARD_BAND,
    `expected exam-with-answers page 2 right column to avoid overflow after answer continuation, got ${page2RightUsedUnits}`
  )
})

test('realistic exam-with-answers two-column pages stay dense instead of orphaning a short answer on a sparse next page', async () => {
  const layoutPlan = await buildPreviewLayoutPlan(createRealisticExamWithAnswersUnderfillExamPaper())

  const firstPage = layoutPlan.pages[0]
  const secondPage = layoutPlan.pages[1]
  const firstPageRightSlack = FIRST_PAGE_CAPACITY_WITH_DESCRIPTION - sumColumnUnits(firstPage.columns[1])

  assert.ok(
    firstPageRightSlack < 140,
    `expected realistic exam-with-answers page 1 right column slack < 140, got ${firstPageRightSlack}`
  )

  if (secondPage) {
    const secondPageLeftSlack = OTHER_PAGE_CAPACITY_WITH_GUARD_BAND - sumColumnUnits(secondPage.columns[0])

    assert.ok(
      secondPageLeftSlack < 700,
      `expected realistic exam-with-answers page 2 left column slack < 700, got ${secondPageLeftSlack}`
    )
  }
})

test('exam-only two-column keeps a bottom guard band on the first page right column', async () => {
  const layoutPlan = await buildPreviewLayoutPlan(createRegressionExamPaper('exam-only'))

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
