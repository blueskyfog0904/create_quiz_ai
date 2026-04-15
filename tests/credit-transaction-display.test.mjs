import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getCreditTransactionDescription,
  getCreditTransactionTypeLabel,
} from '../src/lib/credit-transaction-display.ts'

test('renders admin-granted purchase rows as 지급 with 지급 wording', () => {
  const transaction = {
    type: 'purchase',
    amount: 1000,
    description: '크레딧 1,000개 구매',
    source: { source_category: 'admin_grant' },
  }

  assert.equal(getCreditTransactionTypeLabel(transaction), '지급')
  assert.equal(getCreditTransactionDescription(transaction), '크레딧 1,000개 지급')
})

test('renders plan purchases as 충전 with 충전 wording', () => {
  const transaction = {
    type: 'purchase',
    amount: 33000,
    description: '크레딧 33,000개 구매',
    source: { source_category: 'plan_purchase' },
  }

  assert.equal(getCreditTransactionTypeLabel(transaction), '충전')
  assert.equal(getCreditTransactionDescription(transaction), '크레딧 33,000개 충전')
})

test('keeps 문제마켓 consume descriptions ending in 구매', () => {
  const transaction = {
    type: 'consume',
    amount: -8000,
    description: '문제마켓 선택 파일 2건 구매',
  }

  assert.equal(getCreditTransactionTypeLabel(transaction), '사용')
  assert.equal(getCreditTransactionDescription(transaction), '문제마켓 선택 파일 2건 구매')
})

test('rewrites non-market consume descriptions from 구매 to 사용', () => {
  const transaction = {
    type: 'consume',
    amount: -2500,
    description: '테스트 PDF 구매',
  }

  assert.equal(getCreditTransactionDescription(transaction), '테스트 PDF 사용')
})
