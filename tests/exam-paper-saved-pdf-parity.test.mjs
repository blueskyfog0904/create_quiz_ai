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
  const questionPlans = examPaper.questions.map((question) =>
    runtime.buildQuestionSectionPlan(question, options)
  )
  const layoutPlan = runtime.buildTwoColumnLayoutPlan({
    questionPlans,
    profile: 'shared-default',
    target: 'pdf',
    hasDescription: Boolean(examPaper.description),
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

test('saved PDF runtime can split question 1 passage into linked boxed fragments', async () => {
  const { layoutPlan, renderedPages } = await buildRuntimeArtifacts('exam-only')
  const page1Ids = layoutPlan.pages[0].columns.flatMap((column) => column.sectionIds)

  assert.equal(page1Ids.some((sectionId) => sectionId.startsWith('question-1-passage-part-')), true)

  const header = findRenderedSection(layoutPlan, renderedPages, 'question-1-header').node
  const firstPassage = findRenderedSection(layoutPlan, renderedPages, 'question-1-passage-part-1').node
  const firstPassageCell = firstPassage.table.body[0][0]

  assert.match(header.text, /^1\./)
  assert.equal(Array.isArray(header.stack), false)
  assert.equal(header.unbreakable, undefined)
  assert.ok(firstPassage.table)
  assert.equal(Array.isArray(firstPassage.stack), false)
  assert.deepEqual(firstPassage.margin, [0, 0, 0, 0])
  assert.deepEqual(firstPassageCell.border, [true, true, true, false])
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

test('saved PDF runtime keeps the first answer fragment as a plain text block with question label', async () => {
  const { layoutPlan, renderedPages } = await buildRuntimeArtifacts('exam-with-answers')
  const answerIds = layoutPlan.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))

  assert.equal(answerIds.includes('question-1-answer-part-1'), true)

  const answerNode = findRenderedSection(layoutPlan, renderedPages, 'question-1-answer-part-1').node
  assert.equal(Array.isArray(answerNode.stack), true)
  assert.ok(answerNode.stack.length >= 2)
  assert.equal(answerNode.table, undefined)
  assert.equal(answerNode.stack[0].text, '1번')
  assert.match(answerNode.stack[1].text, /^정답:/)
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
  const laterFragmentId = allSectionIds.find((sectionId) => sectionId.startsWith('question-2-answer-part-') && sectionId !== 'question-2-answer-part-1')
  assert.ok(laterFragmentId)
  const laterFragmentNode = findRenderedSection(layoutPlan, renderedPages, laterFragmentId).node

  assert.ok(allSectionIds.includes('question-2-answer-part-1'))
  assert.ok(allSectionIds.some((sectionId) => sectionId.startsWith('question-2-answer-part-') && sectionId !== 'question-2-answer-part-1'))
  assert.equal(firstFragmentNode.stack[0].text, '2번')
  assert.match(firstFragmentNode.stack[1].text, /^정답:/)
  assert.ok(laterFragmentNode.stack.length >= 1)
  assert.equal(
    laterFragmentNode.stack.some((line) => typeof line.text === 'string' && line.text.trim().length > 0),
    true
  )
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
