import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

import {
  regressionExamPaper,
  regressionParityExpectations,
} from './fixtures/exam-paper-two-column-regression.fixture.mjs'

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

async function loadRuntimeLayoutContractModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-layout-contract-'))
  const tempModulePath = join(tempDir, 'exam-paper-layout-contract.runtime.ts')
  const runtimeSource = sharedContractSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(
      /@\/lib\/questions\/normalize-question-field/g,
      normalizeQuestionFieldModuleUrl
    )

  writeFileSync(tempModulePath, runtimeSource)

  return import(`${pathToFileURL(tempModulePath).href}?t=${Date.now()}`)
}

async function getRequiredPlannerApi() {
  const layoutContractModule = await loadRuntimeLayoutContractModule()

  assert.equal(
    typeof layoutContractModule.buildExamPaperRenderOptions,
    'function',
    'expected buildExamPaperRenderOptions to stay available on the shared layout contract'
  )
  assert.equal(
    typeof layoutContractModule.buildQuestionSectionPlan,
    'function',
    'expected buildQuestionSectionPlan export on the shared layout contract'
  )
  assert.equal(
    typeof layoutContractModule.buildTwoColumnLayoutPlan,
    'function',
    'expected buildTwoColumnLayoutPlan export on the shared layout contract'
  )

  return {
    buildExamPaperRenderOptions: layoutContractModule.buildExamPaperRenderOptions,
    buildQuestionSectionPlan: layoutContractModule.buildQuestionSectionPlan,
    buildTwoColumnLayoutPlan: layoutContractModule.buildTwoColumnLayoutPlan,
  }
}

function getPageSectionIds(plan, pageIndex) {
  const page = plan.pages?.[pageIndex]

  assert.ok(page, `expected plan.pages[${pageIndex}] to exist`)

  return page.columns.map((column) => column.sectionIds)
}

function assertColumnIncludesAll(columnIds, expectedIds) {
  const columnIdSet = new Set(columnIds)

  expectedIds.forEach((sectionId) => {
    assert.equal(
      columnIdSet.has(sectionId),
      true,
      `expected column to include exact section id ${sectionId}`
    )
  })
}

function assertColumnExcludesAll(columnIds, excludedIds) {
  const columnIdSet = new Set(columnIds)

  excludedIds.forEach((sectionId) => {
    assert.equal(
      columnIdSet.has(sectionId),
      false,
      `expected column not to include exact section id ${sectionId}`
    )
  })
}

function assertPageIncludesAll(pageColumnIds, expectedIds) {
  const pageIdSet = new Set(pageColumnIds.flat())

  expectedIds.forEach((sectionId) => {
    assert.equal(
      pageIdSet.has(sectionId),
      true,
      `expected page to include exact section id ${sectionId}`
    )
  })
}

async function buildRegressionPlans(viewMode) {
  const {
    buildExamPaperRenderOptions,
    buildQuestionSectionPlan,
    buildTwoColumnLayoutPlan,
  } = await getRequiredPlannerApi()

  const examPaper = { ...regressionExamPaper, viewMode }
  const options = buildExamPaperRenderOptions(examPaper)
  const questionPlans = examPaper.questions.map((question) =>
    buildQuestionSectionPlan(question, options)
  )

  const sharedArgs = {
    questionPlans,
    profile: 'shared-default',
    hasDescription: true,
  }

  return {
    previewPlan: buildTwoColumnLayoutPlan({ ...sharedArgs, target: 'preview' }),
    pdfPlan: buildTwoColumnLayoutPlan({ ...sharedArgs, target: 'pdf' }),
  }
}

