import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { getBundleSavings, isPdfInclusiveHwp } from '../src/lib/market-bundle-savings.ts'

const sub = (categorySlug, priceCredits, codes, ownedScope = null) => ({
  categorySlug,
  priceCredits,
  fileTypes: codes.map((code) => ({ code })),
  ownedScope,
})

// 공개 독서 상품과 같은 구성: 워크북 2,500 · 문제(PDF) 2,500 · 문제(HWP, PDF 포함) 3,000, 패키지 4,500
const readingSubproducts = [
  sub('workbook', 2500, ['pdf']),
  sub('question_pdf', 2500, ['pdf']),
  sub('question_hwp', 3000, ['hwp', 'pdf']),
]
const readingBundle = { priceCredits: 4500, owned: false }

test('독서형: 문제(PDF)는 PDF 포함 문제(HWP)와 같은 내용이라 비교가에서 빠져 5,500 → 1,000 절약', () => {
  assert.deepEqual(getBundleSavings(readingBundle, readingSubproducts), { comparePriceCredits: 5500, savingsCredits: 1000 })
})

test('패키지가가 같은 내용의 개별 최저가 이상이면 절약을 표시하지 않는다', () => {
  // 문학형 구성(문제(PDF)·문제(HWP, PDF 포함))에 패키지 4,500 → 개별 최저가 3,000
  const literature = [sub('question_pdf', 2500, ['pdf']), sub('question_hwp', 3000, ['hwp', 'pdf'])]
  assert.equal(getBundleSavings({ priceCredits: 4500, owned: false }, literature), null)
  assert.equal(getBundleSavings({ priceCredits: 5500, owned: false }, readingSubproducts), null, '같은 값도 표시 안 함')
})

test('문제(HWP)에 PDF가 없으면 문제(PDF)를 빼지 않고 단순 합계로 비교한다', () => {
  const subproducts = [sub('workbook', 2500, ['pdf']), sub('question_pdf', 2500, ['pdf']), sub('question_hwp', 3000, ['hwp'])]
  assert.deepEqual(getBundleSavings(readingBundle, subproducts), { comparePriceCredits: 8000, savingsCredits: 3500 })
})

test('가격 미정(0 이하) 자료가 있거나 패키지 가격이 미정이면 표시하지 않는다', () => {
  assert.equal(getBundleSavings(readingBundle, [...readingSubproducts.slice(0, 2), sub('question_hwp', 0, ['hwp', 'pdf'])]), null)
  assert.equal(getBundleSavings({ priceCredits: 0, owned: false }, readingSubproducts), null)
})

test('개별 자료를 일부 보유하면(패키지는 정가 구매) 표시하지 않는다', () => {
  const partiallyOwned = [sub('workbook', 2500, ['pdf'], 'subproduct'), ...readingSubproducts.slice(1)]
  assert.equal(getBundleSavings(readingBundle, partiallyOwned), null)
})

test('패키지를 보유하면 표시하지 않는다', () => {
  const owned = readingSubproducts.map((subproduct) => ({ ...subproduct, ownedScope: 'item' }))
  assert.equal(getBundleSavings({ priceCredits: 4500, owned: true }, owned), null)
})

test('개별 자료가 1개면 그 가격과 비교하고, 0개면 표시하지 않는다', () => {
  assert.deepEqual(getBundleSavings({ priceCredits: 2000, owned: false }, [sub('question_hwp', 3000, ['hwp', 'pdf'])]), {
    comparePriceCredits: 3000,
    savingsCredits: 1000,
  })
  assert.equal(getBundleSavings({ priceCredits: 2000, owned: false }, [sub('question_hwp', 1500, ['hwp'])]), null)
  assert.equal(getBundleSavings(readingBundle, []), null)
})

test('PDF 포함 문제(HWP) 판정: question_hwp이면서 형식 코드에 pdf(대소문자 무시)가 있을 때만', () => {
  assert.equal(isPdfInclusiveHwp(sub('question_hwp', 3000, ['HWP', 'PDF'])), true)
  assert.equal(isPdfInclusiveHwp(sub('question_hwp', 3000, ['hwp'])), false)
  assert.equal(isPdfInclusiveHwp(sub('question_pdf', 2500, ['pdf'])), false)
})

test('구매 영역은 PDF 포함 판정을 새 lib 하나에서 가져온다(중복 정의 없음)', () => {
  const lib = readFileSync(new URL('../src/lib/market-bundle-savings.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(lib, /^import /m, 'no dependencies so client and Node can import it')
  const actions = readFileSync(
    new URL('../src/app/(dashboard)/market/[slug]/items/[itemId]/market-item-actions.tsx', import.meta.url),
    'utf8'
  )
  assert.match(actions, /import \{ isPdfInclusiveHwp \} from '@\/lib\/market-bundle-savings'/)
  assert.doesNotMatch(actions, /function isPdfInclusiveHwp/)
  assert.doesNotMatch(actions, /categorySlug === 'question_hwp'\s*\n?\s*&& [^\n]*fileType\.code\.toLowerCase\(\) === 'pdf'/)
  assert.equal((actions.match(/isPdfInclusiveHwp\(/g) ?? []).length, 2, 'existing two call sites keep using it')
})
