import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../src/app/(dashboard)/library/exam-papers/[id]/exam-paper-view.tsx', import.meta.url),
  'utf8'
)

test('library exam-paper question order selector has enough room for three-digit numbers', () => {
  assert.match(
    source,
    /className="absolute -left-16 top-4"/,
    'selector should stay aligned with the card after widening the trigger'
  )

  assert.match(
    source,
    /<SelectTrigger className="w-20 h-10 text-lg font-bold">/,
    'selector trigger should be wide enough and use slightly smaller text for 100+ question numbers'
  )
})