test('regression fixture covers the page 1 / 3 / 6 direct-PDF drift anchors', () => {
  assert.equal(regressionExamPaper.columnLayout, 'double')
  assert.equal(regressionExamPaper.questions.length >= 6, true)
  assert.deepEqual(regressionParityExpectations.targetedPages, [1, 3, 6])
  assert.deepEqual(
    regressionParityExpectations.sharedBuilders,
    ['buildQuestionSectionPlan', 'buildTwoColumnLayoutPlan']
  )

  const questionNumbers = regressionExamPaper.questions.map((question) => question.number)
  assert.deepEqual(questionNumbers, [1, 2, 3, 4, 5, 6])

  const question1 = regressionExamPaper.questions.find((question) => question.number === 1)
  const question4 = regressionExamPaper.questions.find((question) => question.number === 4)
  const question6 = regressionExamPaper.questions.find((question) => question.number === 6)

  assert.ok(question1?.passageText)
  assert.ok(question1?.choices?.length >= 5)
  assert.ok(question4?.answer)
  assert.ok(question6?.answer)

  assert.equal(
    regressionParityExpectations.page1.anchorReason,
    'left-column-lead-before-choice-spill'
  )
  assert.equal(
    regressionParityExpectations.page3.anchorReason,
    'prompt-answer-same-page-group'
  )
  assert.equal(
    regressionParityExpectations.page6.anchorReason,
    'preview-pdf-page-6-parity'
  )
})

test('shared layout contract exports the section planners needed for parity recovery', async () => {
  await getRequiredPlannerApi()
})

test('page 1 keeps question 1 header and passage in the left column before choices spill right', async () => {
  const { pdfPlan } = await buildRegressionPlans('exam-only')
  const leftColumnIds = getPageSectionIds(pdfPlan, regressionParityExpectations.page1.pageIndex)[0]

  assertColumnIncludesAll(leftColumnIds, regressionParityExpectations.page1.leadingSectionIds)
  assertColumnExcludesAll(
    leftColumnIds,
    regressionParityExpectations.page1.shouldNotAppearInLeftColumn
  )
})

test('buildQuestionSectionPlan normalizes questionTextBackward before storing sectionPlan.text', async () => {
  const { buildExamPaperRenderOptions, buildQuestionSectionPlan } = await getRequiredPlannerApi()
  const options = buildExamPaperRenderOptions({
    viewMode: 'exam-only',
    columnLayout: 'double',
  })

  const sectionPlan = buildQuestionSectionPlan(
    {
      number: 99,
      questionText: '다음 문장을 읽고 물음에 답하시오.',
      questionTextBackward: '  ↓   Backward prompt stays after normalization.  ',
    },
    options
  )
  const backwardSection = sectionPlan.sections.find(
    (section) => section.sectionKey === 'backward'
  )

  assert.ok(backwardSection, 'expected backward section to be emitted when text exists')
  assert.equal(
    backwardSection.text,
    'Backward prompt stays after normalization.',
    'expected backward text to drop the leading downward marker before sectionPlan.text is used'
  )
})

test('page 3 keeps the regression prompt and answer panel in the same page group', async () => {
  const { pdfPlan } = await buildRegressionPlans('exam-with-answers')
  const page3ColumnIds = getPageSectionIds(pdfPlan, regressionParityExpectations.page3.pageIndex)

  assertPageIncludesAll(page3ColumnIds, [
    regressionParityExpectations.page3.promptSectionId,
    regressionParityExpectations.page3.answerSectionId,
  ])
})

test('page 6 preview/pdf parity keeps the final regression prompt and answer on the same grouped page', async () => {
  const { previewPlan, pdfPlan } = await buildRegressionPlans('exam-with-answers')
  const previewPage6Ids = getPageSectionIds(
    previewPlan,
    regressionParityExpectations.page6.pageIndex
  )
  const pdfPage6Ids = getPageSectionIds(pdfPlan, regressionParityExpectations.page6.pageIndex)

  assertPageIncludesAll(previewPage6Ids, [
    regressionParityExpectations.page6.promptSectionId,
    regressionParityExpectations.page6.answerSectionId,
  ])
  assertPageIncludesAll(pdfPage6Ids, [
    regressionParityExpectations.page6.promptSectionId,
    regressionParityExpectations.page6.answerSectionId,
  ])
  assert.deepEqual(pdfPage6Ids, previewPage6Ids)
})
