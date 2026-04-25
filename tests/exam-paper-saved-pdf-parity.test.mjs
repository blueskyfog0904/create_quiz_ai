import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { regressionExamPaper } from './fixtures/exam-paper-two-column-regression.fixture.mjs'

const examPaperPdfPath = new URL('../src/lib/exam-paper-pdf.ts', import.meta.url)
const examPaperPdfSource = readFileSync(examPaperPdfPath, 'utf8')
const layoutContractPath = new URL('../src/lib/exam-paper-layout-contract.ts', import.meta.url)
const layoutContractSource = readFileSync(layoutContractPath, 'utf8')
const singleColumnLayoutSource = readFileSync(
  new URL('../src/lib/exam-paper-single-column-layout.ts', import.meta.url),
  'utf8'
)
const paginationModuleUrl = new URL(
  '../src/lib/exam-paper-pdf-pagination.js',
  import.meta.url
).href
const normalizeQuestionFieldModuleUrl = new URL(
  '../src/lib/questions/normalize-question-field.ts',
  import.meta.url
).href

async function loadRuntimePdfHarness() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-pdf-runtime-'))
  const runtimeLayoutContractPath = join(tempDir, 'exam-paper-layout-contract.runtime.ts')
  const runtimeSingleColumnLayoutPath = join(tempDir, 'exam-paper-single-column-layout.runtime.ts')
  const runtimePdfPath = join(tempDir, 'exam-paper-pdf.runtime.ts')

  writeFileSync(
    join(tempDir, 'pdfmake.stub.mjs'),
    [
      'export default {',
      '  createPdf(docDefinition) {',
      '    return {',
      '      getBlob(callback) {',
      '        callback(new Blob([JSON.stringify(docDefinition)], { type: "application/pdf" }))',
      '      },',
      '    }',
      '  },',
      '}',
      '',
    ].join('\n')
  )

  writeFileSync(
    join(tempDir, 'vfs-fonts.stub.mjs'),
    [
      'export const pdfMake = { vfs: {} }',
      'export default { pdfMake: { vfs: {} } }',
      '',
    ].join('\n')
  )

  writeFileSync(join(tempDir, 'exam-paper-pdf-vfs.stub.mjs'), 'export default {}\n')
  writeFileSync(join(tempDir, 'file-saver.stub.mjs'), 'export function saveAs() {}\n')

  writeFileSync(
    runtimeLayoutContractPath,
    layoutContractSource
      .replace(
        /'@\/lib\/exam-paper-pdf-pagination\.js'/g,
        `'${paginationModuleUrl}'`
      )
      .replace(
        /'@\/lib\/questions\/normalize-question-field'/g,
        `'${normalizeQuestionFieldModuleUrl}'`
      )
  )

  writeFileSync(
    runtimeSingleColumnLayoutPath,
    singleColumnLayoutSource
      .replace(/'@\/lib\/exam-paper-pdf-pagination\.js'/g, `'${paginationModuleUrl}'`)
      .replace(/'@\/lib\/questions\/normalize-question-field'/g, `'${normalizeQuestionFieldModuleUrl}'`)
  )

  const runtimePdfSource = examPaperPdfSource
    .replace(/'pdfmake\/build\/pdfmake'/g, "'./pdfmake.stub.mjs'")
    .replace(/'pdfmake\/build\/vfs_fonts'/g, "'./vfs-fonts.stub.mjs'")
    .replace(/'@\/lib\/exam-paper-pdf-vfs'/g, "'./exam-paper-pdf-vfs.stub.mjs'")
    .replace(/'file-saver'/g, "'./file-saver.stub.mjs'")
    .replace(/'@\/lib\/exam-paper-layout-contract'/g, "'./exam-paper-layout-contract.runtime.ts'")
    .replace(/'@\/lib\/exam-paper-single-column-layout'/g, "'./exam-paper-single-column-layout.runtime.ts'")
    .replace(
      /'@\/lib\/questions\/normalize-question-field'/g,
      `'${normalizeQuestionFieldModuleUrl}'`
    )
    .concat('\nexport { buildPdfDocumentDefinition as buildExamPaperPdfDocumentDefinition }\n')

  writeFileSync(runtimePdfPath, runtimePdfSource)

  const [pdfModule, layoutContractModule] = await Promise.all([
    import(`${pathToFileURL(runtimePdfPath).href}?t=${Date.now()}`),
    import(`${pathToFileURL(runtimeLayoutContractPath).href}?t=${Date.now()}`),
  ])

  return {
    buildExamPaperPdfDocumentDefinition: pdfModule.buildExamPaperPdfDocumentDefinition,
    buildExamPaperRenderOptions: layoutContractModule.buildExamPaperRenderOptions,
    buildQuestionSectionPlan: layoutContractModule.buildQuestionSectionPlan,
    buildTwoColumnLayoutPlan: layoutContractModule.buildTwoColumnLayoutPlan,
  }
}

