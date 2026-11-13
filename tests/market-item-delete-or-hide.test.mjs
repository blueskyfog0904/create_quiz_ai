import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { load, createFakeAdmin, op } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const ITEM_ID = '11111111-1111-4111-8111-111111111111'
const HISTORY_TABLES = [
  'market_purchases',
  'market_download_events',
  'market_purchase_orders',
  'market_purchase_lines',
  'market_entitlements',
  'market_refund_requests',
  'market_item_reviews',
]

// historyTable: 이력이 있는 표 이름, historyError: 이력 조회 오류, deleteError: market_items delete 오류, removeError: 파일 삭제 오류
function loadCleanup({ historyTable = null, historyError = null, deleteError = null, removeError = null, enqueueError = null, itemStatus = 'published' } = {}) {
  const events = []
  const errors = []
  const { client, calls } = createFakeAdmin(({ table, ops }) => {
    if (HISTORY_TABLES.includes(table)) {
      if (historyError) return { data: null, error: { message: historyError } }
      return { data: table === historyTable ? [{ item_id: ITEM_ID }] : [], error: null }
    }
    if (table === 'market_items' && op(ops, 'delete')) {
      events.push('db-delete')
      return { error: deleteError }
    }
    if (table === 'market_storage_cleanup_queue') {
      if (op(ops, 'upsert')) {
        events.push('queue-add')
        return { error: enqueueError ? { message: enqueueError } : null }
      }
      if (op(ops, 'delete')) {
        events.push('queue-clear')
        return { error: null }
      }
      if (op(ops, 'update')) {
        events.push(`queue-fail:${op(ops, 'update')[1].attempt_count}`)
        return { error: null }
      }
      return { data: [{ id: 'q1', storage_bucket: 'market-files', storage_path: 'a/b.pdf', attempt_count: 0, last_error: null }], error: null }
    }
    return { data: [], error: null }
  }, {
    remove: () => {
      events.push('storage-remove')
      return removeError ? { message: removeError } : null
    },
  })
  const bypass = { createAdminClient: () => client }
  const storageCleanup = load('src/lib/market-storage-cleanup.ts', { '@/lib/supabase/bypass': bypass }, errors)
  const cleanup = load('src/lib/market-item-cleanup.ts', {
    '@/lib/supabase/bypass': bypass,
    '@/lib/market-storage-cleanup': storageCleanup,
    '@/lib/market-items-server': {
      getMarketItemById: async () => ({ id: ITEM_ID, workspace_subject: 'korean', status: itemStatus, draft_source: null }),
      listMarketItemFiles: async () => {
        events.push('collect-files')
        return [{ storage_bucket: 'market-files', storage_path: 'a/b.pdf' }]
      },
      listMarketSubproductFilesForAdmin: async () => [],
      updateMarketItem: async (id, input) => {
        events.push(`update:${input.status}`)
      },
    },
    '@/lib/market-sample-pages-server': { listMarketItemSamplePagesForCleanup: async () => [] },
    '@/lib/workspace-subject': { DEFAULT_WORKSPACE_SUBJECT: 'english' },
  }, errors)
  return { cleanup, events, calls, errors }
}

const input = { itemId: ITEM_ID, workspaceSubject: 'korean', updatedBy: '00000000-0000-4000-8000-000000000001' }

test('이력 표 7개 중 어느 하나에만 기록이 있어도 지우지 않고 숨김으로 바꾼다', async () => {
  for (const historyTable of HISTORY_TABLES) {
    const { cleanup, events } = loadCleanup({ historyTable })
    const result = await cleanup.deleteOrHideMarketItem(input)
    assert.equal(result.result, 'hidden', historyTable)
    assert.deepEqual(events, ['update:hidden'], historyTable)
  }
})

test('이미 숨김인 이력 상품은 다시 고치지 않는다', async () => {
  const { cleanup, events } = loadCleanup({ historyTable: 'market_purchase_orders', itemStatus: 'hidden' })
  const result = await cleanup.deleteOrHideMarketItem(input)
  assert.equal(result.result, 'hidden')
  assert.deepEqual(events, [])
})

test('이력이 없으면 파일 경로 수집 → DB 삭제 → 대기 표 기록 → 파일 삭제 → 대기 행 정리 순서로 지운다', async () => {
  const { cleanup, events } = loadCleanup()
  const result = await cleanup.deleteOrHideMarketItem(input)
  assert.deepEqual(result, { result: 'deleted', storageCleanupFailed: false })
  assert.deepEqual(events, ['collect-files', 'db-delete', 'queue-add', 'storage-remove', 'queue-clear'])
})

