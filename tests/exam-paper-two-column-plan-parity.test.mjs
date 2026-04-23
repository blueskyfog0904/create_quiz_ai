import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

import { regressionExamPaper } from './fixtures/exam-paper-two-column-regression.fixture.mjs'
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
        explanation: Array.from({ length: 14 }, (_, index) => (
          `Explanation sentence ${index + 1} explains in detail why the selected option is correct and how the supporting evidence accumulates across the passage.`
        )).join(' '),
      },
    ],
  }
}

function createLongAnsweredExamPaper() {
  return {
    ...regressionExamPaper,
    viewMode: 'exam-with-answers',
    questions: [
      {
        number: 1,
        questionText: 'unused in answered continuation regression',
        questionTextForward: null,
        questionTextBackward: null,
        passageText: null,
        choices: [],
        answer: '①',
        explanation: Array.from({ length: 40 }, (_, index) => (
          `Explanation sentence ${index + 1} explains in detail why the selected option is correct and how the supporting evidence accumulates across the passage.`
        )).join(' '),
      },
    ],
  }
}

function createLongSentenceAnswerOnlyExamPaper() {
  const longSentence = [
    'This explanation intentionally uses a single overlong sentence to force the planner',
    'to decide whether one sentence should stay together or be split more aggressively',
    'before the last line reaches the bottom edge of the preview column while the final clause keeps adding more descriptive phrasing',
    'so that the estimate and chunk size both have to do more work than they do for ordinary short answer explanations.',
  ].join(' ')

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
        explanation: longSentence,
      },
      {
        number: 2,
        questionText: 'unused in answer-only',
        questionTextForward: null,
        questionTextBackward: null,
        passageText: null,
        choices: [],
        answer: '②',
        explanation: `${longSentence} ${longSentence}`,
      },
    ],
  }
}

test('regression fixture still covers a multi-question answered 2-column paper', () => {
  assert.equal(regressionExamPaper.columnLayout, 'double')
  assert.equal(regressionExamPaper.questions.length >= 6, true)

  const questionNumbers = regressionExamPaper.questions.map((question) => question.number)
  assert.deepEqual(questionNumbers, [1, 2, 3, 4, 5, 6])

  const question1 = regressionExamPaper.questions.find((question) => question.number === 1)
  const question2 = regressionExamPaper.questions.find((question) => question.number === 2)

  assert.ok(question1?.passageText)
  assert.ok(question1?.choices?.length >= 5)
  assert.ok(question2?.answer)
})

test('shared layout contract exports the section planners needed for parity recovery', async () => {
  await getRequiredPlannerApi()
})

test('question 1 passage and choices can both split into continuation fragments in two-column mode', async () => {
  const { pdfPlan } = await buildRegressionPlans('exam-only')
  const page1Ids = getPageSectionIds(pdfPlan, 0).flat()
  const allPageIds = pdfPlan.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))

  assert.equal(page1Ids.some((sectionId) => sectionId.startsWith('question-1-passage-part-')), true)
  assert.equal(allPageIds.includes('question-1-choice-part-1'), true)
  assert.equal(allPageIds.includes('question-1-choice-part-5'), true)
})

