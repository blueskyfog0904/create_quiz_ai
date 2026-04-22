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
const ANSWER_ONLY_DOUBLE_GUARD_BAND_UNITS = 80

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

test('first page uses remaining answered-mode space for question 2 instead of isolating question 1', async () => {
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

  const page1Left = layoutPlan.pages[0].columns[0]
  const page1Right = layoutPlan.pages[0].columns[1]
  const page1Ids = [...page1Left.sectionIds, ...page1Right.sectionIds]
  const page1LeftUsedUnits = sumColumnUnits(page1Left)
  const page1LeftSlack = FIRST_PAGE_CAPACITY_WITH_DESCRIPTION - page1LeftUsedUnits

  assert.ok(page1Ids.includes('question-1-passage'))
  assert.ok(page1Ids.includes('question-1-answer'))
  assert.ok(
    page1Ids.includes('question-2-header'),
    'expected question 2 to start on page 1 so the lower whitespace is reduced'
  )
  assert.equal(
    page1Ids.some((sectionId) => sectionId.startsWith('question-1-passage-part-')),
    false,
    'expected the first passage to stay atomic'
  )
  assert.ok(
    page1LeftSlack < 200,
    `expected the first-left slack to stay under 200 units, got ${page1LeftSlack}`
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

  assert.ok(
    page1RightUsedUnits <= FIRST_PAGE_CAPACITY_WITH_DESCRIPTION - ANSWER_ONLY_DOUBLE_GUARD_BAND_UNITS,
    `expected answer-only right column to reserve at least ${ANSWER_ONLY_DOUBLE_GUARD_BAND_UNITS} units, got ${FIRST_PAGE_CAPACITY_WITH_DESCRIPTION - page1RightUsedUnits}`
  )
})
