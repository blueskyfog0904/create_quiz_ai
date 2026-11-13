import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { load, createFakeAdmin, op, loadRoute } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const row = (id, path, extra = {}) => ({ id, storage_bucket: 'market-files', storage_path: path, attempt_count: 0, last_error: null, ...extra })

// queueRows: 대기 표에 있는 행, referencedPaths: 아직 쓰는 파일 경로, removeError: 파일 삭제 오류, referenceError: 참조 확인 오류
function loadCleanup({ queueRows = [], referencedPaths = [], removeError = null, referenceError = null } = {}) {
  const events = []
  const errors = []
  const { client } = createFakeAdmin(({ table, ops }) => {
    if (table === 'market_storage_cleanup_queue') {
      if (op(ops, 'delete')) {
        events.push(['queue-clear', op(ops, 'in')[2]])
        return { error: null }
      }
      if (op(ops, 'update')) {
        events.push(['queue-fail', op(ops, 'in')[2], op(ops, 'update')[1]])
        return { error: null }
      }
      const select = op(ops, 'select')
      if (select?.[2]?.head) return { count: queueRows.length, error: null }
      return { data: queueRows, error: null }
    }
    if (['market_item_files', 'market_subproduct_files', 'market_item_sample_pages'].includes(table)) {
      if (referenceError) return { data: null, error: { message: referenceError } }
      // 살아 있는 행만 본다(deleted_at is null)
      assert.deepEqual(op(ops, 'is'), ['is', 'deleted_at', null])
      const paths = op(ops, 'in')[2]
      return { data: table === 'market_subproduct_files' ? referencedPaths.filter((path) => paths.includes(path)).map((storage_path) => ({ storage_path })) : [], error: null }
    }
    return { data: [], error: null }
  }, {
    remove: (paths) => {
      events.push(['storage-remove', paths])
      // removeError: 문자열이면 항상 실패, 함수면 호출마다 판단
      if (typeof removeError === 'function') return removeError(paths)
      return removeError ? { message: removeError } : null
    },
  })
  const cleanup = load('src/lib/market-storage-cleanup.ts', { '@/lib/supabase/bypass': { createAdminClient: () => client } }, errors)
  return { cleanup, events, errors }
}

test('다시 정리: 파일을 지우고 대기 행을 뺀다', async () => {
  const rows = [row('q1', 'a/1.pdf'), row('q2', 'a/2.pdf')]
  const { cleanup, events } = loadCleanup({ queueRows: rows })
  const result = await cleanup.processMarketStorageCleanupRows(rows)
  assert.deepEqual(result, { cleaned: 2, failed: 0 })
  assert.deepEqual(events, [['storage-remove', ['a/1.pdf', 'a/2.pdf']], ['queue-clear', ['q1', 'q2']]])
})

test('파일 삭제가 실패하면 행을 남기고 시도 횟수를 1 올린다(행마다 자기 횟수 기준)', async () => {
  const rows = [row('q1', 'a/1.pdf'), row('q2', 'a/2.pdf', { attempt_count: 3 })]
  const { cleanup, events } = loadCleanup({ queueRows: rows, removeError: 'storage down' })
  const result = await cleanup.processMarketStorageCleanupRows(rows)
  assert.deepEqual(result, { cleaned: 0, failed: 2 })
  const fails = events.filter(([name]) => name === 'queue-fail')
  assert.deepEqual(fails.map(([, ids, update]) => [ids, update.attempt_count, update.last_error]), [
    [['q1'], 1, 'storage down'],
    [['q2'], 4, 'storage down'],
  ])
  assert.equal(events.some(([name]) => name === 'queue-clear'), false)
})

