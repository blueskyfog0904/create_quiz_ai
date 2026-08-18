import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const ROOT = new URL('../', import.meta.url)

async function read(relativePath) {
  return readFile(new URL(relativePath, ROOT), 'utf8')
}

test('market board DTO is explicit and excludes private market fields', async () => {
  const source = await read('src/lib/market-board.ts')

  for (const field of [
    'MarketBoardData',
    'MarketBoardRow',
    'MarketBoardSourceConfig',
    'MarketBoardQuery',
    'MarketBoardResult',
    'startingPriceCredits',
    'ratingAverage',
    'ratingCount',
    'pageCount',
    'itemCount',
  ]) {
    assert.match(source, new RegExp(`\\b${field}\\b`))
  }

  for (const privateField of [
    'storageBucket',
    'storagePath',
    'createdBy',
    'purchaseId',
    'downloadEventId',
    'checksum',
  ]) {
    assert.doesNotMatch(source, new RegExp(`\\b${privateField}\\b`))
  }
})

test('market board server scopes category and items to one public subject', async () => {
  const source = await read('src/lib/market-board-server.ts')

  assert.match(source, /\.from\('market_menu_groups'\)/)
  assert.match(source, /\.from\('market_menu_entries'\)/)
  assert.match(source, /\.from\('market_items'\)/)
  assert.match(source, /\.eq\('workspace_subject', subject\)/)
  assert.match(source, /\.eq\('status', 'published'\)/)
  assert.match(source, /\.eq\('is_visible', true\)/)
  assert.match(source, /\.eq\('is_active', true\)/)
  assert.match(source, /\.is\('deleted_at', null\)/)
  assert.match(source, /group_id === null/)
  assert.match(source, /ungrouped:/)
  assert.doesNotMatch(source, /\.select\('\*'/)
})

test('market board item query uses exact server pagination, exact filters, and stable ordering', async () => {
  const source = await read('src/lib/market-board-server.ts')

  assert.match(source, /count: 'exact'/)
  assert.match(source, /\.range\(from, to\)/)
  assert.match(source, /\.ilike\('title'/)
  for (const column of [
    'exam_year',
    'exam_month',
    'grade_level',
    'source_type',
    'source_1',
    'source_2',
    'source_3',
    'source_4',
  ]) {
    assert.match(source, new RegExp(`'${column}'`))
  }
  assert.match(source, /activeSourceConfig\?\.fields\.find/)
  assert.match(source, /requestedSourceType && sourceConfigs\.some/)
  assert.match(source, /config\.typeName === requestedSourceType/)
  assert.match(source, /input\[definition\.key\]/)
  assert.match(source, /field\.options\.length === 0 \|\| field\.options\.includes\(value\)/)
  assert.match(source, /itemQuery = itemQuery\.eq\(definition\.valueKey, value\)/)
  assert.match(source, /\.order\('published_at', \{ ascending: false, nullsFirst: false \}\)/)
  assert.match(source, /\.order\('created_at', \{ ascending: false \}\)/)
  assert.match(source, /\.order\('id', \{ ascending: true \}\)/)
  assert.match(source, /\.order\('view_count', \{ ascending: false \}\)/)
  assert.match(source, /\.order\('question_count', \{ ascending: false, nullsFirst: false \}\)/)
})

test('market board enriches rows without exposing file storage metadata', async () => {
  const source = await read('src/lib/market-board-server.ts')

  assert.match(source, /\.from\('market_item_sample_pages'\)/)
  assert.match(source, /\.from\('market_item_subproducts'\)/)
  assert.match(source, /\.from\('market_item_bundle_options'\)/)
  assert.match(source, /\.from\('market_item_files'\)/)
  assert.match(source, /\.from\('market_item_reviews'\)/)
  assert.match(source, /\.select\('item_id, price_credits'\)/)
  assert.match(source, /\.select\('item_id, rating'\)/)
  assert.match(source, /startingPrices/)
  assert.match(source, /Math\.min\(\.\.\.prices\)/)
  assert.match(source, /ratingSummaries/)
  assert.match(source, /\.select\('item_id, page_number'\)/)
  assert.match(source, /\.select\('item_id, asset_kind'\)/)
  assert.doesNotMatch(source, /\.from\('market_subproduct_files'\)/)
  assert.doesNotMatch(source, /\.from\('market_file_types'\)/)
  assert.doesNotMatch(source, /\.from\('profiles'\)/)
  assert.doesNotMatch(source, /sellerNames/)
  assert.doesNotMatch(source, /fileTypeLabels/)
  assert.doesNotMatch(source, /storage_(bucket|path)/)
  assert.doesNotMatch(source, /original_file_name/)
})

test('source configuration stays nested by source type and query failures are explicit', async () => {
  const source = await read('src/lib/market-board-server.ts')

  assert.match(source, /\.from\('source_configs'\)/)
  assert.match(source, /'source_1_label'/)
  assert.match(source, /'source_1_options'/)
  assert.match(source, /\{ typeName, fields \}/)
  assert.match(source, /\.select\('menu_entry_id, exam_year, exam_month, grade_level, source_type'\)/)
  assert.match(source, /configuredSourceTypes/)
  assert.match(source, /\.map\(\(typeName\) => \(\{ typeName, fields: \[\] \}\)\)/)
  assert.match(source, /status: 'not_found'/)
  assert.match(source, /status: 'error'/)
  assert.doesNotMatch(source, /sample-data|SampleBoard|SampleMaterialPost/)
})

test('missing group schema falls back to existing visible entries only', async () => {
  const source = await read('src/lib/market-board-server.ts')

  assert.match(source, /function isMissingMarketMenuGroupSchemaError/)
  assert.match(source, /PGRST204/)
  assert.match(source, /PGRST205/)
  assert.match(source, /42P01/)
  assert.match(source, /42703/)
  assert.match(source, /market_menu_groups/)
  assert.match(source, /market_menu_entries/)
  assert.match(source, /\.select\('id, slug, title, description, sort_order'\)/)
  assert.match(source, /group_id: null/)
  assert.match(source, /groups: \[\]/)
  assert.match(source, /isMissingMarketMenuGroupSchemaError\(groupError\)/)
  assert.match(source, /isMissingMarketMenuGroupSchemaError\(menuError\)/)
})
