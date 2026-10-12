import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('market item queries normalize source filters and use exact equality', async () => {
  const source = await read('src/lib/market-items-server.ts')

  for (const field of ['sourceType', 'source1', 'source2', 'source3', 'source4']) {
    assert.match(source, new RegExp(`${field}\\?: string`))
  }

  for (const [column, field] of [
    ['source_type', 'sourceType'],
    ['source_1', 'source1'],
    ['source_2', 'source2'],
    ['source_3', 'source3'],
    ['source_4', 'source4'],
  ]) {
    assert.match(source, new RegExp(`\\['${column}', normalizeText\\(filters\\.${field}\\)\\]`))
  }
  assert.match(source, /query = query\.eq\(column, value\)/)
})

test('items API parses subject first and scopes slug plus exact filters', async () => {
  const route = await read('src/app/api/market/[slug]/items/route.ts')

  assert.match(route, /subject: z\.enum\(\['english', 'korean'\]\)\.default\(DEFAULT_WORKSPACE_SUBJECT\)/)
  assert.ok(
    route.indexOf('const parsed = QuerySchema.safeParse(query)') <
      route.indexOf('getVisibleMarketMenuEntryBySlugForWorkspace(slug, parsed.data.subject)')
  )
  assert.match(route, /getVisibleMarketMenuEntryBySlugForWorkspace\(slug, parsed\.data\.subject\)/)

  for (const field of ['sourceType', 'source1', 'source2', 'source3', 'source4']) {
    assert.match(route, new RegExp(`${field}: z\\.string\\(\\)\\.transform\\(normalizeQueryText\\)\\.optional\\(\\)`))
    assert.match(route, new RegExp(`${field}: parsed\\.data\\.${field}`))
  }
})
