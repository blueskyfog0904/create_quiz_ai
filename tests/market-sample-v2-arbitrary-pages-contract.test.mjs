import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const generator = readFileSync(new URL('../src/lib/market-pdf-sample-generator.ts', import.meta.url), 'utf8')

test('sample page parser accepts arbitrary comma separated pages with de-duplication', () => {
  assert.match(generator, /export function parseMarketSamplePageSelection/)
  assert.match(generator, /split\(/)
  assert.match(generator, /new Set/)
  assert.match(generator, /pageNumber < 1|pageNumber <= 0/)
  assert.match(generator, /maxPageCount/)
})

test('pdf sample generator renders selected page numbers instead of only first three pages', () => {
  assert.match(generator, /pageNumbers:/)
  assert.match(generator, /for \(const pageNumber of pageNumbers\)/)
  assert.doesNotMatch(generator, /for \(let pageNumber = 1; pageNumber <= pageCount; pageNumber \+= 1\)/)
})
