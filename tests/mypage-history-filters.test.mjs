import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildQuickRangeFilter,
  filterCreditSourcesByHistoryFilter,
  filterCreditTransactionsByHistoryFilter,
  filterPaymentsByHistoryFilter,
  formatDateInputValue,
} from '../src/lib/mypage-history-filters.ts'

test('formatDateInputValue returns yyyy-mm-dd for date inputs', () => {
  assert.equal(
    formatDateInputValue(new Date(2026, 3, 16, 9, 0, 0)),
    '2026-04-16'
  )
})

test('buildQuickRangeFilter builds inclusive quick ranges from today', () => {
  assert.deepEqual(
    buildQuickRangeFilter(7, new Date('2026-04-16T09:00:00.000Z')),
    {
      fromDate: '2026-04-10',
      toDate: '2026-04-16',
    }
  )

  assert.deepEqual(
    buildQuickRangeFilter(30, new Date('2026-04-16T09:00:00.000Z')),
    {
      fromDate: '2026-03-18',
      toDate: '2026-04-16',
    }
  )

  assert.deepEqual(
    buildQuickRangeFilter(90, new Date('2026-04-16T09:00:00.000Z')),
    {
      fromDate: '2026-01-17',
      toDate: '2026-04-16',
    }
  )
})

test('payment history filter applies an inclusive date range', () => {
  const filtered = filterPaymentsByHistoryFilter([
    { id: 'old', created_at: '2026-04-01T01:00:00.000Z' },
    { id: 'in-range', created_at: '2026-04-15T10:00:00.000Z' },
  ], {
    fromDate: '2026-04-10',
    toDate: '2026-04-15',
  })

  assert.deepEqual(filtered.map((item) => item.id), ['in-range'])
})

test('credit source filter applies both date range and source category', () => {
  const filtered = filterCreditSourcesByHistoryFilter([
    { id: 'a', purchased_at: '2026-04-10T00:00:00.000Z', source_category: 'plan_purchase' },
    { id: 'b', purchased_at: '2026-04-12T00:00:00.000Z', source_category: 'admin_grant' },
    { id: 'c', purchased_at: '2026-04-16T00:00:00.000Z', source_category: 'admin_grant' },
  ], {
    fromDate: '2026-04-11',
    toDate: '2026-04-15',
    sourceCategory: 'admin_grant',
  })

  assert.deepEqual(filtered.map((item) => item.id), ['b'])
})

test('credit transaction filter applies both date range and transaction type', () => {
  const filtered = filterCreditTransactionsByHistoryFilter([
    { id: 'charge', created_at: '2026-04-15T02:00:00.000Z', type: 'purchase' },
    { id: 'market-use', created_at: '2026-04-15T04:00:00.000Z', type: 'consume' },
    { id: 'late-use', created_at: '2026-04-16T04:00:00.000Z', type: 'consume' },
  ], {
    fromDate: '2026-04-15',
    toDate: '2026-04-15',
    transactionType: 'consume',
  })

  assert.deepEqual(filtered.map((item) => item.id), ['market-use'])
})
