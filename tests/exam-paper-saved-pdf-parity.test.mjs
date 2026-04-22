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

  const runtimePdfSource = examPaperPdfSource
    .replace(/'pdfmake\/build\/pdfmake'/g, "'./pdfmake.stub.mjs'")
    .replace(/'pdfmake\/build\/vfs_fonts'/g, "'./vfs-fonts.stub.mjs'")
    .replace(/'@\/lib\/exam-paper-pdf-vfs'/g, "'./exam-paper-pdf-vfs.stub.mjs'")
    .replace(/'file-saver'/g, "'./file-saver.stub.mjs'")
    .replace(/'@\/lib\/exam-paper-layout-contract'/g, "'./exam-paper-layout-contract.runtime.ts'")
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

async function buildRuntimeArtifacts(viewMode) {
  const runtime = await loadRuntimePdfHarness()
  const examPaper = {
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

test('saved PDF runtime keeps question 1 passage as a single boxed area', async () => {
  const { layoutPlan, renderedPages } = await buildRuntimeArtifacts('exam-only')
  const page1Ids = layoutPlan.pages[0].columns.flatMap((column) => column.sectionIds)

  assert.equal(page1Ids.includes('question-1-passage'), true)
  assert.equal(page1Ids.some((sectionId) => sectionId.startsWith('question-1-passage-part-')), false)

  const header = findRenderedSection(layoutPlan, renderedPages, 'question-1-header').node
  const passage = findRenderedSection(layoutPlan, renderedPages, 'question-1-passage').node
  const passageCell = passage.table.body[0][0]

  assert.match(header.text, /^1\./)
  assert.equal(Array.isArray(header.stack), false)
  assert.equal(header.unbreakable, undefined)
  assert.ok(passage.table)
  assert.equal(Array.isArray(passage.stack), false)
  assert.deepEqual(passage.margin, [0, 0, 0, 8])
  assert.deepEqual(passageCell.border, [true, true, true, true])
})

test('saved PDF runtime choice rows remove extra spacing between 1-5 options', async () => {
  const { examPaper, layoutPlan, renderedPages } = await buildRuntimeArtifacts('exam-only')
  const choiceNode = findRenderedSection(layoutPlan, renderedPages, 'question-1-choice').node

  assert.equal(Array.isArray(choiceNode.stack), true)
  assert.equal(choiceNode.stack.length, examPaper.questions[0].choices.length)

  choiceNode.stack.forEach((row) => {
    assert.deepEqual(row.margin, [0, 0, 0, 0])
    assert.equal(row.fontSize, 13)
    assert.equal(row.lineHeight, 1.8)
  })
})

test('saved PDF runtime keeps explanation as a single decorated panel', async () => {
  const { layoutPlan, renderedPages } = await buildRuntimeArtifacts('exam-with-answers')
  const answerIds = layoutPlan.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))

  assert.equal(answerIds.includes('question-1-answer'), true)
  assert.equal(answerIds.some((sectionId) => sectionId.startsWith('question-1-answer-part-')), false)

  const answerNode = findRenderedSection(layoutPlan, renderedPages, 'question-1-answer').node
  const answerCell = answerNode.table.body[0][0]

  assert.equal(answerNode.margin[3], 10)
  assert.equal(answerCell.fillColor, '#f0f9ff')
  assert.deepEqual(answerCell.border, [true, false, false, false])
  assert.equal(Array.isArray(answerCell.stack), true)
  assert.equal(answerCell.stack.length, 2)
  assert.match(answerCell.stack[0].text, /^정답:/)
  assert.match(answerCell.stack[1].text, /^해설:/)
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
