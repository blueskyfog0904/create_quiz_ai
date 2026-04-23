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

function createFlowBodyExamPaper() {
  const longBody = [
    regressionExamPaper.questions[0].questionTextForward,
    regressionExamPaper.questions[0].passageText,
    regressionExamPaper.questions[0].questionTextBackward,
    regressionExamPaper.questions[0].passageText,
  ].filter(Boolean).join(' ')

  return {
    ...regressionExamPaper,
    viewMode: 'exam-only',
    questions: [
      {
        ...regressionExamPaper.questions[0],
        questionTextForward: regressionExamPaper.questions[0].questionTextForward,
        passageText: longBody,
        questionTextBackward: regressionExamPaper.questions[0].questionTextBackward,
      },
      ...regressionExamPaper.questions.slice(1, 3),
    ],
  }
}

test('question body merges forward/passage/backward into flow-body fragments before choices', async () => {
  const {
    buildExamPaperRenderOptions,
    buildQuestionSectionPlan,
    buildTwoColumnLayoutPlan,
  } = await getRequiredPlannerApi()

  const examPaper = createFlowBodyExamPaper()
  const options = buildExamPaperRenderOptions(examPaper)
  const questionPlans = examPaper.questions.map((question) =>
    buildQuestionSectionPlan(question, options)
  )
  const pdfPlan = buildTwoColumnLayoutPlan({
    questionPlans,
    profile: 'shared-default',
    target: 'pdf',
    hasDescription: true,
  })
  const allPageIds = pdfPlan.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))

  assert.equal(allPageIds.some((sectionId) => sectionId.startsWith('question-1-forward')), false)
  assert.equal(allPageIds.some((sectionId) => sectionId.startsWith('question-1-passage')), false)
  assert.equal(allPageIds.some((sectionId) => sectionId.startsWith('question-1-backward')), false)
  assert.equal(allPageIds.includes('question-1-body-part-1'), true)
  assert.equal(allPageIds.some((sectionId) => sectionId.startsWith('question-1-body-part-2')), true)
  assert.equal(allPageIds.includes('question-1-choice-part-1'), true)
  assert.equal(allPageIds.includes('question-1-choice-part-5'), true)
})

test('merged flow-body continuation uses same-page right before next-page left', async () => {
  const {
    buildExamPaperRenderOptions,
    buildQuestionSectionPlan,
    buildTwoColumnLayoutPlan,
  } = await getRequiredPlannerApi()

  const examPaper = createFlowBodyExamPaper()
  const options = buildExamPaperRenderOptions(examPaper)
  const questionPlans = examPaper.questions.map((question) =>
    buildQuestionSectionPlan(question, options)
  )
  const pdfPlan = buildTwoColumnLayoutPlan({
    questionPlans,
    profile: 'shared-default',
    target: 'pdf',
    hasDescription: true,
  })

  const page1RightIds = getPageSectionIds(pdfPlan, 0)[1]
  const page2LeftIds = getPageSectionIds(pdfPlan, 1)[0]

  assert.equal(page1RightIds.includes('question-2-body-part-2'), true)
  assert.equal(page2LeftIds[0], 'question-2-body-part-3')
  assert.equal(page2LeftIds.includes('question-3-header'), true)
  assert.equal(
    page2LeftIds.indexOf('question-2-body-part-3') < page2LeftIds.indexOf('question-3-header'),
    true,
    'expected question 3 header to appear only after question 2 flow-body finishes on the next page left column'
  )
})

test('buildQuestionSectionPlan folds normalized backward text into the merged double-column body flow', async () => {
  const { buildExamPaperRenderOptions, buildQuestionSectionPlan } = await getRequiredPlannerApi()
  const options = buildExamPaperRenderOptions({
    viewMode: 'exam-only',
    columnLayout: 'double',
  })

  const sectionPlan = buildQuestionSectionPlan(
    {
      number: 99,
      questionText: '다음 문장을 읽고 물음에 답하시오.',
      questionTextForward: 'Forward prompt stays before the merged flow.',
      passageText: 'Passage body stays in the same merged flow.',
      questionTextBackward: '  ↓   Backward prompt stays after normalization.  ',
    },
    options
  )
  const bodySection = sectionPlan.sections.find(
    (section) => section.sectionKey === 'body'
  )

  assert.ok(bodySection, 'expected merged body section to be emitted when double-column body text exists')
  assert.equal(
    bodySection.text?.includes('Backward prompt stays after normalization.'),
    true,
    'expected normalized backward text to be preserved inside the merged body flow'
  )
  assert.equal(
    bodySection.text?.includes('↓'),
    false,
    'expected leading downward marker to be removed before merged body text is stored'
  )
})

test('answered-mode first page still keeps question 1 answer on page 1 while using the shared bottom guard band', async () => {
  const { pdfPlan } = await buildRegressionPlans('exam-with-answers')
  const page1RightIds = getPageSectionIds(pdfPlan, 0)[1]

  assert.ok(page1RightIds.includes('question-1-answer'))
})

test('preview/pdf parity keeps identical page grouping after removing first-page isolation', async () => {
  const { previewPlan, pdfPlan } = await buildRegressionPlans('exam-with-answers')

  assert.deepEqual(
    pdfPlan.pages.map((page) => page.columns.flatMap((column) => column.sectionIds)),
    previewPlan.pages.map((page) => page.columns.flatMap((column) => column.sectionIds))
  )
})

test('two-column long answer text can fragment in both answer-only and exam-with-answers modes', async () => {
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

  assert.equal(answeredIds.includes('question-2-answer'), false)
  assert.equal(answeredIds.some((sectionId) => sectionId.startsWith('question-2-answer-part-')), true)
})

test('answer-only two-column still splits overlong explanation sentences into multiple fragments', async () => {
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
  assert.ok(answerOnlyIds.includes('question-2-answer-part-4'))
})
