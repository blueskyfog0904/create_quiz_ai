// 18번 6-2·7절: 상품 복제(목록 [복제])·같은 구성으로 다음 상품. 화면·route 가 같이 쓰는 규칙(브라우저에서도 읽음).
export const MARKET_ITEM_DUPLICATE_MODES = ['next', 'copy'] as const
export type MarketItemDuplicateMode = typeof MARKET_ITEM_DUPLICATE_MODES[number]

export function isMarketItemDuplicateMode(value: unknown): value is MarketItemDuplicateMode {
  return typeof value === 'string' && (MARKET_ITEM_DUPLICATE_MODES as readonly string[]).includes(value)
}

// DB 함수 duplicate_market_item 이 돌려주는 값
export interface MarketItemDuplicateResult {
  itemId: string
  subproductCount: number
  skippedSubproductCount: number
  bundleCopied: boolean
}

// DB 함수 오류 코드 → 관리자 문구(마이그레이션 20261220100000 의 RAISE 코드와 같은 목록 — 계약 시험이 대조)
export const MARKET_ITEM_DUPLICATE_ERROR_MESSAGES = {
  MARKET_CATALOG_ACTOR_NOT_ALLOWED: '이 작업을 할 권한이 없습니다.',
  MARKET_DUPLICATE_INPUT_INVALID: '요청이 올바르지 않습니다. 화면을 새로고침해 주세요.',
  MARKET_DUPLICATE_SOURCE_NOT_FOUND: '원본 상품을 찾을 수 없습니다(지웠거나 다른 과목입니다). 화면을 새로고침해 주세요.',
} as const

export type MarketItemDuplicateErrorCode = keyof typeof MARKET_ITEM_DUPLICATE_ERROR_MESSAGES

export function extractMarketItemDuplicateError(message: string | null | undefined): MarketItemDuplicateErrorCode | null {
  const match = /(MARKET_[A-Z_]+)/.exec(message ?? '')
  return match && match[1] in MARKET_ITEM_DUPLICATE_ERROR_MESSAGES ? match[1] as MarketItemDuplicateErrorCode : null
}
