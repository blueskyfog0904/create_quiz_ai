import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(
  new URL('../src/app/api/ocr/actions.ts', import.meta.url),
  'utf8'
)

test('OCR prompts mention the parenthesized choice-marker format', () => {
  assert.match(source, /\(1\), \(2\), \(3\)/)
})