async function buildRuntimeArtifacts(viewMode, examPaperOverride) {
  const runtime = await loadRuntimePdfHarness()
  const examPaper = examPaperOverride ?? {
    ...regressionExamPaper,
    viewMode,
    columnLayout: 'double',
  }
  const options = runtime.buildExamPaperRenderOptions(examPaper)
  const questionPlans = options.viewMode === 'exam-with-answers'
    ? [
      ...examPaper.questions.map((question) =>
        runtime.buildQuestionSectionPlan(question, {
          ...options,
          viewMode: 'exam-only',
          showQuestions: true,
          showAnswers: false,
        })
      ),
      ...examPaper.questions.map((question) =>
        runtime.buildQuestionSectionPlan(question, {
          ...options,
          viewMode: 'answer-only',
          showQuestions: false,
          showAnswers: true,
        })
      ),
    ]
    : examPaper.questions.map((question) =>
      runtime.buildQuestionSectionPlan(question, options)
    )
  const layoutPlan = runtime.buildTwoColumnLayoutPlan({
    questionPlans,
    profile: 'shared-default',
    target: 'pdf',
    hasDescription: Boolean(examPaper.description),
    forceAnswerStartOnNewPage: options.viewMode === 'exam-with-answers',
  })
  const docDefinition = runtime.buildExamPaperPdfDocumentDefinition(examPaper)
  const renderedPages = docDefinition.content.slice(examPaper.description ? 2 : 1)

  return {
    examPaper,
    questionPlans,
    layoutPlan,
    docDefinition,
    renderedPages,
  }
}

