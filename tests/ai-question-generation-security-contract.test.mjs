import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const generateRouteSource = readSource('src/app/api/questions/generate/route.ts')
const adminProblemTypesApiSource = readSource('src/app/api/admin/problem-types/route.ts')
const actionsSource = readSource('src/app/(admin)/admin/problem-types/actions.ts')
const geminiSource = readSource('src/lib/ai/gemini.ts')
const workflowSource = readSource('src/lib/ai/question-generation-workflow.ts')

const reviewRoutePath = 'src/app/api/questions/review/route.ts'
const adminTestRoutePath = 'src/app/api/admin/problem-types/[id]/test/route.ts'

test('review route is admin-only and does not trust client-supplied prompt fields', () => {
  assert.equal(existsSync(new URL(`../${reviewRoutePath}`, import.meta.url)), true)
  const reviewRouteSource = readSource(reviewRoutePath)
  assert.match(reviewRouteSource, /select\('is_admin'\)/)
  assert.match(reviewRouteSource, /!profile\?\.is_admin/)
  assert.match(reviewRouteSource, /status:\s*403/)
  assert.match(reviewRouteSource, /problemTypeId/)
  assert.match(reviewRouteSource, /generatedQuestion/)
  assert.match(reviewRouteSource, /buildQuestionGenerationConfigFromProblemType/)
  assert.doesNotMatch(reviewRouteSource, /generationPrompt:\s*z\.string/)
  assert.doesNotMatch(reviewRouteSource, /responseStructurePrompt:\s*z\.string/)
  assert.doesNotMatch(reviewRouteSource, /reviewPrompt:\s*z\.string/)
})

test('public generate route never exposes full trace payloads', () => {
  assert.match(generateRouteSource, /traceMode:\s*'none'/)
  assert.match(generateRouteSource, /includeTrace:\s*false/)
  assert.doesNotMatch(generateRouteSource, /attempts:\s*loopResult\.attempts/)
  assert.doesNotMatch(generateRouteSource, /lastQuestion:\s*loopResult\.lastQuestion/)
  assert.doesNotMatch(generateRouteSource, /success:\s*false,[\s\S]{0,240}review:\s*loopResult\.finalReview/)
  assert.doesNotMatch(generateRouteSource, /renderedReviewPrompt/)
  assert.doesNotMatch(generateRouteSource, /renderedGenerationPrompt/)
})

test('admin full trace payloads are redacted and bounded before display', () => {
  assert.match(workflowSource, /redactTraceSecrets/)
  assert.match(workflowSource, /truncateTraceText/)
  assert.match(workflowSource, /MAX_TRACE_RAW_TEXT_LENGTH/)
  assert.match(workflowSource, /sanitizeTracePayload/)
})

test('admin test route is the only full-trace no-credit test surface', () => {
  assert.equal(existsSync(new URL(`../${adminTestRoutePath}`, import.meta.url)), true)
  const adminTestRouteSource = readSource(adminTestRoutePath)
  assert.match(adminTestRouteSource, /select\('is_admin'\)/)
  assert.match(adminTestRouteSource, /!profile\?\.is_admin/)
  assert.match(adminTestRouteSource, /status:\s*403/)
  assert.match(adminTestRouteSource, /traceMode:\s*'admin_full'/)
  assert.match(adminTestRouteSource, /attempts:\s*loopResult\.attempts/)
  assert.doesNotMatch(adminTestRouteSource, /CreditService\.deductCredits/)
  assert.doesNotMatch(adminTestRouteSource, /\.from\('questions'\)\.insert/)
})

test('admin problem type create paths persist response and review prompts', () => {
  for (const source of [adminProblemTypesApiSource, actionsSource]) {
    assert.match(source, /output_format/)
    assert.match(source, /review_prompt_template/)
  }
})

test('gemini adapter does not log full prompt or full response by default', () => {
  assert.doesNotMatch(geminiSource, /FULL PROMPT CONTENT/)
  assert.doesNotMatch(geminiSource, /console\.log\(params\.prompt\)/)
  assert.doesNotMatch(geminiSource, /FULL RESPONSE CONTENT/)
  assert.doesNotMatch(geminiSource, /console\.log\(rawContent\)/)
})
