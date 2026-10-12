import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const listApi = readFileSync(new URL('../src/app/api/market/[slug]/items/route.ts', import.meta.url), 'utf8')
const itemsServer = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')

test('market list api and server rows support zip and sample-pages-only sample filtering', () => {
  assert.match(listApi, /z\.enum\(\['all', 'sample', 'pdf', 'hwp', 'zip'\]\)/)
  assert.match(itemsServer, /assetKind\?: 'pdf' \| 'hwp' \| 'zip' \| 'sample' \| 'all'/)
  assert.match(itemsServer, /zip_price/)
  assert.match(itemsServer, /filters\.assetKind === 'zip'/)
})
