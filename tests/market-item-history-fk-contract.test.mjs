import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('supabase/migrations/20261113150000_market_item_history_fk_restrict.sql')
const rollback = read('supabase/rollback/20261113150000_market_item_history_fk_restrict_down.sql')
const cleanup = read('src/lib/market-item-cleanup.ts')

const HISTORY_FKS = {
  market_download_events: 'market_download_events_item_id_fkey',
  market_entitlements: 'market_entitlements_item_workspace_fkey',
  market_item_reviews: 'market_item_reviews_item_workspace_fkey',
  market_purchase_lines: 'market_purchase_lines_item_workspace_fkey',
  market_purchase_orders: 'market_purchase_orders_item_workspace_fkey',
  market_purchases: 'market_purchases_item_id_fkey',
  market_refund_requests: 'market_refund_requests_item_id_fkey',
}

test('기록 FK 7개만 RESTRICT로 바꾸고, 상품 구성물 FK는 건드리지 않는다', () => {
  for (const [table, constraint] of Object.entries(HISTORY_FKS)) {
    const pattern = new RegExp(
      `ALTER TABLE public\\.${table}\\n  DROP CONSTRAINT ${constraint},\\n  ADD CONSTRAINT ${constraint}\\n    FOREIGN KEY \\([^)]+\\) REFERENCES public\\.market_items\\([^)]+\\) ON DELETE RESTRICT;`
    )
    assert.match(migration, pattern, table)
  }
  assert.equal(migration.match(/ON DELETE RESTRICT;/g).length, 7)
  for (const table of ['market_item_files', 'market_item_subproducts', 'market_subproduct_files', 'market_item_sample_pages', 'market_item_bundle_options', 'market_item_view_events']) {
    assert.doesNotMatch(migration, new RegExp(`ALTER TABLE public\\.${table}\\b`), table)
  }
})

test('RESTRICT로 바꾸는 표는 코드의 이력 판정 표와 같다', () => {
  const tables = cleanup.match(/const MARKET_ITEM_HISTORY_TABLES = \[([^\]]+)\]/)[1].match(/'([a-z_]+)'/g).map((name) => name.slice(1, -1))
  assert.deepEqual([...tables].sort(), Object.keys(HISTORY_FKS).sort())
})

test('삭제 코드는 FK 위반(23503)을 숨김으로 처리한다', () => {
  assert.match(cleanup, /const FOREIGN_KEY_VIOLATION_CODE = '23503'/)
  assert.match(cleanup, /error\.code === FOREIGN_KEY_VIOLATION_CODE \|\| error\.code === MARKET_ITEM_HAS_HISTORY_ERROR_CODE/)
})

test('되돌리기는 같은 7개를 CASCADE로 되돌린다', () => {
  for (const [table, constraint] of Object.entries(HISTORY_FKS)) {
    assert.match(rollback, new RegExp(`ALTER TABLE public\\.${table}\\n  DROP CONSTRAINT ${constraint},`), table)
  }
  assert.equal(rollback.match(/ON DELETE CASCADE;/g).length, 7)
  assert.doesNotMatch(rollback, /RESTRICT;/)
})

test('적용과 되돌리기는 ON DELETE 동작만 다르고 컬럼·참조 정의는 같다', () => {
  const definitions = (source) => [...source.matchAll(/ADD CONSTRAINT (\w+)\n    FOREIGN KEY (\([^)]+\)) REFERENCES (public\.market_items\([^)]+\)) ON DELETE (\w+);/g)]
    .map(([, name, columns, reference]) => `${name} ${columns} -> ${reference}`)
  const up = definitions(migration)
  assert.equal(up.length, 7)
  assert.deepEqual(up, definitions(rollback))
  // 과목이 있는 표는 (item_id, workspace_subject) 복합 키로, 나머지는 item_id 단일 키로 참조한다(기존 정의 그대로)
  assert.deepEqual(up, [
    'market_download_events_item_id_fkey (item_id) -> public.market_items(id)',
    'market_entitlements_item_workspace_fkey (item_id, workspace_subject) -> public.market_items(id, workspace_subject)',
    'market_item_reviews_item_workspace_fkey (item_id, workspace_subject) -> public.market_items(id, workspace_subject)',
    'market_purchase_lines_item_workspace_fkey (item_id, workspace_subject) -> public.market_items(id, workspace_subject)',
    'market_purchase_orders_item_workspace_fkey (item_id, workspace_subject) -> public.market_items(id, workspace_subject)',
    'market_purchases_item_id_fkey (item_id) -> public.market_items(id)',
    'market_refund_requests_item_id_fkey (item_id) -> public.market_items(id)',
  ])
})
