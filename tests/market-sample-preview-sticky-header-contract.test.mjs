import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const readSource = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const source = readSource('src/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog.tsx')

test('market sample preview keeps the header fixed while sample pages scroll', () => {
  assert.match(source, /DialogContent className="[^"]*flex flex-col[^"]*overflow-hidden[^"]*"/)
  assert.match(source, /DialogHeader className="[^"]*shrink-0[^"]*"/)
  assert.match(source, /className="[^"]*flex-1[^"]*overflow-y-auto[^"]*"/)
})
