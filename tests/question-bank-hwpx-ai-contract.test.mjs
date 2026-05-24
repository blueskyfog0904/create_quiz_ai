import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = () => readFileSync(new URL('../src/lib/question-bank/hwpx-ai.ts', import.meta.url), 'utf8')

test('hwpx AI analyzer uses OpenAI structured outputs with strict schema and output token cap', () => {
  const file = source()

  assert.match(file, /new OpenAI/)
  assert.match(file, /response_format:\s*\{\s*type:\s*'json_schema'/)
  assert.match(file, /strict:\s*true/)
  assert.match(file, /max_completion_tokens:\s*outputTokenCap/)
  assert.match(file, /additionalProperties:\s*false/)
  assert.match(file, /safeParse/)
})

test('hwpx AI analyzer enforces input and total token budget before and after calls', () => {
  const file = source()

  assert.match(file, /estimateTokenCount/)
  assert.match(file, /maxEstimatedInputTokens/)
  assert.match(file, /maxTotalTokens/)
  assert.match(file, /estimateHwpxAiTokenBudget/)
  assert.match(file, /projectedTotalTokens/)
  assert.match(file, /buildSystemPrompt/)
  assert.match(file, /buildUserPrompt/)
  assert.match(file, /JSON\.stringify\(jsonSchema\)/)
  assert.match(file, /chatRequestOverheadTokens/)
  assert.match(file, /maxAiOutputTokens/)
  assert.match(file, /remainingTokenBudget/)
  assert.match(file, /outputTokenCap/)
  assert.match(file, /minimumOutputTokenBudget/)
  assert.match(file, /usage\.totalTokens/)
  assert.match(file, /AI 분석 토큰 한도를 초과했습니다/)
})

test('hwpx AI analyzer avoids full prompt logging and tells model not to invent fields', () => {
  const file = source()

  assert.doesNotMatch(file, /AIGenerationService/)
  assert.doesNotMatch(file, /GeminiAdapter/)
  assert.doesNotMatch(file, /console\.log\([^\n]*(prompt|raw|response|text)/i)
  assert.match(file, /절대 만들지 마세요|추론해서 생성하지 마세요/)
  assert.match(file, /문서에 없으면 빈 문자열/)
  assert.match(file, /needs_review/)
  assert.match(file, /question_bank_problem_types/)
})
