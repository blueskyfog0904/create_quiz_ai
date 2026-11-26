// 함께 살 수 없는 선택 판정(11번 6-3). DB checkout_market_selection 6단계와 같은 식이다:
// 같은 itemId 의 두 줄이 (전체 패키지 + 개별 자료) 이거나 (문제(PDF) + PDF 파일이 든 문제(HWP)) 이면 충돌.
// includesPdf 는 evaluate_market_targets 값('PDF 파일이 하나라도 있음')이라 categorySlug 와 함께 볼 때만 'PDF 포함 HWP' 다.
// 장바구니와 상품 상세가 같이 쓴다. 판정에는 아래 네 값만 쓴다.

export interface MarketSelectionLine {
  id: string
  itemId: string | null
  targetKind: 'subproduct' | 'bundle'
  categorySlug: string | null
  includesPdf: boolean
}

function conflicts(a: MarketSelectionLine, b: MarketSelectionLine): boolean {
  return (a.targetKind === 'bundle' && b.targetKind === 'subproduct')
    || (a.categorySlug === 'question_pdf' && b.categorySlug === 'question_hwp' && b.includesPdf)
}

// 충돌하는 줄 id 와 자료 id. 충돌이 없으면 둘 다 비어 있다.
export function findConflictingSelection(lines: MarketSelectionLine[]): { lineIds: Set<string>; itemIds: Set<string> } {
  const lineIds = new Set<string>()
  const itemIds = new Set<string>()
  for (const a of lines) {
    for (const b of lines) {
      if (a === b || a.itemId === null || a.itemId !== b.itemId) continue
      if (conflicts(a, b)) {
        lineIds.add(a.id)
        lineIds.add(b.id)
        itemIds.add(a.itemId)
      }
    }
  }
  return { lineIds, itemIds }
}
