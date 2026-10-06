// 상품 상세 '전체 패키지'의 비교가·절약 표시 규칙(docs/purchase-section-redesign-plan.md 3절, D1-a).
// 클라이언트 컴포넌트와 Node 테스트가 함께 쓰도록 다른 모듈에 의존하지 않는다.

export interface BundleSavingsSubproduct {
  categorySlug: string
  fileTypes: { code: string }[]
  priceCredits: number
  ownedScope: 'item' | 'subproduct' | null
}

export interface BundleSavings {
  // 같은 자료를 개별로 살 때의 최저 정가 합계
  comparePriceCredits: number
  savingsCredits: number
}

// 서버 판정(lower(ft.code) = 'pdf')과 같은 기준으로 PDF 포함 문제(HWP)를 가린다.
export function isPdfInclusiveHwp(subproduct: Pick<BundleSavingsSubproduct, 'categorySlug' | 'fileTypes'>) {
  return subproduct.categorySlug === 'question_hwp'
    && subproduct.fileTypes.some((fileType) => fileType.code.toLowerCase() === 'pdf')
}

// 비교가 = 판매 중인 개별 자료 정가 합계. PDF 포함 문제(HWP)가 있으면 문제(PDF)는 같은 내용이라 뺀다
// (함께 살 수 없다는 기존 충돌 규칙과 같은 기준). 비교가가 패키지가보다 클 때만 절약을 돌려준다.
// 정확한 비교가 아닌 경우(패키지 보유·가격 미정·개별 일부 보유)는 null → 원가·절약·추천을 모두 숨긴다.
// 정가는 priceCredits를 쓴다(upgradePriceCredits는 사람마다 다른 차액가라 쓰지 않는다).
export function getBundleSavings(
  bundle: { priceCredits: number; owned: boolean },
  subproducts: BundleSavingsSubproduct[]
): BundleSavings | null {
  if (bundle.owned || bundle.priceCredits <= 0 || subproducts.length === 0) return null
  if (subproducts.some((subproduct) => subproduct.priceCredits <= 0)) return null
  if (subproducts.some((subproduct) => subproduct.ownedScope === 'subproduct')) return null

  const hasPdfInclusiveHwp = subproducts.some(isPdfInclusiveHwp)
  const comparePriceCredits = subproducts
    .filter((subproduct) => !(hasPdfInclusiveHwp && subproduct.categorySlug === 'question_pdf'))
    .reduce((total, subproduct) => total + subproduct.priceCredits, 0)
  const savingsCredits = comparePriceCredits - bundle.priceCredits

  return savingsCredits > 0 ? { comparePriceCredits, savingsCredits } : null
}