function createLongAnswerOnlyExamPaper() {
  return {
    ...regressionExamPaper,
    viewMode: 'answer-only',
    columnLayout: 'double',
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

function findRenderedSection(layoutPlan, renderedPages, sectionId) {
  for (const page of layoutPlan.pages) {
    const renderedPage = renderedPages[page.pageIndex]

    for (const column of page.columns) {
      const sectionIndex = column.sectionIds.indexOf(sectionId)

      if (sectionIndex === -1) {
        continue
      }

      return {
        pageIndex: page.pageIndex,
        columnIndex: column.columnIndex,
        sectionIndex,
        node: renderedPage.columns[column.columnIndex].stack[sectionIndex],
      }
    }
  }

  assert.fail(`expected to find rendered section ${sectionId}`)
}

test('saved PDF runtime pages preserve the shared planner section counts per page and column', async () => {
  const { layoutPlan, renderedPages } = await buildRuntimeArtifacts('exam-with-answers')

  assert.equal(renderedPages.length, layoutPlan.pages.length)

  layoutPlan.pages.forEach((page) => {
    const renderedPage = renderedPages[page.pageIndex]

    assert.equal(renderedPage.columnGap, 18)
    assert.equal(renderedPage.columns.length, 2)

    page.columns.forEach((column) => {
      assert.equal(
        renderedPage.columns[column.columnIndex].stack.length,
        column.sectionIds.length,
        `expected rendered page ${page.pageIndex + 1} column ${column.columnIndex + 1} to preserve planner section count`
      )
    })
  })
})

test('saved PDF runtime starts exam-with-answers answers on a new page', async () => {
  const { layoutPlan } = await buildRuntimeArtifacts('exam-with-answers')
  const lastQuestionPageIndex = Math.max(...layoutPlan.pages.map((page) => (
    page.columns.some((column) => column.sections.some((section) => section.kind !== 'answer'))
      ? page.pageIndex
      : -1
  )))
  const firstAnswerPageIndex = layoutPlan.pages.find((page) => (
    page.columns.some((column) => column.sections.some((section) => section.kind === 'answer'))
  ))?.pageIndex ?? -1

  assert.equal(firstAnswerPageIndex > lastQuestionPageIndex, true)
})

function createFlowBodyExamPaper(viewMode = 'exam-only') {
  const longBody = [
    regressionExamPaper.questions[0].questionTextForward,
    regressionExamPaper.questions[0].passageText,
    regressionExamPaper.questions[0].questionTextBackward,
    regressionExamPaper.questions[0].passageText,
  ].filter(Boolean).join(' ')

  return {
    ...regressionExamPaper,
    viewMode,
    columnLayout: 'double',
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

function createLongExamWithAnswersExamPaper() {
  return {
    ...regressionExamPaper,
    viewMode: 'exam-with-answers',
    columnLayout: 'double',
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

test('saved PDF runtime renders flow-body fragments as plain text nodes instead of boxed passage tables', async () => {
  const { layoutPlan, renderedPages } = await buildRuntimeArtifacts('exam-only', createFlowBodyExamPaper())
  const allPageIds = layoutPlan.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))

  assert.equal(allPageIds.some((sectionId) => sectionId.startsWith('question-1-forward')), false)
  assert.equal(allPageIds.some((sectionId) => sectionId.startsWith('question-1-passage')), false)
  assert.equal(allPageIds.some((sectionId) => sectionId.startsWith('question-1-backward')), false)
  assert.equal(allPageIds.includes('question-1-body-part-1'), true)
  assert.equal(allPageIds.some((sectionId) => sectionId.startsWith('question-1-body-part-2')), true)

  const header = findRenderedSection(layoutPlan, renderedPages, 'question-1-header').node
  const bodyPart = findRenderedSection(layoutPlan, renderedPages, 'question-1-body-part-1').node

  assert.match(header.text, /^1\./)
  assert.equal(Array.isArray(header.stack), false)
  assert.equal(bodyPart.table, undefined)
  assert.equal(Array.isArray(bodyPart.stack), true)
  assert.equal(bodyPart.stack[0].text.length > 0, true)
})

test('saved PDF runtime keeps answer blocks after the last merged flow-body fragment in exam-with-answers mode', async () => {
  const { layoutPlan } = await buildRuntimeArtifacts('exam-with-answers', createFlowBodyExamPaper('exam-with-answers'))
  const allSectionIds = layoutPlan.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))
  const lastBodyIndex = Math.max(...allSectionIds
    .map((sectionId, index) => sectionId.startsWith('question-1-body-part-') ? index : -1)
    .filter((index) => index >= 0))
  const answerIndex = allSectionIds.findIndex((sectionId) => sectionId.startsWith('question-1-answer'))

  assert.equal(lastBodyIndex >= 0, true)
  assert.equal(answerIndex > lastBodyIndex, true)
})

test('saved PDF runtime splits choice rows into separate planner fragments with tight spacing', async () => {
  const { layoutPlan, renderedPages } = await buildRuntimeArtifacts('exam-only')
  const choiceIds = layoutPlan.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))
  const choiceNode = findRenderedSection(layoutPlan, renderedPages, 'question-1-choice-part-1').node

  assert.equal(choiceIds.includes('question-1-choice-part-1'), true)
  assert.equal(choiceIds.includes('question-1-choice-part-5'), true)

  assert.equal(Array.isArray(choiceNode.stack), true)
  assert.equal(choiceNode.stack.length, 1)

  choiceNode.stack.forEach((row) => {
    assert.deepEqual(row.margin, [0, 0, 0, 0])
    assert.equal(row.fontSize, 13)
    assert.equal(row.lineHeight, 1.8)
  })
})

