import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const aiTypesSource = readSource('src/lib/ai/types.ts')
const generateRouteSource = readSource('src/app/api/questions/generate/route.ts')
const listboardRunRouteSource = readSource('src/app/api/generate/listboard-jobs/[jobId]/run/route.ts')
const listboardRetryRouteSource = readSource('src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts')

const workflowPath = 'src/lib/ai/question-generation-workflow.ts'

test('review loop types and workflow helper are defined', () => {
  assert.match(aiTypesSource, /export const ReviewResultSchema/)
  assert.match(aiTypesSource, /export type ReviewResult/)
  assert.match(aiTypesSource, /export interface QuestionGenerationAttemptLog/)
  assert.match(aiTypesSource, /event:/)
  assert.match(aiTypesSource, /generation_started/)
  assert.match(aiTypesSource, /review_response/)
  assert.equal(existsSync(new URL(`../${workflowPath}`, import.meta.url)), true)

  const workflowSource = readSource(workflowPath)
  assert.match(workflowSource, /DEFAULT_MAX_REVIEW_ATTEMPTS\s*=\s*3/)
  assert.match(workflowSource, /buildQuestionGenerationPrompt/)
  assert.match(workflowSource, /buildQuestionRegenerationPrompt/)
  assert.match(workflowSource, /buildQuestionReviewPrompt/)
  assert.match(workflowSource, /reviewGeneratedQuestion/)
  assert.match(workflowSource, /runQuestionGenerationReviewLoop/)
  assert.match(workflowSource, /responseStructurePrompt/)
  assert.match(workflowSource, /previousQuestion/)
  assert.match(workflowSource, /feedback/)
})

test('review loop parses review booleans strictly and regenerates with empty feedback', () => {
  const workflowSource = readSource(workflowPath)
  assert.match(workflowSource, /normalizeReviewPassed/)
  assert.doesNotMatch(workflowSource, /Boolean\(candidate\.passed/)
  assert.match(workflowSource, /reviewFeedbackPayload\s*!==\s*undefined/)
  assert.match(workflowSource, /미통과.*피드백/)
})

test('review loop has provider and whole-loop timeout guards', () => {
  const workflowSource = readSource(workflowPath)
  assert.match(workflowSource, /DEFAULT_PROVIDER_TIMEOUT_MS\s*=\s*45_000/)
  assert.match(workflowSource, /DEFAULT_LOOP_TIMEOUT_MS\s*=\s*120_000/)
  assert.match(workflowSource, /AbortController/)
  assert.match(workflowSource, /status:\s*'timeout'/)
  assert.match(workflowSource, /timedOut:\s*true/)
})

test('questions generate route delegates generation to bounded review loop and keeps public trace hidden', () => {
  assert.match(generateRouteSource, /runQuestionGenerationReviewLoop/)
  assert.match(generateRouteSource, /buildQuestionGenerationConfigFromProblemType/)
  assert.match(generateRouteSource, /DEFAULT_MAX_REVIEW_ATTEMPTS/)
  assert.match(generateRouteSource, /status:\s*loopResult\.status/)
  assert.match(generateRouteSource, /review:\s*loopResult\.finalReview/)
  assert.doesNotMatch(generateRouteSource, /attempts:\s*loopResult\.attempts/)
  assert.doesNotMatch(generateRouteSource, /renderedGenerationPrompt/)
})

test('listboard run and retry routes use the same review loop for generated items', () => {
  for (const source of [listboardRunRouteSource, listboardRetryRouteSource]) {
    assert.match(source, /runQuestionGenerationReviewLoop/)
    assert.match(source, /buildQuestionGenerationConfigFromProblemType/)
    assert.match(source, /MAX_ATTEMPTS_REACHED|REVIEW_FAILED/)
    assert.match(source, /loopResult\.finalQuestion/)
    assert.match(source, /loopResult\.rawGenerationResponse/)
  }
})
