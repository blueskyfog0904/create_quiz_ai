import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { findConflictingSelection } from '../src/lib/market-selection-conflict.ts'

// 11번 계획 11-1 '충돌 판정 = DB 6단계'(docs/plan-bundle11-checkout-simplify.md 6-3):
// 같은 itemId 의 두 줄이 (bundle + subproduct) 또는 (question_pdf + PDF 파일이 든 question_hwp) 이면 충돌.
// 같은 예시를 리허설이 checkout_market_selection 결과와 대조한다.

const ITEM = 'aaaaaaaa-0000-4000-8000-000000000001'
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002'
const THIRD = 'aaaaaaaa-0000-4000-8000-000000000003'
const line = (id, overrides = {}) => ({ id, itemId: ITEM, targetKind: 'subproduct', categorySlug: null, includesPdf: false, ...overrides })
const pdf = (id, itemId = ITEM) => line(id, { itemId, categorySlug: 'question_pdf', includesPdf: true })
const hwp = (id, includesPdf, itemId = ITEM) => line(id, { itemId, categorySlug: 'question_hwp', includesPdf })
const workbook = (id) => line(id, { categorySlug: 'workbook', includesPdf: true })
const bundle = (id, itemId = ITEM) => line(id, { itemId, targetKind: 'bundle' })

const cases = [
  ['문제(PDF) 하나 → 없음', [pdf('p')], []],
  ['워크북 + 문제(PDF) → 없음', [workbook('w'), pdf('p')], []],
  ['문제(PDF) + PDF 든 HWP → 충돌', [pdf('p'), hwp('h', true)], ['h', 'p']],
  ['문제(PDF) + PDF 없는 HWP → 없음', [pdf('p'), hwp('h', false)], []],
  ['패키지 + 개별 → 충돌', [bundle('b'), workbook('w')], ['b', 'w']],
  ['다른 itemId → 없음', [bundle('b', OTHER), pdf('p'), hwp('h', true, THIRD)], []],
]

for (const [name, lines, expected] of cases) {
  test(`충돌 판정: ${name}`, () => {
    const result = findConflictingSelection(lines)
    assert.deepEqual([...result.lineIds].sort(), expected)
    assert.deepEqual([...result.itemIds], expected.length > 0 ? [lines.find((l) => l.id === expected[0]).itemId] : [])
  })
}

test('충돌 판정은 줄 순서와 관계없고 itemId 가 없는 줄은 충돌시키지 않는다', () => {
  assert.deepEqual([...findConflictingSelection([hwp('h', true), pdf('p')]).lineIds].sort(), ['h', 'p'])
  assert.equal(findConflictingSelection([bundle('b', null), line('s', { itemId: null })]).lineIds.size, 0)
})

test('공용 판정 함수는 targetKind·itemId·categorySlug·includesPdf 만 쓰고 장바구니·상세가 함께 부른다', () => {
  const source = readFileSync(new URL('../src/lib/market-selection-conflict.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /fileTypes/)
  assert.match(source, /a\.targetKind === 'bundle' && b\.targetKind === 'subproduct'/)
  assert.match(source, /a\.categorySlug === 'question_pdf' && b\.categorySlug === 'question_hwp' && b\.includesPdf/)
  const detail = readFileSync(new URL('../src/components/market/market-item-actions.tsx', import.meta.url), 'utf8')
  assert.match(detail, /findConflictingSelection\(/)
})
