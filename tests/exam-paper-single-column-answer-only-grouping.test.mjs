import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

import { regressionExamPaper } from './fixtures/exam-paper-two-column-regression.fixture.mjs'

const singleColumnLayoutPath = new URL('../src/lib/exam-paper-single-column-layout.ts', import.meta.url)
const singleColumnLayoutSource = readFileSync(singleColumnLayoutPath, 'utf8')
const paginationModuleUrl = new URL(
  '../src/lib/exam-paper-pdf-pagination.js',
  import.meta.url
).href
const normalizeQuestionFieldModuleUrl = new URL(
  '../src/lib/questions/normalize-question-field.ts',
  import.meta.url
).href

async function loadRuntimeSingleColumnLayoutModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-single-answer-layout-'))
  const tempModulePath = join(tempDir, 'exam-paper-single-column-layout.runtime.ts')
  const runtimeSource = singleColumnLayoutSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)

  writeFileSync(tempModulePath, runtimeSource)

  return import(`${pathToFileURL(tempModulePath).href}?t=${Date.now()}`)
}

function createLongAnswerOnlyQuestion() {
  return {
    number: 1,
    questionText: '무시되는 answer-only question text',
    answer: '①',
    explanation: Array.from({ length: 12 }, (_, index) => (
      `Explanation sentence ${index + 1} explains in detail why the selected option is correct and how the supporting evidence accumulates across the passage.`
    )).join(' '),
  }
}

test('answer-only single-column splits long explanations into multiple answer fragments', async () => {
  const layoutModule = await loadRuntimeSingleColumnLayoutModule()
  const groups = layoutModule.buildSingleColumnQuestionGroups(createLongAnswerOnlyQuestion(), {
    showQuestions: false,
    showAnswers: true,
  })

  assert.deepEqual(groups.promptBlocks, [])
  assert.ok(groups.answerBlocks.length > 1)
  assert.equal(groups.answerBlocks[0].id, 'question-1-answer-part-1')
  assert.equal(groups.answerBlocks[1].id, 'question-1-answer-part-2')
  assert.equal(groups.answerBlocks[0].payload.type, 'answer')
  assert.equal(groups.answerBlocks[0].payload.questionLabel, '1번')
  assert.equal(groups.answerBlocks[0].payload.answerText, '①')
  assert.equal(groups.answerBlocks[1].payload.questionLabel, '')
  assert.equal(groups.answerBlocks[1].payload.answerText, '')
})

test('answer-only single-column pagination lets answer fragments spill across pages', async () => {
  const layoutModule = await loadRuntimeSingleColumnLayoutModule()
  const questionGroups = [
    layoutModule.buildSingleColumnQuestionGroups(createLongAnswerOnlyQuestion(), {
      showQuestions: false,
      showAnswers: true,
    }),
  ]

  const firstFragmentWeight = questionGroups[0].answerBlocks[0].estimatedHeight

  const pages = layoutModule.paginateSingleColumnQuestionGroups({
    questionGroups,
    hasDescription: false,
    firstPageCapacity: firstFragmentWeight + 1,
    otherPageCapacity: 999,
    groupAnswerOnlyQuestion: true,
  })

  assert.ok(pages.length >= 2)
  assert.deepEqual(pages[0].blockIds, ['question-1-answer-part-1'])
  assert.equal(pages[1].blockIds[0], 'question-1-answer-part-2')
})

test('answer-only grouping does not change the normal choice spill path', async () => {
  const layoutModule = await loadRuntimeSingleColumnLayoutModule()
  const question = regressionExamPaper.questions[0]
  const groups = layoutModule.buildSingleColumnQuestionGroups(question, {
    showQuestions: true,
    showAnswers: true,
  })

  const placementSteps = layoutModule.buildSingleColumnPlacementSteps(groups, {
    groupAnswerOnlyQuestion: false,
  })

  assert.equal(placementSteps.length, 3)
  assert.deepEqual(placementSteps[0].blocks.map((block) => block.id), groups.promptBlocks.map((block) => block.id))
  assert.deepEqual(placementSteps[1].blocks.map((block) => block.id), groups.choiceBlocks.map((block) => block.id))
  assert.deepEqual(placementSteps[2].blocks.map((block) => block.id), groups.answerBlocks.map((block) => block.id))
})
