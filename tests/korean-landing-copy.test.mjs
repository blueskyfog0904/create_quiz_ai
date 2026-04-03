import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/features/landing/WorkspaceLanding.tsx', import.meta.url), 'utf8')
const koreanBlockStart = source.indexOf('korean: {')
const koreanBlockEnd = source.indexOf('theme:', koreanBlockStart)
const koreanBlock = source.slice(koreanBlockStart, koreanBlockEnd)

test('korean landing copy does not advertise unavailable problem-sheet flows', () => {
  assert.equal(koreanBlockStart >= 0, true)
  assert.equal(koreanBlockEnd > koreanBlockStart, true)
  assert.doesNotMatch(koreanBlock, /문제지 연결/)
  assert.doesNotMatch(koreanBlock, /문제지 흐름/)
})