test('파일 삭제가 실패해도 삭제는 성공으로 돌려주고, 대기 행을 남겨 나중에 다시 정리할 수 있게 한다', async () => {
  const { cleanup, events, errors } = loadCleanup({ removeError: 'storage down' })
  const result = await cleanup.deleteOrHideMarketItem(input)
  assert.deepEqual(result, { result: 'deleted', storageCleanupFailed: true })
  // 대기 행은 지우지 않고 시도 횟수 1과 사유만 남긴다
  assert.deepEqual(events, ['collect-files', 'db-delete', 'queue-add', 'storage-remove', 'queue-fail:1'])
  assert.equal(errors.length, 1)
})

test('대기 표에 기록하지 못해도 파일은 바로 지워 본다', async () => {
  const { cleanup, events } = loadCleanup({ enqueueError: 'relation does not exist' })
  const result = await cleanup.deleteOrHideMarketItem(input)
  assert.deepEqual(result, { result: 'deleted', storageCleanupFailed: false })
  assert.deepEqual(events, ['collect-files', 'db-delete', 'queue-add', 'storage-remove'])

  const both = loadCleanup({ enqueueError: 'relation does not exist', removeError: 'storage down' })
  assert.deepEqual(await both.cleanup.deleteOrHideMarketItem(input), { result: 'deleted', storageCleanupFailed: true })
})

test('이력 조회가 실패하면 아무것도 지우거나 숨기지 않고 오류를 던진다', async () => {
  const { cleanup, events } = loadCleanup({ historyError: 'boom' })
  await assert.rejects(() => cleanup.deleteOrHideMarketItem(input), /boom/)
  assert.deepEqual(events, [])
})

test('판정 뒤 삭제에서 FK 위반(23503)이 나면 숨김으로 바꾸고 파일은 지우지 않는다', async () => {
  const { cleanup, events } = loadCleanup({ deleteError: { message: 'violates foreign key constraint', code: '23503' } })
  const result = await cleanup.deleteOrHideMarketItem(input)
  assert.equal(result.result, 'hidden')
  assert.deepEqual(events, ['collect-files', 'db-delete', 'update:hidden'])
})

test('그 밖의 DB 삭제 오류는 숨기지 않고 그대로 던진다', async () => {
  const { cleanup, events } = loadCleanup({ deleteError: { message: 'timeout', code: '57014' } })
  await assert.rejects(() => cleanup.deleteOrHideMarketItem(input), /timeout/)
  assert.deepEqual(events, ['collect-files', 'db-delete'])
})

test('자동 정리(requireNoHistory)는 이력이 있으면 지우지 않고 오류를 낸다', async () => {
  const { cleanup, events } = loadCleanup({ historyTable: 'market_item_reviews' })
  await assert.rejects(
    () => cleanup.hardDeleteMarketItemWithAssets({ itemId: ITEM_ID, workspaceSubject: 'korean', requireNoHistory: true }),
    (error) => error.code === 'MARKET_ITEM_HAS_HISTORY',
  )
  assert.deepEqual(events, ['collect-files'])
})

test('삭제 route는 결과(deleted/hidden)를 돌려주고, 화면은 숨김 처리 안내를 보여 준다', () => {
  const route = read('src/app/api/admin/market/items/[id]/route.ts')
  assert.match(route, /const \{ result \} = await deleteOrHideMarketItem\(\{/)
  assert.match(route, /updatedBy: user\.id/)
  assert.match(route, /NextResponse\.json\(\{ success: true, data: \{ result \} \}\)/)
  assert.doesNotMatch(route, /hardDeleteMarketItemWithAssets/)

  const client = read('src/app/(admin)/admin/market/products/market-products-client.tsx')
  assert.match(client, /구매·환불·후기 이력이 있어 삭제하지 않고 숨김 처리했습니다\./)
  assert.equal(client.match(/구매·환불·후기 이력이 있는 상품은 삭제되지 않고 숨김 처리됩니다\(구매자 다운로드는 유지\)\./g)?.length, 3)
  assert.match(client, /삭제 \$\{deletedIds\.length\}개 \/ 이력이 있어 숨김 처리 \$\{hiddenIds\.length\}개/)
})

test('숨김 상품도 다운로드 대상이다(공개·숨김만 허용, 삭제·비활성은 계속 막음)', () => {
  const server = read('src/lib/market-items-server.ts')
  const start = server.indexOf('export async function getActiveMarketSubproductFileForDownload(')
  const body = server.slice(start, server.indexOf('\n}\n', start))
  assert.match(body, /const isDownloadableStatus = item\?\.status === 'published' \|\| item\?\.status === 'hidden'/)
  assert.match(body, /item\.deleted_at !== null \|\| item\.is_active === false \|\| !isDownloadableStatus/)
  assert.match(body, /\.eq\('is_active', true\)\s+\.is\('deleted_at', null\)/)
})
