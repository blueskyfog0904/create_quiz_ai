import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const aiTypesSource = readSource('src/lib/ai/types.ts')
const aiIndexSource = readSource('src/lib/ai/index.ts')
const workflowSource = readSource('src/lib/ai/question-generation-workflow.ts')
const generateRouteSource = readSource('src/app/api/questions/generate/route.ts')
const reviewRouteSource = readSource('src/app/api/questions/review/route.ts')
const adminTestRouteSource = readSource('src/app/api/admin/problem-types/[id]/test/route.ts')
const listboardRunRouteSource = readSource('src/app/api/generate/listboard-jobs/[jobId]/run/route.ts')
const listboardRetryRouteSource = readSource('src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts')

test('AI provider registry supports Claude alongside OpenAI and Gemini', () => {
  assert.match(aiTypesSource, /export type AIProvider = 'openai' \| 'gemini' \| 'claude'/)
  assert.match(aiIndexSource, /ClaudeAdapter/)
  assert.match(aiIndexSource, /claude:\s*new ClaudeAdapter\(\)/)
})

test('generation review workflow routes generation and review through separate provider model configs', () => {
  assert.match(workflowSource, /QuestionGenerationModelConfig/)
  assert.match(workflowSource, /generationProvider/)
  assert.match(workflowSource, /generationModelName/)
  assert.match(workflowSource, /reviewProvider/)
  assert.match(workflowSource, /reviewModelName/)
  assert.match(workflowSource, /buildQuestionGenerationConfigFromProblemType/)
  assert.match(workflowSource, /REVIEW_MODEL_NOT_CONFIGURED/)
  assert.match(workflowSource, /provider:\s*input\.modelConfig\.generationProvider/)
  assert.match(workflowSource, /modelName:\s*input\.modelConfig\.generationModelName/)
  assert.match(workflowSource, /provider:\s*input\.modelConfig\.reviewProvider/)
  assert.match(workflowSource, /modelName:\s*input\.modelConfig\.reviewModelName/)
})

test('all generation entry points resolve model split config from problem types', () => {
  for (const source of [generateRouteSource, adminTestRouteSource, listboardRunRouteSource, listboardRetryRouteSource]) {
    assert.match(source, /buildQuestionGenerationConfigFromProblemType/)
    assert.match(source, /modelConfig:/)
    assert.doesNotMatch(source, /provider:\s*problemType\.provider as AIProvider/)
    assert.doesNotMatch(source, /modelName:\s*problemType\.model_name/)
  }
})

test('review API uses review provider and model only', () => {
  assert.match(reviewRouteSource, /buildQuestionGenerationConfigFromProblemType/)
  assert.match(reviewRouteSource, /modelConfig\.reviewProvider/)
  assert.match(reviewRouteSource, /modelConfig\.reviewModelName/)
  assert.doesNotMatch(reviewRouteSource, /provider:\s*problemType\.provider as AIProvider/)
})

test('public generation returns configuration error before credit deduction when review model is missing', () => {
  const configCheckIndex = generateRouteSource.indexOf('REVIEW_MODEL_NOT_CONFIGURED')
  const creditDeductionIndex = generateRouteSource.indexOf('CreditService.deductCredits')

  assert.notEqual(configCheckIndex, -1)
  assert.notEqual(creditDeductionIndex, -1)
  assert.ok(configCheckIndex < creditDeductionIndex)
  assert.match(generateRouteSource, /문제 검토 API 제공자와 모델을 먼저 설정해주세요/)
})