test('아직 쓰는 파일(살아 있는 행이 가리키는 경로)은 지우지 않고 사유를 남긴다', async () => {
  const rows = [row('q1', 'a/1.pdf'), row('q2', 'a/2.pdf')]
  const { cleanup, events } = loadCleanup({ queueRows: rows, referencedPaths: ['a/2.pdf'] })
  const result = await cleanup.processMarketStorageCleanupRows(rows)
  assert.deepEqual(result, { cleaned: 1, failed: 1 })
  assert.deepEqual(events.find(([name]) => name === 'storage-remove')[1], ['a/1.pdf'])
  const [, ids, update] = events.find(([name]) => name === 'queue-fail')
  assert.deepEqual(ids, ['q2'])
  assert.equal(update.last_error, 'STILL_REFERENCED')
  assert.deepEqual(events.find(([name]) => name === 'queue-clear')[1], ['q1'])
})

test('참조 확인이 실패하면 파일을 지우지 않는다', async () => {
  const rows = [row('q1', 'a/1.pdf')]
  const { cleanup, events } = loadCleanup({ queueRows: rows, referenceError: 'boom' })
  const result = await cleanup.processMarketStorageCleanupRows(rows)
  assert.deepEqual(result, { cleaned: 0, failed: 1 })
  assert.equal(events.some(([name]) => name === 'storage-remove'), false)
})

test('retryMarketStorageCleanup: dryRun이면 세기만 하고, 아니면 정리한 뒤 남은 수를 돌려준다', async () => {
  const rows = [row('q1', 'a/1.pdf')]
  const dry = loadCleanup({ queueRows: rows })
  assert.deepEqual(await dry.cleanup.retryMarketStorageCleanup({ dryRun: true }), { dryRun: true, scanned: 1, cleaned: 0, failed: 0, remaining: 1 })
  assert.deepEqual(dry.events, [])

  const real = loadCleanup({ queueRows: rows })
  const result = await real.cleanup.retryMarketStorageCleanup()
  assert.equal(result.cleaned, 1)
  assert.equal(result.failed, 0)
})

test('관리자 API: 비관리자는 403, 관리자는 다시 정리 결과를 받는다', async () => {
  const mocks = { '@/lib/market-storage-cleanup': { retryMarketStorageCleanup: async () => ({ dryRun: false, scanned: 3, cleaned: 2, failed: 1, remaining: 1 }) } }
  const denied = loadRoute('src/app/api/admin/market/storage-cleanup/route.ts', { isAdmin: false, mocks })
  assert.equal((await denied.route.POST()).status, 403)
  const anonymous = loadRoute('src/app/api/admin/market/storage-cleanup/route.ts', { loggedIn: false, mocks })
  assert.equal((await anonymous.route.POST()).status, 401)

  const allowed = loadRoute('src/app/api/admin/market/storage-cleanup/route.ts', { mocks })
  assert.deepEqual(await (await allowed.route.POST()).json(), { success: true, data: { dryRun: false, scanned: 3, cleaned: 2, failed: 1, remaining: 1 } })
})

