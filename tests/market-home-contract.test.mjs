import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const contractSource = fs.readFileSync(
  new URL('../src/lib/market-home.ts', import.meta.url),
  'utf8'
)
const serverSource = fs.readFileSync(
  new URL('../src/lib/market-home-server.ts', import.meta.url),
  'utf8'
)

test('market home config has strict defaults and bounded validation', () => {
  assert.match(contractSource, /DEFAULT_MARKET_HOME_CONFIG/)
  assert.match(contractSource, /rankingWindowDays:\s*30/)
  assert.match(contractSource, /validateMarketHomeConfig/)
  assert.match(contractSource, /assertExactKeys/)
  assert.match(contractSource, /popular\.limit/)
  assert.match(contractSource, /recent\.limit/)
})

test('public home queries are subject and publication scoped', () => {
  assert.match(serverSource, /\.eq\('workspace_subject',\s*workspaceSubject\)/)
  assert.match(serverSource, /\.eq\('status',\s*'published'\)/)
  assert.match(serverSource, /\.eq\('is_active',\s*true\)/)
  assert.match(serverSource, /\.is\('deleted_at',\s*null\)/)
  assert.match(serverSource, /\.eq\('is_visible',\s*true\)/)
  assert.match(serverSource, /visibleMenuIds/)
})

test('recent sorting and source paths are deterministic and preserve indexes', () => {
  assert.match(serverSource, /\.order\('published_at',\s*\{\s*ascending:\s*false,\s*nullsFirst:\s*false\s*\}\)/)
  assert.match(serverSource, /\.order\('created_at',\s*\{\s*ascending:\s*false\s*\}\)/)
  assert.match(serverSource, /\.order\('id',\s*\{\s*ascending:\s*true\s*\}\)/)
  assert.match(contractSource, /sourceIndexes:\s*number\[\]/)
  assert.match(serverSource, /sourceIndexes/)
})

test('section failures resolve to typed empty fallbacks', () => {
  assert.match(serverSource, /Promise\.allSettled/)
  assert.match(serverSource, /fulfilledOr/)
  assert.match(serverSource, /popular:\s*\[\]/)
  assert.match(serverSource, /sourcePaths:\s*\[\]/)
  assert.match(serverSource, /recent:\s*\[\]/)
})

