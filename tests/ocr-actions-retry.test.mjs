import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../src/app/api/ocr/actions.ts', import.meta.url),
  'utf8'
)

test('ocr actions use the shared Gemini retry helper with three attempts', () => {
  assert.match(source, /withGeminiRetry/)
  assert.match(source, /maxAttempts:\s*3/)
  assert.match(source, /AI 서버가 일시적으로 혼잡합니다\. 잠시 후 다시 시도해주세요\./)
})