test('exam-only two-column can split a long passage into continuation fragments to reduce underfill', async () => {
  const {
    buildExamPaperRenderOptions,
    buildQuestionSectionPlan,
    buildTwoColumnLayoutPlan,
  } = await getRequiredPlannerApi()

  const examPaper = { ...underfillExamPaper }
  const options = buildExamPaperRenderOptions(examPaper)
  const questionPlans = examPaper.questions.map((question) =>
    buildQuestionSectionPlan(question, options)
  )
  const layout = buildTwoColumnLayoutPlan({
    questionPlans,
    profile: 'shared-default',
    target: 'preview',
    hasDescription: true,
  })
  const allIds = layout.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))

  assert.ok(
    allIds.some((sectionId) => sectionId.startsWith('question-1-passage-part-')),
    'expected long passage to be split into continuation fragments'
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

test('answered-mode first page still keeps the first answer fragment on page 1 while using the shared bottom guard band', async () => {
  const { pdfPlan } = await buildRegressionPlans('exam-with-answers')
  const page1RightIds = getPageSectionIds(pdfPlan, 0)[1]

  assert.ok(page1RightIds.some((sectionId) => sectionId.startsWith('question-1-answer-part-')))
})

test('preview/pdf parity keeps identical page grouping after removing first-page isolation', async () => {
  const { previewPlan, pdfPlan } = await buildRegressionPlans('exam-with-answers')

  assert.deepEqual(
    pdfPlan.pages.map((page) => page.columns.flatMap((column) => column.sectionIds)),
    previewPlan.pages.map((page) => page.columns.flatMap((column) => column.sectionIds))
  )
})

test('answer-only and exam-with-answers both fragment long answers in two-column mode', async () => {
  const {
    buildExamPaperRenderOptions,
    buildQuestionSectionPlan,
    buildTwoColumnLayoutPlan,
  } = await getRequiredPlannerApi()

  const answerOnlyExamPaper = createLongAnswerOnlyExamPaper()
  const answerOnlyOptions = buildExamPaperRenderOptions(answerOnlyExamPaper)
  const answerOnlyPlans = answerOnlyExamPaper.questions.map((question) =>
    buildQuestionSectionPlan(question, answerOnlyOptions)
  )
  const answerOnlyLayout = buildTwoColumnLayoutPlan({
    questionPlans: answerOnlyPlans,
    profile: 'shared-default',
    target: 'preview',
    hasDescription: true,
  })

  const answerOnlyIds = answerOnlyLayout.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))
  assert.ok(answerOnlyIds.includes('question-2-answer-part-1'))
  assert.ok(answerOnlyIds.includes('question-2-answer-part-2'))

  const answeredOptions = buildExamPaperRenderOptions({
    ...answerOnlyExamPaper,
    viewMode: 'exam-with-answers',
  })
  const answeredPlans = answerOnlyExamPaper.questions.map((question) =>
    buildQuestionSectionPlan(question, answeredOptions)
  )
  const answeredLayout = buildTwoColumnLayoutPlan({
    questionPlans: answeredPlans,
    profile: 'shared-default',
    target: 'preview',
    hasDescription: true,
  })
  const answeredIds = answeredLayout.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))

  assert.ok(answeredIds.includes('question-2-answer-part-1'))
  assert.ok(answeredIds.some((sectionId) => sectionId.startsWith('question-2-answer-part-')))
})

test('exam-with-answers two-column can continue a long answer into later fragments when needed', async () => {
  const {
    buildExamPaperRenderOptions,
    buildQuestionSectionPlan,
    buildTwoColumnLayoutPlan,
  } = await getRequiredPlannerApi()

  const answeredExamPaper = createLongAnsweredExamPaper()
  const answeredOptions = buildExamPaperRenderOptions(answeredExamPaper)
  const answeredPlans = answeredExamPaper.questions.map((question) =>
    buildQuestionSectionPlan(question, answeredOptions)
  )
  const answeredLayout = buildTwoColumnLayoutPlan({
    questionPlans: answeredPlans,
    profile: 'shared-default',
    target: 'preview',
    hasDescription: true,
  })
  const answeredIds = answeredLayout.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))

  assert.ok(answeredIds.includes('question-1-answer-part-1'))
  assert.ok(answeredIds.some((sectionId) => sectionId.startsWith('question-1-answer-part-')))
})

test('answer-only two-column splits overlong explanation sentences more aggressively than the legacy 220-char chunk size', async () => {
  const {
    buildExamPaperRenderOptions,
    buildQuestionSectionPlan,
    buildTwoColumnLayoutPlan,
  } = await getRequiredPlannerApi()

  const answerOnlyExamPaper = createLongSentenceAnswerOnlyExamPaper()
  const answerOnlyOptions = buildExamPaperRenderOptions(answerOnlyExamPaper)
  const answerOnlyPlans = answerOnlyExamPaper.questions.map((question) =>
    buildQuestionSectionPlan(question, answerOnlyOptions)
  )
  const answerOnlyLayout = buildTwoColumnLayoutPlan({
    questionPlans: answerOnlyPlans,
    profile: 'shared-default',
    target: 'preview',
    hasDescription: true,
  })

  const answerOnlyIds = answerOnlyLayout.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))
  assert.ok(answerOnlyIds.includes('question-2-answer-part-1'))
  assert.ok(answerOnlyIds.includes('question-2-answer-part-6'))
})
