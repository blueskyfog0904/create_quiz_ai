import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/lib/ai/claude.ts', import.meta.url), 'utf8')

test('Claude adapter does not send deprecated temperature for current Claude models', () => {
  assert.match(source, /class ClaudeAdapter/)
  assert.match(source, /\/v1\/messages/)
  assert.doesNotMatch(source, /temperature:/)
})
