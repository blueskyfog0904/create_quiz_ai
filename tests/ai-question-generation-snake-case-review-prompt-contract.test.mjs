import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const workflowSource = readFileSync(
  new URL('../src/lib/ai/question-generation-workflow.ts', import.meta.url),
  'utf8'
)

test('review and regeneration prompts show generated questions with response-structure snake_case keys', () => {
  assert.match(workflowSource, /serializeQuestionForResponseStructure\(question: Question\)/)
  assert.match(workflowSource, /question_text: question\.questionText/)
  assert.match(workflowSource, /question_text_forward: question\.questionTextForward \?\? null/)
  assert.match(workflowSource, /question_text_backward: question\.questionTextBackward \?\? null/)
  assert.match(workflowSource, /passage_text: question\.passageText \?\? null/)
  assert.match(workflowSource, /JSON\.stringify\(serializeQuestionForResponseStructure\(input\.previousQuestion\), null, 2\)/)
  assert.match(workflowSource, /JSON\.stringify\(serializeQuestionForResponseStructure\(input\.generatedQuestion\), null, 2\)/)
  assert.doesNotMatch(workflowSource, /JSON\.stringify\(input\.previousQuestion, null, 2\)/)
  assert.doesNotMatch(workflowSource, /JSON\.stringify\(input\.generatedQuestion, null, 2\)/)
})
