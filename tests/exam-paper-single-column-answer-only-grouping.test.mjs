import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

import { regressionExamPaper } from './fixtures/exam-paper-two-column-regression.fixture.mjs'

const singleColumnLayoutPath = new URL('../src/lib/exam-paper-single-column-layout.ts', import.meta.url)
const singleColumnLayoutSource = readFileSync(singleColumnLayoutPath, 'utf8')
const normalizeQuestionFieldModuleUrl = new URL(
  '../src/lib/questions/normalize-question-field.ts',
  import.meta.url
).href

async function loadRuntimeSingleColumnLayoutModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-single-answer-layout-'))
  const tempModulePath = join(tempDir, 'exam-paper-single-column-layout.runtime.ts')
  const runtimeSource = singleColumnLayoutSource
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)

  writeFileSync(tempModulePath, runtimeSource)

  return import(`${pathToFileURL(tempModulePath).href}?t=${Date.now()}`)
}

test('answer-only single-column without grouping can split header and answer across pages under tight capacity', async () => {
  const layoutModule = await loadRuntimeSingleColumnLayoutModule()
  const questionGroups = regressionExamPaper.questions.slice(0, 2).map((question) => (
    layoutModule.buildSingleColumnQuestionGroups(question, {
      showQuestions: false,
      showAnswers: true,
    })
  ))

  const firstQuestionTotal = [
    ...questionGroups[0].promptBlocks,
    ...questionGroups[0].answerBlocks,
  ].reduce((sum, block) => sum + block.estimatedHeight, 0)
  const secondHeaderWeight = questionGroups[1].promptBlocks.reduce((sum, block) => sum + block.estimatedHeight, 0)

  const pages = layoutModule.paginateSingleColumnQuestionGroups({
    questionGroups,
    hasDescription: false,
    firstPageCapacity: firstQuestionTotal + secondHeaderWeight,
    otherPageCapacity: 999,
  })

  assert.equal(pages.length, 2)
  assert.deepEqual(pages[0].blockIds, ['question-1-header', 'question-1-answer', 'question-2-header'])
  assert.deepEqual(pages[1].blockIds, ['question-2-answer'])
})

test('answer-only single-column keeps question number and answer panel together when space is tight', async () => {
  const layoutModule = await loadRuntimeSingleColumnLayoutModule()
  const questionGroups = regressionExamPaper.questions.slice(0, 2).map((question) => (
    layoutModule.buildSingleColumnQuestionGroups(question, {
      showQuestions: false,
      showAnswers: true,
    })
  ))

  const firstQuestionTotal = [
    ...questionGroups[0].promptBlocks,
    ...questionGroups[0].answerBlocks,
  ].reduce((sum, block) => sum + block.estimatedHeight, 0)
  const secondHeaderWeight = questionGroups[1].promptBlocks.reduce((sum, block) => sum + block.estimatedHeight, 0)

  const pages = layoutModule.paginateSingleColumnQuestionGroups({
    questionGroups,
    hasDescription: false,
    firstPageCapacity: firstQuestionTotal + secondHeaderWeight,
    otherPageCapacity: 999,
    groupAnswerOnlyQuestion: true,
  })

  assert.equal(pages.length, 2)
  assert.deepEqual(pages[0].blockIds, ['question-1-header', 'question-1-answer'])
  assert.deepEqual(pages[1].blockIds, ['question-2-header', 'question-2-answer'])
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
