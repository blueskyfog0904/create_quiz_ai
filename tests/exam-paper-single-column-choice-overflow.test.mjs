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
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-single-choice-layout-'))
  const tempModulePath = join(tempDir, 'exam-paper-single-column-layout.runtime.ts')
  const runtimeSource = singleColumnLayoutSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)

  writeFileSync(tempModulePath, runtimeSource)

  return import(`${pathToFileURL(tempModulePath).href}?t=${Date.now()}`)
}

test('single-column paginator lets only choice rows spill to the next page', async () => {
  const layoutModule = await loadRuntimeSingleColumnLayoutModule()
  const question = regressionExamPaper.questions[0]
  const groups = layoutModule.buildSingleColumnQuestionGroups(question, {
    showQuestions: true,
    showAnswers: true,
  })

  const promptWeight = groups.promptBlocks.reduce((sum, block) => sum + block.estimatedHeight, 0)
  const firstThreeChoiceWeight = groups.choiceBlocks
    .slice(0, 3)
    .reduce((sum, block) => sum + block.estimatedHeight, 0)
  const fourthChoiceWeight = groups.choiceBlocks[3].estimatedHeight
  const answerWeight = groups.answerBlocks.reduce((sum, block) => sum + block.estimatedHeight, 0)

  const pages = layoutModule.paginateSingleColumnQuestionGroups({
    questionGroups: [groups],
    hasDescription: false,
    firstPageCapacity: promptWeight + firstThreeChoiceWeight + 1,
    otherPageCapacity: fourthChoiceWeight + answerWeight + 10,
  })

  assert.equal(pages.length, 2)
  assert.deepEqual(
    pages[0].blockIds,
    [
      ...groups.promptBlocks.map((block) => block.id),
      'question-1-choice-row-1',
      'question-1-choice-row-2',
      'question-1-choice-row-3',
    ]
  )
  assert.deepEqual(
    pages[1].blockIds,
    [
      'question-1-choice-row-4',
      'question-1-choice-row-5',
      'question-1-answer',
    ]
  )
})

test('single-column answer block never appears before all choice rows finish', async () => {
  const layoutModule = await loadRuntimeSingleColumnLayoutModule()
  const question = regressionExamPaper.questions[0]
  const groups = layoutModule.buildSingleColumnQuestionGroups(question, {
    showQuestions: true,
    showAnswers: true,
  })

  const promptWeight = groups.promptBlocks.reduce((sum, block) => sum + block.estimatedHeight, 0)
  const firstChoiceWeight = groups.choiceBlocks[0].estimatedHeight

  const pages = layoutModule.paginateSingleColumnQuestionGroups({
    questionGroups: [groups],
    hasDescription: false,
    firstPageCapacity: promptWeight + firstChoiceWeight + 1,
    otherPageCapacity: 999,
  })

  const orderedBlockIds = pages.flatMap((page) => page.blockIds)
  const lastChoiceIndex = orderedBlockIds.findLastIndex((id) => id.startsWith('question-1-choice-row-'))
  const answerIndex = orderedBlockIds.indexOf('question-1-answer')

  assert.ok(lastChoiceIndex !== -1)
  assert.ok(answerIndex !== -1)
  assert.equal(answerIndex > lastChoiceIndex, true)
})