test('saved PDF runtime keeps explanation as a single plain text answer block with question label when continuation is not needed', async () => {
  const { layoutPlan, renderedPages } = await buildRuntimeArtifacts('exam-with-answers')
  const answerIds = layoutPlan.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))
  const firstAnswerId = answerIds.find((sectionId) => sectionId.startsWith('question-1-answer'))

  assert.equal(Boolean(firstAnswerId), true)

  const answerNode = findRenderedSection(layoutPlan, renderedPages, firstAnswerId).node
  assert.equal(Array.isArray(answerNode.stack), true)
  assert.equal(answerNode.stack.length, 3)
  assert.equal(answerNode.table, undefined)
  assert.equal(answerNode.stack[0].text, '1번')
  assert.match(answerNode.stack[1].text, /^정답:/)
  assert.match(answerNode.stack[2].text, /^해설:/)
})


test('saved PDF runtime can continue a long exam-with-answers explanation into multiple answer fragments', async () => {
  const { layoutPlan, renderedPages } = await buildRuntimeArtifacts('exam-with-answers', createLongExamWithAnswersExamPaper())
  const answerIds = layoutPlan.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))
  const firstFragmentNode = findRenderedSection(layoutPlan, renderedPages, 'question-2-answer-part-1').node
  const secondFragmentNode = findRenderedSection(layoutPlan, renderedPages, 'question-2-answer-part-2').node

  assert.equal(answerIds.includes('question-2-answer'), false)
  assert.equal(answerIds.includes('question-2-answer-part-1'), true)
  assert.equal(answerIds.includes('question-2-answer-part-2'), true)
  assert.equal(firstFragmentNode.stack[0].text, '2번')
  assert.match(firstFragmentNode.stack[1].text, /^정답:/)
  assert.equal(secondFragmentNode.stack.length, 1)
  assert.equal(secondFragmentNode.stack[0].text.startsWith('Explanation sentence'), true)
})

test('answer-only two-column PDF keeps the question number attached inside the plain text answer block', async () => {
  const { layoutPlan, renderedPages } = await buildRuntimeArtifacts('answer-only')
  const answerNode = findRenderedSection(layoutPlan, renderedPages, 'question-1-answer-part-1').node

  assert.equal(Array.isArray(answerNode.stack), true)
  assert.equal(answerNode.stack.length, 3)
  assert.equal(answerNode.stack[0].text, '1번')
  assert.equal(answerNode.table, undefined)
  assert.match(answerNode.stack[1].text, /^정답:/)
  assert.match(answerNode.stack[2].text, /^해설:/)
})

test('answer-only two-column PDF can continue a long explanation into later answer fragments', async () => {
  const { layoutPlan, renderedPages } = await buildRuntimeArtifacts(
    'answer-only',
    createLongAnswerOnlyExamPaper()
  )
  const allSectionIds = layoutPlan.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))
  const firstFragmentNode = findRenderedSection(layoutPlan, renderedPages, 'question-2-answer-part-1').node
  const secondFragmentNode = findRenderedSection(layoutPlan, renderedPages, 'question-2-answer-part-2').node

  assert.ok(allSectionIds.includes('question-2-answer-part-1'))
  assert.ok(allSectionIds.includes('question-2-answer-part-2'))
  assert.equal(firstFragmentNode.stack[0].text, '2번')
  assert.match(firstFragmentNode.stack[1].text, /^정답:/)
  assert.equal(secondFragmentNode.stack.length, 1)
  assert.equal(secondFragmentNode.stack[0].text.startsWith('Explanation sentence'), true)
})

test('saved PDF runtime styles stay aligned with preview-facing typography', async () => {
  const { docDefinition } = await buildRuntimeArtifacts('exam-with-answers')

  assert.equal(docDefinition.pageSize, 'A4')
  assert.deepEqual(docDefinition.pageMargins, [36, 40, 36, 40])
  assert.equal(docDefinition.styles.title.fontSize, 24)
  assert.deepEqual(docDefinition.styles.title.margin, [0, 0, 0, 10])
  assert.equal(docDefinition.styles.description.fontSize, 14)
  assert.deepEqual(docDefinition.styles.description.margin, [0, 0, 0, 30])
  assert.equal(docDefinition.styles.questionText.fontSize, 14)
  assert.deepEqual(docDefinition.styles.questionText.margin, [0, 0, 0, 12])
  assert.equal(docDefinition.styles.boxedText.fontSize, 13)
  assert.equal(docDefinition.styles.boxedText.lineHeight, 1.8)
})
