import assert from 'node:assert/strict'
import test from 'node:test'
import { getListPagination, normalizeListPage, normalizeListPageSize, updateListQuery } from '../src/lib/list-pagination.ts'
import { readAllQueryRows } from '../src/lib/read-all-query-rows.ts'

test('64 items have four disjoint pages and last-page clamping', () => {
  const ids = Array.from({ length: 64 }, (_, i) => i)
  const pages = [1, 2, 3, 4].map((page) => {
    const state = getListPagination(64, page, 20)
    return ids.slice(state.offset, state.offset + state.pageSize)
  })
  assert.deepEqual(pages.map((page) => page.length), [20, 20, 20, 4])
  assert.deepEqual(pages.flat(), ids)
  assert.equal(getListPagination(64, 999, 20).page, 4)
  assert.equal(getListPagination(0, 999, 20).page, 1)
})

test('invalid page and size values are bounded', () => {
  for (const input of ['NaN', 'Infinity', -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeListPage(input), 1)
  }
  assert.equal(normalizeListPage('2'), 2)
  assert.equal(normalizeListPageSize('50'), 50)
  assert.equal(normalizeListPageSize('1000000'), 20)
})

test('query updates preserve repeated filters and reset page independently', () => {
  const result = new URLSearchParams(updateListQuery('subject=korean&type=pdf&type=hwp&q=독서&page=4', { page: 1, sort: 'latest' }))
  assert.deepEqual(result.getAll('type'), ['pdf', 'hwp'])
  assert.equal(result.get('subject'), 'korean')
  assert.equal(result.get('q'), '독서')
  assert.equal(result.has('page'), false)
  assert.equal(updateListQuery('tab=transactions&transaction_page=2', { transaction_page: 1, transaction_pageSize: 50 }), 'tab=transactions&transaction_pageSize=50')
})

test('batch reads traverse the PostgREST row cap and propagate failures', async () => {
  const source = Array.from({ length: 1203 }, (_, id) => ({ id }))
  const rows = await readAllQueryRows(async (from, to) => ({ data: source.slice(from, to + 1), error: null }))
  assert.deepEqual(rows, source)
  await assert.rejects(() => readAllQueryRows(async () => ({ data: null, error: { message: 'failure' } })), /failure/)
})