test('대기 표는 service role만 쓰고, 화면·cron이 다시 정리를 부른다', () => {
  const migration = read('supabase/migrations/20261113120000_market_storage_cleanup_queue.sql')
  assert.match(migration, /CREATE TABLE public\.market_storage_cleanup_queue/)
  assert.match(migration, /UNIQUE \(storage_bucket, storage_path\)/)
  assert.match(migration, /ENABLE ROW LEVEL SECURITY;/)
  assert.match(migration, /REVOKE ALL ON public\.market_storage_cleanup_queue FROM PUBLIC, anon, authenticated;/)
  assert.doesNotMatch(migration, /CREATE POLICY/)
  assert.match(read('supabase/rollback/20261113120000_market_storage_cleanup_queue_down.sql'), /DROP TABLE public\.market_storage_cleanup_queue;/)

  const page = read('src/app/(admin)/admin/market/products/page.tsx')
  assert.match(page, /countPendingMarketStorageCleanup\(\)\.catch\(\(\) => 0\)/)
  assert.match(page, /<StorageCleanupNotice pendingCount=\{pendingStorageCleanupCount\} \/>/)
  const notice = read('src/app/(admin)/admin/market/products/storage-cleanup-notice.tsx')
  assert.match(notice, /if \(pendingCount <= 0\) \{\s+return null/)
  assert.match(notice, /fetch\('\/api\/admin\/market\/storage-cleanup', \{ method: 'POST' \}\)/)

  const cron = read('src/app/api/cron/market/cleanup-auto-upload-drafts/route.ts')
  assert.match(cron, /retryMarketStorageCleanup\(\{\s+limit: parsed\.data\.limit,\s+dryRun: parsed\.data\.dryRun \?\? true,\s+\}\)\.catch\(/)

  const itemCleanup = read('src/lib/market-item-cleanup.ts')
  const deleteAt = itemCleanup.indexOf(".from('market_items')\n    .delete()")
  const enqueueAt = itemCleanup.indexOf('enqueueMarketStorageCleanup({')
  assert.ok(deleteAt >= 0 && deleteAt < enqueueAt, '상품 행을 지운 뒤에만 파일을 대기 표에 올린다(살아 있는 상품의 파일이 정리 대상이 되지 않게)')
})

test('많은 행은 25개씩 나눠 처리한다(조회 조건이 너무 길어지지 않게)', async () => {
  const rows = Array.from({ length: 60 }, (_, index) => row(`q${index}`, `a/${index}.pdf`))
  const { cleanup, events } = loadCleanup({ queueRows: rows })
  const result = await cleanup.processMarketStorageCleanupRows(rows)
  assert.deepEqual(result, { cleaned: 60, failed: 0 })
  assert.deepEqual(events.filter(([name]) => name === 'storage-remove').map(([, paths]) => paths.length), [25, 25, 10])
  assert.deepEqual(events.filter(([name]) => name === 'queue-clear').map(([, ids]) => ids.length), [25, 25, 10])
})

test('한 묶음이 실패해도 다른 묶음은 정리하고, 실패 기록은 실패한 묶음의 행에만 남긴다', async () => {
  const rows = Array.from({ length: 60 }, (_, index) => row(`q${index}`, `a/${index}.pdf`))
  let call = 0
  // 첫 묶음(25개)만 파일 삭제가 실패한다
  const { cleanup, events } = loadCleanup({ queueRows: rows, removeError: () => (call++ === 0 ? { message: 'storage down' } : null) })
  const result = await cleanup.processMarketStorageCleanupRows(rows)
  assert.deepEqual(result, { cleaned: 35, failed: 25 })
  const failedIds = events.filter(([name]) => name === 'queue-fail').flatMap(([, ids]) => ids)
  assert.deepEqual(failedIds, rows.slice(0, 25).map((queued) => queued.id))
  const clearedIds = events.filter(([name]) => name === 'queue-clear').flatMap(([, ids]) => ids)
  assert.deepEqual(clearedIds, rows.slice(25).map((queued) => queued.id))
})

test('같은 묶음에서 아직 쓰는 파일과 삭제 실패가 함께 나도 행마다 한 번씩만 실패로 센다', async () => {
  const rows = [row('q1', 'a/1.pdf'), row('q2', 'a/2.pdf'), row('q3', 'a/3.pdf')]
  const { cleanup, events } = loadCleanup({ queueRows: rows, referencedPaths: ['a/1.pdf'], removeError: 'storage down' })
  const result = await cleanup.processMarketStorageCleanupRows(rows)
  assert.deepEqual(result, { cleaned: 0, failed: 3 })
  const fails = events.filter(([name]) => name === 'queue-fail').map(([, ids, update]) => [ids, update.last_error])
  assert.deepEqual(fails, [[['q1'], 'STILL_REFERENCED'], [['q2', 'q3'], 'storage down']])
})

test('다시 정리는 아직 시도하지 않은 행과 오래전에 시도한 행부터 읽는다', () => {
  const source = read('src/lib/market-storage-cleanup.ts')
  assert.match(source, /\.order\('last_attempt_at', \{ ascending: true, nullsFirst: true \}\)\s+\.order\('created_at', \{ ascending: true \}\)/)
})
